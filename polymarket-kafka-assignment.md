# Home Assignment: polymarket-kafka Service

## Goal

Build a **production-quality Python microservice** that monitors [Polymarket](https://polymarket.com/) prediction markets and publishes events to Kafka when it detects sudden conviction changes — moments where the crowd's belief in an outcome shifts significantly (e.g., an election probability jumping from 40% to 65%).

The service is a **data feed producer** for an algorithmic trading platform. Trading strategies will consume these events to incorporate real-world signals — elections, regulations, geopolitics, crypto governance — into their decision-making.

### What You're Building

A standalone service called `polymarket-kafka` that:
1. **Polls** the Polymarket API for prediction market prices
2. **Detects** meaningful conviction changes (your own detection logic)
3. **Publishes** structured events to a Kafka topic
4. **Manages subscriptions** via MongoDB (which markets to monitor)

### What We're Evaluating

| Area | What We Look For |
|------|-----------------|
| **Architecture** | Clean separation of concerns, following the patterns described below |
| **Conviction Detection** | Your original design for detecting meaningful market shifts (Section 6) — this is where your thinking matters most |
| **Reliability** | Error handling, graceful shutdown, deduplication, no data loss |
| **Code Quality** | Clean, typed, tested Python. Pydantic models, async patterns |
| **Testing** | Meaningful tests with 75%+ coverage, good use of mocks |

### Constraints

- **Python 3.11+**, async (`asyncio`)
- **confluent-kafka** for Kafka, **pymongo** for MongoDB, **pydantic** for models
- Must follow the DTO contracts defined below (the downstream consumer expects them)
- The conviction detection logic is entirely **your design** — we provide the problem, you design the solution

---

## Table of Contents

1. [System Context](#1-system-context)
2. [Existing Contracts You Must Follow](#2-existing-contracts-you-must-follow)
3. [Architecture](#3-architecture)
4. [Polymarket API](#4-polymarket-api)
5. [New DTOs to Create](#5-new-dtos-to-create)
6. [Conviction Change Detection (Your Design)](#6-conviction-change-detection-your-design)
7. [Service Components](#7-service-components)
8. [Kafka Integration](#8-kafka-integration)
9. [Configuration](#9-configuration)
10. [Project Structure](#10-project-structure)
11. [Testing Requirements](#11-testing-requirements)
12. [Acceptance Criteria](#12-acceptance-criteria)

---

## 1. System Context

Our platform has a data pipeline where **producer services** poll external data sources, detect meaningful changes, and publish events to Kafka. A downstream **strategy-host** consumes these events and feeds them into trading strategies.

The existing pipeline for financial market data works like this:

```
MongoDB (subscriptions collection)
    │
    │  polls periodically for active subscriptions (ref_count > 0)
    ▼
Subscription Manager
    │
    │  returns list of active subscriptions
    ▼
Producer Service (polling loop)
    │
    │  for each subscription:
    │    1. Fetch latest data from external API
    │    2. Detect if there's new/meaningful data
    │    3. Build event dict
    │    4. Publish to Kafka topic
    ▼
Kafka Topic
    │
    │  JSON messages, partitioned by identifier
    ▼
strategy-host (consumer)
    │
    │  deserializes events, routes to trading strategies
    ▼
Strategy evaluation → Trading decisions
```

### Key Patterns to Follow

| Pattern | Description |
|---------|-------------|
| **Subscription Management** | MongoDB collection with `ref_count` field (atomic `$inc` operations). A subscription is active when `ref_count > 0`. The service polls MongoDB periodically for changes. |
| **Deduplication** | In-memory tracking of last published state per subscription. Only publish when meaningful change is detected. |
| **Kafka Partitioning** | Partition key = primary identifier. Ensures ordering within an entity. |
| **Event Serialization** | JSON dict with `event_id` (UUID), `timestamp` (ISO 8601), data fields, `source` (producer name), `published_at`. |
| **Rate Limiting** | Configurable delay between external API calls. |
| **Graceful Shutdown** | Signal handlers (SIGINT/SIGTERM), flush Kafka producer, close MongoDB connection. |
| **Configuration** | Python dataclasses loaded from environment variables via `python-dotenv`. |

---

## 2. Existing Contracts You Must Follow

These are the existing DTOs in our shared library. Your service must produce events that follow the same structural conventions.

### CandleEvent (existing — for reference)

This is the event produced by our financial data producer. Your `PolymarketEvent` must follow the same structural patterns.

```python
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field

class CandleEvent(BaseModel):
    """Market candle event — OHLCV bar data."""

    event_id: str = Field(..., description="Unique event identifier")
    timestamp: datetime = Field(..., description="Event timestamp")
    symbol: str = Field(..., description="Symbol (e.g., 'AAPL', 'X:BTCUSD')")
    timeframe: str = Field(..., description="Timeframe (e.g., '1m', '5m', '1h')")
    open: float = Field(..., description="Open price")
    high: float = Field(..., description="High price")
    low: float = Field(..., description="Low price")
    close: float = Field(..., description="Close price")
    volume: float = Field(..., description="Volume")
    source: str = Field(default="massive-kafka", description="Data source")
    published_at: Optional[datetime] = Field(None, description="When event was published")

    model_config = {"extra": "forbid", "frozen": True}
```

**Conventions to notice:**
- `event_id`: UUID string, unique per event
- `timestamp`: UTC datetime of the data point
- `source`: identifies which producer service created the event
- `published_at`: when the event was actually sent to Kafka
- `model_config`: strict (`extra="forbid"`) and immutable (`frozen=True`)

### CandleSubscription (existing — for reference)

This is how the existing service tracks what to monitor. Your `PolymarketSubscription` must follow the same `ref_count` pattern.

```python
class CandleSubscription(BaseModel):
    """Configuration for a candle data subscription.

    The ref_count field implements reference counting:
    - Subscription is active when ref_count > 0
    - Multiple consumers can subscribe to the same feed
    - MongoDB manages counter via atomic $inc operator
    """

    symbol: str = Field(..., description="Symbol (e.g., 'AAPL', 'BTCUSD')")
    timeframe: str = Field(..., description="Timeframe (e.g., '1m', '5m', '1h')")
    asset_type: str = Field(..., description="Asset type (stock, crypto, forex)")
    ref_count: int = Field(default=0, description="Reference count — active when > 0")
    created_at: Optional[datetime] = Field(None, description="Creation timestamp")
    updated_at: Optional[datetime] = Field(None, description="Last update timestamp")

    model_config = {"extra": "forbid"}

    def is_active(self) -> bool:
        return self.ref_count > 0

    def subscription_key(self) -> str:
        return f"{self.symbol}:{self.timeframe}"
```

**Conventions to notice:**
- `ref_count` for multi-consumer reference counting
- `is_active()` and `subscription_key()` helper methods
- Atomic MongoDB operations (`$inc`) for subscribe/unsubscribe
- `model_config` with `extra="forbid"`

### SignalType Enum (existing — for reference)

```python
from enum import Enum

class SignalType(str, Enum):
    """Supported signal types. Currently only OHLCV; your service adds a new type."""
    OHLCV = "ohlcv"
```

Your service introduces a new signal domain. You should add:

```python
class SignalType(str, Enum):
    OHLCV = "ohlcv"
    POLYMARKET = "polymarket"  # NEW — conviction-based signals
```

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      polymarket-kafka                            │
│                                                                  │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────┐  │
│  │ Subscription │───▶│ PolymarketKafka  │───▶│    Kafka      │  │
│  │   Manager    │    │     Runner       │    │   Producer    │  │
│  │  (MongoDB)   │    │  (polling loop)  │    │              │  │
│  └──────────────┘    └────────┬─────────┘    └──────┬───────┘  │
│                               │                      │          │
│                      ┌────────▼─────────┐           │          │
│                      │  Polymarket API  │           │          │
│                      │   (data source)  │           │          │
│                      └──────────────────┘           │          │
└─────────────────────────────────────────────────────┼──────────┘
                                                       │
                                                       ▼
                                            Kafka Topic: "polymarket-events"
                                                       │
                                                       ▼
                                            ┌──────────────────┐
                                            │  strategy-host   │
                                            │  (consumer)      │
                                            └──────────────────┘
```

---

## 4. Polymarket API

Polymarket provides a public REST API for accessing prediction market data. Use the [CLOB API](https://docs.polymarket.com/) (Central Limit Order Book).

### Key Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /markets` | List all markets |
| `GET /markets/{condition_id}` | Get specific market by condition ID |
| `GET /prices` | Get current token prices for a market |
| `GET /book` | Get order book for a token |

### Market Data Structure (example API response)

```json
{
  "condition_id": "0x1234...",
  "question": "Will Bitcoin exceed $100k by end of 2025?",
  "description": "This market resolves YES if...",
  "outcomes": ["Yes", "No"],
  "tokens": [
    {
      "token_id": "abc123",
      "outcome": "Yes",
      "price": 0.72
    },
    {
      "token_id": "def456",
      "outcome": "No",
      "price": 0.28
    }
  ],
  "volume": 1500000.0,
  "liquidity": 250000.0,
  "end_date_iso": "2025-12-31T23:59:59Z",
  "active": true,
  "closed": false
}
```

### What to Track

For each monitored market, poll the API at a configurable interval and track at minimum:

1. **Yes price** — implied probability of the "Yes" outcome (0.0 to 1.0)
2. **No price** — implied probability of the "No" outcome
3. **Volume** — trading volume
4. **Liquidity** — current market liquidity

---

## 5. New DTOs to Create

### PolymarketEvent

Your main output event. Must follow the same conventions as `CandleEvent`.

**Required fields** (non-negotiable — the consumer expects these):

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | `str` | UUID, unique per event |
| `timestamp` | `datetime` | When the snapshot was taken (UTC) |
| `market_id` | `str` | Polymarket condition_id |
| `question` | `str` | Market question text |
| `yes_price` | `float` | Current YES token price (0.0–1.0) |
| `no_price` | `float` | Current NO token price (0.0–1.0) |
| `source` | `str` | Must be `"polymarket-kafka"` |
| `published_at` | `Optional[datetime]` | When event was published to Kafka |

**You must also include fields for conviction change data.** The exact fields for representing the conviction shift are up to you (see [Section 6](#6-conviction-change-detection-your-design)), but the event must carry enough information for a downstream strategy to determine:
- **Direction**: is conviction moving toward YES or NO?
- **Magnitude**: how significant is the shift?

**Model config must match existing convention:**
```python
model_config = {"extra": "forbid", "frozen": True}
```

### PolymarketSubscription

Tracks which markets to monitor. Must follow the same `ref_count` pattern as `CandleSubscription`.

**Required fields:**

| Field | Type | Description |
|-------|------|-------------|
| `market_id` | `str` | Polymarket condition_id |
| `ref_count` | `int` | Reference count — active when > 0 |
| `created_at` | `Optional[datetime]` | Creation timestamp |
| `updated_at` | `Optional[datetime]` | Last update timestamp |

**Must implement:**
- `is_active() -> bool` — returns `self.ref_count > 0`
- `subscription_key() -> str` — returns unique key for this subscription

**You may add additional fields** that your conviction detection logic needs (e.g., threshold configuration, category tags, etc.).

**MongoDB operations must use atomic `$inc`:**

```python
# Subscribe (atomic increment)
collection.update_one(
    {"market_id": condition_id},
    {
        "$inc": {"ref_count": 1},
        "$setOnInsert": {"created_at": now, ...},
        "$set": {"updated_at": now},
    },
    upsert=True,
)

# Unsubscribe (atomic decrement)
collection.update_one(
    {"market_id": condition_id},
    {
        "$inc": {"ref_count": -1},
        "$set": {"updated_at": now},
    },
)
```

---

## 6. Conviction Change Detection (Your Design)

This is the core intellectual challenge of the assignment. **You have complete freedom to design the conviction detection logic.**

### The Problem

A prediction market's YES price represents the crowd's implied probability of an outcome. When the price moves significantly, it signals that new information has entered the market. Your service must detect these moments and emit events.

**Examples of conviction changes:**
- YES price jumps from 0.30 to 0.55 — a major shift in belief
- YES price drops from 0.80 to 0.60 — the crowd is losing confidence
- YES price moves from 0.50 to 0.51 — noise, probably not worth signaling

### What You Must Decide

1. **When to emit an event**: What constitutes a "meaningful" conviction change? Consider:
   - Simple threshold on absolute price change?
   - Percentage-based threshold?
   - Rolling window / rate of change?
   - Volume-weighted conviction?
   - Adaptive thresholds based on market liquidity?

2. **What conviction data to include in the event**: Beyond the required fields, what fields best represent the conviction shift for a downstream trading strategy?

3. **How to handle edge cases**:
   - First poll for a new subscription (no previous price to compare)
   - Market becomes inactive/closed
   - API errors or missing data
   - Price oscillating around a threshold

4. **Deduplication strategy**: How do you avoid publishing redundant events? The existing candle service tracks `_last_published[key] = timestamp` in memory. You need an equivalent mechanism, but adapted for conviction-based (not time-series) data.

### What We're Evaluating

- **Thoughtfulness**: Did you consider edge cases and failure modes?
- **Simplicity**: Is the detection logic clean and easy to reason about?
- **Configurability**: Can the sensitivity be tuned without code changes?
- **Documentation**: Did you explain your design choices in code comments or a README?

---

## 7. Service Components

### 7.1 Data Source

A client wrapper for the Polymarket CLOB API.

**Responsibilities:**
- HTTP client with session pooling, timeouts, and retry logic
- Fetch current market state (prices, volume, liquidity)
- Rate limiting between API calls

### 7.2 Subscription Manager

Polls MongoDB for active subscriptions.

**Responsibilities:**
- Connect to MongoDB (`polymarket_subscriptions` collection)
- Poll for active subscriptions (`ref_count > 0`) at a configurable interval
- Provide `subscribe()` and `unsubscribe()` helper functions with atomic MongoDB operations

### 7.3 Event Builder

Builds `PolymarketEvent` dicts for Kafka publishing.

**Must include:**
- `event_id`: generated UUID
- `timestamp`: current UTC time
- `source`: `"polymarket-kafka"`
- `published_at`: UTC time when publishing

### 7.4 Kafka Client

Creates the Kafka producer and publishes events.

**Topic**: `polymarket-events`

**Partition key**: `market_id` (all events for a market go to the same partition — ensures ordering)

### 7.5 Runner

Main async polling loop that orchestrates everything:

```
1. Get active subscriptions from SubscriptionManager
2. For each subscription:
   a. Fetch market snapshot from Polymarket API
   b. Run your conviction change detection logic
   c. If meaningful change detected: build event → publish to Kafka
   d. Update internal tracking state
   e. Rate limit delay
3. Wait for poll_interval_seconds
4. Repeat
```

**Must support:**
- Graceful shutdown via SIGINT/SIGTERM
- Error isolation (one subscription failure doesn't crash the service)
- Configurable poll interval

---

## 8. Kafka Integration

### Producer Configuration

```python
conf = {
    "bootstrap.servers": config.bootstrap_servers,
    "client.id": "polymarket-kafka-producer",
    "acks": "all",                    # Wait for all replicas
    "enable.idempotence": True,       # Exactly-once semantics
    "compression.type": "zstd",       # Zstandard compression
    "batch.num.messages": 10000,
    "linger.ms": 10,
    "queue.buffering.max.kbytes": 32768,
    "delivery.timeout.ms": 60000,
    "message.max.bytes": 5242880,
}
# Add SASL/SSL config for production (KAFKA_SECURITY_PROTOCOL != "PLAINTEXT")
```

### Topic

| Property | Value |
|----------|-------|
| Name | `polymarket-events` |
| With prefix | `{KAFKA_TOPIC_PREFIX}polymarket-events` |
| Partition key | `market_id` |
| Serialization | JSON (UTF-8) |
| Compression | zstd |

### Example Message

```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-01-15T14:30:00+00:00",
  "market_id": "0x1234abcd...",
  "question": "Will Bitcoin exceed $100k by end of 2025?",
  "yes_price": 0.72,
  "no_price": 0.28,
  "source": "polymarket-kafka",
  "published_at": "2025-01-15T14:30:01+00:00"
}
```

> The example above shows only the required fields. Your message will also contain conviction change fields from your design in Section 6.

---

## 9. Configuration

### Environment Variables

```bash
# Polymarket API
POLYMARKET_BASE_URL=https://clob.polymarket.com
POLYMARKET_REQUEST_TIMEOUT_SECONDS=30
POLYMARKET_RATE_LIMIT_DELAY_MS=200

# Kafka
KAFKA_BOOTSTRAP_SERVERS=localhost:9092
KAFKA_TOPIC=polymarket-events
KAFKA_TOPIC_PREFIX=               # Optional prefix for environments (e.g., "dev.")
KAFKA_SECURITY_PROTOCOL=PLAINTEXT # Use SASL_SSL for production
KAFKA_SASL_MECHANISMS=PLAIN
KAFKA_SASL_USERNAME=
KAFKA_SASL_PASSWORD=
KAFKA_CLIENT_ID=polymarket-kafka-producer

# MongoDB
MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=horizon
MONGODB_COLLECTION=polymarket_subscriptions
MONGODB_POLL_INTERVAL_SECONDS=60
MONGODB_COLLECTION_PREFIX=        # Optional prefix for environment isolation

# Polling
POLL_INTERVAL_SECONDS=30
ENVIRONMENT=dev
```

### Config Dataclasses

Configuration must be loaded from environment variables using Python dataclasses and `python-dotenv`.

```python
@dataclass
class PolymarketConfig:
    base_url: str = "https://clob.polymarket.com"
    request_timeout_seconds: int = 30
    rate_limit_delay_ms: int = 200

@dataclass
class KafkaConfig:
    bootstrap_servers: str
    topic: str
    security_protocol: str = "PLAINTEXT"
    sasl_mechanisms: str = "PLAIN"
    sasl_username: str = ""
    sasl_password: str = ""
    client_id: str = "polymarket-kafka-producer"

@dataclass
class MongoConfig:
    uri: str
    database: str
    collection: str = "polymarket_subscriptions"
    poll_interval_seconds: int = 60

@dataclass
class AppConfig:
    kafka: KafkaConfig
    polymarket: PolymarketConfig
    mongodb: MongoConfig
    environment: str = "dev"
    poll_interval_seconds: int = 30
```

---

## 10. Project Structure

```
polymarket-kafka/
├── src/
│   └── polymarket_kafka/
│       ├── __init__.py
│       ├── __main__.py              # Entry point: asyncio.run(runner.run())
│       ├── config.py                # AppConfig, KafkaConfig, PolymarketConfig, MongoConfig
│       ├── data_source.py           # Polymarket API client
│       ├── event_builder.py         # Build event dicts
│       ├── kafka_client.py          # Kafka producer setup + publish
│       ├── runner.py                # Main polling loop + conviction detection
│       └── subscription_manager.py  # MongoDB subscription management
├── tests/
│   ├── __init__.py
│   ├── test_data_source.py
│   ├── test_event_builder.py
│   ├── test_runner.py
│   └── test_subscription_manager.py
├── pyproject.toml
├── Dockerfile
├── app.env.example
└── README.md
```

### pyproject.toml

```toml
[project]
name = "polymarket-kafka"
version = "0.1.0"
description = "Polymarket conviction change to Kafka event streaming service"
readme = "README.md"
requires-python = ">=3.11"
dependencies = [
    "confluent-kafka>=2.3.0",
    "python-dotenv>=1.0.0",
    "pymongo>=4.6.0",
    "requests>=2.32.0",
    "certifi>=2024.0.0",
    "pydantic>=2.12",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0",
    "pytest-asyncio>=0.21.0",
    "pytest-cov>=4.0",
    "ruff>=0.1.0",
    "mypy>=1.7.0",
]

[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "W"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.mypy]
python_version = "3.11"
warn_return_any = true
warn_unused_ignores = true
```

---

## 11. Testing Requirements

### Coverage Threshold: **75%**

### Test Categories

| Test File | What to Test |
|-----------|-------------|
| `test_event_builder.py` | Event dict structure, UUID generation, field types, ISO timestamps |
| `test_data_source.py` | Polymarket API response parsing, error handling, timeout behavior (mock HTTP) |
| `test_subscription_manager.py` | MongoDB query mocking, subscription parsing, `ref_count` filtering |
| `test_runner.py` | Full poll cycle with mocked API + Kafka, conviction detection logic, deduplication, threshold behavior |

### Example Test Cases

```python
def test_build_event_has_required_fields():
    event = build_polymarket_event(...)  # your builder function

    assert event["event_id"]                        # UUID present
    assert event["source"] == "polymarket-kafka"
    assert event["published_at"]                    # timestamp present
    assert 0.0 <= event["yes_price"] <= 1.0

@pytest.mark.asyncio
async def test_no_publish_when_change_is_insignificant(runner, mock_api):
    """Small price movements should NOT trigger an event."""
    # Setup: previous price was 0.50, current is 0.51
    await runner._poll_and_publish()
    assert runner._producer.produce.call_count == 0

@pytest.mark.asyncio
async def test_publishes_on_significant_conviction_change(runner, mock_api):
    """Large price movements SHOULD trigger an event."""
    # Setup: previous price was 0.50, current is 0.65
    await runner._poll_and_publish()
    assert runner._producer.produce.call_count == 1
```

---

## 12. Acceptance Criteria

### Must Have

- [ ] `PolymarketEvent` Pydantic model with all required fields from Section 5
- [ ] `PolymarketSubscription` Pydantic model with `ref_count` pattern
- [ ] Subscription Manager that polls MongoDB for active subscriptions (`ref_count > 0`)
- [ ] Runner that polls Polymarket API for each active subscription
- [ ] Conviction change detection logic (your design — documented)
- [ ] Events published to Kafka topic `polymarket-events` with `market_id` as partition key
- [ ] Deduplication: avoids publishing redundant events
- [ ] Graceful shutdown (SIGINT/SIGTERM, flush Kafka, close MongoDB)
- [ ] Configuration via environment variables (dataclasses + `python-dotenv`)
- [ ] Tests with 75%+ coverage
- [ ] `subscribe()` and `unsubscribe()` helpers with atomic MongoDB `$inc` operations

### Should Have

- [ ] HTTP session with retry logic and configurable timeout
- [ ] Rate limiting between Polymarket API calls
- [ ] Structured logging with appropriate log levels
- [ ] Error isolation (one subscription failure doesn't crash the service)
- [ ] `app.env.example` with all environment variables documented
- [ ] README explaining your conviction detection design choices

### Nice to Have

- [ ] Health check endpoint (`/health`)
- [ ] Dockerfile
- [ ] Metrics / observability hooks
- [ ] `ruff` and `mypy` passing clean

---

## Getting Started

1. **Explore** the Polymarket CLOB API: https://docs.polymarket.com/
2. **Design** your conviction detection approach (Section 6) — this is where your thinking matters most
3. **Create** the project structure
4. **Implement** in this order:
   - `config.py` — dataclasses + env loading
   - `data_source.py` — Polymarket HTTP client
   - `event_builder.py` — build event dicts
   - `kafka_client.py` — producer setup + publish
   - `subscription_manager.py` — MongoDB polling + ref_count
   - `runner.py` — polling loop + conviction detection
   - `__main__.py` — entry point
5. **Write tests** alongside each component
6. **Document** your conviction detection design choices in the README

Good luck!