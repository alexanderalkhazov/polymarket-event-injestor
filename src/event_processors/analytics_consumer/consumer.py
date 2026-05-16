"""Analytics consumer — reads raw ticker snapshots, detects signals, writes to postgres."""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional, Tuple

import asyncpg
import redis.asyncio as aioredis
from confluent_kafka import Consumer, KafkaError

logger = logging.getLogger(__name__)

VOLUME_SPIKE_RATIO = 2.0
PRICE_MOVE_PCT = 5.0
RSI_OVERBOUGHT = 75.0
RSI_OVERSOLD = 25.0
PC_RATIO_HIGH = 3.0
PC_RATIO_LOW = 0.33
COOLDOWN_HOURS = 4


class AnalyticsConsumer:
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
        # cooldown tracking: (ticker, signal_type) → last fired time
        self._cooldowns: Dict[Tuple[str, str], datetime] = {}
        self._pool: Optional[asyncpg.Pool] = None
        self._redis: Optional[aioredis.Redis] = None

    @classmethod
    def from_env(cls) -> "AnalyticsConsumer":
        return cls(
            bootstrap_servers=os.environ["KAFKA_BOOTSTRAP_SERVERS"],
            topic=os.getenv("KAFKA_TOPIC", "raw.analytics"),
            group_id=os.getenv("KAFKA_GROUP_ID", "analytics-consumer"),
            database_url=os.environ["DATABASE_URL"],
            redis_url=os.getenv("REDIS_URL", "redis://redis:6379"),
        )

    def _in_cooldown(self, ticker: str, signal_type: str) -> bool:
        key = (ticker, signal_type)
        last = self._cooldowns.get(key)
        if last is None:
            return False
        return (datetime.now(timezone.utc) - last).total_seconds() < COOLDOWN_HOURS * 3600

    def _set_cooldown(self, ticker: str, signal_type: str) -> None:
        self._cooldowns[(ticker, signal_type)] = datetime.now(timezone.utc)

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
        logger.info("Analytics consumer subscribed to %s", self._topic)

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
        ticker = raw.get("ticker", "")
        now = datetime.now(timezone.utc)

        signals = []

        # Volume spike
        cur_vol = raw.get("current_volume")
        avg_vol = raw.get("avg_volume_30d")
        if cur_vol and avg_vol and avg_vol > 0:
            ratio = cur_vol / avg_vol
            if ratio >= VOLUME_SPIKE_RATIO and not self._in_cooldown(ticker, "volume_spike"):
                signals.append(("volume_spike", ratio, None))
                self._set_cooldown(ticker, "volume_spike")

        # Price momentum
        chg = raw.get("price_change_1d_pct")
        if chg is not None and abs(chg) >= PRICE_MOVE_PCT and not self._in_cooldown(ticker, "momentum"):
            direction = "up" if chg > 0 else "down"
            signals.append(("momentum", abs(chg) / 100, direction))
            self._set_cooldown(ticker, "momentum")

        # RSI extreme
        rsi = raw.get("rsi_14")
        if rsi is not None and not self._in_cooldown(ticker, "rsi_extreme"):
            if rsi > RSI_OVERBOUGHT:
                signals.append(("rsi_extreme", rsi / 100, "up"))
                self._set_cooldown(ticker, "rsi_extreme")
            elif rsi < RSI_OVERSOLD:
                signals.append(("rsi_extreme", (100 - rsi) / 100, "down"))
                self._set_cooldown(ticker, "rsi_extreme")

        # Options unusual
        pcr = raw.get("put_call_ratio")
        if pcr is not None and not self._in_cooldown(ticker, "options_unusual"):
            if pcr >= PC_RATIO_HIGH or pcr <= PC_RATIO_LOW:
                direction = "down" if pcr >= PC_RATIO_HIGH else "up"
                signals.append(("options_unusual", pcr, direction))
                self._set_cooldown(ticker, "options_unusual")

        for signal_type, score, direction in signals:
            signal_id = str(uuid.uuid4())
            await self._pool.execute(
                """INSERT INTO signals (id, source, symbol, type, score, direction, payload, created_at)
                   VALUES ($1, 'analytics', $2, $3, $4, $5, $6, $7)""",
                uuid.UUID(signal_id),
                ticker,
                signal_type,
                float(score),
                direction,
                json.dumps(raw),
                now,
            )
            await self._redis.publish(
                "new_signal",
                json.dumps({"signal_id": signal_id, "source": "analytics", "symbol": ticker}),
            )
            logger.info("Analytics signal: %s %s score=%.3f dir=%s", ticker, signal_type, score, direction)
