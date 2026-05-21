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
    bb_position: Optional[float]
    macd_histogram: Optional[float]
    price_vs_52w_high: Optional[float]
    stoch_k: Optional[float]
    vwap_deviation_pct: Optional[float]   # (price - vwap) / vwap × 100
    call_put_premium_ratio: Optional[float]  # directional: call premium / put premium
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

        hist30 = t.history(period="60d")

        # RSI-14
        rsi_14 = None
        if len(hist30) >= 15:
            delta = hist30["Close"].diff()
            gain = delta.clip(lower=0).rolling(14).mean()
            loss = (-delta).clip(lower=0).rolling(14).mean()
            rs = gain / loss.replace(0, float("nan"))
            rsi_series = 100 - 100 / (1 + rs)
            rsi_14 = float(rsi_series.iloc[-1]) if not rsi_series.empty else None

        # Bollinger Band position (%B): 0 = at lower band, 1 = at upper band
        bb_position = None
        if len(hist30) >= 20:
            closes = hist30["Close"]
            sma20 = closes.rolling(20).mean()
            std20 = closes.rolling(20).std()
            upper = sma20 + 2 * std20
            lower = sma20 - 2 * std20
            band_width = upper.iloc[-1] - lower.iloc[-1]
            if band_width > 0:
                bb_position = round(float((closes.iloc[-1] - lower.iloc[-1]) / band_width), 4)

        # MACD histogram (12-26-9)
        macd_histogram = None
        if len(hist30) >= 27:
            closes = hist30["Close"]
            ema12 = closes.ewm(span=12, adjust=False).mean()
            ema26 = closes.ewm(span=26, adjust=False).mean()
            macd_line = ema12 - ema26
            signal_line = macd_line.ewm(span=9, adjust=False).mean()
            macd_histogram = round(float((macd_line - signal_line).iloc[-1]), 6)

        # Price vs 52-week high
        price_vs_52w_high = None
        high_52w = info.get("fiftyTwoWeekHigh")
        if high_52w and float(high_52w) > 0 and current_price:
            price_vs_52w_high = round(current_price / float(high_52w), 4)

        # Stochastic %K (14-period)
        stoch_k = None
        if len(hist30) >= 14 and "High" in hist30.columns and "Low" in hist30.columns:
            high14 = hist30["High"].rolling(14).max()
            low14  = hist30["Low"].rolling(14).min()
            denom  = high14 - low14
            if denom.iloc[-1] > 0:
                stoch_k = round(float(100 * (hist30["Close"].iloc[-1] - low14.iloc[-1]) / denom.iloc[-1]), 2)

        # Intraday VWAP deviation — anchored to today's market open
        # VWAP = Σ(typical_price × volume) / Σ(volume) since 09:30 ET
        vwap_deviation_pct = None
        try:
            intraday = t.history(period="1d", interval="1m")
            if not intraday.empty and len(intraday) >= 5:
                tp = (intraday["High"] + intraday["Low"] + intraday["Close"]) / 3
                cum_tpv = (tp * intraday["Volume"]).cumsum()
                cum_vol = intraday["Volume"].cumsum()
                vwap = (cum_tpv / cum_vol.replace(0, float("nan"))).iloc[-1]
                if vwap and vwap > 0:
                    vwap_deviation_pct = round((current_price - float(vwap)) / float(vwap) * 100, 4)
        except Exception:
            pass

        # Options — directional premium ratio (call premium / put premium)
        call_vol = put_vol = put_call = None
        call_put_premium_ratio = None
        try:
            exp = t.options
            if exp:
                chain = t.option_chain(exp[0])
                call_vol = int(chain.calls["volume"].sum())
                put_vol = int(chain.puts["volume"].sum())
                put_call = round(put_vol / call_vol, 4) if call_vol else None
                # Premium = last_price × volume (dollar flow, not just count)
                call_prem = float((chain.calls["lastPrice"] * chain.calls["volume"]).sum())
                put_prem  = float((chain.puts["lastPrice"]  * chain.puts["volume"]).sum())
                if put_prem > 0:
                    call_put_premium_ratio = round(call_prem / put_prem, 4)
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
            bb_position=bb_position,
            macd_histogram=macd_histogram,
            price_vs_52w_high=price_vs_52w_high,
            stoch_k=stoch_k,
            vwap_deviation_pct=vwap_deviation_pct,
            call_put_premium_ratio=call_put_premium_ratio,
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
                "bb_position": snap.bb_position,
                "macd_histogram": snap.macd_histogram,
                "price_vs_52w_high": snap.price_vs_52w_high,
                "stoch_k": snap.stoch_k,
                "vwap_deviation_pct": snap.vwap_deviation_pct,
                "call_put_premium_ratio": snap.call_put_premium_ratio,
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
