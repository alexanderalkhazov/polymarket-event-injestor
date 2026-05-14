"""Subscription fan-out helper.

Queries MongoDB to determine which users are subscribed to a given
market_id (polymarket) or ticker (stock-news / stock-analytics).

Used by all three event consumers to write one Couchbase document per
matching user instead of a single shared document.

MongoDB collections (written by the BFF):
  polymarket_subscriptions  — { userId, marketIds: [str] }
  stocksubscriptions        — { userId, tickers: [str] }
  news_subscriptions        — { userId, topics: [str] }   (future use)
"""

from __future__ import annotations

import logging
from typing import List, Optional

from motor.motor_asyncio import AsyncIOMotorClient

logger = logging.getLogger(__name__)

_DB_NAME = "Polystonker"  # same DB the BFF uses
_COL_POLYMARKET = "polymarket_subscriptions"
_COL_STOCKS = "stocksubscriptions"


class SubscriptionFanOut:
    """Async MongoDB query helper that maps an event signal back to subscribed user IDs."""

    def __init__(self, mongo_uri: str) -> None:
        self._client: AsyncIOMotorClient = AsyncIOMotorClient(mongo_uri)
        self._db = self._client[_DB_NAME]

    async def users_for_market(self, market_id: str) -> List[str]:
        """Return all userIds that have *market_id* in their polymarket subscription list."""
        try:
            cursor = self._db[_COL_POLYMARKET].find(
                {"marketIds": market_id},
                {"userId": 1, "_id": 0},
            )
            return [doc["userId"] async for doc in cursor if doc.get("userId")]
        except Exception as exc:
            logger.error("SubscriptionFanOut.users_for_market(%s) failed: %s", market_id, exc)
            return []

    async def users_for_ticker(self, ticker: str) -> List[str]:
        """Return all userIds that have *ticker* in their stock subscription list."""
        try:
            cursor = self._db[_COL_STOCKS].find(
                {"tickers": ticker},
                {"userId": 1, "_id": 0},
            )
            return [doc["userId"] async for doc in cursor if doc.get("userId")]
        except Exception as exc:
            logger.error("SubscriptionFanOut.users_for_ticker(%s) failed: %s", ticker, exc)
            return []

    async def close(self) -> None:
        self._client.close()
