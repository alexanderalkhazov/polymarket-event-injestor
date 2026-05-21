"""News consumer — probabilistic signal scoring from raw articles."""
from __future__ import annotations

import json
import logging
import math
import os
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set

import asyncpg
import redis.asyncio as aioredis
from confluent_kafka import Consumer, KafkaError

logger = logging.getLogger(__name__)

_CREDIBILITY: Dict[str, float] = {
    "reuters": 1.00, "bloomberg": 1.00,
    "financial times": 0.95, "ft": 0.95,
    "wall street journal": 0.95, "wsj": 0.95,
    "cnbc": 0.85, "marketwatch": 0.80, "the motley fool": 0.65,
}

_HOT_KEYWORDS = [
    "earnings beat", "earnings miss", "merger", "acquisition", "takeover",
    "fda approval", "fda approved", "bankruptcy", "chapter 11", "layoffs",
    "ceo resign", "ceo fired", "short squeeze", "analyst upgrade", "analyst downgrade",
    "record revenue", "record profit", "raises guidance", "lowers guidance",
    "surges", "plunges", "crashes", "soars", "spikes",
]

_BULLISH_KW = {
    "earnings beat", "merger", "acquisition", "takeover", "fda approval",
    "fda approved", "analyst upgrade", "record revenue", "record profit",
    "raises guidance", "short squeeze", "buyback", "dividend increase",
    "surges", "soars", "spikes", "breakthrough", "record high",
}
_BEARISH_KW = {
    "earnings miss", "bankruptcy", "chapter 11", "layoffs", "ceo resign",
    "ceo fired", "analyst downgrade", "lowers guidance", "plunges", "crashes",
    "recall", "fraud", "investigation", "shortfall", "loss widens",
    "fda reject", "downgrade", "guidance cut", "restructuring",
}

MIN_SIGNAL_SCORE = 0.20


def _detect_direction(article: dict) -> Optional[str]:
    text = (article.get("headline", "") + " " + article.get("summary", "")).lower()
    bull = sum(1 for kw in _BULLISH_KW if kw in text)
    bear = sum(1 for kw in _BEARISH_KW if kw in text)
    if bear > bull:  return "down"
    if bull > bear:  return "up"
    return None


def _score_signal(article: dict, now: datetime) -> Tuple[float, str, list]:
    published_at = datetime.fromisoformat(article.get("published_at", now.isoformat()))
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=timezone.utc)
    age_hours = max(0, (now - published_at).total_seconds() / 3600)
    recency = math.exp(-0.693 * age_hours / 4)  # half-life 4h

    source = article.get("source_name", "").lower()
    credibility = next((v for k, v in _CREDIBILITY.items() if k in source), 0.55)

    text = (article.get("headline", "") + " " + article.get("summary", "")).lower()
    keyword_hits = sum(1 for kw in _HOT_KEYWORDS if kw in text)
    keyword_mult = min(2.0, 1.0 + keyword_hits * 0.25)

    score = round(recency * credibility * keyword_mult, 4)
    ci_half = round(0.08 + (1.0 - credibility) * 0.12, 3)
    ci = [round(max(0.0, score - ci_half), 3), round(min(1.0, score + ci_half), 3)]

    urgency = "high" if score >= 0.70 else "medium" if score >= 0.40 else "low"
    return score, urgency, ci


class NewsConsumer:
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
        self._seen_articles: Set[str] = set()
        self._pool: Optional[asyncpg.Pool] = None
        self._tsdb: Optional[asyncpg.Pool] = None
        self._redis: Optional[aioredis.Redis] = None

    @classmethod
    def from_env(cls) -> "NewsConsumer":
        return cls(
            bootstrap_servers=os.environ["KAFKA_BOOTSTRAP_SERVERS"],
            topic=os.getenv("KAFKA_TOPIC", "raw.news"),
            group_id=os.getenv("KAFKA_GROUP_ID", "news-consumer"),
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
        logger.info("News consumer subscribed to %s", self._topic)

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
        articles: List[dict] = raw.get("articles", [])
        now = datetime.now(timezone.utc)

        for article in articles:
            article_id = article.get("article_id", "")
            if article_id in self._seen_articles:
                continue
            self._seen_articles.add(article_id)

            signal_score, urgency, confidence_interval = _score_signal(article, now)

            # Parse article timestamp for TimescaleDB write
            article_ts = now
            if article.get("published_at"):
                try:
                    article_ts = datetime.fromisoformat(article["published_at"])
                    if article_ts.tzinfo is None:
                        article_ts = article_ts.replace(tzinfo=timezone.utc)
                except ValueError:
                    pass

            # Write every article to TimescaleDB (raw store, before signal gate)
            try:
                await self._tsdb.execute(
                    """INSERT INTO raw_news (ts, article_id, symbol, headline,
                                            sentiment_score, hotness, source)
                       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING""",
                    article_ts, article_id, ticker,
                    article.get("headline", ""),
                    None,        # sentiment_score (not available from Finnhub free tier)
                    signal_score,
                    article.get("source_name"),
                )
            except Exception as exc:
                logger.warning("raw_news write failed: %s", exc)

            if signal_score < MIN_SIGNAL_SCORE:
                continue

            signal_id = str(uuid.uuid4())
            payload = {
                **article,
                "signal_score": signal_score,
                "urgency": urgency,
                "confidence_interval": confidence_interval,
            }

            direction = _detect_direction(article)
            await self._pool.execute(
                """INSERT INTO signals (id, source, symbol, type, score, direction, payload, created_at)
                   VALUES ($1, 'news', $2, 'news_catalyst', $3, $4, $5, $6)""",
                uuid.UUID(signal_id),
                ticker,
                signal_score,
                direction,
                json.dumps(payload),
                now,
            )
            await self._redis.publish(
                "new_signal",
                json.dumps({"signal_id": signal_id, "source": "news", "symbol": ticker}),
            )
            logger.info(
                "News signal: %s score=%.3f urgency=%s '%s'",
                ticker, signal_score, urgency,
                article.get("headline", "")[:50],
            )
