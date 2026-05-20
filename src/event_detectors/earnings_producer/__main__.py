"""Earnings alpha producer — entry point."""
import asyncio
import logging
import os

from .producer import EarningsProducer

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s | %(levelname)s | earnings-producer | %(message)s",
)

if __name__ == "__main__":
    asyncio.run(EarningsProducer().run())
