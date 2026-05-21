"""Analytics producer configuration."""
from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()

DEFAULT_TICKERS = [
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
    # Crypto (options will be null — handled gracefully)
    "BTC-USD", "ETH-USD", "BNB-USD", "SOL-USD", "XRP-USD",
    "ADA-USD", "DOGE-USD", "AVAX-USD", "DOT-USD", "LINK-USD",
    "MATIC-USD", "ATOM-USD", "UNI-USD",
]  # keep in sync with src/config/market_categories.py ALL_SYMBOLS


def _env(name: str, default: str = "", required: bool = False) -> str:
    value = os.getenv(name, default)
    if required and not value:
        raise RuntimeError(f"Required env var {name!r} not set")
    return value


@dataclass
class AppConfig:
    kafka_bootstrap_servers: str
    kafka_topic: str
    tickers: list[str]
    poll_interval_seconds: int


def load_config() -> AppConfig:
    tickers_env = _env("TICKERS", "")
    tickers = [t.strip() for t in tickers_env.split(",") if t.strip()] if tickers_env else DEFAULT_TICKERS
    return AppConfig(
        kafka_bootstrap_servers=_env("KAFKA_BOOTSTRAP_SERVERS", required=True),
        kafka_topic=_env("KAFKA_TOPIC", "raw.analytics"),
        tickers=tickers,
        poll_interval_seconds=int(_env("POLL_INTERVAL_SECONDS", "900")),
    )
