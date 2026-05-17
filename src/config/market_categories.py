"""Market category → symbol mapping. Used by resolver and producers."""
from __future__ import annotations

CATEGORY_SYMBOLS: dict[str, list[str]] = {
    "oil_energy":  ["USO", "XOM", "XLE", "LNG"],
    "us_equities": ["SPY", "QQQ", "AAPL", "MSFT", "NVDA"],
    "crypto":      ["BTC-USD", "ETH-USD", "SOL-USD"],
    "rates_macro": ["TLT", "GLD", "SLV"],
    "commodities": ["GLD", "SLV", "UNG", "WEAT"],
    "fx":          [],  # placeholder — requires forex data source
}

SOURCES = ["polymarket", "news", "analytics"]


def symbols_for_categories(categories: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for cat in categories:
        for sym in CATEGORY_SYMBOLS.get(cat, []):
            if sym not in seen:
                seen.add(sym)
                result.append(sym)
    return result
