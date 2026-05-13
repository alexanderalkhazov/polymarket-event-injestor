from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from confluent_kafka import Consumer

from .config import KafkaConfig

logger = logging.getLogger(__name__)


class KafkaConsumer:
    """Kafka consumer subscribing to all 3 pipeline topics."""

    def __init__(self, config: KafkaConfig) -> None:
        self._config = config

        consumer_conf: Dict[str, str | int | float | bool | None] = {
            "bootstrap.servers": config.bootstrap_servers,
            "group.id": config.group_id,
            "auto.offset.reset": "earliest",
            "enable.auto.commit": True,
        }

        if config.security_protocol != "PLAINTEXT":
            consumer_conf.update(
                {
                    "security.protocol": config.security_protocol,
                    "sasl.mechanisms": config.sasl_mechanisms,
                    "sasl.username": config.sasl_username,
                    "sasl.password": config.sasl_password,
                }
            )

        topic_list = [t.strip() for t in config.topics.split(",") if t.strip()]
        logger.info(
            "Initializing Kafka consumer bootstrap_servers=%s topics=%s group_id=%s",
            config.bootstrap_servers,
            topic_list,
            config.group_id,
        )
        self._consumer = Consumer(consumer_conf)
        self._consumer.subscribe(topic_list)
        logger.info("Kafka consumer subscribed to topics: %s", topic_list)

    def poll(self, timeout_ms: int) -> Optional[Dict[str, Any]]:
        """Poll for a single message from any subscribed topic. Returns None on timeout."""
        msg = self._consumer.poll(timeout_ms / 1000.0)

        if msg is None:
            return None

        if msg.error():
            logger.error("Kafka consumer error: %s", msg.error())
            return None

        try:
            value = msg.value()
            if value is None:
                return None
            payload = json.loads(value.decode("utf-8"))
            logger.debug(
                "Received message topic=%s partition=%d offset=%d",
                msg.topic(),
                msg.partition(),
                msg.offset(),
            )
            return payload
        except json.JSONDecodeError as exc:
            logger.error("Failed to decode JSON message: %s", exc)
            return None

    def close(self) -> None:
        """Close the consumer connection."""
        self._consumer.close()
