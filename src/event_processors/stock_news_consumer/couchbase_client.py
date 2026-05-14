from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Dict

from couchbase.auth import PasswordAuthenticator
from couchbase.cluster import Cluster, ClusterOptions
from couchbase.collection import Collection
from couchbase.options import UpsertOptions

logger = logging.getLogger(__name__)

# Named collections inside the _default scope — one per pipeline
_COLLECTION_POLYMARKET = "polymarket"
_COLLECTION_STOCK_NEWS = "stock_news"
_COLLECTION_STOCK_ANALYTICS = "stock_analytics"


class CouchbaseClient:
    """Couchbase client that routes events into three named collections within one bucket.

    Collections (under _default scope):
      polymarket       — Pipeline 1 conviction events
      stock_news       — Pipeline 2 hot news events
      stock_analytics  — Pipeline 3 sharp analytics signals
    """

    def __init__(
        self,
        connection_string: str,
        username: str,
        password: str,
        bucket_name: str,
        polymarket_ttl_seconds: int = 0,
        stock_news_ttl_seconds: int = 0,
        stock_analytics_ttl_seconds: int = 0,
    ) -> None:
        self._bucket_name = bucket_name
        self._collection_ttls_seconds: Dict[str, int] = {
            "polymarket": max(0, polymarket_ttl_seconds),
            "stock-news": max(0, stock_news_ttl_seconds),
            "stock-analytics": max(0, stock_analytics_ttl_seconds),
        }

        logger.info("Connecting to Couchbase at %s bucket=%s", connection_string, bucket_name)
        auth = PasswordAuthenticator(username, password)
        self._cluster = Cluster(connection_string, ClusterOptions(auth))
        self._cluster.wait_until_ready(timedelta(seconds=15))

        bucket = self._cluster.bucket(bucket_name)
        scope = bucket.scope("_default")

        self._col_polymarket: Collection = scope.collection(_COLLECTION_POLYMARKET)
        self._col_stock_news: Collection = scope.collection(_COLLECTION_STOCK_NEWS)
        self._col_stock_analytics: Collection = scope.collection(_COLLECTION_STOCK_ANALYTICS)

        logger.info(
            "Couchbase connected — bucket=%s collections=[%s, %s, %s]",
            bucket_name,
            _COLLECTION_POLYMARKET,
            _COLLECTION_STOCK_NEWS,
            _COLLECTION_STOCK_ANALYTICS,
        )
        logger.info(
            "Collection TTLs configured (seconds): polymarket=%d stock-news=%d stock-analytics=%d",
            self._collection_ttls_seconds["polymarket"],
            self._collection_ttls_seconds["stock-news"],
            self._collection_ttls_seconds["stock-analytics"],
        )

    def _route_collection(self, pipeline: str) -> Collection:
        if pipeline == "stock-news":
            return self._col_stock_news
        if pipeline == "stock-analytics":
            return self._col_stock_analytics
        return self._col_polymarket

    def _upsert_with_ttl(self, collection: Collection, key: str, body: Dict[str, Any], ttl_seconds: int) -> None:
        if ttl_seconds > 0:
            collection.upsert(key, body, UpsertOptions(expiry=timedelta(seconds=ttl_seconds)))
            return
        collection.upsert(key, body)

    def upsert_event(self, event: Dict[str, Any], user_id: str = "_global") -> None:
        """Persist an event into the appropriate named collection.

        Document key scheme (per-user):
          latest::{user_id}::{entity}        — mutable latest-state doc (overwritten)
          event::{user_id}::{event_id}       — immutable history record

        When user_id is "_global" the event was not matched to any subscriber and
        is stored as a fallback with no per-user fanout.
        """
        pipeline = event.get("pipeline", "polymarket")
        event_id = event.get("event_id", "unknown")
        collection = self._route_collection(pipeline)
        ttl_seconds = self._collection_ttls_seconds.get(pipeline, 0)

        if pipeline == "stock-news":
            ticker = event.get("ticker", "unknown")
            state_key = f"latest::{user_id}::{ticker}"
        elif pipeline == "stock-analytics":
            ticker = event.get("ticker", "unknown")
            signal_type = event.get("signal_type", "unknown")
            state_key = f"latest::{user_id}::{ticker}::{signal_type}"
        else:
            market_id = event.get("market_id", "unknown")
            state_key = f"latest::{user_id}::{market_id}"

        doc_base = {"user_id": user_id, **event}
        self._upsert_with_ttl(collection, state_key, {"type": f"{pipeline}_latest", **doc_base}, ttl_seconds)
        self._upsert_with_ttl(collection, f"event::{user_id}::{event_id}", {"type": f"{pipeline}_event", **doc_base}, ttl_seconds)

        logger.debug(
            "Persisted %s event %s → user=%s collection=%s key=%s",
            pipeline,
            event_id[:12],
            user_id,
            collection.name,
            state_key,
        )

    def close(self) -> None:
        logger.info("Couchbase client closed")
