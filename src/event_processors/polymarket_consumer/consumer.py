"""Polymarket consumer — reads raw snapshots, detects conviction shifts, writes to postgres."""
from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Optional

import asyncpg
import redis.asyncio as aioredis
from confluent_kafka import Consumer, KafkaError

logger = logging.getLogger(__name__)

# Conviction detection thresholds
DEFAULT_ABS_THRESHOLD = 0.10
DEFAULT_PCT_THRESHOLD = 0.20


@dataclass
class MarketState:
    last_yes_price: Optional[float] = None


class PolymarketConsumer:
    def __init__(
        self,
        bootstrap_servers: str,
        topic: str,
        group_id: str,
        database_url: str,
        redis_url: str,
    ) -> None:
        self._bootstrap_servers = bootstrap_servers
        self._topic = topic
        self._group_id = group_id
        self._database_url = database_url
        self._redis_url = redis_url
        self._states: Dict[str, MarketState] = {}
        self._pool: Optional[asyncpg.Pool] = None
        self._redis: Optional[aioredis.Redis] = None

    @classmethod
    def from_env(cls) -> "PolymarketConsumer":
        return cls(
            bootstrap_servers=os.environ["KAFKA_BOOTSTRAP_SERVERS"],
            topic=os.getenv("KAFKA_TOPIC", "raw.polymarket"),
            group_id=os.getenv("KAFKA_GROUP_ID", "polymarket-consumer"),
            database_url=os.environ["DATABASE_URL"],
            redis_url=os.getenv("REDIS_URL", "redis://redis:6379"),
        )

    async def run(self) -> None:
        self._pool = await asyncpg.create_pool(self._database_url, min_size=1, max_size=5)
        self._redis = aioredis.from_url(self._redis_url)

        consumer = Consumer({
            "bootstrap.servers": self._bootstrap_servers,
            "group.id": self._group_id,
            "auto.offset.reset": "latest",
            "enable.auto.commit": True,
        })
        consumer.subscribe([self._topic])
        logger.info("Polymarket consumer subscribed to %s", self._topic)

        try:
            while True:
                msg = consumer.poll(timeout=1.0)
                if msg is None:
                    continue
                if msg.error():
                    if msg.error().code() != KafkaError._PARTITION_EOF:
                        logger.error("Kafka error: %s", msg.error())
                    continue
                try:
                    await self._handle(json.loads(msg.value()))
                except Exception as exc:
                    logger.error("Failed to process message: %s", exc)
        finally:
            consumer.close()
            if self._pool:
                await self._pool.close()
            if self._redis:
                await self._redis.aclose()

    async def _handle(self, raw: dict) -> None:
        market_id = raw.get("market_id", "")
        yes_price = raw.get("yes_price")
        if yes_price is None:
            return

        state = self._states.setdefault(market_id, MarketState())
        prev = state.last_yes_price
        state.last_yes_price = yes_price

        if prev is None:
            return  # baseline set, no signal yet

        change_abs = abs(yes_price - prev)
        change_pct = change_abs / prev if prev > 0 else 0.0

        if change_abs < DEFAULT_ABS_THRESHOLD and change_pct < DEFAULT_PCT_THRESHOLD:
            return

        direction = "up" if yes_price > prev else "down"
        score = round(change_abs, 4)

        signal_id = str(uuid.uuid4())
        payload = {
            "market_id": market_id,
            "question": raw.get("question", ""),
            "yes_price": yes_price,
            "prev_yes_price": prev,
            "change_abs": round(change_abs, 4),
            "change_pct": round(change_pct, 4),
            "volume": raw.get("volume"),
            "liquidity": raw.get("liquidity"),
        }

        await self._pool.execute(
            """INSERT INTO signals (id, source, symbol, type, score, direction, payload, created_at)
               VALUES ($1, 'polymarket', $2, 'conviction_shift', $3, $4, $5, $6)""",
            uuid.UUID(signal_id),
            market_id,
            score,
            direction,
            json.dumps(payload),
            datetime.now(timezone.utc),
        )

        await self._redis.publish("new_signal", json.dumps({"signal_id": signal_id, "source": "polymarket", "symbol": market_id}))
        logger.info("Conviction shift: %s %.4f→%.4f (%s)", market_id[:16], prev, yes_price, direction)
