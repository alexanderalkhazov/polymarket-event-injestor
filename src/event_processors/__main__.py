"""Combined consumer — runs all 3 consumers concurrently in threads."""
import asyncio
import logging
import os
import threading

from event_processors.polymarket_consumer.consumer import PolymarketConsumer
from event_processors.news_consumer.consumer import NewsConsumer
from event_processors.analytics_consumer.consumer import AnalyticsConsumer


def _run(consumer) -> None:
    asyncio.run(consumer.run())


def main() -> None:
    logging.basicConfig(level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO), format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
    logger = logging.getLogger(__name__)
    logger.info("Starting combined consumer (polymarket + news + analytics)")

    consumers = [
        PolymarketConsumer.from_env(),
        NewsConsumer.from_env(),
        AnalyticsConsumer.from_env(),
    ]
    threads = [threading.Thread(target=_run, args=(c,), daemon=True) for c in consumers]
    for t in threads:
        t.start()
    for t in threads:
        t.join()


if __name__ == "__main__":
    main()
