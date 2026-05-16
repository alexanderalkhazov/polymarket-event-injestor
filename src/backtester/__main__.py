"""Backtester service entry point — keeps process alive so Docker doesn't exit."""
import logging
import time

from observability.pro_logging import setup_logging

setup_logging(service_name="backtester")
logger = logging.getLogger(__name__)
logger.info("Backtester service started (called on-demand by ai-correlator)")

while True:
    time.sleep(3600)
