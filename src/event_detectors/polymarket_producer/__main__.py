from __future__ import annotations

import asyncio
import logging
import os

from .config import load_config
from .runner import PolymarketProducer
from observability.pro_logging import setup_logging


def main() -> None:
    setup_logging(service_name=os.getenv("SERVICE_NAME", "polymarket-producer"))
    logging.getLogger(__name__).info("Starting polymarket producer")
    config = load_config()
    asyncio.run(PolymarketProducer(config).start())


if __name__ == "__main__":
    main()