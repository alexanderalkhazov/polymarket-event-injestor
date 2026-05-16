# eventedge-ai — full system specification

This document is the single source of truth for the eventedge-ai system.
It supersedes all previous versions. Read it fully before writing any code.

---

## What this system does

A real-time algorithmic trading intelligence platform that:
1. Ingests multiple data sources continuously (Polymarket, news, price, options, macro, social)
2. Normalizes all data into a time-indexed feature store — one row per symbol per hour
3. Scores feature rows against a trained XGBoost model to produce trade predictions
4. Validates predictions against named, backtested hypotheses before escalating
5. Uses Claude to generate plain-English narrative for surviving predictions
6. Delivers personalized strategies to users via SSE
7. Executes paper or live trades via Alpaca on user confirmation

Claude is NOT the signal detector. Claude is NOT the decision maker.
The scoring model makes decisions. Claude explains them.

---

## Architecture overview

```
DATA SOURCES
  Polymarket API    → polymarket-producer  ─┐
  Finnhub API       → news-producer        ─┤
  yfinance          → analytics-producer   ─┼─→ Redpanda (raw.* topics)
  Options APIs      → options-producer     ─┤
  FRED API          → (nightly batch)      ─┘

STREAM PROCESSING
  Redpanda → consumers (detect + write raw_* tables)
           → feature-builder (hourly snapshots → features table)
           → label-filler (nightly → fills forward_return_Nd)

PREDICTION PIPELINE
  features table
    → rule-based scorer (placeholder until model trained)
    → XGBoost model (replaces placeholder after 90d of labeled data)
    → hypothesis gate (win_rate ≥ 55%, n ≥ 30, confidence ≥ 0.65)
    → Claude (narrative only — summary, thesis, risk_note)
    → strategy builder (per-user sizing)
    → Redis pub/sub
    → Next.js SSE
    → user browser

EXECUTION
  user confirms → POST /api/trades → Alpaca paper or live order

DATABASES
  PostgreSQL (app DB, port 5432)
    users, subscriptions, signals, opportunities,
    hypotheses, backtest_results, strategies, trades, positions
    extension: pgvector (semantic search on signals + opportunities)

  TimescaleDB (historical DB, port 5433)
    raw_polymarket, raw_news, raw_ohlcv, raw_options, raw_macro
    features (the feature store — wide table, hypertable)
    technicals (pre-computed indicators)

ADMIN
  pgAdmin (port 5050) — connected to both databases on boot

ML TRAINING (NOT in Docker)
  runs locally: python src/ml/train.py
  connects to TimescaleDB via localhost:5433
  saves model to ./models/scoring_model.json
  mounted read-only into ai-correlator container
```

---

## Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Message broker | Redpanda (Confluent-compatible) | Replaces Kafka + Zookeeper. Single binary, native ARM, 512 MB cap |
| App database | PostgreSQL 16 + pgvector | Signals, users, strategies, trades. pgvector for semantic search |
| Historical database | PostgreSQL 16 + TimescaleDB | Feature store, OHLCV, macro. Hypertables + compression |
| Cache / pub-sub | Redis 7 | SSE fan-out to connected browser clients |
| DB admin UI | pgAdmin 4 | Both databases pre-connected via servers.json |
| Python services | Python 3.11, asyncpg, confluent-kafka | All producers, consumers, correlator, feature builder |
| AI narrative | Anthropic Claude API (claude-sonnet-4-20250514) | Narrative only — receives structured prediction, outputs JSON |
| Embeddings | OpenAI text-embedding-3-small | Signal and opportunity embeddings for pgvector search |
| Scoring model | XGBoost / LightGBM | Trained locally, mounted into correlator container |
| ML explainability | SHAP | Per-feature contribution scores fed to Claude prompt |
| Historical ingest | yfinance, fredapi, pandas-ta | Nightly batch outside market hours |
| Frontend | Next.js 14 App Router + TypeScript | Replaces React+Vite + Express BFF. API routes = BFF |
| Auth | NextAuth.js v5 (Credentials, JWT) | No OAuth in v1 |
| Charts | Recharts | OHLCV with technicals, backtest entry markers |
| Forms | React Hook Form + Zod | Onboarding, settings, subscriptions |
| Execution | Alpaca Trade API | Paper mode default. User provides own API keys |
| Monitoring | Prometheus + Grafana | Optional — separate docker-compose.monitoring.yml |

---

## Deployment architecture

### Recommended: hybrid (local + cloud)

MacBook Air M1 runs the real-time pipeline locally.
A small cloud VPS (Hetzner CX21, ~€4/month) runs TimescaleDB and nightly batch jobs.
ML training runs in local Python, outside Docker, connecting to VPS TimescaleDB.

```
MacBook Air (Docker Compose, ~2 GB RAM, ~15 GB disk)
  redpanda, postgres, redis, pgadmin
  nextjs, all producers, all consumers, ai-correlator

Hetzner CX21 (2 vCPU, 4 GB RAM, 40 GB disk, ~€4/mo)
  timescaledb (full 2yr history, all symbols)
  feature-builder (hourly cron)
  label-filler (nightly cron)
  historical-ingestor (nightly cron)

Local Python (not in Docker)
  src/ml/train.py — weekly retrain
  connects to TimescaleDB at VPS_IP:5433
  saves ./models/scoring_model.json
```

### Alternative: fully local

Everything on MacBook. Limit TimescaleDB to 6 months history, 5 symbols.
Enable TimescaleDB compression aggressively.
Docker Desktop: 10 GB RAM, 60 GB disk image cap, VirtioFS enabled.

---

## Docker Compose services

```yaml
version: "3.9"

services:
  redpanda:
    image: redpandadata/redpanda:latest
    platform: linux/arm64
    command:
      - redpanda start
      - --smp 1
      - --memory 512M
      - --overprovisioned
      - --node-id 0
      - --kafka-addr PLAINTEXT://0.0.0.0:9092
      - --advertise-kafka-addr PLAINTEXT://redpanda:9092
    ports: ["9092:9092", "9644:9644"]
    volumes: [redpanda_data:/var/lib/redpanda/data]

  redpanda-console:
    image: redpandadata/console:latest
    platform: linux/arm64
    ports: ["8080:8080"]
    environment: {KAFKA_BROKERS: redpanda:9092}
    depends_on: [redpanda]

  postgres:
    image: postgres:16-alpine
    platform: linux/arm64
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: eventedge
    ports: ["5432:5432"]
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/app_schema.sql:/docker-entrypoint-initdb.d/01_schema.sql
    command: postgres -c shared_buffers=128MB -c max_connections=20

  timescale:
    image: timescale/timescaledb:latest-pg16
    platform: linux/arm64
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: market_history
    ports: ["5433:5432"]
    volumes:
      - timescale_data:/var/lib/postgresql/data
      - ./db/history_schema.sql:/docker-entrypoint-initdb.d/01_schema.sql
    command: postgres -c shared_buffers=256MB -c max_connections=20

  redis:
    image: redis:7-alpine
    platform: linux/arm64
    ports: ["6379:6379"]
    volumes: [redis_data:/data]

  pgadmin:
    image: dpage/pgadmin4:latest
    platform: linux/amd64
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@local.dev
      PGADMIN_DEFAULT_PASSWORD: admin
      PGADMIN_CONFIG_SERVER_MODE: "False"
      PGADMIN_CONFIG_MASTER_PASSWORD_REQUIRED: "False"
    ports: ["5050:80"]
    volumes:
      - pgadmin_data:/var/lib/pgadmin
      - ./pgadmin/servers.json:/pgadmin4/servers.json:ro

  nextjs:
    build: {context: src/web, dockerfile: Dockerfile}
    platform: linux/arm64
    ports: ["3000:3000"]
    env_file: env/nextjs.env
    depends_on: [postgres, redis]

  polymarket-producer:
    build: {context: ., dockerfile: Dockerfile}
    platform: linux/arm64
    command: python -m src.event_detectors.polymarket_producer
    env_file: env/python.env
    depends_on: [redpanda, postgres]
    restart: unless-stopped

  news-producer:
    build: {context: ., dockerfile: Dockerfile}
    platform: linux/arm64
    command: python -m src.event_detectors.news_producer
    env_file: env/python.env
    depends_on: [redpanda, postgres]
    restart: unless-stopped

  analytics-producer:
    build: {context: ., dockerfile: Dockerfile}
    platform: linux/arm64
    command: python -m src.event_detectors.analytics_producer
    env_file: env/python.env
    depends_on: [redpanda, postgres]
    restart: unless-stopped

  polymarket-consumer:
    build: {context: ., dockerfile: Dockerfile}
    platform: linux/arm64
    command: python -m src.event_processors.polymarket_consumer
    env_file: env/python.env
    depends_on: [redpanda, postgres, timescale]
    restart: unless-stopped

  news-consumer:
    build: {context: ., dockerfile: Dockerfile}
    platform: linux/arm64
    command: python -m src.event_processors.news_consumer
    env_file: env/python.env
    depends_on: [redpanda, postgres, timescale]
    restart: unless-stopped

  analytics-consumer:
    build: {context: ., dockerfile: Dockerfile}
    platform: linux/arm64
    command: python -m src.event_processors.analytics_consumer
    env_file: env/python.env
    depends_on: [redpanda, postgres, timescale]
    restart: unless-stopped

  feature-builder:
    build: {context: ., dockerfile: Dockerfile}
    platform: linux/arm64
    command: python -m src.feature_store.scheduler
    env_file: env/python.env
    depends_on: [postgres, timescale]
    restart: unless-stopped

  ai-correlator:
    build: {context: ., dockerfile: Dockerfile}
    platform: linux/arm64
    command: python -m src.ai_correlator.correlator
    env_file: env/python.env
    volumes:
      - ./models:/app/models:ro
    depends_on: [postgres, timescale, redis]
    restart: unless-stopped

volumes:
  redpanda_data:
  postgres_data:
  timescale_data:
  redis_data:
  pgadmin_data:
```

### pgadmin/servers.json

```json
{
  "Servers": {
    "1": {
      "Name": "App DB (signals, users, trades)",
      "Group": "eventedge",
      "Host": "postgres",
      "Port": 5432,
      "Username": "postgres",
      "SSLMode": "prefer",
      "MaintenanceDB": "eventedge"
    },
    "2": {
      "Name": "Historical DB (features, OHLCV)",
      "Group": "eventedge",
      "Host": "timescale",
      "Port": 5432,
      "Username": "postgres",
      "SSLMode": "prefer",
      "MaintenanceDB": "market_history"
    }
  }
}
```

---

## Kafka topics (Redpanda)

Producers write only to raw.* topics.
Consumers read from raw.* topics, detect, and write to PostgreSQL signals table.
The ai-correlator is triggered via Redis, not a Kafka topic.

```
raw.polymarket        # raw market snapshots — YES price, volume
raw.news              # raw articles — headline, sentiment, source
raw.analytics         # raw OHLCV + options data
```

---

## Producer pattern — dumb, stateless, just fetch and publish

Producers do zero detection. Zero state. Zero scoring.
They poll their API, normalize to a common envelope, and publish to Redpanda.
Detection logic lives entirely in consumers.

```python
# Example: polymarket_producer/producer.py
class PolymarketProducer:
    async def run(self):
        while True:
            markets = await self.fetch_subscribed_markets()
            for market in markets:
                raw = await self.polymarket_api.get_market(market.symbol)
                self.kafka.produce(
                    "raw.polymarket",
                    key=market.symbol,
                    value=json.dumps({
                        "ts": datetime.utcnow().isoformat(),
                        "symbol": market.symbol,
                        "market_id": market.id,
                        "yes_price": raw["yes_price"],
                        "volume_24h": raw["volume_24h"],
                    })
                )
            await asyncio.sleep(30)
```

---

## Consumer pattern — smart, stateful, detection lives here

Consumers read raw events, run detection algorithms, write to raw_* tables in
TimescaleDB, write signal records to PostgreSQL, and notify the correlator via Redis.

Your existing detection algorithms (conviction.py, signal_detector.py) are preserved
and moved into the consumer classes. They are NOT in the producers.

```python
# Example: polymarket_consumer/consumer.py
class PolymarketConsumer:
    def __init__(self):
        self.detector = ConvictionDetector()  # moved from producer
        self.state: dict[str, ConvictionState] = {}

    async def process(self, msg: dict):
        symbol = msg["symbol"]

        # 1. write raw event to TimescaleDB
        await self.tsdb.execute(
            """INSERT INTO raw_polymarket (ts, market_id, symbol, yes_price, volume_24h)
               VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING""",
            msg["ts"], msg["market_id"], symbol, msg["yes_price"], msg["volume_24h"]
        )

        # 2. run detection
        prev = self.state.get(symbol)
        signal = self.detector.evaluate(msg, prev)
        self.state[symbol] = ConvictionState(price=msg["yes_price"])

        if signal:
            # 3. write signal to PostgreSQL app DB
            saved = await self.db.fetchrow(
                """INSERT INTO signals (source, symbol, type, score, direction, payload)
                   VALUES ($1,$2,$3,$4,$5,$6) RETURNING id""",
                "polymarket", symbol, signal.type, signal.score,
                signal.direction, json.dumps(signal.payload)
            )
            # 4. notify correlator
            await self.redis.publish("new_signal", json.dumps({"signal_id": str(saved["id"])}))

# ConvictionDetector — unchanged algorithm from your original conviction.py
class ConvictionDetector:
    def evaluate(self, event: dict, state: ConvictionState | None) -> Signal | None:
        if state is None:
            return None
        delta = event["yes_price"] - state.price
        rel   = abs(delta) / state.price if state.price else 0
        if abs(delta) >= 0.10 or rel >= 0.20:
            return Signal(
                source="polymarket", symbol=event["symbol"],
                type="conviction_shift", score=abs(delta),
                direction="yes" if delta > 0 else "no",
                payload=event,
            )
        return None
```

---

## App DB schema (PostgreSQL + pgvector)

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             TEXT UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,
  risk_level        TEXT NOT NULL DEFAULT 'moderate'
                      CHECK (risk_level IN ('conservative', 'moderate', 'aggressive')),
  max_position_pct  NUMERIC NOT NULL DEFAULT 0.05,
  markets           TEXT[] NOT NULL DEFAULT '{}',
  alpaca_key_id     TEXT,
  alpaca_secret     TEXT,
  is_paper          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE subscriptions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source     TEXT NOT NULL CHECK (source IN ('polymarket', 'news', 'analytics')),
  symbol     TEXT NOT NULL,
  threshold  NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, source, symbol)
);

CREATE TABLE signals (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source     TEXT NOT NULL CHECK (source IN ('polymarket', 'news', 'analytics')),
  symbol     TEXT NOT NULL,
  type       TEXT NOT NULL,
  score      NUMERIC NOT NULL,
  direction  TEXT,
  payload    JSONB NOT NULL DEFAULT '{}',
  embedding  vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX signals_created_at    ON signals (created_at DESC);
CREATE INDEX signals_source_symbol ON signals (source, symbol);
CREATE INDEX signals_embedding_idx ON signals
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Named, versioned trading hypotheses
CREATE TABLE hypotheses (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT UNIQUE NOT NULL,
  description           TEXT NOT NULL,
  feature_conditions    JSONB NOT NULL,
  invalidation_conditions JSONB,
  target_symbol         TEXT,
  direction             TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  hold_days             INT NOT NULL DEFAULT 5,
  confidence_threshold  NUMERIC NOT NULL DEFAULT 0.65,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  version               INT NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backtest results for each hypothesis run
CREATE TABLE backtest_results (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hypothesis_id      UUID REFERENCES hypotheses(id),
  signal_ids         UUID[],
  strategy_name      TEXT NOT NULL,
  symbol             TEXT NOT NULL,
  lookback_days      INT NOT NULL DEFAULT 730,
  sample_size        INT NOT NULL,
  win_rate           NUMERIC NOT NULL,
  avg_return_pct     NUMERIC NOT NULL,
  median_return_pct  NUMERIC NOT NULL,
  sharpe             NUMERIC,
  max_drawdown_pct   NUMERIC,
  expectancy         NUMERIC NOT NULL,
  passed             BOOLEAN NOT NULL,
  drop_reason        TEXT,
  payload            JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AI-identified opportunities (only backtest-validated ones reach here)
CREATE TABLE opportunities (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hypothesis_id       UUID REFERENCES hypotheses(id),
  signal_ids          UUID[] NOT NULL,
  backtest_id         UUID REFERENCES backtest_results(id),
  model_confidence    NUMERIC NOT NULL,
  summary             TEXT NOT NULL,
  thesis              TEXT NOT NULL,
  risk_note           TEXT,
  historical_note     TEXT,
  action              TEXT NOT NULL CHECK (action IN ('buy', 'sell', 'watch')),
  tickers             TEXT[] NOT NULL DEFAULT '{}',
  expected_return_pct NUMERIC,
  hold_days           INT,
  stop_loss_pct       NUMERIC,
  top_features        JSONB,     -- SHAP values from scoring model
  macro_snapshot      JSONB,
  embedding           vector(1536),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX opportunities_embedding_idx ON opportunities
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE TABLE strategies (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id   UUID NOT NULL REFERENCES opportunities(id),
  sizing_usd       NUMERIC,
  sizing_pct       NUMERIC,
  stop_loss_pct    NUMERIC NOT NULL DEFAULT 0.03,
  take_profit_pct  NUMERIC,
  rationale        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'executed', 'dismissed', 'expired')),
  delivered_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE trades (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id      UUID REFERENCES strategies(id),
  alpaca_order_id  TEXT,
  symbol           TEXT NOT NULL,
  side             TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  qty              NUMERIC NOT NULL,
  fill_price       NUMERIC,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','submitted','filled','cancelled','rejected')),
  is_paper         BOOLEAN NOT NULL DEFAULT TRUE,
  pnl_usd          NUMERIC,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filled_at        TIMESTAMPTZ
);

CREATE TABLE positions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol       TEXT NOT NULL,
  qty          NUMERIC NOT NULL,
  avg_cost     NUMERIC NOT NULL,
  is_paper     BOOLEAN NOT NULL DEFAULT TRUE,
  opened_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at    TIMESTAMPTZ,
  realized_pnl NUMERIC,
  UNIQUE (user_id, symbol, is_paper)
);
```

---

## Historical DB schema (TimescaleDB)

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Raw source tables (append-only, used to recompute features)
CREATE TABLE raw_polymarket (
  ts         TIMESTAMPTZ NOT NULL,
  market_id  TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  yes_price  NUMERIC NOT NULL,
  volume_24h NUMERIC,
  PRIMARY KEY (ts, market_id)
);
SELECT create_hypertable('raw_polymarket', 'ts');

CREATE TABLE raw_news (
  ts              TIMESTAMPTZ NOT NULL,
  article_id      TEXT NOT NULL,
  symbol          TEXT NOT NULL,
  headline        TEXT NOT NULL,
  sentiment_score NUMERIC,
  hotness         NUMERIC,
  source          TEXT,
  PRIMARY KEY (ts, article_id)
);
SELECT create_hypertable('raw_news', 'ts');

CREATE TABLE raw_ohlcv (
  ts       TIMESTAMPTZ NOT NULL,
  symbol   TEXT NOT NULL,
  interval TEXT NOT NULL CHECK (interval IN ('1h', '1d')),
  open     NUMERIC,
  high     NUMERIC,
  low      NUMERIC,
  close    NUMERIC NOT NULL,
  volume   BIGINT NOT NULL,
  PRIMARY KEY (ts, symbol, interval)
);
SELECT create_hypertable('raw_ohlcv', 'ts');
CREATE INDEX raw_ohlcv_symbol ON raw_ohlcv (symbol, ts DESC);

CREATE TABLE raw_options (
  ts             TIMESTAMPTZ NOT NULL,
  symbol         TEXT NOT NULL,
  put_volume     BIGINT,
  call_volume    BIGINT,
  unusual_sweeps INT DEFAULT 0,
  PRIMARY KEY (ts, symbol)
);
SELECT create_hypertable('raw_options', 'ts');

CREATE TABLE raw_macro (
  ts        TIMESTAMPTZ NOT NULL,
  series_id TEXT NOT NULL,
  value     NUMERIC NOT NULL,
  PRIMARY KEY (ts, series_id)
);
SELECT create_hypertable('raw_macro', 'ts');

-- THE FEATURE STORE — one row per symbol per hour, every known feature
CREATE TABLE features (
  ts                        TIMESTAMPTZ NOT NULL,
  symbol                    TEXT NOT NULL,

  -- Polymarket features
  poly_yes_price            NUMERIC,
  poly_conviction_delta_1h  NUMERIC,
  poly_conviction_delta_4h  NUMERIC,
  poly_volume_24h           NUMERIC,

  -- News features
  news_sentiment_1h         NUMERIC,
  news_sentiment_4h         NUMERIC,
  news_hotness_peak_4h      NUMERIC,
  news_article_count_4h     INT,

  -- Price / technical features
  rsi_14                    NUMERIC,
  macd_histogram            NUMERIC,
  atr_14                    NUMERIC,
  bb_position               NUMERIC,
  sma_20_slope              NUMERIC,
  vol_ratio_30d             NUMERIC,
  price_change_1d           NUMERIC,
  price_change_5d           NUMERIC,

  -- Options features
  put_call_ratio            NUMERIC,
  unusual_sweep_count_4h    INT,

  -- Macro features (latest available as of ts)
  vix_level                 NUMERIC,
  wti_crude                 NUMERIC,
  us_10y_yield              NUMERIC,
  fed_funds_rate            NUMERIC,
  usd_index                 NUMERIC,

  -- Social features
  social_sentiment_z        NUMERIC,

  -- Outcome labels (filled nightly for rows >= hold_days old)
  forward_return_1d         NUMERIC,
  forward_return_5d         NUMERIC,
  forward_return_10d        NUMERIC,
  label_filled_at           TIMESTAMPTZ,

  PRIMARY KEY (ts, symbol)
);
SELECT create_hypertable('features', 'ts');
CREATE INDEX features_symbol     ON features (symbol, ts DESC);
CREATE INDEX features_unlabeled  ON features (ts) WHERE forward_return_5d IS NULL;

-- Enable compression (saves ~90% disk on historical data)
ALTER TABLE features SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol'
);
SELECT add_compression_policy('features', INTERVAL '7 days');

ALTER TABLE raw_ohlcv SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol'
);
SELECT add_compression_policy('raw_ohlcv', INTERVAL '7 days');
```

---

## Feature store builder

Runs hourly. Writes one feature row per symbol using as-of queries.
Critical rule: every feature value must use only data available at or before ts.
No lookahead. Ever.

```python
# src/feature_store/builder.py
SYMBOLS = ["USO", "XOM", "SPY", "QQQ", "GLD", "TLT", "LNG", "XLE"]
DEV_SYMBOLS = ["USO", "SPY", "QQQ"]  # use when DEV_MODE=true

class FeatureBuilder:
    async def build_snapshot(self, symbol: str, ts: datetime) -> dict:
        features = {"ts": ts, "symbol": symbol}
        features.update(await self._poly_features(symbol, ts))
        features.update(await self._news_features(symbol, ts))
        features.update(await self._price_features(symbol, ts))
        features.update(await self._options_features(symbol, ts))
        features.update(await self._macro_features(ts))
        return features

    async def _poly_features(self, symbol, ts):
        # as-of query: latest yes_price at or before ts
        current = await self.tsdb.fetchval(
            "SELECT yes_price FROM raw_polymarket WHERE symbol=$1 AND ts<=$2 ORDER BY ts DESC LIMIT 1",
            symbol, ts
        )
        prev_1h = await self.tsdb.fetchval(
            "SELECT yes_price FROM raw_polymarket WHERE symbol=$1 AND ts<=$2-INTERVAL '1 hour' ORDER BY ts DESC LIMIT 1",
            symbol, ts
        )
        prev_4h = await self.tsdb.fetchval(
            "SELECT yes_price FROM raw_polymarket WHERE symbol=$1 AND ts<=$2-INTERVAL '4 hours' ORDER BY ts DESC LIMIT 1",
            symbol, ts
        )
        return {
            "poly_yes_price":           float(current) if current else None,
            "poly_conviction_delta_1h": float(current) - float(prev_1h) if current and prev_1h else None,
            "poly_conviction_delta_4h": float(current) - float(prev_4h) if current and prev_4h else None,
        }
    # ... _news_features, _price_features, _options_features, _macro_features follow same pattern
```

---

## Label filler (nightly)

```python
# src/feature_store/label_filler.py
async def fill_labels(tsdb, hold_days: int = 5):
    unlabeled = await tsdb.fetch(
        """SELECT ts, symbol FROM features
           WHERE forward_return_5d IS NULL
             AND ts < NOW() - ($1 * INTERVAL '1 day')""",
        hold_days * 1.5  # buffer for weekends
    )
    for row in unlabeled:
        price_at_ts = await tsdb.fetchval(
            "SELECT close FROM raw_ohlcv WHERE symbol=$1 AND interval='1d' AND ts<=$2 ORDER BY ts DESC LIMIT 1",
            row["symbol"], row["ts"]
        )
        price_forward = await tsdb.fetchval(
            "SELECT close FROM raw_ohlcv WHERE symbol=$1 AND interval='1d' AND ts>$2 ORDER BY ts ASC LIMIT 1 OFFSET $3",
            row["symbol"], row["ts"], hold_days - 1
        )
        if price_at_ts and price_forward:
            fwd = (float(price_forward) - float(price_at_ts)) / float(price_at_ts)
            await tsdb.execute(
                "UPDATE features SET forward_return_5d=$1, label_filled_at=NOW() WHERE ts=$2 AND symbol=$3",
                fwd, row["ts"], row["symbol"]
            )
```

---

## Scoring model

### Phase 1: rule-based placeholder (use until 90 days of labeled data)

```python
# src/ml/rule_scorer.py
def rule_based_score(features: dict) -> float:
    score = 0.0
    if (features.get("poly_conviction_delta_1h") or 0) > 0.10:  score += 0.30
    if (features.get("vol_ratio_30d") or 0) > 2.0:              score += 0.25
    if (features.get("news_sentiment_1h") or 0) > 0.70:         score += 0.20
    if (features.get("rsi_14") or 50) < 35:                     score += 0.15
    if (features.get("put_call_ratio") or 1) < 0.40:            score += 0.10
    return min(score, 1.0)
```

### Phase 2: XGBoost model (run outside Docker)

```python
# src/ml/train.py
import asyncpg, asyncio, xgboost as xgb, pandas as pd, shap
from sklearn.model_selection import TimeSeriesSplit

FEATURE_COLS = [
    "poly_conviction_delta_1h", "poly_conviction_delta_4h",
    "news_sentiment_1h", "news_sentiment_4h", "news_hotness_peak_4h",
    "news_article_count_4h", "rsi_14", "macd_histogram", "atr_14",
    "bb_position", "sma_20_slope", "vol_ratio_30d",
    "price_change_1d", "price_change_5d", "put_call_ratio",
    "unusual_sweep_count_4h", "vix_level", "wti_crude",
    "us_10y_yield", "fed_funds_rate", "usd_index", "social_sentiment_z",
]

async def load_data():
    # connects to localhost:5433 — the exposed TimescaleDB port
    conn = await asyncpg.connect("postgresql://postgres:postgres@localhost:5433/market_history")
    rows = await conn.fetch(
        "SELECT * FROM features WHERE forward_return_5d IS NOT NULL ORDER BY ts ASC"
    )
    return pd.DataFrame([dict(r) for r in rows])

def train(df):
    X = df[FEATURE_COLS].fillna(0)
    y = (df["forward_return_5d"] > 0.03).astype(int)  # label: up >3% in 5d

    model = xgb.XGBClassifier(
        n_estimators=300, max_depth=4, learning_rate=0.05,
        subsample=0.8, tree_method="hist", device="cpu",
        eval_metric="logloss", use_label_encoder=False,
    )
    tscv = TimeSeriesSplit(n_splits=5)
    for train_idx, val_idx in tscv.split(X):
        model.fit(
            X.iloc[train_idx], y.iloc[train_idx],
            eval_set=[(X.iloc[val_idx], y.iloc[val_idx])],
            verbose=False,
        )

    model.save_model("models/scoring_model.json")

    # compute SHAP explainer and save
    explainer = shap.TreeExplainer(model)
    import pickle
    with open("models/shap_explainer.pkl", "wb") as f:
        pickle.dump(explainer, f)

    print(f"Model saved. Samples: {len(df)}, Features: {len(FEATURE_COLS)}")

df = asyncio.run(load_data())
train(df)
```

---

## AI correlator — full pipeline

Claude's role: receives a structured prediction payload, returns a JSON object
with four fields: summary, thesis, risk_note, historical_note.
Claude never decides if something is an opportunity. The model does that.

```python
# src/ai_correlator/correlator.py
import anthropic, json, xgboost as xgb, shap, pickle
from openai import OpenAI

claude = anthropic.Anthropic()
oai    = OpenAI()

model     = xgb.XGBClassifier()
model.load_model("models/scoring_model.json")
with open("models/shap_explainer.pkl", "rb") as f:
    explainer = pickle.load(f)

USE_RULE_SCORER = not Path("models/scoring_model.json").exists()

async def run(signal_id: str, db, tsdb):
    signal  = await db.fetchrow("SELECT * FROM signals WHERE id=$1", signal_id)
    symbol  = signal["symbol"]

    # 1. get current feature row
    features = await tsdb.fetchrow(
        "SELECT * FROM features WHERE symbol=$1 ORDER BY ts DESC LIMIT 1", symbol
    )
    if not features:
        return None

    feat_dict = dict(features)

    # 2. score
    if USE_RULE_SCORER:
        from src.ml.rule_scorer import rule_based_score
        confidence = rule_based_score(feat_dict)
        top_features = []
    else:
        X = pd.DataFrame([{c: feat_dict.get(c, 0) for c in FEATURE_COLS}]).fillna(0)
        confidence = float(model.predict_proba(X)[0][1])
        shap_vals  = explainer.shap_values(X)[0]
        top_features = sorted(
            [{"feature": FEATURE_COLS[i], "current_value": float(X.iloc[0, i]),
              "shap_value": float(shap_vals[i])}
             for i in range(len(FEATURE_COLS))],
            key=lambda x: abs(x["shap_value"]), reverse=True
        )[:5]

    # 3. gate
    if confidence < 0.65:
        return None

    # 4. hypothesis validation
    hypothesis = await match_hypothesis(feat_dict, db)
    if not hypothesis:
        return None

    bt = await run_backtest(hypothesis, tsdb)
    if not bt["passed"]:
        return None

    # 5. semantic context (pgvector)
    vec = embed(f"{signal['source']} {signal['type']} {symbol}")
    similar_opps = await db.fetch(
        """SELECT *, 1-(embedding<=>$1::vector) AS sim FROM opportunities
           WHERE embedding IS NOT NULL ORDER BY embedding<=>$1::vector LIMIT 3""",
        vec
    )

    # 6. macro snapshot
    macro = await tsdb.fetch(
        "SELECT DISTINCT ON (series_id) series_id, value FROM raw_macro ORDER BY series_id, ts DESC"
    )

    # 7. Claude narrative
    prompt   = build_prompt(signal, confidence, top_features, bt, similar_opps, macro, hypothesis)
    response = claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=800,
        messages=[{"role": "user", "content": prompt}]
    )
    narrative = json.loads(response.content[0].text)

    # 8. save opportunity
    opp_vec = embed(narrative["summary"] + " " + narrative["thesis"])
    saved   = await db.fetchrow(
        """INSERT INTO opportunities
           (hypothesis_id, signal_ids, backtest_id, model_confidence, summary, thesis,
            risk_note, historical_note, action, tickers, expected_return_pct, hold_days,
            stop_loss_pct, top_features, embedding)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *""",
        hypothesis["id"], [signal_id], bt["id"], confidence,
        narrative["summary"], narrative["thesis"], narrative["risk_note"],
        narrative.get("historical_note"), hypothesis["direction"] == "up" and "buy" or "sell",
        [symbol], bt["avg_return_pct"], hypothesis["hold_days"],
        0.03, json.dumps(top_features), opp_vec
    )

    await fan_out_to_users(saved, db)
    return saved


def build_prompt(signal, confidence, top_features, bt, similar_opps, macro, hypothesis) -> str:
    top_feat_str = "\n".join(
        f"  {f['feature']}: {f['current_value']:.3f} "
        f"({'supports' if f['shap_value'] > 0 else 'weighs against'}, "
        f"impact {abs(f['shap_value']):.3f})"
        for f in top_features
    ) or "  rule-based scoring active (model not yet trained)"

    similar_str = "\n".join(
        f"  [{o['sim']:.0%} match] {o['summary']} — conf {o['model_confidence']:.0%}"
        for o in similar_opps
    ) or "  none found"

    macro_str = "\n".join(f"  {r['series_id']}: {r['value']}" for r in macro)

    return f"""You are a trading strategy analyst. A quantitative model has identified a
prediction. Your ONLY job is to explain it clearly in four fields.
Do NOT question the numbers. Do NOT add your own probability estimates.
Do NOT say whether this is a good or bad trade. Just explain what the model found.

HYPOTHESIS: {hypothesis['name']}
  {hypothesis['description']}

PREDICTION:
  Symbol: {signal['symbol']}
  Model confidence: {confidence:.0%}
  Historical win rate: {bt['win_rate']:.0%} over {bt['sample_size']} occurrences
  Avg return: {bt['avg_return_pct']}% over {hypothesis['hold_days']} days
  Expectancy: {bt['expectancy']}% per trade

TOP FEATURES DRIVING MODEL SCORE (SHAP values):
{top_feat_str}

SIMILAR PAST OPPORTUNITIES:
{similar_str}

CURRENT MACRO:
{macro_str}

Write exactly these four fields. Keep each tight.
- summary: one sentence, plain English, no jargon, no numbers except the symbol
- thesis: two to three sentences explaining what signals aligned and why they matter together
- risk_note: one sentence on the main thing that could invalidate this setup
- historical_note: one sentence referencing a similar past opportunity if found, else null

Respond ONLY in valid JSON, no preamble, no markdown:
{{
  "summary": "...",
  "thesis": "...",
  "risk_note": "...",
  "historical_note": "..." or null
}}"""


def embed(text: str) -> list[float]:
    return oai.embeddings.create(input=text, model="text-embedding-3-small").data[0].embedding
```

---

## Fan-out and position sizing

```python
# src/ai_correlator/fan_out.py
RISK_PCT = {"conservative": 0.01, "moderate": 0.03, "aggressive": 0.06}

async def fan_out_to_users(opp: dict, db):
    users = await db.fetch(
        """SELECT DISTINCT u.* FROM users u
           JOIN subscriptions s ON s.user_id = u.id
           WHERE s.symbol = ANY($1::text[])""",
        opp["tickers"]
    )
    for user in users:
        pct    = min(RISK_PCT[user["risk_level"]], user["max_position_pct"])
        tp_pct = (opp["expected_return_pct"] or 3.0) / 100
        sl_pct = opp["stop_loss_pct"] or 0.03
        rr     = round(tp_pct / sl_pct, 1)

        rationale = (
            f"{opp['summary']} "
            f"Win rate: {opp.get('win_rate', '?')}% over similar setups. "
            f"Expected: ~{opp['expected_return_pct']}% in {opp.get('hold_days', 5)} days. "
            f"Position: {int(pct*100)}% of account. "
            f"Stop: {int(sl_pct*100)}%. R/R: 1:{rr}. "
            f"Confidence: {int(opp['model_confidence']*100)}%."
        )
        saved = await db.fetchrow(
            """INSERT INTO strategies
               (user_id, opportunity_id, sizing_pct, stop_loss_pct,
                take_profit_pct, rationale, expires_at)
               VALUES ($1,$2,$3,$4,$5,$6, NOW()+INTERVAL '4 hours') RETURNING *""",
            user["id"], opp["id"], pct, sl_pct, tp_pct, rationale
        )
        await redis.publish(f"strategies:{user['id']}", json.dumps(dict(saved), default=str))
```

---

## Next.js structure and API routes

```
src/web/
├── app/
│   ├── layout.tsx                      # root — fonts, auth check, redirect logic
│   ├── page.tsx                        # redirects: no profile → /onboarding, else → /
│   ├── onboarding/page.tsx             # multi-step: risk → markets → alpaca → done
│   ├── auth/signin/page.tsx            # custom sign-in page
│   └── (dashboard)/                   # layout group — sidebar nav, auth guard
│       ├── layout.tsx
│       ├── page.tsx                    # strategy inbox (default route)
│       ├── correlator/page.tsx         # live signal feed + pipeline status
│       ├── chart/page.tsx              # OHLCV + technicals + backtest markers
│       ├── backtests/page.tsx          # backtest explorer table
│       ├── trades/page.tsx             # trade history + P&L
│       └── settings/page.tsx          # risk, markets, alpaca, subscriptions
├── api/
│   ├── auth/[...nextauth]/route.ts
│   ├── signals/route.ts               # GET — user's signals, last 1h
│   ├── strategies/
│   │   ├── route.ts                   # GET list, PATCH dismiss
│   │   └── stream/route.ts            # GET SSE stream (nodejs runtime)
│   ├── trades/route.ts                # POST — execute via Alpaca
│   ├── backtests/route.ts             # GET — backtest history
│   ├── history/[symbol]/route.ts      # GET — OHLCV + technicals from TimescaleDB
│   └── subscriptions/route.ts         # GET/POST/DELETE
├── lib/
│   ├── db.ts                          # pg Pool → postgres app DB
│   ├── tsdb.ts                        # pg Pool → timescaledb
│   ├── redis.ts                       # ioredis singleton
│   ├── auth.ts                        # next-auth config
│   └── alpaca.ts                      # alpaca SDK wrapper
├── hooks/
│   ├── useStrategyStream.ts           # SSE with auto-reconnect, 5s retry
│   ├── useAlpacaAccount.ts            # polls /api/account for equity
│   └── useCountdown.ts                # strategy expiry timer
└── components/
    ├── layout/NavSidebar.tsx
    ├── strategy/
    │   ├── StrategyCard.tsx
    │   ├── StrategyDetail.tsx
    │   ├── ConfirmFooter.tsx           # 3-second hold-to-confirm
    │   ├── BacktestStats.tsx           # always shows disclaimer
    │   ├── SignalList.tsx
    │   ├── SizingBreakdown.tsx
    │   └── MacroGrid.tsx
    ├── correlator/
    │   ├── SignalTable.tsx
    │   ├── PipelineSteps.tsx
    │   └── SourceHealth.tsx
    ├── chart/PriceChart.tsx
    ├── backtest/BacktestTable.tsx
    ├── trades/
    │   ├── AccountSummary.tsx
    │   └── TradesTable.tsx
    └── ui/
        ├── Badge.tsx
        ├── StatCell.tsx
        ├── SectionLabel.tsx
        ├── LiveDot.tsx
        ├── Skeleton.tsx
        └── Toast.tsx
```

### SSE stream route

```typescript
// app/api/strategies/stream/route.ts
export const runtime = "nodejs"

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return new Response("Unauthorized", { status: 401 })

  const sub     = getRedis().duplicate()
  const channel = `strategies:${session.user.id}`

  const stream = new ReadableStream({
    async start(controller) {
      await sub.subscribe(channel)
      sub.on("message", (_, data) => controller.enqueue(`data: ${data}\n\n`))
      const hb = setInterval(() => controller.enqueue(": heartbeat\n\n"), 30_000)
      req.signal.addEventListener("abort", async () => {
        clearInterval(hb)
        await sub.unsubscribe(channel)
        await sub.quit()
        controller.close()
      })
    }
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    }
  })
}
```

### Trade execution route

```typescript
// app/api/trades/route.ts
export async function POST(req: Request) {
  const session = await auth()
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 })

  const { strategy_id, confirmed } = await req.json()
  if (!confirmed) return Response.json({ error: "explicit confirmation required" }, { status: 400 })

  // idempotency
  const dup = await db.query(
    "SELECT id FROM trades WHERE strategy_id=$1 AND user_id=$2 AND status!='rejected'",
    [strategy_id, session.user.id]
  )
  if (dup.rows.length) return Response.json({ error: "already submitted" }, { status: 409 })

  const strat   = (await db.query(
    "SELECT s.*, o.tickers, o.action FROM strategies s JOIN opportunities o ON o.id=s.opportunity_id WHERE s.id=$1",
    [strategy_id]
  )).rows[0]
  const user    = (await db.query("SELECT * FROM users WHERE id=$1", [session.user.id])).rows[0]
  const alpaca  = getAlpaca(user.is_paper, user.alpaca_key_id, user.alpaca_secret)
  const account = await alpaca.getAccount()
  const equity  = parseFloat(account.equity)
  const sizing  = strat.sizing_usd ?? equity * strat.sizing_pct
  const symbol  = strat.tickers[0]
  const quote   = await alpaca.getLatestQuote(symbol)
  const price   = parseFloat(quote.ap)
  const qty     = Math.floor(sizing / price)

  if (qty < 1) return Response.json({ error: "position too small" }, { status: 422 })

  const order = await alpaca.createOrder({
    symbol, qty,
    side: strat.action === "sell" ? "sell" : "buy",
    type: "market",
    time_in_force: "day",
  })

  await db.query(
    "INSERT INTO trades (user_id,strategy_id,alpaca_order_id,symbol,side,qty,status,is_paper) VALUES ($1,$2,$3,$4,$5,$6,'submitted',$7)",
    [session.user.id, strategy_id, order.id, symbol, order.side, qty, user.is_paper]
  )
  await db.query("UPDATE strategies SET status='executed' WHERE id=$1", [strategy_id])

  return Response.json({ order_id: order.id, qty, estimated_cost: qty * price })
}
```

---

## Environment variables

```bash
# env/nextjs.env
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/eventedge
TIMESCALE_URL=postgresql://postgres:postgres@timescale:5432/market_history
REDIS_URL=redis://redis:6379
NEXTAUTH_SECRET=change-me-in-production
NEXTAUTH_URL=http://localhost:3000
ALPACA_KEY_ID=
ALPACA_SECRET_KEY=

# env/python.env (all Python services)
KAFKA_BOOTSTRAP_SERVERS=redpanda:9092
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/eventedge
TIMESCALE_URL=postgresql://postgres:postgres@timescale:5432/market_history
REDIS_URL=redis://redis:6379
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
FINNHUB_API_KEY=
FRED_API_KEY=
LOG_LEVEL=info
LOG_FORMAT=json
DEV_MODE=true
```

---

## Python dependencies

```toml
[project]
dependencies = [
  "confluent-kafka>=2.3",
  "asyncpg>=0.29",
  "redis>=5.0",
  "anthropic>=0.25",
  "openai>=1.30",
  "yfinance>=0.2",
  "pandas>=2.2",
  "pandas-ta>=0.3",
  "vectorbt>=0.26",
  "fredapi>=0.5",
  "xgboost>=2.0",
  "shap>=0.44",
  "scikit-learn>=1.4",
  "pydantic>=2.0",
  "structlog>=24.0",
  "prometheus-client>=0.20",
]
```

---

## Directory layout

```
eventedge-ai/
├── src/
│   ├── event_detectors/               # DUMB — fetch raw, publish to Redpanda
│   │   ├── polymarket_producer/
│   │   ├── news_producer/
│   │   └── analytics_producer/
│   ├── event_processors/              # SMART — detection logic lives here
│   │   ├── polymarket_consumer/
│   │   │   ├── consumer.py
│   │   │   └── conviction.py          # your existing algorithm, moved here
│   │   ├── news_consumer/
│   │   │   ├── consumer.py
│   │   │   └── signal_detector.py     # your existing algorithm, moved here
│   │   └── analytics_consumer/
│   │       ├── consumer.py
│   │       └── signal_detector.py
│   ├── feature_store/
│   │   ├── builder.py                 # hourly snapshot writer
│   │   ├── label_filler.py            # nightly forward return labels
│   │   ├── normalizer.py              # z-score at query time
│   │   └── scheduler.py              # cron wrapper
│   ├── historical/
│   │   ├── ingestor.py                # nightly OHLCV + FRED pull
│   │   └── sources/
│   │       ├── yfinance_source.py
│   │       └── fred_source.py
│   ├── ml/
│   │   ├── train.py                   # run locally, NOT in Docker
│   │   └── rule_scorer.py             # placeholder until model trained
│   ├── ai_correlator/
│   │   ├── correlator.py
│   │   ├── fan_out.py
│   │   └── prompt.py
│   ├── observability/
│   └── web/                           # Next.js app
│       └── (see Next.js structure above)
├── db/
│   ├── app_schema.sql
│   └── history_schema.sql
├── models/                            # gitignored — populated by train.py
│   ├── scoring_model.json
│   └── shap_explainer.pkl
├── pgadmin/
│   └── servers.json
├── env/
│   ├── nextjs.env
│   └── python.env
├── observability/
│   └── (prometheus + grafana configs)
├── scripts/
│   ├── seed_subscriptions.py
│   └── seed_stock_subscriptions.py
├── docker-compose.yml
├── docker-compose.monitoring.yml      # optional — grafana + prometheus
├── Dockerfile                         # Python 3.11-slim, all Python services
├── pyproject.toml
└── BUILD.md                           # phase-by-phase build order (see below)
```

---

## Build phases

Build strictly in this order. Each phase produces something verifiable before the next begins.
Do not skip phases. Do not build phase N+1 before phase N is confirmed working.

### Phase 1 — Infrastructure (2 days)
Goal: all services healthy, both databases initialized, pgAdmin connected to both.

1. Write docker-compose.yml (use Redpanda, NOT Kafka or Zookeeper)
2. Write db/app_schema.sql (PostgreSQL + pgvector)
3. Write db/history_schema.sql (TimescaleDB with hypertables and compression)
4. Write pgadmin/servers.json (pre-connects both databases)
5. docker compose up -d
6. Verify: pgAdmin at localhost:5050 shows both databases, all tables exist
7. Verify: redpanda-console at localhost:8080 is healthy

### Phase 2 — Data ingest (3 days)
Goal: real data flowing from all three sources into raw_* tables.

1. Build polymarket-producer (polls Polymarket API, publishes to raw.polymarket)
2. Build polymarket-consumer (reads raw.polymarket, runs conviction.py, writes raw_polymarket + signals)
3. Build news-producer + news-consumer (same pattern, raw.news topic)
4. Build analytics-producer + analytics-consumer (same pattern, raw.analytics topic)
5. Verify: rows appearing in raw_polymarket, raw_news, raw_ohlcv in pgAdmin
6. Verify: rows appearing in signals table when thresholds crossed

### Phase 3 — Feature store (2 days)
Goal: features table populated with real data, labels filling nightly.

1. Build historical ingestor — pulls 2 years OHLCV and FRED macro
2. Build feature builder — hourly snapshots, as-of queries, no lookahead
3. Build label filler — nightly job, forward_return_5d for rows >= 5 trading days old
4. Run historical ingestor once manually to backfill
5. Verify: features table has rows with real values for each symbol
6. Verify: label_filled_at populated for historical rows

### Phase 4 — AI correlator with rule scorer (2 days)
Goal: full pipeline working end-to-end, strategies appearing in browser.

1. Build ai-correlator using rule_scorer.py (not XGBoost yet)
2. Build fan_out.py — per-user strategy sizing and Redis publish
3. Build Next.js skeleton — strategy inbox page only
4. Build SSE stream route (app/api/strategies/stream/route.ts)
5. Build trade execution route (app/api/trades/route.ts)
6. Wire Alpaca paper trading
7. Verify: signal fires → correlator runs → strategy appears in browser → paper order executes

### Phase 5 — ML model (3 days)
Goal: XGBoost model replacing rule scorer with real historical predictions.

1. Run src/ml/train.py locally (needs Phase 3 complete with enough labeled data)
2. Verify models/scoring_model.json and shap_explainer.pkl exist
3. Mount models/ into ai-correlator container (already in docker-compose.yml)
4. Swap rule_scorer import for xgboost model in correlator.py
5. Verify: SHAP values appearing in top_features column of opportunities table
6. Verify: Claude narrative references specific features from SHAP output

### Phase 6 — Full frontend (5 days)
Goal: all six pages built and working per design system.

1. Design system: globals.css with all CSS variables, DM Sans + DM Mono fonts
2. NavSidebar component
3. Strategy inbox — full detail panel, backtest stats, sizing breakdown, hold-to-confirm
4. Signal correlator — signal table, pipeline steps, source health
5. Price chart — Recharts OHLCV, RSI/MACD subcharts, backtest entry markers
6. Backtest explorer — sortable table, expandable row detail
7. Trade history — open positions, closed trades, P&L
8. Settings — risk selector, market selector, Alpaca connect, subscription manager
9. Onboarding flow — 5 steps, saves progress at each step

### Phase 7 — Hypothesis library (3 days)
Goal: named hypotheses stored, validated, and driving predictions.

1. hypotheses table already in schema — write the initial 10-15 hypothesis objects
2. Build hypothesis matching in correlator (match_hypothesis function)
3. Build Claude hypothesis authoring prompt (natural language → hypothesis JSON)
4. Build backtester (vectorbt, validates hypotheses against feature store)
5. Retire rule_scorer.py entirely — all scoring via XGBoost + hypotheses
6. Set up weekly model retrain as a cron job (local Python or VPS)

---

## Key design decisions — why things are the way they are

**Redpanda instead of Kafka**
Redpanda is Kafka-protocol-compatible. Zero code changes to producers or consumers.
Runs as a single binary with no Zookeeper. 512 MB vs ~1.2 GB. Native ARM image.
This was a straightforward upgrade with no downsides for this use case.

**Detection in consumers, not producers**
Producers are stateless fetchers — trivially restartable, no state to lose.
Consumers have the full event history context needed to make detection decisions.
State (ConvictionState per symbol) lives in the consumer process, not the producer.
This separation means producers can be restarted without losing detection state.

**Two databases instead of one**
TimescaleDB is optimized for time-series append and range scans with compression.
PostgreSQL app DB is optimized for relational lookups, foreign keys, vector search.
Different access patterns, different tuning, different backup strategies.
pgAdmin connects to both from a single UI at localhost:5050.

**Feature store replaces Couchbase and MongoDB**
Couchbase was used as a glorified event log. PostgreSQL handles this with a
features table and proper indexes. MongoDB stored subscriptions — pure relational
data that belongs in PostgreSQL with foreign keys. Both removed.

**Claude explains predictions, does not make them**
Claude has no access to your historical data. Asking it "is this an opportunity?"
produces confident-sounding answers grounded in nothing. The XGBoost model has
access to 2 years of labeled feature rows. It makes the decision. Claude receives
the decision + SHAP values + historical context and writes four fields of narrative.
This is the correct division of labor.

**Rule-based scorer as placeholder**
The XGBoost model needs ~90 days of labeled data before it's meaningful.
The rule scorer keeps the pipeline running and testable from day one.
It is replaced by a single import swap — no other code changes.

**ML training outside Docker**
Training is a batch job, not a persistent service. Running it in a Docker container
adds VM overhead for no benefit. It runs in local Python, connects to TimescaleDB
via the exposed port, saves a model file, done. The model file is mounted
read-only into the ai-correlator container.

**pgvector instead of a dedicated vector database**
pgvector with HNSW handles millions of vectors at sub-5ms latency.
No new service, SDK, auth, or backup strategy needed.
Dedicated vector DBs earn their place at 100M+ vectors. Not relevant here.

**Hold-to-confirm on trade execution**
3-second hold required before any order submits. Applies to paper and live.
Prevents accidental execution. Idempotency key on every trade submission
prevents duplicate orders from retries or double-taps.

**Expected return sourced from backtest, not Claude**
The prompt explicitly instructs Claude not to fabricate return estimates.
expected_return_pct in every opportunity is the backtest avg_return_pct.
The UI displays sample_size and win_rate alongside it. Past performance disclaimer
is a non-removable component of the BacktestStats component.