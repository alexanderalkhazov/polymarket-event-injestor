from __future__ import annotations

import asyncio
import logging
from typing import Dict

from .config import AppConfig
from .conviction import ConvictionState, detect_conviction_change
from .data_source import MarketSnapshot, PolymarketClient
from .event_builder import build_polymarket_event
from .kafka_client import KafkaClient
from .models import PolymarketSubscription
from .subscription_manager import SubscriptionManager
from observability.metrics import cycle_timer, record_error, record_published_event

logger = logging.getLogger(__name__)


class PolymarketKafkaRunner:
    """Main async polling loop that orchestrates subscriptions, API, conviction, and Kafka.
    
    ===== FULL DATA FLOW =====
    1. Poll MongoDB for active subscriptions (ref_count > 0)
    2. Fetch market snapshots from Polymarket CLOB API
    3. Detect conviction changes (your detection logic in conviction.py)
    4. PUBLISH conviction events to Kafka (producer side)
    5. Downstream: strategy-host CONSUMES events from Kafka (consumer side)
    
    This service is the PRODUCER. It publishes. Consumers subscribe elsewhere.
    """

    def __init__(
        self,
        config: AppConfig,
        subscription_manager: SubscriptionManager,
        data_source: PolymarketClient,
        kafka_client: KafkaClient,
    ) -> None:
        self._config = config
        self._subscription_manager = subscription_manager
        self._data_source = data_source
        self._kafka_client = kafka_client
        self._stop_requested = False
        self._states: Dict[str, ConvictionState] = {}

    def request_stop(self) -> None:
        """Signal the runner to stop after the current iteration."""
        logger.info("Stop requested for PolymarketKafkaRunner")
        self._stop_requested = True

    async def _process_subscription(
        self,
        sub: PolymarketSubscription,
        snapshot: MarketSnapshot,
    ) -> None:
        """Process a single subscription with an already-fetched market snapshot."""
        market_id = sub.market_id
        state = self._states.setdefault(market_id, ConvictionState())

        logger.debug("Processing market %s (active=%s, closed=%s)", market_id, snapshot.active, snapshot.closed)

        try:
            change = detect_conviction_change(sub, snapshot, state)
        except Exception as exc:
            record_error("polymarket-kafka", "conviction_detection")
            logger.error("Conviction detection failed for %s: %s", market_id, exc)
            return

        if change is None:
            # Log price delta for visibility even when no conviction fires
            prev = state.last_yes_price
            if prev is not None:
                delta = abs(snapshot.yes_price - prev)
                logger.info(
                    "No conviction for %s: yes=%.4f prev=%.4f delta=%.4f (need >=%.2f abs or >=%.0f%% rel)",
                    sub.slug or market_id[:16],
                    snapshot.yes_price,
                    prev,
                    delta,
                    sub.conviction_threshold or 0.10,
                    (sub.conviction_threshold_pct or 0.20) * 100,
                )
            else:
                logger.info("Baseline set for %s: yes=%.4f", sub.slug or market_id[:16], snapshot.yes_price)
            return

        try:
            event = build_polymarket_event(snapshot, change)
            # ===== PUBLISH TO KAFKA (PRODUCER SIDE) =====
            # Event is published to 'polymarket-events' topic with partition key = market_id
            # Consumed downstream by strategy-host and other subscribers
            self._kafka_client.publish_event(event)
            record_published_event("polymarket-kafka", "polymarket")
        except Exception as exc:
            record_error("polymarket-kafka", "publish_event")
            logger.error("Failed to publish event for %s: %s", market_id, exc)

    async def run(self) -> None:
        """Main polling loop."""
        logger.info("Starting PolymarketKafkaRunner with poll interval %ss", self._config.poll_interval_seconds)
        try:
            while not self._stop_requested:
                with cycle_timer("polymarket-kafka"):
                    try:
                        subscriptions = await self._subscription_manager.get_active_subscriptions_async()
                        logger.debug("Fetched %d active subscriptions", len(subscriptions))
                    except Exception as exc:
                        record_error("polymarket-kafka", "fetch_subscriptions")
                        logger.error("Failed to fetch active subscriptions: %s", exc)
                        subscriptions = []

                    active_subs = [sub for sub in subscriptions if sub.is_active()]
                    if not active_subs:
                        logger.debug("No active subscriptions, waiting %ds until next poll", self._config.poll_interval_seconds)
                    else:
                        logger.info("Processing %d active subscription(s)", len(active_subs))

                        # Targeted fetch: look up only the markets users are subscribed to.
                        # This avoids the Gamma API pagination limit (100/page) causing most
                        # subscriptions to be silently unmatched when fetching all markets.
                        market_ids = [sub.market_id for sub in active_subs]
                        try:
                            snapshots = await self._data_source.fetch_markets_by_ids_async(market_ids)
                            logger.info("Fetched %d/%d market snapshots by conditionId", len(snapshots), len(market_ids))
                        except Exception as exc:
                            record_error("polymarket-kafka", "fetch_markets")
                            logger.error("Failed to fetch markets from Polymarket API: %s", exc)
                            snapshots = {}

                        matched = 0
                        tasks = []
                        for sub in active_subs:
                            snapshot = snapshots.get(sub.market_id)
                            if snapshot is None:
                                logger.debug("No snapshot for market %s", sub.market_id)
                                continue
                            matched += 1
                            tasks.append(self._process_subscription(sub, snapshot))

                        logger.info("Matched %d/%d subscriptions to API snapshots", matched, len(active_subs))

                        if tasks:
                            await asyncio.gather(*tasks, return_exceptions=True)

                # Respect global poll interval for the whole cycle.
                await asyncio.sleep(self._config.poll_interval_seconds)
        finally:
            logger.info("Runner stopping; flushing Kafka and closing clients")
            self._kafka_client.flush()
            self._subscription_manager.close()
            self._data_source.close()
