from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import requests
from requests import Session
from requests.adapters import HTTPAdapter

from .config import FinnhubConfig

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class NewsArticle:
    """Simplified news article fetched from Finnhub."""

    article_id: str
    ticker: str
    headline: str
    summary: str
    source_name: str
    url: str
    published_at: datetime
    fetched_at: datetime


class FinnhubApiError(Exception):
    pass


class FinnhubClient:
    """HTTP client for the Finnhub REST API with rate limiting and retries."""

    def __init__(self, config: FinnhubConfig) -> None:
        self._config = config
        self._session: Session = requests.Session()
        self._session.headers.update({"X-Finnhub-Token": config.api_key})
        adapter = HTTPAdapter(pool_connections=config.http_pool_maxsize, pool_maxsize=config.http_pool_maxsize)
        self._session.mount("https://", adapter)
        self._session.mount("http://", adapter)
        self._last_request_time: float = 0.0

    def _rate_limit(self) -> None:
        delay = self._config.rate_limit_delay_ms / 1000.0
        elapsed = time.monotonic() - self._last_request_time
        if elapsed < delay:
            time.sleep(delay - elapsed)
        self._last_request_time = time.monotonic()

    def _get(self, path: str, params: Dict[str, Any]) -> Any:
        url = f"{self._config.base_url.rstrip('/')}/{path.lstrip('/')}"
        last_exc: Optional[Exception] = None
        for attempt in range(1, 4):
            try:
                self._rate_limit()
                resp = self._session.get(url, params=params, timeout=self._config.request_timeout_seconds)
                if resp.status_code == 200:
                    return resp.json()
                if 500 <= resp.status_code < 600:
                    last_exc = FinnhubApiError(f"Finnhub 5xx {resp.status_code} on {path}")
                    time.sleep(0.5 * (2 ** (attempt - 1)))
                    continue
                raise FinnhubApiError(f"Finnhub {url} returned {resp.status_code}: {resp.text[:200]}")
            except (requests.Timeout, requests.ConnectionError) as exc:
                last_exc = exc
                if attempt < 3:
                    time.sleep(0.5 * (2 ** (attempt - 1)))
        raise last_exc or FinnhubApiError(f"Finnhub {url} failed after 3 attempts")

    def fetch_company_news(self, ticker: str, lookback_hours: int = 6) -> List[NewsArticle]:
        """Fetch recent company news for a ticker from Finnhub."""
        now = datetime.now(timezone.utc)
        date_from = (now - timedelta(hours=lookback_hours)).strftime("%Y-%m-%d")
        date_to = now.strftime("%Y-%m-%d")

        try:
            data = self._get("company-news", {"symbol": ticker, "from": date_from, "to": date_to})
        except FinnhubApiError as exc:
            logger.error("Failed to fetch news for %s: %s", ticker, exc)
            return []

        if not isinstance(data, list):
            logger.warning("Unexpected Finnhub response for %s: %s", ticker, type(data))
            return []

        articles: List[NewsArticle] = []
        for item in data:
            try:
                published_at = datetime.fromtimestamp(item["datetime"], tz=timezone.utc)
                age_hours = (now - published_at).total_seconds() / 3600
                if age_hours > lookback_hours:
                    continue
                articles.append(
                    NewsArticle(
                        article_id=str(item.get("id", f"{ticker}-{item.get('datetime', '')}") ),
                        ticker=ticker,
                        headline=item.get("headline", "").strip(),
                        summary=item.get("summary", "").strip()[:500],
                        source_name=item.get("source", "unknown"),
                        url=item.get("url", ""),
                        published_at=published_at,
                        fetched_at=now,
                    )
                )
            except (KeyError, ValueError, TypeError, OSError) as exc:
                logger.debug("Skipping malformed Finnhub article: %s", exc)

        logger.info("Fetched %d articles for %s (lookback=%dh)", len(articles), ticker, lookback_hours)
        return articles
