"""Polymarket macro sentiment — aggregate YES probabilities into named categories.

Written to Redis as `polymarket:macro_sentiment` (TTL 2h) after every producer poll.
Read by the AI correlator to enrich the Claude prompt with crowd-sourced macro views.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

REDIS_KEY = "polymarket:macro_sentiment"
REDIS_TTL = 7_200  # 2 hours


@dataclass
class SentimentCategory:
    name: str
    keywords: List[str]
    related_tickers: List[str]
    # plain-English note for Claude — e.g. "rising = bearish for equities"
    direction_note: str


CATEGORIES: List[SentimentCategory] = [
    SentimentCategory(
        name="fed_rate_cut",
        keywords=["fed cut", "rate cut", "fomc cut", "interest rate cut",
                  "50 basis", "25 basis", "federal reserve cut", "pivot", "rate reduction"],
        related_tickers=["TLT", "IEF", "SHY", "AGG"],
        direction_note="Higher probability = bullish for bonds (TLT/IEF), bearish for USD",
    ),
    SentimentCategory(
        name="fed_rate_hike",
        keywords=["rate hike", "rate increase", "fomc hike", "interest rate hike", "tightening"],
        related_tickers=["TLT", "IEF", "SHY"],
        direction_note="Higher probability = bearish for bonds, bullish for USD",
    ),
    SentimentCategory(
        name="recession",
        keywords=["recession", "gdp contraction", "economic downturn", "economic recession",
                  "enter recession", "avoid recession"],
        related_tickers=["SPY", "QQQ", "IWM"],
        direction_note="Higher probability = bearish for equities, bullish for bonds/gold",
    ),
    SentimentCategory(
        name="bitcoin",
        keywords=["bitcoin", " btc ", "btc price", "bitcoin price", "bitcoin ath"],
        related_tickers=["BTC-USD", "ETH-USD", "MSTR", "COIN"],
        direction_note="Aggregated BTC outlook; rising = bullish crypto sentiment",
    ),
    SentimentCategory(
        name="crypto_regulation",
        keywords=["crypto regulation", "sec crypto", "crypto ban", "bitcoin etf",
                  "crypto law", "digital asset bill"],
        related_tickers=["BTC-USD", "ETH-USD", "COIN"],
        direction_note="Higher regulatory clarity/approval = bullish crypto",
    ),
    SentimentCategory(
        name="oil_price",
        keywords=["oil price", "crude oil", "opec", "brent", "wti price",
                  "oil above", "oil below", "oil reach"],
        related_tickers=["USO", "BNO", "XLE", "XOM", "CVX"],
        direction_note="Rising YES probability for higher oil = bullish energy sector",
    ),
    SentimentCategory(
        name="inflation",
        keywords=["inflation", "cpi above", "cpi below", "pce", "price level",
                  "core inflation", "inflation above", "inflation below"],
        related_tickers=["TIP", "GLD", "TLT", "IAU"],
        direction_note="Higher inflation probability = bearish bonds, bullish TIPS/gold",
    ),
    SentimentCategory(
        name="equity_market",
        keywords=["s&p 500", "sp500", "s&p above", "s&p below", "nasdaq", "dow jones",
                  "stock market", "equities", "bull market", "bear market"],
        related_tickers=["SPY", "QQQ", "DIA", "IWM"],
        direction_note="Direct crowd sentiment on equity direction",
    ),
    SentimentCategory(
        name="gold",
        keywords=["gold price", "gold above", "gold below", "gold reach", "precious metal"],
        related_tickers=["GLD", "IAU", "GOLD", "NEM"],
        direction_note="Higher probability = bullish gold/precious metals",
    ),
    SentimentCategory(
        name="us_politics",
        keywords=["trump", "tariff", "trade war", "trade deal", "maga", "republican",
                  "democrat", "election", "white house", "congress"],
        related_tickers=["SPY", "DXY"],
        direction_note="Policy/trade-war uncertainty; interpret in context of question",
    ),
    SentimentCategory(
        name="geopolitical",
        keywords=["war", "conflict", "nato", "russia", "ukraine", "middle east",
                  "ceasefire", "invasion", "sanction"],
        related_tickers=["GLD", "USO", "TLT", "SPY"],
        direction_note="Escalation probability; higher = risk-off (gold/bonds up, equities down)",
    ),
]

# ticker → list of category names that should be included for this ticker
_TICKER_CATEGORY_MAP: Dict[str, List[str]] = {}
for _cat in CATEGORIES:
    for _t in _cat.related_tickers:
        _TICKER_CATEGORY_MAP.setdefault(_t, []).append(_cat.name)

# Always show these categories regardless of ticker (broad macro context)
_ALWAYS_SHOW = {"fed_rate_cut", "fed_rate_hike", "recession"}


@dataclass
class MarketEntry:
    question: str
    yes_price: float
    volume: Optional[float]
    liquidity: Optional[float]


def compute_sentiment(snapshots: dict) -> dict:
    """Given all market snapshots from a poll, return a per-category sentiment dict.

    Each category entry:
      { "avg_prob": 0.67, "market_count": 3,
        "top_question": "Will the Fed cut rates in 2026?",
        "related_tickers": [...], "direction_note": "..." }
    """
    buckets: Dict[str, List[MarketEntry]] = {c.name: [] for c in CATEGORIES}

    for snap in snapshots.values():
        question_lower = snap.question.lower()
        for cat in CATEGORIES:
            if any(kw in question_lower for kw in cat.keywords):
                # Skip markets with very low liquidity — not representative
                if snap.liquidity is not None and snap.liquidity < 500:
                    continue
                buckets[cat.name].append(
                    MarketEntry(
                        question=snap.question,
                        yes_price=snap.yes_price,
                        volume=snap.volume,
                        liquidity=snap.liquidity,
                    )
                )

    result: dict = {}
    for cat in CATEGORIES:
        entries = buckets[cat.name]
        if not entries:
            continue

        # Weighted average by liquidity (or simple mean if no liquidity data)
        total_liq = sum(e.liquidity or 1.0 for e in entries)
        avg_prob = sum(
            e.yes_price * (e.liquidity or 1.0) / total_liq
            for e in entries
        )
        # Top market by liquidity
        top = max(entries, key=lambda e: e.liquidity or 0)

        result[cat.name] = {
            "avg_prob": round(avg_prob, 3),
            "market_count": len(entries),
            "top_question": top.question,
            "related_tickers": cat.related_tickers,
            "direction_note": cat.direction_note,
        }

    return result


def filter_for_tickers(sentiment: dict, tickers: list[str]) -> dict:
    """Return sentiment categories relevant to the given tickers plus always-show ones."""
    relevant_cats = set(_ALWAYS_SHOW)
    for t in tickers:
        t_upper = t.upper()
        for cat_name in _TICKER_CATEGORY_MAP.get(t_upper, []):
            relevant_cats.add(cat_name)
    return {k: v for k, v in sentiment.items() if k in relevant_cats}
