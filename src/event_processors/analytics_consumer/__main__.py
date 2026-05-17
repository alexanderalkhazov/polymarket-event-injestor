"""Analytics consumer entry point."""
import asyncio
import logging
import os

from .consumer import AnalyticsConsumer


def main() -> None:
    logging.basicConfig(level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO), format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
    logging.getLogger(__name__).info("Starting analytics consumer")
    asyncio.run(AnalyticsConsumer.from_env().run())


if __name__ == "__main__":
    main()
