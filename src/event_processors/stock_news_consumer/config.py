from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import os

from dotenv import load_dotenv


@dataclass
class KafkaConfig:
    bootstrap_servers: str
    topics: str  # Comma-separated list of topics to consume
    group_id: str = "stock-news-consumer"
    security_protocol: str = "PLAINTEXT"
    sasl_mechanisms: str = "PLAIN"
    sasl_username: str = ""
    sasl_password: str = ""


@dataclass
class CouchbaseConfig:
    connection_string: str
    username: str
    password: str
    bucket: str
    polymarket_ttl_seconds: int = 0
    stock_news_ttl_seconds: int = 0
    stock_analytics_ttl_seconds: int = 0


@dataclass
class AppConfig:
    kafka: KafkaConfig
    couchbase: CouchbaseConfig
    environment: str = "dev"
    poll_interval_ms: int = 1000  # Poll interval in milliseconds
    log_full_events: bool = False
    dedupe_cache_size: int = 10000
    consumer_pipeline: str = "stock-news"
    

def _load_dotenv() -> None:
    """Load environment variables from a .env file if present."""
    project_root = Path(__file__).resolve().parents[3]
    dotenv_path = project_root / ".env"
    if dotenv_path.exists():
        load_dotenv(dotenv_path)
    else:
        load_dotenv()


def _get_env(name: str, default: Optional[str] = None, required: bool = False) -> str:
    """Helper to read environment variables with optional default and 'required' flag."""
    value = os.getenv(name, default)
    if required and (value is None or value == ""):
        raise RuntimeError(f"Required environment variable {name!r} is not set")
    return value or ""


def _get_env_non_negative_int(name: str, default: str = "0") -> int:
    raw_value = _get_env(name, default)
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"Environment variable {name!r} must be an integer, got {raw_value!r}") from exc
    if value < 0:
        raise RuntimeError(f"Environment variable {name!r} must be >= 0, got {value}")
    return value


def load_config() -> AppConfig:
    """Load application configuration from environment variables."""
    _load_dotenv()

    kafka = KafkaConfig(
        bootstrap_servers=_get_env("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092", required=True),
        topics=_get_env("KAFKA_TOPICS", "stock-news-events"),
        group_id=_get_env("KAFKA_GROUP_ID", "stock-news-consumer"),
        security_protocol=_get_env("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT"),
        sasl_mechanisms=_get_env("KAFKA_SASL_MECHANISMS", "PLAIN"),
        sasl_username=_get_env("KAFKA_SASL_USERNAME", ""),
        sasl_password=_get_env("KAFKA_SASL_PASSWORD", ""),
    )

    couchbase = CouchbaseConfig(
        connection_string=_get_env("COUCHBASE_CONNECTION_STRING", "couchbase://couchbase"),
        username=_get_env("COUCHBASE_USERNAME", "Administrator"),
        password=_get_env("COUCHBASE_PASSWORD", "password"),
        bucket=_get_env("COUCHBASE_BUCKET", "polymarket"),
        polymarket_ttl_seconds=_get_env_non_negative_int("COUCHBASE_TTL_POLYMARKET_SECONDS", "0"),
        stock_news_ttl_seconds=_get_env_non_negative_int("COUCHBASE_TTL_STOCK_NEWS_SECONDS", "0"),
        stock_analytics_ttl_seconds=_get_env_non_negative_int("COUCHBASE_TTL_STOCK_ANALYTICS_SECONDS", "0"),
    )

    return AppConfig(
        kafka=kafka,
        couchbase=couchbase,
        environment=_get_env("ENVIRONMENT", "dev"),
        poll_interval_ms=int(_get_env("POLL_INTERVAL_MS", "1000")),
        log_full_events=_get_env("LOG_FULL_EVENTS", "false").lower() in {"1", "true", "yes", "on"},
        dedupe_cache_size=int(_get_env("DEDUPE_CACHE_SIZE", "10000")),
        consumer_pipeline=_get_env("CONSUMER_PIPELINE", "stock-news").strip().lower(),
    )
