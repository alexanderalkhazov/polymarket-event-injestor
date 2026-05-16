"""Fan-out: build per-user strategies from an opportunity and publish to Redis."""
from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

RISK_PCT = {"conservative": 0.01, "moderate": 0.03, "aggressive": 0.06}


async def fan_out_to_users(opp: dict, db, redis) -> None:
    users = await db.fetch(
        """SELECT DISTINCT u.* FROM users u
           JOIN subscriptions s ON s.user_id = u.id
           WHERE s.symbol = ANY($1::text[])""",
        opp["tickers"],
    )
    for user in users:
        risk_level = user["risk_level"] or "moderate"
        pct = min(RISK_PCT.get(risk_level, 0.03), float(user.get("max_position_pct") or 0.05))
        tp_pct = (float(opp.get("expected_return_pct") or 3.0)) / 100
        sl_pct = float(opp.get("stop_loss_pct") or 0.03)
        rr = round(tp_pct / sl_pct, 1) if sl_pct > 0 else 0

        rationale = (
            f"{opp['summary']} "
            f"Historical base rate: {int(float(opp.get('win_rate', 0))*100)}% win rate. "
            f"Expected return: ~{opp.get('expected_return_pct')}% over {opp.get('hold_days', 5)} days. "
            f"Position: {int(pct*100)}% of account. Stop: {int(sl_pct*100)}%. R/R: 1:{rr}. "
            f"Confidence: {int(float(opp.get('confidence', 0))*100)}%."
        )
        saved = await db.fetchrow(
            """INSERT INTO strategies
               (user_id, opportunity_id, sizing_pct, stop_loss_pct, take_profit_pct,
                rationale, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6, NOW()+INTERVAL '4 hours') RETURNING *""",
            user["id"],
            opp["id"],
            pct,
            sl_pct,
            tp_pct,
            rationale,
        )
        await redis.publish(f"strategies:{user['id']}", json.dumps(dict(saved), default=str))
        logger.info("Strategy delivered to user %s for opp %s", user["id"], opp["id"])
