from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, Any

from .conviction import ConvictionChange
from .data_source import MarketSnapshot
from .models import PolymarketEvent

import uuid


def build_polymarket_event(
    snapshot: MarketSnapshot,
    conviction: ConvictionChange,
) -> PolymarketEvent:
    """Build a PolymarketEvent model from a snapshot and conviction change."""
    event_id = str(uuid.uuid4())
    timestamp = snapshot.fetched_at

    return PolymarketEvent(
        event_id=event_id,
        timestamp=timestamp,
        market_id=snapshot.market_id,
        question=snapshot.question,
        yes_price=snapshot.yes_price,
        no_price=snapshot.no_price,
        # source and published_at handled by defaults / Kafka publish time
        conviction_direction=conviction.direction,
        conviction_magnitude=conviction.magnitude,
        conviction_magnitude_pct=conviction.magnitude_pct,
        previous_yes_price=conviction.previous_yes_price,
        volume=snapshot.volume,
        liquidity=snapshot.liquidity,
    )


def event_to_dict(event: PolymarketEvent, *, published_at: datetime | None = None) -> Dict[str, Any]:
    """Convert a PolymarketEvent to a JSON-serializable dict, setting published_at if provided."""
    if published_at is not None:
        # Pydantic model is frozen, so we create a new dict with updated published_at.
        data = event.model_dump()
        data["published_at"] = published_at
    else:
        data = event.model_dump()
    return data