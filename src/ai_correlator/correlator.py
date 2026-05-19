"""AI correlator — the scoring model decides, Claude explains.

Pipeline per signal:
  1.  Fetch signal from PostgreSQL
  2.  Fetch most-recent feature row for the symbol from TimescaleDB
  3.  Score with XGBoost (staleness-discounted) or rule_scorer fallback
  4.  Gate: confidence < regime-adjusted threshold → drop
  4.1 Re-entry lockout: Redis key set after stop-loss → drop
  4.2 Multi-source tracking: record source in Redis; Tier A requires 2+ sources
  4.5 Symbol dedup: opportunity for same symbol in last 6h → drop
  4.6 Earnings guard
  5.  Match hypothesis (SPRT-dead hypotheses skipped automatically)
  6.  Backtest: Sharpe + expectancy gate (replaces raw win_rate gate)
  7.  Quality tier gate (Tier C signals dropped before expensive LLM calls)
  7.1 Multi-source downgrade: Tier A → B when only single source fired
  8.  Embed signal with OpenAI → pgvector search for similar past opps
  9.  Macro snapshot + Polymarket sentiment
  10. Call Claude for narrative
  11. Save opportunity (hold_days from backtest optimal period)
  12. Fan-out per user
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import pickle
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

import anthropic
import asyncpg
import redis.asyncio as aioredis
from openai import OpenAI

from .prompt import build_prompt
from .fan_out import fan_out_to_users
from .polymarket_sentiment import (
    REDIS_KEY as POLY_SENTIMENT_KEY,
    filter_for_tickers,
)

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.65"))
MIN_SHARPE           = float(os.getenv("MIN_SHARPE", "0.80"))   # corrected for holding-period scaling
MIN_SAMPLE_SIZE      = int(os.getenv("MIN_SAMPLE_SIZE", "30"))  # hard floor — fewer samples → always drop
QUALITY_TIER_B       = float(os.getenv("QUALITY_TIER_B", "0.70"))   # below → drop
QUALITY_TIER_A       = float(os.getenv("QUALITY_TIER_A", "0.75"))   # A gets full size

_MODEL_DIR   = Path(os.getenv("MODEL_DIR", "/app/models"))
MODEL_PATH   = _MODEL_DIR / "scoring_model.json"
MODEL_SHORT  = _MODEL_DIR / "scoring_model_short.json"
SHAP_PATH    = _MODEL_DIR / "shap_explainer.pkl"
SHAP_SHORT   = _MODEL_DIR / "shap_explainer_short.pkl"
CAL_PATH     = _MODEL_DIR / "calibrator.pkl"
CAL_SHORT    = _MODEL_DIR / "calibrator_short.pkl"

# Must match train.py exactly — all 31 features in the features table
FEATURE_COLS = [
    # Polymarket
    "poly_yes_price", "poly_conviction_delta_1h", "poly_conviction_delta_4h", "poly_volume_24h",
    # News
    "news_sentiment_1h", "news_sentiment_4h", "news_hotness_peak_4h", "news_article_count_4h",
    # Price / Technical
    "rsi_14", "macd_histogram", "atr_14", "bb_position", "sma_20_slope",
    "vol_ratio_30d", "price_change_1d", "price_change_5d",
    # Options
    "put_call_ratio", "unusual_sweep_count_4h",
    # Macro
    "vix_level", "wti_crude", "us_10y_yield", "fed_funds_rate", "usd_index", "yield_curve_10_2",
    # Advanced technical
    "adx_14", "bb_width", "price_vs_sma50", "atr_pct", "hv_20", "price_vs_52w_high", "stoch_k",
]

_ET = ZoneInfo("America/New_York")
MAX_POSITIONS       = int(os.getenv("MAX_POSITIONS", "5"))
EARNINGS_GUARD_DAYS = int(os.getenv("EARNINGS_GUARD_DAYS", "3"))
SPRT_MAINTENANCE_H  = int(os.getenv("SPRT_MAINTENANCE_H", "6"))

# Confidence thresholds by regime: trading against the trend needs more conviction
REGIME_THRESHOLD = {
    ("bear",     "buy"):  0.80,
    ("bull",     "sell"): 0.78,
    ("sideways", "buy"):  0.68,
    ("sideways", "sell"): 0.68,
    ("bull",     "buy"):  CONFIDENCE_THRESHOLD,
    ("bear",     "sell"): CONFIDENCE_THRESHOLD,
}

_HOLD_TO_DAYS = {"3d": 3, "5d": 5, "10d": 10}

_claude:         Optional[anthropic.Anthropic] = None
_oai:            Optional[OpenAI] = None
_model           = None
_model_short     = None
_explainer       = None
_explainer_short = None
_calibrator      = None   # IsotonicRegression for long model
_calibrator_short = None  # IsotonicRegression for short model
_model_mtime:    float = 0.0
_labeled_count:  int   = 0   # cached sample count for ensemble blend weight


# ── Model management ──────────────────────────────────────────────────────────

def _get_claude() -> anthropic.Anthropic:
    global _claude
    if _claude is None:
        _claude = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _claude


def _get_oai() -> OpenAI:
    global _oai
    if _oai is None:
        _oai = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _oai


def _load_model() -> bool:
    global _model, _model_short, _explainer, _explainer_short
    global _calibrator, _calibrator_short
    if not MODEL_PATH.exists():
        logger.info("No model file found — using rule-based scorer")
        return False
    try:
        import xgboost as xgb
        _model = xgb.XGBClassifier()
        _model.load_model(str(MODEL_PATH))
        if SHAP_PATH.exists():
            with open(SHAP_PATH, "rb") as f:
                _explainer = pickle.load(f)
        if CAL_PATH.exists():
            with open(CAL_PATH, "rb") as f:
                _calibrator = pickle.load(f)
        if MODEL_SHORT.exists():
            _model_short = xgb.XGBClassifier()
            _model_short.load_model(str(MODEL_SHORT))
            if SHAP_SHORT.exists():
                with open(SHAP_SHORT, "rb") as f:
                    _explainer_short = pickle.load(f)
            if CAL_SHORT.exists():
                with open(CAL_SHORT, "rb") as f:
                    _calibrator_short = pickle.load(f)
            logger.info("XGBoost long+short models loaded (calibrators: %s/%s)",
                        "yes" if _calibrator else "no",
                        "yes" if _calibrator_short else "no")
        else:
            logger.info("XGBoost long model loaded")
        return True
    except Exception as exc:
        logger.warning("Failed to load model: %s — falling back to rule scorer", exc)
        return False


_use_xgboost = _load_model()


def _maybe_reload_model() -> None:
    global _use_xgboost, _model_mtime
    if not MODEL_PATH.exists():
        return
    try:
        mtime = MODEL_PATH.stat().st_mtime
        if mtime > _model_mtime:
            logger.info("Model file updated — reloading")
            _use_xgboost = _load_model()
            _model_mtime = mtime
    except Exception as exc:
        logger.warning("Model reload check failed: %s", exc)


def _model_staleness_factor() -> float:
    """Discount confidence proportional to how old the model file is."""
    if not MODEL_PATH.exists():
        return 1.0
    try:
        age_h = (time.time() - MODEL_PATH.stat().st_mtime) / 3600
        if age_h < 24:  return 1.0
        if age_h < 48:  return 0.95
        if age_h < 72:  return 0.90
        return 0.85
    except Exception:
        return 1.0


# ── SPRT: Sequential Probability Ratio Test ───────────────────────────────────

def _sprt_check(wins: int, losses: int,
                p_alive: float = 0.55, p_dead: float = 0.45,
                alpha: float = 0.05, beta_err: float = 0.10) -> str:
    """Return 'alive', 'dead', or 'uncertain'.

    Detects statistically whether a hypothesis has stopped working.
    Needs at least 10 outcomes before drawing conclusions.
    """
    n = wins + losses
    if n < 10:
        return "uncertain"
    log_lr = (
        wins   * math.log(p_alive / p_dead) +
        losses * math.log((1 - p_alive) / (1 - p_dead))
    )
    A = math.log((1 - beta_err) / alpha)    # upper boundary → alive
    B = math.log(beta_err / (1 - alpha))    # lower boundary → dead
    if log_lr >= A:
        return "alive"
    if log_lr <= B:
        return "dead"
    return "uncertain"


async def _sprt_maintenance(db: asyncpg.Pool, tsdb: asyncpg.Pool) -> None:
    """Hourly background task: evaluate expired strategies, update SPRT counters,
    auto-deactivate hypotheses whose edge has disappeared."""
    expired = await db.fetch(
        """SELECT s.id, s.created_at, o.action, o.tickers, o.hold_days, o.hypothesis_id
           FROM strategies s
           JOIN opportunities o ON o.id = s.opportunity_id
           WHERE s.status = 'pending'
             AND s.expires_at < NOW()
             AND s.expires_at > NOW() - INTERVAL '48 hours'
             AND o.hypothesis_id IS NOT NULL""",
    )
    logger.info("SPRT maintenance: evaluating %d expired strategies", len(expired))

    for row in expired:
        ticker = next(
            (t for t in (row["tickers"] or []) if not t.startswith("0x")), None
        )
        if not ticker:
            await db.execute("UPDATE strategies SET status='expired' WHERE id=$1", row["id"])
            continue

        hold_days = int(row["hold_days"] or 5)
        entry_ts  = row["created_at"]
        exit_ts   = entry_ts + timedelta(days=hold_days)

        entry_row = await tsdb.fetchrow(
            """SELECT close FROM raw_ohlcv
               WHERE symbol=$1 AND interval='1d' AND ts >= $2
               ORDER BY ts ASC LIMIT 1""",
            ticker, entry_ts,
        )
        exit_row = await tsdb.fetchrow(
            """SELECT close FROM raw_ohlcv
               WHERE symbol=$1 AND interval='1d' AND ts >= $2
               ORDER BY ts ASC LIMIT 1""",
            ticker, exit_ts,
        )

        if entry_row and exit_row:
            ep = float(entry_row["close"])
            xp = float(exit_row["close"])
            if ep > 0:
                pnl = (xp - ep) / ep * 100
                if row["action"] == "sell":
                    pnl = -pnl
                if pnl > 0:
                    await db.execute(
                        "UPDATE hypotheses SET sprt_wins = sprt_wins + 1 WHERE id=$1",
                        row["hypothesis_id"],
                    )
                else:
                    await db.execute(
                        "UPDATE hypotheses SET sprt_losses = sprt_losses + 1 WHERE id=$1",
                        row["hypothesis_id"],
                    )

        await db.execute("UPDATE strategies SET status='expired' WHERE id=$1", row["id"])

    # Auto-deactivate hypotheses SPRT says are dead
    hyps = await db.fetch(
        "SELECT id, name, sprt_wins, sprt_losses FROM hypotheses WHERE is_active=TRUE"
    )
    for h in hyps:
        if _sprt_check(h["sprt_wins"], h["sprt_losses"]) == "dead":
            logger.warning(
                "Hypothesis '%s' SPRT-dead (W=%d L=%d) — deactivating",
                h["name"], h["sprt_wins"], h["sprt_losses"],
            )
            await db.execute(
                "UPDATE hypotheses SET is_active=FALSE WHERE id=$1", h["id"]
            )


async def _run_sprt_loop(db: asyncpg.Pool, tsdb: asyncpg.Pool) -> None:
    while True:
        await asyncio.sleep(SPRT_MAINTENANCE_H * 3600)
        try:
            await _sprt_maintenance(db, tsdb)
        except Exception as exc:
            logger.warning("SPRT maintenance failed: %s", exc)


# ── Market utilities ──────────────────────────────────────────────────────────

_DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"

def _is_market_open() -> bool:
    if _DEV_MODE:
        return True
    now = datetime.now(_ET)
    if now.weekday() >= 5:
        return False
    total_min = now.hour * 60 + now.minute
    return 9 * 60 + 30 <= total_min < 16 * 60


async def _is_near_earnings(symbol: str, db: asyncpg.Pool) -> bool:
    """Check earnings_calendar table (populated nightly by historical ingestor).

    Falls back to a yfinance call when the table has no entry for this symbol
    so the guard still works on the first day before the nightly job runs.
    """
    try:
        row = await db.fetchrow(
            """SELECT earnings_date FROM earnings_calendar
               WHERE symbol=$1
                 AND earnings_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $2
               LIMIT 1""",
            symbol, timedelta(days=EARNINGS_GUARD_DAYS),
        )
        if row is not None:
            return True
        # Table has no upcoming entry — either no earnings or table is empty.
        # If the table has any rows at all, trust it (no earnings).
        count = await db.fetchval("SELECT COUNT(*) FROM earnings_calendar")
        if count and count > 0:
            return False
    except Exception:
        pass

    # Table empty or DB error — fall back to yfinance (slow but safe)
    try:
        import yfinance as yf
        cal = yf.Ticker(symbol).calendar
        if cal is None:
            return False
        if isinstance(cal, dict):
            dates = cal.get("Earnings Date", [])
            if not dates:
                return False
            ed = dates[0] if isinstance(dates, list) else dates
            ed = ed.date() if hasattr(ed, "date") else ed
            return 0 <= (ed - date.today()).days <= EARNINGS_GUARD_DAYS
        if hasattr(cal, "columns") and "Earnings Date" in cal.columns:
            from datetime import datetime as dt
            ed = dt.fromisoformat(str(cal["Earnings Date"].iloc[0])).date()
            return 0 <= (ed - date.today()).days <= EARNINGS_GUARD_DAYS
    except Exception:
        pass
    return False


async def _get_market_regime(tsdb: asyncpg.Pool) -> dict:
    result = {"trend": "sideways", "volatility": "elevated", "vix": None, "spy_vs_200d_pct": None}
    try:
        spy_rows = await tsdb.fetch(
            "SELECT close FROM raw_ohlcv WHERE symbol='SPY' AND interval='1d' ORDER BY ts DESC LIMIT 200"
        )
        if len(spy_rows) >= 20:
            closes  = [float(r["close"]) for r in spy_rows]
            current = closes[0]
            sma200  = sum(closes) / len(closes)
            pct     = (current - sma200) / sma200 * 100
            result["spy_vs_200d_pct"] = round(pct, 2)
            result["trend"] = "bull" if pct > 2 else ("bear" if pct < -2 else "sideways")

        vix_row = await tsdb.fetchrow(
            "SELECT value FROM raw_macro WHERE series_id='VIXCLS' ORDER BY ts DESC LIMIT 1"
        )
        if vix_row:
            vix = float(vix_row["value"])
            result["vix"] = vix
            result["volatility"] = "low" if vix < 18 else ("high" if vix >= 28 else "elevated")
    except Exception as exc:
        logger.warning("Regime detection failed: %s", exc)
    return result


# ── Scoring ───────────────────────────────────────────────────────────────────

def _ensemble_alpha() -> float:
    """Blend weight for XGBoost vs rule scorer.

    Below 200 samples the rule scorer has significant say — the XGBoost model
    was trained on thin data and we shouldn't trust it fully yet.
    Above 500 samples XGBoost takes over completely (alpha=1.0).
    This prevents the model from being dangerously overconfident early on.
    """
    n = _labeled_count
    if n <= 0:
        return 0.0
    if n >= 500:
        return 1.0
    return min(1.0, n / 500)


def _score(feat_dict: dict, direction: str = "up") -> tuple[float, list[dict]]:
    staleness    = _model_staleness_factor()
    top_features: list[dict] = []

    from .rule_scorer import rule_based_score
    rule_conf = rule_based_score(feat_dict, direction=direction)

    if _use_xgboost and _model is not None:
        try:
            import pandas as pd
            X = pd.DataFrame([{c: float(feat_dict.get(c) or 0) for c in FEATURE_COLS}])
            active_model      = (_model_short if direction == "down" and _model_short else _model)
            active_explainer  = (_explainer_short if direction == "down" and _explainer_short else _explainer)
            active_calibrator = (_calibrator_short if direction == "down" and _calibrator_short else _calibrator)

            raw_conf = float(active_model.predict_proba(X)[0][1])

            # Apply isotonic calibration so probabilities reflect true win rates
            if active_calibrator is not None:
                import numpy as np
                cal_conf = float(active_calibrator.predict(np.array([raw_conf]))[0])
            else:
                cal_conf = raw_conf

            # Smooth ensemble: blend toward rule scorer when model data is thin
            alpha      = _ensemble_alpha()
            xgb_conf   = cal_conf * staleness
            confidence = alpha * xgb_conf + (1 - alpha) * rule_conf

            if active_explainer is not None:
                shap_vals = active_explainer.shap_values(X)[0]
                top_features = sorted(
                    [
                        {
                            "feature": FEATURE_COLS[i],
                            "current_value": float(X.iloc[0, i]),
                            "shap_value": float(shap_vals[i]),
                        }
                        for i in range(len(FEATURE_COLS))
                    ],
                    key=lambda x: abs(x["shap_value"]),
                    reverse=True,
                )[:5]

            logger.debug(
                "Score: xgb_raw=%.3f cal=%.3f rule=%.3f alpha=%.2f final=%.3f",
                raw_conf, cal_conf, rule_conf, alpha, confidence,
            )
            return confidence, top_features
        except Exception as exc:
            logger.warning("XGBoost scoring failed: %s — using rule scorer", exc)

    return rule_conf * staleness, []


def _signal_quality(confidence: float) -> str:
    """A = high conviction, B = good, C = too weak for LLM pipeline."""
    if confidence >= QUALITY_TIER_A:
        return "A"
    if confidence >= QUALITY_TIER_B:
        return "B"
    return "C"


# ── Hypothesis matching ───────────────────────────────────────────────────────

_POLY_KEYWORD_TICKERS: list[tuple[list[str], str]] = [
    (["bitcoin", " btc "], "BTC-USD"),
    (["ethereum", " eth "], "ETH-USD"),
    (["solana", " sol "], "SOL-USD"),
    (["xrp", "ripple"], "XRP-USD"),
    (["dogecoin", "doge"], "DOGE-USD"),
    (["nvidia", "nvda"], "NVDA"),
    (["apple", " aapl"], "AAPL"),
    (["tesla", " tsla"], "TSLA"),
    (["microsoft", " msft"], "MSFT"),
    (["meta ", "facebook"], "META"),
    (["amazon", " amzn"], "AMZN"),
    (["google", "alphabet", "googl"], "GOOGL"),
    (["oil", "opec", "crude", "brent", "wti"], "USO"),
    (["gold", "bullion"], "GLD"),
    (["fed ", "federal reserve", "fomc", "rate hike", "rate cut", "powell"], "TLT"),
    (["trump", "republican", "maga", "gop"], "SPY"),
    (["recession", "gdp", "s&p", "stock market", "dow jones", "nasdaq"], "SPY"),
    (["inflation", "cpi", "pce"], "TIP"),
]


def _extract_poly_ticker(question: str) -> Optional[str]:
    q = question.lower()
    for keywords, ticker in _POLY_KEYWORD_TICKERS:
        if any(kw in q for kw in keywords):
            return ticker
    return None


async def _match_hypothesis(feat_dict: dict, db: asyncpg.Pool) -> Optional[dict]:
    rows = await db.fetch("SELECT * FROM hypotheses WHERE is_active=TRUE ORDER BY created_at")
    for row in rows:
        h = dict(row)
        # Skip hypotheses that SPRT has determined are no longer working
        sprt_status = _sprt_check(h.get("sprt_wins", 0), h.get("sprt_losses", 0))
        if sprt_status == "dead":
            logger.debug("Hypothesis '%s' SPRT-dead — skipping", h["name"])
            continue
        conditions: dict = h.get("feature_conditions") or {}
        if isinstance(conditions, str):
            conditions = json.loads(conditions)
        if _conditions_met(feat_dict, conditions):
            return h
    # No catch-all — drop signals that match no real hypothesis
    return None


def _conditions_met(feat_dict: dict, conditions: dict) -> bool:
    for feature, constraint in conditions.items():
        val = feat_dict.get(feature)
        if val is None:
            return False
        if isinstance(constraint, dict):
            if "gt"  in constraint and float(val) <= float(constraint["gt"]):  return False
            if "lt"  in constraint and float(val) >= float(constraint["lt"]):  return False
            if "gte" in constraint and float(val) <  float(constraint["gte"]): return False
            if "lte" in constraint and float(val) >  float(constraint["lte"]): return False
        elif float(val) != float(constraint):
            return False
    return True


# ── Backtest ──────────────────────────────────────────────────────────────────

async def _run_backtest(
    signal: dict, hypothesis: dict, symbol: str,
    tsdb: asyncpg.Pool, db: asyncpg.Pool, signal_ts=None
) -> dict:
    from .backtester import SignalBacktester
    bt = await SignalBacktester(tsdb).estimate([signal], signal_ts=signal_ts)

    n          = bt["sample_size"]
    sharpe     = bt.get("sharpe") or 0.0
    expectancy = bt.get("expectancy") or 0.0

    if n < MIN_SAMPLE_SIZE:
        # Hard floor: too few historical setups to trust any statistic
        passed      = False
        drop_reason = f"sample_size={n} < MIN_SAMPLE_SIZE={MIN_SAMPLE_SIZE}"
    else:
        # Require both a meaningful Sharpe AND positive expectancy
        passed      = sharpe >= MIN_SHARPE and expectancy >= 0
        drop_reason = (
            f"sharpe={sharpe:.2f} < {MIN_SHARPE}" if sharpe < MIN_SHARPE
            else (f"expectancy={expectancy:.2f} < 0" if expectancy < 0 else None)
        )

    saved_id = await db.fetchval(
        """INSERT INTO backtest_results
           (hypothesis_id, signal_ids, strategy_name, symbol, sample_size, win_rate,
            avg_return_pct, median_return_pct, sharpe, max_drawdown_pct, expectancy,
            passed, drop_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id""",
        hypothesis.get("id"),
        [],
        bt.get("strategy_name", "multi"),
        symbol,
        n,
        bt["win_rate"],
        bt.get("avg_return_pct", 0.0),
        bt.get("median_return_pct", 0.0),
        bt.get("sharpe"),
        bt.get("max_drawdown_pct"),
        expectancy,
        passed,
        drop_reason,
    )

    return {**bt, "passed": passed, "id": saved_id, "drop_reason": drop_reason}


# ── Utilities ─────────────────────────────────────────────────────────────────

def _embed(text: str) -> list[float]:
    return _get_oai().embeddings.create(
        input=text, model="text-embedding-3-small"
    ).data[0].embedding


async def _get_polymarket_sentiment(tickers: list[str], redis) -> dict:
    try:
        raw = await redis.get(POLY_SENTIMENT_KEY)
        if not raw:
            return {}
        full = json.loads(raw)
        meta = full.pop("_meta", {})
        filtered = filter_for_tickers(full, tickers)
        if not filtered:
            return {}
        age_hours: float | None = None
        if meta.get("updated_at"):
            try:
                updated  = datetime.fromisoformat(meta["updated_at"])
                age_hours = (datetime.now(timezone.utc) - updated).total_seconds() / 3600
            except Exception:
                pass
        filtered["_meta"] = {"updated_at": meta.get("updated_at"), "age_hours": age_hours}
        return filtered
    except Exception as exc:
        logger.warning("Failed to read Polymarket sentiment: %s", exc)
        return {}


def _dynamic_stop_loss(feat_dict: dict, regime: dict) -> float:
    """Compute ATR-aware stop loss: tighter in low-vol regimes, wider in high-vol."""
    vix = regime.get("vix") or 18
    if vix < 15:
        base = 0.020
    elif vix < 20:
        base = 0.030
    elif vix < 28:
        base = 0.040
    else:
        base = 0.060
    vol_ratio = float(feat_dict.get("vol_ratio_30d") or 1.0)
    return round(min(max(base * vol_ratio, 0.02), 0.12), 4)


# ── Main pipeline ─────────────────────────────────────────────────────────────

async def run() -> None:
    database_url  = os.environ["DATABASE_URL"]
    timescale_url = os.environ["TIMESCALE_URL"]
    redis_url     = os.getenv("REDIS_URL", "redis://redis:6379")

    db    = await asyncpg.create_pool(database_url, min_size=2, max_size=10)
    tsdb  = await asyncpg.create_pool(timescale_url, min_size=1, max_size=5)
    redis = aioredis.from_url(redis_url)

    # SPRT maintenance runs independently every SPRT_MAINTENANCE_H hours
    asyncio.create_task(_run_sprt_loop(db, tsdb))

    # Cache labeled sample count for ensemble blend weighting
    async def _refresh_labeled_count() -> None:
        global _labeled_count
        while True:
            try:
                n = await tsdb.fetchval(
                    "SELECT COUNT(*) FROM features WHERE forward_return_5d IS NOT NULL"
                )
                _labeled_count = int(n or 0)
                logger.info("Labeled feature rows: %d (ensemble alpha=%.2f)",
                            _labeled_count, _ensemble_alpha())
            except Exception as exc:
                logger.warning("Could not refresh labeled count: %s", exc)
            await asyncio.sleep(3600)

    asyncio.create_task(_refresh_labeled_count())

    async def _log_drift_warning() -> None:
        while True:
            try:
                if await redis.exists("model_drift_detected"):
                    logger.warning(
                        "Feature drift detected — model distribution shifted since last train. "
                        "Predictions may be less reliable. Check ml-trainer logs."
                    )
            except Exception:
                pass
            await asyncio.sleep(3600)

    asyncio.create_task(_log_drift_warning())

    pubsub = redis.pubsub()
    await pubsub.subscribe("new_signal")
    logger.info("AI correlator subscribed to new_signal")

    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            try:
                data = json.loads(message["data"])
                await _process(data["signal_id"], db, tsdb, redis)
            except Exception as exc:
                logger.error("Error processing signal: %s", exc, exc_info=True)
    finally:
        await pubsub.unsubscribe("new_signal")
        await db.close()
        await tsdb.close()
        await redis.aclose()


async def _process(signal_id: str, db: asyncpg.Pool, tsdb: asyncpg.Pool, redis) -> None:
    _maybe_reload_model()

    # 1. Fetch signal
    signal = await db.fetchrow("SELECT * FROM signals WHERE id=$1", uuid.UUID(signal_id))
    if not signal:
        logger.warning("Signal %s not found", signal_id)
        return
    signal = dict(signal)
    symbol = signal["symbol"]

    # 2. Fetch feature row (polymarket signals have no equity ticker)
    feat_dict: dict = {}
    if signal["source"] != "polymarket":
        feat_row = await tsdb.fetchrow(
            "SELECT * FROM features WHERE symbol=$1 ORDER BY ts DESC LIMIT 1", symbol
        )
        if not feat_row:
            logger.debug("No feature row for %s — dropping %s", symbol, signal_id)
            return
        feat_dict = dict(feat_row)

    # 3. Score
    sig_direction = signal.get("direction") or "up"
    if signal["source"] == "polymarket":
        confidence     = min(float(signal.get("score") or 0), 1.0)
        top_features: list[dict] = []
    else:
        confidence, top_features = _score(feat_dict, direction=sig_direction)
    logger.info("Signal %s: symbol=%s source=%s confidence=%.3f",
                signal_id[:8], symbol, signal["source"], confidence)

    # 3.5. Market regime
    regime = await _get_market_regime(tsdb)
    logger.info("Regime: trend=%s vol=%s vix=%s",
                regime["trend"], regime["volatility"], regime["vix"])

    # 4. Confidence gate (regime-adjusted)
    direction_key = "sell" if sig_direction == "down" else "buy"
    threshold = REGIME_THRESHOLD.get((regime["trend"], direction_key), CONFIDENCE_THRESHOLD)
    if confidence < threshold:
        logger.debug("Confidence %.3f below threshold %.3f — dropping", confidence, threshold)
        return

    # 4.1. Re-entry lockout — prevents re-entering a symbol that recently stopped out
    lock_key = f"reentry_lock:{symbol}"
    if await redis.exists(lock_key):
        logger.info("Re-entry lockout active for %s — skipping", symbol)
        return

    # 4.2. Multi-source tracking — record that this source fired on this symbol.
    # Used at step 7.1 to decide if a Tier A signal has multi-source confirmation.
    src_key = f"signal_sources:{symbol}"
    await redis.sadd(src_key, signal["source"])
    await redis.expire(src_key, 86400)   # 24h window

    # 4.5. Symbol dedup — prevents signal bursts becoming duplicate opportunities
    if signal["source"] == "polymarket":
        # Dedup on the primary symbol only (4h window).
        # Do NOT check matched_tickers — those span many unrelated assets and cause
        # cross-symbol dedup (e.g. a GLD signal blocked because SPY was in matched_tickers).
        recent = await db.fetchrow(
            """SELECT id FROM opportunities
               WHERE $1 = ANY(tickers) AND created_at > NOW()-INTERVAL '4 hours' LIMIT 1""",
            symbol,
        )
        if recent:
            logger.debug("Dedup: polymarket opp for %s in last 4h — skipping", symbol)
            return
    else:
        recent = await db.fetchrow(
            """SELECT id FROM opportunities
               WHERE $1 = ANY(tickers) AND created_at > NOW()-INTERVAL '6 hours' LIMIT 1""",
            symbol,
        )
        if recent:
            logger.debug("Dedup: opportunity for %s in last 6h — skipping", symbol)
            return

    # 4.6. Earnings guard
    if signal["source"] != "polymarket" and await _is_near_earnings(symbol, db):
        logger.info("Earnings within %d days for %s — skipping", EARNINGS_GUARD_DAYS, symbol)
        return

    # 5. Match hypothesis (SPRT-dead hypotheses are skipped automatically)
    hypothesis = await _match_hypothesis(feat_dict, db)
    if not hypothesis:
        logger.debug("No hypothesis matched — dropping signal %s", signal_id[:8])
        return

    # 6. Backtest with Sharpe + expectancy gate
    bt = await _run_backtest(signal, hypothesis, symbol, tsdb, db, signal_ts=signal.get("created_at"))
    if not bt["passed"]:
        logger.info("Backtest failed for %s: %s", symbol, bt.get("drop_reason"))
        return

    # 7. Quality tier gate — Tier C signals are too weak for the LLM pipeline
    quality = _signal_quality(confidence)
    if quality == "C":
        logger.info(
            "Signal %s is Tier C (conf=%.3f < %.2f) — dropped before LLM",
            signal_id[:8], confidence, QUALITY_TIER_B,
        )
        return

    # 7.1. Multi-source downgrade — Tier A requires 2+ independent sources (analytics,
    # news, polymarket) within the last 24h. Solo signals get Tier B (85% sizing).
    if quality == "A":
        src_count = await redis.scard(f"signal_sources:{symbol}")
        if src_count < 2:
            quality = "B"
            logger.info(
                "Signal %s downgraded Tier A→B: only %d source for %s",
                signal_id[:8], src_count, symbol,
            )

    # 8. Embed signal for semantic search
    embed_text = f"{signal['source']} {signal['type']} {symbol}"
    try:
        sig_vec = _embed(embed_text)
        await db.execute(
            "UPDATE signals SET embedding=$1::vector WHERE id=$2",
            sig_vec, uuid.UUID(signal_id),
        )
    except Exception as exc:
        logger.warning("Signal embedding failed: %s", exc)
        sig_vec = None

    similar_opps: list[dict] = []
    if sig_vec is not None:
        rows = await db.fetch(
            """SELECT *, 1-(embedding<=>$1::vector) AS sim FROM opportunities
               WHERE embedding IS NOT NULL ORDER BY embedding<=>$1::vector LIMIT 3""",
            sig_vec,
        )
        similar_opps = [dict(r) for r in rows]

    # 9. Macro + Polymarket sentiment
    macro = [
        dict(r) for r in await tsdb.fetch(
            "SELECT DISTINCT ON (series_id) series_id, value FROM raw_macro ORDER BY series_id, ts DESC"
        )
    ]
    poly_sentiment = await _get_polymarket_sentiment([symbol], redis)

    # 10. Claude narrative
    prompt = build_prompt(signal, confidence, top_features, bt, similar_opps, macro, hypothesis, poly_sentiment)
    try:
        response = _get_claude().messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=800,
            messages=[{"role": "user", "content": prompt}],
        )
        narrative = json.loads(response.content[0].text)
    except Exception as exc:
        logger.error("Claude API error: %s", exc)
        narrative = {
            "summary":        f"{hypothesis['name']} signal on {symbol}",
            "thesis":         "Model confidence threshold exceeded. See feature values.",
            "risk_note":      "Narrative unavailable — Claude API error.",
            "historical_note": None,
        }

    # 11. Save opportunity
    # Append confidence_note to risk_note when Claude flagged limited data
    confidence_note = narrative.get("confidence_note")
    if confidence_note:
        existing_risk = narrative.get("risk_note") or ""
        narrative["risk_note"] = f"{existing_risk} | {confidence_note}".lstrip(" | ")

    opp_text = narrative.get("summary", "") + " " + narrative.get("thesis", "")
    try:
        opp_vec = _embed(opp_text)
    except Exception:
        opp_vec = None

    if not signal.get("direction"):
        sig_direction = hypothesis.get("direction", "up")
    action = "buy" if sig_direction == "up" else "sell"

    # Use backtest-optimal holding period rather than hypothesis default
    hold_days = _HOLD_TO_DAYS.get(bt.get("holding_period_optimal", "5d"), 5)

    # Dynamic stop loss: VIX-regime + per-symbol volatility
    stop_loss_pct = _dynamic_stop_loss(feat_dict, regime)

    if signal["source"] == "polymarket":
        raw_payload = signal.get("payload") or {}
        payload: dict = json.loads(raw_payload) if isinstance(raw_payload, str) else raw_payload
        question = str(payload.get("question") or symbol)
        tickers  = payload.get("matched_tickers") or [symbol]
        if not narrative.get("thesis") or "Narrative unavailable" in (narrative.get("risk_note") or ""):
            narrative["summary"] = question[:120]
            narrative["thesis"]  = (
                f"Prediction market conviction shift on: \"{question}\" "
                f"(YES price {'rose' if sig_direction == 'up' else 'fell'}, "
                f"score {confidence:.0%}). "
                f"Liquidity: ${payload.get('liquidity', 0):,.0f}."
            )
    else:
        tickers = [symbol]

    saved = await db.fetchrow(
        """INSERT INTO opportunities
           (hypothesis_id, signal_ids, backtest_id, model_confidence,
            summary, thesis, risk_note, historical_note,
            action, tickers, expected_return_pct, hold_days, stop_loss_pct,
            top_features, macro_snapshot, holding_period_optimal, embedding)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *""",
        hypothesis.get("id"),
        [uuid.UUID(signal_id)],
        bt.get("id"),
        confidence,
        narrative.get("summary", ""),
        narrative.get("thesis", ""),
        narrative.get("risk_note"),
        narrative.get("historical_note"),
        action,
        tickers,
        bt.get("avg_return_pct"),
        hold_days,
        stop_loss_pct,
        json.dumps(top_features),
        json.dumps({r["series_id"]: float(r["value"]) for r in macro if r["value"]}),
        bt.get("holding_period_optimal", "5d"),
        opp_vec,
    )

    opp = dict(saved)
    opp["win_rate"]             = bt["win_rate"]
    opp["avg_win_pct"]          = bt.get("avg_win_pct")
    opp["avg_loss_pct"]         = bt.get("avg_loss_pct")
    opp["backtest_sample_size"] = bt["sample_size"]
    opp["sharpe"]               = bt.get("sharpe")
    opp["expectancy"]           = bt.get("expectancy")
    opp["quality_tier"]         = quality

    # 12. Fan-out — only during market hours
    if not _is_market_open():
        logger.info("Market closed — opportunity saved but not fanned out (%s)", symbol)
        return

    await fan_out_to_users(opp, db, redis, regime=regime)
    logger.info(
        "Opportunity created: conf=%.2f tier=%s action=%s symbol=%s sharpe=%.2f exp=%.2f%%",
        confidence, quality, action, symbol,
        bt.get("sharpe") or 0, bt.get("expectancy") or 0,
    )
