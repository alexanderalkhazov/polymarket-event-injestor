#!/usr/bin/env python3
"""Seed MongoDB with stock news and stock analytics subscriptions.

Populates both `stock_news_subscriptions` and `stock_analytics_subscriptions`
collections with popular S&P 500 / Nasdaq tickers using the ref-count pattern
(ref_count >= 1 = active).

Usage:
    python scripts/seed_stock_subscriptions.py
    MONGODB_URI=mongodb://localhost:27017 python scripts/seed_stock_subscriptions.py
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

from dotenv import load_dotenv
from pymongo import MongoClient, UpdateOne
from pymongo.collection import Collection

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "horizon")

# --------------------------------------------------------------------------- #
# Tickers to seed
# --------------------------------------------------------------------------- #

STOCKS: List[Tuple[str, str]] = [
    # (ticker, company_name)
    ("AAPL", "Apple Inc."),
    ("MSFT", "Microsoft Corporation"),
    ("GOOGL", "Alphabet Inc."),
    ("AMZN", "Amazon.com Inc."),
    ("NVDA", "NVIDIA Corporation"),
    ("TSLA", "Tesla Inc."),
    ("META", "Meta Platforms Inc."),
    ("NFLX", "Netflix Inc."),
    ("AMD", "Advanced Micro Devices Inc."),
    ("INTC", "Intel Corporation"),
    ("CRM", "Salesforce Inc."),
    ("ORCL", "Oracle Corporation"),
    ("ADBE", "Adobe Inc."),
    ("QCOM", "Qualcomm Inc."),
    ("UBER", "Uber Technologies Inc."),
    ("LYFT", "Lyft Inc."),
    ("COIN", "Coinbase Global Inc."),
    ("HOOD", "Robinhood Markets Inc."),
    ("PLTR", "Palantir Technologies Inc."),
    ("SOFI", "SoFi Technologies Inc."),
    ("JPM", "JPMorgan Chase & Co."),
    ("GS", "Goldman Sachs Group Inc."),
    ("BAC", "Bank of America Corporation"),
    ("MS", "Morgan Stanley"),
    ("SPY", "S&P 500 ETF Trust"),
    ("QQQ", "Invesco QQQ Trust"),
]


def _seed_collection(
    collection: Collection,  # type: ignore[type-arg]
    tickers: List[Tuple[str, str]],
    extra_defaults: Dict[str, Any],
    collection_label: str,
) -> None:
    now = datetime.now(timezone.utc)
    ops = []
    for ticker, company_name in tickers:
        ops.append(
            UpdateOne(
                {"ticker": ticker},
                {
                    "$setOnInsert": {
                        "ticker": ticker,
                        "company_name": company_name,
                        "created_at": now,
                        **extra_defaults,
                    },
                    "$set": {"updated_at": now},
                    "$inc": {"ref_count": 0},  # Initialise field if missing
                },
                upsert=True,
            )
        )
    # Ensure ref_count is at least 1 for all tickers
    for ticker, _ in tickers:
        ops.append(
            UpdateOne(
                {"ticker": ticker, "ref_count": {"$lt": 1}},
                {"$set": {"ref_count": 1}},
            )
        )

    result = collection.bulk_write(ops, ordered=False)
    print(
        f"[{collection_label}] upserted={result.upserted_count} "
        f"modified={result.modified_count} total={len(tickers)} tickers"
    )


def main() -> None:
    print(f"Connecting to MongoDB at {MONGODB_URI} db={MONGODB_DATABASE}")
    client: MongoClient = MongoClient(MONGODB_URI)  # type: ignore[type-arg]
    db = client[MONGODB_DATABASE]

    # Pipeline 2 — stock news subscriptions
    news_collection = db["stock_news_subscriptions"]
    _seed_collection(
        news_collection,
        STOCKS,
        extra_defaults={"min_hotness_score": 0.4},
        collection_label="stock_news_subscriptions",
    )

    # Pipeline 3 — stock analytics subscriptions
    analytics_collection = db["stock_analytics_subscriptions"]
    _seed_collection(
        analytics_collection,
        STOCKS,
        extra_defaults={
            "min_volume_ratio": 2.0,
            "min_price_change_pct": 5.0,
            "rsi_overbought": 75.0,
            "rsi_oversold": 25.0,
        },
        collection_label="stock_analytics_subscriptions",
    )

    client.close()
    print("Done. Stock subscriptions seeded successfully.")


if __name__ == "__main__":
    main()
