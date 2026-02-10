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
    group_id: str = "strategy-injestor"
    security_protocol: str = "PLAINTEXT"
    sasl_mechanisms: str = "PLAIN"
    sasl_username: str = ""
    sasl_password: str = ""


@dataclass
class AppConfig:
    kafka: KafkaConfig
    environment: str = "dev"
    poll_interval_ms: int = 1000  # Poll interval in milliseconds
    

def _load_dotenv() -> None:
    """Load environment variables from a .env file if present."""
    project_root = Path(__file__).resolve().parents[2]
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


def load_config() -> AppConfig:
    """Load application configuration from environment variables."""
    _load_dotenv()

    kafka = KafkaConfig(
        bootstrap_servers=_get_env("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092", required=True),
        topic=_get_env("KAFKA_TOPIC", "polymarket-events"),
        group_id=_get_env("KAFKA_GROUP_ID", "strategy-injestor"),
        security_protocol=_get_env("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT"),
        sasl_mechanisms=_get_env("KAFKA_SASL_MECHANISMS", "PLAIN"),
        sasl_username=_get_env("KAFKA_SASL_USERNAME", ""),
        sasl_password=_get_env("KAFKA_SASL_PASSWORD", ""),
    )

    return AppConfig(
        kafka=kafka,
        environment=_get_env("ENVIRONMENT", "dev"),
        poll_interval_ms=int(_get_env("POLL_INTERVAL_MS", "1000")),
    )
