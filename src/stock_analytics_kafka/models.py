from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class AnalyticsSignalType(str, Enum):
    VOLUME_SPIKE = "volume_spike"
    PRICE_MOMENTUM = "price_momentum"
    RSI_EXTREME = "rsi_extreme"
    OPTIONS_UNUSUAL = "options_unusual"


class Direction(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"


class StockAnalyticsEvent(BaseModel):
    """Sharp stock analytics signal event published to Kafka."""

    event_id: str = Field(..., description="UUID4 event identifier")
    timestamp: datetime = Field(..., description="Detection time UTC")
    ticker: str = Field(..., description="Stock ticker symbol")
    company_name: str = Field(default="", description="Company display name")

    # Signal classification
    signal_type: AnalyticsSignalType = Field(..., description="Type of analytical signal")
    signal_strength: float = Field(..., ge=0.0, le=1.0, description="Signal strength 0-1")
    direction: Direction = Field(..., description="Bullish or bearish")

    # Price data
    current_price: Optional[float] = Field(None, ge=0.0, description="Latest price")
    price_change_1d_pct: Optional[float] = Field(None, description="1-day price change %")

    # Volume data
    current_volume: Optional[int] = Field(None, ge=0)
    avg_volume_30d: Optional[int] = Field(None, ge=0)
    volume_ratio: Optional[float] = Field(None, ge=0.0, description="current / 30d avg")

    # Technical indicators
    rsi_14: Optional[float] = Field(None, ge=0.0, le=100.0, description="14-period RSI")

    # Options data (may be None if options unavailable)
    call_volume: Optional[int] = Field(None, ge=0)
    put_volume: Optional[int] = Field(None, ge=0)
    put_call_ratio: Optional[float] = Field(None, ge=0.0)

    pipeline: str = Field(default="stock-analytics", description="Pipeline identifier")
    published_at: Optional[datetime] = Field(None, description="Kafka publish time")

    model_config = {"extra": "forbid", "frozen": True}


class StockAnalyticsSubscription(BaseModel):
    """MongoDB subscription document for stock analytics monitoring."""

    ticker: str
    company_name: Optional[str] = None
    ref_count: int = 0
    min_volume_ratio: float = 2.0
    min_price_change_pct: float = 5.0
    rsi_overbought: float = 75.0
    rsi_oversold: float = 25.0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"extra": "allow"}

    def is_active(self) -> bool:
        return self.ref_count > 0
