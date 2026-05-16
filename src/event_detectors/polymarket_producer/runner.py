"""Polymarket producer — fetch all active markets, publish raw to Kafka."""
from __future__ import annotations

import asyncio
import json
import logging

from confluent_kafka import Producer

from .config import AppConfig
from .data_source import PolymarketClient

logger = logging.getLogger(__name__)


class PolymarketProducer:
    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self._client = PolymarketClient(config.polymarket)
        self._producer = Producer({"bootstrap.servers": config.kafka_bootstrap_servers})

    async def start(self) -> None:
        logger.info("Polymarket producer started (topic=%s)", self._config.kafka_topic)
        try:
            while True:
                await self._poll()
                await asyncio.sleep(self._config.poll_interval_seconds)
        finally:
            self._producer.flush()
            self._client.close()

    async def _poll(self) -> None:
        loop = asyncio.get_running_loop()
        snapshots = await loop.run_in_executor(None, self._client.fetch_all_markets)
        logger.info("Fetched %d Polymarket snapshots", len(snapshots))

        for market_id, snap in snapshots.items():
            payload = {
                "market_id": snap.market_id,
                "question": snap.question,
                "yes_price": snap.yes_price,
                "no_price": snap.no_price,
                "volume": snap.volume,
                "liquidity": snap.liquidity,
                "active": snap.active,
                "closed": snap.closed,
                "fetched_at": snap.fetched_at.isoformat(),
            }
            self._producer.produce(
                topic=self._config.kafka_topic,
                key=market_id,
                value=json.dumps(payload).encode(),
            )
        self._producer.poll(0)
