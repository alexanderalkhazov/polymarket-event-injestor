"""Auto-trader entry point — subscribes to new_strategy Redis channel."""
import asyncio
import logging
import os

from .executor import AutoTrader

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s | %(levelname)s | auto-trader | %(message)s",
)

if __name__ == "__main__":
    asyncio.run(AutoTrader().run())
