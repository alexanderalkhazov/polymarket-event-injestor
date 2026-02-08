from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import os

from dotenv import load_dotenv


@dataclass
class PolymarketConfig:
    base_url: str = "https://gamma-api.polymarket.com"
    request_timeout_seconds: int = 30
    rate_limit_delay_ms: int = 200


@dataclass
class KafkaConfig:
    bootstrap_servers: str
    topic: str
    security_protocol: str = "PLAINTEXT"
    sasl_mechanisms: str = "PLAIN"
    sasl_username: str = ""
    sasl_password: str = ""
    client_id: str = "polymarket-kafka-producer"
    topic_prefix: str = ""


@dataclass
class MongoConfig:
    uri: str
    database: str
    collection: str = "polymarket_subscriptions"
    poll_interval_seconds: int = 60
    collection_prefix: str = ""


@dataclass
class AppConfig:
    kafka: KafkaConfig
    polymarket: PolymarketConfig
    mongodb: MongoConfig
    environment: str = "dev"
    poll_interval_seconds: int = 30


def _load_dotenv() -> None:
    """Load environment variables from a .env file if present."""
    # Load from default .env in project root, if it exists.
    project_root = Path(__file__).resolve().parents[2]
    dotenv_path = project_root / ".env"
    if dotenv_path.exists():
        load_dotenv(dotenv_path)
    else:
        # Fallback to standard behavior (loads from current working directory if present)
        load_dotenv()


def _get_env(name: str, default: Optional[str] = None, required: bool = False) -> str:
    """Helper to read environment variables with optional default and 'required' flag."""
    value = os.getenv(name, default)
    if required and (value is None or value == ""):
        raise RuntimeError(f"Required environment variable {name!r} is not set")
    return value or ""


def load_config() -> AppConfig:
    """Load application configuration from environment variables into dataclasses."""
    _load_dotenv()

    polymarket = PolymarketConfig(
        base_url=_get_env("POLYMARKET_BASE_URL", PolymarketConfig.base_url),
        request_timeout_seconds=int(
            _get_env(
                "POLYMARKET_REQUEST_TIMEOUT_SECONDS",
                str(PolymarketConfig.request_timeout_seconds),
            )
        ),
        rate_limit_delay_ms=int(
            _get_env(
                "POLYMARKET_RATE_LIMIT_DELAY_MS",
                str(PolymarketConfig.rate_limit_delay_ms),
            )
        ),
    )

    kafka = KafkaConfig(
        bootstrap_servers=_get_env("KAFKA_BOOTSTRAP_SERVERS", required=True),
        topic=_get_env("KAFKA_TOPIC", required=True),
        security_protocol=_get_env("KAFKA_SECURITY_PROTOCOL", KafkaConfig.security_protocol),
        sasl_mechanisms=_get_env("KAFKA_SASL_MECHANISMS", KafkaConfig.sasl_mechanisms),
        sasl_username=_get_env("KAFKA_SASL_USERNAME", KafkaConfig.sasl_username),
        sasl_password=_get_env("KAFKA_SASL_PASSWORD", KafkaConfig.sasl_password),
        client_id=_get_env("KAFKA_CLIENT_ID", KafkaConfig.client_id),
        topic_prefix=_get_env("KAFKA_TOPIC_PREFIX", ""),
    )

    mongodb = MongoConfig(
        uri=_get_env("MONGODB_URI", required=True),
        database=_get_env("MONGODB_DATABASE", required=True),
        collection=_get_env("MONGODB_COLLECTION", MongoConfig.collection),
        poll_interval_seconds=int(
            _get_env(
                "MONGODB_POLL_INTERVAL_SECONDS",
                str(MongoConfig.poll_interval_seconds),
            )
        ),
        collection_prefix=_get_env("MONGODB_COLLECTION_PREFIX", ""),
    )

    app_config = AppConfig(
        kafka=kafka,
        polymarket=polymarket,
        mongodb=mongodb,
        environment=_get_env("ENVIRONMENT", AppConfig.environment),
        poll_interval_seconds=int(
            _get_env("POLL_INTERVAL_SECONDS", str(AppConfig.poll_interval_seconds))
        ),
    )

    return app_config