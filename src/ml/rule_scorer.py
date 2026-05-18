"""Rule-based scoring placeholder. Used until XGBoost model is trained.

Direction-aware: a bearish RSI or high put/call gives high confidence for a SELL
signal, not a low score that gets dropped at the confidence gate.
Replaced by a single import swap once models/scoring_model.json exists.
"""
from __future__ import annotations


def rule_based_score(features: dict, direction: str = "up") -> float:
    """Return a probability-like confidence in [0, 1].

    Each feature contributes only when it aligns with `direction` so that
    bearish signals score as well as bullish ones.
    """
    score = 0.0

    # Polymarket conviction delta — directional
    delta = features.get("poly_conviction_delta_1h") or 0
    if direction == "up"   and delta >  0.10: score += 0.30
    if direction == "down" and delta < -0.10: score += 0.30

    # Volume spike — direction-neutral signal strength booster
    if (features.get("vol_ratio_30d") or 0) > 2.0: score += 0.25

    # News sentiment — high = bullish activity, low = bearish press
    ns = features.get("news_sentiment_1h") or 0.5
    if direction == "up"   and ns >  0.65: score += 0.20
    if direction == "down" and ns <  0.35: score += 0.20

    # RSI extreme — oversold = buy, overbought = sell
    rsi = features.get("rsi_14") or 50
    if direction == "up"   and rsi < 35: score += 0.15
    if direction == "down" and rsi > 65: score += 0.15

    # Put/call ratio — low = bullish flow, high = bearish flow
    pcr = features.get("put_call_ratio") or 1.0
    if direction == "up"   and pcr < 0.40: score += 0.10
    if direction == "down" and pcr > 2.50: score += 0.10

    return min(score, 1.0)
