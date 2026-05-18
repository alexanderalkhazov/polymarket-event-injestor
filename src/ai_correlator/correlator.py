"""AI correlator — the scoring model decides, Claude explains.

Pipeline per signal:
  1. Fetch signal from PostgreSQL
  2. Fetch most-recent feature row for the symbol from TimescaleDB
  3. Score with rule_scorer (or XGBoost if model file exists)
  4. Gate: confidence < 0.65 → drop
  5. Match a named hypothesis from the hypotheses table
  6. Run hypothesis backtest against labeled feature rows
  7. Gate: backtest not passed → drop
  8. Embed signal with OpenAI → pgvector search for similar past opportunities
  9. Macro snapshot from raw_macro
  10. Call Claude for narrative (summary, thesis, risk_note, historical_note)
  11. Save opportunity (with model_confidence, top_features, embeddings)
  12. Fan-out: per-user strategies → Redis → SSE
"""
from __future__ import annotations

import json
import logging
import os
import pickle
import time
import uuid
from datetime import date, datetime, timezone
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

CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.65"))
_MODEL_DIR   = Path(os.getenv("MODEL_DIR", "/app/models"))
MODEL_PATH   = _MODEL_DIR / "scoring_model.json"
MODEL_SHORT  = _MODEL_DIR / "scoring_model_short.json"
SHAP_PATH    = _MODEL_DIR / "shap_explainer.pkl"
SHAP_SHORT   = _MODEL_DIR / "shap_explainer_short.pkl"

FEATURE_COLS = [
    "poly_conviction_delta_1h", "poly_conviction_delta_4h",
    "news_sentiment_1h", "news_sentiment_4h", "news_hotness_peak_4h",
    "news_article_count_4h", "rsi_14", "macd_histogram", "atr_14",
    "bb_position", "sma_20_slope", "vol_ratio_30d",
    "price_change_1d", "price_change_5d", "put_call_ratio",
    "unusual_sweep_count_4h", "vix_level", "wti_crude",
    "us_10y_yield", "fed_funds_rate", "usd_index",
]

_ET = ZoneInfo("America/New_York")
MAX_POSITIONS       = int(os.getenv("MAX_POSITIONS", "5"))
EARNINGS_GUARD_DAYS = int(os.getenv("EARNINGS_GUARD_DAYS", "3"))

_claude:         Optional[anthropic.Anthropic] = None
_oai:            Optional[OpenAI] = None
_model           = None   # long/buy model
_model_short     = None   # short/sell model
_explainer       = None
_explainer_short = None
_model_mtime:    float = 0.0


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
        # Load the short/sell model if it exists alongside the main model
        if MODEL_SHORT.exists():
            _model_short = xgb.XGBClassifier()
            _model_short.load_model(str(MODEL_SHORT))
            if SHAP_SHORT.exists():
                with open(SHAP_SHORT, "rb") as f:
                    _explainer_short = pickle.load(f)
            logger.info("XGBoost long+short models loaded")
        else:
            logger.info("XGBoost long model loaded (no short model — sell signals use long model)")
        return True
    except Exception as exc:
        logger.warning("Failed to load model: %s — falling back to rule scorer", exc)
        return False


_use_xgboost = _load_model()


def _maybe_reload_model() -> None:
    """Reload model files if they have been updated on disk (e.g., after retraining)."""
    global _use_xgboost, _model_mtime
    if not MODEL_PATH.exists():
        return
    try:
        mtime = MODEL_PATH.stat().st_mtime
        if mtime > _model_mtime:
            logger.info("Model file updated on disk — reloading...")
            _use_xgboost = _load_model()
            _model_mtime = mtime
    except Exception as exc:
        logger.warning("Model reload check failed: %s", exc)


def _is_market_open() -> bool:
    """True if NYSE/NASDAQ is currently open (9:30–16:00 ET, Mon–Fri)."""
    now = datetime.now(_ET)
    if now.weekday() >= 5:
        return False
    total_min = now.hour * 60 + now.minute
    return 9 * 60 + 30 <= total_min < 16 * 60


def _is_near_earnings(symbol: str) -> bool:
    """Return True if symbol reports earnings within EARNINGS_GUARD_DAYS calendar days."""
    try:
        import yfinance as yf
        cal = yf.Ticker(symbol).calendar
        if cal is None:
            return False
        # yfinance >= 0.2 returns a dict
        if isinstance(cal, dict):
            dates = cal.get("Earnings Date", [])
            if not dates:
                return False
            ed = dates[0] if isinstance(dates, list) else dates
            ed = ed.date() if hasattr(ed, "date") else ed
            return 0 <= (ed - date.today()).days <= EARNINGS_GUARD_DAYS
        # older versions return a DataFrame
        if hasattr(cal, "columns") and "Earnings Date" in cal.columns:
            from datetime import datetime as dt
            ed = dt.fromisoformat(str(cal["Earnings Date"].iloc[0])).date()
            return 0 <= (ed - date.today()).days <= EARNINGS_GUARD_DAYS
    except Exception:
        pass
    return False


def _score(feat_dict: dict, direction: str = "up") -> tuple[float, list[dict]]:
    if _use_xgboost and _model is not None:
        try:
            import pandas as pd
            X = pd.DataFrame([{c: feat_dict.get(c) or 0 for c in FEATURE_COLS}]).fillna(0)
            # Use direction-specific model when available
            active_model     = (_model_short if direction == "down" and _model_short else _model)
            active_explainer = (_explainer_short if direction == "down" and _explainer_short else _explainer)
            confidence = float(active_model.predict_proba(X)[0][1])
            top_features: list[dict] = []
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
            return confidence, top_features
        except Exception as exc:
            logger.warning("XGBoost scoring failed: %s — using rule scorer", exc)

    from .rule_scorer import rule_based_score
    logger.debug("rule-based scorer active (direction=%s)", direction)
    return rule_based_score(feat_dict, direction=direction), []


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


def _embed(text: str) -> list[float]:
    return _get_oai().embeddings.create(
        input=text, model="text-embedding-3-small"
    ).data[0].embedding


async def _match_hypothesis(feat_dict: dict, db: asyncpg.Pool) -> Optional[dict]:
    rows = await db.fetch("SELECT * FROM hypotheses WHERE is_active=TRUE ORDER BY created_at")
    for row in rows:
        h = dict(row)
        conditions: dict = h.get("feature_conditions") or {}
        if isinstance(conditions, str):
            conditions = json.loads(conditions)
        if _conditions_met(feat_dict, conditions):
            return h
    # No hypothesis matched — use a catch-all placeholder so the pipeline runs
    return {
        "id": None,
        "name": "any_signal_placeholder",
        "description": "Placeholder hypothesis — seed hypotheses via scripts/seed_hypotheses.py",
        "direction": "up",
        "hold_days": 5,
        "confidence_threshold": CONFIDENCE_THRESHOLD,
    }


def _conditions_met(feat_dict: dict, conditions: dict) -> bool:
    """Evaluate JSONB feature_conditions like {rsi_14: {lt: 35}, vol_ratio_30d: {gt: 2.0}}."""
    for feature, constraint in conditions.items():
        val = feat_dict.get(feature)
        if val is None:
            return False
        if isinstance(constraint, dict):
            if "gt" in constraint and float(val) <= float(constraint["gt"]):
                return False
            if "lt" in constraint and float(val) >= float(constraint["lt"]):
                return False
            if "gte" in constraint and float(val) < float(constraint["gte"]):
                return False
            if "lte" in constraint and float(val) > float(constraint["lte"]):
                return False
        elif float(val) != float(constraint):
            return False
    return True


async def _run_backtest(signal: dict, hypothesis: dict, symbol: str, tsdb: asyncpg.Pool, db: asyncpg.Pool) -> dict:
    """Run SignalBacktester against OHLCV history. Returns stats dict with 'passed' key."""
    from .backtester import SignalBacktester
    bt = await SignalBacktester(tsdb).estimate([signal])

    n  = bt["sample_size"]
    wr = bt["win_rate"]
    # Lenient early on — tighten as labeled data grows
    if n < 10:
        passed, drop_reason = True, None
    else:
        passed = wr >= 0.45
        drop_reason = f"win_rate={wr:.2f} < 0.45" if not passed else None

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
        wr,
        bt.get("avg_return_pct", 0.0),
        bt.get("median_return_pct", 0.0),
        bt.get("sharpe"),
        bt.get("max_drawdown_pct"),
        bt.get("expectancy", 0.0),
        passed,
        drop_reason,
    )

    return {**bt, "passed": passed, "id": saved_id, "drop_reason": drop_reason}


async def _get_polymarket_sentiment(tickers: list[str], redis) -> dict:
    """Fetch and filter Polymarket macro sentiment from Redis for the given tickers.

    Returns filtered categories dict plus a top-level `_meta` key with `updated_at`
    and `age_hours` so the prompt can warn when data is stale.
    """
    try:
        raw = await redis.get(POLY_SENTIMENT_KEY)
        if not raw:
            return {}
        full = json.loads(raw)
        meta = full.pop("_meta", {})
        filtered = filter_for_tickers(full, tickers)
        if not filtered:
            return {}
        # Compute age
        age_hours: float | None = None
        if meta.get("updated_at"):
            from datetime import datetime, timezone
            try:
                updated = datetime.fromisoformat(meta["updated_at"])
                age_hours = (datetime.now(timezone.utc) - updated).total_seconds() / 3600
            except Exception:
                pass
        filtered["_meta"] = {"updated_at": meta.get("updated_at"), "age_hours": age_hours}
        return filtered
    except Exception as exc:
        logger.warning("Failed to read Polymarket sentiment: %s", exc)
        return {}


async def run() -> None:
    database_url  = os.environ["DATABASE_URL"]
    timescale_url = os.environ["TIMESCALE_URL"]
    redis_url     = os.getenv("REDIS_URL", "redis://redis:6379")

    db    = await asyncpg.create_pool(database_url, min_size=2, max_size=10)
    tsdb  = await asyncpg.create_pool(timescale_url, min_size=1, max_size=5)
    redis = aioredis.from_url(redis_url)

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

    # 2. Fetch most recent feature row (polymarket signals have no stock ticker — skip lookup)
    feat_dict: dict = {}
    if signal["source"] != "polymarket":
        feat_row = await tsdb.fetchrow(
            "SELECT * FROM features WHERE symbol=$1 ORDER BY ts DESC LIMIT 1", symbol
        )
        if not feat_row:
            logger.debug("No feature row for %s — dropping signal %s", symbol, signal_id)
            return
        feat_dict = dict(feat_row)

    # 3. Score — polymarket uses raw conviction score directly
    sig_direction = signal.get("direction") or "up"
    if signal["source"] == "polymarket":
        raw_score = float(signal.get("score") or 0)
        confidence = min(raw_score, 1.0)
        top_features: list[dict] = []
    else:
        confidence, top_features = _score(feat_dict, direction=sig_direction)
    logger.info("Signal %s: symbol=%s source=%s confidence=%.3f", signal_id[:8], symbol, signal["source"], confidence)

    # 4. Gate: confidence
    if confidence < CONFIDENCE_THRESHOLD:
        logger.debug("Confidence %.3f below threshold — dropping", confidence)
        return

    # 4.5. Symbol dedup — skip if an opportunity was created for this symbol in the last 15 min
    if signal["source"] != "polymarket":
        recent = await db.fetchrow(
            "SELECT id FROM opportunities WHERE $1 = ANY(tickers) AND created_at > NOW()-INTERVAL '15 minutes' LIMIT 1",
            symbol,
        )
        if recent:
            logger.debug("Dedup: opportunity for %s in last 15 min — skipping", symbol)
            return

    # 4.6. Earnings guard — skip if earnings are within EARNINGS_GUARD_DAYS calendar days
    if signal["source"] != "polymarket" and _is_near_earnings(symbol):
        logger.info("Earnings within %d days for %s — skipping to avoid event risk", EARNINGS_GUARD_DAYS, symbol)
        return

    # 5. Match hypothesis
    hypothesis = await _match_hypothesis(feat_dict, db)
    if not hypothesis:
        logger.debug("No hypothesis matched — dropping signal %s", signal_id)
        return

    # 6. Backtest
    bt = await _run_backtest(signal, hypothesis, symbol, tsdb, db)
    if not bt["passed"]:
        logger.info("Backtest failed for %s: %s", symbol, bt.get("drop_reason"))
        return

    # 7. Embed signal for semantic search
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

    # 8. Find similar past opportunities (pgvector)
    similar_opps: list[dict] = []
    if sig_vec is not None:
        rows = await db.fetch(
            """SELECT *, 1-(embedding<=>$1::vector) AS sim FROM opportunities
               WHERE embedding IS NOT NULL ORDER BY embedding<=>$1::vector LIMIT 3""",
            sig_vec,
        )
        similar_opps = [dict(r) for r in rows]

    # 9. Macro snapshot
    macro = [
        dict(r) for r in await tsdb.fetch(
            """SELECT DISTINCT ON (series_id) series_id, value
               FROM raw_macro ORDER BY series_id, ts DESC"""
        )
    ]

    # 9b. Polymarket sentiment — read from Redis, filter to categories relevant to this symbol
    # (symbol is the real ticker for all signal sources now — polymarket consumer resolved it)
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
            "summary": f"{hypothesis['name']} signal on {symbol}",
            "thesis": "Model confidence threshold exceeded. See feature values for details.",
            "risk_note": "Narrative unavailable — Claude API error.",
            "historical_note": None,
        }

    # 11. Embed opportunity and save
    opp_text = narrative.get("summary", "") + " " + narrative.get("thesis", "")
    try:
        opp_vec = _embed(opp_text)
    except Exception:
        opp_vec = None

    # sig_direction set at step 3; fall back to hypothesis only if signal has no direction
    if not signal.get("direction"):
        sig_direction = hypothesis.get("direction", "up")
    action = "buy" if sig_direction == "up" else "sell"

    # For polymarket: the consumer already resolved matched_tickers using the sentiment
    # category map. Use those directly — symbol is now the primary real ticker too.
    if signal["source"] == "polymarket":
        raw_payload = signal.get("payload") or {}
        payload: dict = json.loads(raw_payload) if isinstance(raw_payload, str) else raw_payload
        question = str(payload.get("question") or symbol)
        tickers = payload.get("matched_tickers") or [symbol]
        # Fallback narrative if Claude unavailable
        if not narrative.get("thesis") or "Narrative unavailable" in (narrative.get("risk_note") or ""):
            narrative["summary"] = question[:120]
            narrative["thesis"] = (
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
            top_features, macro_snapshot, embedding)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *""",
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
        hypothesis.get("hold_days", 5),
        0.03,
        json.dumps(top_features),
        json.dumps({r["series_id"]: float(r["value"]) for r in macro if r["value"]}),
        opp_vec,
    )

    opp = dict(saved)
    opp["win_rate"] = bt["win_rate"]
    opp["backtest_sample_size"] = bt["sample_size"]

    # 12. Fan-out — only during market hours (order execution requires open market)
    if not _is_market_open():
        logger.info("Market closed — opportunity saved but not fanned out (symbol=%s)", symbol)
        return
    await fan_out_to_users(opp, db, redis)
    logger.info(
        "Opportunity created: conf=%.2f action=%s symbol=%s hypothesis=%s",
        confidence, action, symbol, hypothesis.get("name"),
    )
