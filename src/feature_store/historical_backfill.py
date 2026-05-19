"""Historical feature backfill — generates labeled training data from existing OHLCV history.

Reads from raw_ohlcv + raw_macro (already populated by the historical ingestor),
computes all 31 technical features in pure pandas (no per-row queries, no lookahead),
and bulk-inserts into the features table with forward_return labels.

Result: thousands of labeled rows from day 1, so XGBoost trains immediately.

Run once:
  docker compose run --rm feature-builder python -m feature_store.historical_backfill

Or locally:
  TIMESCALE_URL=postgresql://postgres:postgres@localhost:5433/market_history \
  python -m feature_store.historical_backfill
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
from datetime import timezone

import asyncpg
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

SYMBOLS = [
    # US equities
    "SPY", "QQQ", "IWM",
    "AAPL", "MSFT", "NVDA", "TSLA", "META", "GOOGL", "AMZN", "AMD", "NFLX",
    "INTC", "CRM", "PLTR", "COIN",
    # Energy & commodities
    "USO", "XOM", "XLE", "LNG",
    "GLD", "SLV", "UNG", "WEAT",
    # Rates
    "TLT",
]
BACKFILL_YEARS = int(os.getenv("BACKFILL_YEARS", "5"))
TIMESCALE_URL  = os.getenv(
    "TIMESCALE_URL",
    "postgresql://postgres:postgres@localhost:5433/market_history",
)

MACRO_SERIES = ["VIXCLS", "DCOILWTICO", "DGS10", "DGS2", "FEDFUNDS", "DTWEXBGS"]


# ── Technical indicator math (all vectorized, newest-last convention) ──────────

def _rsi(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    gain = d.clip(lower=0).rolling(n).mean()
    loss = (-d).clip(lower=0).rolling(n).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def _atr(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14) -> pd.Series:
    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low  - close.shift()).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()


def _adx(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14) -> pd.Series:
    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low  - close.shift()).abs(),
    ], axis=1).max(axis=1)
    dh = high.diff()
    dl = -low.diff()
    dm_plus  = dh.where((dh > dl) & (dh > 0), 0.0)
    dm_minus = dl.where((dl > dh) & (dl > 0), 0.0)
    atr_s    = tr.ewm(alpha=1 / n, adjust=False).mean()
    di_plus  = dm_plus.ewm(alpha=1 / n, adjust=False).mean() / atr_s.replace(0, np.nan) * 100
    di_minus = dm_minus.ewm(alpha=1 / n, adjust=False).mean() / atr_s.replace(0, np.nan) * 100
    denom    = (di_plus + di_minus).replace(0, np.nan)
    dx       = (di_plus - di_minus).abs() / denom * 100
    return dx.ewm(alpha=1 / n, adjust=False).mean()


def _macd_histogram(close: pd.Series) -> pd.Series:
    macd   = close.ewm(span=12, adjust=False).mean() - close.ewm(span=26, adjust=False).mean()
    signal = macd.ewm(span=9, adjust=False).mean()
    return macd - signal


def _hv(close: pd.Series, n: int = 20) -> pd.Series:
    log_ret = np.log(close / close.shift(1))
    return log_ret.rolling(n).std() * math.sqrt(252)


def _stoch_k(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14) -> pd.Series:
    h_max = high.rolling(n).max()
    l_min = low.rolling(n).min()
    return (close - l_min) / (h_max - l_min).replace(0, np.nan) * 100


def _build_features(df: pd.DataFrame, macro_daily: pd.DataFrame) -> pd.DataFrame:
    """Compute all 31 features from OHLCV + macro. Returns a tidy DataFrame."""
    c = df["close"]
    h = df["high"]
    lo = df["low"]
    v = df["volume"]

    sma20  = c.rolling(20).mean()
    sma50  = c.rolling(50).mean()
    std20  = c.rolling(20).std()
    bb_upper = sma20 + 2 * std20
    bb_lower = sma20 - 2 * std20
    atr14  = _atr(h, lo, c, 14)

    feat = pd.DataFrame(index=df.index)

    # Technical
    feat["rsi_14"]           = _rsi(c)
    feat["macd_histogram"]   = _macd_histogram(c)
    feat["atr_14"]           = atr14
    feat["adx_14"]           = _adx(h, lo, c)
    feat["bb_position"]      = (c - bb_lower) / (bb_upper - bb_lower).replace(0, np.nan)
    feat["bb_width"]         = (bb_upper - bb_lower) / sma20.replace(0, np.nan)
    feat["sma_20_slope"]     = (sma20 - sma20.shift(1)) / sma20.shift(1).replace(0, np.nan)
    feat["price_vs_sma50"]   = c / sma50.replace(0, np.nan) - 1
    feat["vol_ratio_30d"]    = v / v.rolling(30).mean().replace(0, np.nan)
    feat["price_change_1d"]  = c.pct_change(1)
    feat["price_change_5d"]  = c.pct_change(5)
    feat["atr_pct"]          = atr14 / c.replace(0, np.nan)
    feat["hv_20"]            = _hv(c)
    feat["price_vs_52w_high"] = c / h.rolling(252).max().replace(0, np.nan) - 1
    feat["stoch_k"]          = _stoch_k(h, lo, c)

    # Macro (forward-filled daily from FRED)
    for col in ["vix_level", "wti_crude", "us_10y_yield",
                "fed_funds_rate", "usd_index", "yield_curve_10_2"]:
        if col in macro_daily.columns:
            feat[col] = macro_daily[col].reindex(df.index, method="ffill")
        else:
            feat[col] = np.nan

    # Polymarket / news / options — not available historically; zeros = neutral
    for col in ["poly_yes_price", "poly_conviction_delta_1h", "poly_conviction_delta_4h",
                "poly_volume_24h", "news_sentiment_1h", "news_sentiment_4h",
                "news_hotness_peak_4h", "news_article_count_4h",
                "put_call_ratio", "unusual_sweep_count_4h"]:
        feat[col] = 0.0

    # Forward return labels (5d primary, also 1d/10d)
    feat["forward_return_5d"]  = c.shift(-5) / c - 1
    feat["forward_return_1d"]  = c.shift(-1) / c - 1
    feat["forward_return_10d"] = c.shift(-10) / c - 1

    # Need at least 60 candles for indicators to warm up
    feat = feat.iloc[60:].copy()

    # Drop rows where forward return is NaN (last 10 candles)
    feat = feat.dropna(subset=["forward_return_5d"])

    return feat


async def _load_macro(conn: asyncpg.Connection) -> pd.DataFrame:
    rows = await conn.fetch(
        "SELECT ts, series_id, value FROM raw_macro ORDER BY ts ASC"
    )
    if not rows:
        return pd.DataFrame()

    raw = pd.DataFrame([dict(r) for r in rows])
    raw["ts"] = pd.to_datetime(raw["ts"]).dt.tz_localize(None).dt.normalize()
    raw["value"] = pd.to_numeric(raw["value"], errors="coerce")

    pivot = raw.pivot_table(index="ts", columns="series_id", values="value", aggfunc="last")
    pivot = pivot.sort_index().ffill()

    rename = {
        "VIXCLS":    "vix_level",
        "DCOILWTICO": "wti_crude",
        "DGS10":     "us_10y_yield",
        "FEDFUNDS":  "fed_funds_rate",
        "DTWEXBGS":  "usd_index",
    }
    pivot = pivot.rename(columns=rename)
    if "us_10y_yield" in pivot.columns and "DGS2" in pivot.columns:
        pivot["yield_curve_10_2"] = pivot["us_10y_yield"] - pivot["DGS2"]
    elif "us_10y_yield" in pivot.columns:
        pivot["yield_curve_10_2"] = np.nan

    return pivot


async def backfill_symbol(
    symbol: str,
    conn: asyncpg.Connection,
    macro_daily: pd.DataFrame,
    cutoff: pd.Timestamp,
) -> int:
    rows = await conn.fetch(
        "SELECT ts, open, high, low, close, volume FROM raw_ohlcv "
        "WHERE symbol=$1 AND interval='1d' ORDER BY ts ASC",
        symbol,
    )
    if len(rows) < 80:
        logger.info("  %s: only %d OHLCV rows — skipping", symbol, len(rows))
        return 0

    df = pd.DataFrame([dict(r) for r in rows])
    df["ts"] = pd.to_datetime(df["ts"]).dt.tz_localize(None).dt.normalize()
    df = df.set_index("ts").sort_index()
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["close"])

    # Only backfill up to `cutoff` (don't overwrite recent live feature rows)
    df = df[df.index <= cutoff]
    if len(df) < 80:
        logger.info("  %s: insufficient history before cutoff — skipping", symbol)
        return 0

    feat = _build_features(df, macro_daily)
    if feat.empty:
        return 0

    # Bulk insert
    inserted = 0
    BATCH = 200
    rows_list = []
    for ts, row in feat.iterrows():
        ts_utc = pd.Timestamp(ts).tz_localize("UTC")
        rows_list.append((ts_utc, symbol, row))

    for i in range(0, len(rows_list), BATCH):
        batch = rows_list[i : i + BATCH]
        values = [
            (
                r[0], r[1],                                              # ts, symbol
                _f(r[2].get("poly_yes_price")),
                _f(r[2].get("poly_conviction_delta_1h")),
                _f(r[2].get("poly_conviction_delta_4h")),
                _f(r[2].get("poly_volume_24h")),
                _f(r[2].get("news_sentiment_1h")),
                _f(r[2].get("news_sentiment_4h")),
                _f(r[2].get("news_hotness_peak_4h")),
                _f(r[2].get("news_article_count_4h")),
                _f(r[2].get("rsi_14")),
                _f(r[2].get("macd_histogram")),
                _f(r[2].get("atr_14")),
                _f(r[2].get("bb_position")),
                _f(r[2].get("sma_20_slope")),
                _f(r[2].get("vol_ratio_30d")),
                _f(r[2].get("price_change_1d")),
                _f(r[2].get("price_change_5d")),
                _f(r[2].get("put_call_ratio")),
                _f(r[2].get("unusual_sweep_count_4h")),
                _f(r[2].get("vix_level")),
                _f(r[2].get("wti_crude")),
                _f(r[2].get("us_10y_yield")),
                _f(r[2].get("fed_funds_rate")),
                _f(r[2].get("usd_index")),
                _f(r[2].get("yield_curve_10_2")),
                _f(r[2].get("adx_14")),
                _f(r[2].get("bb_width")),
                _f(r[2].get("price_vs_sma50")),
                _f(r[2].get("atr_pct")),
                _f(r[2].get("hv_20")),
                _f(r[2].get("price_vs_52w_high")),
                _f(r[2].get("stoch_k")),
                _f(r[2].get("forward_return_5d")),
                _f(r[2].get("forward_return_1d")),
                _f(r[2].get("forward_return_10d")),
            )
            for r in batch
        ]
        await conn.executemany(
            """INSERT INTO features (
                 ts, symbol,
                 poly_yes_price, poly_conviction_delta_1h, poly_conviction_delta_4h, poly_volume_24h,
                 news_sentiment_1h, news_sentiment_4h, news_hotness_peak_4h, news_article_count_4h,
                 rsi_14, macd_histogram, atr_14, bb_position, sma_20_slope,
                 vol_ratio_30d, price_change_1d, price_change_5d,
                 put_call_ratio, unusual_sweep_count_4h,
                 vix_level, wti_crude, us_10y_yield, fed_funds_rate, usd_index, yield_curve_10_2,
                 adx_14, bb_width, price_vs_sma50, atr_pct, hv_20, price_vs_52w_high, stoch_k,
                 forward_return_5d, forward_return_1d, forward_return_10d
               ) VALUES (
                 $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                 $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
                 $27,$28,$29,$30,$31,$32,$33,$34,$35,$36
               ) ON CONFLICT (ts, symbol) DO NOTHING""",
            values,
        )
        inserted += len(batch)

    return inserted


def _f(v: object) -> float | None:
    try:
        x = float(v)  # type: ignore[arg-type]
        return None if (x != x) else x   # NaN check without math.isnan import
    except (TypeError, ValueError):
        return None


async def main() -> None:
    logger.info("Historical backfill starting (BACKFILL_YEARS=%d, %d symbols)",
                BACKFILL_YEARS, len(SYMBOLS))

    conn = await asyncpg.connect(TIMESCALE_URL)
    try:
        logger.info("Loading macro data...")
        macro_daily = await _load_macro(conn)
        if macro_daily.empty:
            logger.warning("No macro data found — macro features will be NaN. "
                           "Run the historical ingestor first.")
        else:
            logger.info("Macro data: %d rows, %s → %s",
                        len(macro_daily),
                        macro_daily.index.min().date(),
                        macro_daily.index.max().date())

        # Cutoff: don't overwrite feature rows from the last 7 days (let live builder own those)
        cutoff = pd.Timestamp.now().normalize() - pd.Timedelta(days=7)

        total = 0
        for symbol in SYMBOLS:
            logger.info("Backfilling %s...", symbol)
            n = await backfill_symbol(symbol, conn, macro_daily, cutoff)
            logger.info("  %s: inserted %d rows", symbol, n)
            total += n

        logger.info("Backfill complete. Total rows inserted: %d", total)

        labeled = await conn.fetchval(
            "SELECT COUNT(*) FROM features WHERE forward_return_5d IS NOT NULL"
        )
        logger.info("Total labeled rows now available for training: %d", labeled)

        if labeled >= 200:
            logger.info("Ready to train! Run: docker compose restart ml-trainer")
        else:
            logger.info("Still need %d more labeled rows. "
                        "Check that raw_ohlcv is populated (run historical ingestor first).",
                        200 - labeled)

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
