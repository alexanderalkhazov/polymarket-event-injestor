from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from confluent_kafka import Consumer

from .config import KafkaConfig

logger = logging.getLogger(__name__)


class KafkaConsumer:
    """Kafka consumer for consuming conviction events from polymarket-events topic.
    
    ===== KAFKA CONSUMER (CONSUMPTION SIDE) =====
    
    This service CONSUMES events published by polymarket-kafka service.
    Events arrive as JSON messages on the 'polymarket-events' Kafka topic.
    
    This is the CONSUMER side of the data pipeline.
    The PRODUCER side is the polymarket-kafka service that publishes events.
    """

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

        logger.info(
            "Initializing Kafka consumer for bootstrap_servers=%s topic=%s group_id=%s",
            config.bootstrap_servers,
            config.topic,
            config.group_id,
        )
        self._consumer = Consumer(consumer_conf)
        self._consumer.subscribe([config.topic])
        logger.info("Kafka consumer initialized and subscribed to topic '%s'", config.topic)

    def poll(self, timeout_ms: int) -> Optional[Dict[str, Any]]:
        """Poll for a single message from the Kafka topic.
        
        ===== CONSUMING FROM KAFKA =====
        Retrieves conviction events published by polymarket-kafka service.
        Returns deserialized JSON event or None if timeout.
        """
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
