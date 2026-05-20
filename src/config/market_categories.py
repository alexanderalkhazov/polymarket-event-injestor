"""Market subcategory → symbol mapping. Kept in sync with src/web/app/api/categories/route.ts."""
from __future__ import annotations

SUBCATEGORY_SYMBOLS: dict[str, list[str]] = {
    # US Equities
    "equities_tech":       ["AAPL","MSFT","NVDA","GOOGL","META","AMZN","TSLA","AMD","INTC","CRM","NFLX","PLTR","COIN"],
    "equities_finance":    ["JPM","BAC","GS","MS","WFC","BLK","V","MA"],
    "equities_healthcare": ["JNJ","UNH","LLY","PFE","MRNA","ABBV","AMGN","BMY"],
    "equities_indices":    ["SPY","QQQ","DIA","IWM","VTI","EEM","ARKK"],
    # Commodities
    "commodities_metals":      ["GLD","SLV","IAU","GDX","NEM"],
    "commodities_energy":      ["USO","UNG","XLE","XOM","CVX","LNG"],
    "commodities_agriculture": ["WEAT","CORN","SOYB","DBA"],
    # Macro
    "macro_bonds":     ["TLT","IEF","SHY","HYG","JNK","AGG"],
    "macro_inflation": ["TIP","IAU"],
    # Crypto — yfinance -USD pairs with meaningful history
    "crypto_large_cap": ["BTC-USD","ETH-USD","BNB-USD","SOL-USD","XRP-USD","ADA-USD","DOGE-USD","AVAX-USD"],
    "crypto_defi":      ["UNI-USD","AAVE-USD","MKR-USD","LINK-USD"],
    "crypto_layer1":    ["SOL-USD","ADA-USD","AVAX-USD","DOT-USD","ATOM-USD"],
    "crypto_layer2":    ["MATIC-USD"],
    "crypto_meme":      ["DOGE-USD","SHIB-USD"],
    "crypto_ai":        ["FET-USD","RNDR-USD"],
}

# Backward-compat alias
CATEGORY_SYMBOLS = SUBCATEGORY_SYMBOLS

SOURCES = ["polymarket", "news", "analytics"]

# ── Master watchlist ──────────────────────────────────────────────────────────
# Single source of truth for historical ingestion, feature store, analytics
# producer, and SEC producer. All services keep their local ALL_SYMBOLS in sync
# with this list. Crypto tickers use the yfinance -USD convention.
ALL_SYMBOLS: list[str] = [
    # Broad-market index ETFs
    "SPY", "QQQ", "DIA", "IWM", "VTI", "EEM", "ARKK",
    # Tech
    "AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA",
    "AMD", "INTC", "CRM", "NFLX", "PLTR", "COIN",
    # Finance
    "JPM", "BAC", "GS", "MS", "WFC", "V", "MA",
    # Healthcare
    "JNJ", "UNH", "LLY", "PFE", "ABBV", "AMGN",
    # Energy
    "XOM", "CVX", "XLE", "USO", "UNG", "LNG",
    # Metals & commodities
    "GLD", "SLV", "IAU", "GDX", "WEAT", "CORN", "DBA",
    # Bonds / rates
    "TLT", "IEF", "SHY", "HYG", "AGG", "TIP",
    # Crypto (yfinance -USD; no options data but price/RSI/volume work fine)
    "BTC-USD", "ETH-USD", "BNB-USD", "SOL-USD", "XRP-USD",
    "ADA-USD", "DOGE-USD", "AVAX-USD", "DOT-USD", "LINK-USD",
    "MATIC-USD", "ATOM-USD", "UNI-USD",
]

# Equity-only subset — used where crypto is not applicable (e.g. SEC filings)
EQUITY_SYMBOLS: list[str] = [s for s in ALL_SYMBOLS if not s.endswith("-USD")]


def symbols_for_categories(categories: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for cat in categories:
        for sym in SUBCATEGORY_SYMBOLS.get(cat, []):
            if sym not in seen:
                seen.add(sym)
                result.append(sym)
    return result
