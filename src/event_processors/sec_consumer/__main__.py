"""Entry point for the SEC 8-K consumer service."""
import asyncio
import logging
import os

from .consumer import SECConsumer


def main() -> None:
    logging.basicConfig(
        level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    logging.getLogger(__name__).info("Starting SEC consumer")
    asyncio.run(SECConsumer.from_env().run())


if __name__ == "__main__":
    main()
