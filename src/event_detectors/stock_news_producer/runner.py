from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict

from .config import AppConfig
from .data_source import FinnhubClient
from .event_builder import build_stock_news_event, event_to_dict
from .hotness_detector import NewsHotnessState, compute_hotness, is_hot
from .kafka_client import KafkaClient
from .models import StockNewsSubscription
from .subscription_manager import SubscriptionManager
from observability.metrics import cycle_timer, record_error, record_published_event, record_skipped_event

logger = logging.getLogger(__name__)


class StockNewsKafkaRunner:
    """Main async runner: polls subscriptions → fetches news → scores → publishes."""

    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self._finnhub = FinnhubClient(config.finnhub)
        self._kafka = KafkaClient(config.kafka)
        self._subscriptions = SubscriptionManager(config.mongodb)
        # Per-ticker hotness state (deduplication of seen article IDs)
        self._states: Dict[str, NewsHotnessState] = {}
        self._running = False

    def _get_state(self, ticker: str) -> NewsHotnessState:
        if ticker not in self._states:
            self._states[ticker] = NewsHotnessState()
        return self._states[ticker]

    async def _process_subscription(self, subscription: StockNewsSubscription) -> None:
        ticker = subscription.ticker
        state = self._get_state(ticker)
        now = datetime.now(timezone.utc)

        # Blocking Finnhub call offloaded to thread pool
        loop = asyncio.get_running_loop()
        articles = await loop.run_in_executor(
            None,
            self._finnhub.fetch_company_news,
            ticker,
            self._config.news_lookback_hours,
        )

        published = 0
        for article in articles:
            if state.is_seen(article.article_id):
                record_skipped_event("stock-news-kafka", "duplicate_article")
                continue

            age_hours = (now - article.published_at).total_seconds() / 3600
            hotness = compute_hotness(article, age_hours)

            if not is_hot(hotness, subscription.min_hotness_score):
                state.mark_seen(article.article_id)  # Mark so we don't re-score
                record_skipped_event("stock-news-kafka", "below_threshold")
                continue

            event = build_stock_news_event(article, hotness, subscription)
            self._kafka.publish_event(event_to_dict(event), key=ticker)
            record_published_event("stock-news-kafka", "stock-news")
            state.mark_seen(article.article_id)
            published += 1
            logger.info(
                "Published hot news event: ticker=%s score=%.3f headline=%r",
                ticker,
                hotness.score,
                article.headline[:80],
            )

        if published > 0:
            self._kafka.flush()

    async def run_once(self) -> None:
        """Run a single poll cycle over all active subscriptions."""
        subscriptions = await self._subscriptions.get_active_subscriptions_async()
        logger.info("Running poll cycle: %d active subscriptions", len(subscriptions))

        tasks = [self._process_subscription(sub) for sub in subscriptions]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for res in results:
            if isinstance(res, Exception):
                record_error("stock-news-kafka", "process_subscription")
                logger.error("Error processing subscription: %s", res, exc_info=res)

    async def run(self) -> None:
        """Poll indefinitely at the configured interval."""
        self._running = True
        logger.info(
            "StockNewsKafkaRunner started (interval=%ds, lookback=%dh)",
            self._config.poll_interval_seconds,
            self._config.news_lookback_hours,
        )
        while self._running:
            try:
                with cycle_timer("stock-news-kafka"):
                    await self.run_once()
            except Exception as exc:
                record_error("stock-news-kafka", "run_cycle")
                logger.exception("Unexpected error in run cycle: %s", exc)
            await asyncio.sleep(self._config.poll_interval_seconds)

    def stop(self) -> None:
        self._running = False
        self._kafka.flush()
