"""Auto-retrain scheduler. Runs as a Docker service (ml-trainer).

Checks every hour whether enough labeled feature rows exist.
When MIN_TRAIN_SAMPLES is reached and RETRAIN_INTERVAL_H hours have
passed since the last run, retrains both long and short XGBoost models
and writes them to MODEL_DIR so the ai-correlator hot-reloads them.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from pathlib import Path

import asyncpg

logger = logging.getLogger(__name__)

MIN_SAMPLES        = int(os.getenv("MIN_TRAIN_SAMPLES", "50"))
RETRAIN_INTERVAL_H = int(os.getenv("RETRAIN_INTERVAL_H", "24"))
MODEL_DIR          = Path(os.getenv("MODEL_DIR", "/app/models"))
FLAG_FILE          = MODEL_DIR / ".last_trained"
CHECK_INTERVAL_S   = 3600


async def _labeled_count() -> int:
    conn = await asyncpg.connect(os.environ["TIMESCALE_URL"])
    try:
        return int(await conn.fetchval(
            "SELECT COUNT(*) FROM features WHERE forward_return_5d IS NOT NULL"
        ))
    finally:
        await conn.close()


def _hours_since_last_train() -> float:
    if not FLAG_FILE.exists():
        return float("inf")
    return (time.time() - FLAG_FILE.stat().st_mtime) / 3600


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logger.info("ML trainer started — min_samples=%d, interval=%dh", MIN_SAMPLES, RETRAIN_INTERVAL_H)

    while True:
        try:
            count    = await _labeled_count()
            hours    = _hours_since_last_train()
            logger.info("Labeled rows: %d  |  hours since last train: %.1fh", count, hours)

            if count >= MIN_SAMPLES and hours >= RETRAIN_INTERVAL_H:
                logger.info("Retraining models with %d labeled rows...", count)
                try:
                    from .train import load_data, train as run_train
                    df = await load_data()
                    if len(df) < MIN_SAMPLES:
                        logger.warning("Only %d rows after load — skipping", len(df))
                    else:
                        loop = asyncio.get_event_loop()
                        await loop.run_in_executor(None, run_train, df)
                        MODEL_DIR.mkdir(parents=True, exist_ok=True)
                        FLAG_FILE.touch()
                        logger.info("Retrain complete — models saved to %s", MODEL_DIR)
                except Exception as exc:
                    logger.error("Retrain failed: %s", exc, exc_info=True)
            else:
                logger.info("Skipping retrain (need %d samples, %dh interval)", MIN_SAMPLES, RETRAIN_INTERVAL_H)

        except Exception as exc:
            logger.error("Trainer loop error: %s", exc)

        await asyncio.sleep(CHECK_INTERVAL_S)


if __name__ == "__main__":
    asyncio.run(main())
