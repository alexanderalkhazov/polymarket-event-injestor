#!/usr/bin/env python3
"""
Seed MongoDB with trading/financial market subscriptions from Polymarket API.
Run this after Docker containers are up: python seed_subscriptions.py
"""

import json
import re
import urllib.request
import time
from datetime import datetime, timezone
from pymongo import MongoClient

POLYMARKET_API_URL = "https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=500"
MONGODB_URI = "mongodb://localhost:27017"
MONGODB_DB = "horizon"
MONGODB_COLLECTION = "polymarket_subscriptions"

# Default conviction thresholds
DEFAULT_CONVICTION_THRESHOLD = 0.10  # 10 percentage points
DEFAULT_CONVICTION_THRESHOLD_PCT = 0.20  # 20% relative change

# Keywords that identify trading/financial markets
TRADING_KEYWORDS = re.compile(
    r'bitcoin|btc|\beth\b|ethereum|crypto|solana|\bxrp\b|'
    r'market cap|s&p.?500|nasdaq|gold price|oil price|'
    r'interest rate|fed.?rate|\bgdp\b|inflation|treasury|'
    r'price.*(above|below|over|under)|\$\d+[kmbt]|'
    r'airdrop|token|defi|memecoin|ipo.*(day|price)',
    re.IGNORECASE,
)


def fetch_markets():
    """Fetch markets from Polymarket API, paginating to get a larger pool."""
    all_markets = []
    for offset in range(0, 10000, 500):
        url = f"{POLYMARKET_API_URL}&offset={offset}"
        print(f"Fetching markets from offset={offset}...")
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Accept": "application/json",
                }
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                response = json.load(resp)
                if isinstance(response, dict) and "data" in response:
                    data = response["data"]
                else:
                    data = response
                all_markets.extend(data)
                print(f"  ✓ Fetched {len(data)} markets (total so far: {len(all_markets)})")
                if len(data) < 500:
                    break
        except Exception as e:
            print(f"  ✗ Failed to fetch markets at offset={offset}: {e}")
            break
    return all_markets


def filter_active_markets(markets):
    """Filter for active trading/financial markets. Returns all matches sorted by volume."""

    if not isinstance(markets, list):
        print(f"✗ Expected list of markets, got {type(markets)}")
        return []

    markets = [m for m in markets if isinstance(m, dict)]

    # Filter: active, not closed, and question matches trading keywords
    trading = []
    for m in markets:
        if not m.get("active") or m.get("closed"):
            continue
        question = m.get("question", "")
        if TRADING_KEYWORDS.search(question):
            trading.append(m)

    # Sort by volume descending
    trading.sort(key=lambda m: float(m.get("volumeNum", 0) or 0), reverse=True)

    print(f"✓ Found {len(trading)} trading/financial markets (storing all)")
    for m in trading[:5]:
        vol = float(m.get("volumeNum", 0) or 0)
        q = m.get("question", "")[:70]
        print(f"  → vol={vol:>12,.0f} | {q}")
    if len(trading) > 5:
        print(f"  ... and {len(trading) - 5} more")

    return trading


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
    now = datetime.now(timezone.utc)
    inserted = 0

    for market in markets:
        market_id = market.get("condition_id") or market.get("conditionId") or market.get("id")
        slug = market.get("slug", "")
        question = market.get("question", "")[:100]  # Truncate for display

        if not market_id:
            print(f"  ⊘ Skipped market with no ID")
            continue

        doc = {
            "market_id": market_id,
            "slug": slug,
            "ref_count": 1,
            "conviction_threshold": DEFAULT_CONVICTION_THRESHOLD,
            "conviction_threshold_pct": DEFAULT_CONVICTION_THRESHOLD_PCT,
            "created_at": now,
            "updated_at": now,
        }

        try:
            collection.insert_one(doc)
            print(f"  ✓ Added: {slug or question[:60]}")
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

    active_markets = filter_active_markets(markets)
    if not active_markets:
        print("⊘ No trading markets found.")
        return

    if active_markets:
        seed_subscriptions(active_markets)
    else:
        print("✗ Could not get any markets to seed")
    print("=" * 70)


if __name__ == "__main__":
    main()
