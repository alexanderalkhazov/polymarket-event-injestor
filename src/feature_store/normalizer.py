"""Z-score normalizer — used at query time, not stored."""
from __future__ import annotations

from typing import Optional


def z_score(value: Optional[float], mean: float, std: float) -> Optional[float]:
    if value is None or std == 0:
        return None
    return (value - mean) / std
