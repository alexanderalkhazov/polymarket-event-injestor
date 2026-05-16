"""Entry point for the analytics producer service."""
import asyncio
import logging
import os

from observability.pro_logging import setup_logging
from .runner import AnalyticsProducer
from .config import load_config


def main() -> None:
    setup_logging(service_name=os.getenv("SERVICE_NAME", "analytics-producer"))
    logging.getLogger(__name__).info("Starting analytics producer")
    config = load_config()
    asyncio.run(AnalyticsProducer(config).start())


if __name__ == "__main__":
    main()
