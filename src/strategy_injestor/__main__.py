"""Entry point for the Strategy Injestor service."""

import asyncio
import logging
import os
import signal
import sys

from .config import load_config
from .discord_logging import ServiceFilter, attach_discord_logging
from .couchbase_client import CouchbaseClient
from .kafka_consumer import KafkaConsumer
from .runner import StrategyInjestorRunner

level_name = os.getenv("LOG_LEVEL", "INFO")
level = getattr(logging, level_name.upper(), logging.INFO)
log_format = "%(asctime)s | %(levelname)s | %(service)s | %(name)s | %(message)s"
logging.basicConfig(
    level=level,
    format=log_format,
    datefmt="%Y-%m-%dT%H:%M:%S%z",
)
service_name = os.getenv("SERVICE_NAME", "strategy-injestor")
for handler in logging.getLogger().handlers:
    handler.addFilter(ServiceFilter(service_name))
attach_discord_logging(service_name=service_name, formatter=log_format)
logger = logging.getLogger(__name__)


async def main() -> None:
    """Main entry point."""
    logger.info("Starting strategy-injestor service...")
    logger.info("Loading configuration...")
    config = load_config()

    logger.info("Initializing services...")
    kafka_consumer = KafkaConsumer(config.kafka)
    couchbase_client = CouchbaseClient(
        connection_string=config.couchbase.connection_string,
        username=config.couchbase.username,
        password=config.couchbase.password,
        bucket_name=config.couchbase.bucket,
    )

    runner = StrategyInjestorRunner(config, kafka_consumer, couchbase_client)

    def handle_signal(signum: int, frame) -> None:  # type: ignore[no-untyped-def]
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
    except Exception as exc:
        logger.error("Unexpected error: %s", exc, exc_info=True)
        sys.exit(1)

    logger.info("Shutdown complete")


if __name__ == "__main__":
    asyncio.run(main())
