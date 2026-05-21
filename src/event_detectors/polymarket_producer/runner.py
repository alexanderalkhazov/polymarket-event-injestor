"""Polymarket producer — fetch all active markets, publish raw to Kafka + cache sentiment in Redis."""
from __future__ import annotations

import asyncio
import json
import logging

import redis.asyncio as aioredis
from confluent_kafka import Producer

from .config import AppConfig
from .data_source import PolymarketClient
from .sentiment import REDIS_KEY, REDIS_TTL, compute_sentiment

logger = logging.getLogger(__name__)


class PolymarketProducer:
    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self._client = PolymarketClient(config.polymarket)
        self._producer = Producer({"bootstrap.servers": config.kafka_bootstrap_servers})
        self._redis: aioredis.Redis | None = None

    async def start(self) -> None:
        self._redis = aioredis.from_url(self._config.redis_url)
        logger.info("Polymarket producer started (topic=%s)", self._config.kafka_topic)
        try:
            while True:
                await self._poll()
                await asyncio.sleep(self._config.poll_interval_seconds)
        finally:
            self._producer.flush()
            self._client.close()
            if self._redis:
                await self._redis.aclose()

    async def _poll(self) -> None:
        loop = asyncio.get_running_loop()
        snapshots = await loop.run_in_executor(None, self._client.fetch_all_markets)
        logger.info("Fetched %d Polymarket snapshots", len(snapshots))

        # Publish raw events to Kafka
        for market_id, snap in snapshots.items():
            payload = {
                "market_id": snap.market_id,
                "question": snap.question,
                "yes_price": snap.yes_price,
                "no_price": snap.no_price,
                "volume": snap.volume,
                "liquidity": snap.liquidity,
                "active": snap.active,
                "closed": snap.closed,
                "fetched_at": snap.fetched_at.isoformat(),
            }
            self._producer.produce(
                topic=self._config.kafka_topic,
                key=market_id,
                value=json.dumps(payload).encode(),
            )
        self._producer.poll(0)

        # Compute macro sentiment and cache in Redis for the correlator
        try:
            sentiment = compute_sentiment(snapshots)
            if sentiment and self._redis:
                await self._redis.setex(REDIS_KEY, REDIS_TTL, json.dumps(sentiment))
                logger.info(
                    "Cached Polymarket macro sentiment: %d categories",
                    len(sentiment),
                )
        except Exception as exc:
            logger.warning("Sentiment cache write failed: %s", exc)
