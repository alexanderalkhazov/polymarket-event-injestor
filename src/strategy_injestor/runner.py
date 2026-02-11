from __future__ import annotations

import asyncio
import json
import logging

from .config import AppConfig
from .couchbase_client import CouchbaseClient
from .kafka_consumer import KafkaConsumer

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

    def __init__(self, config: AppConfig, kafka_consumer: KafkaConsumer, couchbase_client: CouchbaseClient) -> None:
        self._config = config
        self._kafka_consumer = kafka_consumer
        self._couchbase = couchbase_client
        self._stop_requested = False
        self._polls_since_last_event = 0

    def request_stop(self) -> None:
        """Signal the runner to stop."""
        logger.info("Stop requested for StrategyInjestorRunner")
        self._stop_requested = True

    async def run(self) -> None:
        """Main polling loop that consumes events from Kafka."""
        logger.info("Starting StrategyInjestorRunner with poll interval %sms", self._config.poll_interval_ms)
        try:
            while not self._stop_requested:
                try:
                    # ===== CONSUME FROM KAFKA =====
                    # Poll the Kafka topic for incoming conviction events
                    event = self._kafka_consumer.poll(self._config.poll_interval_ms)

                    if event is None:
                        # Timeout, no message received
                        self._polls_since_last_event += 1
                        if self._polls_since_last_event % 30 == 0:  # ~every 30s at 1000ms poll
                            logger.info(
                                "Consumer alive — waiting for conviction events (%d polls, no events yet)",
                                self._polls_since_last_event,
                            )
                        continue

                    self._polls_since_last_event = 0

                    # ===== PROCESS CONVICTION EVENT =====
                    # In production: route to trading strategies, update positions, etc.
                    # For now: just log/print the event
                    logger.info(
                        "CONVICTION EVENT RECEIVED: market_id=%s direction=%s magnitude=%.4f yes=%.2f no=%.2f",
                        event.get("market_id"),
                        event.get("conviction_direction"),
                        event.get("conviction_magnitude", 0.0),
                        event.get("yes_price", 0.0),
                        event.get("no_price", 0.0),
                    )

                    # Persist to Couchbase (atomic upsert per market + event history)
                    try:
                        self._couchbase.upsert_event(event)
                    except Exception as cb_exc:
                        logger.error("Failed to persist event to Couchbase: %s", cb_exc)

                    # Pretty print the full event
                    logger.info("Full event: %s", json.dumps(event, indent=2, default=str))

                except Exception as exc:
                    logger.error("Error processing event: %s", exc)
                    continue

        finally:
            logger.info("Runner stopping; closing Kafka consumer and Couchbase")
            self._kafka_consumer.close()
            self._couchbase.close()
