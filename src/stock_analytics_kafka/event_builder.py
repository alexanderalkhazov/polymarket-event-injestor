from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from .data_source import TickerSnapshot
from .models import StockAnalyticsEvent, StockAnalyticsSubscription
from .signal_detector import SignalResult

logger = logging.getLogger(__name__)


def build_analytics_event(
    snapshot: TickerSnapshot,
    signal: SignalResult,
    subscription: StockAnalyticsSubscription,
) -> StockAnalyticsEvent:
    return StockAnalyticsEvent(
        event_id=str(uuid.uuid4()),
        timestamp=snapshot.fetched_at,
        ticker=subscription.ticker,
        company_name=subscription.company_name or subscription.ticker,
        signal_type=signal.signal_type,
        signal_strength=signal.signal_strength,
        direction=signal.direction,
        current_price=snapshot.current_price,
        price_change_1d_pct=snapshot.price_change_1d_pct,
        current_volume=snapshot.current_volume,
        avg_volume_30d=snapshot.avg_volume_30d,
        volume_ratio=snapshot.volume_ratio,
        rsi_14=snapshot.rsi_14,
        call_volume=snapshot.call_volume,
        put_volume=snapshot.put_volume,
        put_call_ratio=snapshot.put_call_ratio,
        published_at=datetime.now(timezone.utc),
    )


def event_to_dict(event: StockAnalyticsEvent) -> dict:
    return {
        "event_id": event.event_id,
        "timestamp": event.timestamp.isoformat(),
        "ticker": event.ticker,
        "company_name": event.company_name,
        "signal_type": event.signal_type.value,
        "signal_strength": event.signal_strength,
        "direction": event.direction.value,
        "current_price": event.current_price,
        "price_change_1d_pct": event.price_change_1d_pct,
        "current_volume": event.current_volume,
        "avg_volume_30d": event.avg_volume_30d,
        "volume_ratio": event.volume_ratio,
        "rsi_14": event.rsi_14,
        "call_volume": event.call_volume,
        "put_volume": event.put_volume,
        "put_call_ratio": event.put_call_ratio,
        "pipeline": event.pipeline,
        "published_at": event.published_at.isoformat() if event.published_at else None,
    }
