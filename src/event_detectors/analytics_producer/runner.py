"""Analytics producer — dumb publisher. Fetch yfinance snapshots, publish raw to Kafka."""
from __future__ import annotations

import asyncio
import json
import logging

from confluent_kafka import Producer

from .config import AppConfig
from ..stock_analytics_producer.data_source import YFinanceClient

logger = logging.getLogger(__name__)


class AnalyticsProducer:
    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self._client = YFinanceClient()
        self._producer = Producer({"bootstrap.servers": config.kafka_bootstrap_servers})

    async def start(self) -> None:
        logger.info(
            "Analytics producer started — %d tickers (topic=%s)",
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
            snap = await loop.run_in_executor(None, self._client.fetch_ticker_data, ticker)
            if snap is None:
                continue
            payload = {
                "ticker": snap.ticker,
                "current_price": snap.current_price,
                "price_change_1d_pct": snap.price_change_1d_pct,
                "current_volume": snap.current_volume,
                "avg_volume_30d": snap.avg_volume_30d,
                "rsi_14": snap.rsi_14,
                "call_volume": snap.call_volume,
                "put_volume": snap.put_volume,
                "put_call_ratio": snap.put_call_ratio,
                "fetched_at": snap.fetched_at.isoformat(),
            }
            self._producer.produce(
                topic=self._config.kafka_topic,
                key=ticker,
                value=json.dumps(payload).encode(),
            )
            published += 1
        self._producer.poll(0)
        logger.info("Published analytics for %d/%d tickers", published, len(self._config.tickers))
