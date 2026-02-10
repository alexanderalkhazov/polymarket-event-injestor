from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from confluent_kafka import Producer
from confluent_kafka.admin import AdminClient, NewTopic

from .config import KafkaConfig
from .event_builder import event_to_dict
from .models import PolymarketEvent

logger = logging.getLogger(__name__)


class KafkaClient:
    """Kafka producer wrapper for publishing Polymarket conviction events.
    
    ===== PRODUCER SIDE OF KAFKA PIPELINE =====
    
    This service PUBLISHES events to Kafka topic 'polymarket-events'
    
    Downstream services (e.g., strategy-host) CONSUME from the same topic:
        - They subscribe to 'polymarket-events'
        - They deserialize JSON events
        - They route events to trading strategies
    
    Our job: Send quality conviction signals. Their job: Use them to trade.
    """

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
        
        # Ensure topic exists
        self._ensure_topic_exists()

    def _ensure_topic_exists(self) -> None:
        """Create the Kafka topic if it doesn't exist."""
        try:
            admin_conf = {
                "bootstrap.servers": self._config.bootstrap_servers,
            }
            if self._config.security_protocol != "PLAINTEXT":
                admin_conf.update(
                    {
                        "security.protocol": self._config.security_protocol,
                        "sasl.mechanisms": self._config.sasl_mechanisms,
                        "sasl.username": self._config.sasl_username,
                        "sasl.password": self._config.sasl_password,
                    }
                )
            
            admin_client = AdminClient(admin_conf)
            topic_name = self.topic
            
            # Create topic
            new_topic = NewTopic(topic_name, num_partitions=3, replication_factor=1)
            fs = admin_client.create_topics([new_topic], operation_timeout=30)
            
            for topic, f in fs.items():
                try:
                    f.result()
                    logger.info("Topic '%s' created successfully", topic)
                except Exception as e:
                    # Topic may already exist, which is fine
                    logger.debug("Topic '%s' already exists or creation status: %s", topic, e)
            
            admin_client.close()
        except Exception as e:
            logger.warning("Failed to ensure topic exists: %s. Proceeding anyway (auto-create may handle it).", e)

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
        """Serialize and publish a PolymarketEvent to Kafka.
        
        ===== KAFKA PUBLISHING POINT =====
        This is the PRODUCER side: events flow from conviction detection -> Kafka
        Topic: 'polymarket-events' | Partition Key: market_id | Format: JSON | Compression: zstd
        
        Downstream CONSUMPTION happens in strategy-host service which subscribes to same topic
        """
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