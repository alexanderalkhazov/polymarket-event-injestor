"""Nightly OHLCV + macro ingestor for TimescaleDB."""
from __future__ import annotations

import asyncio
import logging
import os

import asyncpg
import pandas as pd
import ta as talib
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

DEFAULT_SYMBOLS = [
    "AAPL", "MSFT", "NVDA", "AMZN", "TSLA", "META", "GOOGL",
    "AMD", "INTC", "NFLX", "COIN", "PLTR", "SOFI", "SPY", "QQQ",
]


def _get_symbols() -> list[str]:
    tickers_env = os.getenv("TICKERS", "")
    if tickers_env:
        return [t.strip() for t in tickers_env.split(",") if t.strip()]
    return DEFAULT_SYMBOLS


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

        s["rsi_14"] = talib.momentum.RSIIndicator(s["Close"], window=14).rsi()
        s["sma_20"] = talib.trend.SMAIndicator(s["Close"], window=20).sma_indicator()
        s["sma_50"] = talib.trend.SMAIndicator(s["Close"], window=50).sma_indicator()
        macd_ind = talib.trend.MACD(s["Close"])
        s["macd"] = macd_ind.macd()
        s["macd_signal"] = macd_ind.macd_signal()
        s["atr_14"] = talib.volatility.AverageTrueRange(s["High"], s["Low"], s["Close"], window=14).average_true_range()
        bb_ind = talib.volatility.BollingerBands(s["Close"], window=20)
        s["bb_upper"] = bb_ind.bollinger_hband()
        s["bb_lower"] = bb_ind.bollinger_lband()

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
    timescale_url = os.environ["TIMESCALE_URL"]

    symbols = _get_symbols()
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
