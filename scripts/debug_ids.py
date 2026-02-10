#!/usr/bin/env python3
"""Debug: compare MongoDB market_ids with CLOB API condition_ids."""
import urllib.request
import json
import pymongo

# Fetch from CLOB API
url = "https://clob.polymarket.com/markets"
req = urllib.request.Request(url, headers={
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
})
with urllib.request.urlopen(req, timeout=10) as resp:
    data = json.load(resp)["data"]

api_ids = set()
for m in data:
    cid = m.get("condition_id", "")
    if cid:
        api_ids.add(cid)

print(f"CLOB API: {len(data)} markets, {len(api_ids)} unique condition_ids")
print(f"Sample API condition_ids:")
for cid in list(api_ids)[:3]:
    print(f"  {cid}")

# Fetch from MongoDB
client = pymongo.MongoClient("mongodb://localhost:27017", serverSelectionTimeoutMS=3000)
db = client["horizon"]
subs = list(db["polymarket_subscriptions"].find({}, {"market_id": 1, "_id": 0}))
mongo_ids = [s["market_id"] for s in subs]

print(f"\nMongoDB: {len(mongo_ids)} subscriptions")
print(f"Sample MongoDB market_ids:")
for mid in mongo_ids[:3]:
    print(f"  {mid}")

# Cross-check
found = 0
missing = 0
for mid in mongo_ids:
    if mid in api_ids:
        found += 1
    else:
        missing += 1
        print(f"  MISSING from API: {mid[:40]}...")

print(f"\nResult: {found} found, {missing} missing out of {len(mongo_ids)} subscriptions")

if missing > 0:
    print("\n--- FIX: Re-seeding with correct IDs from the API ---")
    print("Run: python3 seed_subscriptions.py")
