from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Set

from .data_source import NewsArticle
from .models import SentimentLabel

# Hot financial keywords (lower-case) — matched against headline+summary.
# Includes both multi-word phrases and standalone high-signal words.
_HOT_KEYWORDS: List[str] = [
    # Earnings / revenue
    "earnings beat", "earnings miss", "beats estimates", "misses estimates",
    "beats expectations", "misses expectations", "revenue beat", "revenue miss",
    "record revenue", "record earnings", "record profit", "record sales",
    "raises guidance", "lowers guidance", "guidance raised", "guidance lowered",
    "raises outlook", "lowers outlook",
    # Single-word price-action signals (common in Finnhub headlines)
    "surges", "surged", "soars", "soared", "spikes", "spiked", "rallies", "rallied",
    "plunges", "plunged", "tumbles", "tumbled", "crashes", "crashed", "collapses",
    "skyrockets", "skyrocketed", "nosedives", "nosedived",
    # Corporate actions
    "merger", "acquisition", "takeover", "buyout", "deal",
    "spin-off", "spinoff", "ipo", "going public", "listing",
    "stock split", "buyback", "share repurchase",
    "dividend cut", "dividend increase", "dividend raised", "dividend suspended",
    # Analyst actions
    "analyst upgrade", "analyst downgrade", "price target raised", "price target cut",
    "upgraded to buy", "downgraded to sell", "outperform", "underperform",
    "initiates coverage", "raises price target", "cuts price target",
    # Regulatory / legal
    "fda approval", "fda approved", "fda rejection", "fda rejected",
    "clinical trial", "phase 3", "phase 2", "breakthrough therapy",
    "regulatory probe", "sec investigation", "sec charges", "doj probe",
    "lawsuit", "class action", "settlement", "fine", "penalty",
    # Corporate health
    "bankruptcy", "insolvency", "chapter 11", "default", "restructuring",
    "layoffs", "job cuts", "mass layoff", "workforce reduction",
    "ceo resign", "ceo fired", "ceo departure", "executive departure",
    "leadership change", "activist investor", "short squeeze", "short seller",
]

# Bullish signal words for text-based sentiment scoring
_BULLISH_WORDS: List[str] = [
    "surge", "surges", "surged", "rally", "rallies", "rallied", "soar", "soars", "soared",
    "spike", "spikes", "spiked", "skyrocket", "skyrockets", "skyrocketed",
    "beat", "beats", "beat", "exceed", "exceeds", "exceeded", "outperform",
    "record high", "all-time high", "upgrade", "upgraded", "outperform",
    "strong", "strength", "profit", "gain", "gains", "growth", "grew",
    "approved", "approval", "breakthrough", "deal", "acquisition", "partnership",
    "raises guidance", "raises outlook", "dividend increase", "buyback",
    "buy rating", "strong buy", "overweight", "positive", "bullish",
]

# Bearish signal words for text-based sentiment scoring
_BEARISH_WORDS: List[str] = [
    "plunge", "plunges", "plunged", "tumble", "tumbles", "tumbled",
    "crash", "crashes", "crashed", "collapse", "collapses", "collapsed",
    "nosedive", "nosedives", "nosedived", "sink", "sinks", "sank",
    "drop", "drops", "dropped", "fall", "falls", "fell",
    "miss", "misses", "missed", "below expectations", "disappoints", "disappointed",
    "downgrade", "downgraded", "underperform", "sell rating", "underweight",
    "warning", "warn", "loss", "losses", "decline", "declines", "declined",
    "bankruptcy", "bankrupt", "default", "insolvency", "chapter 11",
    "layoffs", "job cuts", "workforce reduction",
    "probe", "investigation", "lawsuit", "fraud", "charges", "fine", "penalty",
    "dividend cut", "dividend suspended", "guidance cut", "guidance lowered",
    "recall", "halted", "suspended", "negative", "bearish", "risk",
]

# Source credibility weights (0.0–1.0)
_SOURCE_CREDIBILITY: Dict[str, float] = {
    "reuters": 1.00,
    "bloomberg": 1.00,
    "financial times": 0.95,
    "ft": 0.95,
    "wall street journal": 0.95,
    "wsj": 0.95,
    "cnbc": 0.85,
    "marketwatch": 0.80,
    "seeking alpha": 0.70,
    "business insider": 0.68,
    "benzinga": 0.68,
    "yahoo finance": 0.72,
    "motley fool": 0.65,
    "barron": 0.85,
    "investor's business daily": 0.80,
    "ibd": 0.80,
    "thestreet": 0.72,
    "zacks": 0.70,
    "fool": 0.65,
    "globenewswire": 0.70,
    "prnewswire": 0.65,
    "businesswire": 0.65,
}


@dataclass
class HotnessResult:
    score: float           # 0.0–1.0 composite score
    sentiment_score: float # -1.0–1.0
    sentiment_label: SentimentLabel
    matched_keywords: List[str]
    article_age_hours: float


class NewsHotnessState:
    """Per-ticker state tracking which article IDs have already been emitted."""

    def __init__(self) -> None:
        self._seen_article_ids: Set[str] = set()

    def is_seen(self, article_id: str) -> bool:
        return article_id in self._seen_article_ids

    def mark_seen(self, article_id: str) -> None:
        self._seen_article_ids.add(article_id)

    def seen_count(self) -> int:
        return len(self._seen_article_ids)


def _source_credibility(source_name: str) -> float:
    key = source_name.lower().strip()
    for pattern, weight in _SOURCE_CREDIBILITY.items():
        if pattern in key:
            return weight
    return 0.55  # default credibility for unknown sources


def _matched_keywords(text: str) -> List[str]:
    lower_text = text.lower()
    return [kw for kw in _HOT_KEYWORDS if kw in lower_text]


def _text_sentiment(text: str) -> float:
    """
    Derive a sentiment score in [-1.0, 1.0] from headline/summary text.
    Counts bullish vs bearish signal words and normalises by total signals found.
    Returns 0.0 when no signals are found.
    """
    lower = text.lower()
    bullish = sum(1 for w in _BULLISH_WORDS if w in lower)
    bearish = sum(1 for w in _BEARISH_WORDS if w in lower)
    total = bullish + bearish
    if total == 0:
        return 0.0
    raw = (bullish - bearish) / total  # in [-1, 1]
    # Dampen slightly so a single word gives ~0.5 rather than ±1.0
    return round(raw * min(1.0, 0.4 + 0.1 * total), 4)


def compute_hotness(
    article: NewsArticle,
    article_age_hours: float,
    sentiment_score: float = 0.0,
) -> HotnessResult:
    """
    Compute a hotness score for a news article.

    Formula:
        recency  = exp(-age_hours * ln(2) / half_life)   half_life = 12h
        raw      = recency * (0.30*sentiment_strength + 0.30*credibility + 0.40) * kw_boost
        score    = min(raw, 1.0)

    When sentiment_score is not provided (defaults to 0.0), a lightweight
    text-based sentiment is computed from the headline and summary instead.
    kw_boost = 1.0 + 0.20 * min(matched_keywords, 4)
    """
    combined_text = f"{article.headline} {article.summary}"
    matched_kws = _matched_keywords(combined_text)
    credibility = _source_credibility(article.source_name)

    # Use caller-supplied sentiment if non-zero, otherwise derive from text
    effective_sentiment = sentiment_score if sentiment_score != 0.0 else _text_sentiment(combined_text)
    sentiment_strength = abs(effective_sentiment)

    # 12h half-life so articles near the 6h lookback boundary still score well
    recency = math.exp(-article_age_hours * 0.693 / 12.0)
    # More generous keyword boost, up to 4 keywords
    kw_boost = 1.0 + 0.20 * min(len(matched_kws), 4)
    # Higher base weight (0.40) so a fresh article from any source passes without keywords
    raw = recency * (0.30 * sentiment_strength + 0.30 * credibility + 0.40) * kw_boost
    score = min(raw, 1.0)

    if effective_sentiment > 0.15:
        sentiment_label = SentimentLabel.BULLISH
    elif effective_sentiment < -0.15:
        sentiment_label = SentimentLabel.BEARISH
    else:
        sentiment_label = SentimentLabel.NEUTRAL

    return HotnessResult(
        score=round(score, 4),
        sentiment_score=round(effective_sentiment, 4),
        sentiment_label=sentiment_label,
        matched_keywords=matched_kws,
        article_age_hours=round(article_age_hours, 2),
    )


def is_hot(result: HotnessResult, min_score: float) -> bool:
    return result.score >= min_score
