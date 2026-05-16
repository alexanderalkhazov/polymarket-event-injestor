"""Analytics consumer entry point."""
import asyncio
import logging
import os

from observability.pro_logging import setup_logging
from .consumer import AnalyticsConsumer


def main() -> None:
    setup_logging(service_name=os.getenv("SERVICE_NAME", "analytics-consumer"))
    logging.getLogger(__name__).info("Starting analytics consumer")
    asyncio.run(AnalyticsConsumer.from_env().run())


if __name__ == "__main__":
    main()
