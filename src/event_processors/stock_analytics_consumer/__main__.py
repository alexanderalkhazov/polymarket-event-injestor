"""Entry point for the Strategy Injestor service."""

import asyncio
import logging
import os
import signal

from .config import load_config
from .couchbase_client import CouchbaseClient
from .kafka_consumer import KafkaConsumer
from .runner import StrategyInjestorRunner
from event_processors.subscription_fan_out import SubscriptionFanOut
from observability.metrics import start_metrics_server
from observability.pro_logging import setup_logging
logger = logging.getLogger(__name__)


async def main() -> None:
    """Main entry point."""
    setup_logging(service_name=os.getenv("SERVICE_NAME", "stock-analytics-consumer"))
    logger.info("Starting stock-analytics-consumer service...")
    start_metrics_server("stock-analytics-consumer", 9104)
    logger.info("Loading configuration...")
    config = load_config()

    logger.info("Initializing services...")
    kafka_consumer = KafkaConsumer(config.kafka)
    couchbase_client = CouchbaseClient(
        connection_string=config.couchbase.connection_string,
        username=config.couchbase.username,
        password=config.couchbase.password,
        bucket_name=config.couchbase.bucket,
        polymarket_ttl_seconds=config.couchbase.polymarket_ttl_seconds,
        stock_news_ttl_seconds=config.couchbase.stock_news_ttl_seconds,
        stock_analytics_ttl_seconds=config.couchbase.stock_analytics_ttl_seconds,
    )
    fan_out = SubscriptionFanOut(config.mongo_uri)

    runner = StrategyInjestorRunner(config, kafka_consumer, couchbase_client, fan_out)

    def handle_signal(signum: int, _frame: object) -> None:
        """Handle SIGINT/SIGTERM gracefully."""
        logger.info("Received signal %s, initiating graceful shutdown...", signum)
        runner.request_stop()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)
    logger.info("Signal handlers registered")

    logger.info("Starting runner...")
    try:
        await runner.run()
    except KeyboardInterrupt:
        logger.info("Interrupted by user")

    logger.info("Shutdown complete")


if __name__ == "__main__":
    asyncio.run(main())
