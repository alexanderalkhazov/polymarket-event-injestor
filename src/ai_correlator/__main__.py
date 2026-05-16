"""AI correlator entry point — subscribes to Redis new_signal channel."""
import asyncio
import logging
import os

from observability.pro_logging import setup_logging
from .correlator import run


def main() -> None:
    setup_logging(service_name=os.getenv("SERVICE_NAME", "ai-correlator"))
    logging.getLogger(__name__).info("Starting ai-correlator")
    asyncio.run(run())


if __name__ == "__main__":
    main()
