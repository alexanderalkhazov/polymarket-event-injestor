from __future__ import annotations

import json
import logging
from typing import Optional

from confluent_kafka import Producer
from confluent_kafka.admin import AdminClient, NewTopic

from .config import KafkaConfig

logger = logging.getLogger(__name__)


class KafkaClient:
    """Confluent Kafka producer wrapper for stock analytics events."""

    def __init__(self, config: KafkaConfig) -> None:
        self._config = config
        producer_config: dict = {
            "bootstrap.servers": config.bootstrap_servers,
            "security.protocol": config.security_protocol,
            "client.id": config.client_id,
            "enable.idempotence": True,
            "acks": "all",
            "compression.type": "zstd",
        }
        if config.security_protocol in ("SASL_SSL", "SASL_PLAINTEXT") and config.sasl_username:
            producer_config.update(
                {
                    "sasl.mechanisms": config.sasl_mechanisms,
                    "sasl.username": config.sasl_username,
                    "sasl.password": config.sasl_password,
                }
            )
        self._producer = Producer(producer_config)
        self._ensure_topic_exists()

    def _ensure_topic_exists(self) -> None:
        admin_cfg = {"bootstrap.servers": self._config.bootstrap_servers}
        admin = AdminClient(admin_cfg)
        metadata = admin.list_topics(timeout=10)
        if self._config.topic not in metadata.topics:
            new_topic = NewTopic(self._config.topic, num_partitions=3, replication_factor=1)
            futures = admin.create_topics([new_topic])
            for _, fut in futures.items():
                try:
                    fut.result()
                    logger.info("Created Kafka topic %s", self._config.topic)
                except Exception as exc:
                    logger.warning("Could not create topic %s: %s", self._config.topic, exc)

    def _on_delivery(self, err: Optional[Exception], msg: object) -> None:
        if err:
            logger.error("Kafka delivery error: %s", err)
        else:
            logger.debug("Delivered to %s [%s]", getattr(msg, "topic", "?"), getattr(msg, "partition", "?"))

    def publish_event(self, event_dict: dict, key: Optional[str] = None) -> None:
        payload = json.dumps(event_dict, default=str).encode("utf-8")
        key_bytes = key.encode("utf-8") if key else None
        self._producer.produce(
            topic=self._config.topic,
            key=key_bytes,
            value=payload,
            callback=self._on_delivery,
        )
        self._producer.poll(0)

    def flush(self) -> None:
        self._producer.flush()
