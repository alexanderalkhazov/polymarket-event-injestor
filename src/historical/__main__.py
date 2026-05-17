"""Historical ingestor entry point."""
import logging
import os

from .ingestor import run_scheduler


def main() -> None:
    logging.basicConfig(level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO), format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
    logging.getLogger(__name__).info("Starting historical ingestor")
    run_scheduler()


if __name__ == "__main__":
    main()
