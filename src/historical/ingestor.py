"""Nightly OHLCV + macro ingestor — writes to raw_ohlcv, raw_macro, technicals."""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import time

import asyncpg
import pandas as pd
import schedule
import yfinance as yf
from fredapi import Fred

logger = logging.getLogger(__name__)

# FRED series IDs used by the feature store
FRED_SERIES = {
    "VIXCLS":    "VIX volatility index",
    "DCOILWTICO": "WTI crude oil",
    "DGS10":     "US 10-year Treasury yield",
    "FEDFUNDS":  "Federal funds rate",
    "DTWEXBGS":  "USD broad index",
}

ALL_SYMBOLS = [
    "USO", "XOM", "XLE", "LNG",          # oil_energy
    "SPY", "QQQ", "AAPL", "MSFT", "NVDA", # us_equities
    "GLD", "SLV", "UNG", "WEAT",          # commodities/rates_macro
    "TLT",
]

DEV_SYMBOLS = ["USO", "SPY", "QQQ"]


def _symbols() -> list[str]:
    if os.getenv("DEV_MODE", "false").lower() == "true":
        return DEV_SYMBOLS
    return ALL_SYMBOLS


def _lookback(backfill: bool) -> str:
    if backfill:
        return "6mo" if os.getenv("DEV_MODE", "false").lower() == "true" else "10y"
    return "5d"


async def ingest_ohlcv(symbols: list[str], tsdb: asyncpg.Connection, backfill: bool) -> None:
    period = _lookback(backfill)
    logger.info("Downloading OHLCV: %d symbols, period=%s", len(symbols), period)

    for symbol in symbols:
        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(period=period, interval="1d", auto_adjust=True)
            if df.empty:
                logger.warning("No daily data for %s", symbol)
                continue

            ohlcv_rows = []
            for idx, row in df.iterrows():
                ts = pd.Timestamp(idx).to_pydatetime()
                try:
                    ohlcv_rows.append((
                        ts, symbol, "1d",
                        float(row["Open"]), float(row["High"]),
                        float(row["Low"]), float(row["Close"]),
                        int(row["Volume"]),
                    ))
                except (TypeError, ValueError):
                    continue

            if ohlcv_rows:
                await tsdb.executemany(
                    """INSERT INTO raw_ohlcv (ts, symbol, interval, open, high, low, close, volume)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                       ON CONFLICT (ts, symbol, interval) DO NOTHING""",
                    ohlcv_rows,
                )
                logger.info("raw_ohlcv: %d bars for %s", len(ohlcv_rows), symbol)

            # Compute and store technicals (inline — no pandas-ta dependency)
            delta = df["Close"].diff()
            gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
            loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
            df["rsi_14"] = 100 - 100 / (1 + gain / loss)

            df["sma_20"] = df["Close"].rolling(20).mean()
            df["sma_50"] = df["Close"].rolling(50).mean()
            df["ema_12"] = df["Close"].ewm(span=12, adjust=False).mean()
            df["ema_26"] = df["Close"].ewm(span=26, adjust=False).mean()
            macd_line = df["ema_12"] - df["ema_26"]
            df["macd"] = macd_line
            df["macd_signal"] = macd_line.ewm(span=9, adjust=False).mean()

            high_low   = df["High"] - df["Low"]
            high_close = (df["High"] - df["Close"].shift()).abs()
            low_close  = (df["Low"]  - df["Close"].shift()).abs()
            tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
            df["atr_14"] = tr.ewm(alpha=1 / 14, adjust=False).mean()

            bb_mid = df["Close"].rolling(20).mean()
            bb_std = df["Close"].rolling(20).std()
            df["bb_upper"] = bb_mid + 2 * bb_std
            df["bb_lower"] = bb_mid - 2 * bb_std

            tech_rows = []
            for idx, row in df.iterrows():
                ts = pd.Timestamp(idx).to_pydatetime()
                def _f(v: object) -> float | None:
                    try:
                        return float(v) if pd.notna(v) else None  # type: ignore[arg-type]
                    except (TypeError, ValueError):
                        return None

                tech_rows.append((
                    ts, symbol, "1d",
                    _f(row.get("rsi_14")), _f(row.get("sma_20")), _f(row.get("sma_50")),
                    _f(row.get("ema_12")), _f(row.get("ema_26")),
                    _f(row.get("macd")), _f(row.get("macd_signal")),
                    _f(row.get("atr_14")), _f(row.get("bb_upper")), _f(row.get("bb_lower")),
                    None,  # adx_14 — skipped for now
                ))

            if tech_rows:
                await tsdb.executemany(
                    """INSERT INTO technicals
                       (ts, symbol, interval, rsi_14, sma_20, sma_50, ema_12, ema_26,
                        macd, macd_signal, atr_14, bb_upper, bb_lower, adx_14)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                       ON CONFLICT (ts, symbol, interval) DO NOTHING""",
                    tech_rows,
                )
                logger.info("technicals: %d rows for %s", len(tech_rows), symbol)

            time.sleep(0.5)  # avoid yfinance rate limiting

        except Exception as exc:
            logger.error("OHLCV ingest failed for %s: %s", symbol, exc)


async def ingest_macro(tsdb: asyncpg.Connection) -> None:
    fred_key = os.getenv("FRED_API_KEY", "")
    if not fred_key:
        logger.warning("FRED_API_KEY not set — skipping macro ingest")
        return
    fred = Fred(api_key=fred_key)
    for series_id, desc in FRED_SERIES.items():
        try:
            data = fred.get_series(series_id, observation_start="2014-01-01")
            rows = [
                (ts.to_pydatetime(), series_id, float(val))
                for ts, val in data.items() if pd.notna(val)
            ]
            await tsdb.executemany(
                """INSERT INTO raw_macro (ts, series_id, value)
                   VALUES ($1, $2, $3)
                   ON CONFLICT (ts, series_id) DO NOTHING""",
                rows,
            )
            logger.info("raw_macro: %d points for %s (%s)", len(rows), series_id, desc)
        except Exception as exc:
            logger.error("Macro ingest failed for %s: %s", series_id, exc)


async def _is_fresh_db(conn: asyncpg.Connection) -> bool:
    """Return True if raw_ohlcv is empty — indicates a clean volume, needs backfill."""
    count = await conn.fetchval("SELECT COUNT(*) FROM raw_ohlcv")
    return count == 0


async def run_once(backfill: bool = False) -> None:
    timescale_url = os.environ["TIMESCALE_URL"]
    symbols = _symbols()

    conn = await asyncpg.connect(timescale_url)
    try:
        if not backfill and await _is_fresh_db(conn):
            logger.info("Empty DB detected — running 10-year backfill automatically")
            backfill = True

        logger.info("Starting ingest: %d symbols, backfill=%s", len(symbols), backfill)
        await ingest_ohlcv(symbols, conn, backfill)
        await ingest_macro(conn)
    finally:
        await conn.close()
    logger.info("Historical ingest complete")


def _run_job() -> None:
    asyncio.run(run_once(backfill=False))


def run_scheduler() -> None:
    _run_job()
    schedule.every().day.at("01:00").do(_run_job)
    while True:
        schedule.run_pending()
        time.sleep(60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--backfill", action="store_true",
                        help="Pull full history instead of yesterday only")
    args = parser.parse_args()

    logging.basicConfig(level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO), format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
    asyncio.run(run_once(backfill=args.backfill))
