## polymarket-kafka – Implementation Task List

This file breaks the assignment into concrete tasks you can implement and track.

---

## 1. Project Setup

- [ ] **Initialize project structure**
  - [ ] Create `polymarket-kafka/` root (if not already present)
  - [ ] Create `src/polymarket_kafka/` package with `__init__.py`
  - [ ] Create `tests/` package with `__init__.py`
- [ ] **Add `pyproject.toml`**
  - [ ] Use the exact config specified in the assignment
  - [ ] Include runtime dependencies (`confluent-kafka`, `python-dotenv`, `pymongo`, `requests`, `certifi`, `pydantic`)
  - [ ] Include dev dependencies (`pytest`, `pytest-asyncio`, `pytest-cov`, `ruff`, `mypy`)
- [ ] **Create `README.md`**
  - [ ] Brief description of the service
  - [ ] High-level architecture overview
  - [ ] Section describing conviction detection design choices (will be filled after Section 6)
- [ ] **Create `app.env.example`**
  - [ ] List all env vars from Section 9 with sensible example values

---

## 2. Configuration (`config.py`)

- [ ] **Define config dataclasses**
  - [ ] `PolymarketConfig`
  - [ ] `KafkaConfig`
  - [ ] `MongoConfig`
  - [ ] `AppConfig`
- [ ] **Load from environment**
  - [ ] Implement helper function (e.g. `load_config()`) that:
    - [ ] Loads `.env` via `python-dotenv`
    - [ ] Reads the env vars defined in Section 9
    - [ ] Populates and returns `AppConfig`
- [ ] **Validation and defaults**
  - [ ] Ensure required fields (e.g. Kafka bootstrap servers, Mongo URI) are present
  - [ ] Apply default values where specified in the assignment

---

## 3. DTOs and Models

- [ ] **Define `PolymarketEvent` (Pydantic model)**
  - [ ] Include required fields:
    - [ ] `event_id: str`
    - [ ] `timestamp: datetime`
    - [ ] `market_id: str`
    - [ ] `question: str`
    - [ ] `yes_price: float`
    - [ ] `no_price: float`
    - [ ] `source: str` (must be `"polymarket-kafka"`)
    - [ ] `published_at: Optional[datetime]`
  - [ ] Add conviction-related fields (your design, see Section 6), e.g.:
    - [ ] Direction of conviction change
    - [ ] Magnitude (absolute and/or percentage)
    - [ ] Optional rolling metrics (e.g., from/to prices, window size)
  - [ ] Set `model_config = {"extra": "forbid", "frozen": True}`

- [ ] **Define `PolymarketSubscription` (Pydantic model)**
  - [ ] Include required fields:
    - [ ] `market_id: str`
    - [ ] `ref_count: int`
    - [ ] `created_at: Optional[datetime]`
    - [ ] `updated_at: Optional[datetime]`
  - [ ] Optionally add conviction configuration fields (per-market thresholds, etc.)
  - [ ] Implement methods:
    - [ ] `is_active() -> bool` (`return self.ref_count > 0`)
    - [ ] `subscription_key() -> str` (unique key, e.g. `market_id`)
  - [ ] Use `model_config = {"extra": "forbid"}`

- [ ] **Extend `SignalType` enum**
  - [ ] Add `POLYMARKET = "polymarket"` to the existing enum pattern

---

## 4. Polymarket Data Source (`data_source.py`)

- [ ] **Implement HTTP client wrapper**
  - [ ] Use `requests` (or `httpx` if desired, but keep simple) with:
    - [ ] Session pooling
    - [ ] Configurable timeouts from `PolymarketConfig`
    - [ ] Basic retry logic (e.g., retries on transient network errors or 5xx)
  - [ ] Respect `POLYMARKET_RATE_LIMIT_DELAY_MS` between calls
- [ ] **Implement data fetch methods**
  - [ ] Function to fetch a single market snapshot by `market_id` (condition_id)
  - [ ] Parse JSON into an internal structure that exposes:
    - [ ] `yes_price`
    - [ ] `no_price`
    - [ ] `volume`
    - [ ] `liquidity`
    - [ ] `question`
    - [ ] `active` / `closed` status
- [ ] **Error handling**
  - [ ] Handle HTTP errors, timeouts, and invalid responses
  - [ ] Return a well-defined error or `None` so the runner can decide what to do

---

## 5. Subscription Manager (`subscription_manager.py`)

- [ ] **MongoDB connection**
  - [ ] Use `pymongo` with `MongoConfig`
  - [ ] Use `MONGODB_COLLECTION` / `MONGODB_COLLECTION_PREFIX` settings
- [ ] **Active subscription polling**
  - [ ] Implement method to fetch all subscriptions with `ref_count > 0`
  - [ ] Parse documents into `PolymarketSubscription` instances
  - [ ] Poll at `MONGODB_POLL_INTERVAL_SECONDS` interval
- [ ] **Subscribe / Unsubscribe helpers**
  - [ ] Implement `subscribe(market_id: str, ...)` using atomic `$inc`:
    - [ ] `$inc: {"ref_count": 1}`
    - [ ] `$setOnInsert` for `created_at`
    - [ ] `$set` for `updated_at`
  - [ ] Implement `unsubscribe(market_id: str)` using atomic `$inc`:
    - [ ] `$inc: {"ref_count": -1}`
    - [ ] `$set` for `updated_at`

---

## 6. Conviction Change Detection Design & Logic (`runner.py` and/or dedicated module)

- [ ] **Design conviction detection approach**
  - [ ] Decide on:
    - [ ] Threshold type (absolute change, percentage change, or both)
    - [ ] Optional rolling window or rate-of-change logic
    - [ ] How (if at all) volume/liquidity affect the threshold
  - [ ] Document design choices clearly in `README.md`
- [ ] **Implement detection state tracking**
  - [ ] Track per-`market_id`:
    - [ ] Last seen YES/NO prices
    - [ ] Any rolling statistics needed (e.g., previous N prices, last event timestamp)
- [ ] **Implement detection function**
  - [ ] Function signature example:  
    - [ ] `detect_conviction_change(previous_state, current_snapshot, config) -> Optional[ConvictionChange]`
  - [ ] Return `None` when change is insignificant
  - [ ] Return structured object when significant change is detected, including:
    - [ ] Direction (toward YES or NO)
    - [ ] Magnitude
    - [ ] Any contextual information (e.g., baseline price, time since last event)
- [ ] **Handle edge cases**
  - [ ] First poll where no previous state exists
  - [ ] Market becomes inactive or closed
  - [ ] Oscillation around thresholds (e.g., add small hysteresis or cool-down)
  - [ ] API error / missing data (skip or mark as transient failure)

---

## 7. Event Builder (`event_builder.py`)

- [ ] **Build `PolymarketEvent` instances**
  - [ ] Function to build event from:
    - [ ] Market snapshot data
    - [ ] Conviction change object
    - [ ] `AppConfig` / environment context
  - [ ] Generate:
    - [ ] `event_id` (UUID)
    - [ ] `timestamp` (UTC when snapshot is taken)
    - [ ] `source` = `"polymarket-kafka"`
    - [ ] Conviction fields from detection output
  - [ ] `published_at` to be filled at the moment of Kafka publish (or immediately before)
- [ ] **Serialization**
  - [ ] Provide helper to convert `PolymarketEvent` to a JSON-serializable dict
  - [ ] Ensure all timestamps are ISO 8601 compatible

---

## 8. Kafka Client (`kafka_client.py`)

- [ ] **Create Kafka producer**
  - [ ] Use `confluent-kafka` with configuration from `KafkaConfig`
  - [ ] Apply recommended producer config from Section 8:
    - [ ] `acks="all"`
    - [ ] `enable.idempotence=True`
    - [ ] `compression.type="zstd"`
    - [ ] Other batching/timeout settings
  - [ ] Add SASL/SSL configuration when `security_protocol != "PLAINTEXT"`
- [ ] **Publish events**
  - [ ] Implement `publish(event: PolymarketEvent)`:
    - [ ] Serialize event dict to JSON UTF-8
    - [ ] Use topic `{KAFKA_TOPIC_PREFIX}{KAFKA_TOPIC}`
    - [ ] Partition key = `market_id`
    - [ ] Set `published_at` before sending
  - [ ] Provide graceful `flush()` method

---

## 9. Runner / Orchestration (`runner.py`)

- [ ] **Main async loop**
  - [ ] Periodically (every `POLL_INTERVAL_SECONDS`):
    - [ ] Fetch active subscriptions from `SubscriptionManager`
    - [ ] For each subscription:
      - [ ] Fetch current Polymarket snapshot from `data_source`
      - [ ] Run conviction detection logic
      - [ ] If significant change detected:
        - [ ] Build `PolymarketEvent`
        - [ ] Publish to Kafka
      - [ ] Update internal state for deduplication and history
      - [ ] Apply per-call rate limiting delay for API calls
- [ ] **Deduplication**
  - [ ] Maintain in-memory structure keyed by subscription key (e.g., `market_id`)
  - [ ] Avoid publishing if the new conviction state is equivalent to the last emitted one
- [ ] **Error isolation**
  - [ ] Catch and log errors per subscription
  - [ ] Ensure a single failing subscription does not stop the loop
- [ ] **Graceful shutdown**
  - [ ] Add signal handlers for `SIGINT`/`SIGTERM`
  - [ ] On shutdown:
    - [ ] Stop polling loop
    - [ ] Flush Kafka producer
    - [ ] Close MongoDB client

---

## 10. Entry Point (`__main__.py`)

- [ ] **Wire everything together**
  - [ ] Load configuration
  - [ ] Initialize:
    - [ ] MongoDB `SubscriptionManager`
    - [ ] Polymarket data source client
    - [ ] Kafka producer client
    - [ ] Runner instance
  - [ ] Use `asyncio.run(runner.run())` (or similar) as the main entry
  - [ ] Ensure logging is configured at startup

---

## 11. Testing (`tests/` package)

- [ ] **Set up test infrastructure**
  - [ ] Configure `pytest` and `pytest-asyncio` via `pyproject.toml`
  - [ ] Add fixtures for:
    - [ ] Mocked Polymarket API client
    - [ ] Mocked Kafka producer
    - [ ] Mocked MongoDB collection/client

- [ ] **`test_event_builder.py`**
  - [ ] Verify required fields exist in built events
  - [ ] Check UUID generation
  - [ ] Confirm `source == "polymarket-kafka"`
  - [ ] Validate timestamp formats and types
  - [ ] Verify conviction fields are populated correctly

- [ ] **`test_data_source.py`**
  - [ ] Mock HTTP responses from Polymarket API
  - [ ] Test successful parsing of market snapshots
  - [ ] Test retry behavior on transient errors
  - [ ] Test handling of timeouts and invalid responses

- [ ] **`test_subscription_manager.py`**
  - [ ] Test fetching active subscriptions (`ref_count > 0`)
  - [ ] Test `subscribe()` and `unsubscribe()` using atomic `$inc`
  - [ ] Verify `PolymarketSubscription` parsing and helper methods

- [ ] **`test_runner.py`**
  - [ ] Test that insignificant changes do NOT trigger Kafka publishes
  - [ ] Test that significant conviction changes DO trigger publishes
  - [ ] Test deduplication (no redundant events when state unchanged)
  - [ ] Test proper handling of API errors per subscription

- [ ] **Coverage**
  - [ ] Ensure `pytest --cov` reports at least **75%** coverage

---

## 12. Operational & Quality Tasks

- [ ] **Structured logging**
  - [ ] Use Python’s `logging` module with structured messages (market_id, event_id, etc.)
  - [ ] Log at appropriate levels (`INFO`, `WARNING`, `ERROR`)

- [ ] **Health & observability (optional / nice-to-have)**
  - [ ] Implement lightweight `/health` endpoint (if you add an HTTP server)
  - [ ] Add basic metrics hooks (e.g., counters for events sent, errors, API latency)

- [ ] **Static analysis & style**
  - [ ] Configure `ruff` according to `pyproject.toml`
  - [ ] Configure `mypy` and ensure type hints across modules
  - [ ] Run `ruff` and `mypy` and fix issues where practical

---

## 13. Final Acceptance Checklist (from assignment)

- [ ] `PolymarketEvent` model with required and conviction fields
- [ ] `PolymarketSubscription` model with `ref_count` pattern and helpers
- [ ] Subscription Manager polling MongoDB for `ref_count > 0`
- [ ] Runner polling Polymarket API per active subscription
- [ ] Conviction change detection implemented and documented
- [ ] Events published to Kafka `polymarket-events` with partition key `market_id`
- [ ] Deduplication to avoid redundant events
- [ ] Graceful shutdown (signals, Kafka flush, Mongo close)
- [ ] Configuration via env vars + dataclasses + `python-dotenv`
- [ ] Tests with ≥75% coverage
- [ ] `subscribe()` / `unsubscribe()` helpers with atomic `$inc`
- [ ] HTTP session with retries and timeouts
- [ ] Rate limiting between API calls
- [ ] Structured logging and error isolation
- [ ] `app.env.example` completed
- [ ] README updated with conviction detection design

