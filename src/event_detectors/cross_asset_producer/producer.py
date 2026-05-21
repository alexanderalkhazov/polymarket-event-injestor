"""Cross-Asset Divergence Producer.

Runs every hour. Monitors 8 correlated asset pairs. Fires when one asset
in a pair deviates beyond 2.5σ from its historical spread — a statistical
signal that the laggard will mean-revert toward the leader.

All pairs are positively correlated by fundamental or sector logic:
  XLE/USO    — Energy stocks follow oil price; divergence = dislocation
  GLD/TLT    — Gold and bonds both safe havens; divergence = one mispriced
  IWM/SPY    — Small/large cap breadth; IWM lag = fragile rally, IWM lead = breadth improving
  QQQ/SPY    — Tech vs broad market; QQQ lag = sector rotation, QQQ lead = risk-on
  BTC/ETH    — Should move nearly in lockstep; divergence = pair arb opportunity
  NVDA/AMD   — Same semiconductor cycle; divergence = relative value play
  JPM/BAC    — Same rate sensitivity; divergence = relative value in banks
  GLD/SLV    — Both precious metals; gold leads, silver follows

The signal fires on the LAGGARD (the asset that should catch up).
Methodology:
  1. Compute 5-day cumulative return for each asset in the pair
  2. Compute spread = ret_A - ret_B (adjusted for typical correlation sign)
  3. Standardise against 20-day rolling mean/std of the spread
  4. Fire when |z| > 2.5 for the laggard asset
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Optional

import asyncpg
import numpy as np
import redis.asyncio as aioredis
import yfinance as yf

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL    = os.environ.get("REDIS_URL", "redis://redis:6379")

POLL_INTERVAL_S  = 3600         # 1 hour
Z_SCORE_TRIGGER  = 2.5          # standard deviations to consider extreme
LOOKBACK_DAYS    = 25           # days to compute rolling spread stats
SPREAD_DAYS      = 5            # recent window for the current spread

# (asset_a, asset_b, description)
# Convention: signal fires on asset_b when asset_a outperforms (z > +threshold),
# and on asset_a when asset_b outperforms (z < -threshold).
PAIRS = [
    ("XLE",     "USO",     "energy stocks vs oil price"),
    ("GLD",     "TLT",     "gold vs bonds safe-haven co-movement"),
    ("IWM",     "SPY",     "small cap vs large cap breadth"),
    ("QQQ",     "SPY",     "tech vs broad market"),
    ("BTC-USD", "ETH-USD", "BTC vs ETH crypto pair"),
    ("NVDA",    "AMD",     "semiconductor pair"),
    ("JPM",     "BAC",     "bank pair"),
    ("GLD",     "SLV",     "gold vs silver precious metals"),
]


def _fetch_pair_data(sym_a: str, sym_b: str) -> Optional[tuple[np.ndarray, np.ndarray]]:
    """Fetch LOOKBACK_DAYS of daily closes for both assets. Returns (ret_a, ret_b) or None."""
    try:
        period = f"{LOOKBACK_DAYS + 5}d"
        df_a = yf.Ticker(sym_a).history(period=period)["Close"]
        df_b = yf.Ticker(sym_b).history(period=period)["Close"]
        if len(df_a) < LOOKBACK_DAYS or len(df_b) < LOOKBACK_DAYS:
            return None
        # Align on common dates
        import pandas as pd
        df = pd.DataFrame({"a": df_a, "b": df_b}).dropna()
        if len(df) < LOOKBACK_DAYS:
            return None
        ret_a = df["a"].pct_change().dropna().values[-LOOKBACK_DAYS:]
        ret_b = df["b"].pct_change().dropna().values[-LOOKBACK_DAYS:]
        return ret_a, ret_b
    except Exception as exc:
        logger.debug("Pair fetch error %s/%s: %s", sym_a, sym_b, exc)
        return None


class CrossAssetProducer:
    def __init__(self) -> None:
        self._db:    Optional[asyncpg.Connection] = None
        self._redis: Optional[aioredis.Redis]      = None

    async def _connect(self) -> None:
        self._db    = await asyncpg.connect(DATABASE_URL)
        self._redis = await aioredis.from_url(REDIS_URL, decode_responses=True)

    async def _close(self) -> None:
        if self._db:    await self._db.close()
        if self._redis: await self._redis.aclose()

    async def _already_signalled(self, symbol: str, window: str = "6 hours") -> bool:
        row = await self._db.fetchval(
            f"SELECT id FROM signals WHERE source='analytics' AND symbol=$1 "
            f"AND type='cross_asset_divergence' "
            f"AND created_at > NOW() - INTERVAL '{window}' LIMIT 1",
            symbol,
        )
        return row is not None

    async def _publish(self, symbol: str, score: float, direction: str, payload: dict) -> None:
        sig_id = await self._db.fetchval(
            "INSERT INTO signals (id,source,symbol,type,score,direction,payload) "
            "VALUES ($1,'analytics',$2,'cross_asset_divergence',$3,$4,$5) RETURNING id",
            uuid.uuid4(), symbol, round(score, 4), direction, json.dumps(payload),
        )
        await self._redis.sadd(f"signal_sources:{symbol}", "cross_asset_divergence")
        await self._redis.expire(f"signal_sources:{symbol}", 86400)
        await self._redis.publish("new_signal", str(sig_id))
        logger.info(
            "Cross-asset divergence: BUY %s %s (z=%.2f, score=%.2f)",
            direction.upper(), symbol,
            payload.get("z_score", 0), score,
        )

    async def _scan_pair(self, sym_a: str, sym_b: str, description: str) -> None:
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _fetch_pair_data, sym_a, sym_b)
        if data is None:
            return

        ret_a, ret_b = data
        spread = ret_a - ret_b

        # Rolling stats: use all LOOKBACK_DAYS to estimate normal spread range
        spread_mean = np.mean(spread)
        spread_std  = np.std(spread)
        if spread_std < 1e-6:
            return

        # Current spread = sum of last SPREAD_DAYS returns (cumulative divergence)
        current_spread = np.sum(spread[-SPREAD_DAYS:]) - spread_mean * SPREAD_DAYS
        z_score = current_spread / (spread_std * np.sqrt(SPREAD_DAYS))

        if abs(z_score) < Z_SCORE_TRIGGER:
            return

        # Score: higher z-score → higher conviction, capped at 0.88
        score = min(0.62 + min(abs(z_score) - Z_SCORE_TRIGGER, 2.0) * 0.07, 0.88)

        if z_score > Z_SCORE_TRIGGER:
            # asset_a overperformed — buy the laggard (asset_b)
            laggard  = sym_b
            direction = "up"
            reason    = f"{sym_a} outperformed {sym_b} by {z_score:.1f}σ — {description}"
        else:
            # asset_b overperformed — buy the laggard (asset_a)
            laggard  = sym_a
            direction = "up"
            reason    = f"{sym_b} outperformed {sym_a} by {abs(z_score):.1f}σ — {description}"

        if await self._already_signalled(laggard):
            return

        await self._publish(laggard, score, direction, {
            "pair":           f"{sym_a}/{sym_b}",
            "description":    description,
            "z_score":        round(float(z_score), 2),
            "current_spread": round(float(current_spread * 100), 3),
            "spread_mean":    round(float(spread_mean * 100), 4),
            "spread_std_1d":  round(float(spread_std * 100), 4),
            "lookback_days":  LOOKBACK_DAYS,
            "reason":         reason,
        })

    async def _scan_once(self) -> None:
        for sym_a, sym_b, desc in PAIRS:
            try:
                await self._scan_pair(sym_a, sym_b, desc)
            except Exception as exc:
                logger.warning("Pair scan error %s/%s: %s", sym_a, sym_b, exc)

    async def run(self) -> None:
        logger.info("Cross-asset divergence producer starting (%d pairs)", len(PAIRS))
        await self._connect()
        try:
            while True:
                logger.info("Scanning %d asset pairs for divergence...", len(PAIRS))
                await self._scan_once()
                logger.info("Pair scan complete — sleeping %dh", POLL_INTERVAL_S // 3600)
                await asyncio.sleep(POLL_INTERVAL_S)
        finally:
            await self._close()
