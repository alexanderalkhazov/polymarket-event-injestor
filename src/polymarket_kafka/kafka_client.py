from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from confluent_kafka import Producer

from .config import KafkaConfig
from .event_builder import event_to_dict
from .models import PolymarketEvent

logger = logging.getLogger(__name__)


class KafkaClient:
    """Kafka producer wrapper for publishing Polymarket events."""

    def __init__(self, config: KafkaConfig) -> None:
        self._config = config

        producer_conf: dict[str, object] = {
            "bootstrap.servers": config.bootstrap_servers,
            "client.id": config.client_id,
            "acks": "all",
            "enable.idempotence": True,
            "compression.type": "zstd",
            "batch.num.messages": 10000,
            "linger.ms": 10,
            "queue.buffering.max.kbytes": 32768,
            "delivery.timeout.ms": 60000,
            "message.max.bytes": 5 * 1024 * 1024,
        }

        if config.security_protocol != "PLAINTEXT":
            producer_conf.update(
                {
                    "security.protocol": config.security_protocol,
                    "sasl.mechanisms": config.sasl_mechanisms,
                    "sasl.username": config.sasl_username,
                    "sasl.password": config.sasl_password,
                }
            )

        logger.info(
            "Initializing Kafka producer for bootstrap_servers=%s topic=%s",
            config.bootstrap_servers,
            self.topic,
        )
        self._producer = Producer(producer_conf)
        logger.info("Kafka producer initialized")

    @property
    def topic(self) -> str:
        """Fully qualified topic name, including optional prefix."""
        return f"{self._config.topic_prefix}{self._config.topic}"

    def _delivery_report(self, err, msg) -> None:  # type: ignore[no-untyped-def]
        """Callback to log delivery results."""
        if err is not None:
            logger.error("Failed to deliver message: %s", err)
        else:
            logger.debug(
                "Message delivered to %s [%s] at offset %s",
                msg.topic(),
                msg.partition(),
                msg.offset(),
            )

    def publish_event(self, event: PolymarketEvent) -> None:
        """Serialize and publish a PolymarketEvent to Kafka."""
        published_at = datetime.now(timezone.utc)
        payload = event_to_dict(event, published_at=published_at)
        key = payload["market_id"]
        data = json.dumps(payload, default=str).encode("utf-8")

        logger.info(
            "Publishing event for market_id=%s event_id=%s direction=%s magnitude=%.4f",
            payload.get("market_id"),
            payload.get("event_id"),
            payload.get("conviction_direction"),
            payload.get("conviction_magnitude", 0.0),
        )

        self._producer.produce(
            topic=self.topic,
            key=key,
            value=data,
            on_delivery=self._delivery_report,
        )

    def flush(self, timeout: float | None = None) -> None:
        """Flush pending messages."""
        self._producer.flush(timeout)