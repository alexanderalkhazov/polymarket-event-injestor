"""AI correlator — the full 15-step signal-to-strategy pipeline."""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone

import asyncpg
import redis.asyncio as aioredis
from openai import OpenAI
from sentence_transformers import SentenceTransformer

from .prompt import build_prompt, sig_text
from .fan_out import fan_out_to_users
from backtester.backtester import SignalBacktester

logger = logging.getLogger(__name__)

_groq: OpenAI | None = None
_embedder: SentenceTransformer | None = None


def _get_groq() -> OpenAI:
    global _groq
    if _groq is None:
        _groq = OpenAI(
            api_key=os.environ["GROQ_API_KEY"],
            base_url="https://api.groq.com/openai/v1",
        )
    return _groq


def _get_embedder() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        _embedder = SentenceTransformer("all-MiniLM-L6-v2")
    return _embedder


def embed(text: str) -> list[float]:
    return _get_embedder().encode(text, normalize_embeddings=True).tolist()


async def run() -> None:
    """Main entry — subscribes to Redis new_signal and processes each signal."""
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
                signal_id = data["signal_id"]
                await _process(signal_id, db, tsdb, redis)
            except Exception as exc:
                logger.error("Error processing signal: %s", exc)
    finally:
        await pubsub.unsubscribe("new_signal")
        await db.close()
        await tsdb.close()
        await redis.aclose()


async def _process(signal_id: str, db, tsdb, redis) -> None:
    # 1. Fetch the triggering signal
    new_signal = await db.fetchrow(
        "SELECT * FROM signals WHERE id=$1", uuid.UUID(signal_id)
    )
    if not new_signal:
        logger.warning("Signal %s not found", signal_id)
        return
    new_signal = dict(new_signal)
    await db.execute(
        "UPDATE signals SET status='processing', pipeline_step=0 WHERE id=$1",
        uuid.UUID(signal_id)
    )

    # 2. Time-window gate — need 2+ sources in last 15 min
    recent = [
        dict(r) for r in await db.fetch(
            "SELECT * FROM signals WHERE created_at > NOW()-INTERVAL '15 minutes'"
        )
    ]
    sources = {s["source"] for s in recent}
    if len(sources) < 2:
        logger.debug("Only %d source(s) in window — skipping", len(sources))
        await db.execute(
            "UPDATE signals SET status='dropped', pipeline_step=1 WHERE id=$1",
            uuid.UUID(signal_id)
        )
        return

    # 3. Backtest gate
    bt = await SignalBacktester(tsdb).validate(recent)
    if not bt["passed"]:
        await db.execute(
            """INSERT INTO backtest_results
               (signal_ids, strategy_name, symbol, sample_size, win_rate, avg_return_pct,
                median_return_pct, expectancy, passed, drop_reason, payload)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10)""",
            [uuid.UUID(s["id"]) for s in recent],
            bt.get("strategy_name", "unknown"),
            new_signal["symbol"],
            bt["sample_size"],
            bt["win_rate"],
            bt.get("avg_return_pct", 0),
            bt.get("median_return_pct", 0),
            bt["expectancy"],
            bt.get("drop_reason"),
            json.dumps(bt),
        )
        await db.execute(
            "UPDATE signals SET status='dropped', pipeline_step=2 WHERE id=$1",
            uuid.UUID(signal_id)
        )
        logger.info("Signal dropped at backtest: %s", bt.get("drop_reason"))
        return

    # 4. Embed + store vector for the triggering signal
    vec = embed(sig_text(new_signal))
    await db.execute(
        "UPDATE signals SET embedding=$1::vector WHERE id=$2",
        vec, uuid.UUID(signal_id),
    )

    # 5. pgvector semantic search — similar past signals and opportunities
    vec_str = "[" + ",".join(str(v) for v in vec) + "]"
    sim_sigs = [
        dict(r) for r in await db.fetch(
            f"""SELECT *, 1-(embedding<=>'{vec_str}'::vector) AS sim FROM signals
               WHERE created_at < NOW()-INTERVAL '15 minutes' AND embedding IS NOT NULL
               ORDER BY embedding<=>'{vec_str}'::vector LIMIT 5"""
        )
    ]
    sim_opps = [
        dict(r) for r in await db.fetch(
            f"""SELECT *, 1-(embedding<=>'{vec_str}'::vector) AS sim FROM opportunities
               WHERE embedding IS NOT NULL
               ORDER BY embedding<=>'{vec_str}'::vector LIMIT 3"""
        )
    ]

    # 6. Macro snapshot from TimescaleDB
    macro = [
        dict(r) for r in await tsdb.fetch(
            """SELECT DISTINCT ON (series_id) series_id, value
               FROM macro_indicators ORDER BY series_id, time DESC"""
        )
    ]

    # 7. Groq API call
    prompt = build_prompt(new_signal, recent, sim_sigs, sim_opps, macro, bt)
    groq = _get_groq()
    try:
        resp = groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            max_tokens=1200,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        opp = json.loads(resp.choices[0].message.content)
    except Exception as exc:
        logger.error("Groq API error: %s", exc)
        return

    if not opp.get("is_opportunity") or float(opp.get("confidence", 0)) < 0.60:
        logger.info("Claude returned no opportunity or low confidence: %.2f", opp.get("confidence", 0))
        await db.execute(
            "UPDATE signals SET status='dropped', pipeline_step=6 WHERE id=$1",
            uuid.UUID(signal_id)
        )
        return

    # 8. Save backtest result (passed)
    saved_bt = await db.fetchrow(
        """INSERT INTO backtest_results
           (signal_ids, strategy_name, symbol, sample_size, win_rate, avg_return_pct,
            median_return_pct, sharpe, max_drawdown_pct, expectancy, passed, payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11) RETURNING id""",
        [uuid.UUID(s["id"]) for s in recent],
        bt.get("strategy_name", "multi"),
        new_signal["symbol"],
        bt["sample_size"],
        bt["win_rate"],
        bt["avg_return_pct"],
        bt["median_return_pct"],
        bt.get("sharpe"),
        bt.get("max_drawdown_pct"),
        bt["expectancy"],
        json.dumps(bt),
    )

    # 9. Embed opportunity text and save
    opp_vec = embed(opp["summary"] + " " + opp["thesis"])
    opp_vec_str = "[" + ",".join(str(v) for v in opp_vec) + "]"
    saved_opp = await db.fetchrow(
        f"""INSERT INTO opportunities
           (signal_ids, backtest_id, confidence, summary, thesis, action, tickers,
            expected_return_pct, hold_days, stop_loss_pct, historical_context,
            macro_notes, embedding, raw_response)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'{opp_vec_str}'::vector,$13) RETURNING *""",
        [uuid.UUID(s["id"]) for s in recent],
        saved_bt["id"],
        float(opp["confidence"]),
        opp["summary"],
        opp["thesis"],
        opp["action"],
        opp["tickers"],
        opp.get("expected_return_pct"),
        opp.get("hold_days"),
        opp.get("stop_loss_pct"),
        opp.get("historical_context"),
        opp.get("macro_notes"),
        json.dumps(opp),
    )

    opp_dict = dict(saved_opp)
    opp_dict["win_rate"] = bt["win_rate"]
    opp_dict["backtest_sample_size"] = bt["sample_size"]

    # Link signals to opportunity
    for sig in recent:
        await db.execute(
            "INSERT INTO opportunities_signals (opportunity_id, signal_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            saved_opp["id"], uuid.UUID(sig["id"])
        )
    await db.execute(
        "UPDATE signals SET status='processed', pipeline_step=8 WHERE id=ANY($1::uuid[])",
        [uuid.UUID(s["id"]) for s in recent],
    )

    # 10. Fan-out per-user strategies
    await fan_out_to_users(opp_dict, db, redis)
    logger.info(
        "Opportunity created: %s conf=%.2f action=%s tickers=%s",
        opp["summary"][:60], opp["confidence"], opp["action"], opp["tickers"],
    )
