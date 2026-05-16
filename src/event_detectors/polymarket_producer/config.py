"""Polymarket producer configuration."""
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
class PolymarketConfig:
    base_url: str = "https://gamma-api.polymarket.com"
    request_timeout_seconds: int = 30
    rate_limit_delay_ms: int = 200


@dataclass
class AppConfig:
    kafka_bootstrap_servers: str
    kafka_topic: str
    poll_interval_seconds: int
    polymarket: PolymarketConfig


def load_config() -> AppConfig:
    return AppConfig(
        kafka_bootstrap_servers=_env("KAFKA_BOOTSTRAP_SERVERS", required=True),
        kafka_topic=_env("KAFKA_TOPIC", "raw.polymarket"),
        poll_interval_seconds=int(_env("POLL_INTERVAL_SECONDS", "30")),
        polymarket=PolymarketConfig(
            base_url=_env("POLYMARKET_BASE_URL", "https://gamma-api.polymarket.com"),
            request_timeout_seconds=int(_env("POLYMARKET_REQUEST_TIMEOUT_SECONDS", "30")),
            rate_limit_delay_ms=int(_env("POLYMARKET_RATE_LIMIT_DELAY_MS", "200")),
        ),
    )
