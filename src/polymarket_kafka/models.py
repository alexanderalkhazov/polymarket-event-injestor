"""Data Transfer Objects (DTOs) for polymarket-kafka service."""

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class SignalType(str, Enum):
    """Supported signal types."""

    OHLCV = "ohlcv"
    POLYMARKET = "polymarket"  # Conviction-based signals


class PolymarketEvent(BaseModel):
    """Polymarket conviction change event.

    Published to Kafka when a meaningful conviction shift is detected.
    Follows the same structural conventions as CandleEvent.
    """

    event_id: str = Field(..., description="Unique event identifier (UUID)")
    timestamp: datetime = Field(..., description="Event timestamp (UTC)")
    market_id: str = Field(..., description="Polymarket condition_id")
    question: str = Field(..., description="Market question text")
    yes_price: float = Field(..., ge=0.0, le=1.0, description="Current YES token price (0.0-1.0)")
    no_price: float = Field(..., ge=0.0, le=1.0, description="Current NO token price (0.0-1.0)")
    source: str = Field(default="polymarket-kafka", description="Data source identifier")
    published_at: Optional[datetime] = Field(None, description="When event was published to Kafka")

    # Conviction change fields
    conviction_direction: str = Field(
        ..., description="Direction of conviction change: 'yes' or 'no'"
    )
    conviction_magnitude: float = Field(
        ..., ge=0.0, description="Absolute magnitude of price change (0.0-1.0)"
    )
    conviction_magnitude_pct: float = Field(
        ..., description="Percentage change relative to previous price"
    )
    previous_yes_price: Optional[float] = Field(
        None, ge=0.0, le=1.0, description="Previous YES price for context"
    )
    volume: Optional[float] = Field(None, ge=0.0, description="Trading volume")
    liquidity: Optional[float] = Field(None, ge=0.0, description="Market liquidity")

    model_config = {"extra": "forbid", "frozen": True}


class PolymarketSubscription(BaseModel):
    """Configuration for a Polymarket subscription.

    The ref_count field implements reference counting:
    - Subscription is active when ref_count > 0
    - Multiple consumers can subscribe to the same feed
    - MongoDB manages counter via atomic $inc operator
    """

    market_id: str = Field(..., description="Polymarket condition_id")
    slug: Optional[str] = Field(None, description="Market slug for Gamma API lookups")
    ref_count: int = Field(default=0, description="Reference count — active when > 0")
    created_at: Optional[datetime] = Field(None, description="Creation timestamp")
    updated_at: Optional[datetime] = Field(None, description="Last update timestamp")

    # Optional fields for conviction detection configuration
    conviction_threshold: Optional[float] = Field(
        None, ge=0.0, le=1.0, description="Minimum price change to trigger event (0.0-1.0)"
    )
    conviction_threshold_pct: Optional[float] = Field(
        None, ge=0.0, description="Minimum percentage change to trigger event"
    )

    model_config = {"extra": "allow"}

    def is_active(self) -> bool:
        """Check if subscription is active (ref_count > 0)."""
        return self.ref_count > 0

    def subscription_key(self) -> str:
        """Return unique key for this subscription."""
        return self.market_id