"""Resolve a user's market categories to the subscriptions table.

Usage:
  python scripts/resolve_category_subscriptions.py <user_id>
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


async def resolve_user(user_id: uuid.UUID) -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        categories = await conn.fetch(
            "SELECT category FROM market_category_subscriptions WHERE user_id=$1",
            user_id,
        )
        active_symbols: set[str] = set()
        for row in categories:
            for sym in CATEGORY_SYMBOLS.get(row["category"], []):
                active_symbols.add(sym)

        # Insert missing subscriptions
        inserted = 0
        for symbol in active_symbols:
            for source in SOURCES:
                result = await conn.execute(
                    """INSERT INTO subscriptions (user_id, source, symbol)
                       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING""",
                    user_id, source, symbol,
                )
                if result == "INSERT 0 1":
                    inserted += 1

        # Remove stale subscriptions (symbols no longer in any active category)
        await conn.execute(
            """DELETE FROM subscriptions
               WHERE user_id=$1 AND symbol != ALL($2::text[])""",
            user_id, list(active_symbols),
        )

        total = await conn.fetchval(
            "SELECT COUNT(*) FROM subscriptions WHERE user_id=$1", user_id
        )
        print(f"Resolved {user_id}: {total} subscriptions ({inserted} inserted)")
    finally:
        await conn.close()


async def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python resolve_category_subscriptions.py <user_id>")
        sys.exit(1)
    await resolve_user(uuid.UUID(sys.argv[1]))


if __name__ == "__main__":
    asyncio.run(main())
