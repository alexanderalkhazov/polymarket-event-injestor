"""Auto-trader executor.

Subscribes to the Redis 'new_strategy' channel. For every strategy the
ai-correlator fan-out creates, this service:

  1. Fetches the strategy + opportunity + user from PostgreSQL
  2. Checks if the user has Alpaca credentials configured
  3. Detects any conflicting open position and closes it first
  4. Submits the new order (market order, sized by Kelly pct)
  5. Records the trade in the DB and marks the strategy 'executed'

Smart position conflict resolution:
  Signal=BUY  + existing SHORT → close short, then open long
  Signal=BUY  + existing LONG  → add to position only if < 50% of target size
  Signal=BUY  + no position    → open long
  Signal=SELL + existing LONG  → close long, then open short (paper only)
  Signal=SELL + existing SHORT → add to short (paper only)
  Signal=SELL + no position    → open short (paper only; live requires margin)
  Signal=SELL + crypto         → close any long only (crypto can't be shorted)

Gating:
  - User must have alpaca_key_id + alpaca_secret set
  - Action must be 'buy' or 'sell' (not 'watch')
  - Strategy must still be 'pending' when we process it
  - Live accounts: stocks/ETFs only during NYSE/NASDAQ hours
  - Paper accounts: trade anytime (paper API is always open)

All orders are MARKET orders (execution certainty over price precision).
Bracket stop_loss / take_profit is NOT attached here — the strategy's
stop_loss_pct is stored in the DB and the frontend uses it for manual
bracket order UI; auto-trader keeps orders simple to avoid Alpaca bracket
validation failures when the live price shifts between quote and submission.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import asyncpg
import redis.asyncio as aioredis
import yfinance as yf
from alpaca.common.exceptions import APIError
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import OrderSide, TimeInForce
from alpaca.trading.requests import MarketOrderRequest

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL    = os.environ.get("REDIS_URL", "redis://redis:6379")

# If true, auto-execute for all users with Alpaca connected.
# Set AUTO_TRADE_ENABLED=false in env/python.env to disable globally.
AUTO_TRADE_ENABLED = os.getenv("AUTO_TRADE_ENABLED", "true").lower() == "true"


def _is_market_open() -> bool:
    """NYSE/NASDAQ hours: Mon–Fri 09:30–16:00 ET."""
    from zoneinfo import ZoneInfo
    now = datetime.now(ZoneInfo("America/New_York"))
    if now.weekday() >= 5:
        return False
    mins = now.hour * 60 + now.minute
    return 9 * 60 + 30 <= mins < 16 * 60


def _is_crypto(symbol: str) -> bool:
    return symbol.endswith("-USD")


def _alpaca_symbol(symbol: str) -> str:
    """Convert yfinance crypto format (ETH-USD) → Alpaca format (ETHUSD)."""
    if _is_crypto(symbol):
        return symbol.replace("-", "")
    return symbol


def _get_price(symbol: str) -> float:
    """Current price via yfinance — good enough for sizing a market order."""
    try:
        hist = yf.Ticker(symbol).history(period="1d", interval="1m")
        if not hist.empty:
            return float(hist["Close"].iloc[-1])
    except Exception:
        pass
    return 0.0


def _make_client(key_id: str, secret: str, is_paper: bool) -> TradingClient:
    return TradingClient(key_id, secret, paper=is_paper)


def _get_position_qty(client: TradingClient, symbol: str) -> float:
    """Return current position qty: positive=long, negative=short, 0=none."""
    try:
        pos = client.get_open_position(_alpaca_symbol(symbol))
        return float(pos.qty)
    except APIError:
        return 0.0


def _submit(client: TradingClient, symbol: str, qty: float, side: OrderSide) -> str:
    """Submit a market order and return the Alpaca order ID."""
    tif = TimeInForce.GTC if _is_crypto(symbol) else TimeInForce.DAY
    # Use exact fractional qty for crypto; whole shares for equities
    order_qty = qty if _is_crypto(symbol) else max(1, int(qty))
    order = client.submit_order(MarketOrderRequest(
        symbol=_alpaca_symbol(symbol),
        qty=order_qty,
        side=side,
        time_in_force=tif,
    ))
    return str(order.id)


EARNINGS_EXIT_DAYS = int(os.getenv("EARNINGS_GUARD_DAYS", "3"))
_earnings_cache: dict[str, tuple[float, bool]] = {}  # symbol → (expiry_monotonic, result)
_EARNINGS_CACHE_TTL = 3600  # re-check at most once per hour


async def _is_near_earnings(symbol: str, db: asyncpg.Connection) -> bool:
    """Return True if earnings are within EARNINGS_EXIT_DAYS. Cached 1h per symbol."""
    if _is_crypto(symbol):
        return False
    import time as _time
    now = _time.monotonic()
    if symbol in _earnings_cache:
        expiry, result = _earnings_cache[symbol]
        if now < expiry:
            return result

    result = False
    try:
        row = await db.fetchrow(
            """SELECT earnings_date FROM earnings_calendar
               WHERE symbol=$1
                 AND earnings_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $2
               LIMIT 1""",
            symbol, timedelta(days=EARNINGS_EXIT_DAYS),
        )
        if row is not None:
            result = True
        else:
            count = await db.fetchval("SELECT COUNT(*) FROM earnings_calendar")
            if count and count > 0:
                result = False
            else:
                # Table empty — fall back to yfinance (run in thread to avoid blocking)
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(None, _yf_near_earnings, symbol)
    except Exception:
        pass

    _earnings_cache[symbol] = (now + _EARNINGS_CACHE_TTL, result)
    return result


def _yf_near_earnings(symbol: str) -> bool:
    try:
        cal = yf.Ticker(symbol).calendar
        if cal is None:
            return False
        if isinstance(cal, dict):
            dates = cal.get("Earnings Date", [])
            if not dates:
                return False
            ed = dates[0] if isinstance(dates, list) else dates
            ed = ed.date() if hasattr(ed, "date") else ed
            return 0 <= (ed - date.today()).days <= EARNINGS_EXIT_DAYS
        if hasattr(cal, "columns") and "Earnings Date" in cal.columns:
            ed = datetime.fromisoformat(str(cal["Earnings Date"].iloc[0])).date()
            return 0 <= (ed - date.today()).days <= EARNINGS_EXIT_DAYS
    except Exception:
        pass
    return False


async def _record_trade(
    db: asyncpg.Connection,
    user_id: uuid.UUID,
    strategy_id: uuid.UUID,
    symbol: str,
    side: str,
    qty: int,
    alpaca_order_id: str,
    is_paper: bool,
) -> None:
    await db.execute(
        """INSERT INTO trades
           (user_id, strategy_id, alpaca_order_id, symbol, side, qty, status, is_paper)
           VALUES ($1, $2, $3, $4, $5, $6, 'submitted', $7)""",
        user_id, strategy_id, alpaca_order_id,
        symbol, side, qty, is_paper,
    )


class AutoTrader:
    def __init__(self) -> None:
        self._db: Optional[asyncpg.Connection]  = None
        self._redis: Optional[aioredis.Redis]   = None
        # Trailing stop: tracks highest (long) or lowest (short) price seen per strategy
        self._high_water: dict[uuid.UUID, float] = {}

    async def _connect(self) -> None:
        self._db    = await asyncpg.connect(DATABASE_URL)
        self._redis = await aioredis.from_url(REDIS_URL, decode_responses=True)

    async def _close(self) -> None:
        if self._db:    await self._db.close()
        if self._redis: await self._redis.aclose()

    async def _execute(self, strategy_id: str) -> None:
        loop = asyncio.get_event_loop()

        # Fetch strategy + opportunity + user in one query
        row = await self._db.fetchrow(
            """SELECT
                 s.id            AS strategy_id,
                 s.status        AS strategy_status,
                 s.sizing_pct,
                 s.stop_loss_pct,
                 s.take_profit_pct,
                 o.action,
                 o.tickers,
                 u.id            AS user_id,
                 u.alpaca_key_id,
                 u.alpaca_secret,
                 u.is_paper,
                 u.risk_level
               FROM strategies s
               JOIN opportunities o ON o.id = s.opportunity_id
               JOIN users u ON u.id = s.user_id
               WHERE s.id = $1""",
            uuid.UUID(strategy_id),
        )

        if not row:
            logger.debug("Strategy %s not found", strategy_id[:8])
            return

        if row["strategy_status"] != "pending":
            logger.debug("Strategy %s already %s — skipping", strategy_id[:8], row["strategy_status"])
            return

        if not row["alpaca_key_id"] or not row["alpaca_secret"]:
            logger.debug("User %s has no Alpaca credentials — skipping auto-execute", row["user_id"])
            return

        action = row["action"]
        if action == "watch":
            return  # Nothing to execute for a watch signal

        # Pick the primary tradeable ticker (skip polymarket 0x addresses)
        symbol = next(
            (t for t in (row["tickers"] or []) if not t.startswith("0x")),
            None,
        )
        if not symbol:
            logger.debug("No tradeable ticker in strategy %s", strategy_id[:8])
            return

        is_paper = row["is_paper"]
        crypto   = _is_crypto(symbol)

        # Market hours gate — applies to all accounts (paper and live).
        # Crypto trades 24/7; equities/ETFs only during NYSE hours.
        if not crypto and not _is_market_open():
            logger.info("Market closed — skipping entry for strategy %s (%s)", strategy_id[:8], symbol)
            return

        key_id = row["alpaca_key_id"]
        secret = row["alpaca_secret"]

        # Mark as executed immediately to prevent double-execution if we get
        # the message twice (at-least-once delivery from Redis pub/sub).
        updated = await self._db.fetchval(
            "UPDATE strategies SET status='executed' WHERE id=$1 AND status='pending' RETURNING id",
            uuid.UUID(strategy_id),
        )
        if not updated:
            logger.debug("Strategy %s already claimed by another runner", strategy_id[:8])
            return

        try:
            # Run all Alpaca SDK calls in a thread executor (SDK is synchronous)
            client = await loop.run_in_executor(None, _make_client, key_id, secret, is_paper)

            # Account equity for sizing
            account    = await loop.run_in_executor(None, client.get_account)
            equity     = float(account.equity)

            # Current position
            current_qty = await loop.run_in_executor(None, _get_position_qty, client, symbol)

            # Current price (yfinance; good enough for a market order)
            price = await loop.run_in_executor(None, _get_price, symbol)
            if price <= 0:
                logger.warning("Could not get price for %s — reverting strategy to pending", symbol)
                await self._db.execute(
                    "UPDATE strategies SET status='pending' WHERE id=$1",
                    uuid.UUID(strategy_id),
                )
                return

            sizing_pct   = float(row["sizing_pct"] or 0.03)
            target_dollar = equity * sizing_pct
            target_qty    = max(1, int(target_dollar / price))

            orders: list[tuple[str, int, str]] = []  # (side_str, qty, order_id)

            # ── Smart position conflict resolution ────────────────────────────
            if action == "buy":
                if current_qty < 0:
                    # Existing SHORT — close it first, then go long
                    cover_qty = abs(current_qty) if crypto else max(1, math.ceil(abs(current_qty)))
                    oid = await loop.run_in_executor(
                        None, _submit, client, symbol, cover_qty, OrderSide.BUY
                    )
                    orders.append(("buy", cover_qty, oid))
                    logger.info(
                        "AUTO-TRADE: closed SHORT %d %s (conflict with BUY signal) → order %s",
                        cover_qty, symbol, oid,
                    )
                    await asyncio.sleep(0.5)  # give Alpaca a moment before the next order

                if current_qty <= 0:
                    # No position (or just closed short) → open long
                    oid = await loop.run_in_executor(
                        None, _submit, client, symbol, target_qty, OrderSide.BUY
                    )
                    orders.append(("buy", target_qty, oid))
                    logger.info(
                        "AUTO-TRADE: BUY %d %s @ ~$%.2f → order %s",
                        target_qty, symbol, price, oid,
                    )
                else:
                    # Already LONG — add only if current position is < 50% of target
                    existing_value = current_qty * price
                    if existing_value < target_dollar * 0.5:
                        add_qty = max(1, int((target_dollar - existing_value) / price))
                        oid = await loop.run_in_executor(
                            None, _submit, client, symbol, add_qty, OrderSide.BUY
                        )
                        orders.append(("buy", add_qty, oid))
                        logger.info(
                            "AUTO-TRADE: ADD to LONG +%d %s (already have %d) → order %s",
                            add_qty, symbol, int(current_qty), oid,
                        )
                    else:
                        logger.info(
                            "AUTO-TRADE: already have %.1f%% position in %s — no add needed",
                            existing_value / equity * 100, symbol,
                        )

            elif action == "sell":
                if current_qty > 0:
                    # Existing LONG — close it (sell up to target_qty)
                    sell_qty = current_qty if crypto else max(1, min(math.ceil(current_qty), target_qty))
                    oid = await loop.run_in_executor(
                        None, _submit, client, symbol, sell_qty, OrderSide.SELL
                    )
                    orders.append(("sell", sell_qty, oid))
                    logger.info(
                        "AUTO-TRADE: closed LONG %d %s (SELL signal) → order %s",
                        sell_qty, symbol, oid,
                    )
                    await asyncio.sleep(0.5)

                # Open short position — paper and non-crypto only
                if is_paper and not crypto:
                    short_qty = target_qty - (math.ceil(current_qty) if current_qty > 0 else 0)
                    if short_qty > 0:
                        oid = await loop.run_in_executor(
                            None, _submit, client, symbol, short_qty, OrderSide.SELL
                        )
                        orders.append(("sell", short_qty, oid))
                        logger.info(
                            "AUTO-TRADE: SHORT %d %s @ ~$%.2f → order %s",
                            short_qty, symbol, price, oid,
                        )
                elif not is_paper and current_qty <= 0:
                    # Live account with no long to close — can't short without margin setup
                    logger.info(
                        "AUTO-TRADE: SELL signal for %s on live account with no long — skipped (no margin)",
                        symbol,
                    )

            # ── Record all submitted orders ───────────────────────────────────
            for side_str, qty, oid in orders:
                await _record_trade(
                    self._db,
                    row["user_id"],
                    uuid.UUID(strategy_id),
                    symbol, side_str, qty, oid, is_paper,
                )

            if orders:
                logger.info(
                    "AUTO-TRADE complete: strategy=%s symbol=%s action=%s orders=%d",
                    strategy_id[:8], symbol, action, len(orders),
                )
            else:
                logger.info(
                    "AUTO-TRADE: strategy=%s — no orders placed (nothing to do for %s %s)",
                    strategy_id[:8], action, symbol,
                )

        except Exception as exc:
            # Revert status so the user can manually execute from the UI
            await self._db.execute(
                "UPDATE strategies SET status='pending' WHERE id=$1",
                uuid.UUID(strategy_id),
            )
            logger.error(
                "AUTO-TRADE failed for strategy %s (%s): %s",
                strategy_id[:8], symbol, exc, exc_info=True,
            )

    async def _check_exits(self) -> None:
        """Check all executed strategies and close positions that hit SL, TP, or expiry."""
        loop = asyncio.get_event_loop()

        rows = await self._db.fetch(
            """SELECT
                 s.id            AS strategy_id,
                 s.stop_loss_pct,
                 s.take_profit_pct,
                 s.expires_at,
                 o.tickers,
                 o.action,
                 u.id            AS user_id,
                 u.alpaca_key_id,
                 u.alpaca_secret,
                 u.is_paper,
                 t.fill_price    AS entry_price
               FROM strategies s
               JOIN opportunities o ON o.id = s.opportunity_id
               JOIN users u ON u.id = s.user_id
               LEFT JOIN trades t ON t.strategy_id = s.id
                 AND t.status IN ('filled', 'submitted')
               WHERE s.status = 'executed'
                 AND u.alpaca_key_id IS NOT NULL
                 AND u.alpaca_secret  IS NOT NULL
                 AND s.expires_at > NOW() - INTERVAL '7 days'
               ORDER BY t.created_at ASC""",
        )

        seen: set[uuid.UUID] = set()
        for row in rows:
            sid = row["strategy_id"]
            if sid in seen:
                continue
            seen.add(sid)

            symbol = next(
                (t for t in (row["tickers"] or []) if not t.startswith("0x")),
                None,
            )
            if not symbol:
                continue

            # Exits run 24/7 — the market hours gate only applies to new entries.

            try:
                client = await loop.run_in_executor(
                    None, _make_client, row["alpaca_key_id"], row["alpaca_secret"], row["is_paper"]
                )
                current_qty = await loop.run_in_executor(None, _get_position_qty, client, symbol)

                if abs(current_qty) < 1e-6:
                    await self._db.execute(
                        "UPDATE strategies SET status='expired' WHERE id=$1 AND status='executed'",
                        sid,
                    )
                    continue

                current_price = await loop.run_in_executor(None, _get_price, symbol)
                if current_price <= 0:
                    continue

                now         = datetime.now(timezone.utc)
                action      = row["action"]
                # In SCALP_MODE always use live env values — overrides stale DB values
                _scalp = os.getenv("SCALP_MODE", "false").lower() == "true"
                if _scalp:
                    sl_pct = float(os.getenv("SCALP_SL_PCT",  "0.0005"))
                    tp_pct = float(os.getenv("SCALP_TP_PCT",  "0.0003"))
                else:
                    sl_pct = float(row["stop_loss_pct"]   or 0.05)
                    tp_pct = float(row["take_profit_pct"] or 0.10)
                # Fall back to current price as entry when no fill record exists yet
                entry_price = float(row["entry_price"]) if row["entry_price"] else current_price
                expires_at  = row["expires_at"]

                exit_reason: Optional[str] = None

                if expires_at:
                    exp = expires_at.replace(tzinfo=timezone.utc) if expires_at.tzinfo is None else expires_at
                    if now >= exp:
                        exit_reason = "hold_period_expired"

                # Earnings exit — close position before earnings risk window
                if not exit_reason and await _is_near_earnings(symbol, self._db):
                    exit_reason = "earnings_exit"
                    logger.info("Earnings detected for %s — closing position to avoid gap risk", symbol)

                if not exit_reason and entry_price > 0:
                    # Trailing stop: track the best price seen so far.
                    # For longs we track the high; for shorts we track the low.
                    # The stop trails sl_pct below/above the best price, which means:
                    #  - on a bad entry the initial SL (sl_pct from entry) fires fast
                    #  - once price moves in our favour the stop moves with it,
                    #    locking in gains and preventing a winner from turning into a loss.
                    if action == "buy" and current_qty > 0:
                        prev_hwm = self._high_water.get(sid, entry_price)
                        hwm = max(prev_hwm, current_price)
                        self._high_water[sid] = hwm
                        trail_stop = hwm * (1 - sl_pct)
                        if current_price <= trail_stop:
                            exit_reason = "trailing_stop"
                        elif current_price >= entry_price * (1 + tp_pct):
                            exit_reason = "take_profit"
                    elif action == "sell" and current_qty < 0:
                        prev_lwm = self._high_water.get(sid, entry_price)
                        lwm = min(prev_lwm, current_price)
                        self._high_water[sid] = lwm
                        trail_stop = lwm * (1 + sl_pct)
                        if current_price >= trail_stop:
                            exit_reason = "trailing_stop"
                        elif current_price <= entry_price * (1 - tp_pct):
                            exit_reason = "take_profit"

                if not exit_reason:
                    continue

                close_side = OrderSide.SELL if current_qty > 0 else OrderSide.BUY
                close_qty  = abs(current_qty) if _is_crypto(symbol) else max(1, math.ceil(abs(current_qty)))
                side_str   = "sell" if close_side == OrderSide.SELL else "buy"

                oid = await loop.run_in_executor(
                    None, _submit, client, symbol, close_qty, close_side
                )
                await _record_trade(
                    self._db, row["user_id"], sid,
                    symbol, side_str, close_qty, oid, row["is_paper"],
                )
                await self._db.execute(
                    "UPDATE strategies SET status='expired' WHERE id=$1",
                    sid,
                )
                self._high_water.pop(sid, None)

                # Calculate PnL
                if entry_price and entry_price > 0:
                    if action == "buy":
                        pnl_pct = (current_price - entry_price) / entry_price * 100
                    else:
                        pnl_pct = (entry_price - current_price) / entry_price * 100
                    pnl_dollar = pnl_pct / 100 * entry_price * close_qty
                else:
                    pnl_pct = pnl_dollar = 0.0

                logger.info(
                    "EXIT: strategy=%s symbol=%s reason=%s qty=%g price=%.2f pnl=%+.3f%% ($%+.2f) → order %s",
                    str(sid)[:8], symbol, exit_reason, close_qty, current_price,
                    pnl_pct, pnl_dollar, oid,
                )

                # On a loss (trailing stop): set re-entry lockout so the correlator
                # won't immediately re-enter the same losing symbol
                if exit_reason == "trailing_stop" and pnl_pct < 0:
                    lockout_secs = int(os.getenv("SCALP_REENTRY_LOCKOUT_SECONDS", "300"))
                    await self._redis.setex(f"reentry_lock:{symbol}", lockout_secs, "1")
                    logger.info(
                        "LOSS LOCKOUT: %s blocked for %ds (pnl=%+.3f%%)",
                        symbol, lockout_secs, pnl_pct,
                    )

            except Exception as exc:
                logger.error(
                    "Exit check failed for strategy %s (%s): %s",
                    str(sid)[:8], symbol, exc, exc_info=True,
                )

    async def _scan_alpaca_positions(self) -> None:
        """Close any open Alpaca position that hits TP or SL — even with no DB strategy."""
        scalp = os.getenv("SCALP_MODE", "false").lower() == "true"
        if not scalp:
            return
        tp_pct = float(os.getenv("SCALP_TP_PCT", "0.0003"))
        sl_pct = float(os.getenv("SCALP_SL_PCT", "0.0005"))
        loop   = asyncio.get_event_loop()

        users = await self._db.fetch(
            "SELECT id, alpaca_key_id, alpaca_secret, is_paper FROM users "
            "WHERE alpaca_key_id IS NOT NULL AND alpaca_secret IS NOT NULL"
        )
        for user in users:
            try:
                client = await loop.run_in_executor(
                    None, _make_client, user["alpaca_key_id"], user["alpaca_secret"], user["is_paper"]
                )
                positions = await loop.run_in_executor(None, client.get_all_positions)
                for pos in positions:
                    symbol       = str(pos.symbol)
                    qty          = float(pos.qty)
                    plpc         = float(pos.unrealized_plpc)   # e.g. 0.0042 = +0.42%
                    entry_price  = float(pos.avg_entry_price)
                    current_price = float(pos.current_price)

                    if abs(qty) < 1e-6:
                        continue

                    exit_reason = None
                    if plpc >= tp_pct:
                        exit_reason = "take_profit"
                    elif plpc <= -sl_pct:
                        exit_reason = "trailing_stop"

                    if not exit_reason:
                        continue

                    close_side = OrderSide.SELL if qty > 0 else OrderSide.BUY
                    close_qty  = abs(qty) if _is_crypto(symbol) or "USD" in symbol else max(1, math.ceil(abs(qty)))
                    # Convert Alpaca symbol back to yfinance format if needed (ETHUSD → ETH-USD)
                    log_symbol = symbol

                    # Skip if position is already committed to an open order
                    held = float(getattr(pos, "qty_available", None) or 0)
                    if held <= 0 and abs(qty) > 0:
                        logger.debug("DIRECT EXIT skipped %s — qty already held for open order", log_symbol)
                        continue

                    try:
                        tif = TimeInForce.GTC if ("USD" in symbol and len(symbol) > 5) else TimeInForce.DAY
                        order = await loop.run_in_executor(
                            None,
                            lambda: client.submit_order(MarketOrderRequest(
                                symbol=symbol, qty=close_qty, side=close_side, time_in_force=tif
                            ))
                        )
                        pnl_pct    = plpc * 100
                        pnl_dollar = (current_price - entry_price) * close_qty * (1 if qty > 0 else -1)
                        logger.info(
                            "DIRECT EXIT: symbol=%s reason=%s qty=%g price=%.2f pnl=%+.3f%% ($%+.2f) → order %s",
                            log_symbol, exit_reason, close_qty, current_price, pnl_pct, pnl_dollar, order.id,
                        )
                        if exit_reason == "trailing_stop":
                            lockout_secs = int(os.getenv("SCALP_REENTRY_LOCKOUT_SECONDS", "300"))
                            await self._redis.setex(f"reentry_lock:{log_symbol}", lockout_secs, "1")
                    except Exception as exc:
                        err = str(exc)
                        if "held_for_orders" in err or "insufficient qty" in err:
                            logger.debug("DIRECT EXIT skipped %s — already has pending close order", log_symbol)
                        else:
                            logger.error("DIRECT EXIT failed for %s: %s", log_symbol, exc)
            except Exception as exc:
                logger.error("Alpaca position scan failed for user %s: %s", user["id"], exc)

    async def _cleanup(self) -> None:
        """Purge only data that is provably dead — uses business logic, not arbitrary age."""

        # Pending strategies past their expires_at — the hold window elapsed, they'll never run
        r1 = await self._db.execute(
            "DELETE FROM strategies WHERE status='pending' AND expires_at < NOW()"
        )
        # Expired strategies older than 7 days — keep a week for PnL review, then drop
        r2 = await self._db.execute(
            "DELETE FROM strategies WHERE status='expired' AND created_at < NOW() - INTERVAL '7 days'"
        )
        # Trades tied to no surviving strategy (FK cascade should handle this, but be explicit)
        r3 = await self._db.execute(
            """DELETE FROM trades WHERE strategy_id NOT IN (SELECT id FROM strategies)"""
        )
        # Opportunities whose every strategy is gone AND the opp is older than its natural hold window
        r4 = await self._db.execute(
            """DELETE FROM opportunities
               WHERE created_at < NOW() - INTERVAL '1 day'
                 AND id NOT IN (SELECT DISTINCT opportunity_id FROM strategies)"""
        )
        # Signals older than 48h — already ingested into features table
        r5 = await self._db.execute(
            "DELETE FROM signals WHERE created_at < NOW() - INTERVAL '48 hours'"
        )
        # Redis: signal_sources keys with no TTL are stale (should be 24h TTL set by correlator)
        keys = await self._redis.keys("signal_sources:*")
        stale_keys = [k for k in keys if await self._redis.ttl(k) < 0]
        if stale_keys:
            await self._redis.delete(*stale_keys)

        deleted = sum(int(x.split()[-1]) for x in [r1, r2, r3, r4, r5])
        if deleted:
            logger.info(
                "CLEANUP: %d rows removed — "
                "pending_expired=%s old_expired=%s orphan_trades=%s orphan_opps=%s old_signals=%s",
                deleted,
                r1.split()[-1], r2.split()[-1], r3.split()[-1], r4.split()[-1], r5.split()[-1],
            )

    async def _cleanup_loop(self) -> None:
        """Run cleanup once at startup, then at market close (16:05 ET) each weekday."""
        from zoneinfo import ZoneInfo
        while True:
            now = datetime.now(ZoneInfo("America/New_York"))
            # Sleep until next 16:05 ET on a weekday
            target = now.replace(hour=16, minute=5, second=0, microsecond=0)
            if now >= target or now.weekday() >= 5:
                # Already past today's close or weekend — aim for next weekday
                target += timedelta(days=1)
                while target.weekday() >= 5:
                    target += timedelta(days=1)
            wait = (target - now).total_seconds()
            await asyncio.sleep(wait)
            try:
                await self._cleanup()
            except Exception as exc:
                logger.error("Cleanup error: %s", exc)

    async def _monitor_exits(self) -> None:
        """Background loop: checks SL / TP / hold-period expiry. 5s in scalp mode, 60s otherwise."""
        scalp_mode = os.getenv("SCALP_MODE", "false").lower() == "true"
        interval   = 5 if scalp_mode else 60
        logger.info("Exit monitor started (interval=%ds scalp=%s)", interval, scalp_mode)
        while True:
            try:
                await self._check_exits()
                await self._scan_alpaca_positions()
            except Exception as exc:
                logger.error("Exit monitor error: %s", exc, exc_info=True)
            await asyncio.sleep(interval)

    async def run(self) -> None:
        if not AUTO_TRADE_ENABLED:
            logger.warning(
                "AUTO_TRADE_ENABLED=false — auto-trader is running but will not execute. "
                "Set AUTO_TRADE_ENABLED=true in env/python.env to enable."
            )

        logger.info("Auto-trader starting (AUTO_TRADE_ENABLED=%s)", AUTO_TRADE_ENABLED)
        await self._connect()

        # Replay any pending strategies missed while the service was down
        if AUTO_TRADE_ENABLED:
            pending = await self._db.fetch(
                "SELECT id FROM strategies WHERE status='pending' ORDER BY created_at ASC"
            )
            if pending:
                logger.info("Replaying %d pending strategies from before restart", len(pending))
                for row in pending:
                    try:
                        await self._execute(str(row["id"]))
                    except Exception as exc:
                        logger.error("Replay failed for %s: %s", row["id"], exc)

        pubsub = self._redis.pubsub()
        await pubsub.subscribe("new_strategy")
        logger.info("Subscribed to new_strategy channel")

        # Run cleanup once on startup, then every 30 min
        try:
            await self._cleanup()
        except Exception as exc:
            logger.error("Startup cleanup error: %s", exc)

        exit_monitor  = asyncio.create_task(self._monitor_exits())
        cleanup_task  = asyncio.create_task(self._cleanup_loop())

        try:
            async for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                if not AUTO_TRADE_ENABLED:
                    continue
                try:
                    data = json.loads(message["data"])
                    sid  = data.get("strategy_id")
                    if sid:
                        await self._execute(sid)
                except Exception as exc:
                    logger.error("Error processing new_strategy message: %s", exc, exc_info=True)
        finally:
            exit_monitor.cancel()
            cleanup_task.cancel()
            await pubsub.unsubscribe("new_strategy")
            await self._close()
