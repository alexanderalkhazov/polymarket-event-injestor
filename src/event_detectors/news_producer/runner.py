"""News producer — fetch Finnhub articles for configured tickers, publish raw to Kafka."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import requests
from confluent_kafka import Producer

from .config import AppConfig

logger = logging.getLogger(__name__)

FINNHUB_BASE = "https://finnhub.io/api/v1"


@dataclass(frozen=True)
class Article:
    article_id: str
    headline: str
    summary: str
    source_name: str
    url: str
    published_at: datetime


def _fetch_company_news(ticker: str, lookback_hours: int, api_key: str) -> List[Article]:
    now = datetime.now(timezone.utc)
    from_dt = now - timedelta(hours=lookback_hours)
    try:
        resp = requests.get(
            f"{FINNHUB_BASE}/company-news",
            params={
                "symbol": ticker,
                "from": from_dt.strftime("%Y-%m-%d"),
                "to": now.strftime("%Y-%m-%d"),
                "token": api_key,
            },
            timeout=10,
        )
        resp.raise_for_status()
        articles = []
        for item in resp.json():
            try:
                articles.append(Article(
                    article_id=str(item.get("id", "")),
                    headline=item.get("headline", ""),
                    summary=item.get("summary", ""),
                    source_name=item.get("source", ""),
                    url=item.get("url", ""),
                    published_at=datetime.fromtimestamp(item.get("datetime", 0), tz=timezone.utc),
                ))
            except Exception:
                continue
        return articles
    except Exception as exc:
        logger.warning("Finnhub news fetch failed for %s: %s", ticker, exc)
        return []


class NewsProducer:
    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self._api_key = os.environ.get("FINNHUB_API_KEY", config.finnhub_api_key)
        self._producer = Producer({"bootstrap.servers": config.kafka_bootstrap_servers})

    async def start(self) -> None:
        logger.info(
            "News producer started — %d tickers (topic=%s)",
            len(self._config.tickers), self._config.kafka_topic,
        )
        try:
            while True:
                await self._poll()
                await asyncio.sleep(self._config.poll_interval_seconds)
        finally:
            self._producer.flush()

    async def _poll(self) -> None:
        loop = asyncio.get_running_loop()
        published = 0
        for ticker in self._config.tickers:
            articles = await loop.run_in_executor(
                None, _fetch_company_news, ticker,
                self._config.news_lookback_hours, self._api_key
            )
            if not articles:
                continue
            payload = {
                "ticker": ticker,
                "articles": [
                    {
                        "article_id": a.article_id,
                        "headline": a.headline,
                        "summary": a.summary,
                        "source_name": a.source_name,
                        "url": a.url,
                        "published_at": a.published_at.isoformat(),
                    }
                    for a in articles
                ],
            }
            self._producer.produce(
                topic=self._config.kafka_topic,
                key=ticker,
                value=json.dumps(payload).encode(),
            )
            published += 1
        self._producer.poll(0)
        logger.info("Published news for %d/%d tickers", published, len(self._config.tickers))
