"""Entry point for the analytics producer service."""
import asyncio
import logging
import os

from .runner import AnalyticsProducer
from .config import load_config


def main() -> None:
    logging.basicConfig(level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO), format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
    logging.getLogger(__name__).info("Starting analytics producer")
    config = load_config()
    asyncio.run(AnalyticsProducer(config).start())


if __name__ == "__main__":
    main()
