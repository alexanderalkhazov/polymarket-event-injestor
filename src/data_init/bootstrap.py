"""One-shot cold-start initializer.

Runs before ml-trainer, feature-builder, and ai-correlator start.
Checks what's missing and fills it in — safe to re-run (all steps are idempotent).

  Step 1: OHLCV + macro history  — if raw_ohlcv < 1000 rows, run 10-year backfill
  Step 2: Labeled feature rows   — if features < 200 labeled rows, run historical backfill
  Step 3: ML models              — if scoring_model.json missing, train XGBoost
  Step 4: Hypotheses + cleanup   — seed hypotheses if empty; purge unsupported subscriptions
  Step 5: Demo user              — seed demo@eventedge.ai with all-symbol subscriptions
                                   so strategies are created immediately on first boot

Exits 0 on success. Exits 1 on any unrecoverable error.
"""
from __future__ import annotations

import asyncio
import json
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

TIMESCALE_URL = os.environ["TIMESCALE_URL"]
DATABASE_URL  = os.environ["DATABASE_URL"]
MODEL_DIR     = Path(os.getenv("MODEL_DIR", "/app/models"))
OHLCV_MIN     = 1_000
LABELED_MIN   = 200

# Must match src/config/market_categories.py ALL_SYMBOLS exactly
SUPPORTED_SYMBOLS = [
    "SPY","QQQ","DIA","IWM","VTI","EEM","ARKK",
    "AAPL","MSFT","NVDA","GOOGL","META","AMZN","TSLA","AMD","INTC","CRM","NFLX","PLTR","COIN",
    "JPM","BAC","GS","MS","WFC","V","MA",
    "JNJ","UNH","LLY","PFE","ABBV","AMGN",
    "XOM","CVX","XLE","USO","UNG","LNG",
    "GLD","SLV","IAU","GDX","WEAT","CORN","DBA",
    "TLT","IEF","SHY","HYG","AGG","TIP",
    "BTC-USD","ETH-USD","BNB-USD","SOL-USD","XRP-USD",
    "ADA-USD","DOGE-USD","AVAX-USD","DOT-USD","LINK-USD",
    "MATIC-USD","ATOM-USD","UNI-USD",
]

# Trading hypotheses — each covers a distinct signal type.
# feature_conditions use keys from the features table; {} = match anything (polymarket/catch-all).
# Order matters: _match_hypothesis returns the FIRST match, so specific ones come first.
HYPOTHESES = [
    {
        "name": "RSI Oversold Bounce",
        "description": "RSI below 40 signals oversold conditions with mean-reversion potential",
        "feature_conditions": {"rsi_14": {"lt": 40}},
        "hold_days": 5,
        "confidence_threshold": 0.65,
        "direction": "up",
        "invalidation_conditions": {"rsi_14": {"gt": 60}},
    },
    {
        "name": "RSI Overbought Reversal",
        "description": "RSI above 68 signals overbought conditions with reversal potential",
        "feature_conditions": {"rsi_14": {"gt": 68}},
        "hold_days": 5,
        "confidence_threshold": 0.65,
        "direction": "down",
        "invalidation_conditions": {"rsi_14": {"lt": 50}},
    },
    {
        "name": "Volume Breakout Long",
        "description": "Volume 40%+ above 30-day average confirms institutional buying interest",
        "feature_conditions": {"vol_ratio_30d": {"gt": 1.4}},
        "hold_days": 3,
        "confidence_threshold": 0.65,
        "direction": "up",
        "invalidation_conditions": {},
    },
    {
        "name": "Volume Breakout Short",
        "description": "Volume 40%+ above 30-day average with negative momentum signals distribution",
        "feature_conditions": {"vol_ratio_30d": {"gt": 1.4}, "price_change_1d": {"lt": -0.01}},
        "hold_days": 3,
        "confidence_threshold": 0.65,
        "direction": "down",
        "invalidation_conditions": {},
    },
    {
        "name": "Bullish Momentum",
        "description": "5-day price gain above 1.5% with positive MACD histogram confirms uptrend",
        "feature_conditions": {"price_change_5d": {"gt": 0.015}, "macd_histogram": {"gt": 0}},
        "hold_days": 5,
        "confidence_threshold": 0.65,
        "direction": "up",
        "invalidation_conditions": {"price_change_5d": {"lt": -0.02}},
    },
    {
        "name": "Bearish Momentum",
        "description": "5-day price loss above 1.5% with negative MACD histogram confirms downtrend",
        "feature_conditions": {"price_change_5d": {"lt": -0.015}, "macd_histogram": {"lt": 0}},
        "hold_days": 5,
        "confidence_threshold": 0.65,
        "direction": "down",
        "invalidation_conditions": {"price_change_5d": {"gt": 0.02}},
    },
    {
        "name": "ADX Strong Uptrend",
        "description": "ADX above 22 confirms strong directional momentum in bullish regime",
        "feature_conditions": {"adx_14": {"gt": 22}, "macd_histogram": {"gt": 0}},
        "hold_days": 5,
        "confidence_threshold": 0.65,
        "direction": "up",
        "invalidation_conditions": {"adx_14": {"lt": 15}},
    },
    {
        "name": "ADX Strong Downtrend",
        "description": "ADX above 22 confirms strong directional momentum in bearish regime",
        "feature_conditions": {"adx_14": {"gt": 22}, "macd_histogram": {"lt": 0}},
        "hold_days": 5,
        "confidence_threshold": 0.65,
        "direction": "down",
        "invalidation_conditions": {"adx_14": {"lt": 15}},
    },
    {
        "name": "Bollinger Band Squeeze",
        "description": "Price near lower Bollinger Band signals potential mean-reversion bounce",
        "feature_conditions": {"bb_position": {"lt": 0.25}},
        "hold_days": 5,
        "confidence_threshold": 0.65,
        "direction": "up",
        "invalidation_conditions": {"bb_position": {"gt": 0.6}},
    },
    {
        "name": "Bollinger Band Upper Break",
        "description": "Price near upper Bollinger Band signals potential mean-reversion pullback",
        "feature_conditions": {"bb_position": {"gt": 0.8}},
        "hold_days": 5,
        "confidence_threshold": 0.65,
        "direction": "down",
        "invalidation_conditions": {"bb_position": {"lt": 0.5}},
    },
    {
        "name": "Fear Capitulation Buy",
        "description": "VIX above 22 signals elevated fear; historically precedes relief rallies",
        "feature_conditions": {"vix_level": {"gt": 22}},
        "hold_days": 10,
        "confidence_threshold": 0.65,
        "direction": "up",
        "invalidation_conditions": {"vix_level": {"lt": 15}},
    },
    {
        "name": "Positive News Catalyst",
        "description": "Strong positive news sentiment in past hour signals short-term buying pressure",
        "feature_conditions": {"news_sentiment_1h": {"gt": 0.1}},
        "hold_days": 3,
        "confidence_threshold": 0.65,
        "direction": "up",
        "invalidation_conditions": {},
    },
    {
        "name": "Negative News Catalyst",
        "description": "Strong negative news sentiment in past hour signals short-term selling pressure",
        "feature_conditions": {"news_sentiment_1h": {"lt": -0.1}},
        "hold_days": 3,
        "confidence_threshold": 0.65,
        "direction": "down",
        "invalidation_conditions": {},
    },
    {
        "name": "Polymarket Conviction Shift Long",
        "description": "Polymarket conviction delta rising signals crowd expectation shift upward",
        "feature_conditions": {"poly_conviction_delta_1h": {"gt": 0.05}},
        "hold_days": 5,
        "confidence_threshold": 0.50,
        "direction": "up",
        "invalidation_conditions": {},
    },
    {
        "name": "Polymarket Conviction Shift Short",
        "description": "Polymarket conviction delta falling signals crowd expectation shift downward",
        "feature_conditions": {"poly_conviction_delta_1h": {"lt": -0.05}},
        "hold_days": 5,
        "confidence_threshold": 0.50,
        "direction": "down",
        "invalidation_conditions": {},
    },
    {
        "name": "Options Unusual Activity Long",
        "description": "Unusual call sweep activity indicates smart money positioning for upside",
        "feature_conditions": {"unusual_sweep_count_4h": {"gt": 2}},
        "hold_days": 5,
        "confidence_threshold": 0.65,
        "direction": "up",
        "invalidation_conditions": {},
    },
    {
        "name": "Options Unusual Activity Short",
        "description": "Unusual put sweep activity indicates smart money positioning for downside",
        "feature_conditions": {"put_call_ratio": {"gt": 1.2}},
        "hold_days": 5,
        "confidence_threshold": 0.65,
        "direction": "down",
        "invalidation_conditions": {"put_call_ratio": {"lt": 0.8}},
    },
    {
        "name": "General Bullish Setup",
        "description": "Multi-factor bullish signal without specific single condition",
        "feature_conditions": {"price_change_1d": {"gt": 0.005}},
        "hold_days": 5,
        "confidence_threshold": 0.70,
        "direction": "up",
        "invalidation_conditions": {},
    },
    {
        "name": "General Bearish Setup",
        "description": "Multi-factor bearish signal without specific single condition",
        "feature_conditions": {"price_change_1d": {"lt": -0.005}},
        "hold_days": 5,
        "confidence_threshold": 0.70,
        "direction": "down",
        "invalidation_conditions": {},
    },
    # ── New alpha signal types ────────────────────────────────────────────────────
    {
        "name": "GEX Squeeze Amplifier",
        "description": "Negative dealer gamma exposure forces mechanical buying into rallies, amplifying any upward move or short squeeze",
        "feature_conditions": {},
        "hold_days": 3,
        "confidence_threshold": 0.65,
        "direction": "up",
        "invalidation_conditions": {"rsi_14": {"gt": 75}},
    },
    {
        "name": "GEX Gamma Pin",
        "description": "Large positive GEX near current price creates gravitational pull to the max-gamma strike into expiry",
        "feature_conditions": {},
        "hold_days": 2,
        "confidence_threshold": 0.60,
        "direction": "up",
        "invalidation_conditions": {},
    },
    {
        "name": "Short Squeeze Setup",
        "description": "High short float plus slow days-to-cover plus catalyst creates forced-cover buying cascade above resistance",
        "feature_conditions": {"rsi_14": {"lt": 45}},
        "hold_days": 5,
        "confidence_threshold": 0.65,
        "direction": "up",
        "invalidation_conditions": {"rsi_14": {"gt": 70}},
    },
    {
        "name": "Cross-Asset Convergence Long",
        "description": "Statistically lagging asset in a correlated pair reverts toward its leader over 5–10 day window",
        "feature_conditions": {},
        "hold_days": 7,
        "confidence_threshold": 0.62,
        "direction": "up",
        "invalidation_conditions": {},
    },
    {
        "name": "Cross-Asset Convergence Short",
        "description": "Statistically leading asset in a correlated pair reverts downward toward its lagging counterpart",
        "feature_conditions": {},
        "hold_days": 7,
        "confidence_threshold": 0.62,
        "direction": "down",
        "invalidation_conditions": {},
    },
]


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


async def step4_seed_and_clean() -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        # ── Seed hypotheses ───────────────────────────────────────────────────
        existing = await conn.fetchval("SELECT COUNT(*) FROM hypotheses")
        if existing and existing > 0:
            logger.info("Step 4a SKIP — hypotheses already has %d rows", existing)
        else:
            for h in HYPOTHESES:
                await conn.execute(
                    """INSERT INTO hypotheses
                       (name, description, feature_conditions, hold_days, confidence_threshold,
                        direction, invalidation_conditions, is_active)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
                       ON CONFLICT (name) DO NOTHING""",
                    h["name"],
                    h["description"],
                    json.dumps(h["feature_conditions"]),
                    h["hold_days"],
                    h["confidence_threshold"],
                    h["direction"],
                    json.dumps(h["invalidation_conditions"]),
                )
            logger.info("Step 4a DONE — seeded %d hypotheses", len(HYPOTHESES))

        # ── Remove unsupported symbol subscriptions ───────────────────────────
        deleted = await conn.fetchval(
            "WITH d AS (DELETE FROM subscriptions WHERE symbol != ALL($1::text[]) RETURNING 1) "
            "SELECT COUNT(*) FROM d",
            SUPPORTED_SYMBOLS,
        )
        if deleted:
            logger.info("Step 4b DONE — removed %d unsupported symbol subscriptions", deleted)
        else:
            logger.info("Step 4b SKIP — all subscriptions already use supported symbols")

    finally:
        await conn.close()


async def step5_seed_demo_user() -> None:
    """Ensure at least one user with all-symbol subscriptions exists.

    Creates demo@eventedge.ai (password: demo1234) if no users are present.
    Idempotent: skips if any user already exists, but always fills missing subscriptions
    for the demo account so a fresh volume wipe never leaves the system strategy-less.
    """
    import bcrypt  # only needed here; avoids top-level import cost for normal re-runs

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        user_count = await conn.fetchval("SELECT COUNT(*) FROM users")
        if user_count and user_count > 0:
            logger.info("Step 5 SKIP — %d user(s) already exist", user_count)
        else:
            pw_hash = bcrypt.hashpw(b"demo1234", bcrypt.gensalt(12)).decode()
            demo_id = await conn.fetchval(
                """INSERT INTO users
                       (email, password_hash, risk_level, max_position_pct,
                        onboarding_complete, is_paper)
                   VALUES ('demo@eventedge.ai', $1, 'aggressive', 0.10, TRUE, TRUE)
                   ON CONFLICT (email) DO NOTHING
                   RETURNING id""",
                pw_hash,
            )
            if not demo_id:
                demo_id = await conn.fetchval(
                    "SELECT id FROM users WHERE email='demo@eventedge.ai'"
                )
            logger.info("Step 5 DONE — demo user created (demo@eventedge.ai / demo1234)")

        # Always ensure the demo account has subscriptions for every supported symbol
        # across all three sources so no opportunity is missed on a fresh boot.
        demo_id = await conn.fetchval(
            "SELECT id FROM users WHERE email='demo@eventedge.ai'"
        )
        if demo_id:
            added = 0
            for symbol in SUPPORTED_SYMBOLS:
                for source in ("polymarket", "news", "analytics"):
                    result = await conn.execute(
                        """INSERT INTO subscriptions (user_id, source, symbol)
                           VALUES ($1, $2, $3)
                           ON CONFLICT (user_id, source, symbol) DO NOTHING""",
                        demo_id, source, symbol,
                    )
                    if result and result.endswith("1"):
                        added += 1
            if added:
                logger.info("Step 5 DONE — added %d subscription(s) for demo user", added)
            else:
                logger.info("Step 5 SKIP — demo user subscriptions already complete")
    finally:
        await conn.close()


async def main() -> None:
    logger.info("=== data-init starting ===")
    try:
        await step1_ingest()
        await step2_backfill()
        await step3_train()
        await step4_seed_and_clean()
        await step5_seed_demo_user()
    except Exception:
        logger.exception("data-init failed")
        sys.exit(1)
    logger.info("=== data-init complete — all services may start ===")


if __name__ == "__main__":
    asyncio.run(main())
