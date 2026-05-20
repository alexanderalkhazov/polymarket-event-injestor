"""Earnings alpha producer.

Runs every 4 hours. Generates two types of high-edge signals:

  earnings_setup  — Pre-earnings play: company has ≥75% beat rate over last 4
                    quarters AND earnings are 5–21 days away. Strong historical
                    alpha: stocks with consistent beat histories drift up into
                    the print as buy-side builds positions.

  earnings_drift  — Post-earnings drift: company beat EPS by >5% within the
                    last 3 days. A large beat almost always produces a 3–10 day
                    drift as the market slowly reprices the new earnings power.

Writes directly to PostgreSQL signals table and publishes signal IDs to
Redis new_signal channel (same path as all other consumers).  Uses source
'analytics' to satisfy the DB CHECK constraint.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import asyncpg
import redis.asyncio as aioredis
import yfinance as yf

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL    = os.environ.get("REDIS_URL", "redis://redis:6379")

# Run interval — 4 hours (earnings don't change minute-to-minute)
POLL_INTERVAL_S = 4 * 3600

# All equity symbols to scan (no ETFs, no crypto — earnings logic only applies
# to individual companies)
_EQUITY_SYMBOLS = [
    "AAPL","MSFT","NVDA","GOOGL","META","AMZN","TSLA","AMD","INTC","CRM","NFLX","PLTR","COIN",
    "JPM","BAC","GS","MS","WFC","V","MA",
    "JNJ","UNH","LLY","PFE","ABBV","AMGN",
    "XOM","CVX","LNG",
]

# Minimum beat rate over last 4 quarters to qualify for pre-earnings setup
MIN_BEAT_RATE   = 0.75   # ≥ 3 of last 4 quarters beat EPS estimate
# Window for pre-earnings signal (days before report)
SETUP_MIN_DAYS  = 5
SETUP_MAX_DAYS  = 21
# Minimum % EPS surprise (actual - estimate) / |estimate| to qualify for drift
DRIFT_MIN_SURPRISE = 0.05   # 5% beat
# Window after earnings to still count as drift opportunity
DRIFT_MAX_DAYS  = 3


def _get_earnings_data(symbol: str) -> dict:
    """Return earnings info for symbol via yfinance.

    Returns dict with:
      next_date       — datetime or None
      last_date       — datetime or None
      beat_rate       — float 0–1 over last 4 quarters (None if insufficient)
      last_surprise   — float (actual - estimate) / |estimate| or None
    """
    try:
        t = yf.Ticker(symbol)
        cal = t.calendar  # dict with "Earnings Date" key
        hist_eps = t.earnings_history  # DataFrame

        # Next earnings date
        next_date = None
        if cal is not None and "Earnings Date" in cal:
            dates = cal["Earnings Date"]
            if hasattr(dates, "__iter__"):
                future = [d for d in dates if hasattr(d, "date") and d.date() >= datetime.now(timezone.utc).date()]
                if future:
                    next_date = min(future)
            elif hasattr(dates, "date"):
                if dates.date() >= datetime.now(timezone.utc).date():
                    next_date = dates

        # Historical EPS surprise
        beat_rate = None
        last_surprise = None
        last_date = None

        if hist_eps is not None and not hist_eps.empty:
            # yfinance columns: epsActual, epsEstimate, epsDifference, surprisePercent
            df = hist_eps.copy()
            df = df.dropna(subset=["epsActual", "epsEstimate"])
            if len(df) >= 1:
                last_row = df.iloc[0]
                try:
                    last_date = last_row.name.to_pydatetime().replace(tzinfo=timezone.utc)
                except Exception:
                    last_date = None
                est = float(last_row.get("epsEstimate", 0) or 0)
                act = float(last_row.get("epsActual", 0) or 0)
                if est != 0:
                    last_surprise = (act - est) / abs(est)

            # Beat rate over last 4 quarters
            recent = df.head(4)
            if len(recent) >= 2:
                beats = 0
                for _, row in recent.iterrows():
                    est = float(row.get("epsEstimate", 0) or 0)
                    act = float(row.get("epsActual", 0) or 0)
                    if est != 0 and act > est:
                        beats += 1
                beat_rate = beats / len(recent)

        return {
            "next_date":     next_date,
            "last_date":     last_date,
            "beat_rate":     beat_rate,
            "last_surprise": last_surprise,
        }
    except Exception as exc:
        logger.debug("yfinance error for %s: %s", symbol, exc)
        return {"next_date": None, "last_date": None, "beat_rate": None, "last_surprise": None}


def _get_price(symbol: str) -> Optional[float]:
    try:
        t = yf.Ticker(symbol)
        hist = t.history(period="2d")
        if not hist.empty:
            return float(hist["Close"].iloc[-1])
    except Exception:
        pass
    return None


class EarningsProducer:
    def __init__(self) -> None:
        self._db: Optional[asyncpg.Connection] = None
        self._redis: Optional[aioredis.Redis] = None

    async def _connect(self) -> None:
        self._db    = await asyncpg.connect(DATABASE_URL)
        self._redis = await aioredis.from_url(REDIS_URL, decode_responses=True)

    async def _close(self) -> None:
        if self._db:
            await self._db.close()
        if self._redis:
            await self._redis.aclose()

    async def _already_signalled(self, symbol: str, sig_type: str) -> bool:
        """Return True if we already published this signal type for this symbol today."""
        row = await self._db.fetchval(
            """SELECT id FROM signals
               WHERE source = 'analytics'
                 AND symbol = $1
                 AND type   = $2
                 AND created_at > NOW() - INTERVAL '12 hours'
               LIMIT 1""",
            symbol, sig_type,
        )
        return row is not None

    async def _publish(
        self,
        symbol: str,
        sig_type: str,
        score: float,
        direction: str,
        payload: dict,
    ) -> None:
        """Insert signal row and publish to Redis new_signal channel."""
        sig_id = await self._db.fetchval(
            """INSERT INTO signals (id, source, symbol, type, score, direction, payload)
               VALUES ($1, 'analytics', $2, $3, $4, $5, $6)
               RETURNING id""",
            uuid.uuid4(), symbol, sig_type, round(score, 4),
            direction, json.dumps(payload),
        )
        await self._redis.publish("new_signal", str(sig_id))
        logger.info(
            "Published %s signal — %s %s (score=%.2f)",
            sig_type, direction.upper(), symbol, score,
        )

    async def _scan_once(self) -> None:
        now = datetime.now(timezone.utc)

        for symbol in _EQUITY_SYMBOLS:
            try:
                data = await asyncio.get_event_loop().run_in_executor(
                    None, _get_earnings_data, symbol
                )

                # ── Pre-earnings setup ─────────────────────────────────────────
                next_dt = data["next_date"]
                beat_rate = data["beat_rate"]

                if next_dt is not None and beat_rate is not None:
                    if hasattr(next_dt, "tzinfo") and next_dt.tzinfo is None:
                        next_dt = next_dt.replace(tzinfo=timezone.utc)
                    days_to_earnings = (next_dt.date() - now.date()).days

                    if SETUP_MIN_DAYS <= days_to_earnings <= SETUP_MAX_DAYS and beat_rate >= MIN_BEAT_RATE:
                        if not await self._already_signalled(symbol, "earnings_setup"):
                            # Score scales with beat rate and proximity to earnings
                            # Closer = higher urgency (but not so close it's inside noise window)
                            proximity_bonus = max(0, (SETUP_MAX_DAYS - days_to_earnings) / SETUP_MAX_DAYS)
                            score = 0.70 + beat_rate * 0.15 + proximity_bonus * 0.10

                            price = await asyncio.get_event_loop().run_in_executor(
                                None, _get_price, symbol
                            )
                            await self._publish(
                                symbol=symbol,
                                sig_type="earnings_setup",
                                score=min(score, 0.92),
                                direction="up",
                                payload={
                                    "beat_rate": round(beat_rate, 2),
                                    "days_to_earnings": days_to_earnings,
                                    "earnings_date": str(next_dt.date()),
                                    "current_price": price,
                                    "quarters_sampled": 4,
                                },
                            )

                # ── Post-earnings drift ────────────────────────────────────────
                last_dt = data["last_date"]
                last_surprise = data["last_surprise"]

                if last_dt is not None and last_surprise is not None:
                    if hasattr(last_dt, "tzinfo") and last_dt.tzinfo is None:
                        last_dt = last_dt.replace(tzinfo=timezone.utc)
                    days_since = (now.date() - last_dt.date()).days

                    if 0 <= days_since <= DRIFT_MAX_DAYS and last_surprise >= DRIFT_MIN_SURPRISE:
                        if not await self._already_signalled(symbol, "earnings_drift"):
                            # Score scales with surprise magnitude
                            # 5% beat → 0.72, 20%+ beat → 0.88
                            score = min(0.72 + last_surprise * 0.80, 0.90)

                            price = await asyncio.get_event_loop().run_in_executor(
                                None, _get_price, symbol
                            )
                            await self._publish(
                                symbol=symbol,
                                sig_type="earnings_drift",
                                score=score,
                                direction="up",
                                payload={
                                    "eps_surprise_pct": round(last_surprise * 100, 1),
                                    "days_since_earnings": days_since,
                                    "earnings_date": str(last_dt.date()),
                                    "current_price": price,
                                },
                            )

            except Exception as exc:
                logger.warning("Error scanning %s: %s", symbol, exc)

    async def run(self) -> None:
        logger.info("Earnings alpha producer starting (poll interval: %dh)", POLL_INTERVAL_S // 3600)
        await self._connect()
        try:
            while True:
                logger.info("Scanning %d equity symbols for earnings signals...", len(_EQUITY_SYMBOLS))
                await self._scan_once()
                logger.info("Scan complete — sleeping %dh", POLL_INTERVAL_S // 3600)
                await asyncio.sleep(POLL_INTERVAL_S)
        finally:
            await self._close()
