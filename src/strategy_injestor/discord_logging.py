from __future__ import annotations

import logging
import os
from typing import Optional

import requests


class DiscordWebhookHandler(logging.Handler):
    """Logging handler that posts messages to a Discord webhook."""

    def __init__(self, webhook_url: str, level: int = logging.INFO, timeout: float = 3.0) -> None:
        super().__init__(level=level)
        self._webhook_url = webhook_url
        self._timeout = timeout

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = self.format(record)
            if len(message) > 1900:
                message = message[:1900] + "..."
            requests.post(self._webhook_url, json={"content": message}, timeout=self._timeout)
        except Exception:
            # Never fail application logging because of webhook issues.
            return


class ServiceFilter(logging.Filter):
    """Attach a service name to each log record for formatting."""

    def __init__(self, service_name: str) -> None:
        super().__init__()
        self._service_name = service_name

    def filter(self, record: logging.LogRecord) -> bool:
        record.service = self._service_name
        return True


def _parse_level(level_name: Optional[str], default: int) -> int:
    if not level_name:
        return default
    return getattr(logging, level_name.upper(), default)


def attach_discord_logging(service_name: Optional[str] = None, formatter: Optional[str] = None) -> None:
    """Attach a Discord webhook handler if DISCORD_WEBHOOK_URL is set."""
    webhook_url = os.getenv("DISCORD_WEBHOOK_URL", "").strip()
    if not webhook_url:
        return

    base_level = _parse_level(os.getenv("LOG_LEVEL"), logging.INFO)
    handler_level = _parse_level(os.getenv("DISCORD_LOG_LEVEL"), base_level)

    resolved_service = service_name or os.getenv("SERVICE_NAME", "strategy-injestor")
    handler = DiscordWebhookHandler(webhook_url, level=handler_level)
    handler.addFilter(ServiceFilter(resolved_service))
    handler.setFormatter(
        logging.Formatter(
            formatter or "%(asctime)s | %(levelname)s | %(service)s | %(name)s | %(message)s"
        )
    )
    logging.getLogger().addHandler(handler)
