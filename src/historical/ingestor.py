"""Nightly OHLCV + macro ingestor for TimescaleDB."""
from __future__ import annotations

import asyncio
import logging
import os

import asyncpg
import pandas as pd
import pandas_ta as ta
import schedule
import time
import yfinance as yf
from fredapi import Fred

logger = logging.getLogger(__name__)

FRED_SERIES = [
    "FEDFUNDS",    # fed funds rate
    "CPIAUCSL",    # CPI
    "DCOILWTICO",  # WTI crude
    "DGS10",       # US 10Y yield
    "VIXCLS",      # VIX
    "DTWEXBGS",    # USD index
]


async def _get_symbols(database_url: str) -> list[str]:
    pool = await asyncpg.create_pool(database_url, min_size=1, max_size=2)
    try:
        rows = await pool.fetch(
            "SELECT DISTINCT symbol FROM subscriptions WHERE source IN ('news', 'analytics')"
        )
        return [r["symbol"] for r in rows]
    finally:
        await pool.close()


async def ingest_ohlcv(symbols: list[str], conn: asyncpg.Connection) -> None:
    if not symbols:
        logger.info("No symbols to ingest")
        return

    df = yf.download(symbols, period="2y", interval="1d", auto_adjust=True, group_by="ticker")
    for symbol in symbols:
        try:
            if len(symbols) == 1:
                s = df.copy()
            else:
                s = df.xs(symbol, axis=1, level=0).copy()
            s = s.dropna()
        except (KeyError, TypeError):
            logger.warning("No data for %s", symbol)
            continue

        s["rsi_14"] = ta.rsi(s["Close"], length=14)
        s["sma_20"] = ta.sma(s["Close"], length=20)
        s["sma_50"] = ta.sma(s["Close"], length=50)
        macd = ta.macd(s["Close"])
        if macd is not None and not macd.empty:
            s["macd"] = macd.iloc[:, 0]
            s["macd_signal"] = macd.iloc[:, 1]
        s["atr_14"] = ta.atr(s["High"], s["Low"], s["Close"], length=14)
        bb = ta.bbands(s["Close"], length=20)
        if bb is not None and not bb.empty:
            s["bb_upper"] = bb.iloc[:, 0]
            s["bb_lower"] = bb.iloc[:, 2]

        ohlcv_rows = []
        tech_rows = []
        for row in s.itertuples():
            ts = row.Index.to_pydatetime()
            try:
                ohlcv_rows.append((
                    ts, symbol,
                    float(row.Open), float(row.High), float(row.Low), float(row.Close),
                    int(row.Volume), "1d"
                ))
            except (AttributeError, TypeError, ValueError):
                continue

            def _f(v: object) -> float | None:
                try:
                    return float(v) if pd.notna(v) else None  # type: ignore[arg-type]
                except (TypeError, ValueError):
                    return None

            tech_rows.append((
                ts, symbol, "1d",
                _f(getattr(row, "rsi_14", None)),
                _f(getattr(row, "sma_20", None)),
                _f(getattr(row, "sma_50", None)),
                None, None,  # ema_12, ema_26
                _f(getattr(row, "macd", None)),
                _f(getattr(row, "macd_signal", None)),
                _f(getattr(row, "atr_14", None)),
                _f(getattr(row, "bb_upper", None)),
                _f(getattr(row, "bb_lower", None)),
                None,  # adx_14
            ))

        await conn.executemany(
            """INSERT INTO ohlcv (time,symbol,open,high,low,close,volume,interval)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (time,symbol,interval) DO UPDATE
               SET open=$3,high=$4,low=$5,close=$6,volume=$7""",
            ohlcv_rows,
        )
        await conn.executemany(
            """INSERT INTO technicals
               (time,symbol,interval,rsi_14,sma_20,sma_50,ema_12,ema_26,macd,macd_signal,atr_14,bb_upper,bb_lower,adx_14)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
               ON CONFLICT (time,symbol,interval) DO UPDATE
               SET rsi_14=$4,sma_20=$5,sma_50=$6,macd=$9,macd_signal=$10,atr_14=$11,bb_upper=$12,bb_lower=$13""",
            tech_rows,
        )
        logger.info("Ingested %d bars for %s", len(ohlcv_rows), symbol)


async def ingest_macro(conn: asyncpg.Connection) -> None:
    fred_key = os.getenv("FRED_API_KEY", "")
    if not fred_key:
        logger.warning("FRED_API_KEY not set — skipping macro ingest")
        return
    fred = Fred(api_key=fred_key)
    for series_id in FRED_SERIES:
        try:
            data = fred.get_series(series_id, observation_start="2020-01-01")
            rows = [
                (ts.to_pydatetime(), series_id, float(val))
                for ts, val in data.items() if pd.notna(val)
            ]
            await conn.executemany(
                """INSERT INTO macro_indicators (time,series_id,value)
                   VALUES ($1,$2,$3)
                   ON CONFLICT (time,series_id) DO UPDATE SET value=$3""",
                rows,
            )
            logger.info("Ingested %d macro points for %s", len(rows), series_id)
        except Exception as exc:
            logger.error("Failed to ingest %s: %s", series_id, exc)


async def _run_once() -> None:
    database_url = os.environ["DATABASE_URL"]
    timescale_url = os.environ["TIMESCALE_URL"]

    symbols = await _get_symbols(database_url)
    logger.info("Ingesting %d symbols", len(symbols))

    conn = await asyncpg.connect(timescale_url)
    try:
        await ingest_ohlcv(symbols, conn)
        await ingest_macro(conn)
    finally:
        await conn.close()
    logger.info("Historical ingest complete")


def _run_job() -> None:
    asyncio.run(_run_once())


def run_scheduler() -> None:
    # Run immediately on startup, then nightly at 00:30 UTC
    _run_job()
    schedule.every().day.at("00:30").do(_run_job)
    while True:
        schedule.run_pending()
        time.sleep(60)
