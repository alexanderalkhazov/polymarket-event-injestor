from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class TickerSnapshot:
    """All data needed for signal detection, fetched from yfinance."""

    ticker: str
    fetched_at: datetime

    # Price
    current_price: Optional[float]
    price_change_1d_pct: Optional[float]

    # Volume
    current_volume: Optional[int]
    avg_volume_30d: Optional[int]

    # Technical
    rsi_14: Optional[float]

    # Options
    call_volume: Optional[int]
    put_volume: Optional[int]
    put_call_ratio: Optional[float]

    @property
    def volume_ratio(self) -> Optional[float]:
        if self.current_volume is None or self.avg_volume_30d is None or self.avg_volume_30d == 0:
            return None
        return self.current_volume / self.avg_volume_30d


class YFinanceClient:
    """Fetches OHLCV, options, and technical data for a ticker using yfinance."""

    def fetch_ticker_data(self, ticker: str) -> Optional[TickerSnapshot]:
        """Fetch all analytics data. Returns None if yfinance fails."""
        try:
            import yfinance as yf  # Lazy import — not required at module load time
        except ImportError:
            logger.error("yfinance is not installed — run: pip install yfinance")
            return None

        now = datetime.now(timezone.utc)
        try:
            t = yf.Ticker(ticker)

            # 30-day daily history for avg volume + RSI
            hist = t.history(period="31d", interval="1d", auto_adjust=True)
            if hist.empty:
                logger.warning("yfinance returned empty history for %s", ticker)
                return None

            closes = hist["Close"]
            volumes = hist["Volume"]

            current_price = float(closes.iloc[-1]) if len(closes) >= 1 else None
            prev_close = float(closes.iloc[-2]) if len(closes) >= 2 else None
            price_change_1d_pct: Optional[float] = None
            if current_price is not None and prev_close is not None and prev_close != 0:
                price_change_1d_pct = round((current_price - prev_close) / prev_close * 100, 4)

            current_volume = int(volumes.iloc[-1]) if len(volumes) >= 1 else None
            avg_volume_30d: Optional[int] = None
            if len(volumes) >= 10:
                avg_volume_30d = int(volumes.iloc[:-1].mean())

            # RSI-14
            rsi_14: Optional[float] = None
            if len(closes) >= 15:
                delta = closes.diff()
                gain = delta.clip(lower=0).rolling(14).mean()
                loss = (-delta).clip(lower=0).rolling(14).mean()
                last_gain = gain.iloc[-1]
                last_loss = loss.iloc[-1]
                if last_loss and last_loss != 0:
                    rs = last_gain / last_loss
                    rsi_14 = round(100 - 100 / (1 + rs), 2)

            # Options chain (nearest expiry)
            call_volume: Optional[int] = None
            put_volume: Optional[int] = None
            put_call_ratio: Optional[float] = None
            try:
                expirations = t.options
                if expirations:
                    chain = t.option_chain(expirations[0])
                    call_volume = int(chain.calls["volume"].fillna(0).sum())
                    put_volume = int(chain.puts["volume"].fillna(0).sum())
                    if call_volume > 0:
                        put_call_ratio = round(put_volume / call_volume, 4)
            except Exception as opt_exc:
                logger.debug("Options chain unavailable for %s: %s", ticker, opt_exc)

            return TickerSnapshot(
                ticker=ticker,
                fetched_at=now,
                current_price=current_price,
                price_change_1d_pct=price_change_1d_pct,
                current_volume=current_volume,
                avg_volume_30d=avg_volume_30d,
                rsi_14=rsi_14,
                call_volume=call_volume,
                put_volume=put_volume,
                put_call_ratio=put_call_ratio,
            )
        except Exception as exc:
            logger.error("Failed to fetch ticker data for %s: %s", ticker, exc)
            return None
