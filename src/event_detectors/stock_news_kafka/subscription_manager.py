from __future__ import annotations

import asyncio
import logging
from typing import Dict, List

import pymongo
from motor.motor_asyncio import AsyncIOMotorClient

from .config import MongoConfig
from .models import StockNewsSubscription

logger = logging.getLogger(__name__)


class SubscriptionManager:
    """Manages stock news subscriptions stored in MongoDB.

    Each document uses a ref_count field — subscription is active when ref_count > 0.
    Uses atomic $inc to avoid races between concurrent service instances.
    """

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
                    "min_hotness_score": 0.4,
                },
            },
            upsert=True,
        )
        logger.info("Subscribed to %s (ref_count incremented)", ticker)

    async def unsubscribe(self, ticker: str) -> None:
        result = await self._collection.update_one(
            {"ticker": ticker, "ref_count": {"$gt": 0}},
            {"$inc": {"ref_count": -1}},
        )
        if result.modified_count == 0:
            logger.warning("Unsubscribe no-op for %s (already 0 or not found)", ticker)

    async def get_active_subscriptions_async(self) -> List[StockNewsSubscription]:
        docs = await self._collection.find({"ref_count": {"$gt": 0}}).to_list(length=None)
        return [StockNewsSubscription(**doc) for doc in docs]

    async def close(self) -> None:
        self._client.close()
