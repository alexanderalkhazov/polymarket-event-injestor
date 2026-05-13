from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import os

from dotenv import load_dotenv


@dataclass
class KafkaConfig:
    bootstrap_servers: str
    topic: str
    security_protocol: str = "PLAINTEXT"
    sasl_mechanisms: str = "PLAIN"
    sasl_username: str = ""
    sasl_password: str = ""
    client_id: str = "stock-analytics-kafka-producer"


@dataclass
class MongoConfig:
    uri: str
    database: str
    collection: str = "stock_analytics_subscriptions"
    poll_interval_seconds: int = 300


@dataclass
class AppConfig:
    kafka: KafkaConfig
    mongodb: MongoConfig
    environment: str = "dev"
    poll_interval_seconds: int = 900    # Poll analytics every 15 minutes
    signal_cooldown_hours: float = 4.0  # Per-ticker per-signal cooldown
    max_concurrent_fetches: int = 6
    fetch_timeout_seconds: int = 25


def _load_dotenv() -> None:
    project_root = Path(__file__).resolve().parents[2]
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

    kafka = KafkaConfig(
        bootstrap_servers=_get_env("KAFKA_BOOTSTRAP_SERVERS", required=True),
        topic=_get_env("KAFKA_TOPIC", "stock-analytics-events"),
        security_protocol=_get_env("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT"),
        sasl_mechanisms=_get_env("KAFKA_SASL_MECHANISMS", "PLAIN"),
        sasl_username=_get_env("KAFKA_SASL_USERNAME", ""),
        sasl_password=_get_env("KAFKA_SASL_PASSWORD", ""),
        client_id=_get_env("KAFKA_CLIENT_ID", "stock-analytics-kafka-producer"),
    )

    mongodb = MongoConfig(
        uri=_get_env("MONGODB_URI", required=True),
        database=_get_env("MONGODB_DATABASE", required=True),
        collection=_get_env("MONGODB_COLLECTION", "stock_analytics_subscriptions"),
        poll_interval_seconds=int(_get_env("MONGODB_POLL_INTERVAL_SECONDS", "300")),
    )

    return AppConfig(
        kafka=kafka,
        mongodb=mongodb,
        environment=_get_env("ENVIRONMENT", "dev"),
        poll_interval_seconds=int(_get_env("POLL_INTERVAL_SECONDS", "900")),
        signal_cooldown_hours=float(_get_env("SIGNAL_COOLDOWN_HOURS", "4")),
        max_concurrent_fetches=int(_get_env("MAX_CONCURRENT_FETCHES", "6")),
        fetch_timeout_seconds=int(_get_env("FETCH_TIMEOUT_SECONDS", "25")),
    )
