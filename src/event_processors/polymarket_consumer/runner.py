from __future__ import annotations

import json
import logging
from collections import deque

from .config import AppConfig
from .couchbase_client import CouchbaseClient
from .kafka_consumer import KafkaConsumer
from event_processors.subscription_fan_out import SubscriptionFanOut
from observability.metrics import cycle_timer, record_consumed_event, record_error, record_skipped_event

logger = logging.getLogger(__name__)


class StrategyInjestorRunner:
    """Consumes conviction events from Kafka and injects them into trading strategies.

    ===== STRATEGY INJESTOR (CONSUMER SERVICE) =====

    This service demonstrates consuming events from polymarket-kafka producer.

    Data Flow:
    1. polymarket-kafka PUBLISHES conviction events to 'polymarket-events' topic
    2. strategy-injestor CONSUMES from the same topic (this service)
    3. Events are printed/logged for demonstration
    4. In production: events would be routed to trading strategy evaluators
    """

    def __init__(self, config: AppConfig, kafka_consumer: KafkaConsumer, couchbase_client: CouchbaseClient, fan_out: SubscriptionFanOut) -> None:
        self._config = config
        self._kafka_consumer = kafka_consumer
        self._couchbase = couchbase_client
        self._fan_out = fan_out
        self._stop_requested = False
        self._polls_since_last_event = 0
        self._processed_event_ids: set[str] = set()
        self._processed_event_order: deque[str] = deque()

    def _is_duplicate_event(self, event_id: str) -> bool:
        if not event_id:
            return False
        if event_id in self._processed_event_ids:
            record_skipped_event("strategy-injestor", "duplicate_event")
            return True

        self._processed_event_ids.add(event_id)
        self._processed_event_order.append(event_id)
        while len(self._processed_event_order) > max(1, self._config.dedupe_cache_size):
            old = self._processed_event_order.popleft()
            self._processed_event_ids.discard(old)
        return False

    @staticmethod
    def _infer_pipeline(event: dict) -> str:
        pipeline = event.get("pipeline")
        if isinstance(pipeline, str) and pipeline.strip():
            return pipeline

        source = str(event.get("source", "")).lower()
        if "polymarket" in source:
            return "polymarket"
        if "stock-news" in source or "news" in source:
            return "stock-news"
        if "stock-analytics" in source or "analytics" in source:
            return "stock-analytics"

        if event.get("market_id") is not None:
            return "polymarket"
        if event.get("article_id") is not None or event.get("hotness_score") is not None:
            return "stock-news"
        if event.get("signal_type") is not None:
            return "stock-analytics"
        return "unknown"

    def request_stop(self) -> None:
        """Signal the runner to stop."""
        logger.info("Stop requested for StrategyInjestorRunner")
        self._stop_requested = True

    async def run(self) -> None:
        """Main polling loop that consumes events from Kafka."""
        logger.info(
            "Starting StrategyInjestorRunner with poll interval %sms pipeline=%s",
            self._config.poll_interval_ms,
            self._config.consumer_pipeline,
        )
        try:
            while not self._stop_requested:
                with cycle_timer("strategy-injestor"):
                    try:
                        event = self._kafka_consumer.poll(self._config.poll_interval_ms)

                        if event is None:
                            self._polls_since_last_event += 1
                            if self._polls_since_last_event % 30 == 0:
                                logger.info(
                                    "Consumer alive — waiting for conviction events (%d polls, no events yet)",
                                    self._polls_since_last_event,
                                )
                            continue

                        self._polls_since_last_event = 0

                        event_id = str(event.get("event_id", ""))
                        if self._is_duplicate_event(event_id):
                            logger.debug("Skipping duplicate event_id=%s", event_id)
                            continue

                        pipeline = self._infer_pipeline(event)
                        if self._config.consumer_pipeline not in {"all", pipeline}:
                            record_skipped_event("strategy-injestor", f"pipeline_{pipeline}")
                            logger.debug(
                                "Skipping pipeline=%s event_id=%s; consumer_pipeline=%s",
                                pipeline,
                                event.get("event_id"),
                                self._config.consumer_pipeline,
                            )
                            continue

                        record_consumed_event("strategy-injestor", pipeline)

                        if pipeline == "polymarket":
                            logger.info(
                                "CONVICTION EVENT RECEIVED: market_id=%s direction=%s magnitude=%.4f yes=%.2f no=%.2f",
                                event.get("market_id"),
                                event.get("conviction_direction"),
                                event.get("conviction_magnitude", 0.0),
                                event.get("yes_price", 0.0),
                                event.get("no_price", 0.0),
                            )
                        elif pipeline == "stock-news":
                            logger.info(
                                "STOCK NEWS EVENT RECEIVED: ticker=%s score=%.3f headline=%r",
                                event.get("ticker"),
                                event.get("hotness_score", 0.0),
                                str(event.get("headline", ""))[:80],
                            )
                        elif pipeline == "stock-analytics":
                            logger.info(
                                "ANALYTICS EVENT RECEIVED: ticker=%s signal=%s strength=%.3f",
                                event.get("ticker"),
                                event.get("signal_type"),
                                event.get("signal_strength", 0.0),
                            )
                        else:
                            logger.info("EVENT RECEIVED: pipeline=%s event_id=%s", pipeline, event.get("event_id"))

                        try:
                            # Fan-out: find all users subscribed to this signal
                            if pipeline == "polymarket":
                                user_ids = await self._fan_out.users_for_market(event.get("market_id", ""))
                            else:
                                user_ids = await self._fan_out.users_for_ticker(event.get("ticker", ""))

                            if user_ids:
                                for uid in user_ids:
                                    self._couchbase.upsert_event(event, user_id=uid)
                                logger.info(
                                    "Fan-out %s event %s → %d user(s)",
                                    pipeline, event.get("event_id", "")[:12], len(user_ids),
                                )
                            else:
                                # No subscribers — store as _global so data isn't lost
                                self._couchbase.upsert_event(event, user_id="_global")
                                logger.debug("No subscribers for event %s; stored as _global", event.get("event_id", "")[:12])
                        except Exception as cb_exc:
                            record_error("strategy-injestor", "couchbase_upsert")
                            logger.error("Failed to persist event to Couchbase: %s", cb_exc)

                        if self._config.log_full_events:
                            logger.info("Full event: %s", json.dumps(event, indent=2, default=str))

                    except Exception as exc:
                        record_error("strategy-injestor", "poll_loop")
                        logger.error("Error processing event: %s", exc)
                        continue

        finally:
            logger.info("Runner stopping; closing Kafka consumer, Couchbase, and fan-out")
            self._kafka_consumer.close()
            self._couchbase.close()
            await self._fan_out.close()
