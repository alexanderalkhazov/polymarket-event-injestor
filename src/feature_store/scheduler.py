"""Feature store scheduler — runs builder hourly, label filler nightly."""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
from datetime import datetime, timezone, timedelta

import asyncpg

from .builder import FeatureBuilder, get_symbols
from .label_filler import fill_labels
from .cleanup import run_cleanup

logger = logging.getLogger(__name__)


async def run_hourly(tsdb: asyncpg.Pool) -> None:
    builder = FeatureBuilder(tsdb)
    symbols = get_symbols()
    ts = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    logger.info("Feature snapshot: %s, %d symbols", ts.isoformat(), len(symbols))
    for symbol in symbols:
        features = await builder.build_snapshot(symbol, ts)
        if features:
            await builder.write(features)
            logger.debug("Wrote features for %s @ %s", symbol, ts)


async def run_backfill(tsdb: asyncpg.Pool) -> None:
    """Build feature snapshots for every hour of available raw_ohlcv history."""
    builder = FeatureBuilder(tsdb)
    symbols = get_symbols()

    for symbol in symbols:
        oldest = await tsdb.fetchval(
            "SELECT MIN(ts) FROM raw_ohlcv WHERE symbol=$1 AND interval='1d'", symbol
        )
        if not oldest:
            logger.warning("No raw_ohlcv data for %s — skip backfill", symbol)
            continue

        ts = oldest.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        count = 0
        while ts <= now:
            features = await builder.build_snapshot(symbol, ts)
            if features:
                await builder.write(features)
                count += 1
            ts += timedelta(hours=6)  # 4 snapshots per day is enough for backfill

        logger.info("Backfill: %d snapshots for %s", count, symbol)

    logger.info("Feature backfill complete")


async def main_async(backfill: bool) -> None:
    timescale_url = os.environ["TIMESCALE_URL"]
    pool = await asyncpg.create_pool(timescale_url, min_size=2, max_size=5)

    try:
        if backfill:
            await run_backfill(pool)
            await fill_labels(pool)
            return

        # Normal mode: run once immediately, then every hour using asyncio (no nested asyncio.run)
        await run_hourly(pool)
        ticks = 0
        while True:
            await asyncio.sleep(3600)
            await run_hourly(pool)
            ticks += 1
            if ticks % 24 == 0:
                await fill_labels(pool)
                await run_cleanup()
    finally:
        await pool.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--backfill", action="store_true",
                        help="Build snapshots for all historical data then exit")
    args = parser.parse_args()

    logging.basicConfig(level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO), format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
    asyncio.run(main_async(backfill=args.backfill))
