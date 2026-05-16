"""Signal backtester using vectorbt — validates setups before AI escalation."""
from __future__ import annotations

import logging
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

MIN_SAMPLE = 20
MIN_WIN = 0.45


class SignalBacktester:
    def __init__(self, tsdb_pool) -> None:  # asyncpg pool for timescaledb
        self.tsdb = tsdb_pool

    async def validate(self, signals: list[dict]) -> dict:
        symbol = signals[0]["symbol"]
        ohlcv = await self._load_ohlcv(symbol)
        if ohlcv is None or len(ohlcv) < 60:
            return self._fail("insufficient history")

        entry_dates = await self._find_similar_setups(signals, ohlcv)
        if len(entry_dates) < MIN_SAMPLE:
            return self._fail(f"only {len(entry_dates)} occurrences, need {MIN_SAMPLE}")

        returns = self._forward_returns(ohlcv, entry_dates, hold_days=5)
        if not returns:
            return self._fail("no valid return calculations")

        wins = [r for r in returns if r > 0]
        losses = [r for r in returns if r <= 0]
        win_rate = len(wins) / len(returns)
        avg_ret = float(np.mean(returns))
        med_ret = float(np.median(returns))
        avg_win = float(np.mean(wins)) if wins else 0.0
        avg_loss = float(np.mean(losses)) if losses else 0.0
        expect = win_rate * avg_win - (1 - win_rate) * abs(avg_loss)

        passed = win_rate >= MIN_WIN and len(returns) >= MIN_SAMPLE

        return {
            "passed": passed,
            "sample_size": len(returns),
            "win_rate": round(win_rate, 4),
            "avg_return_pct": round(avg_ret * 100, 2),
            "median_return_pct": round(med_ret * 100, 2),
            "expectancy": round(expect * 100, 2),
            "sharpe": round(self._sharpe(returns), 2),
            "max_drawdown_pct": round(self._max_dd(returns) * 100, 2),
            "strategy_name": "multi_" + "+".join(sorted({s["type"] for s in signals})),
            "symbol": symbol,
        }

    async def _load_ohlcv(self, symbol: str) -> Optional[pd.DataFrame]:
        try:
            rows = await self.tsdb.fetch(
                "SELECT time, open, high, low, close, volume FROM ohlcv "
                "WHERE symbol=$1 AND interval='1d' ORDER BY time ASC",
                symbol,
            )
            if not rows:
                return None
            df = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close", "volume"])
            df = df.set_index("time").sort_index()
            return df
        except Exception as exc:
            logger.error("Failed to load OHLCV for %s: %s", symbol, exc)
            return None

    async def _load_macro(self, series_id: str, index: pd.DatetimeIndex) -> Optional[pd.Series]:
        try:
            rows = await self.tsdb.fetch(
                "SELECT time, value FROM macro_indicators WHERE series_id=$1 ORDER BY time ASC",
                series_id,
            )
            if not rows:
                return None
            s = pd.Series(
                {r["time"]: float(r["value"]) for r in rows}
            ).reindex(index, method="ffill")
            return s
        except Exception:
            return None

    async def _find_similar_setups(self, signals: list[dict], ohlcv: pd.DataFrame) -> list:
        mask = pd.Series(True, index=ohlcv.index)
        for s in signals:
            if s["type"] == "volume_spike":
                avg30 = ohlcv["volume"].rolling(30).mean()
                mask &= ohlcv["volume"] > 2 * avg30
            elif s["type"] == "rsi_extreme":
                delta = ohlcv["close"].diff()
                gain = delta.clip(lower=0).rolling(14).mean()
                loss = (-delta).clip(lower=0).rolling(14).mean()
                rs = gain / loss.replace(0, float("nan"))
                rsi = 100 - 100 / (1 + rs)
                if s.get("direction") == "up":
                    mask &= rsi > 75
                else:
                    mask &= rsi < 25
            elif s["type"] == "momentum":
                chg = ohlcv["close"].pct_change(1)
                if s.get("direction") == "up":
                    mask &= chg > 0.05
                else:
                    mask &= chg < -0.05
            elif s["type"] == "conviction_shift":
                vix = await self._load_macro("VIXCLS", ohlcv.index)
                if vix is not None:
                    mask &= vix > vix.rolling(20).mean() * 1.2
        return list(ohlcv.index[mask])

    def _forward_returns(self, ohlcv: pd.DataFrame, dates: list, hold_days: int) -> list[float]:
        closes = ohlcv["close"]
        results = []
        for d in dates:
            try:
                i = closes.index.get_loc(d)
                j = min(i + hold_days, len(closes) - 1)
                entry = closes.iloc[i]
                exit_ = closes.iloc[j]
                if entry > 0:
                    results.append((exit_ - entry) / entry)
            except Exception:
                continue
        return results

    def _sharpe(self, r: list[float]) -> float:
        a = np.array(r)
        return float(np.mean(a) / np.std(a) * np.sqrt(252)) if np.std(a) > 0 else 0.0

    def _max_dd(self, r: list[float]) -> float:
        curve = np.cumprod(1 + np.array(r))
        peak = np.maximum.accumulate(curve)
        dd = (curve - peak) / peak
        return float(dd.min())

    def _fail(self, reason: str) -> dict:
        return {
            "passed": False,
            "drop_reason": reason,
            "sample_size": 0,
            "win_rate": 0,
            "avg_return_pct": 0,
            "median_return_pct": 0,
            "expectancy": 0,
            "sharpe": 0,
            "max_drawdown_pct": 0,
        }
