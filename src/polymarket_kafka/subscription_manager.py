from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List

import asyncio

from pymongo import MongoClient
from pymongo.collection import Collection

from .config import MongoConfig
from .models import PolymarketSubscription

logger = logging.getLogger(__name__)

@dataclass
class SubscriptionManager:
    """Manage Polymarket subscriptions stored in MongoDB."""

    mongo_config: MongoConfig

    def __post_init__(self) -> None:
        logger.info(
            "Connecting to MongoDB at %s database=%s collection=%s",
            self.mongo_config.uri,
            self.mongo_config.database,
            self.mongo_config.collection,
        )
        self._client = MongoClient(self.mongo_config.uri)
        collection_name = f"{self.mongo_config.collection_prefix}{self.mongo_config.collection}"
        self._collection: Collection = self._client[self.mongo_config.database][collection_name]
        logger.info("MongoDB connection established")

    @property
    def poll_interval_seconds(self) -> int:
        """Return the configured polling interval for subscriptions."""
        return self.mongo_config.poll_interval_seconds

    def _parse_subscription_doc(self, doc: dict) -> PolymarketSubscription:
        """Convert a MongoDB document into a PolymarketSubscription."""
        # Drop MongoDB's internal _id field so Pydantic doesn't reject it.
        data = {k: v for k, v in doc.items() if k != "_id"}
        return PolymarketSubscription(**data)

    def get_active_subscriptions(self) -> List[PolymarketSubscription]:
        """Fetch all subscriptions with ref_count > 0 (synchronous)."""
        try:
            cursor = self._collection.find({"ref_count": {"$gt": 0}})
            subs = [self._parse_subscription_doc(doc) for doc in cursor]
            logger.debug("Found %d active subscriptions", len(subs))
            return subs
        except Exception as exc:
            logger.error("Error fetching active subscriptions: %s", exc)
            raise

    async def get_active_subscriptions_async(self) -> List[PolymarketSubscription]:
        """Async wrapper for get_active_subscriptions, for use in the runner."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.get_active_subscriptions)

    def subscribe(self, market_id: str, **extra_fields: object) -> None:
        """Subscribe to a market via atomic $inc on ref_count.

        extra_fields can include optional configuration such as conviction thresholds.
        """
        now = datetime.now(timezone.utc)
        set_on_insert = {"created_at": now}
        if extra_fields:
            set_on_insert.update(extra_fields)

        update = {
            "$inc": {"ref_count": 1},
            "$setOnInsert": set_on_insert,
            "$set": {"updated_at": now},
        }
        self._collection.update_one({"market_id": market_id}, update, upsert=True)

    def unsubscribe(self, market_id: str) -> None:
        """Unsubscribe from a market via atomic $inc on ref_count."""
        now = datetime.now(timezone.utc)
        update = {
            "$inc": {"ref_count": -1},
            "$set": {"updated_at": now},
        }
        self._collection.update_one({"market_id": market_id}, update)

    def close(self) -> None:
        """Close the underlying MongoDB client."""
        self._client.close()