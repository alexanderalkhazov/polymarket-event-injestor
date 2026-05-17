"""Feature builder — one row per symbol per hour in the features table.

CRITICAL RULE: every query uses WHERE ts <= snapshot_time ORDER BY ts DESC LIMIT 1.
Never use the most-recent value without the at-or-before constraint.
Violating this causes lookahead bias: backtests look great, live trading loses money.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

import asyncpg

logger = logging.getLogger(__name__)

ALL_SYMBOLS = ["USO", "XOM", "SPY", "QQQ", "GLD", "TLT", "LNG", "XLE"]
DEV_SYMBOLS = ["USO", "SPY", "QQQ"]


def get_symbols() -> list[str]:
    if os.getenv("DEV_MODE", "false").lower() == "true":
        return DEV_SYMBOLS
    return ALL_SYMBOLS


class FeatureBuilder:
    def __init__(self, tsdb: asyncpg.Pool) -> None:
        self._tsdb = tsdb

    async def build_snapshot(self, symbol: str, ts: datetime) -> Optional[dict]:
        features: dict = {"ts": ts, "symbol": symbol}
        try:
            features.update(await self._poly_features(symbol, ts))
            features.update(await self._news_features(symbol, ts))
            features.update(await self._price_features(symbol, ts))
            features.update(await self._options_features(symbol, ts))
            features.update(await self._macro_features(ts))
            return features
        except Exception as exc:
            logger.error("build_snapshot failed for %s at %s: %s", symbol, ts, exc)
            return None

    async def write(self, features: dict) -> None:
        await self._tsdb.execute(
            """INSERT INTO features (
                 ts, symbol,
                 poly_yes_price, poly_conviction_delta_1h, poly_conviction_delta_4h, poly_volume_24h,
                 news_sentiment_1h, news_sentiment_4h, news_hotness_peak_4h, news_article_count_4h,
                 rsi_14, macd_histogram, atr_14, bb_position, sma_20_slope,
                 vol_ratio_30d, price_change_1d, price_change_5d,
                 put_call_ratio, unusual_sweep_count_4h,
                 vix_level, wti_crude, us_10y_yield, fed_funds_rate, usd_index,
                 social_sentiment_z
               ) VALUES (
                 $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                 $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
               ) ON CONFLICT (ts, symbol) DO NOTHING""",
            features["ts"], features["symbol"],
            features.get("poly_yes_price"),
            features.get("poly_conviction_delta_1h"),
            features.get("poly_conviction_delta_4h"),
            features.get("poly_volume_24h"),
            features.get("news_sentiment_1h"),
            features.get("news_sentiment_4h"),
            features.get("news_hotness_peak_4h"),
            features.get("news_article_count_4h"),
            features.get("rsi_14"),
            features.get("macd_histogram"),
            features.get("atr_14"),
            features.get("bb_position"),
            features.get("sma_20_slope"),
            features.get("vol_ratio_30d"),
            features.get("price_change_1d"),
            features.get("price_change_5d"),
            features.get("put_call_ratio"),
            features.get("unusual_sweep_count_4h"),
            features.get("vix_level"),
            features.get("wti_crude"),
            features.get("us_10y_yield"),
            features.get("fed_funds_rate"),
            features.get("usd_index"),
            features.get("social_sentiment_z"),
        )

    # ── Polymarket ─────────────────────────────────────────────────────────────

    async def _poly_features(self, symbol: str, ts: datetime) -> dict:
        current = await self._tsdb.fetchval(
            "SELECT yes_price FROM raw_polymarket WHERE symbol=$1 AND ts<=$2 ORDER BY ts DESC LIMIT 1",
            symbol, ts,
        )
        prev_1h = await self._tsdb.fetchval(
            "SELECT yes_price FROM raw_polymarket WHERE symbol=$1 AND ts<=$2 ORDER BY ts DESC LIMIT 1",
            symbol, ts - timedelta(hours=1),
        )
        prev_4h = await self._tsdb.fetchval(
            "SELECT yes_price FROM raw_polymarket WHERE symbol=$1 AND ts<=$2 ORDER BY ts DESC LIMIT 1",
            symbol, ts - timedelta(hours=4),
        )
        vol = await self._tsdb.fetchval(
            "SELECT volume_24h FROM raw_polymarket WHERE symbol=$1 AND ts<=$2 ORDER BY ts DESC LIMIT 1",
            symbol, ts,
        )
        return {
            "poly_yes_price":           _f(current),
            "poly_conviction_delta_1h": _diff(current, prev_1h),
            "poly_conviction_delta_4h": _diff(current, prev_4h),
            "poly_volume_24h":          _f(vol),
        }

    # ── News ───────────────────────────────────────────────────────────────────

    async def _news_features(self, symbol: str, ts: datetime) -> dict:
        rows_1h = await self._tsdb.fetch(
            """SELECT hotness FROM raw_news
               WHERE symbol=$1 AND ts>=$2 AND ts<=$3""",
            symbol, ts - timedelta(hours=1), ts,
        )
        rows_4h = await self._tsdb.fetch(
            """SELECT hotness FROM raw_news
               WHERE symbol=$1 AND ts>=$2 AND ts<=$3""",
            symbol, ts - timedelta(hours=4), ts,
        )
        h_1h = [float(r["hotness"]) for r in rows_1h if r["hotness"] is not None]
        h_4h = [float(r["hotness"]) for r in rows_4h if r["hotness"] is not None]
        return {
            "news_sentiment_1h":     sum(h_1h) / len(h_1h) if h_1h else None,
            "news_sentiment_4h":     sum(h_4h) / len(h_4h) if h_4h else None,
            "news_hotness_peak_4h":  max(h_4h) if h_4h else None,
            "news_article_count_4h": len(rows_4h),
        }

    # ── Price / technicals ─────────────────────────────────────────────────────

    async def _price_features(self, symbol: str, ts: datetime) -> dict:
        tech = await self._tsdb.fetchrow(
            """SELECT rsi_14, macd, macd_signal, atr_14, bb_upper, bb_lower, sma_20
               FROM technicals WHERE symbol=$1 AND interval='1d' AND ts<=$2
               ORDER BY ts DESC LIMIT 1""",
            symbol, ts,
        )
        price_now = await self._tsdb.fetchval(
            "SELECT close FROM raw_ohlcv WHERE symbol=$1 AND interval='1d' AND ts<=$2 ORDER BY ts DESC LIMIT 1",
            symbol, ts,
        )
        price_1d = await self._tsdb.fetchval(
            "SELECT close FROM raw_ohlcv WHERE symbol=$1 AND interval='1d' AND ts<=$2 ORDER BY ts DESC LIMIT 1",
            symbol, ts - timedelta(days=1),
        )
        price_5d = await self._tsdb.fetchval(
            "SELECT close FROM raw_ohlcv WHERE symbol=$1 AND interval='1d' AND ts<=$2 ORDER BY ts DESC LIMIT 1",
            symbol, ts - timedelta(days=5),
        )
        vol_now = await self._tsdb.fetchval(
            "SELECT volume FROM raw_ohlcv WHERE symbol=$1 AND interval='1d' AND ts<=$2 ORDER BY ts DESC LIMIT 1",
            symbol, ts,
        )
        vol_30d = await self._tsdb.fetchval(
            """SELECT AVG(volume) FROM raw_ohlcv
               WHERE symbol=$1 AND interval='1d' AND ts>=$2 AND ts<=$3""",
            symbol, ts - timedelta(days=30), ts,
        )

        bb_pos = None
        if tech and price_now is not None:
            bb_upper = tech["bb_upper"]
            bb_lower = tech["bb_lower"]
            if bb_upper and bb_lower and bb_upper != bb_lower:
                bb_pos = (float(price_now) - float(bb_lower)) / (float(bb_upper) - float(bb_lower))

        sma_slope = None
        if tech and tech["sma_20"]:
            sma_prev = await self._tsdb.fetchval(
                """SELECT sma_20 FROM technicals WHERE symbol=$1 AND interval='1d' AND ts<=$2
                   ORDER BY ts DESC LIMIT 1""",
                symbol, ts - timedelta(days=1),
            )
            if sma_prev:
                sma_slope = (float(tech["sma_20"]) - float(sma_prev)) / float(sma_prev)

        return {
            "rsi_14":         _f(tech["rsi_14"]) if tech else None,
            "macd_histogram": _diff(tech["macd"], tech["macd_signal"]) if tech else None,
            "atr_14":         _f(tech["atr_14"]) if tech else None,
            "bb_position":    bb_pos,
            "sma_20_slope":   sma_slope,
            "vol_ratio_30d":  (float(vol_now) / float(vol_30d)) if vol_now and vol_30d else None,
            "price_change_1d": _pct_change(price_now, price_1d),
            "price_change_5d": _pct_change(price_now, price_5d),
        }

    # ── Options ────────────────────────────────────────────────────────────────

    async def _options_features(self, symbol: str, ts: datetime) -> dict:
        row = await self._tsdb.fetchrow(
            """SELECT put_volume, call_volume FROM raw_options
               WHERE symbol=$1 AND ts<=$2 ORDER BY ts DESC LIMIT 1""",
            symbol, ts,
        )
        count_4h = await self._tsdb.fetchval(
            """SELECT COUNT(*) FROM raw_options
               WHERE symbol=$1 AND ts>=$2 AND ts<=$3 AND unusual_sweeps > 0""",
            symbol, ts - timedelta(hours=4), ts,
        )
        pcr = None
        if row and row["call_volume"] and row["put_volume"] and row["call_volume"] > 0:
            pcr = float(row["put_volume"]) / float(row["call_volume"])
        return {
            "put_call_ratio":         pcr,
            "unusual_sweep_count_4h": int(count_4h) if count_4h else 0,
        }

    # ── Macro ──────────────────────────────────────────────────────────────────

    async def _macro_features(self, ts: datetime) -> dict:
        async def latest(series_id: str) -> Optional[float]:
            val = await self._tsdb.fetchval(
                "SELECT value FROM raw_macro WHERE series_id=$1 AND ts<=$2 ORDER BY ts DESC LIMIT 1",
                series_id, ts,
            )
            return _f(val)

        return {
            "vix_level":     await latest("VIXCLS"),
            "wti_crude":     await latest("DCOILWTICO"),
            "us_10y_yield":  await latest("DGS10"),
            "fed_funds_rate": await latest("FEDFUNDS"),
            "usd_index":     await latest("DTWEXBGS"),
        }


def _f(v: object) -> Optional[float]:
    try:
        return float(v) if v is not None else None  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _diff(a: object, b: object) -> Optional[float]:
    fa, fb = _f(a), _f(b)
    if fa is not None and fb is not None:
        return fa - fb
    return None


def _pct_change(now: object, prev: object) -> Optional[float]:
    fn, fp = _f(now), _f(prev)
    if fn is not None and fp is not None and fp != 0:
        return (fn - fp) / fp
    return None
