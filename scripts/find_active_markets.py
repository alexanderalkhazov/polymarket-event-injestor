#!/usr/bin/env python3
"""Check if the CLOB API has actively trading markets with moving prices."""
import urllib.request
import json

base = "https://clob.polymarket.com"

# Try different query params to find active markets
urls_to_try = [
    f"{base}/markets?active=true&closed=false",
    f"{base}/markets?closed=false",
    f"{base}/markets?accepting_orders=true",
    f"{base}/markets?active=true",
    f"{base}/markets?next_cursor=MQ==",  # page 2
    f"{base}/markets?next_cursor=Mg==",  # page 3
    f"{base}/markets?next_cursor=MTA=",  # page 10
    f"{base}/markets?next_cursor=NTA=",  # page 50
]

headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}

for url in urls_to_try:
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.load(resp)
            data = result.get("data", [])
            cursor = result.get("next_cursor", "N/A")
            
            # Count status combos
            accepting = sum(1 for m in data if isinstance(m, dict) and m.get("accepting_orders") and not m.get("closed"))
            active_open = sum(1 for m in data if isinstance(m, dict) and m.get("active") and not m.get("closed"))
            with_tokens = 0
            has_nonzero_prices = 0
            for m in data:
                if not isinstance(m, dict):
                    continue
                tokens = m.get("tokens", [])
                if tokens:
                    with_tokens += 1
                    for t in tokens:
                        p = float(t.get("price", 0))
                        if 0.01 < p < 0.99:
                            has_nonzero_prices += 1
                            break
            
            short_url = url.replace(base, "")
            print(f"{short_url}")
            print(f"  total={len(data)} accepting_open={accepting} active_open={active_open} with_tokens={with_tokens} nonzero_prices={has_nonzero_prices} cursor={cursor}")
            
            # Show a sample with non-trivial prices
            if has_nonzero_prices > 0:
                for m in data:
                    if not isinstance(m, dict):
                        continue
                    tokens = m.get("tokens", [])
                    for t in tokens:
                        p = float(t.get("price", 0))
                        if 0.01 < p < 0.99:
                            print(f"  LIVE: {m.get('question', '')[:60]}")
                            print(f"        condition_id={m.get('condition_id', '')[:40]}")
                            price_strs = [str(t.get("outcome")) + "=" + str(t.get("price")) for t in tokens]
                            print(f"        prices={price_strs}")
                            print(f"        accepting_orders={m.get('accepting_orders')} active={m.get('active')} closed={m.get('closed')}")
                            break
                    else:
                        continue
                    break
            print()
    except Exception as e:
        short_url = url.replace(base, "")
        print(f"{short_url} -> ERROR: {e}\n")
