"""Resolve all users' market categories to the subscriptions table.

Run after adding a new symbol to market_categories.py:
  python scripts/resolve_all_users.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid

import asyncpg

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from config.market_categories import CATEGORY_SYMBOLS, SOURCES

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/eventedge"
)


async def resolve_user(conn: asyncpg.Connection, user_id: uuid.UUID) -> None:
    categories = await conn.fetch(
        "SELECT category FROM market_category_subscriptions WHERE user_id=$1", user_id,
    )
    active_symbols: set[str] = set()
    for row in categories:
        for sym in CATEGORY_SYMBOLS.get(row["category"], []):
            active_symbols.add(sym)

    for symbol in active_symbols:
        for source in SOURCES:
            await conn.execute(
                """INSERT INTO subscriptions (user_id, source, symbol)
                   VALUES ($1, $2, $3) ON CONFLICT DO NOTHING""",
                user_id, source, symbol,
            )

    if active_symbols:
        await conn.execute(
            """DELETE FROM subscriptions
               WHERE user_id=$1 AND symbol != ALL($2::text[])""",
            user_id, list(active_symbols),
        )


async def main() -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        users = await conn.fetch("SELECT id FROM users")
        for user in users:
            await resolve_user(conn, user["id"])
            print(f"Resolved user {user['id']}")
        print(f"Done: resolved {len(users)} users")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
