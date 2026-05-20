"""SEC 8-K consumer — writes filing signals to PostgreSQL and notifies Redis."""
from __future__ import annotations

import asyncio
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

COOLDOWN_HOURS = 6

# Items that imply a bullish bias.
# 2.02 (earnings) is intentionally excluded — direction depends on beat vs miss,
# which can only be determined by parsing the actual filing text.
_BULLISH_ITEMS = {"1.01"}
# Items that imply a bearish bias
_BEARISH_ITEMS = {"2.05", "5.02"}


def _detect_direction(item_numbers: list, filing_direction: Optional[str]) -> Optional[str]:
    """Determine signal direction from item numbers or producer-supplied hint."""
    if filing_direction in ("up", "down"):
        return filing_direction
    has_bullish = any(i in _BULLISH_ITEMS for i in item_numbers)
    has_bearish = any(i in _BEARISH_ITEMS for i in item_numbers)
    if has_bearish and not has_bullish:
        return "down"
    if has_bullish and not has_bearish:
        return "up"
    return None


class SECConsumer:
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
        # Cooldown: ticker -> last_signal_time
        self._cooldowns: Dict[str, datetime] = {}
        self._pool: Optional[asyncpg.Pool] = None
        self._redis: Optional[aioredis.Redis] = None

    @classmethod
    def from_env(cls) -> "SECConsumer":
        return cls(
            bootstrap_servers=os.environ["KAFKA_BOOTSTRAP_SERVERS"],
            topic=os.getenv("KAFKA_TOPIC", "raw.sec"),
            group_id=os.getenv("KAFKA_GROUP_ID", "sec-consumer"),
            database_url=os.environ["DATABASE_URL"],
            redis_url=os.getenv("REDIS_URL", "redis://redis:6379"),
        )

    def _in_cooldown(self, ticker: str) -> bool:
        last = self._cooldowns.get(ticker)
        return last is not None and (datetime.now(timezone.utc) - last).total_seconds() < COOLDOWN_HOURS * 3600

    def _set_cooldown(self, ticker: str) -> None:
        self._cooldowns[ticker] = datetime.now(timezone.utc)

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
        logger.info("SEC consumer subscribed to %s", self._topic)

        try:
            while True:
                msg = consumer.poll(timeout=1.0)
                # Yield to the event loop after each blocking poll so other async
                # tasks (DB writes, Redis publishes) can make progress.
                await asyncio.sleep(0)
                if msg is None:
                    continue
                if msg.error():
                    code = msg.error().code()
                    if code == KafkaError._PARTITION_EOF:
                        pass  # normal end-of-partition
                    elif code == KafkaError.UNKNOWN_TOPIC_OR_PART:
                        # Topic doesn't exist yet — producer hasn't published.
                        logger.debug("raw.sec topic not yet created — waiting for producer")
                        await asyncio.sleep(10)
                    else:
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
        if not ticker:
            return

        if self._in_cooldown(ticker):
            logger.debug("SEC signal for %s suppressed (cooldown)", ticker)
            return

        score: float = float(raw.get("score", 0.30))
        urgency: str = raw.get("urgency", "low")
        item_numbers: list = raw.get("item_numbers", [])
        direction = _detect_direction(item_numbers, raw.get("direction"))

        now = datetime.now(timezone.utc)
        signal_id = str(uuid.uuid4())

        payload = {
            **raw,
            "signal_score": score,
            "urgency": urgency,
        }

        # The signals table CHECK constraint allows: 'polymarket', 'news', 'analytics'.
        # SEC filings are categorised as 'news' since they are news-type events and
        # we cannot alter the DB schema in this service.
        await self._pool.execute(
            """INSERT INTO signals (id, source, symbol, type, score, direction, payload, created_at)
               VALUES ($1, 'news', $2, 'sec_filing', $3, $4, $5, $6)""",
            uuid.UUID(signal_id),
            ticker,
            score,
            direction,
            json.dumps(payload),
            now,
        )

        await self._redis.publish(
            "new_signal",
            json.dumps({"signal_id": signal_id, "source": "news", "symbol": ticker}),
        )

        self._set_cooldown(ticker)
        logger.info(
            "SEC signal: %s items=%s score=%.2f urgency=%s dir=%s company=%s",
            ticker, item_numbers, score, urgency, direction,
            raw.get("company_name", ""),
        )
