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
    """HTTP client wrapper for the Polymarket Gamma API."""

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
        """
        market_id = data.get("conditionId") or data.get("condition_id") or ""
        if not market_id:
            logger.debug("Skipping market with missing conditionId")
            return None

        question = data.get("question") or ""

        # Parse outcomes and prices (JSON strings)
        outcomes_raw = data.get("outcomes")
        prices_raw = data.get("outcomePrices")
        if not outcomes_raw or not prices_raw:
            logger.debug("Skipping market %s: missing outcomes or outcomePrices", market_id)
            return None

        try:
            outcomes: List[str] = json.loads(outcomes_raw)
            prices: List[str] = json.loads(prices_raw)
        except (json.JSONDecodeError, TypeError) as exc:
            raise PolymarketApiError(
                f"Failed to parse outcomes/outcomePrices for market {market_id}"
            ) from exc

        if len(outcomes) != 2 or len(prices) != 2:
            logger.debug(
                "Skipping market %s: unsupported outcomes count (expected 2, got %d)",
                market_id,
                len(outcomes),
            )
            return None

        # Map outcomes to yes/no prices
        # Binary: Yes/No -> first=yes, second=no
        # Scalar: Long/Short -> Long=yes_price, Short=no_price
        yes_price: Optional[float] = None
        no_price: Optional[float] = None
        for i, outcome in enumerate(outcomes):
            try:
                p = float(prices[i]) if i < len(prices) else None
            except (ValueError, TypeError):
                continue
            if p is None:
                continue
            outcome_lower = str(outcome).lower()
            if outcome_lower == "yes" and yes_price is None:
                yes_price = p
            elif outcome_lower == "no" and no_price is None:
                no_price = p
            elif outcome_lower == "long" and yes_price is None:
                yes_price = p
            elif outcome_lower == "short" and no_price is None:
                no_price = p

        if yes_price is None or no_price is None:
            logger.debug(
                "Skipping market %s: could not map Yes/No or Long/Short prices (outcomes=%s)",
                market_id,
                outcomes,
            )
            return None

        # Volume and liquidity: prefer numeric fields
        volume = data.get("volumeNum")
        if volume is None:
            raw = data.get("volume")
            volume = float(raw) if raw is not None else None

        liquidity = data.get("liquidityNum")
        if liquidity is None:
            raw = data.get("liquidity")
            liquidity = float(raw) if raw is not None else None

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

    def fetch_all_markets(self) -> Dict[str, MarketSnapshot]:
        """Fetch all markets from the Gamma API and return a dict keyed by conditionId."""
        response = self._request_with_retries("GET", "/markets")
        try:
            data = response.json()
        except ValueError as exc:
            raise PolymarketApiError("Failed to parse Polymarket API response as JSON") from exc

        if not isinstance(data, list):
            raise PolymarketApiError(
                f"Expected array response from Gamma API, got {type(data).__name__}"
            )

        result: Dict[str, MarketSnapshot] = {}
        for item in data:
            if not isinstance(item, dict):
                continue
            try:
                snapshot = self._parse_gamma_market(item)
                if snapshot is not None:
                    result[snapshot.market_id] = snapshot
            except PolymarketApiError:
                raise
            except Exception as exc:
                logger.warning("Failed to parse market %s: %s", item.get("conditionId"), exc)

        return result

    async def fetch_all_markets_async(self) -> Dict[str, MarketSnapshot]:
        """Async wrapper around fetch_all_markets for use in the async runner."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.fetch_all_markets)

    def close(self) -> None:
        """Close the underlying HTTP session."""
        self._session.close()
