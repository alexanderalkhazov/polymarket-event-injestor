"""Analytics producer — fetch yfinance snapshots, publish raw to Kafka."""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import yfinance as yf
from confluent_kafka import Producer

from .config import AppConfig

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TickerSnapshot:
    ticker: str
    current_price: Optional[float]
    price_change_1d_pct: Optional[float]
    current_volume: Optional[int]
    avg_volume_30d: Optional[int]
    rsi_14: Optional[float]
    call_volume: Optional[int]
    put_volume: Optional[int]
    put_call_ratio: Optional[float]
    fetched_at: datetime


def _fetch_ticker(ticker: str) -> Optional[TickerSnapshot]:
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}
        hist = t.history(period="2d")
        if hist.empty or len(hist) < 2:
            return None

        current_price = float(hist["Close"].iloc[-1])
        prev_price = float(hist["Close"].iloc[-2])
        price_change = (current_price - prev_price) / prev_price * 100 if prev_price else None
        current_volume = int(hist["Volume"].iloc[-1])
        avg_volume_30d = int(info.get("averageVolume", 0)) or None

        # Simple RSI-14
        hist30 = t.history(period="30d")
        rsi_14 = None
        if len(hist30) >= 15:
            delta = hist30["Close"].diff()
            gain = delta.clip(lower=0).rolling(14).mean()
            loss = (-delta).clip(lower=0).rolling(14).mean()
            rs = gain / loss.replace(0, float("nan"))
            rsi_series = 100 - 100 / (1 + rs)
            rsi_14 = float(rsi_series.iloc[-1]) if not rsi_series.empty else None

        # Options
        call_vol = put_vol = put_call = None
        try:
            exp = t.options
            if exp:
                chain = t.option_chain(exp[0])
                call_vol = int(chain.calls["volume"].sum())
                put_vol = int(chain.puts["volume"].sum())
                put_call = round(put_vol / call_vol, 4) if call_vol else None
        except Exception:
            pass

        return TickerSnapshot(
            ticker=ticker,
            current_price=current_price,
            price_change_1d_pct=round(price_change, 4) if price_change is not None else None,
            current_volume=current_volume,
            avg_volume_30d=avg_volume_30d,
            rsi_14=round(rsi_14, 2) if rsi_14 is not None else None,
            call_volume=call_vol,
            put_volume=put_vol,
            put_call_ratio=put_call,
            fetched_at=datetime.now(timezone.utc),
        )
    except Exception as exc:
        logger.warning("yfinance fetch failed for %s: %s", ticker, exc)
        return None


class AnalyticsProducer:
    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self._producer = Producer({"bootstrap.servers": config.kafka_bootstrap_servers})

    async def start(self) -> None:
        logger.info(
            "Analytics producer started — %d tickers (topic=%s)",
            len(self._config.tickers), self._config.kafka_topic,
        )
        try:
            while True:
                await self._poll()
                await asyncio.sleep(self._config.poll_interval_seconds)
        finally:
            self._producer.flush()

    async def _poll(self) -> None:
        loop = asyncio.get_running_loop()
        published = 0
        for ticker in self._config.tickers:
            snap = await loop.run_in_executor(None, _fetch_ticker, ticker)
            if snap is None:
                continue
            payload = {
                "ticker": snap.ticker,
                "current_price": snap.current_price,
                "price_change_1d_pct": snap.price_change_1d_pct,
                "current_volume": snap.current_volume,
                "avg_volume_30d": snap.avg_volume_30d,
                "rsi_14": snap.rsi_14,
                "call_volume": snap.call_volume,
                "put_volume": snap.put_volume,
                "put_call_ratio": snap.put_call_ratio,
                "fetched_at": snap.fetched_at.isoformat(),
            }
            self._producer.produce(
                topic=self._config.kafka_topic,
                key=ticker,
                value=json.dumps(payload).encode(),
            )
            published += 1
        self._producer.poll(0)
        logger.info("Published analytics for %d/%d tickers", published, len(self._config.tickers))
