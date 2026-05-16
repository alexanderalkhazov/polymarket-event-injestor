"""News producer configuration."""
from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()

DEFAULT_TICKERS = [
    "AAPL", "MSFT", "NVDA", "AMZN", "TSLA", "META", "GOOGL",
    "AMD", "INTC", "NFLX", "COIN", "PLTR", "SOFI", "SPY", "QQQ",
]


def _env(name: str, default: str = "", required: bool = False) -> str:
    value = os.getenv(name, default)
    if required and not value:
        raise RuntimeError(f"Required env var {name!r} not set")
    return value


@dataclass
class AppConfig:
    kafka_bootstrap_servers: str
    kafka_topic: str
    finnhub_api_key: str
    tickers: list[str]
    poll_interval_seconds: int
    news_lookback_hours: int


def load_config() -> AppConfig:
    tickers_env = _env("TICKERS", "")
    tickers = [t.strip() for t in tickers_env.split(",") if t.strip()] if tickers_env else DEFAULT_TICKERS
    return AppConfig(
        kafka_bootstrap_servers=_env("KAFKA_BOOTSTRAP_SERVERS", required=True),
        kafka_topic=_env("KAFKA_TOPIC", "raw.news"),
        finnhub_api_key=_env("FINNHUB_API_KEY", required=True),
        tickers=tickers,
        poll_interval_seconds=int(_env("POLL_INTERVAL_SECONDS", "300")),
        news_lookback_hours=int(_env("NEWS_LOOKBACK_HOURS", "6")),
    )
