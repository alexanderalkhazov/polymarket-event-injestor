"""Combined producer — runs all 3 producers concurrently as asyncio tasks."""
import asyncio
import logging
import os

from observability.pro_logging import setup_logging
from event_detectors.polymarket_producer.runner import PolymarketProducer
from event_detectors.polymarket_producer.config import load_config as load_poly_config
from event_detectors.news_producer.runner import NewsProducer
from event_detectors.news_producer.config import load_config as load_news_config
from event_detectors.analytics_producer.runner import AnalyticsProducer
from event_detectors.analytics_producer.config import load_config as load_analytics_config


async def _run(name: str, coro) -> None:
    while True:
        try:
            await coro
            return
        except Exception as exc:
            logging.getLogger(__name__).error("%s crashed: %s — restarting in 30s", name, exc)
            await asyncio.sleep(30)
            if name == "polymarket":
                coro = PolymarketProducer(load_poly_config()).start()
            elif name == "news":
                coro = NewsProducer(load_news_config()).start()
            elif name == "analytics":
                coro = AnalyticsProducer(load_analytics_config()).start()


async def main() -> None:
    setup_logging(service_name=os.getenv("SERVICE_NAME", "producer"))
    logging.getLogger(__name__).info("Starting combined producer (polymarket + news + analytics)")
    await asyncio.gather(
        _run("polymarket", PolymarketProducer(load_poly_config()).start()),
        _run("news", NewsProducer(load_news_config()).start()),
        _run("analytics", AnalyticsProducer(load_analytics_config()).start()),
    )


if __name__ == "__main__":
    asyncio.run(main())
