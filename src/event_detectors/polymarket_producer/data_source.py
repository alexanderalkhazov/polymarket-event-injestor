from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import asyncio
import time

import requests
from requests import Response, Session

from .config import PolymarketConfig

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MarketSnapshot:
    """Simplified snapshot of a Polymarket market used by the service.

    This keeps only the fields we care about for conviction detection and event building.
    """

    market_id: str
    question: str
    yes_price: float
    no_price: float
    volume: Optional[float]
    liquidity: Optional[float]
    active: bool
    closed: bool
    fetched_at: datetime


class PolymarketApiError(Exception):
    """Raised when the Polymarket API returns an unexpected response."""


class PolymarketClient:
    """HTTP client wrapper for the Polymarket CLOB API."""

    def __init__(self, config: PolymarketConfig) -> None:
        self._config = config
        self._session: Session = requests.Session()
        self._last_request_time: float = 0.0

    def _rate_limit(self) -> None:
        """Sleep to respect POLYMARKET_RATE_LIMIT_DELAY_MS between requests."""
        delay_seconds = self._config.rate_limit_delay_ms / 1000.0
        now = time.monotonic()
        elapsed = now - self._last_request_time
        if elapsed < delay_seconds:
            time.sleep(delay_seconds - elapsed)
        self._last_request_time = time.monotonic()

    def _request_with_retries(
        self,
        method: str,
        path: str,
        *,
        max_retries: int = 3,
        timeout: Optional[int] = None,
        **kwargs: Any,
    ) -> Response:
        """Perform an HTTP request with basic retry logic on transient failures."""
        url = f"{self._config.base_url.rstrip('/')}/{path.lstrip('/')}"
        if timeout is None:
            timeout = self._config.request_timeout_seconds

        last_exc: Optional[Exception] = None
        for attempt in range(1, max_retries + 1):
            try:
                self._rate_limit()
                response = self._session.request(method=method, url=url, timeout=timeout, **kwargs)
                if 200 <= response.status_code < 300:
                    return response
                # Retry on 5xx; treat 4xx as terminal
                if 500 <= response.status_code < 600:
                    last_exc = PolymarketApiError(
                        f"Polymarket API {url} failed with {response.status_code}: {response.text}"
                    )
                else:
                    raise PolymarketApiError(
                        f"Polymarket API {url} failed with {response.status_code}: {response.text}"
                    )
            except (requests.Timeout, requests.ConnectionError) as exc:
                last_exc = exc

            if attempt < max_retries:
                # Simple exponential backoff
                backoff = 0.5 * (2 ** (attempt - 1))
                time.sleep(backoff)

        assert last_exc is not None
        raise last_exc

    def _parse_gamma_market(self, data: Dict[str, Any]) -> Optional[MarketSnapshot]:
        """Parse a Gamma API market object into a MarketSnapshot.

        Returns None for markets we skip (non-binary/non-scalar, malformed data).
        
        Handles multiple API response formats:
        - Gamma API format: outcomes/outcomePrices as JSON strings
        - CLOB API format: tokens array with outcome and price fields
        """
        market_id = data.get("conditionId") or data.get("condition_id") or data.get("id") or ""
        if not market_id:
            logger.debug("Skipping market with missing ID field. Data keys: %s", list(data.keys())[:5])
            return None

        question = data.get("question") or data.get("title") or ""

        # Try parsing Gamma API format first (outcomes/outcomePrices as JSON strings)
        outcomes_raw = data.get("outcomes")
        prices_raw = data.get("outcomePrices")
        
        yes_price: Optional[float] = None
        no_price: Optional[float] = None
        
        if outcomes_raw and prices_raw:
            try:
                outcomes: Optional[List[str]] = json.loads(outcomes_raw) if isinstance(outcomes_raw, str) else outcomes_raw
                prices: Optional[List[str]] = json.loads(prices_raw) if isinstance(prices_raw, str) else prices_raw
            except (json.JSONDecodeError, TypeError, ValueError) as exc:
                logger.debug("Failed to parse outcomes/prices for %s: %s", market_id, exc)
                outcomes = None
                prices = None
        else:
            outcomes = None
            prices = None

        # If Gamma format parsing succeeded, map prices
        if outcomes and prices and len(outcomes) == 2 and len(prices) == 2:
            for i, outcome in enumerate(outcomes):
                try:
                    p = float(prices[i]) if i < len(prices) else None
                except (ValueError, TypeError):
                    continue
                if p is None:
                    continue
                outcome_lower = str(outcome).lower()
                if outcome_lower in ("yes", "long") and yes_price is None:
                    yes_price = p
                elif outcome_lower in ("no", "short") and no_price is None:
                    no_price = p
        
        # Fallback: Try CLOB API format (tokens array)
        if yes_price is None or no_price is None:
            tokens = data.get("tokens", [])
            if isinstance(tokens, list):
                for token in tokens:
                    if not isinstance(token, dict):
                        continue
                    outcome = str(token.get("outcome", "")).lower()
                    try:
                        price = float(token.get("price", 0))
                    except (ValueError, TypeError):
                        continue
                    
                    if outcome in ("yes", "long") and yes_price is None:
                        yes_price = price
                    elif outcome in ("no", "short") and no_price is None:
                        no_price = price

        if yes_price is None or no_price is None:
            logger.debug(
                "Skipping market %s: could not extract Yes/No prices (outcomes=%s, tokens=%s)",
                market_id,
                outcomes,
                data.get("tokens"),
            )
            return None

        # Volume and liquidity: prefer numeric fields
        volume = data.get("volumeNum") or data.get("volume")
        if volume is not None:
            try:
                volume = float(volume)
            except (ValueError, TypeError):
                volume = None

        liquidity = data.get("liquidityNum") or data.get("liquidity")
        if liquidity is not None:
            try:
                liquidity = float(liquidity)
            except (ValueError, TypeError):
                liquidity = None

        active = bool(data.get("active", True))
        closed = bool(data.get("closed", False))

        return MarketSnapshot(
            market_id=market_id,
            question=question,
            yes_price=yes_price,
            no_price=no_price,
            volume=volume,
            liquidity=liquidity,
            active=active,
            closed=closed,
            fetched_at=datetime.now(timezone.utc),
        )

    def fetch_market_by_slug(self, slug: str) -> Optional[MarketSnapshot]:
        """Fetch a single market by its slug from the Gamma API.

        Returns None if the market cannot be found or parsed.
        """
        try:
            response = self._request_with_retries(
                "GET", "/markets", params={"slug": slug}
            )
        except PolymarketApiError as exc:
            logger.warning("Failed to fetch market by slug '%s': %s", slug, exc)
            return None

        try:
            data = response.json()
        except ValueError:
            logger.warning("Non-JSON response for slug '%s'", slug)
            return None

        if isinstance(data, dict) and "data" in data:
            data = data["data"]
        if isinstance(data, list) and len(data) > 0:
            return self._parse_gamma_market(data[0])
        if isinstance(data, dict):
            return self._parse_gamma_market(data)

        logger.warning("Empty or unexpected response for slug '%s'", slug)
        return None

    async def fetch_market_by_slug_async(self, slug: str) -> Optional[MarketSnapshot]:
        """Async wrapper around fetch_market_by_slug."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.fetch_market_by_slug, slug)

    def _fetch_page(self, offset: int, limit: int = 500) -> List[Dict[str, Any]]:
        """Fetch a single page of markets from the Gamma API."""
        response = self._request_with_retries(
            "GET",
            "/markets",
            params={"active": "true", "closed": "false", "limit": str(limit), "offset": str(offset)},
        )
        try:
            data = response.json()
        except ValueError as exc:
            raise PolymarketApiError("Failed to parse Polymarket API response as JSON") from exc

        if isinstance(data, dict) and "data" in data:
            data = data["data"]
        if not isinstance(data, list):
            raise PolymarketApiError(
                f"Expected array response from API, got {type(data).__name__}"
            )
        return data

    def fetch_all_markets(self) -> Dict[str, MarketSnapshot]:
        """Fetch all active markets from the Polymarket API, paginating automatically.

        Returns a dict keyed by condition_id.
        """
        page_size = 500
        all_items: List[Dict[str, Any]] = []

        for offset in range(0, 10_000, page_size):
            page = self._fetch_page(offset, page_size)
            all_items.extend(page)
            logger.debug("Fetched page offset=%d, got %d markets (total %d)", offset, len(page), len(all_items))
            if len(page) < page_size:
                break  # last page

        logger.info("Fetched %d markets from Polymarket API (paginated)", len(all_items))

        result: Dict[str, MarketSnapshot] = {}
        for item in all_items:
            if not isinstance(item, dict):
                continue
            try:
                snapshot = self._parse_gamma_market(item)
                if snapshot is not None:
                    result[snapshot.market_id] = snapshot
            except PolymarketApiError as exc:
                logger.error("API parsing error for market %s: %s", item.get("conditionId"), exc)
                raise
            except Exception as exc:
                logger.warning(
                    "Failed to parse market %s: %s",
                    item.get("conditionId") or item.get("id"),
                    exc,
                )

        logger.info("Successfully parsed %d valid markets", len(result))
        return result

    async def fetch_all_markets_async(self) -> Dict[str, MarketSnapshot]:
        """Async wrapper around fetch_all_markets for use in the async runner."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.fetch_all_markets)

    def close(self) -> None:
        """Close the underlying HTTP session."""
        self._session.close()
