"""Rule-based scoring placeholder. Used until XGBoost model is trained.

Replaced by a single import swap once models/scoring_model.json exists.
No other code changes needed — the correlator detects the model file automatically.
"""
from __future__ import annotations


def rule_based_score(features: dict) -> float:
    """Returns a probability-like score in [0, 1] based on feature thresholds."""
    score = 0.0
    if (features.get("poly_conviction_delta_1h") or 0) > 0.10:  score += 0.30
    if (features.get("vol_ratio_30d") or 0) > 2.0:              score += 0.25
    if (features.get("news_sentiment_1h") or 0) > 0.70:         score += 0.20
    if (features.get("rsi_14") or 50) < 35:                     score += 0.15
    if (features.get("put_call_ratio") or 1) < 0.40:            score += 0.10
    return min(score, 1.0)
