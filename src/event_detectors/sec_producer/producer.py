"""SEC EDGAR 8-K producer — polls the EDGAR Atom feed and publishes filing events to Kafka."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional, Set, Tuple

import httpx
from confluent_kafka import Producer

logger = logging.getLogger(__name__)

EDGAR_ATOM_URL = (
    "https://www.sec.gov/cgi-bin/browse-edgar"
    "?action=getcurrent&type=8-K&dateb=&owner=include&count=40&search_text=&output=atom"
)
TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
EDGAR_HEADERS = {"User-Agent": "EventEdge AI contact@eventedge.ai"}

ATOM_NS = "http://www.w3.org/2005/Atom"

ALL_SYMBOLS: Set[str] = {
    "SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "TSLA", "META", "GOOGL",
    "AMZN", "AMD", "NFLX", "INTC", "CRM", "PLTR", "COIN", "USO", "XOM",
    "XLE", "LNG", "GLD", "SLV", "UNG", "WEAT", "TLT",
}

# 8-K item scoring: (score, urgency, direction_hint)
# direction_hint: "up" = bullish, "down" = bearish, None = neutral
_ITEM_SCORES: Dict[str, Tuple[float, str, Optional[str]]] = {
    "2.02": (0.85, "high", None),    # Earnings results — direction depends on beat/miss
    "5.02": (0.70, "high", "down"),  # Executive departure
    "1.01": (0.55, "medium", "up"),  # Material definitive agreement
    "2.05": (0.60, "medium", "down"), # Costs associated with exit/disposal activities
    "8.01": (0.40, "low", None),     # Other events
}
_DEFAULT_SCORE = (0.30, "low", None)

TICKER_REFRESH_INTERVAL = 86400  # 24 hours
POLL_INTERVAL = 300  # 5 minutes


def _extract_item_numbers(text: str) -> list[str]:
    """Extract 8-K item numbers like '1.01', '2.02' from filing summary text."""
    import re
    return re.findall(r"\b(\d\.\d{2})\b", text)


def _score_filing(item_numbers: list[str]) -> Tuple[float, str, Optional[str]]:
    """Return (score, urgency, direction) for the highest-priority item found."""
    best_score = _DEFAULT_SCORE
    for item in item_numbers:
        if item in _ITEM_SCORES:
            candidate = _ITEM_SCORES[item]
            if candidate[0] > best_score[0]:
                best_score = candidate
    return best_score


class SECProducer:
    def __init__(self, bootstrap_servers: str, kafka_topic: str, poll_interval: int) -> None:
        self._bootstrap_servers = bootstrap_servers
        self._kafka_topic = kafka_topic
        self._poll_interval = poll_interval
        self._producer = Producer({"bootstrap.servers": bootstrap_servers})
        self._seen_ids: Set[str] = set()
        # ticker mapping: cik_str (zero-padded 10-digit) -> ticker, and title -> ticker
        self._cik_to_ticker: Dict[str, str] = {}
        self._title_to_ticker: Dict[str, str] = {}
        self._ticker_map_loaded_at: float = 0.0
        self._http: Optional[httpx.AsyncClient] = None

    @classmethod
    def from_env(cls) -> "SECProducer":
        return cls(
            bootstrap_servers=os.environ["KAFKA_BOOTSTRAP_SERVERS"],
            kafka_topic=os.getenv("KAFKA_TOPIC", "raw.sec"),
            poll_interval=int(os.getenv("POLL_INTERVAL_SECONDS", str(POLL_INTERVAL))),
        )

    async def run(self) -> None:
        self._http = httpx.AsyncClient(headers=EDGAR_HEADERS, timeout=15.0, follow_redirects=True)
        try:
            await self._refresh_ticker_map()
            logger.info("SEC producer started (topic=%s, poll=%ds)", self._kafka_topic, self._poll_interval)
            while True:
                try:
                    await self._poll()
                except Exception as exc:
                    logger.error("Poll failed: %s", exc)
                await asyncio.sleep(self._poll_interval)
        finally:
            self._producer.flush()
            if self._http:
                await self._http.aclose()

    async def _refresh_ticker_map(self) -> None:
        now = time.monotonic()
        if now - self._ticker_map_loaded_at < TICKER_REFRESH_INTERVAL and self._cik_to_ticker:
            return
        try:
            resp = await self._http.get(TICKER_MAP_URL)
            resp.raise_for_status()
            data: dict = resp.json()
            cik_map: Dict[str, str] = {}
            title_map: Dict[str, str] = {}
            for entry in data.values():
                cik = str(entry["cik_str"]).zfill(10)
                ticker = str(entry["ticker"]).upper()
                title = str(entry.get("title", "")).lower()
                cik_map[cik] = ticker
                if title:
                    title_map[title] = ticker
            self._cik_to_ticker = cik_map
            self._title_to_ticker = title_map
            self._ticker_map_loaded_at = now
            logger.info("Loaded %d ticker mappings from EDGAR", len(cik_map))
        except Exception as exc:
            logger.warning("Failed to refresh ticker map: %s", exc)

    def _resolve_ticker(self, cik: str, company_name: str) -> Optional[str]:
        padded = cik.zfill(10)
        ticker = self._cik_to_ticker.get(padded)
        if ticker:
            return ticker
        # Fallback: try exact title match
        return self._title_to_ticker.get(company_name.lower())

    async def _poll(self) -> None:
        await self._refresh_ticker_map()

        resp = await self._http.get(EDGAR_ATOM_URL)
        resp.raise_for_status()

        root = ET.fromstring(resp.text)
        entries = root.findall(f"{{{ATOM_NS}}}entry")
        published_count = 0

        for entry in entries:
            entry_id = (entry.findtext(f"{{{ATOM_NS}}}id") or "").strip()
            if not entry_id or entry_id in self._seen_ids:
                continue

            title = (entry.findtext(f"{{{ATOM_NS}}}title") or "").strip()
            filing_url = ""
            link_el = entry.find(f"{{{ATOM_NS}}}link")
            if link_el is not None:
                filing_url = link_el.get("href", "")

            summary = (entry.findtext(f"{{{ATOM_NS}}}summary") or "").strip()
            updated = (entry.findtext(f"{{{ATOM_NS}}}updated") or "").strip()

            # Extract CIK and company name from the title (format: "company_name (CIK 0000320193)")
            import re
            cik_match = re.search(r"\(CIK\s+(\d+)\)", title, re.IGNORECASE)
            cik = cik_match.group(1) if cik_match else ""
            company_name = re.sub(r"\s*\(CIK\s+\d+\)\s*", "", title, flags=re.IGNORECASE).strip()

            ticker = self._resolve_ticker(cik, company_name)
            if not ticker or ticker not in ALL_SYMBOLS:
                self._seen_ids.add(entry_id)
                continue

            item_numbers = _extract_item_numbers(summary + " " + title)
            score, urgency, direction = _score_filing(item_numbers)

            filed_at = updated or datetime.now(timezone.utc).isoformat()

            message = {
                "filing_id": entry_id,
                "cik": cik,
                "company_name": company_name,
                "ticker": ticker,
                "form_type": "8-K",
                "item_numbers": item_numbers,
                "score": score,
                "urgency": urgency,
                "direction": direction,
                "filing_url": filing_url,
                "filed_at": filed_at,
            }

            self._producer.produce(
                topic=self._kafka_topic,
                key=ticker,
                value=json.dumps(message).encode(),
            )
            self._seen_ids.add(entry_id)
            published_count += 1
            logger.info(
                "SEC 8-K: %s (%s) items=%s score=%.2f urgency=%s",
                ticker, company_name, item_numbers, score, urgency,
            )

        self._producer.poll(0)
        if published_count:
            logger.info("Published %d SEC filing(s) to %s", published_count, self._kafka_topic)
        else:
            logger.debug("No new SEC filings for tracked symbols")

        # Bound the seen-IDs set to avoid unbounded growth
        if len(self._seen_ids) > 10_000:
            self._seen_ids = set(list(self._seen_ids)[-5_000:])
