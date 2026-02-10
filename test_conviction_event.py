#!/usr/bin/env python3
"""
Test script to simulate conviction changes and publish events to Kafka.
Demonstrates the full end-to-end event flow.
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

# Add src to path so we can import modules
sys.path.insert(0, str(Path(__file__).parent / "src"))

from polymarket_kafka.config import load_config
from polymarket_kafka.data_source import MarketSnapshot
from polymarket_kafka.models import PolymarketSubscription
from polymarket_kafka.conviction import ConvictionState, detect_conviction_change
from polymarket_kafka.event_builder import build_polymarket_event
from polymarket_kafka.kafka_client import KafkaClient


def test_conviction_event():
    """Simulate a conviction change and publish event to Kafka."""
    
    print("=" * 70)
    print("Polymarket Conviction Event Test")
    print("=" * 70)
    
    # Initialize Kafka client
    config = load_config()
    kafka_client = KafkaClient(config.kafka)
    
    # Create test subscription
    sub = PolymarketSubscription(
        market_id="0xtest123abc",
        conviction_threshold=0.10,
        conviction_threshold_pct=0.20,
    )
    print(f"\n✓ Created subscription for market: {sub.market_id}")
    print(f"  Thresholds: {sub.conviction_threshold}pp absolute, {sub.conviction_threshold_pct*100:.0f}% relative")
    
    # Create conviction state tracker
    state = ConvictionState()
    
    # Simulate market snapshots with price movements that trigger conviction
    snapshots = [
        MarketSnapshot(
            market_id="0xtest123abc",
            question="Will BTC reach $50k by end of 2026?",
            yes_price=0.45,
            no_price=0.55,
            volume=1000.0,
            liquidity=500.0,
            active=True,
            closed=False,
            fetched_at=datetime.now(timezone.utc),
        ),
        # Significant price movement: YES price moves from 0.45 to 0.60 (+15pp, +33%)
        MarketSnapshot(
            market_id="0xtest123abc",
            question="Will BTC reach $50k by end of 2026?",
            yes_price=0.60,
            no_price=0.40,
            volume=1200.0,
            liquidity=520.0,
            active=True,
            closed=False,
            fetched_at=datetime.now(timezone.utc),
        ),
        # Another movement: YES price moves from 0.60 to 0.42 (-18pp, -30%)
        MarketSnapshot(
            market_id="0xtest123abc",
            question="Will BTC reach $50k by end of 2026?",
            yes_price=0.42,
            no_price=0.58,
            volume=1400.0,
            liquidity=540.0,
            active=True,
            closed=False,
            fetched_at=datetime.now(timezone.utc),
        ),
    ]
    
    print(f"\n✓ Created {len(snapshots)} market snapshots with price movements")
    
    # Process each snapshot and detect conviction changes
    event_count = 0
    for i, snapshot in enumerate(snapshots, 1):
        print(f"\nSnapshot {i}:")
        print(f"  Question: {snapshot.question}")
        print(f"  YES price: {snapshot.yes_price:.2f}, NO price: {snapshot.no_price:.2f}")
        print(f"  Volume: {snapshot.volume}, Liquidity: {snapshot.liquidity}")
        
        # Detect conviction change
        change = detect_conviction_change(sub, snapshot, state)
        
        if change is None:
            print(f"  ⊘ No conviction change detected")
        else:
            print(f"  ✓ CONVICTION CHANGE DETECTED!")
            print(f"    Direction: {change.direction}")
            print(f"    Magnitude: {change.magnitude:.4f} ({change.magnitude_pct*100:.1f}%)")
            
            # Build and publish event
            try:
                event = build_polymarket_event(snapshot, change)
                kafka_client.publish_event(event)
                event_count += 1
                print(f"    ✓ Event published to Kafka")
                print(f"      Event ID: {event.event_id}")
                print(f"      Timestamp: {event.timestamp}")
            except Exception as e:
                print(f"    ✗ Failed to publish event: {e}")
    
    # Flush pending messages
    kafka_client.flush()
    print(f"\n✓ Flushed Kafka producer")
    
    print("\n" + "=" * 70)
    print(f"Test complete: Published {event_count} conviction events to Kafka")
    print("=" * 70)
    print("\nTo view events in Kafka topic 'polymarket-events', run:")
    print("  docker exec -it polymarket-project-kafka-1 kafka-console-consumer \\")
    print("    --bootstrap-server localhost:9092 \\")
    print("    --topic polymarket-events \\")
    print("    --from-beginning")


if __name__ == "__main__":
    test_conviction_event()
