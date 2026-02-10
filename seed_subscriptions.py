#!/usr/bin/env python3
"""
Seed MongoDB with test market subscriptions from Polymarket API.
Run this after Docker containers are up: python seed_subscriptions.py
"""

import json
import urllib.request
import time
from datetime import datetime
from pymongo import MongoClient

POLYMARKET_API_URL = "https://gamma-api.polymarket.com/markets"
MONGODB_URI = "mongodb://localhost:27017"
MONGODB_DB = "horizon"
MONGODB_COLLECTION = "polymarket_subscriptions"

# Default conviction thresholds
DEFAULT_CONVICTION_THRESHOLD = 0.10  # 10 percentage points
DEFAULT_CONVICTION_THRESHOLD_PCT = 0.20  # 20% relative change


def fetch_markets():
    """Fetch markets from Polymarket API."""
    print(f"Fetching markets from {POLYMARKET_API_URL}...")
    try:
        req = urllib.request.Request(
            POLYMARKET_API_URL,
            headers={"User-Agent": "Mozilla/5.0 (polymarket-kafka-seeder)"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.load(resp)
            print(f"✓ Fetched {len(data)} markets")
            return data
    except Exception as e:
        print(f"✗ Failed to fetch markets: {e}")
        return []


def filter_active_markets(markets, limit=5):
    """Filter for active, open markets. Return top N markets."""
    active = [m for m in markets if m.get("active") and not m.get("closed")]
    print(f"✓ Found {len(active)} active markets, selecting top {limit}")
    return active[:limit]


def seed_subscriptions(markets):
    """Insert market subscriptions into MongoDB."""
    try:
        client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        print(f"✓ Connected to MongoDB at {MONGODB_URI}")
    except Exception as e:
        print(f"✗ Failed to connect to MongoDB: {e}")
        return

    db = client[MONGODB_DB]
    collection = db[MONGODB_COLLECTION]

    # Clear existing subscriptions
    deleted = collection.delete_many({})
    print(f"✓ Cleared {deleted.deleted_count} existing subscriptions")

    # Insert new subscriptions
    now = datetime.utcnow()
    inserted = 0

    for market in markets:
        market_id = market.get("conditionId") or market.get("condition_id") or market.get("id")
        question = market.get("question", "")[:100]  # Truncate for display

        if not market_id:
            print(f"  ⊘ Skipped market with no ID")
            continue

        doc = {
            "market_id": market_id,
            "ref_count": 1,
            "conviction_threshold": DEFAULT_CONVICTION_THRESHOLD,
            "conviction_threshold_pct": DEFAULT_CONVICTION_THRESHOLD_PCT,
            "created_at": now,
            "updated_at": now,
        }

        try:
            collection.insert_one(doc)
            print(f"  ✓ Added: {question[:60]}")
            inserted += 1
        except Exception as e:
            print(f"  ✗ Failed to insert {market_id}: {e}")

    print(f"\n✓ Successfully added {inserted} market subscriptions")
    client.close()


def main():
    """Main entry point."""
    print("=" * 70)
    print("Polymarket Subscription Seeder")
    print("=" * 70)

    markets = fetch_markets()
    if not markets:
        print("✗ No markets fetched. Exiting.")
        return

    active_markets = filter_active_markets(markets, limit=5)
    if not active_markets:
        print("⊘ No active markets found. Using all markets instead.")
        active_markets = markets[:5]

    seed_subscriptions(active_markets)
    print("=" * 70)


if __name__ == "__main__":
    main()
