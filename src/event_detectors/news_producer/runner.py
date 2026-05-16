"""News producer — fetch Finnhub articles for configured tickers, publish raw to Kafka."""
from __future__ import annotations

import asyncio
import json
import logging

from confluent_kafka import Producer

from .config import AppConfig
from ..stock_news_producer.data_source import FinnhubClient
from ..stock_news_producer.config import FinnhubConfig

logger = logging.getLogger(__name__)


class NewsProducer:
    def __init__(self, config: AppConfig) -> None:
        self._config = config
        finnhub_cfg = FinnhubConfig(api_key=config.finnhub_api_key)
        self._client = FinnhubClient(finnhub_cfg)
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
                None, self._client.fetch_company_news, ticker, self._config.news_lookback_hours
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
