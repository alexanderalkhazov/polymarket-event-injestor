from __future__ import annotations

import asyncio
import logging
import os

from .config import load_config
from .runner import PolymarketProducer


def main() -> None:
    logging.basicConfig(level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO), format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
    logging.getLogger(__name__).info("Starting polymarket producer")
    config = load_config()
    asyncio.run(PolymarketProducer(config).start())


if __name__ == "__main__":
    main()