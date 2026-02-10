#!/usr/bin/env python3
"""Publish synthetic conviction events to Kafka for end-to-end testing."""

import json
import uuid
import argparse
from datetime import datetime, timezone
from random import random, choice

from confluent_kafka import Producer

BOOTSTRAP = "localhost:9092"
TOPIC = "polymarket-events"

SAMPLE_MARKETS = [
    ("0x3648ab7c146a9a85957e07c1d43a82272be71fde767822fd425e10ba0d6c0757", "Will Glenn Youngkin win the 2024 Republican Presidential Nomination?"),
    ("0xd305baec7b9b2438d05e887dc84dbbb293a670ee443e541cbe888bfc5f1ba8dd", "Will Brendan Fraser win the Oscar for Best Actor?"),
    ("0x9c4d05a5b1cec55d56626ede111048cb6c43ec8e8c777f794b605d33be0c82ec", "Will Morocco win the 2022 World Cup?"),
]


def make_event() -> dict:
    market_id, question = choice(SAMPLE_MARKETS)
    prev = round(0.3 + random() * 0.3, 4)
    cur = round(min(1.0, prev + 0.12 + random() * 0.25), 4)
    direction = "yes" if cur > prev else "no"
    magnitude = round(abs(cur - prev), 4)
    now = datetime.now(timezone.utc)
    return {
        "event_id": str(uuid.uuid4()),
        "timestamp": now.isoformat(),
        "market_id": market_id,
        "question": question,
        "yes_price": cur,
        "no_price": round(1.0 - cur, 4),
        "conviction_direction": direction,
        "conviction_magnitude": magnitude,
        "conviction_magnitude_pct": round(magnitude / prev if prev else 0, 4),
        "previous_yes_price": prev,
        "source": "polymarket-kafka",
        "published_at": now.isoformat(),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", "-n", type=int, default=3)
    args = ap.parse_args()

    p = Producer({"bootstrap.servers": BOOTSTRAP, "client.id": "test-publisher"})
    delivered = 0

    def cb(err, msg):
        nonlocal delivered
        if err:
            print(f"  FAILED: {err}")
        else:
            delivered += 1

    print(f"Publishing {args.count} test event(s) to {TOPIC}...")
    for i in range(args.count):
        ev = make_event()
        p.produce(TOPIC, json.dumps(ev).encode("utf-8"), key=ev["market_id"].encode("utf-8"), callback=cb)
        print(f"  [{i+1}] {ev['question'][:50]} | {ev['conviction_direction']} | mag={ev['conviction_magnitude']}")

    p.flush(10)
    print(f"\nDelivered {delivered}/{args.count} events")


if __name__ == "__main__":
    main()
