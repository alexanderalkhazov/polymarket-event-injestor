"""Create a test user with oil_energy + us_equities categories and resolve subscriptions.

Usage (from repo root):
  python scripts/seed_test_user.py
"""
from __future__ import annotations

import asyncio
import os
import sys

import asyncpg
import bcrypt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from config.market_categories import CATEGORY_SYMBOLS, SOURCES

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/eventedge"
)

TEST_EMAIL    = "test@test.com"
TEST_PASSWORD = "password123"
CATEGORIES    = ["oil_energy", "us_equities"]


async def main() -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        pw_hash = bcrypt.hashpw(TEST_PASSWORD.encode(), bcrypt.gensalt()).decode()

        user = await conn.fetchrow(
            """INSERT INTO users (email, password_hash, risk_level, onboarding_complete)
               VALUES ($1, $2, 'moderate', TRUE)
               ON CONFLICT (email) DO UPDATE SET password_hash=$2
               RETURNING id""",
            TEST_EMAIL, pw_hash,
        )
        user_id = user["id"]
        print(f"User: {TEST_EMAIL}  id={user_id}")

        for cat in CATEGORIES:
            await conn.execute(
                """INSERT INTO market_category_subscriptions (user_id, category)
                   VALUES ($1, $2) ON CONFLICT DO NOTHING""",
                user_id, cat,
            )
            print(f"  Category: {cat}")

        # Resolve categories → subscriptions
        inserted = 0
        for cat in CATEGORIES:
            for symbol in CATEGORY_SYMBOLS.get(cat, []):
                for source in SOURCES:
                    result = await conn.execute(
                        """INSERT INTO subscriptions (user_id, source, symbol)
                           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING""",
                        user_id, source, symbol,
                    )
                    if result == "INSERT 0 1":
                        inserted += 1

        total = await conn.fetchval(
            "SELECT COUNT(*) FROM subscriptions WHERE user_id=$1", user_id
        )
        print(f"  Subscriptions: {total} total ({inserted} newly added)")
        print(f"\nLogin at localhost:3000 with {TEST_EMAIL} / {TEST_PASSWORD}")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
