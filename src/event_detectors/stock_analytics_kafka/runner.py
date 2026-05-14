from __future__ import annotations

import asyncio
import logging

from .config import AppConfig
from .data_source import YFinanceClient
from .event_builder import build_analytics_event, event_to_dict
from .kafka_client import KafkaClient
from .models import StockAnalyticsSubscription
from .signal_detector import AnalyticsState, detect_signals
from .subscription_manager import SubscriptionManager
from observability.metrics import cycle_timer, record_error, record_published_event, record_skipped_event

logger = logging.getLogger(__name__)


class StockAnalyticsKafkaRunner:
    """Main async runner: polls subscriptions → fetches OHLCV+options → detects signals → publishes."""

    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self._yfinance = YFinanceClient()
        self._kafka = KafkaClient(config.kafka)
        self._subscriptions = SubscriptionManager(config.mongodb)
        self._state = AnalyticsState(cooldown_hours=config.signal_cooldown_hours)
        self._fetch_semaphore = asyncio.Semaphore(max(1, config.max_concurrent_fetches))
        self._running = False

    async def _process_subscription(self, subscription: StockAnalyticsSubscription) -> None:
        ticker = subscription.ticker
        loop = asyncio.get_running_loop()

        async with self._fetch_semaphore:
            try:
                snapshot = await asyncio.wait_for(
                    loop.run_in_executor(None, self._yfinance.fetch_ticker_data, ticker),
                    timeout=self._config.fetch_timeout_seconds,
                )
            except asyncio.TimeoutError:
                record_skipped_event("stock-analytics-kafka", "fetch_timeout")
                logger.warning("Timed out fetching analytics snapshot for %s", ticker)
                return
        if snapshot is None:
            record_skipped_event("stock-analytics-kafka", "empty_snapshot")
            return

        signals = detect_signals(snapshot, subscription, self._state)
        for signal in signals:
            event = build_analytics_event(snapshot, signal, subscription)
            self._kafka.publish_event(event_to_dict(event), key=ticker)
            record_published_event("stock-analytics-kafka", "stock-analytics")
            logger.info(
                "Published analytics event: ticker=%s signal=%s strength=%.3f direction=%s",
                ticker,
                signal.signal_type.value,
                signal.signal_strength,
                signal.direction.value,
            )

        if signals:
            self._kafka.flush()

    async def run_once(self) -> None:
        subscriptions = await self._subscriptions.get_active_subscriptions_async()
        logger.info("Running analytics poll cycle: %d active subscriptions", len(subscriptions))
        tasks = [self._process_subscription(sub) for sub in subscriptions]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for res in results:
            if isinstance(res, Exception):
                record_error("stock-analytics-kafka", "process_subscription")
                logger.error("Error processing subscription: %s", res, exc_info=res)

    async def run(self) -> None:
        self._running = True
        logger.info(
            "StockAnalyticsKafkaRunner started (interval=%ds, cooldown=%.1fh)",
            self._config.poll_interval_seconds,
            self._config.signal_cooldown_hours,
        )
        while self._running:
            try:
                with cycle_timer("stock-analytics-kafka"):
                    await self.run_once()
            except Exception as exc:
                record_error("stock-analytics-kafka", "run_cycle")
                logger.exception("Unexpected error in run cycle: %s", exc)
            await asyncio.sleep(self._config.poll_interval_seconds)

    def stop(self) -> None:
        self._running = False
        self._kafka.flush()
