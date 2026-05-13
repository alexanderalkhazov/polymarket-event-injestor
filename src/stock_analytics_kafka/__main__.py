"""Entry point for the stock-analytics-kafka service.

Usage:
    python -m stock_analytics_kafka
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal

from .config import load_config
from .discord_logging import attach_discord_logging
from .runner import StockAnalyticsKafkaRunner

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
    _setup_logging()
    attach_discord_logging(service_name="stock-analytics-kafka")

    config = load_config()
    runner = StockAnalyticsKafkaRunner(config)

    loop = asyncio.get_running_loop()

    def _handle_signal() -> None:
        logger.info("Shutdown signal received")
        runner.stop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _handle_signal)

    logger.info("stock-analytics-kafka starting up")
    await runner.run()
    logger.info("stock-analytics-kafka shut down cleanly")


def main() -> None:
    asyncio.run(_main())


if __name__ == "__main__":
    main()
