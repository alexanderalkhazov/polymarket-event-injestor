"""Polymarket consumer — probabilistic conviction scoring from market snapshots."""
from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

import asyncpg
import redis.asyncio as aioredis
from confluent_kafka import Consumer, KafkaError

logger = logging.getLogger(__name__)

MIN_SIGNAL_SCORE = 0.10


def _score_conviction(
    change_abs: float, change_pct: float, volume: Optional[float]
) -> Tuple[float, str, list]:
    score = min(1.0, change_abs * 5.0 + change_pct * 1.5)
    if volume and volume > 200_000:
        score = min(1.0, score * 1.15)
    elif volume and volume > 50_000:
        score = min(1.0, score * 1.05)
    score = round(score, 4)
    urgency = "high" if score >= 0.60 else "medium" if score >= 0.35 else "low"
    ci = [round(max(0.0, score - 0.12), 3), round(min(1.0, score + 0.12), 3)]
    return score, urgency, ci


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
        timescale_url: str,
        redis_url: str,
    ) -> None:
        self._bootstrap_servers = bootstrap_servers
        self._topic = topic
        self._group_id = group_id
        self._database_url = database_url
        self._timescale_url = timescale_url
        self._redis_url = redis_url
        self._states: Dict[str, MarketState] = {}
        self._pool: Optional[asyncpg.Pool] = None
        self._tsdb: Optional[asyncpg.Pool] = None
        self._redis: Optional[aioredis.Redis] = None

    @classmethod
    def from_env(cls) -> "PolymarketConsumer":
        return cls(
            bootstrap_servers=os.environ["KAFKA_BOOTSTRAP_SERVERS"],
            topic=os.getenv("KAFKA_TOPIC", "raw.polymarket"),
            group_id=os.getenv("KAFKA_GROUP_ID", "polymarket-consumer"),
            database_url=os.environ["DATABASE_URL"],
            timescale_url=os.environ["TIMESCALE_URL"],
            redis_url=os.getenv("REDIS_URL", "redis://redis:6379"),
        )

    async def run(self) -> None:
        self._pool = await asyncpg.create_pool(self._database_url, min_size=1, max_size=5)
        self._tsdb = await asyncpg.create_pool(self._timescale_url, min_size=1, max_size=3)
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
            if self._tsdb:
                await self._tsdb.close()
            if self._redis:
                await self._redis.aclose()

    async def _handle(self, raw: dict) -> None:
        market_id = raw.get("market_id", "")
        yes_price = raw.get("yes_price")
        if yes_price is None:
            return

        ts = datetime.now(timezone.utc)
        if raw.get("fetched_at"):
            try:
                ts = datetime.fromisoformat(raw["fetched_at"])
            except ValueError:
                pass

        # Write every event to TimescaleDB (raw store)
        try:
            await self._tsdb.execute(
                """INSERT INTO raw_polymarket (ts, market_id, symbol, yes_price, volume_24h)
                   VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING""",
                ts, market_id, market_id, yes_price, raw.get("volume"),
            )
        except Exception as exc:
            logger.warning("raw_polymarket write failed: %s", exc)

        # Conviction detection
        state = self._states.setdefault(market_id, MarketState())
        prev = state.last_yes_price
        state.last_yes_price = yes_price

        if prev is None:
            return

        change_abs = abs(yes_price - prev)
        change_pct = change_abs / prev if prev > 0 else 0.0

        signal_score, urgency, ci = _score_conviction(
            change_abs, change_pct, raw.get("volume")
        )
        if signal_score < MIN_SIGNAL_SCORE:
            return

        direction = "up" if yes_price > prev else "down"
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
            "signal_score": signal_score,
            "urgency": urgency,
            "confidence_interval": ci,
        }

        await self._pool.execute(
            """INSERT INTO signals (id, source, symbol, type, score, direction, payload, created_at)
               VALUES ($1, 'polymarket', $2, 'conviction_shift', $3, $4, $5, $6)""",
            uuid.UUID(signal_id),
            market_id,
            signal_score,
            direction,
            json.dumps(payload),
            ts,
        )
        await self._redis.publish(
            "new_signal",
            json.dumps({"signal_id": signal_id, "source": "polymarket", "symbol": market_id}),
        )
        logger.info(
            "Conviction shift: %s %.4f→%.4f score=%.3f urgency=%s",
            market_id[:16], prev, yes_price, signal_score, urgency,
        )
