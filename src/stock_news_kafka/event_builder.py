from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from .data_source import NewsArticle
from .hotness_detector import HotnessResult
from .models import StockNewsEvent, StockNewsSubscription

logger = logging.getLogger(__name__)

_STOCK_NEWS_EVENT_NS = uuid.UUID("9d6f65d8-8d58-4e1b-9f4d-ece65eab2df7")


def _stable_event_id(article: NewsArticle, subscription: StockNewsSubscription) -> str:
    raw = f"{subscription.ticker}|{article.article_id}|{int(article.published_at.timestamp())}"
    return str(uuid.uuid5(_STOCK_NEWS_EVENT_NS, raw))


def build_stock_news_event(
    article: NewsArticle,
    hotness: HotnessResult,
    subscription: StockNewsSubscription,
) -> StockNewsEvent:
    """Construct a StockNewsEvent from a NewsArticle + hotness result."""
    return StockNewsEvent(
        event_id=_stable_event_id(article, subscription),
        timestamp=article.published_at,
        ticker=subscription.ticker,
        company_name=subscription.company_name or subscription.ticker,
        headline=article.headline,
        summary=article.summary,
        source_name=article.source_name,
        url=article.url,
        article_id=article.article_id,
        sentiment_score=hotness.sentiment_score,
        sentiment_label=hotness.sentiment_label,
        hotness_score=hotness.score,
        keywords=hotness.matched_keywords,
        article_age_hours=hotness.article_age_hours,
        published_at=datetime.now(timezone.utc),
    )


def event_to_dict(event: StockNewsEvent) -> dict:
    """Convert a StockNewsEvent to a dict suitable for JSON serialisation."""
    return {
        "event_id": event.event_id,
        "timestamp": event.timestamp.isoformat(),
        "ticker": event.ticker,
        "company_name": event.company_name,
        "headline": event.headline,
        "summary": event.summary,
        "source_name": event.source_name,
        "url": event.url,
        "article_id": event.article_id,
        "sentiment_score": event.sentiment_score,
        "sentiment_label": event.sentiment_label.value,
        "hotness_score": event.hotness_score,
        "keywords": event.keywords,
        "article_age_hours": event.article_age_hours,
        "pipeline": event.pipeline,
        "published_at": event.published_at.isoformat() if event.published_at else None,
    }
