from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "service": getattr(record, "service", os.getenv("SERVICE_NAME", "service")),
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
            "process": record.process,
            "thread": record.threadName,
        }

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str)


class ServiceFilter(logging.Filter):
    def __init__(self, service_name: str) -> None:
        super().__init__()
        self._service_name = service_name

    def filter(self, record: logging.LogRecord) -> bool:
        record.service = self._service_name
        return True


def setup_logging(service_name: str, level_name: str | None = None) -> None:
    level = getattr(logging, (level_name or os.getenv("LOG_LEVEL", "INFO")).upper(), logging.INFO)
    log_format = os.getenv("LOG_FORMAT", "json").strip().lower()

    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(ServiceFilter(service_name))
    if log_format == "text":
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s | %(levelname)s | %(service)s | %(name)s | %(message)s",
                datefmt="%Y-%m-%dT%H:%M:%S%z",
            )
        )
    else:
        handler.setFormatter(JsonFormatter())

    logging.basicConfig(level=level, handlers=[handler], force=True)
