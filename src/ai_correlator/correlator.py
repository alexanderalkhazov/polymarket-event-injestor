"""AI correlator — statistics decide, AI informs."""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import asyncpg
import redis.asyncio as aioredis
from openai import OpenAI

from .prompt import build_prompt
from .fan_out import fan_out_to_users
from backtester.backtester import SignalBacktester

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.55

_MACRO_BOOST = {"strong": 0.08, "moderate": 0.0, "weak": -0.08, "negative": -0.15}

_groq: OpenAI | None = None


def _get_groq() -> OpenAI:
    global _groq
    if _groq is None:
        _groq = OpenAI(
            api_key=os.environ["GROQ_API_KEY"],
            base_url="https://api.groq.com/openai/v1",
        )
    return _groq


def _compute_base_confidence(bt: dict, recent: list[dict]) -> float:
    """Derive base confidence from backtest statistics, falling back to signal scores."""
    n = bt["sample_size"]
    if n == 0:
        # No historical data — proxy from signal conviction
        scores = [float(s.get("score") or 0) for s in recent]
        avg_score = sum(scores) / len(scores) if scores else 0.0
        max_score = max(scores) if scores else 0.0
        sources = {s["source"] for s in recent}
        multi_source_boost = 0.08 if len(sources) >= 2 else 0.0
        return max(0.0, min(0.65, avg_score * 0.5 + max_score * 0.3 + multi_source_boost))

    conf = 0.50
    conf += min(0.15, bt["expectancy"] / 10.0)
    conf += min(0.10, bt["sharpe"] / 10.0)
    if n < 10:
        conf -= 0.15
    elif n < 30:
        conf -= 0.05
    if bt["max_drawdown_pct"] < -20:
        conf -= 0.10
    elif bt["max_drawdown_pct"] < -10:
        conf -= 0.05

    return max(0.0, min(0.85, conf))


def _derive_action(recent: list[dict], analysis: dict) -> str:
    """Derive buy/sell/watch from signal directions + AI sector classification."""
    up = sum(1 for s in recent if s.get("direction") == "up")
    down = sum(1 for s in recent if s.get("direction") == "down")
    sectors = analysis.get("affected_sectors", {})
    ai_pos = sum(1 for v in sectors.values() if v == "positive")
    ai_neg = sum(1 for v in sectors.values() if v == "negative")

    if up > down and ai_pos >= ai_neg:
        return "buy"
    if down > up and ai_neg >= ai_pos:
        return "sell"
    return "watch"


def _extract_tickers(recent: list[dict]) -> list[str]:
    """Pull unique stock tickers from news/analytics signals."""
    tickers = list({s["symbol"] for s in recent if s["source"] in ("news", "analytics")})
    return tickers or [recent[0]["symbol"]]


async def run() -> None:
    database_url = os.environ["DATABASE_URL"]
    timescale_url = os.environ["TIMESCALE_URL"]
    redis_url = os.getenv("REDIS_URL", "redis://redis:6379")

    db = await asyncpg.create_pool(database_url, min_size=2, max_size=10)
    tsdb = await asyncpg.create_pool(timescale_url, min_size=1, max_size=5)
    redis = aioredis.from_url(redis_url)

    pubsub = redis.pubsub()
    await pubsub.subscribe("new_signal")
    logger.info("AI correlator subscribed to new_signal channel")

    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            try:
                data = json.loads(message["data"])
                await _process(data["signal_id"], db, tsdb, redis)
            except Exception as exc:
                logger.error("Error processing signal: %s", exc)
    finally:
        await pubsub.unsubscribe("new_signal")
        await db.close()
        await tsdb.close()
        await redis.aclose()


async def _process(signal_id: str, db, tsdb, redis) -> None:
    # 1. Fetch signal
    new_signal = await db.fetchrow(
        "SELECT * FROM signals WHERE id=$1", uuid.UUID(signal_id)
    )
    if not new_signal:
        logger.warning("Signal %s not found", signal_id)
        return
    new_signal = dict(new_signal)
    await db.execute(
        "UPDATE signals SET status='processing', pipeline_step=0 WHERE id=$1",
        uuid.UUID(signal_id),
    )

    # 2. Time-window gate — 2+ sources in last 15 min
    recent = [
        dict(r) for r in await db.fetch(
            "SELECT * FROM signals WHERE created_at > NOW()-INTERVAL '15 minutes'"
        )
    ]
    sources = {s["source"] for s in recent}
    if len(sources) < 2:
        logger.debug("Only %d source(s) in window — dropping", len(sources))
        await db.execute(
            "UPDATE signals SET status='dropped', pipeline_step=1 WHERE id=$1",
            uuid.UUID(signal_id),
        )
        return

    # 3. Statistical estimation (no pass/fail — pure stats)
    bt = await SignalBacktester(tsdb).estimate(recent)
    logger.info(
        "Backtest stats: sample=%d quality=%s expectancy=%.2f%% sharpe=%.2f hold=%s",
        bt["sample_size"], bt["data_quality"], bt["expectancy"],
        bt["sharpe"], bt["holding_period_optimal"],
    )

    # 4. Macro snapshot
    macro = [
        dict(r) for r in await tsdb.fetch(
            """SELECT DISTINCT ON (series_id) series_id, value
               FROM macro_indicators ORDER BY series_id, time DESC"""
        )
    ]

    # 5. AI structured classification (classifier role, not trade generator)
    # Cap prompt size: top 20 signals by score, deduplicated by source+type
    recent_for_prompt = sorted(recent, key=lambda s: float(s.get("score") or 0), reverse=True)[:20]
    prompt = build_prompt(new_signal, recent_for_prompt, macro, bt)
    try:
        resp = _get_groq().chat.completions.create(
            model="llama-3.3-70b-versatile",
            max_tokens=800,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        analysis = json.loads(resp.choices[0].message.content)
    except Exception as exc:
        logger.error("Groq API error: %s", exc)
        analysis = {"confidence_adjustment": 0.0, "macro_alignment": "moderate"}

    # 6. Decision engine — statistics decide, AI adjusts
    base_confidence = _compute_base_confidence(bt, recent)
    conf_adj = max(-0.20, min(0.20, float(analysis.get("confidence_adjustment", 0.0))))
    macro_boost = _MACRO_BOOST.get(analysis.get("macro_alignment", "moderate"), 0.0)
    final_confidence = max(0.0, min(1.0, base_confidence + conf_adj + macro_boost))

    logger.info(
        "Decision: base=%.2f adj=%.2f macro=%.2f final=%.2f threshold=%.2f",
        base_confidence, conf_adj, macro_boost, final_confidence, CONFIDENCE_THRESHOLD,
    )

    passed = final_confidence >= CONFIDENCE_THRESHOLD
    drop_reason: Optional[str] = None if passed else (
        f"confidence {final_confidence:.2f} < threshold {CONFIDENCE_THRESHOLD}"
    )

    # 7. Always record backtest result as audit trail
    saved_bt = await db.fetchrow(
        """INSERT INTO backtest_results
           (signal_ids, strategy_name, symbol, sample_size, win_rate, avg_return_pct,
            median_return_pct, sharpe, max_drawdown_pct, expectancy, passed, drop_reason, payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id""",
        [s["id"] for s in recent],
        bt["strategy_name"],
        new_signal["symbol"],
        bt["sample_size"],
        bt["win_rate"],
        bt["avg_return_pct"],
        bt["median_return_pct"],
        bt.get("sharpe"),
        bt.get("max_drawdown_pct"),
        bt["expectancy"],
        passed,
        drop_reason,
        json.dumps(bt),
    )

    if not passed:
        await db.execute(
            "UPDATE signals SET status='dropped', pipeline_step=6 WHERE id=$1",
            uuid.UUID(signal_id),
        )
        logger.info("Signal dropped: %s", drop_reason)
        return

    # 8. Build and save opportunity (values from stats, narrative from AI)
    action = _derive_action(recent, analysis)
    tickers = _extract_tickers(recent)
    hold_days = {"3d": 3, "5d": 5, "10d": 10}.get(bt.get("holding_period_optimal", "5d"), 5)
    stop_loss_pct = max(0.02, abs(bt.get("max_drawdown_pct", 3.0)) / 100)

    saved_opp = await db.fetchrow(
        """INSERT INTO opportunities
           (signal_ids, backtest_id, confidence, summary, thesis, action, tickers,
            expected_return_pct, hold_days, stop_loss_pct, historical_context,
            macro_notes, raw_response)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *""",
        [s["id"] for s in recent],
        saved_bt["id"],
        final_confidence,
        analysis.get("summary", f"{analysis.get('event_class', 'signal')} detected"),
        analysis.get("thesis", ""),
        action,
        tickers,
        bt["avg_return_pct"],
        hold_days,
        stop_loss_pct,
        analysis.get("notes"),
        analysis.get("macro_alignment"),
        json.dumps(analysis),
    )

    opp_dict = dict(saved_opp)
    opp_dict["win_rate"] = bt["win_rate"]
    opp_dict["backtest_sample_size"] = bt["sample_size"]
    opp_dict["event_class"] = analysis.get("event_class", "unknown")

    for sig in recent:
        await db.execute(
            "INSERT INTO opportunities_signals (opportunity_id, signal_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            saved_opp["id"], sig["id"],
        )
    await db.execute(
        "UPDATE signals SET status='processed', pipeline_step=8 WHERE id=ANY($1::uuid[])",
        [s["id"] for s in recent],
    )

    # 9. Fan-out per-user strategies
    await fan_out_to_users(opp_dict, db, redis)
    logger.info(
        "Opportunity fanned out: conf=%.2f action=%s tickers=%s event=%s",
        final_confidence, action, tickers, analysis.get("event_class"),
    )
