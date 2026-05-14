from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple

from .data_source import TickerSnapshot
from .models import AnalyticsSignalType, Direction, StockAnalyticsSubscription

logger = logging.getLogger(__name__)


@dataclass
class SignalResult:
    signal_type: AnalyticsSignalType
    signal_strength: float      # 0.0–1.0
    direction: Direction


class AnalyticsState:
    """Tracks cooldown timestamps per (ticker, signal_type) pair."""

    def __init__(self, cooldown_hours: float = 4.0) -> None:
        self._cooldown = timedelta(hours=cooldown_hours)
        self._last_fired: Dict[Tuple[str, str], datetime] = {}

    def is_on_cooldown(self, ticker: str, signal_type: AnalyticsSignalType) -> bool:
        key = (ticker, signal_type.value)
        last = self._last_fired.get(key)
        if last is None:
            return False
        return datetime.now(timezone.utc) - last < self._cooldown

    def mark_fired(self, ticker: str, signal_type: AnalyticsSignalType) -> None:
        self._last_fired[(ticker, signal_type.value)] = datetime.now(timezone.utc)


def _volume_spike_signal(
    snapshot: TickerSnapshot, subscription: StockAnalyticsSubscription
) -> Optional[SignalResult]:
    """Fires when current volume / 30d avg exceeds the subscription threshold."""
    ratio = snapshot.volume_ratio
    if ratio is None or ratio < subscription.min_volume_ratio:
        return None

    # Strength: clamped ratio normalised to [0, 1] at ratio ≥ 5×
    strength = min((ratio - subscription.min_volume_ratio) / (5.0 - subscription.min_volume_ratio), 1.0)

    # Direction from price change
    direction = Direction.BULLISH
    if snapshot.price_change_1d_pct is not None and snapshot.price_change_1d_pct < 0:
        direction = Direction.BEARISH

    return SignalResult(
        signal_type=AnalyticsSignalType.VOLUME_SPIKE,
        signal_strength=round(max(strength, 0.0), 4),
        direction=direction,
    )


def _price_momentum_signal(
    snapshot: TickerSnapshot, subscription: StockAnalyticsSubscription
) -> Optional[SignalResult]:
    """Fires when 1-day price change exceeds subscription threshold."""
    change = snapshot.price_change_1d_pct
    if change is None or abs(change) < subscription.min_price_change_pct:
        return None

    # Strength: normalised between threshold and 2× threshold
    strength = min(
        (abs(change) - subscription.min_price_change_pct) / subscription.min_price_change_pct,
        1.0,
    )
    direction = Direction.BULLISH if change > 0 else Direction.BEARISH

    return SignalResult(
        signal_type=AnalyticsSignalType.PRICE_MOMENTUM,
        signal_strength=round(max(strength, 0.0), 4),
        direction=direction,
    )


def _rsi_extreme_signal(
    snapshot: TickerSnapshot, subscription: StockAnalyticsSubscription
) -> Optional[SignalResult]:
    """Fires on RSI extremes (overbought / oversold)."""
    rsi = snapshot.rsi_14
    if rsi is None:
        return None

    if rsi >= subscription.rsi_overbought:
        strength = min((rsi - subscription.rsi_overbought) / (100 - subscription.rsi_overbought), 1.0)
        return SignalResult(
            signal_type=AnalyticsSignalType.RSI_EXTREME,
            signal_strength=round(strength, 4),
            direction=Direction.BEARISH,  # Overbought → potential reversal bearish
        )
    if rsi <= subscription.rsi_oversold:
        strength = min((subscription.rsi_oversold - rsi) / subscription.rsi_oversold, 1.0)
        return SignalResult(
            signal_type=AnalyticsSignalType.RSI_EXTREME,
            signal_strength=round(strength, 4),
            direction=Direction.BULLISH,  # Oversold → potential reversal bullish
        )
    return None


def _options_unusual_signal(
    snapshot: TickerSnapshot, subscription: StockAnalyticsSubscription
) -> Optional[SignalResult]:
    """Fires when put/call ratio is extremely skewed (< 0.4 or > 2.5)."""
    pcr = snapshot.put_call_ratio
    if pcr is None:
        return None

    if pcr < 0.4:
        strength = min((0.4 - pcr) / 0.4, 1.0)
        return SignalResult(
            signal_type=AnalyticsSignalType.OPTIONS_UNUSUAL,
            signal_strength=round(strength, 4),
            direction=Direction.BULLISH,  # More calls → bullish sentiment
        )
    if pcr > 2.5:
        strength = min((pcr - 2.5) / 2.5, 1.0)
        return SignalResult(
            signal_type=AnalyticsSignalType.OPTIONS_UNUSUAL,
            signal_strength=round(strength, 4),
            direction=Direction.BEARISH,  # More puts → bearish sentiment
        )
    return None


def detect_signals(
    snapshot: TickerSnapshot,
    subscription: StockAnalyticsSubscription,
    state: AnalyticsState,
) -> List[SignalResult]:
    """Run all signal detectors and return those that pass cooldown."""
    candidates: List[SignalResult] = []
    for detector in [
        _volume_spike_signal,
        _price_momentum_signal,
        _rsi_extreme_signal,
        _options_unusual_signal,
    ]:
        result = detector(snapshot, subscription)
        if result is None:
            continue
        if state.is_on_cooldown(snapshot.ticker, result.signal_type):
            logger.debug(
                "Signal %s for %s is on cooldown — skipping",
                result.signal_type.value,
                snapshot.ticker,
            )
            continue
        candidates.append(result)
        state.mark_fired(snapshot.ticker, result.signal_type)

    return candidates
