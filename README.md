## polymarket-kafka

Polymarket-kafka is a Python microservice that monitors Polymarket prediction markets and publishes conviction-change events to Kafka. It acts as a data feed producer for downstream trading strategies.

### High-level Overview

- Polls the Polymarket CLOB API for configured markets.
- Detects meaningful conviction changes in YES/NO prices (your custom logic).
- Publishes structured `PolymarketEvent` messages to a Kafka topic.
- Manages active market subscriptions via MongoDB with a `ref_count` pattern.

### Conviction Detection Design

The service detects conviction changes by tracking the YES price per market:

- For each market we keep a `ConvictionState` with the last observed YES price and last event time.
- On each new snapshot we compute:
  - **Absolute change**: \(|p_{current} - p_{previous}|\)
  - **Percentage change**: \(|p_{current} - p_{previous}| / p_{previous}\) (when \(p_{previous} > 0\)).
- Per-market thresholds come from the subscription (`conviction_threshold`, `conviction_threshold_pct`) with conservative defaults of:
  - Absolute change ≥ 0.10 (10 percentage points)
  - OR percentage change ≥ 0.20 (20% relative move)
- If neither threshold is exceeded, the move is treated as noise and no event is emitted.
- If a threshold is exceeded:
  - **Direction** is `"yes"` when price increased, `"no"` when it decreased.
  - A `ConvictionChange` object is created, including direction, magnitude, percentage magnitude, and the previous YES price.
  - This feeds into `PolymarketEvent`, which is then published to Kafka.

This approach keeps the logic simple and explainable while allowing per-market tuning for more or less sensitivity via MongoDB-stored subscription settings.

### Discord Logging

You can send service logs to a Discord channel using a webhook.

Set these environment variables:

- DISCORD_WEBHOOK_URL: your Discord webhook URL
- DISCORD_LOG_LEVEL: DEBUG, INFO, WARNING, ERROR (defaults to LOG_LEVEL)
- LOG_LEVEL: base logger level