"""Analytics consumer — probabilistic signal scoring from raw ticker snapshots."""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple

import asyncpg
import redis.asyncio as aioredis
from confluent_kafka import Consumer, KafkaError

logger = logging.getLogger(__name__)

COOLDOWN_HOURS = 4
MIN_SIGNAL_SCORE = 0.15

VOLUME_SPIKE_RATIO = 1.8
PRICE_MOVE_PCT = 4.0
RSI_OVERBOUGHT = 72.0
RSI_OVERSOLD = 28.0
PC_RATIO_HIGH = 2.5
PC_RATIO_LOW = 0.40


def _score_volume(ratio: float) -> Tuple[float, str, list]:
    score = round(min(1.0, (ratio - 1.0) / 6.0), 4)
    urgency = "high" if score >= 0.6 else "medium" if score >= 0.3 else "low"
    ci = [round(max(0.0, score - 0.10), 3), round(min(1.0, score + 0.10), 3)]
    return score, urgency, ci


def _score_momentum(pct: float) -> Tuple[float, str, list]:
    score = round(min(1.0, abs(pct) / 20.0), 4)
    urgency = "high" if abs(pct) >= 10 else "medium" if abs(pct) >= 5 else "low"
    ci = [round(max(0.0, score - 0.08), 3), round(min(1.0, score + 0.08), 3)]
    return score, urgency, ci


def _score_rsi(rsi: float) -> Tuple[float, str, list]:
    distance = round(abs(rsi - 50.0) / 50.0, 4)
    urgency = "high" if distance >= 0.60 else "medium" if distance >= 0.40 else "low"
    ci = [round(max(0.0, distance - 0.05), 3), round(min(1.0, distance + 0.05), 3)]
    return distance, urgency, ci


def _score_options(pcr: float) -> Tuple[float, str, list]:
    score = round(min(1.0, abs(pcr - 1.0) / 4.0), 4)
    urgency = "high" if score >= 0.6 else "medium" if score >= 0.3 else "low"
    ci = [round(max(0.0, score - 0.12), 3), round(min(1.0, score + 0.12), 3)]
    return score, urgency, ci


class AnalyticsConsumer:
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
        self._cooldowns: Dict[Tuple[str, str], datetime] = {}
        self._pool: Optional[asyncpg.Pool] = None
        self._tsdb: Optional[asyncpg.Pool] = None
        self._redis: Optional[aioredis.Redis] = None

    @classmethod
    def from_env(cls) -> "AnalyticsConsumer":
        return cls(
            bootstrap_servers=os.environ["KAFKA_BOOTSTRAP_SERVERS"],
            topic=os.getenv("KAFKA_TOPIC", "raw.analytics"),
            group_id=os.getenv("KAFKA_GROUP_ID", "analytics-consumer"),
            database_url=os.environ["DATABASE_URL"],
            timescale_url=os.environ["TIMESCALE_URL"],
            redis_url=os.getenv("REDIS_URL", "redis://redis:6379"),
        )

    def _in_cooldown(self, ticker: str, signal_type: str) -> bool:
        last = self._cooldowns.get((ticker, signal_type))
        return last is not None and (datetime.now(timezone.utc) - last).total_seconds() < COOLDOWN_HOURS * 3600

    def _set_cooldown(self, ticker: str, signal_type: str) -> None:
        self._cooldowns[(ticker, signal_type)] = datetime.now(timezone.utc)

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
            if self._tsdb:
                await self._tsdb.close()
            if self._redis:
                await self._redis.aclose()

    async def _handle(self, raw: dict) -> None:
        ticker = raw.get("ticker", "")
        now = datetime.now(timezone.utc)

        ts = now
        if raw.get("fetched_at"):
            try:
                ts = datetime.fromisoformat(raw["fetched_at"])
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
            except ValueError:
                pass

        # Write price snapshot to raw_ohlcv (close + volume; open/high/low from historical ingestor)
        current_price = raw.get("current_price")
        current_volume = raw.get("current_volume")
        if current_price is not None and current_volume is not None:
            try:
                await self._tsdb.execute(
                    """INSERT INTO raw_ohlcv (ts, symbol, interval, close, volume)
                       VALUES ($1, $2, '1h', $3, $4) ON CONFLICT DO NOTHING""",
                    ts, ticker, current_price, int(current_volume),
                )
            except Exception as exc:
                logger.warning("raw_ohlcv write failed: %s", exc)

        # Write options snapshot to raw_options
        put_vol = raw.get("put_volume")
        call_vol = raw.get("call_volume")
        if put_vol is not None or call_vol is not None:
            try:
                await self._tsdb.execute(
                    """INSERT INTO raw_options (ts, symbol, put_volume, call_volume, unusual_sweeps)
                       VALUES ($1, $2, $3, $4, 0) ON CONFLICT DO NOTHING""",
                    ts, ticker, put_vol, call_vol,
                )
            except Exception as exc:
                logger.warning("raw_options write failed: %s", exc)

        # Signal detection
        signals: List[Tuple[str, float, str, list, Optional[str]]] = []

        # Price change is used for both momentum signal and volume-spike direction
        chg = raw.get("price_change_1d_pct")

        cur_vol = raw.get("current_volume")
        avg_vol = raw.get("avg_volume_30d")
        if cur_vol and avg_vol and avg_vol > 0:
            ratio = cur_vol / avg_vol
            if ratio >= VOLUME_SPIKE_RATIO and not self._in_cooldown(ticker, "volume_spike"):
                score, urgency, ci = _score_volume(ratio)
                if score >= MIN_SIGNAL_SCORE:
                    # Use price direction to classify the volume spike
                    vol_dir = "up" if (chg or 0) >= 0 else "down"
                    signals.append(("volume_spike", score, urgency, ci, vol_dir))
                    self._set_cooldown(ticker, "volume_spike")

        if chg is not None and abs(chg) >= PRICE_MOVE_PCT and not self._in_cooldown(ticker, "momentum"):
            score, urgency, ci = _score_momentum(chg)
            if score >= MIN_SIGNAL_SCORE:
                direction = "up" if chg > 0 else "down"
                signals.append(("momentum", score, urgency, ci, direction))
                self._set_cooldown(ticker, "momentum")

        rsi = raw.get("rsi_14")
        if rsi is not None and not self._in_cooldown(ticker, "rsi_extreme"):
            if rsi > RSI_OVERBOUGHT or rsi < RSI_OVERSOLD:
                score, urgency, ci = _score_rsi(rsi)
                if score >= MIN_SIGNAL_SCORE:
                    # Oversold (low RSI) = bullish setup; overbought (high RSI) = bearish
                    direction = "up" if rsi < RSI_OVERSOLD else "down"
                    signals.append(("rsi_extreme", score, urgency, ci, direction))
                    self._set_cooldown(ticker, "rsi_extreme")

        pcr = raw.get("put_call_ratio")
        if pcr is not None and not self._in_cooldown(ticker, "options_unusual"):
            if pcr >= PC_RATIO_HIGH or pcr <= PC_RATIO_LOW:
                score, urgency, ci = _score_options(pcr)
                if score >= MIN_SIGNAL_SCORE:
                    direction = "down" if pcr >= PC_RATIO_HIGH else "up"
                    signals.append(("options_unusual", score, urgency, ci, direction))
                    self._set_cooldown(ticker, "options_unusual")

        for signal_type, score, urgency, ci, direction in signals:
            signal_id = str(uuid.uuid4())
            payload = {
                **raw,
                "signal_score": score,
                "urgency": urgency,
                "confidence_interval": ci,
            }
            await self._pool.execute(
                """INSERT INTO signals (id, source, symbol, type, score, direction, payload, created_at)
                   VALUES ($1, 'analytics', $2, $3, $4, $5, $6, $7)""",
                uuid.UUID(signal_id),
                ticker,
                signal_type,
                score,
                direction,
                json.dumps(payload),
                now,
            )
            await self._redis.publish(
                "new_signal",
                json.dumps({"signal_id": signal_id, "source": "analytics", "symbol": ticker}),
            )
            logger.info(
                "Analytics signal: %s %s score=%.3f urgency=%s dir=%s",
                ticker, signal_type, score, urgency, direction,
            )
