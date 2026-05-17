"""Polymarket consumer — probabilistic conviction scoring from market snapshots."""
from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

import time

import asyncpg
import redis.asyncio as aioredis
from confluent_kafka import Consumer, KafkaError

from event_detectors.polymarket_producer.sentiment import CATEGORIES as SENTIMENT_CATEGORIES

# Build a quick keyword→tickers lookup from shared sentiment definitions
_KEYWORD_TICKERS: list[tuple[str, list[str]]] = []
for _cat in SENTIMENT_CATEGORIES:
    for _kw in _cat.keywords:
        _KEYWORD_TICKERS.append((_kw, _cat.related_tickers))

logger = logging.getLogger(__name__)

# Quality gates — keep only meaningful conviction moves
MIN_SIGNAL_SCORE = 0.40   # was 0.10; score formula: abs*5 + pct*1.5, so 0.40 = ~8pp abs move
MIN_LIQUIDITY    = 2_000  # ignore thin markets (< $2k liquidity)
MARKET_COOLDOWN_S = 7_200  # 2 hours between signals for the same market


def _score_conviction(
    change_abs: float, change_pct: float, volume: Optional[float]
) -> Tuple[float, str, list]:
    score = min(1.0, change_abs * 5.0 + change_pct * 1.5)
    if volume and volume > 200_000:
        score = min(1.0, score * 1.15)
    elif volume and volume > 50_000:
        score = min(1.0, score * 1.05)
    score = round(score, 4)
    urgency = "high" if score >= 0.70 else "medium" if score >= 0.50 else "low"
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
        self._last_signal_ts: Dict[str, float] = {}  # market_id → last signal time
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

        # Conviction detection
        state = self._states.setdefault(market_id, MarketState())
        prev = state.last_yes_price
        state.last_yes_price = yes_price

        if prev is None:
            return

        change_abs = abs(yes_price - prev)
        change_pct = change_abs / prev if prev > 0 else 0.0

        # Only persist price ticks that actually moved — avoids writing every poll snapshot
        if change_abs >= 0.001:
            try:
                await self._tsdb.execute(
                    """INSERT INTO raw_polymarket (ts, market_id, symbol, yes_price, volume_24h)
                       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING""",
                    ts, market_id, market_id, yes_price, raw.get("volume"),
                )
            except Exception as exc:
                logger.warning("raw_polymarket write failed: %s", exc)

        signal_score, urgency, ci = _score_conviction(
            change_abs, change_pct, raw.get("volume")
        )
        if signal_score < MIN_SIGNAL_SCORE:
            return

        # Skip thin markets
        liquidity = raw.get("liquidity") or 0
        if liquidity < MIN_LIQUIDITY:
            return

        # Per-market cooldown
        now_ts = time.time()
        if now_ts - self._last_signal_ts.get(market_id, 0) < MARKET_COOLDOWN_S:
            return
        self._last_signal_ts[market_id] = now_ts

        question = raw.get("question", "")
        question_lower = question.lower()

        # Only fire a tradeable signal when the question maps to real instruments.
        # Unmapped markets (sports, celebrity, politics without clear ticker) are
        # handled exclusively via the macro sentiment cache — not as trade signals.
        matched_tickers: list[str] = []
        for kw, tickers in _KEYWORD_TICKERS:
            if kw in question_lower:
                for t in tickers:
                    if t not in matched_tickers:
                        matched_tickers.append(t)
                break  # first match wins

        if not matched_tickers:
            logger.debug("No ticker mapping for market %s — skipping signal", market_id[:16])
            return

        # Correct direction: rising YES on "recession" = bearish equities (sell),
        # but rising YES on "bitcoin hits $100k" = bullish (buy).
        # We can't perfectly infer this here, so we store the raw yes_price direction
        # and let the correlator + Claude interpret it with the question context.
        yes_direction = "up" if yes_price > prev else "down"

        signal_id = str(uuid.uuid4())
        payload = {
            "market_id": market_id,
            "question": question,
            "yes_price": yes_price,
            "prev_yes_price": prev,
            "change_abs": round(change_abs, 4),
            "change_pct": round(change_pct, 4),
            "volume": raw.get("volume"),
            "liquidity": raw.get("liquidity"),
            "signal_score": signal_score,
            "urgency": urgency,
            "confidence_interval": ci,
            "matched_tickers": matched_tickers,
        }

        # Use the primary matched ticker as the signal symbol so the backtester can
        # look up real historical data for it (instead of the hex market ID).
        primary_ticker = matched_tickers[0]

        await self._pool.execute(
            """INSERT INTO signals (id, source, symbol, type, score, direction, payload, created_at)
               VALUES ($1, 'polymarket', $2, 'conviction_shift', $3, $4, $5, $6)""",
            uuid.UUID(signal_id),
            primary_ticker,
            signal_score,
            yes_direction,
            json.dumps(payload),
            ts,
        )
        await self._redis.publish(
            "new_signal",
            json.dumps({"signal_id": signal_id, "source": "polymarket", "symbol": primary_ticker}),
        )
        logger.info(
            "Conviction shift: %s %.4f→%.4f score=%.3f tickers=%s",
            market_id[:16], prev, yes_price, signal_score, matched_tickers,
        )
