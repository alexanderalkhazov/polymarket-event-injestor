"""Gamma Exposure (GEX) Producer.

Runs every 30 minutes. For each symbol with active options:
  1. Fetches options chain (3 nearest expiries) via yfinance
  2. Computes net dollar GEX using Black-Scholes gamma:
       GEX = Σ(call_gamma × call_OI - put_gamma × put_OI) × 100 × spot
  3. Stores result in Redis as gex:{symbol} (float string, expires 1h)
  4. Fires signals when microstructure conditions are tradeable:
       - gex_squeeze_setup : GEX is negative AND price trending up
                             Dealers are short gamma — they MUST buy as price rises,
                             mechanically amplifying any upward move or short squeeze.
       - gex_pinning       : GEX is large positive AND price is within 1 ATR of
                             max-gamma strike — dealers pin price at expiry.

GEX sign convention (standard options dealer perspective):
  Positive  → dealers net long gamma → buy dips, sell rips → price-stabilising
  Negative  → dealers net short gamma → buy rallies, sell dips → vol-amplifying
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import asyncpg
import numpy as np
import redis.asyncio as aioredis
import yfinance as yf
from scipy.stats import norm

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL    = os.environ.get("REDIS_URL", "redis://redis:6379")

POLL_INTERVAL_S = 30 * 60   # 30 minutes — intraday is sufficient
RISK_FREE_RATE  = 0.05       # 5% — update periodically

# Symbols with liquid options markets — skip pure ETFs and micro-caps
_OPTIONS_SYMBOLS = [
    "SPY", "QQQ", "IWM",
    "AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA", "AMD",
    "NFLX", "CRM", "PLTR", "COIN",
    "JPM", "BAC", "GS", "MS",
    "JNJ", "UNH", "LLY",
    "XOM", "CVX",
    "GLD", "TLT",
    "BTC-USD", "ETH-USD",
]

# Min open interest per contract to include in GEX (filter noise)
MIN_OI = 50


def _bs_gamma(S: float, K: float, T: float, sigma: float, r: float = RISK_FREE_RATE) -> float:
    """Black-Scholes gamma for a European option (call == put gamma)."""
    if T < 1 / 365 or sigma < 0.01 or S <= 0 or K <= 0:
        return 0.0
    try:
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
        return float(norm.pdf(d1)) / (S * sigma * math.sqrt(T))
    except Exception:
        return 0.0


def _compute_gex(symbol: str) -> tuple[float, float, float]:
    """Return (net_gex, spot, max_gamma_strike).

    net_gex is in $ — the dollar move in dealers' delta per 1% move in spot.
    """
    t = yf.Ticker(symbol)
    exps = t.options
    if not exps:
        return 0.0, 0.0, 0.0

    hist = t.history(period="2d")
    if hist.empty:
        return 0.0, 0.0, 0.0
    spot = float(hist["Close"].iloc[-1])
    if spot <= 0:
        return 0.0, 0.0, 0.0

    now = datetime.now(timezone.utc).date()
    total_gex   = 0.0
    strike_gex: dict[float, float] = {}

    for exp_str in exps[:3]:
        try:
            exp_date = datetime.strptime(exp_str, "%Y-%m-%d").date()
        except ValueError:
            continue
        T = (exp_date - now).days / 365.0
        if T <= 0:
            continue

        chain = t.option_chain(exp_str)

        for _, row in chain.calls.iterrows():
            K  = float(row.get("strike") or 0)
            iv = float(row.get("impliedVolatility") or 0)
            oi = int(row.get("openInterest") or 0)
            if K <= 0 or iv <= 0 or oi < MIN_OI:
                continue
            g   = _bs_gamma(spot, K, T, iv)
            gex = g * oi * 100 * spot
            total_gex += gex
            strike_gex[K] = strike_gex.get(K, 0.0) + gex

        for _, row in chain.puts.iterrows():
            K  = float(row.get("strike") or 0)
            iv = float(row.get("impliedVolatility") or 0)
            oi = int(row.get("openInterest") or 0)
            if K <= 0 or iv <= 0 or oi < MIN_OI:
                continue
            g   = _bs_gamma(spot, K, T, iv)
            gex = g * oi * 100 * spot
            total_gex -= gex
            strike_gex[K] = strike_gex.get(K, 0.0) - gex

    max_gamma_strike = max(strike_gex, key=lambda k: abs(strike_gex[k])) if strike_gex else spot
    return total_gex, spot, max_gamma_strike


class GammaProducer:
    def __init__(self) -> None:
        self._db: Optional[asyncpg.Connection] = None
        self._redis: Optional[aioredis.Redis] = None

    async def _connect(self) -> None:
        self._db    = await asyncpg.connect(DATABASE_URL)
        self._redis = await aioredis.from_url(REDIS_URL, decode_responses=True)

    async def _close(self) -> None:
        if self._db:   await self._db.close()
        if self._redis: await self._redis.aclose()

    async def _already_signalled(self, symbol: str, sig_type: str, window: str = "2 hours") -> bool:
        row = await self._db.fetchval(
            f"SELECT id FROM signals WHERE source='analytics' AND symbol=$1 AND type=$2 "
            f"AND created_at > NOW() - INTERVAL '{window}' LIMIT 1",
            symbol, sig_type,
        )
        return row is not None

    async def _publish(self, symbol: str, sig_type: str, score: float,
                       direction: str, payload: dict) -> None:
        sig_id = await self._db.fetchval(
            "INSERT INTO signals (id,source,symbol,type,score,direction,payload) "
            "VALUES ($1,'analytics',$2,$3,$4,$5,$6) RETURNING id",
            uuid.uuid4(), symbol, sig_type, round(score, 4),
            direction, json.dumps(payload),
        )
        # Register channel name BEFORE publishing so correlator multi-source
        # count is already ≥1 when it processes the message.
        await self._redis.sadd(f"signal_sources:{symbol}", sig_type)
        await self._redis.expire(f"signal_sources:{symbol}", 86400)
        await self._redis.publish("new_signal", str(sig_id))
        logger.info("GEX signal: %s %s %s (score=%.2f)", sig_type, direction.upper(), symbol, score)

    async def _scan_once(self) -> None:
        loop = asyncio.get_event_loop()

        for symbol in _OPTIONS_SYMBOLS:
            try:
                gex, spot, pin_strike = await loop.run_in_executor(
                    None, _compute_gex, symbol
                )
                if spot <= 0:
                    continue

                # Store GEX in Redis for regime detection by the correlator
                await self._redis.setex(f"gex:{symbol}", 3600, str(round(gex, 2)))

                # ── Signal 1: GEX Squeeze Amplifier ───────────────────────────
                # Negative GEX = dealers short gamma.  Price must move up to trigger
                # buying pressure from dealers re-hedging their delta.
                if gex < 0:
                    # Confirm upward price momentum using recent OHLCV data
                    hist = await loop.run_in_executor(
                        None, lambda s=symbol: yf.Ticker(s).history(period="5d")
                    )
                    if not hist.empty and len(hist) >= 2:
                        ret_1d = (hist["Close"].iloc[-1] - hist["Close"].iloc[-2]) / hist["Close"].iloc[-2]
                        if ret_1d > 0 and not await self._already_signalled(symbol, "gex_squeeze_setup"):
                            gex_pct = abs(gex) / (spot * 1e6)  # normalise per $1M market cap
                            score = min(0.68 + min(gex_pct * 10, 0.18), 0.88)
                            await self._publish(
                                symbol=symbol,
                                sig_type="gex_squeeze_setup",
                                score=score,
                                direction="up",
                                payload={
                                    "net_gex": round(gex, 0),
                                    "spot": round(spot, 2),
                                    "pin_strike": round(pin_strike, 2),
                                    "ret_1d_pct": round(ret_1d * 100, 2),
                                    "dealer_gamma": "negative",
                                },
                            )

                # ── Signal 2: Max Gamma Pin ────────────────────────────────────
                # Large positive GEX near current price → market makers act as a
                # gravitational pull toward the peak-OI strike heading into expiry.
                # Trade: sell the wings, play for pinning to max_gamma_strike.
                elif gex > 0:
                    dist_pct = abs(spot - pin_strike) / spot
                    # Only fire when price is within 0.8% of the max gamma strike
                    # and GEX is large relative to the market
                    gex_magnitude = gex / (spot * 1e6)
                    if dist_pct < 0.008 and gex_magnitude > 0.5:
                        if not await self._already_signalled(symbol, "gex_pinning", window="4 hours"):
                            direction = "up" if spot < pin_strike else "down"
                            score = min(0.65 + dist_pct * 10, 0.80)
                            await self._publish(
                                symbol=symbol,
                                sig_type="gex_pinning",
                                score=score,
                                direction=direction,
                                payload={
                                    "net_gex": round(gex, 0),
                                    "spot": round(spot, 2),
                                    "pin_strike": round(pin_strike, 2),
                                    "distance_pct": round(dist_pct * 100, 3),
                                    "dealer_gamma": "positive",
                                },
                            )

            except Exception as exc:
                logger.debug("GEX error for %s: %s", symbol, exc)

    async def run(self) -> None:
        logger.info("Gamma producer starting (interval: %dm)", POLL_INTERVAL_S // 60)
        await self._connect()
        try:
            while True:
                logger.info("Scanning GEX for %d symbols...", len(_OPTIONS_SYMBOLS))
                await self._scan_once()
                logger.info("GEX scan complete — sleeping %dm", POLL_INTERVAL_S // 60)
                await asyncio.sleep(POLL_INTERVAL_S)
        finally:
            await self._close()
