"""Polymarket consumer entry point."""
import asyncio
import logging
import os

from observability.pro_logging import setup_logging
from .consumer import PolymarketConsumer


def main() -> None:
    setup_logging(service_name=os.getenv("SERVICE_NAME", "polymarket-consumer"))
    logging.getLogger(__name__).info("Starting polymarket consumer")
    asyncio.run(PolymarketConsumer.from_env().run())


if __name__ == "__main__":
    main()
