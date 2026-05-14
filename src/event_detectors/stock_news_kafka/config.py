from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import os

from dotenv import load_dotenv


@dataclass
class FinnhubConfig:
    api_key: str
    base_url: str = "https://finnhub.io/api/v1"
    request_timeout_seconds: int = 30
    rate_limit_delay_ms: int = 1100  # 60 calls/min → ~1s between calls
    http_pool_maxsize: int = 64


@dataclass
class KafkaConfig:
    bootstrap_servers: str
    topic: str
    security_protocol: str = "PLAINTEXT"
    sasl_mechanisms: str = "PLAIN"
    sasl_username: str = ""
    sasl_password: str = ""
    client_id: str = "stock-news-kafka-producer"


@dataclass
class MongoConfig:
    uri: str
    database: str
    collection: str = "stock_news_subscriptions"
    poll_interval_seconds: int = 300


@dataclass
class AppConfig:
    kafka: KafkaConfig
    finnhub: FinnhubConfig
    mongodb: MongoConfig
    environment: str = "dev"
    poll_interval_seconds: int = 300   # Poll news every 5 minutes
    news_lookback_hours: int = 6       # Fetch articles from last 6 hours


def _load_dotenv() -> None:
    project_root = Path(__file__).resolve().parents[3]
    dotenv_path = project_root / ".env"
    if dotenv_path.exists():
        load_dotenv(dotenv_path)
    else:
        load_dotenv()


def _get_env(name: str, default: Optional[str] = None, required: bool = False) -> str:
    value = os.getenv(name, default)
    if required and (value is None or value == ""):
        raise RuntimeError(f"Required environment variable {name!r} is not set")
    return value or ""


def load_config() -> AppConfig:
    _load_dotenv()

    finnhub = FinnhubConfig(
        api_key=_get_env("FINNHUB_API_KEY", required=True),
        base_url=_get_env("FINNHUB_BASE_URL", "https://finnhub.io/api/v1"),
        request_timeout_seconds=int(_get_env("FINNHUB_REQUEST_TIMEOUT_SECONDS", "30")),
        rate_limit_delay_ms=int(_get_env("FINNHUB_RATE_LIMIT_DELAY_MS", "1100")),
        http_pool_maxsize=int(_get_env("FINNHUB_HTTP_POOL_MAXSIZE", "64")),
    )

    kafka = KafkaConfig(
        bootstrap_servers=_get_env("KAFKA_BOOTSTRAP_SERVERS", required=True),
        topic=_get_env("KAFKA_TOPIC", "stock-news-events"),
        security_protocol=_get_env("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT"),
        sasl_mechanisms=_get_env("KAFKA_SASL_MECHANISMS", "PLAIN"),
        sasl_username=_get_env("KAFKA_SASL_USERNAME", ""),
        sasl_password=_get_env("KAFKA_SASL_PASSWORD", ""),
        client_id=_get_env("KAFKA_CLIENT_ID", "stock-news-kafka-producer"),
    )

    mongodb = MongoConfig(
        uri=_get_env("MONGODB_URI", required=True),
        database=_get_env("MONGODB_DATABASE", required=True),
        collection=_get_env("MONGODB_COLLECTION", "stock_news_subscriptions"),
        poll_interval_seconds=int(_get_env("MONGODB_POLL_INTERVAL_SECONDS", "300")),
    )

    return AppConfig(
        kafka=kafka,
        finnhub=finnhub,
        mongodb=mongodb,
        environment=_get_env("ENVIRONMENT", "dev"),
        poll_interval_seconds=int(_get_env("POLL_INTERVAL_SECONDS", "300")),
        news_lookback_hours=int(_get_env("NEWS_LOOKBACK_HOURS", "6")),
    )
