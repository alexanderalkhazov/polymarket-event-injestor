"""One-shot cold-start initializer.

Runs before ml-trainer, feature-builder, and ai-correlator start.
Checks what's missing and fills it in — safe to re-run (all steps are idempotent).

  Step 1: OHLCV + macro history  — if raw_ohlcv has < 1000 rows, run 10-year backfill
  Step 2: Labeled feature rows   — if features has < 200 labeled rows, run historical backfill
  Step 3: ML models              — if scoring_model.json is missing, train XGBoost

Exits 0 on success. Exits 1 on any unrecoverable error.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path

import asyncpg

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | data-init | %(message)s",
)
logger = logging.getLogger(__name__)

TIMESCALE_URL    = os.environ["TIMESCALE_URL"]
MODEL_DIR        = Path(os.getenv("MODEL_DIR", "/app/models"))
OHLCV_MIN        = 1_000   # rows — below this we run the full historical ingest
LABELED_MIN      = 200     # labeled feature rows needed before training


async def _count(query: str) -> int:
    conn = await asyncpg.connect(TIMESCALE_URL)
    try:
        return int(await conn.fetchval(query))
    finally:
        await conn.close()


async def step1_ingest() -> None:
    count = await _count("SELECT COUNT(*) FROM raw_ohlcv")
    if count >= OHLCV_MIN:
        logger.info("Step 1 SKIP — raw_ohlcv already has %d rows", count)
        return

    logger.info("Step 1 START — raw_ohlcv has %d rows, running 10-year backfill...", count)
    os.environ["DEV_MODE"] = "false"

    from historical.ingestor import run_once
    await run_once(backfill=True)
    logger.info("Step 1 DONE — historical OHLCV + macro ingested")


async def step2_backfill() -> None:
    count = await _count(
        "SELECT COUNT(*) FROM features WHERE forward_return_5d IS NOT NULL"
    )
    if count >= LABELED_MIN:
        logger.info("Step 2 SKIP — features already has %d labeled rows", count)
        return

    logger.info("Step 2 START — only %d labeled rows, running feature backfill...", count)
    from feature_store.historical_backfill import main as backfill_main
    await backfill_main()
    logger.info("Step 2 DONE — labeled feature rows populated")


async def step3_train() -> None:
    model_path = MODEL_DIR / "scoring_model.json"
    if model_path.exists():
        logger.info("Step 3 SKIP — models already exist at %s", MODEL_DIR)
        return

    count = await _count(
        "SELECT COUNT(*) FROM features WHERE forward_return_5d IS NOT NULL"
    )
    if count < 50:
        logger.warning("Step 3 SKIP — only %d labeled rows (need 50+), skipping training", count)
        return

    logger.info("Step 3 START — training XGBoost models on %d labeled rows...", count)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    from ml_trainer.train import load_data, train
    df = await load_data()
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, train, df)
    logger.info("Step 3 DONE — models saved to %s", MODEL_DIR)


async def main() -> None:
    logger.info("=== data-init starting ===")
    try:
        await step1_ingest()
        await step2_backfill()
        await step3_train()
    except Exception:
        logger.exception("data-init failed")
        sys.exit(1)
    logger.info("=== data-init complete — all services may start ===")


if __name__ == "__main__":
    asyncio.run(main())
