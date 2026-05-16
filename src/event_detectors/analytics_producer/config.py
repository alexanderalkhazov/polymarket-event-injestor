"""Analytics producer configuration."""
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _env(name: str, default: str = "", required: bool = False) -> str:
    value = os.getenv(name, default)
    if required and not value:
        raise RuntimeError(f"Required env var {name!r} not set")
    return value


@dataclass
class AppConfig:
    kafka_bootstrap_servers: str
    kafka_topic: str
    database_url: str
    poll_interval_seconds: int


def load_config() -> AppConfig:
    return AppConfig(
        kafka_bootstrap_servers=_env("KAFKA_BOOTSTRAP_SERVERS", required=True),
        kafka_topic=_env("KAFKA_TOPIC", "raw.analytics"),
        database_url=_env("DATABASE_URL", required=True),
        poll_interval_seconds=int(_env("POLL_INTERVAL_SECONDS", "900")),
    )
