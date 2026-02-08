## polymarket-kafka – Implementation Task List

This file breaks the assignment into concrete tasks you can implement and track.

---

## 1. Project Setup

- [x] **Initialize project structure**
  - [x] Create `polymarket-kafka/` root (if not already present)
  - [x] Create `src/polymarket_kafka/` package with `__init__.py`
  - [x] Create `tests/` package with `__init__.py`
- [x] **Add `pyproject.toml`**
  - [x] Use the exact config specified in the assignment
  - [x] Include runtime dependencies (`confluent-kafka`, `python-dotenv`, `pymongo`, `requests`, `certifi`, `pydantic`)
  - [x] Include dev dependencies (`pytest`, `pytest-asyncio`, `pytest-cov`, `ruff`, `mypy`)
- [x] **Create `README.md`**
  - [x] Brief description of the service
  - [x] High-level architecture overview
  - [ ] Section describing conviction detection design choices (will be filled after Section 6)
- [x] **Create `app.env.example`**
  - [x] List all env vars from Section 9 with sensible example values

---

## 2. Configuration (`config.py`)

- [x] **Define config dataclasses**
  - [x] `PolymarketConfig`
  - [x] `KafkaConfig`
  - [x] `MongoConfig`
  - [x] `AppConfig`
- [x] **Load from environment**
  - [x] Implement helper function (e.g. `load_config()`) that:
    - [x] Loads `.env` via `python-dotenv`
    - [x] Reads the env vars defined in Section 9
    - [x] Populates and returns `AppConfig`
- [x] **Validation and defaults**
  - [x] Ensure required fields (e.g. Kafka bootstrap servers, Mongo URI) are present
  - [x] Apply default values where specified in the assignment

---

## 3. DTOs and Models

- [x] **Define `PolymarketEvent` (Pydantic model)**
  - [x] Include required fields:
    - [x] `event_id: str`
    - [x] `timestamp: datetime`
    - [x] `market_id: str`
    - [x] `question: str`
    - [x] `yes_price: float`
    - [x] `no_price: float`
    - [x] `source: str` (must be `"polymarket-kafka"`)
    - [x] `published_at: Optional[datetime]`
  - [x] Add conviction-related fields (your design, see Section 6), e.g.:
    - [x] Direction of conviction change
    - [x] Magnitude (absolute and/or percentage)
    - [x] Optional rolling metrics (e.g., from/to prices, window size)
  - [x] Set `model_config = {"extra": "forbid", "frozen": True}`

- [x] **Define `PolymarketSubscription` (Pydantic model)**
  - [x] Include required fields:
    - [x] `market_id: str`
    - [x] `ref_count: int`
    - [x] `created_at: Optional[datetime]`
    - [x] `updated_at: Optional[datetime]`
  - [x] Optionally add conviction configuration fields (per-market thresholds, etc.)
  - [x] Implement methods:
    - [x] `is_active() -> bool` (`return self.ref_count > 0`)
    - [x] `subscription_key() -> str` (unique key, e.g. `market_id`)
  - [x] Use `model_config = {"extra": "forbid"}`

- [x] **Extend `SignalType` enum**
  - [x] Add `POLYMARKET = "polymarket"` to the existing enum pattern

---

## 4. Polymarket Data Source (`data_source.py`)

- [x] **Implement HTTP client wrapper**
  - [x] Use `requests` (or `httpx` if desired, but keep simple) with:
    - [x] Session pooling
    - [x] Configurable timeouts from `PolymarketConfig`
    - [x] Basic retry logic (e.g., retries on transient network errors or 5xx)
  - [x] Respect `POLYMARKET_RATE_LIMIT_DELAY_MS` between calls
- [x] **Implement data fetch methods**
  - [x] Function to fetch a single market snapshot by `market_id` (condition_id)
  - [x] Parse JSON into an internal structure that exposes:
    - [x] `yes_price`
    - [x] `no_price`
    - [x] `volume`
    - [x] `liquidity`
    - [x] `question`
    - [x] `active` / `closed` status
- [x] **Error handling**
  - [x] Handle HTTP errors, timeouts, and invalid responses
  - [x] Return a well-defined error or `None` so the runner can decide what to do

---

## 5. Subscription Manager (`subscription_manager.py`)

- [x] **MongoDB connection**
  - [x] Use `pymongo` with `MongoConfig`
  - [x] Use `MONGODB_COLLECTION` / `MONGODB_COLLECTION_PREFIX` settings
- [x] **Active subscription polling**
  - [x] Implement method to fetch all subscriptions with `ref_count > 0`
  - [x] Parse documents into `PolymarketSubscription` instances
  - [ ] Poll at `MONGODB_POLL_INTERVAL_SECONDS` interval
- [x] **Subscribe / Unsubscribe helpers**
  - [x] Implement `subscribe(market_id: str, ...)` using atomic `$inc`:
    - [x] `$inc: {"ref_count": 1}`
    - [x] `$setOnInsert` for `created_at`
    - [x] `$set` for `updated_at`
  - [x] Implement `unsubscribe(market_id: str)` using atomic `$inc`:
    - [x] `$inc: {"ref_count": -1}`
    - [x] `$set` for `updated_at`

---

## 6. Conviction Change Detection Design & Logic (`runner.py` and/or dedicated module)

- [x] **Design conviction detection approach**
  - [x] Decide on:
    - [x] Threshold type (absolute change, percentage change, or both)
    - [x] Optional rolling window or rate-of-change logic
    - [x] How (if at all) volume/liquidity affect the threshold
  - [x] Document design choices clearly in `README.md`
- [x] **Implement detection state tracking**
  - [x] Track per-`market_id`:
    - [x] Last seen YES/NO prices
    - [x] Any rolling statistics needed (e.g., previous N prices, last event timestamp)
- [x] **Implement detection function**
  - [x] Function signature example:  
    - [x] `detect_conviction_change(previous_state, current_snapshot, config) -> Optional[ConvictionChange]`
  - [x] Return `None` when change is insignificant
  - [x] Return structured object when significant change is detected, including:
    - [x] Direction (toward YES or NO)
    - [x] Magnitude
    - [x] Any contextual information (e.g., baseline price, time since last event)
- [x] **Handle edge cases**
  - [x] First poll where no previous state exists
  - [x] Market becomes inactive or closed
  - [x] Oscillation around thresholds (e.g., add small hysteresis or cool-down)
  - [x] API error / missing data (skip or mark as transient failure)

---

## 7. Event Builder (`event_builder.py`)

- [x] **Build `PolymarketEvent` instances**
  - [x] Function to build event from:
    - [x] Market snapshot data
    - [x] Conviction change object
    - [x] `AppConfig` / environment context
  - [x] Generate:
    - [x] `event_id` (UUID)
    - [x] `timestamp` (UTC when snapshot is taken)
    - [x] `source` = `"polymarket-kafka"`
    - [x] Conviction fields from detection output
  - [x] `published_at` to be filled at the moment of Kafka publish (or immediately before)
- [x] **Serialization**
  - [x] Provide helper to convert `PolymarketEvent` to a JSON-serializable dict
  - [x] Ensure all timestamps are ISO 8601 compatible

---

## 8. Kafka Client (`kafka_client.py`)

- [x] **Create Kafka producer**
  - [x] Use `confluent-kafka` with configuration from `KafkaConfig`
  - [x] Apply recommended producer config from Section 8:
    - [x] `acks="all"`
    - [x] `enable.idempotence=True`
    - [x] `compression.type="zstd"`
    - [x] Other batching/timeout settings
  - [x] Add SASL/SSL configuration when `security_protocol != "PLAINTEXT"`
- [x] **Publish events**
  - [x] Implement `publish(event: PolymarketEvent)`:
    - [x] Serialize event dict to JSON UTF-8
    - [x] Use topic `{KAFKA_TOPIC_PREFIX}{KAFKA_TOPIC}`
    - [x] Partition key = `market_id`
    - [x] Set `published_at` before sending
  - [x] Provide graceful `flush()` method

---

## 9. Runner / Orchestration (`runner.py`)

- [x] **Main async loop**
  - [x] Periodically (every `POLL_INTERVAL_SECONDS`):
    - [x] Fetch active subscriptions from `SubscriptionManager`
    - [x] For each subscription:
      - [x] Fetch current Polymarket snapshot from `data_source`
      - [x] Run conviction detection logic
      - [x] If significant change detected:
        - [x] Build `PolymarketEvent`
        - [x] Publish to Kafka
      - [x] Update internal state for deduplication and history
      - [x] Apply per-call rate limiting delay for API calls
- [x] **Deduplication**
  - [x] Maintain in-memory structure keyed by subscription key (e.g., `market_id`)
  - [x] Avoid publishing if the new conviction state is equivalent to the last emitted one
- [x] **Error isolation**
  - [x] Catch and log errors per subscription
  - [x] Ensure a single failing subscription does not stop the loop
- [x] **Graceful shutdown**
  - [x] Add signal handlers for `SIGINT`/`SIGTERM`
  - [x] On shutdown:
    - [x] Stop polling loop
    - [x] Flush Kafka producer
    - [x] Close MongoDB client

---

## 10. Entry Point (`__main__.py`)

- [x] **Wire everything together**
  - [x] Load configuration
  - [x] Initialize:
    - [x] MongoDB `SubscriptionManager`
    - [x] Polymarket data source client
    - [x] Kafka producer client
    - [x] Runner instance
  - [x] Use `asyncio.run(runner.run())` (or similar) as the main entry
  - [x] Ensure logging is configured at startup

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

- [x] **Structured logging**
  - [x] Use Python’s `logging` module with structured messages (market_id, event_id, etc.)
  - [x] Log at appropriate levels (`INFO`, `WARNING`, `ERROR`)

- [ ] **Health & observability (optional / nice-to-have)**
  - [ ] Implement lightweight `/health` endpoint (if you add an HTTP server)
  - [ ] Add basic metrics hooks (e.g., counters for events sent, errors, API latency)

- [ ] **Static analysis & style**
  - [ ] Configure `ruff` according to `pyproject.toml`
  - [ ] Configure `mypy` and ensure type hints across modules
  - [ ] Run `ruff` and `mypy` and fix issues where practical

---

## 14. Docker & Compose

- [x] **Dockerfile**
  - [x] Build Python 3.11 image
  - [x] Install project from `pyproject.toml`
  - [x] Set default environment variables for Kafka and Mongo
- [x] **docker-compose.yml**
  - [x] Start Zookeeper + Kafka
  - [x] Start MongoDB
  - [x] Start `polymarket-kafka` service wired to Kafka and Mongo

---

## 13. Final Acceptance Checklist (from assignment)

- [x] `PolymarketEvent` model with required and conviction fields
- [x] `PolymarketSubscription` model with `ref_count` pattern and helpers
- [ ] Subscription Manager polling MongoDB for `ref_count > 0`
- [ ] Runner polling Polymarket API per active subscription
- [ ] Conviction change detection implemented and documented
- [ ] Events published to Kafka `polymarket-events` with partition key `market_id`
- [ ] Deduplication to avoid redundant events
- [ ] Graceful shutdown (signals, Kafka flush, Mongo close)
- [x] Configuration via env vars + dataclasses + `python-dotenv`
- [ ] Tests with ≥75% coverage
- [ ] `subscribe()` / `unsubscribe()` helpers with atomic `$inc`
- [x] HTTP session with retries and timeouts
- [x] Rate limiting between API calls
- [ ] Structured logging and error isolation
- [x] `app.env.example` completed
- [ ] README updated with conviction detection design