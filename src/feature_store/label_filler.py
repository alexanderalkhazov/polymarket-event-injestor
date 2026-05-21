"""Nightly label filler — fills forward_return_5d for rows old enough to have an outcome."""
from __future__ import annotations

import asyncio
import logging
import os

import asyncpg

logger = logging.getLogger(__name__)


async def fill_labels(tsdb: asyncpg.Connection | asyncpg.Pool, hold_days: int = 5) -> int:
    # Buffer for weekends: 1.5x hold_days trading days ≈ enough calendar days
    unlabeled = await tsdb.fetch(
        """SELECT ts, symbol FROM features
           WHERE forward_return_5d IS NULL
             AND ts < NOW() - ($1 * INTERVAL '1 day')""",
        hold_days * 1.5,
    )
    filled = 0
    for row in unlabeled:
        price_at = await tsdb.fetchval(
            """SELECT close FROM raw_ohlcv
               WHERE symbol=$1 AND interval='1d' AND ts<=$2
               ORDER BY ts DESC LIMIT 1""",
            row["symbol"], row["ts"],
        )
        # The Nth trading day close after ts
        price_fwd = await tsdb.fetchval(
            """SELECT close FROM raw_ohlcv
               WHERE symbol=$1 AND interval='1d' AND ts>$2
               ORDER BY ts ASC LIMIT 1 OFFSET $3""",
            row["symbol"], row["ts"], hold_days - 1,
        )
        if price_at and price_fwd:
            fwd = (float(price_fwd) - float(price_at)) / float(price_at)
            await tsdb.execute(
                """UPDATE features
                   SET forward_return_1d  = (
                     SELECT (close - $3) / $3 FROM raw_ohlcv
                     WHERE symbol=$1 AND interval='1d' AND ts>$2 ORDER BY ts ASC LIMIT 1
                   ),
                   forward_return_5d  = $4,
                   forward_return_10d = (
                     SELECT (close - $3) / $3 FROM raw_ohlcv
                     WHERE symbol=$1 AND interval='1d' AND ts>$2 ORDER BY ts ASC LIMIT 1 OFFSET 9
                   ),
                   label_filled_at = NOW()
                   WHERE ts=$2 AND symbol=$1""",
                row["symbol"], row["ts"], float(price_at), fwd,
            )
            filled += 1
    logger.info("Filled labels for %d rows (hold_days=%d)", filled, hold_days)
    return filled


async def main() -> None:
    logging.basicConfig(level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO), format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
    conn = await asyncpg.connect(os.environ["TIMESCALE_URL"])
    try:
        await fill_labels(conn)
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
