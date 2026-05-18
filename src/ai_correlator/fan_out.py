"""Fan-out: build per-user strategies from an opportunity and publish to Redis."""
from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

RISK_PCT = {"conservative": 0.01, "moderate": 0.03, "aggressive": 0.06}


def _is_polymarket_id(ticker: str) -> bool:
    return ticker.startswith("0x") and len(ticker) > 20


async def fan_out_to_users(opp: dict, db, redis) -> None:
    tickers = opp["tickers"] or []
    is_polymarket = all(_is_polymarket_id(t) for t in tickers) if tickers else False

    if is_polymarket:
        # Polymarket symbols are hex contract IDs — no user subscribes to them directly.
        # Broadcast to all users who have any active subscription.
        users = await db.fetch(
            "SELECT DISTINCT u.* FROM users u JOIN subscriptions s ON s.user_id = u.id"
        )
    else:
        users = await db.fetch(
            """SELECT DISTINCT u.* FROM users u
               JOIN subscriptions s ON s.user_id = u.id
               WHERE s.symbol = ANY($1::text[])""",
            tickers,
        )
    for user in users:
        risk_level = user["risk_level"] or "moderate"
        pct    = min(RISK_PCT.get(risk_level, 0.03), float(user.get("max_position_pct") or 0.05))
        tp_pct = (float(opp.get("expected_return_pct") or 3.0)) / 100
        sl_pct = float(opp.get("stop_loss_pct") or 0.03)
        rr     = round(tp_pct / sl_pct, 1) if sl_pct > 0 else 0

        win_rate_pct = int(float(opp.get("win_rate", 0)) * 100)
        confidence   = int(float(opp.get("model_confidence", 0)) * 100)
        rationale = (
            f"{opp['summary']} "
            f"Win rate: {win_rate_pct}% over similar setups. "
            f"Expected: ~{opp.get('expected_return_pct', 0):.1f}% in "
            f"{opp.get('hold_days', 5)} days. "
            f"Position: {int(pct*100)}% of account. "
            f"Stop: {int(sl_pct*100)}%. R/R: 1:{rr}. "
            f"Confidence: {confidence}%."
        )

        saved = await db.fetchrow(
            """INSERT INTO strategies
               (user_id, opportunity_id, sizing_pct, stop_loss_pct,
                take_profit_pct, rationale, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6, NOW()+INTERVAL '4 hours') RETURNING *""",
            user["id"],
            opp["id"],
            pct,
            sl_pct,
            tp_pct,
            rationale,
        )
        # Publish the full shape so the SSE consumer can render the card without a DB round-trip
        publish_payload = {
            **dict(saved),
            "action":              opp.get("action", "buy"),
            "tickers":             opp.get("tickers", []),
            "summary":             opp.get("summary", ""),
            "thesis":              opp.get("thesis", ""),
            "confidence":          float(opp.get("model_confidence") or 0),
            "expected_return_pct": float(opp["expected_return_pct"]) if opp.get("expected_return_pct") is not None else None,
            "hold_days":           opp.get("hold_days"),
            "win_rate":            float(opp["win_rate"]) if opp.get("win_rate") is not None else None,
            "avg_return_pct":      None,
            "max_drawdown_pct":    None,
            "sample_size":         opp.get("backtest_sample_size"),
        }
        await redis.publish(
            f"strategies:{user['id']}",
            json.dumps(publish_payload, default=str),
        )
        logger.info("Strategy delivered to user %s for opp %s", user["id"], opp["id"])
