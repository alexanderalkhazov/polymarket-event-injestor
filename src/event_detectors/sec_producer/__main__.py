"""Entry point for the SEC EDGAR 8-K producer service."""
import asyncio
import logging
import os

from .producer import SECProducer


def main() -> None:
    logging.basicConfig(
        level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    logging.getLogger(__name__).info("Starting SEC EDGAR producer")
    asyncio.run(SECProducer.from_env().run())


if __name__ == "__main__":
    main()
