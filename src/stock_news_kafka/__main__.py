"""Entry point for the stock-news-kafka service.

Usage:
    python -m stock_news_kafka
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal

from .config import load_config
from .runner import StockNewsKafkaRunner
from observability.metrics import start_metrics_server
from observability.pro_logging import setup_logging

logger = logging.getLogger(__name__)


def _setup_logging() -> None:
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )


async def _main() -> None:
    setup_logging(service_name="stock-news-kafka")
    start_metrics_server("stock-news-kafka", 9102)

    config = load_config()
    runner = StockNewsKafkaRunner(config)

    loop = asyncio.get_running_loop()

    def _handle_signal() -> None:
        logger.info("Shutdown signal received")
        runner.stop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _handle_signal)

    logger.info("stock-news-kafka starting up")
    await runner.run()
    logger.info("stock-news-kafka shut down cleanly")


def main() -> None:
    asyncio.run(_main())


if __name__ == "__main__":
    main()
