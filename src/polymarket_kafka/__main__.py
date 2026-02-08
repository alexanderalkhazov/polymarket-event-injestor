from __future__ import annotations

import asyncio
import logging
import signal

from .config import load_config
from .data_source import PolymarketClient
from .kafka_client import KafkaClient
from .runner import PolymarketKafkaRunner
from .subscription_manager import SubscriptionManager


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    )


async def main_async() -> None:
    logger = logging.getLogger(__name__)
    try:
        logger.info("Loading configuration...")
        config = load_config()

        logger.info("Initializing services...")
        subscription_manager = SubscriptionManager(config.mongodb)
        data_source = PolymarketClient(config.polymarket)
        kafka_client = KafkaClient(config.kafka)

        runner = PolymarketKafkaRunner(
            config=config,
            subscription_manager=subscription_manager,
            data_source=data_source,
            kafka_client=kafka_client,
        )

        # Register signal handlers (may fail on Windows or in some Docker environments)
        try:
            loop = asyncio.get_running_loop()
            for signame in {"SIGINT", "SIGTERM"}:
                sig = getattr(signal, signame, None)
                if sig is not None:
                    loop.add_signal_handler(sig, lambda s=signame: runner.request_stop())
            logger.info("Signal handlers registered")
        except (NotImplementedError, ValueError) as e:
            logger.warning("Could not register signal handlers: %s", e)

        logger.info("Starting runner...")
        await runner.run()
    except Exception as e:
        logger.exception("Fatal error in main_async: %s", e)
        raise


def main() -> None:
    configure_logging()
    logger = logging.getLogger(__name__)
    try:
        logger.info("Starting polymarket-kafka service...")
        asyncio.run(main_async())
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    except Exception as e:
        logger.exception("Fatal error: %s", e)
        raise


if __name__ == "__main__":
    main()