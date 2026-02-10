"""Entry point for the Strategy Injestor service."""

import asyncio
import logging
import signal
import sys

from .config import load_config
from .kafka_consumer import KafkaConsumer
from .runner import StrategyInjestorRunner

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def main() -> None:
    """Main entry point."""
    logger.info("Starting strategy-injestor service...")
    logger.info("Loading configuration...")
    config = load_config()

    logger.info("Initializing services...")
    kafka_consumer = KafkaConsumer(config.kafka)

    runner = StrategyInjestorRunner(config, kafka_consumer)

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
