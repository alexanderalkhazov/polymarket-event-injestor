"""Fan-out: build per-user strategies from an opportunity and publish to Redis.

Guards applied per user (in order):
  1. MAX_POSITIONS cap
  2. Per-ticker dedup (no duplicate active strategy for same ticker)
  3. Sector concentration cap
  4. Bayesian Kelly position sizing
  5. Portfolio beta cap (prevents hidden concentration in correlated longs)
  6. Monte Carlo ruin probability gate (blocks strategies that push P(drawdown>10%) too high)

Position sizing uses Bayesian half-Kelly: the win rate is taken from the 10th percentile
of a Beta(wins+1, losses+1) posterior rather than the raw historical mean, which prevents
overconfident sizing on thin backtests.
"""
from __future__ import annotations

import json
import logging
import os

import numpy as np
from scipy.stats import beta as beta_dist

logger = logging.getLogger(__name__)

# ── Tunable constants (all override-able via env) ─────────────────────────────
MAX_POSITIONS         = int(os.getenv("MAX_POSITIONS",         "5"))
MAX_PORTFOLIO_BETA    = float(os.getenv("MAX_PORTFOLIO_BETA",  "1.0"))
MAX_SECTOR_STRATEGIES = int(os.getenv("MAX_SECTOR_STRATEGIES", "2"))
MAX_RUIN_PROB         = float(os.getenv("MAX_RUIN_PROB",       "0.15"))  # P(drawdown > 10%)
KELLY_MULTIPLIER      = float(os.getenv("KELLY_MULTIPLIER",    "0.5"))
MONTE_CARLO_N         = int(os.getenv("MONTE_CARLO_N",         "4000"))

RISK_PCT     = {"conservative": 0.01, "moderate": 0.03, "aggressive": 0.06}
MAX_SIZE_PCT = {"conservative": 0.03, "moderate": 0.06, "aggressive": 0.10}
VOL_SIZE_FACTOR = {"low": 1.0, "elevated": 0.8, "high": 0.5}

# Approximate market betas — used for portfolio-level concentration check
BETA_MAP: dict[str, float] = {
    "NVDA": 1.8, "TSLA": 1.9, "AMD": 1.7, "META": 1.3, "AAPL": 1.1,
    "MSFT": 0.9, "AMZN": 1.2, "GOOGL": 1.1, "NFLX": 1.3, "CRM": 1.2,
    "USO":  0.7, "XOM":  0.8, "CVX":  0.8,
    "GLD": -0.1, "SLV":  0.2,
    "TLT": -0.5, "IEF": -0.3, "BND": -0.2,
    "SPY":  1.0, "QQQ":  1.15, "IWM": 1.2,
    "BTC-USD": 1.5, "ETH-USD": 1.6, "SOL-USD": 2.0,
}

SECTOR_MAP: dict[str, str] = {
    "NVDA": "tech", "AAPL": "tech", "MSFT": "tech", "TSLA": "tech",
    "META": "tech", "AMZN": "tech", "GOOGL": "tech", "AMD":  "tech",
    "NFLX": "tech", "CRM":  "tech",
    "USO":  "energy", "XOM":  "energy", "CVX":  "energy",
    "GLD":  "commodities", "SLV":  "commodities",
    "TLT":  "rates", "IEF":  "rates", "BND":  "rates",
    "SPY":  "broad", "QQQ":  "broad", "IWM":  "broad",
    "BTC-USD": "crypto", "ETH-USD": "crypto", "SOL-USD": "crypto",
}

_HOLD_TO_INTERVAL = {3: "3 days", 5: "5 days", 10: "10 days"}


# ── Math helpers ──────────────────────────────────────────────────────────────

def _bayesian_win_rate(sample_size: int, win_rate: float, pct: float = 0.10) -> float:
    """Conservative (10th-percentile) Bayesian win rate.

    With 10 samples a raw 60% shrinks to ~36% — honest uncertainty.
    With 200 samples it converges near the true rate.
    This single change prevents over-betting on thin backtests.
    """
    wins   = max(int(win_rate * sample_size), 0)
    losses = max(sample_size - wins, 0)
    return float(beta_dist.ppf(pct, wins + 1, losses + 1))


def _kelly_size(
    sample_size: int,
    win_rate: float,
    avg_win_pct: float,
    avg_loss_pct: float,
    risk_level: str,
    max_pos_pct: float,
    vol_factor: float,
) -> float:
    """Bayesian half-Kelly position size, capped by user risk limits."""
    p    = _bayesian_win_rate(sample_size, win_rate)
    q    = 1 - p
    w    = abs(avg_win_pct)  / 100
    l    = abs(avg_loss_pct) / 100
    if w > 0 and l > 0 and p > 0:
        b          = w / l
        raw_kelly  = (b * p - q) / b
        half_kelly = max(raw_kelly * KELLY_MULTIPLIER, 0.0)
        cap        = MAX_SIZE_PCT.get(risk_level, 0.06)
        sized      = min(half_kelly, cap, max_pos_pct)
    else:
        sized = RISK_PCT.get(risk_level, 0.03)
    return round(sized * vol_factor, 4)


def _monte_carlo_risk(strategies: list[dict], n: int = MONTE_CARLO_N) -> dict:
    """Simulate n portfolio paths, return P(portfolio drawdown > 10%) and median."""
    if not strategies:
        return {"p_loss_10pct": 0.0, "median": 1.0}

    rng = np.random.default_rng()
    results = np.ones(n)
    for s in strategies:
        wr   = float(s.get("win_rate")     or 0.50)
        sz   = float(s.get("sizing_pct")   or 0.03)
        aw   = abs(float(s.get("avg_win_pct")  or 3.0)) / 100
        al   = abs(float(s.get("avg_loss_pct") or 3.0)) / 100
        wins = rng.random(n) < wr
        results *= np.where(wins, 1 + sz * aw, 1 - sz * al)

    return {
        "p_loss_10pct": float(np.mean(results < 0.90)),
        "median":       float(np.median(results)),
    }


async def _portfolio_beta(user_id, new_tickers: list[str], new_sz: float, db) -> float:
    """Total portfolio beta if the proposed position is added."""
    rows = await db.fetch(
        """SELECT o.tickers, s.sizing_pct FROM strategies s
           JOIN opportunities o ON o.id = s.opportunity_id
           WHERE s.user_id=$1
             AND s.status NOT IN ('dismissed','expired','executed')
             AND s.expires_at > NOW()""",
        user_id,
    )
    total = sum(
        BETA_MAP.get(t, 1.0) * float(row["sizing_pct"] or 0)
        for row in rows
        for t in (row["tickers"] or [])
    )
    for t in new_tickers:
        total += BETA_MAP.get(t, 1.0) * new_sz
    return round(total, 4)


def _is_polymarket_id(ticker: str) -> bool:
    return ticker.startswith("0x") and len(ticker) > 20


# ── Fan-out ───────────────────────────────────────────────────────────────────

async def fan_out_to_users(opp: dict, db, redis, regime: dict | None = None) -> None:
    tickers        = opp["tickers"] or []
    is_polymarket  = all(_is_polymarket_id(t) for t in tickers) if tickers else False
    primary_ticker = next((t for t in tickers if not _is_polymarket_id(t)), None)

    if is_polymarket:
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

    vol_factor  = VOL_SIZE_FACTOR.get((regime or {}).get("volatility", "elevated"), 0.8)
    hold_days   = int(opp.get("hold_days") or 5)
    hold_label  = _HOLD_TO_INTERVAL.get(hold_days, "5 days")
    sector      = SECTOR_MAP.get(primary_ticker or "", "other")
    opp_sharpe  = float(opp.get("sharpe") or 0)
    sample_size = int(opp.get("backtest_sample_size") or 0)
    win_rate    = float(opp.get("win_rate")    or 0)
    avg_win_pct = float(opp.get("avg_win_pct") or 0)
    avg_loss_pct = float(opp.get("avg_loss_pct") or 0)
    quality_tier = opp.get("quality_tier", "B")

    for user in users:
        user_id     = user["id"]
        risk_level  = user["risk_level"] or "moderate"
        max_pos_pct = float(user.get("max_position_pct") or 0.05)

        # ── Gate 1: position limit ────────────────────────────────────────────
        active_count = await db.fetchval(
            """SELECT COUNT(*) FROM strategies
               WHERE user_id=$1
                 AND status NOT IN ('dismissed','expired','executed')
                 AND expires_at > NOW()""",
            user_id,
        )
        if active_count >= MAX_POSITIONS:
            logger.debug("User %s at MAX_POSITIONS (%d) — skipping", user_id, MAX_POSITIONS)
            continue

        # ── Gate 2: per-ticker dedup ──────────────────────────────────────────
        if primary_ticker:
            dup = await db.fetchrow(
                """SELECT s.id FROM strategies s
                   JOIN opportunities o ON o.id = s.opportunity_id
                   WHERE s.user_id=$1
                     AND $2 = ANY(o.tickers)
                     AND s.status NOT IN ('dismissed','expired','executed')
                     AND s.expires_at > NOW()
                   LIMIT 1""",
                user_id, primary_ticker,
            )
            if dup:
                logger.debug("User %s already has active strategy for %s — skipping",
                             user_id, primary_ticker)
                continue

        # ── Gate 3: sector concentration ─────────────────────────────────────
        if primary_ticker and sector != "other":
            sector_tickers = [t for t, s in SECTOR_MAP.items() if s == sector]
            sector_count = await db.fetchval(
                """SELECT COUNT(*) FROM strategies s
                   JOIN opportunities o ON o.id = s.opportunity_id
                   WHERE s.user_id=$1
                     AND s.status NOT IN ('dismissed','expired','executed')
                     AND s.expires_at > NOW()
                     AND o.tickers && $2::text[]""",
                user_id, sector_tickers,
            )
            if sector_count >= MAX_SECTOR_STRATEGIES:
                logger.debug("User %s at sector cap for '%s' — skipping", user_id, sector)
                continue

        # ── Bayesian Kelly sizing ─────────────────────────────────────────────
        pct = _kelly_size(
            sample_size  = sample_size,
            win_rate     = win_rate,
            avg_win_pct  = avg_win_pct,
            avg_loss_pct = avg_loss_pct,
            risk_level   = risk_level,
            max_pos_pct  = max_pos_pct,
            vol_factor   = vol_factor,
        )
        # Tier A signals get full Kelly; Tier B gets 85%
        if quality_tier == "B":
            pct = round(pct * 0.85, 4)

        # Correlation penalty: halve sizing when ≥2 same-direction strategies are
        # already active — correlated longs/shorts move together in a drawdown.
        opp_action = opp.get("action", "buy")
        same_dir_count = await db.fetchval(
            """SELECT COUNT(*) FROM strategies s
               JOIN opportunities o ON o.id = s.opportunity_id
               WHERE s.user_id=$1
                 AND o.action = $2
                 AND s.status NOT IN ('dismissed','expired','executed')
                 AND s.expires_at > NOW()""",
            user_id, opp_action,
        )
        if same_dir_count >= 2:
            pct = round(pct * 0.5, 4)
            logger.debug(
                "Correlation penalty: %d active %s strats → Kelly halved to %.2f%%",
                same_dir_count, opp_action, pct * 100,
            )

        # ── Gate 4: portfolio beta cap ────────────────────────────────────────
        if primary_ticker:
            port_beta = await _portfolio_beta(user_id, tickers, pct, db)
            if port_beta > MAX_PORTFOLIO_BETA:
                logger.info(
                    "User %s: beta %.2f would exceed %.2f — skipping",
                    user_id, port_beta, MAX_PORTFOLIO_BETA,
                )
                continue

        # ── Gate 5: Monte Carlo ruin check ────────────────────────────────────
        active_rows = await db.fetch(
            """SELECT s.sizing_pct, b.win_rate, b.avg_return_pct,
                      COALESCE(b.avg_return_pct * 0.6,  3.0) AS avg_win_pct,
                      COALESCE(b.avg_return_pct * -0.4, -2.5) AS avg_loss_pct
               FROM strategies s
               JOIN opportunities o  ON o.id  = s.opportunity_id
               LEFT JOIN backtest_results b ON b.id = o.backtest_id
               WHERE s.user_id=$1
                 AND s.status NOT IN ('dismissed','expired','executed')
                 AND s.expires_at > NOW()""",
            user_id,
        )
        candidate = {
            "sizing_pct":   pct,
            "win_rate":     win_rate,
            "avg_win_pct":  avg_win_pct,
            "avg_loss_pct": avg_loss_pct,
        }
        risk = _monte_carlo_risk([dict(r) for r in active_rows] + [candidate])
        if risk["p_loss_10pct"] > MAX_RUIN_PROB:
            logger.info(
                "User %s: ruin prob %.1f%% exceeds %.0f%% limit — skipping",
                user_id, risk["p_loss_10pct"] * 100, MAX_RUIN_PROB * 100,
            )
            continue

        # ── Build and save strategy ───────────────────────────────────────────
        tp_pct       = float(opp.get("expected_return_pct") or 3.0) / 100
        sl_pct       = float(opp.get("stop_loss_pct") or 0.03)
        rr           = round(tp_pct / sl_pct, 1) if sl_pct > 0 else 0
        bay_wr       = _bayesian_win_rate(sample_size, win_rate)
        confidence   = int(float(opp.get("model_confidence") or 0) * 100)
        ev_pct       = avg_win_pct * bay_wr - abs(avg_loss_pct) * (1 - bay_wr)
        sharpe_str   = f"{opp_sharpe:.2f}" if opp_sharpe else "N/A"

        rationale = (
            f"{opp['summary']} "
            f"Bayesian win rate: {int(bay_wr*100)}% (n={sample_size}). "
            f"EV: {ev_pct:+.2f}% | Sharpe: {sharpe_str} | Tier: {quality_tier}. "
            f"Expected: ~{opp.get('expected_return_pct', 0):.1f}% in {hold_days}d. "
            f"Position: {int(pct*100)}% | Stop: {int(sl_pct*100)}% | R/R: 1:{rr}. "
            f"Confidence: {confidence}% | P(ruin): {risk['p_loss_10pct']:.1%}."
        )

        saved = await db.fetchrow(
            f"""INSERT INTO strategies
               (user_id, opportunity_id, sizing_pct, stop_loss_pct,
                take_profit_pct, rationale, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6, NOW()+INTERVAL '{hold_label}') RETURNING *""",
            user_id,
            opp["id"],
            pct,
            sl_pct,
            tp_pct,
            rationale,
        )

        publish_payload = {
            **dict(saved),
            "action":              opp.get("action", "buy"),
            "tickers":             opp.get("tickers", []),
            "summary":             opp.get("summary", ""),
            "thesis":              opp.get("thesis", ""),
            "confidence":          float(opp.get("model_confidence") or 0),
            "expected_return_pct": float(opp["expected_return_pct"]) if opp.get("expected_return_pct") is not None else None,
            "hold_days":           hold_days,
            "win_rate":            bay_wr,
            "avg_win_pct":         avg_win_pct or None,
            "avg_loss_pct":        avg_loss_pct or None,
            "max_drawdown_pct":    None,
            "sample_size":         sample_size,
            "sharpe":              opp_sharpe,
            "ev_pct":              round(ev_pct, 3),
            "bayesian_win_rate":   round(bay_wr, 4),
            "ruin_probability":    round(risk["p_loss_10pct"], 4),
            "quality_tier":        quality_tier,
            "regime_trend":        (regime or {}).get("trend"),
            "regime_volatility":   (regime or {}).get("volatility"),
        }
        await redis.publish(
            f"strategies:{user['id']}",
            json.dumps(publish_payload, default=str),
        )
        logger.info(
            "Strategy → user=%s ticker=%s tier=%s EV=%+.2f%% Sharpe=%.2f Kelly=%.1f%% Ruin=%.1f%%",
            user_id, primary_ticker or "polymarket",
            quality_tier, ev_pct, opp_sharpe, pct * 100, risk["p_loss_10pct"] * 100,
        )
