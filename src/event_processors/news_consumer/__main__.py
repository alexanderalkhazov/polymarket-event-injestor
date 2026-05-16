"""News consumer entry point."""
import asyncio
import logging
import os

from observability.pro_logging import setup_logging
from .consumer import NewsConsumer


def main() -> None:
    setup_logging(service_name=os.getenv("SERVICE_NAME", "news-consumer"))
    logging.getLogger(__name__).info("Starting news consumer")
    asyncio.run(NewsConsumer.from_env().run())


if __name__ == "__main__":
    main()
