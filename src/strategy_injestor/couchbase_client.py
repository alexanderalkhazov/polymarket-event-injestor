from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Dict

from couchbase.auth import PasswordAuthenticator
from couchbase.cluster import Cluster, ClusterOptions

logger = logging.getLogger(__name__)


class CouchbaseClient:
    """Couchbase client for persisting conviction events.

    Each event is upserted as a document keyed by market_id, so the latest
    conviction state per market is always available for querying.
    A separate time-series document (keyed by event_id) stores the full history.
    """

    def __init__(self, connection_string: str, username: str, password: str, bucket_name: str) -> None:
        self._bucket_name = bucket_name

        logger.info("Connecting to Couchbase at %s bucket=%s", connection_string, bucket_name)
        auth = PasswordAuthenticator(username, password)
        self._cluster = Cluster(connection_string, ClusterOptions(auth))
        self._cluster.wait_until_ready(timedelta(seconds=15))

        self._bucket = self._cluster.bucket(bucket_name)
        self._collection = self._bucket.default_collection()
        logger.info("Couchbase connected — bucket=%s", bucket_name)

    def upsert_event(self, event: Dict[str, Any]) -> None:
        """Persist a conviction event to Couchbase.

        Two documents are written atomically (best-effort):
        1. `market::{market_id}` — latest state per market (overwritten each time)
        2. `event::{event_id}` — immutable event history record
        """
        market_id = event.get("market_id", "unknown")
        event_id = event.get("event_id", "unknown")

        # Latest state per market — always overwritten
        market_key = f"market::{market_id}"
        self._collection.upsert(market_key, {
            "type": "market_latest",
            **event,
        })

        # Immutable event history
        event_key = f"event::{event_id}"
        self._collection.upsert(event_key, {
            "type": "conviction_event",
            **event,
        })

        logger.info("Persisted event %s for market %s to Couchbase", event_id[:12], market_id[:16])

    def close(self) -> None:
        """Close the Couchbase connection."""
        # The Python SDK handles cleanup on garbage collection
        logger.info("Couchbase client closed")
