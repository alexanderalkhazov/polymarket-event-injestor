from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from .data_source import MarketSnapshot
from .models import PolymarketSubscription


@dataclass
class ConvictionState:
    """Per-market conviction tracking state."""

    last_yes_price: Optional[float] = None
    last_event_yes_price: Optional[float] = None
    last_event_at: Optional[datetime] = None


@dataclass(frozen=True)
class ConvictionChange:
    """Result of a conviction change detection."""

    direction: str  # "yes" or "no"
    magnitude: float
    magnitude_pct: float
    previous_yes_price: Optional[float]
    detected_at: datetime


def _resolve_thresholds(subscription: PolymarketSubscription) -> tuple[float, float]:
    """Resolve absolute and percentage thresholds for a subscription.

    Order of precedence:
    1. Per-subscription `conviction_threshold` / `conviction_threshold_pct`
    2. Global defaults (sane, conservative values)
    """
    # Defaults chosen to represent a meaningful shift without being too noisy.
    default_abs = 0.10  # 10 percentage points absolute move
    default_pct = 0.20  # 20% relative move

    abs_threshold = subscription.conviction_threshold or default_abs
    pct_threshold = subscription.conviction_threshold_pct or default_pct

    return abs_threshold, pct_threshold


def detect_conviction_change(
    subscription: PolymarketSubscription,
    snapshot: MarketSnapshot,
    state: ConvictionState,
) -> Optional[ConvictionChange]:
    """Determine whether the new snapshot represents a meaningful conviction change.

    The logic is:
    - If we have no prior price for this market, record it but do NOT emit an event.
    - Compute absolute and percentage change from the last observed YES price.
    - Emit an event if either absolute or percentage thresholds are exceeded.
    - Direction is "yes" if price increased, "no" if decreased.
    - Hysteresis / deduplication is handled by the runner using last_event_yes_price.
    """
    current_price = snapshot.yes_price
    previous_price = state.last_yes_price

    # First observation for this market — initialize state, no event yet.
    if previous_price is None:
        state.last_yes_price = current_price
        return None

    abs_threshold, pct_threshold = _resolve_thresholds(subscription)

    change_abs = abs(current_price - previous_price)
    if previous_price == 0:
        change_pct = float("inf") if change_abs > 0 else 0.0
    else:
        change_pct = change_abs / previous_price

    if change_abs < abs_threshold and change_pct < pct_threshold:
        # Insignificant move.
        state.last_yes_price = current_price
        return None

    direction = "yes" if current_price > previous_price else "no"

    detected_at = datetime.now(timezone.utc)
    change = ConvictionChange(
        direction=direction,
        magnitude=change_abs,
        magnitude_pct=change_pct,
        previous_yes_price=previous_price,
        detected_at=detected_at,
    )

    # Update state with the new observation.
    state.last_yes_price = current_price
    state.last_event_yes_price = current_price
    state.last_event_at = detected_at

    return change