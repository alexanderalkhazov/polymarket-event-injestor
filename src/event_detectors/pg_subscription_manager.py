"""Shared PostgreSQL-backed subscription reader for all producers."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import List, Optional

import asyncpg

logger = logging.getLogger(__name__)


@dataclass
class Subscription:
    symbol: str          # market_id for polymarket, ticker for news/analytics
    source: str          # 'polymarket' | 'news' | 'analytics'
    threshold: Optional[float] = None


class PgSubscriptionManager:
    """Reads active subscriptions from PostgreSQL subscriptions table."""

    def __init__(self, database_url: str, source: str, poll_interval_seconds: int = 60) -> None:
        self._database_url = database_url
        self._source = source
        self._poll_interval = poll_interval_seconds
        self._pool: Optional[asyncpg.Pool] = None
        self._cache: List[Subscription] = []

    async def connect(self) -> None:
        self._pool = await asyncpg.create_pool(self._database_url, min_size=1, max_size=3)
        logger.info("PgSubscriptionManager connected (source=%s)", self._source)

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()

    async def get_symbols(self) -> List[Subscription]:
        """Return all distinct symbols for this source from the subscriptions table."""
        if not self._pool:
            raise RuntimeError("Not connected — call connect() first")
        try:
            rows = await self._pool.fetch(
                "SELECT DISTINCT symbol, threshold FROM subscriptions WHERE source=$1",
                self._source,
            )
            self._cache = [
                Subscription(symbol=r["symbol"], source=self._source, threshold=r["threshold"])
                for r in rows
            ]
            logger.debug("Fetched %d subscriptions for source=%s", len(self._cache), self._source)
        except Exception as exc:
            logger.error("Failed to fetch subscriptions: %s. Using cached list.", exc)
        return self._cache
