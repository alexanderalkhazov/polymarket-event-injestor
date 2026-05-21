"""AI correlator entry point — subscribes to Redis new_signal channel."""
import asyncio
import logging
import os

from .correlator import run


def main() -> None:
    logging.basicConfig(level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO), format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
    logging.getLogger(__name__).info("Starting ai-correlator")
    asyncio.run(run())


if __name__ == "__main__":
    main()
