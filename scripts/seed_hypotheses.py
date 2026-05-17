"""Seed initial named hypotheses into the hypotheses table.

Run after Phase 3 (feature store is populated):
  python scripts/seed_hypotheses.py
"""
from __future__ import annotations

import asyncio
import json
import os

import asyncpg

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/eventedge"
)

HYPOTHESES = [
    {
        "name": "geopolitical_oil_squeeze",
        "description": "Large Polymarket conviction shift on a geopolitical market (oil exposure) corroborated by volume spike and bullish news sentiment.",
        "feature_conditions": {
            "poly_conviction_delta_1h": {"gt": 0.10},
            "vol_ratio_30d": {"gt": 2.0},
            "news_sentiment_1h": {"gt": 0.70},
        },
        "target_symbol": "USO",
        "direction": "up",
        "hold_days": 5,
        "confidence_threshold": 0.65,
    },
    {
        "name": "oversold_momentum_reversal",
        "description": "RSI deeply oversold with a 5-day price decline. Historically mean-reverts within 5 trading days.",
        "feature_conditions": {
            "rsi_14": {"lt": 28},
            "price_change_5d": {"lt": -0.05},
            "vol_ratio_30d": {"gt": 1.5},
        },
        "direction": "up",
        "hold_days": 5,
        "confidence_threshold": 0.65,
    },
    {
        "name": "unusual_call_buying",
        "description": "Unusually low put/call ratio with multiple unusual sweeps — smart money positioning for upside.",
        "feature_conditions": {
            "put_call_ratio": {"lt": 0.35},
            "unusual_sweep_count_4h": {"gte": 2},
            "vol_ratio_30d": {"gt": 1.8},
        },
        "direction": "up",
        "hold_days": 5,
        "confidence_threshold": 0.65,
    },
    {
        "name": "macro_risk_off",
        "description": "Elevated VIX with intraday price decline and high yields — classic risk-off rotation out of equities.",
        "feature_conditions": {
            "vix_level": {"gt": 25},
            "price_change_1d": {"lt": -0.02},
            "us_10y_yield": {"gt": 4.5},
        },
        "direction": "down",
        "hold_days": 5,
        "confidence_threshold": 0.65,
    },
    {
        "name": "volume_breakout_momentum",
        "description": "3x+ volume spike with strong 1-day price move — institutional participation confirming momentum.",
        "feature_conditions": {
            "vol_ratio_30d": {"gt": 3.0},
            "price_change_1d": {"gt": 0.03},
        },
        "direction": "up",
        "hold_days": 3,
        "confidence_threshold": 0.65,
    },
    {
        "name": "overbought_reversal",
        "description": "RSI overbought territory with elevated volume — momentum exhaustion, short-term pullback likely.",
        "feature_conditions": {
            "rsi_14": {"gt": 74},
            "vol_ratio_30d": {"gt": 1.5},
            "price_change_5d": {"gt": 0.08},
        },
        "direction": "down",
        "hold_days": 3,
        "confidence_threshold": 0.65,
    },
    {
        "name": "put_heavy_defensive",
        "description": "High put/call ratio suggesting institutional hedging or bearish speculation — downside ahead.",
        "feature_conditions": {
            "put_call_ratio": {"gt": 2.5},
            "vol_ratio_30d": {"gt": 2.0},
        },
        "direction": "down",
        "hold_days": 5,
        "confidence_threshold": 0.65,
    },
    {
        "name": "macro_tailwind_breakout",
        "description": "Low VIX environment with positive price momentum — low volatility breakouts have high follow-through.",
        "feature_conditions": {
            "vix_level": {"lt": 16},
            "price_change_1d": {"gt": 0.02},
            "vol_ratio_30d": {"gt": 1.5},
        },
        "direction": "up",
        "hold_days": 10,
        "confidence_threshold": 0.65,
    },
    {
        "name": "news_catalyst_spike",
        "description": "High news hotness and article count in 4h window corroborated by volume — news-driven price move.",
        "feature_conditions": {
            "news_hotness_peak_4h": {"gt": 0.80},
            "news_article_count_4h": {"gte": 5},
            "vol_ratio_30d": {"gt": 2.0},
        },
        "direction": "up",
        "hold_days": 3,
        "confidence_threshold": 0.65,
    },
    {
        "name": "bollinger_squeeze_breakout",
        "description": "Price near top of Bollinger Band with momentum — bands tightened, breakout likely to continue.",
        "feature_conditions": {
            "bb_position": {"gt": 0.85},
            "macd_histogram": {"gt": 0.0},
            "vol_ratio_30d": {"gt": 1.5},
        },
        "direction": "up",
        "hold_days": 5,
        "confidence_threshold": 0.65,
    },
]


async def main() -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        inserted = 0
        for h in HYPOTHESES:
            result = await conn.execute(
                """INSERT INTO hypotheses
                   (name, description, feature_conditions, target_symbol,
                    direction, hold_days, confidence_threshold)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (name) DO NOTHING""",
                h["name"],
                h["description"],
                json.dumps(h["feature_conditions"]),
                h.get("target_symbol"),
                h["direction"],
                h["hold_days"],
                h["confidence_threshold"],
            )
            if result == "INSERT 0 1":
                inserted += 1
                print(f"  Inserted: {h['name']}")
            else:
                print(f"  Skipped (exists): {h['name']}")

        total = await conn.fetchval("SELECT COUNT(*) FROM hypotheses WHERE is_active=TRUE")
        print(f"\nHypotheses: {total} active ({inserted} newly inserted)")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
