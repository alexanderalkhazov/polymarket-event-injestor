from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class SentimentLabel(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"


class StockNewsEvent(BaseModel):
    """Hot stock news event published to Kafka when a news article scores above threshold."""

    event_id: str = Field(..., description="Unique event identifier (UUID4)")
    timestamp: datetime = Field(..., description="Article published_at UTC")
    ticker: str = Field(..., description="Stock ticker symbol e.g. AAPL")
    company_name: str = Field(default="", description="Company display name")
    headline: str = Field(..., description="News headline")
    summary: str = Field(default="", description="Article summary (max 500 chars)")
    source_name: str = Field(..., description="News source e.g. Reuters")
    url: str = Field(..., description="Article URL")
    article_id: str = Field(..., description="Source article ID used for deduplication")
    sentiment_score: float = Field(..., ge=-1.0, le=1.0, description="-1.0 bearish to 1.0 bullish")
    sentiment_label: SentimentLabel = Field(..., description="Derived sentiment label")
    hotness_score: float = Field(..., ge=0.0, le=1.0, description="Composite hotness score 0-1")
    keywords: List[str] = Field(default_factory=list, description="Matched hot keywords")
    article_age_hours: float = Field(..., ge=0.0, description="Article age at detection time (hours)")
    pipeline: str = Field(default="stock-news", description="Pipeline identifier for routing")
    published_at: Optional[datetime] = Field(default=None, description="When event was published to Kafka")

    model_config = {"extra": "forbid", "frozen": True}


class StockNewsSubscription(BaseModel):
    """MongoDB subscription document for a stock ticker."""

    ticker: str = Field(..., description="Stock ticker symbol")
    company_name: Optional[str] = Field(None, description="Company name")
    ref_count: int = Field(default=0, description="Reference count — active when > 0")
    min_hotness_score: float = Field(
        default=0.4, ge=0.0, le=1.0, description="Min hotness score to emit event"
    )
    created_at: Optional[datetime] = Field(None)
    updated_at: Optional[datetime] = Field(None)

    model_config = {"extra": "allow"}

    def is_active(self) -> bool:
        return self.ref_count > 0

    def subscription_key(self) -> str:
        return self.ticker
