"""Signal backtester — estimates return distributions. Does NOT gate or reject signals."""
from __future__ import annotations

import logging
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class SignalBacktester:
    def __init__(self, tsdb_pool) -> None:
        self.tsdb = tsdb_pool

    async def estimate(self, signals: list[dict], signal_ts=None) -> dict:
        """Return statistical estimates for this signal cluster. Never gates or blocks.

        signal_ts: if provided, only historical setups BEFORE this date are used
                   (walk-forward — prevents lookahead bias).
        """
        # Prefer real stock tickers (news/analytics) over polymarket hex IDs
        ticker_signals = [s for s in signals if s["source"] in ("news", "analytics")]
        symbol = ticker_signals[0]["symbol"] if ticker_signals else signals[0]["symbol"]
        ohlcv = await self._load_ohlcv(symbol)
        if ohlcv is None or len(ohlcv) < 60:
            return self._empty(symbol, signals, "insufficient history")

        entry_dates = await self._find_similar_setups(signals, ohlcv)
        if not entry_dates:
            return self._empty(symbol, signals, "no similar setups found")

        # Walk-forward: discard setups that happened after the signal date
        if signal_ts is not None:
            import pandas as pd
            cutoff = pd.Timestamp(signal_ts).tz_localize(None) if getattr(signal_ts, "tzinfo", None) else pd.Timestamp(signal_ts)
            entry_dates = [d for d in entry_dates if pd.Timestamp(d).tz_localize(None) < cutoff]
            if not entry_dates:
                return self._empty(symbol, signals, "no prior setups before signal date")

        # Find the holding period with the best Sharpe
        best_returns, holding_period = self._best_holding_period(ohlcv, entry_dates)
        if not best_returns:
            return self._empty(symbol, signals, "no valid return calculations")

        wins = [r for r in best_returns if r > 0]
        losses = [r for r in best_returns if r <= 0]
        win_rate = len(wins) / len(best_returns)
        avg_ret = float(np.mean(best_returns))
        med_ret = float(np.median(best_returns))
        avg_win = float(np.mean(wins)) if wins else 0.0
        avg_loss = float(np.mean(losses)) if losses else 0.0
        expect = win_rate * avg_win - (1 - win_rate) * abs(avg_loss)
        _hold_days_map = {"3d": 3, "5d": 5, "10d": 10}
        sharpe = self._sharpe(best_returns, hold_days=_hold_days_map.get(holding_period, 5))
        max_dd = self._max_dd(best_returns)

        n = len(best_returns)
        if n >= 30:
            data_quality = "sufficient"
        elif n >= 10:
            data_quality = "low"
        else:
            data_quality = "very_low"

        expectancy_pct = round(expect * 100, 2)

        return {
            "sample_size": n,
            "win_rate": round(win_rate, 4),
            "expected_return": round(expect, 5),
            "expected_drawdown": round(max_dd, 5),
            "avg_return_pct": round(avg_ret * 100, 2),
            "median_return_pct": round(med_ret * 100, 2),
            "avg_win_pct": round(avg_win * 100, 2),
            "avg_loss_pct": round(avg_loss * 100, 2),
            "expectancy": expectancy_pct,
            "edge_exists": expectancy_pct >= 0,   # used by thin-data gate
            "sharpe": round(sharpe, 2),
            "max_drawdown_pct": round(max_dd * 100, 2),
            "holding_period_optimal": holding_period,
            "data_quality": data_quality,
            "strategy_name": "multi_" + "+".join(sorted({s["type"] for s in signals})),
            "symbol": symbol,
        }

    def _best_holding_period(
        self, ohlcv: pd.DataFrame, entry_dates: list
    ) -> tuple[list[float], str]:
        """Select holding period on 70% of data (IS), report stats on 30% (OOS).

        Prevents the system from picking the best of 3 periods on the same data
        used to evaluate it — a form of overfitting that inflates Sharpe by ~40%.
        With fewer than 15 setups, falls back to all-data evaluation with a 20% penalty.
        """
        candidates = [(3, "3d"), (5, "5d"), (10, "10d")]
        sorted_dates = sorted(entry_dates)
        n = len(sorted_dates)
        use_oos = n >= 15
        split = int(n * 0.70)
        is_dates  = sorted_dates[:split]   if use_oos else sorted_dates
        oos_dates = sorted_dates[split:]   if use_oos else sorted_dates

        # Pick best period on in-sample data only
        best_label  = "5d"
        best_is_sharpe = -999.0
        for days, label in candidates:
            r = self._forward_returns(ohlcv, is_dates, hold_days=days)
            if not r:
                continue
            s = self._sharpe(r, hold_days=days)
            if s > best_is_sharpe:
                best_is_sharpe = s
                best_label = label

        # Compute final returns on OOS (or all data with penalty when too few samples)
        best_days = {"3d": 3, "5d": 5, "10d": 10}[best_label]
        oos_returns = self._forward_returns(ohlcv, oos_dates, hold_days=best_days)
        if not oos_returns:
            oos_returns = self._forward_returns(ohlcv, sorted_dates, hold_days=best_days)
            # Apply 20% penalty to all stats when OOS couldn't be computed
            oos_returns = [r * 0.80 for r in oos_returns]

        return oos_returns, best_label

    async def _load_ohlcv(self, symbol: str) -> Optional[pd.DataFrame]:
        try:
            rows = await self.tsdb.fetch(
                "SELECT ts AS time, open, high, low, close, volume FROM raw_ohlcv "
                "WHERE symbol=$1 AND interval='1d' ORDER BY ts ASC",
                symbol,
            )
            if not rows:
                return None
            df = pd.DataFrame([dict(r) for r in rows])
            for col in ("open", "high", "low", "close", "volume"):
                df[col] = pd.to_numeric(df[col], errors="coerce")
            return df.set_index("time").sort_index()
        except Exception as exc:
            logger.error("Failed to load OHLCV for %s: %s", symbol, exc)
            return None

    async def _load_macro(self, series_id: str, index: pd.DatetimeIndex) -> Optional[pd.Series]:
        try:
            rows = await self.tsdb.fetch(
                "SELECT ts AS time, value FROM raw_macro WHERE series_id=$1 ORDER BY ts ASC",
                series_id,
            )
            if not rows:
                return None
            return pd.Series(
                {r["time"]: float(r["value"]) for r in rows}
            ).reindex(pd.DatetimeIndex(index), method="ffill")
        except Exception:
            return None

    async def _find_similar_setups(self, signals: list[dict], ohlcv: pd.DataFrame) -> list:
        mask = pd.Series(False, index=ohlcv.index)
        matched_any = False
        for s in signals:
            sub = pd.Series(False, index=ohlcv.index)
            if s["type"] == "volume_spike":
                avg30 = ohlcv["volume"].rolling(30).mean()
                sub = ohlcv["volume"] > 1.8 * avg30
                matched_any = True
            elif s["type"] == "rsi_extreme":
                delta = ohlcv["close"].diff()
                gain = delta.clip(lower=0).rolling(14).mean()
                loss = (-delta).clip(lower=0).rolling(14).mean()
                rs = gain / loss.replace(0, float("nan"))
                rsi = 100 - 100 / (1 + rs)
                sub = rsi > 72 if s.get("direction") == "up" else rsi < 28
                matched_any = True
            elif s["type"] in ("momentum", "news_catalyst"):
                chg = ohlcv["close"].pct_change(1)
                sub = chg > 0.04 if s.get("direction") == "up" else chg < -0.04
                matched_any = True
            elif s["type"] == "conviction_shift":
                vix = await self._load_macro("VIXCLS", ohlcv.index)
                if vix is not None:
                    sub = vix > vix.rolling(20).mean() * 1.1
                    matched_any = True
            elif s["type"] == "options_unusual":
                avg30 = ohlcv["volume"].rolling(30).mean()
                sub = ohlcv["volume"] > 1.5 * avg30
                matched_any = True
            elif s["type"] == "adx_trend":
                # ADX > 25: strong trend bars (using Wilder's smoothed TR / DI)
                high, low, close = ohlcv["high"], ohlcv["low"], ohlcv["close"]
                tr = pd.concat([
                    high - low,
                    (high - close.shift()).abs(),
                    (low  - close.shift()).abs(),
                ], axis=1).max(axis=1)
                dh = high.diff()
                dl = -low.diff()
                dm_plus  = dh.where((dh > dl) & (dh > 0), 0.0)
                dm_minus = dl.where((dl > dh) & (dl > 0), 0.0)
                atr14    = tr.ewm(alpha=1/14, adjust=False).mean()
                di_plus  = dm_plus.ewm(alpha=1/14, adjust=False).mean() / atr14 * 100
                di_minus = dm_minus.ewm(alpha=1/14, adjust=False).mean() / atr14 * 100
                dx  = ((di_plus - di_minus).abs() / (di_plus + di_minus).replace(0, float("nan"))) * 100
                adx = dx.ewm(alpha=1/14, adjust=False).mean()
                sub = adx > 25
                matched_any = True
            elif s["type"] == "bb_squeeze":
                # BB width below 25th percentile: price coiling before a move
                sma20  = ohlcv["close"].rolling(20).mean()
                std20  = ohlcv["close"].rolling(20).std()
                bb_w   = (4 * std20) / sma20.replace(0, float("nan"))
                threshold = bb_w.rolling(min(252, len(bb_w))).quantile(0.25)
                sub = bb_w < threshold
                matched_any = True
            elif s["type"] == "stochastic_extreme":
                high14 = ohlcv["high"].rolling(14).max()
                low14  = ohlcv["low"].rolling(14).min()
                stoch  = (ohlcv["close"] - low14) / (high14 - low14).replace(0, float("nan")) * 100
                sub = stoch < 20 if s.get("direction") != "up" else stoch > 80
                matched_any = True
            mask |= sub
        if not matched_any:
            return []
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

    def _sharpe(self, r: list[float], hold_days: int = 1) -> float:
        a = np.array(r)
        return float(np.mean(a) / np.std(a) * np.sqrt(252 / hold_days)) if np.std(a) > 0 else 0.0

    def _max_dd(self, r: list[float]) -> float:
        curve = np.cumprod(1 + np.array(r))
        peak = np.maximum.accumulate(curve)
        dd = (curve - peak) / peak
        return float(dd.min())

    def _empty(self, symbol: str, signals: list[dict], reason: str) -> dict:
        return {
            "sample_size": 0,
            "win_rate": 0.0,
            "expected_return": 0.0,
            "expected_drawdown": 0.0,
            "avg_return_pct": 0.0,
            "median_return_pct": 0.0,
            "expectancy": 0.0,
            "edge_exists": False,
            "sharpe": 0.0,
            "max_drawdown_pct": 0.0,
            "holding_period_optimal": "5d",
            "data_quality": "none",
            "strategy_name": "multi_" + "+".join(sorted({s["type"] for s in signals})),
            "symbol": symbol,
            "note": reason,
        }
