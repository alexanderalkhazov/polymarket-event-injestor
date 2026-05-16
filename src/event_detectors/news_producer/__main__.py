"""Entry point for the news producer service."""
import asyncio
import logging
import os

from observability.pro_logging import setup_logging
from .runner import NewsProducer
from .config import load_config


def main() -> None:
    setup_logging(service_name=os.getenv("SERVICE_NAME", "news-producer"))
    logging.getLogger(__name__).info("Starting news producer")
    config = load_config()
    asyncio.run(NewsProducer(config).start())


if __name__ == "__main__":
    main()
