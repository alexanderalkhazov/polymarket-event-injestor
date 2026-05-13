from __future__ import annotations

import logging
import os
import time
from contextlib import contextmanager
from typing import Iterator

from prometheus_client import Counter, Gauge, Histogram, start_http_server

logger = logging.getLogger(__name__)

SERVICE_UP = Gauge("service_up", "Whether the service main loop is running", ["service"])
SERVICE_INFO = Gauge("service_info", "Static service metadata", ["service", "version"])
RUN_CYCLES = Counter("runner_cycles_total", "Completed polling cycles", ["service"])
RUN_ERRORS = Counter("runner_errors_total", "Caught runtime errors", ["service", "stage"])
EVENTS_PUBLISHED = Counter(
    "events_published_total",
    "Events published to Kafka",
    ["service", "pipeline"],
)
EVENTS_CONSUMED = Counter(
    "events_consumed_total",
    "Events consumed from Kafka",
    ["service", "pipeline"],
)
EVENTS_SKIPPED = Counter(
    "events_skipped_total",
    "Events skipped by a filter or dedupe layer",
    ["service", "reason"],
)
CYCLE_DURATION = Histogram(
    "runner_cycle_duration_seconds",
    "Duration of a polling cycle",
    ["service"],
)
LAST_RUN_TS = Gauge("runner_last_run_timestamp_seconds", "Last completed cycle timestamp", ["service"])
LAST_EVENT_TS = Gauge(
    "runner_last_event_timestamp_seconds",
    "Last processed event timestamp",
    ["service", "pipeline"],
)

_STARTED_PORTS: set[int] = set()


def start_metrics_server(service_name: str, default_port: int) -> int:
    port = int(os.getenv("METRICS_PORT", str(default_port)))
    if port <= 0:
        logger.info("Metrics server disabled for %s", service_name)
        return 0

    if port not in _STARTED_PORTS:
        start_http_server(port)
        _STARTED_PORTS.add(port)
        logger.info("Metrics server started for %s on :%s", service_name, port)

    SERVICE_UP.labels(service_name).set(1)
    SERVICE_INFO.labels(service_name, os.getenv("SERVICE_VERSION", "dev")).set(1)
    return port


@contextmanager
def cycle_timer(service_name: str) -> Iterator[None]:
    start = time.perf_counter()
    try:
        yield
    finally:
        duration = time.perf_counter() - start
        RUN_CYCLES.labels(service_name).inc()
        CYCLE_DURATION.labels(service_name).observe(duration)
        LAST_RUN_TS.labels(service_name).set(time.time())


def record_error(service_name: str, stage: str) -> None:
    RUN_ERRORS.labels(service_name, stage).inc()


def record_published_event(service_name: str, pipeline: str) -> None:
    EVENTS_PUBLISHED.labels(service_name, pipeline).inc()
    LAST_EVENT_TS.labels(service_name, pipeline).set(time.time())


def record_consumed_event(service_name: str, pipeline: str) -> None:
    EVENTS_CONSUMED.labels(service_name, pipeline).inc()
    LAST_EVENT_TS.labels(service_name, pipeline).set(time.time())


def record_skipped_event(service_name: str, reason: str) -> None:
    EVENTS_SKIPPED.labels(service_name, reason).inc()
