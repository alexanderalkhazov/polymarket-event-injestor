#!/usr/bin/env python3
import urllib.request
import json

url = "https://clob.polymarket.com/markets"
req = urllib.request.Request(
    url,
    headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
    }
)

try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        response = json.load(resp)
        data = response.get("data", [])
        
        # Find markets with different status combinations
        statuses = {}
        for m in data:
            key = (m.get("active"), m.get("closed"), m.get("accepting_orders"))
            if key not in statuses:
                statuses[key] = []
            statuses[key].append(m)
        
        print("Market status combinations found:")
        for (active, closed, accepting), markets in sorted(statuses.items()):
            print(f"\n  active={active}, closed={closed}, accepting_orders={accepting}: {len(markets)} markets")
            if markets and len(markets) > 0:
                m = markets[0]
                print(f"    Example: {m.get('question', '')[:60]}")
                print(f"    End date: {m.get('end_date_iso', 'N/A')}")
                
except Exception as e:
    print(f"Error: {e}")
