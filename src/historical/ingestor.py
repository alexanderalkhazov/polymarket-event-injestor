"""Nightly OHLCV + macro ingestor — writes to raw_ohlcv, raw_macro, technicals."""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import time

import asyncpg
import pandas as pd
import redis.asyncio as aioredis
import schedule
import yfinance as yf
from fredapi import Fred

logger = logging.getLogger(__name__)

BETA_TTL = 172_800  # 2 days — recomputed nightly

# FRED series IDs used by the feature store
FRED_SERIES = {
    "VIXCLS":    "VIX volatility index",
    "DCOILWTICO": "WTI crude oil",
    "DGS10":     "US 10-year Treasury yield",
    "DGS2":      "US 2-year Treasury yield",
    "FEDFUNDS":  "Federal funds rate",
    "DTWEXBGS":  "USD broad index",
}

ALL_SYMBOLS = [
    # Broad-market index ETFs
    "SPY", "QQQ", "DIA", "IWM", "VTI", "EEM", "ARKK",
    # Tech
    "AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA",
    "AMD", "INTC", "CRM", "NFLX", "PLTR", "COIN",
    # Finance
    "JPM", "BAC", "GS", "MS", "WFC", "V", "MA",
    # Healthcare
    "JNJ", "UNH", "LLY", "PFE", "ABBV", "AMGN",
    # Energy
    "XOM", "CVX", "XLE", "USO", "UNG", "LNG",
    # Metals & commodities
    "GLD", "SLV", "IAU", "GDX", "WEAT", "CORN", "DBA",
    # Bonds / rates
    "TLT", "IEF", "SHY", "HYG", "AGG", "TIP",
    # Crypto (yfinance -USD; options fields will be null — handled gracefully)
    "BTC-USD", "ETH-USD", "BNB-USD", "SOL-USD", "XRP-USD",
    "ADA-USD", "DOGE-USD", "AVAX-USD", "DOT-USD", "LINK-USD",
    "MATIC-USD", "ATOM-USD", "UNI-USD",
]  # keep in sync with src/config/market_categories.py ALL_SYMBOLS


def _symbols() -> list[str]:
    return ALL_SYMBOLS


def _lookback(backfill: bool) -> str:
    return "10y" if backfill else "5d"


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

            # ADX-14 (Wilder's smoothed Average Directional Index)
            dh = df["High"].diff()
            dl = -df["Low"].diff()
            dm_plus  = dh.where((dh > dl) & (dh > 0), 0.0)
            dm_minus = dl.where((dl > dh) & (dl > 0), 0.0)
            sm_tr    = tr.ewm(alpha=1/14, adjust=False).mean()
            di_plus  = dm_plus.ewm(alpha=1/14, adjust=False).mean() / sm_tr.replace(0, float("nan")) * 100
            di_minus = dm_minus.ewm(alpha=1/14, adjust=False).mean() / sm_tr.replace(0, float("nan")) * 100
            dx_denom = (di_plus + di_minus).replace(0, float("nan"))
            dx       = ((di_plus - di_minus).abs() / dx_denom) * 100
            df["adx_14"] = dx.ewm(alpha=1/14, adjust=False).mean()

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
                    _f(row.get("adx_14")),
                ))

            if tech_rows:
                await tsdb.executemany(
                    """INSERT INTO technicals
                       (ts, symbol, interval, rsi_14, sma_20, sma_50, ema_12, ema_26,
                        macd, macd_signal, atr_14, bb_upper, bb_lower, adx_14)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                       ON CONFLICT (ts, symbol, interval) DO UPDATE
                         SET adx_14 = EXCLUDED.adx_14
                         WHERE technicals.adx_14 IS NULL""",
                    tech_rows,
                )
                logger.info("technicals: %d rows for %s", len(tech_rows), symbol)

            time.sleep(0.5)  # avoid yfinance rate limiting

        except Exception as exc:
            logger.error("OHLCV ingest failed for %s: %s", symbol, exc)


async def compute_betas(tsdb: asyncpg.Connection) -> None:
    """Compute rolling 60-day OLS betas vs SPY and write to Redis."""
    redis_url = os.getenv("REDIS_URL", "redis://redis:6379")
    r = aioredis.from_url(redis_url)
    try:
        spy_rows = await tsdb.fetch(
            "SELECT ts, close FROM raw_ohlcv WHERE symbol='SPY' AND interval='1d' "
            "ORDER BY ts DESC LIMIT 90"
        )
        if len(spy_rows) < 20:
            logger.warning("Not enough SPY rows for beta computation")
            return
        spy_closes = pd.Series({row["ts"]: float(row["close"]) for row in spy_rows}).sort_index()
        spy_ret = spy_closes.pct_change().dropna()

        betas: dict[str, float] = {"SPY": 1.0}
        for symbol in _symbols():
            if symbol == "SPY":
                continue
            rows = await tsdb.fetch(
                "SELECT ts, close FROM raw_ohlcv WHERE symbol=$1 AND interval='1d' "
                "ORDER BY ts DESC LIMIT 90",
                symbol,
            )
            if len(rows) < 20:
                continue
            closes = pd.Series({row["ts"]: float(row["close"]) for row in rows}).sort_index()
            ret = closes.pct_change().dropna()
            aligned = pd.DataFrame({"sym": ret, "spy": spy_ret}).dropna()
            if len(aligned) < 20:
                continue
            cov = aligned["sym"].cov(aligned["spy"])
            var = aligned["spy"].var()
            betas[symbol] = round(cov / var, 4) if var > 0 else 1.0

        async with r.pipeline() as pipe:
            for sym, beta in betas.items():
                pipe.set(f"beta:{sym}", str(beta), ex=BETA_TTL)
            await pipe.execute()

        logger.info("Beta computation complete: %d symbols written to Redis", len(betas))
    except Exception as exc:
        logger.error("Beta computation failed: %s", exc)
    finally:
        await r.aclose()


async def ingest_earnings(db_url: str, symbols: list[str]) -> None:
    """Fetch 30-day earnings calendar from Finnhub, store in earnings_calendar table."""
    import httpx
    from datetime import date, timedelta

    finnhub_key = os.getenv("FINNHUB_API_KEY", "")
    if not finnhub_key:
        logger.warning("FINNHUB_API_KEY not set — skipping earnings ingest")
        return

    today = date.today()
    end   = today + timedelta(days=30)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://finnhub.io/api/v1/calendar/earnings",
                params={"from": today.isoformat(), "to": end.isoformat(), "token": finnhub_key},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.error("Finnhub earnings fetch failed: %s", exc)
        return

    ticker_set = {s.upper() for s in symbols}
    entries = data.get("earningsCalendar", [])
    conn = await asyncpg.connect(db_url)
    try:
        rows = []
        for e in entries:
            sym = (e.get("symbol") or "").upper()
            ed  = e.get("date")
            if sym not in ticker_set or not ed:
                continue
            try:
                from datetime import date as dt_date
                rows.append((sym, dt_date.fromisoformat(ed),
                             e.get("epsEstimate"), e.get("revenueEstimate")))
            except ValueError:
                continue
        if rows:
            await conn.executemany(
                """INSERT INTO earnings_calendar (symbol, earnings_date, eps_estimate, revenue_estimate)
                   VALUES ($1, $2, $3, $4)
                   ON CONFLICT (symbol, earnings_date) DO NOTHING""",
                rows,
            )
            logger.info("earnings_calendar: %d upcoming events stored", len(rows))
    except Exception as exc:
        logger.error("Earnings DB write failed: %s", exc)
    finally:
        await conn.close()


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
    database_url  = os.environ["DATABASE_URL"]
    symbols = _symbols()

    conn = await asyncpg.connect(timescale_url)
    try:
        if not backfill and await _is_fresh_db(conn):
            logger.info("Empty DB detected — running 10-year backfill automatically")
            backfill = True

        logger.info("Starting ingest: %d symbols, backfill=%s", len(symbols), backfill)
        await ingest_ohlcv(symbols, conn, backfill)
        await ingest_macro(conn)
        await compute_betas(conn)
    finally:
        await conn.close()

    await ingest_earnings(database_url, symbols)
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
