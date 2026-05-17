"""Market subcategory → symbol mapping. Kept in sync with src/web/app/api/categories/route.ts."""
from __future__ import annotations

SUBCATEGORY_SYMBOLS: dict[str, list[str]] = {
    # US Equities
    "equities_tech":       ["AAPL","MSFT","NVDA","GOOGL","META","AMZN","TSLA","AMD","INTC","CRM"],
    "equities_finance":    ["JPM","BAC","GS","MS","WFC","BLK","V","MA"],
    "equities_healthcare": ["JNJ","UNH","LLY","PFE","MRNA","ABBV","AMGN","BMY"],
    "equities_indices":    ["SPY","QQQ","DIA","IWM","VTI","EEM","ARKK"],
    # Commodities
    "commodities_metals":      ["GLD","SLV","GOLD","NEM","RGLD"],
    "commodities_energy":      ["USO","UNG","BNO","XLE","XOM","CVX","LNG"],
    "commodities_agriculture": ["WEAT","CORN","SOYB","DBA","MOO"],
    # Macro
    "macro_bonds":     ["TLT","IEF","SHY","HYG","JNK","AGG"],
    "macro_inflation": ["TIP","PDBC","IAU","INFL"],
    # Crypto (fallback — live symbols come from CoinGecko via the catalog API)
    "crypto_large_cap": ["BTC-USD","ETH-USD","BNB-USD","SOL-USD","XRP-USD","ADA-USD","DOGE-USD","AVAX-USD"],
    "crypto_defi":      ["UNI-USD","AAVE-USD","MKR-USD","CRV-USD","SNX-USD"],
    "crypto_layer1":    ["SOL-USD","ADA-USD","AVAX-USD","DOT-USD","ATOM-USD"],
    "crypto_layer2":    ["MATIC-USD","ARB-USD","OP-USD","IMX-USD"],
    "crypto_meme":      ["DOGE-USD","SHIB-USD","PEPE-USD","WIF-USD"],
    "crypto_ai":        ["FET-USD","RNDR-USD","TAO-USD","AGIX-USD"],
}

# Backward-compat alias
CATEGORY_SYMBOLS = SUBCATEGORY_SYMBOLS

SOURCES = ["polymarket", "news", "analytics"]


def symbols_for_categories(categories: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for cat in categories:
        for sym in SUBCATEGORY_SYMBOLS.get(cat, []):
            if sym not in seen:
                seen.add(sym)
                result.append(sym)
    return result
