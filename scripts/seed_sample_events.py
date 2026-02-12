#!/usr/bin/env python3
"""
Seed sample Polymarket events into MongoDB for testing
This allows you to test the AI chat without needing real Kafka events
"""

from pymongo import MongoClient
from datetime import datetime, timedelta
import random

# MongoDB connection
client = MongoClient('mongodb://localhost:27017/')
db = client['horizon']
collection = db['polymarket_events']

# Sample markets
MARKETS = [
    {
        "market_slug": "will-bitcoin-reach-100k-by-2026",
        "question": "Will Bitcoin reach $100k by end of 2026?",
        "outcome": "Yes",
    },
    {
        "market_slug": "gold-price-above-2500",
        "question": "Will gold price be above $2,500 by March 2026?",
        "outcome": "Yes",
    },
    {
        "market_slug": "sp500-new-highs",
        "question": "Will S&P 500 hit new all-time highs in Q1 2026?",
        "outcome": "Yes",
    },
    {
        "market_slug": "tesla-stock-prediction",
        "question": "Will Tesla stock be above $300 by April 2026?",
        "outcome": "No",
    },
    {
        "market_slug": "crypto-regulation-us",
        "question": "Will US pass major crypto regulation in 2026?",
        "outcome": "Yes",
    },
]

def generate_events(num_events=100):
    """Generate sample Polymarket events"""
    print(f"🌱 Seeding {num_events} Polymarket events...")
    
    events = []
    end_time = datetime.now()
    
    for i in range(num_events):
        market = random.choice(MARKETS)
        
        # Generate timestamp (spread over last 24 hours)
        hours_ago = (num_events - i) / 4  # More recent events later
        timestamp = end_time - timedelta(hours=hours_ago)
        
        # Generate realistic price movements
        base_price = random.uniform(0.3, 0.7)
        price_volatility = random.uniform(-0.05, 0.05)
        current_price = max(0.01, min(0.99, base_price + price_volatility * (i / num_events)))
        
        # Generate volume
        volume = random.uniform(1000, 50000)
        
        event = {
            "market_id": f"market_{market['market_slug']}",
            "market_slug": market['market_slug'],
            "question": market['question'],
            "outcome": market['outcome'],
            "current_price": round(current_price, 3),
            "volume": round(volume, 2),
            "timestamp": timestamp,
            "conviction_level": random.choice(["high", "medium", "low"]),
            "metadata": {
                "liquidity": random.uniform(10000, 100000),
                "num_traders": random.randint(100, 5000),
            }
        }
        
        events.append(event)
    
    return events

def seed_database():
    """Seed the database with sample events"""
    print("📊 MongoDB Polymarket Data Seeder")
    print("=" * 60)
    
    try:
        # Clear existing events
        count = collection.count_documents({})
        if count > 0:
            print(f"🗑️  Deleting {count} existing events...")
            collection.delete_many({})
        
        # Generate and insert new events
        events = generate_events(100)
        result = collection.insert_many(events)
        
        print(f"✅ Inserted {len(result.inserted_ids)} events")
        
        # Create indexes for better performance
        print("📇 Creating indexes...")
        collection.create_index([("timestamp", -1)])
        collection.create_index([("market_slug", 1)])
        collection.create_index([("market_id", 1)])
        
        # Show summary by market
        print("\n📈 Market Summary:")
        print("-" * 60)
        
        pipeline = [
            {
                "$group": {
                    "_id": "$market_slug",
                    "question": {"$first": "$question"},
                    "events": {"$sum": 1},
                    "avg_price": {"$avg": "$current_price"},
                    "total_volume": {"$sum": "$volume"}
                }
            },
            {"$sort": {"events": -1}}
        ]
        
        for market in collection.aggregate(pipeline):
            print(f"\n🎯 {market['question']}")
            print(f"   Events: {market['events']}")
            print(f"   Avg Price: {market['avg_price']*100:.1f}%")
            print(f"   Total Volume: ${market['total_volume']:,.0f}")
        
        print("\n" + "=" * 60)
        print("✅ Database seeding complete!")
        print("\n💡 Now try asking the AI:")
        print('   • "Should I buy gold futures?"')
        print('   • "What are the trending markets?"')
        print('   • "Analyze Bitcoin predictions"')
        print('   • "Give me a crypto trading strategy"')
        print("\n🌐 Open: http://localhost:3001")
        print("🔑 Login: test@polymarket.com / testpass123")
        print("=" * 60)
        
    except Exception as e:
        print(f"❌ Error seeding database: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    return True

if __name__ == "__main__":
    success = seed_database()
    exit(0 if success else 1)
