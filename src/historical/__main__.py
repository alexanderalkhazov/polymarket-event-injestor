"""Historical ingestor entry point."""
import logging
import os

from observability.pro_logging import setup_logging
from .ingestor import run_scheduler


def main() -> None:
    setup_logging(service_name=os.getenv("SERVICE_NAME", "historical-ingestor"))
    logging.getLogger(__name__).info("Starting historical ingestor")
    run_scheduler()


if __name__ == "__main__":
    main()
