"""Short Squeeze Scanner.

Runs every 4 hours. For each equity symbol:
  1. Fetches short interest data (shortPercentOfFloat, shortRatio) via yfinance
  2. Reads latest RSI from TimescaleDB features table
  3. Checks Redis for recent SEC Form 4 insider buy signal (from sec-producer)
  4. Fires a gated 'short_squeeze_setup' signal when stacking conditions align:
       - Short float > 10%  (meaningful short overhang)
       - Short ratio > 3    (days to cover — slow unwind if forced)
       - RSI < 45           (not yet overbought; squeeze hasn't run yet)
       - At least ONE catalyst: insider buy OR oversold RSI < 35 OR recent news spike

Why this works: A stock with high short interest + positive catalyst forces short
sellers to buy-to-cover into a rising market (mechanics amplify the move beyond
what fundamentals alone would justify). The highest win-rate short squeezes occur
when supply of new shorts is exhausted (days-to-cover > 3) and a catalyst ignites.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Optional

import asyncpg
import redis.asyncio as aioredis
import yfinance as yf

logger = logging.getLogger(__name__)

DATABASE_URL  = os.environ["DATABASE_URL"]
TIMESCALE_URL = os.environ["TIMESCALE_URL"]
REDIS_URL     = os.environ.get("REDIS_URL", "redis://redis:6379")

POLL_INTERVAL_S      = 4 * 3600
MIN_SHORT_FLOAT      = 0.10   # 10% minimum short float
MIN_DAYS_TO_COVER    = 3.0    # days — below this unwinding is trivially fast
RSI_SQUEEZE_ENTRY    = 45.0   # RSI must be below this (squeeze hasn't run yet)
RSI_OVERSOLD         = 35.0   # stronger catalyst tier

_EQUITY_SYMBOLS = [
    "AAPL","MSFT","NVDA","GOOGL","META","AMZN","TSLA","AMD","INTC","CRM","NFLX","PLTR","COIN",
    "JPM","BAC","GS","MS","WFC","V","MA",
    "JNJ","UNH","LLY","PFE","ABBV","AMGN",
    "XOM","CVX","LNG",
]


def _fetch_short_data(symbol: str) -> dict:
    try:
        info = yf.Ticker(symbol).info or {}
        return {
            "short_pct_float": float(info.get("shortPercentOfFloat") or 0),
            "short_ratio":     float(info.get("shortRatio") or 0),
            "short_shares":    int(info.get("sharesShort") or 0),
            "price":           float(info.get("regularMarketPrice") or info.get("previousClose") or 0),
        }
    except Exception as exc:
        logger.debug("Short data error for %s: %s", symbol, exc)
        return {"short_pct_float": 0, "short_ratio": 0, "short_shares": 0, "price": 0}


class ShortSqueezeProducer:
    def __init__(self) -> None:
        self._appdb:  Optional[asyncpg.Connection] = None
        self._tsdb:   Optional[asyncpg.Connection] = None
        self._redis:  Optional[aioredis.Redis]      = None

    async def _connect(self) -> None:
        self._appdb = await asyncpg.connect(DATABASE_URL)
        self._tsdb  = await asyncpg.connect(TIMESCALE_URL)
        self._redis = await aioredis.from_url(REDIS_URL, decode_responses=True)

    async def _close(self) -> None:
        for c in (self._appdb, self._tsdb):
            if c: await c.close()
        if self._redis: await self._redis.aclose()

    async def _get_rsi(self, symbol: str) -> Optional[float]:
        row = await self._tsdb.fetchrow(
            "SELECT rsi_14 FROM features WHERE symbol=$1 ORDER BY ts DESC LIMIT 1", symbol
        )
        return float(row["rsi_14"]) if row and row["rsi_14"] else None

    async def _has_recent_insider_buy(self, symbol: str) -> bool:
        """Check if SEC Form 4 producer published a buy signal for this symbol in last 5 days."""
        row = await self._appdb.fetchval(
            """SELECT id FROM signals
               WHERE source='analytics' AND symbol=$1
                 AND type IN ('insider_buy','form4_buy')
                 AND created_at > NOW() - INTERVAL '5 days'
               LIMIT 1""",
            symbol,
        )
        return row is not None

    async def _already_signalled(self, symbol: str) -> bool:
        row = await self._appdb.fetchval(
            """SELECT id FROM signals WHERE source='analytics' AND symbol=$1
               AND type='short_squeeze_setup' AND created_at > NOW() - INTERVAL '8 hours'
               LIMIT 1""",
            symbol,
        )
        return row is not None

    async def _publish(self, symbol: str, score: float, payload: dict) -> None:
        sig_id = await self._appdb.fetchval(
            "INSERT INTO signals (id,source,symbol,type,score,direction,payload) "
            "VALUES ($1,'analytics',$2,'short_squeeze_setup',$3,'up',$4) RETURNING id",
            uuid.uuid4(), symbol, round(score, 4), json.dumps(payload),
        )
        await self._redis.sadd(f"signal_sources:{symbol}", "short_squeeze_setup")
        await self._redis.expire(f"signal_sources:{symbol}", 86400)
        await self._redis.publish("new_signal", str(sig_id))
        logger.info(
            "Short squeeze setup: %s score=%.2f short_float=%.1f%% days_cover=%.1f",
            symbol, score,
            payload.get("short_pct_float", 0) * 100,
            payload.get("short_ratio", 0),
        )

    async def _scan_once(self) -> None:
        loop = asyncio.get_event_loop()

        for symbol in _EQUITY_SYMBOLS:
            try:
                data = await loop.run_in_executor(None, _fetch_short_data, symbol)
                short_pct  = data["short_pct_float"]
                short_days = data["short_ratio"]

                if short_pct < MIN_SHORT_FLOAT or short_days < MIN_DAYS_TO_COVER:
                    continue

                rsi = await self._get_rsi(symbol)
                if rsi is None or rsi > RSI_SQUEEZE_ENTRY:
                    continue

                has_insider = await self._has_recent_insider_buy(symbol)
                is_oversold = rsi < RSI_OVERSOLD

                # Need at least one catalyst beyond just high short interest
                if not has_insider and not is_oversold:
                    continue

                if await self._already_signalled(symbol):
                    continue

                # Score: base on how crowded the short is + how oversold
                # High days-to-cover + oversold + insider = highest conviction
                catalyst_bonus = 0.0
                if has_insider: catalyst_bonus += 0.07
                if is_oversold: catalyst_bonus += 0.05
                short_intensity = min((short_pct - MIN_SHORT_FLOAT) / 0.20, 1.0) * 0.10
                cover_bonus     = min((short_days - MIN_DAYS_TO_COVER) / 7.0, 1.0) * 0.08

                score = 0.65 + short_intensity + cover_bonus + catalyst_bonus
                score = min(score, 0.92)

                await self._publish(symbol, score, {
                    "short_pct_float":    round(short_pct, 4),
                    "short_ratio":        round(short_days, 1),
                    "short_shares":       data["short_shares"],
                    "rsi_14":             round(rsi, 1),
                    "has_insider_buy":    has_insider,
                    "is_oversold":        is_oversold,
                    "current_price":      data["price"],
                })

            except Exception as exc:
                logger.warning("Short squeeze scan error for %s: %s", symbol, exc)

    async def run(self) -> None:
        logger.info("Short squeeze scanner starting (interval: %dh)", POLL_INTERVAL_S // 3600)
        await self._connect()
        try:
            while True:
                logger.info("Scanning %d symbols for squeeze setups...", len(_EQUITY_SYMBOLS))
                await self._scan_once()
                logger.info("Squeeze scan complete — sleeping %dh", POLL_INTERVAL_S // 3600)
                await asyncio.sleep(POLL_INTERVAL_S)
        finally:
            await self._close()
