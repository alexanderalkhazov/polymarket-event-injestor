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

logger = logging.getLogger(__name__)


class PolymarketKafkaRunner:
    """Main async polling loop that orchestrates subscriptions, API, conviction, and Kafka."""

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

        if not snapshot.active or snapshot.closed:
            logger.info("Market %s inactive or closed; skipping", market_id)
            return

        try:
            change = detect_conviction_change(sub, snapshot, state)
        except Exception as exc:
            logger.error("Conviction detection failed for %s: %s", market_id, exc)
            return

        if change is None:
            logger.debug("No significant conviction change for %s", market_id)
            return

        try:
            event = build_polymarket_event(snapshot, change)
            self._kafka_client.publish_event(event)
        except Exception as exc:
            logger.error("Failed to publish event for %s: %s", market_id, exc)

    async def run(self) -> None:
        """Main polling loop."""
        logger.info("Starting PolymarketKafkaRunner with poll interval %ss", self._config.poll_interval_seconds)
        try:
            while not self._stop_requested:
                try:
                    subscriptions = await self._subscription_manager.get_active_subscriptions_async()
                    logger.debug("Fetched %d active subscriptions", len(subscriptions))
                except Exception as exc:
                    logger.error("Failed to fetch active subscriptions: %s", exc)
                    subscriptions = []

                active_subs = [sub for sub in subscriptions if sub.is_active()]
                if not active_subs:
                    logger.debug("No active subscriptions, waiting %ds until next poll", self._config.poll_interval_seconds)
                else:
                    logger.info("Processing %d active subscription(s)", len(active_subs))

                    try:
                        snapshots = await self._data_source.fetch_all_markets_async()
                    except Exception as exc:
                        logger.error("Failed to fetch markets from Gamma API: %s", exc)
                        snapshots = {}

                    tasks = []
                    for sub in active_subs:
                        snapshot = snapshots.get(sub.market_id)
                        if snapshot is None:
                            logger.warning("Market %s not found in Gamma API response", sub.market_id)
                            continue
                        tasks.append(self._process_subscription(sub, snapshot))

                    if tasks:
                        await asyncio.gather(*tasks, return_exceptions=True)

                # Respect global poll interval for the whole cycle.
                await asyncio.sleep(self._config.poll_interval_seconds)
        finally:
            logger.info("Runner stopping; flushing Kafka and closing clients")
            self._kafka_client.flush()
            self._subscription_manager.close()
            self._data_source.close()
