from __future__ import annotations

import logging
from typing import List

from motor.motor_asyncio import AsyncIOMotorClient

from .config import MongoConfig
from .models import StockAnalyticsSubscription

logger = logging.getLogger(__name__)


class SubscriptionManager:
    """Manages stock analytics subscriptions stored in MongoDB."""

    def __init__(self, config: MongoConfig) -> None:
        self._config = config
        self._client: AsyncIOMotorClient = AsyncIOMotorClient(config.uri)
        self._collection = self._client[config.database][config.collection]

    async def subscribe(self, ticker: str, company_name: str = "") -> None:
        await self._collection.update_one(
            {"ticker": ticker},
            {
                "$inc": {"ref_count": 1},
                "$setOnInsert": {
                    "ticker": ticker,
                    "company_name": company_name,
                    "min_volume_ratio": 2.0,
                    "min_price_change_pct": 5.0,
                    "rsi_overbought": 75.0,
                    "rsi_oversold": 25.0,
                },
            },
            upsert=True,
        )
        logger.info("Subscribed to analytics for %s", ticker)

    async def unsubscribe(self, ticker: str) -> None:
        result = await self._collection.update_one(
            {"ticker": ticker, "ref_count": {"$gt": 0}},
            {"$inc": {"ref_count": -1}},
        )
        if result.modified_count == 0:
            logger.warning("Unsubscribe no-op for %s", ticker)

    async def get_active_subscriptions_async(self) -> List[StockAnalyticsSubscription]:
        """Return one StockAnalyticsSubscription per unique ticker subscribed by any user.

        Reads BFF user-subscription docs (shape: { userId, tickers[] }) and
        aggregates unique tickers across all users.
        """
        try:
            cursor = self._collection.find(
                {"userId": {"$exists": True}, "tickers": {"$exists": True}},
                {"tickers": 1, "_id": 0},
            )
            docs = await cursor.to_list(length=None)
            tickers: set[str] = set()
            for doc in docs:
                tickers.update(doc.get("tickers", []))
            subs = [StockAnalyticsSubscription(ticker=t, ref_count=1) for t in tickers]
            logger.debug("Found %d unique subscribed tickers across all users", len(subs))
            return subs
        except Exception as exc:
            logger.error("Error fetching active subscriptions: %s", exc)
            return []

    async def close(self) -> None:
        self._client.close()
