"""Backtester service entry point — keeps process alive so Docker doesn't exit."""
import logging
import time


logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
logger = logging.getLogger(__name__)
logger.info("Backtester service started (called on-demand by ai-correlator)")

while True:
    time.sleep(3600)
