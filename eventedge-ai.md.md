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

## Why each technology exists — full explanations

### Redpanda (message broker)

Redpanda is the pipe between producers and consumers. Producers publish raw events
to it. Consumers read from it. Nothing talks to anything else directly.

WHY NOT JUST LET PRODUCERS WRITE TO THE DATABASE DIRECTLY?
  Because producers and consumers need to be decoupled. If the database is slow
  or down, a direct write blocks the producer. With Redpanda in between, the
  producer keeps publishing regardless of what consumers are doing. Consumers
  catch up when they're ready. This makes the system resilient to partial failures.

WHY REDPANDA INSTEAD OF KAFKA?
  Kafka requires Zookeeper — a separate service just to manage Kafka's own
  coordination. That's two containers, ~1.2 GB RAM combined, slow startup,
  and complex configuration. Redpanda does everything Kafka does in a single
  binary with no Zookeeper, uses ~200 MB RAM, starts in seconds, and has a
  native ARM64 image for M1 Macs. It speaks the exact same Kafka protocol —
  zero code changes to producers or consumers. Pure upgrade.

WHAT LIVES IN REDPANDA:
  Three topics: raw.polymarket, raw.news, raw.analytics.
  Messages are raw normalized events from each source.
  Retained for 24 hours (enough for consumers to catch up if they restart).
  No detection, no scoring, no filtering — just raw facts.

---

### PostgreSQL 16 + pgvector (app database, port 5432)

The relational database for everything user-facing and application-level.
This is the source of truth for who your users are, what strategies they received,
and what trades they executed.

WHAT LIVES HERE:
  users, subscriptions, signals, hypotheses, backtest_results,
  opportunities, strategies, trades, positions.
  All relational data with foreign keys and joins.

WHY NOT PUT EVERYTHING IN ONE DATABASE?
  The app DB is optimized for point lookups and relational joins —
  "give me all strategies for user X", "give me the opportunity linked to this strategy".
  TimescaleDB is optimized for time-range scans over millions of rows.
  Mixing both into one instance means tuning PostgreSQL for two incompatible
  workloads. Keeping them separate lets each be optimized independently.

PGVECTOR:
  An extension that adds a vector column type and similarity search to PostgreSQL.
  Used for semantic search on signals and opportunities.
  Full explanation in the embeddings section below.

---

### Redis 7 (cache and pub-sub)

Redis has two jobs in this system and they are completely separate.

JOB 1 — PUB-SUB FOR SSE DELIVERY:
  When the fan-out builds a strategy for a user, it publishes to a Redis channel
  named strategies:{user_id}. The Next.js SSE route subscribes to that channel
  for each connected browser. When a message arrives, it streams immediately
  to the browser. Redis delivers it in milliseconds.

  Why Redis and not Kafka for this?
  Kafka consumers are long-lived processes, not appropriate to open per HTTP
  connection. You'd need one Kafka consumer per connected browser tab, which
  is absurd. Redis pub/sub is built exactly for this — lightweight, instant,
  trivially opened and closed per browser connection.

JOB 2 — WAKING THE CORRELATOR:
  When a consumer detects a signal, it publishes the signal ID to a Redis
  channel called "new_signal". The correlator is subscribed to this channel
  and wakes up immediately when a signal fires. This is faster and lighter
  than polling the database every few seconds.

WHAT REDIS DOES NOT DO:
  Redis is not a database in this system. Nothing important is stored only
  in Redis. If Redis restarts, no data is lost — the database has everything.
  Redis is purely a messaging layer.

---

### pgAdmin 4 (database admin UI, port 5050)

A web-based GUI for inspecting and querying both databases directly.
Open it at localhost:5050 during development to see what's actually in your tables.

WHY IT EXISTS:
  When the feature builder writes a row, how do you verify it looks correct?
  When a signal fires, how do you check it was written to the signals table?
  When a strategy is generated, how do you see it before the frontend is built?
  pgAdmin is the answer to all of these during development.

HOW IT'S CONFIGURED:
  Both databases (postgres port 5432 and timescale port 5433) are pre-connected
  via pgadmin/servers.json — no manual setup needed after docker compose up.
  Runs in amd64 mode via Rosetta 2 on M1 — slightly slower but works fine.
  Access at localhost:5050, credentials: admin@local.dev / admin.

---

### Python 3.11, asyncpg, confluent-kafka (Python services)

All Python services (producers, consumers, feature builder, correlator, historical
ingestor, label filler) share one Docker image built from the root Dockerfile.

PYTHON 3.11:
  Required for asyncio performance improvements and match/case syntax.
  Use 3.11 specifically — 3.12 has breaking changes in some ML libraries.

ASYNCPG:
  The PostgreSQL client used by all Python services. It is async-native, meaning
  database queries don't block the event loop. A producer can be polling an API
  and writing to the database simultaneously without one waiting for the other.
  Faster and more efficient than psycopg2 for high-concurrency services.

CONFLUENT-KAFKA:
  The Kafka-protocol client library. Works with Redpanda unchanged because
  Redpanda speaks the same protocol. Used by all producers (to publish) and
  all consumers (to read). Do not switch to kafka-python — confluent-kafka
  is significantly faster and more reliable for production use.

ONE DOCKERFILE FOR ALL PYTHON SERVICES:
  Every Python service uses the same base image. The command in docker-compose.yml
  selects which service to run:
    command: python -m src.event_detectors.polymarket_producer
    command: python -m src.event_processors.polymarket_consumer
    command: python -m src.feature_store.scheduler
  This means one build, many services. Faster builds, smaller total image size.

---

### Anthropic Claude API — claude-sonnet-4-20250514 (AI narrative)

Claude has one job in this system: receive a structured prediction payload and
write four fields of plain-English narrative. That is all.

WHAT CLAUDE RECEIVES:
  - Which hypothesis fired and its description
  - Model confidence score (from XGBoost)
  - Backtest statistics (win rate, sample size, avg return, expectancy)
  - Top 5 SHAP features driving the model score
  - 3 most similar past opportunities (from pgvector search)
  - Current macro snapshot (VIX, WTI, yields, USD)

WHAT CLAUDE OUTPUTS:
  - summary: one sentence, plain English, no jargon
  - thesis: two to three sentences explaining what aligned and why
  - risk_note: one sentence on what could invalidate the setup
  - historical_note: reference to a similar past opportunity if found

WHAT CLAUDE DOES NOT DO:
  - Decide if something is an opportunity (the model does that)
  - Estimate probabilities or returns (the backtester does that)
  - Detect signal correlations (the hypothesis matching does that)
  - Filter noise (the gates do that)

WHY CLAUDE AND NOT A SMALLER LOCAL MODEL:
  The narrative needs to be readable, accurate, and contextually aware of
  macro conditions. Smaller local models (tinyllama, mistral-7b) produce
  generic text that doesn't reference the specific features or historical
  context passed to them. Claude reliably uses the structured input and
  produces coherent, specific narratives. The cost per call is cents —
  Claude is called only after five gates have already passed, meaning
  it fires maybe a few times per day at most.

---

### XGBoost / LightGBM (scoring model)

The machine learning model that scores current market conditions and outputs
a probability: P(price up more than 3% in the next 5 trading days).

WHAT IT IS:
  XGBoost (or LightGBM — interchangeable) is a gradient boosted decision tree.
  It is not a neural network. It trains fast, runs fast, handles missing values
  gracefully, and produces well-calibrated probabilities. It is the standard
  choice for tabular financial data and outperforms neural networks on structured
  features with limited training data (which is what you have — a few thousand rows).

WHAT IT TAKES AS INPUT:
  One row from the features table — 22 numerical columns representing everything
  the system knows about a symbol at a point in time.

WHAT IT OUTPUTS:
  A single probability between 0 and 1.
  0.72 means "72% chance price is up more than 3% in 5 days."

HOW IT LEARNS:
  It trains on the features table WHERE forward_return_5d IS NOT NULL.
  Features are the inputs. forward_return_5d > 0.03 is the label (1 = yes, 0 = no).
  It learns which combinations of features historically preceded large up moves.
  Uses TimeSeriesSplit cross-validation — never shuffles data, always trains on
  past and validates on future. Shuffling financial time series is a common
  mistake that produces misleading accuracy scores.

WHERE IT RUNS:
  NOT in Docker. Runs locally in Python outside the container stack.
  Connects to TimescaleDB via localhost:5433 (the exposed port).
  Saves models/scoring_model.json and models/shap_explainer.pkl.
  These files are mounted read-only into the ai-correlator container.
  Retrained weekly via a cron job or manual run.

RULE-BASED PLACEHOLDER:
  On day one you have no labeled data and cannot train the model.
  rule_scorer.py implements a simple hand-coded scoring function that
  adds points for each condition met (Polymarket shift, volume spike, etc.).
  This keeps the pipeline working end-to-end from day one.
  It is replaced by a single import swap once the real model is trained.
  No other code changes needed.

---

### SHAP (ML explainability)

SHAP (SHapley Additive exPlanations) answers the question: for this specific
prediction, which features pushed the score up and which pushed it down, and by
how much?

WHAT IT PRODUCES:
  For each prediction, SHAP gives you a number per feature.
  Positive number = this feature pushed the probability higher.
  Negative number = this feature pushed the probability lower.
  Larger absolute value = more influence on the final score.

  Example output for one prediction on USO:
    poly_conviction_delta_1h: +0.18  (biggest driver upward)
    vol_ratio_30d:             +0.15
    news_sentiment_1h:         +0.12
    rsi_14:                    +0.06
    vix_level:                 -0.04  (slightly weighs against)

WHY IT EXISTS:
  Without SHAP, Claude receives "model confidence: 72%" and has no idea why.
  It would write a generic narrative not grounded in anything real.
  With SHAP, Claude receives the top 5 features that drove the score, with
  their current values and directional impact. It can now write:
  "The 14-point Polymarket conviction shift (the strongest signal) combined
  with a 3.2× volume spike are driving this prediction. Elevated VIX adds
  a slight counterweight."
  That is a real, specific, grounded narrative — not a hallucination.

HOW IT'S USED:
  The SHAP TreeExplainer is computed once during training and saved to
  models/shap_explainer.pkl alongside the model. On each prediction,
  shap_values = explainer.shap_values(current_feature_row) takes milliseconds.
  Top 5 by absolute value are passed to Claude.

---

### yfinance, fredapi, pandas-ta (historical ingest)

These three libraries collectively power the historical ingestor — the nightly
batch job that keeps your raw data tables and feature store current.

YFINANCE:
  A Python wrapper around Yahoo Finance's unofficial API. Provides historical
  OHLCV (Open, High, Low, Close, Volume) data for stocks and ETFs going back
  years. Free, no API key needed. Used to pull the 2-year price history on
  first boot and nightly updates after that.

  What it provides: daily and hourly OHLCV bars for USO, SPY, QQQ, XOM, etc.
  Why it matters: close prices are used to compute forward_return_5d labels.
                  Without price history you have no training data.

FREDAPI:
  A Python wrapper for the Federal Reserve Economic Data API (FRED).
  Provides macroeconomic time series going back decades. Free API key from
  fred.stlouisfed.org. Used to pull VIX (VIXCLS), WTI crude (DCOILWTICO),
  US 10-year yield (DGS10), fed funds rate (FEDFUNDS), USD index (DTWEXBGS).

  What it provides: daily macro indicator values.
  Why it matters: macro context is a feature in the model and in Claude's prompt.
                  Markets don't move in a vacuum — rising rates affect equities
                  differently than commodities.

PANDAS-TA:
  A technical analysis library for pandas DataFrames. Computes RSI, MACD,
  ATR, Bollinger Bands, SMA, EMA, ADX from OHLCV data in one line each.
  Used by the feature builder to compute technical indicator columns.

  What it provides: computed indicators from raw price data.
  Why it matters: RSI, MACD, and volume ratios are among the most predictive
                  features in the scoring model for short-term price moves.

WHEN THESE RUN:
  Once manually on first boot (--backfill flag) to populate 2 years of history.
  Nightly at 01:00 UTC to pull the previous day's data and keep current.
  Run outside Docker in local Python, not as a container service, because
  these are batch jobs not persistent services.

---

### Next.js 14 App Router + TypeScript (frontend)

The user-facing web application and the API layer combined into one service.
Replaces two separate services from the original architecture: React+Vite
(the frontend) and Express (the BFF/API server).

WHY NEXT.JS INSTEAD OF REACT + SEPARATE EXPRESS:
  Next.js App Router lets you write React pages and API route handlers in the
  same project. An API route at app/api/strategies/stream/route.ts replaces
  an entire Express controller. No CORS configuration. No separate port.
  No proxy setup. One container, one deployment target, one set of dependencies.
  The "BFF" (Backend For Frontend) pattern is built in.

APP ROUTER VS PAGES ROUTER:
  App Router (used here) uses React Server Components. Pages that don't need
  real-time data (trade history, backtests, settings) fetch directly in Server
  Components — no client-side data fetching, no loading spinners, instant render.
  Pages that need live data (strategy inbox) use client components with SSE hooks.

SERVER COMPONENTS FOR STATIC PAGES:
  Trade history, backtest explorer, settings — these fetch from the database
  in the server component itself. The HTML arrives pre-rendered. Faster and
  simpler than useEffect + fetch patterns.

CLIENT COMPONENTS + SSE FOR LIVE DATA:
  Strategy inbox uses EventSource to connect to /api/strategies/stream.
  New strategies arrive in real time via SSE without polling.

API ROUTES AS BFF:
  Every route in app/api/ is a serverless-style handler that runs on the server.
  They authenticate the user, query the database, and return JSON.
  They replace Express routes entirely. Same logic, no separate process.

---

### NextAuth.js v5 (auth)

Handles user authentication — login, session management, protecting routes.

WHAT IT DOES:
  Validates email + password against the users table (bcrypt hash comparison).
  Issues a JWT (JSON Web Token) stored in a cookie.
  Every API route calls auth() to get the current user's session.
  Protected pages redirect to /auth/signin if no valid session exists.

WHY JWT AND NOT DATABASE SESSIONS:
  Database sessions require a sessions table and a database query on every
  request to check if the session is still valid. JWT sessions encode the
  user ID and expiry in the token itself — no database query needed per request.
  Simpler and faster for a single-server setup.

NO OAUTH IN V1:
  No Google, GitHub, or other social login. Users register with email + password.
  OAuth adds complexity (callback URLs, provider configuration, token refresh)
  that isn't needed for a private trading tool with a small user base.

---

### Recharts (charts)

A React charting library used for the price chart page.

WHAT IT RENDERS:
  - Candlestick OHLCV chart (main price chart)
  - Volume bars below the main chart
  - RSI subchart (with overbought/oversold reference lines at 25 and 75)
  - MACD subchart (MACD line, signal line, histogram bars)
  - Bollinger Bands overlaid on the price chart
  - Backtest entry markers — dashed vertical lines at dates where the
    hypothesis historically fired, showing the actual outcome

WHY RECHARTS:
  It's React-native (no imperative chart.js or d3 manipulation), composable
  (you build charts from React components), and works well with TypeScript.
  Lightweight enough for the browser without impacting page performance.

---

### React Hook Form + Zod (forms)

Used for all form handling in the frontend: onboarding steps, settings page,
subscription manager, and the Alpaca connection form.

REACT HOOK FORM:
  Manages form state, validation triggers, and submission without re-rendering
  the entire form on every keystroke. Much faster than controlled inputs with
  useState for each field.

ZOD:
  A TypeScript schema validation library. You define what valid input looks like
  (e.g. email must be a valid email, risk_level must be one of three values)
  and Zod validates it. Used both on the client (immediate field feedback) and
  on the server (API route input validation before touching the database).

  Example: POST /api/subscriptions validates the request body with Zod before
  inserting anything. If symbol is missing or source is not one of
  'polymarket', 'news', 'analytics' — it returns 400 immediately.

---

### Alpaca Trade API (execution)

The brokerage integration that turns a confirmed strategy into an actual order.

WHAT IT DOES:
  Connects to Alpaca's API using the user's own API keys (stored encrypted
  in the users table). Fetches account equity to size the position in dollars.
  Gets the latest quote for the symbol to compute share quantity.
  Submits a market order. Returns an order ID.

PAPER MODE VS LIVE MODE:
  Paper mode connects to Alpaca's sandbox environment — real market data,
  fake money, no actual positions. This is the default and is strongly
  recommended until the system has a proven track record.
  Live mode connects to Alpaca's production environment with real money.
  The UI makes this distinction completely unambiguous — different button
  color, different label, same 3-second hold-to-confirm requirement.

USER PROVIDES OWN API KEYS:
  Each user connects their own Alpaca account via the settings page.
  The system never holds a pooled brokerage account. This means:
  - Each user's positions are in their own account
  - The system is not acting as a broker or investment adviser
  - Regulatory risk is significantly reduced
  Keys are stored encrypted in the users table and never logged.

WHAT HAPPENS ON EXECUTION:
  1. Idempotency check — reject if this strategy already has a non-rejected trade
  2. Fetch user's Alpaca account equity
  3. Compute position size in dollars (equity × sizing_pct)
  4. Get latest quote for the symbol
  5. Compute share quantity (dollars ÷ price, floored to whole shares)
  6. Submit market order
  7. Write trade record to PostgreSQL
  8. Update strategy status to 'executed'

---

### Prometheus + Grafana (monitoring)

Optional observability stack. Not required to run the system.
Kept in a separate docker-compose.monitoring.yml file so it doesn't consume
resources during normal development.

PROMETHEUS:
  Scrapes metrics from all Python services (each exposes a /metrics endpoint
  on ports 9101-9105) and from the Next.js BFF (/metrics on port 3000).
  Stores time-series metrics: requests per second, Kafka consumer lag,
  feature builder run duration, model scoring latency, error rates.

GRAFANA:
  Visualizes the Prometheus metrics in dashboards.
  Access at localhost:3001 (admin/admin).
  Useful for seeing: are producers polling at the expected frequency?
  Is the feature builder completing within its hourly window?
  Are any consumers falling behind on their Kafka topic?

WHEN TO RUN IT:
  Not during normal development — it adds ~800 MB RAM for little benefit
  when you can just check pgAdmin and docker logs instead.
  Run it when debugging performance issues or before moving to production:
    docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d

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

### What embeddings are and where they are used

An embedding is a list of 1536 numbers that represents the meaning of a piece of text.
Similar meaning → similar numbers. This is generated by OpenAI text-embedding-3-small.

WHY THIS EXISTS IN THE SYSTEM:
  Standard SQL can search by exact match or keyword (LIKE '%iran%').
  Embeddings search by meaning. "Iran military conflict", "Persian Gulf tensions",
  "Middle East escalation" all produce similar number lists even though they share
  no words. This lets the correlator find past situations that MEANT the same thing,
  not just used the same words.

EMBEDDINGS ARE USED IN EXACTLY TWO PLACES:

1. signals.embedding — written when a signal is detected
   Text embedded: "{source} {type} {symbol}"
   e.g. "polymarket conviction_shift USO"

   Used for: finding the 5 most semantically similar past signals before
   calling Claude. Gives Claude historical context — "a similar Polymarket
   shift on a geopolitical market fired in October 2023."

   Query in correlator:
     SELECT *, 1-(embedding <=> $vec::vector) AS similarity
     FROM signals
     WHERE created_at < NOW() - INTERVAL '15 minutes'
       AND embedding IS NOT NULL
     ORDER BY embedding <=> $vec::vector
     LIMIT 5

2. opportunities.embedding — written after Claude generates the narrative
   Text embedded: opportunity summary + " " + opportunity thesis
   e.g. "Oil momentum building on conflict probability rise. Polymarket
         pricing Iran attack at 56%, corroborated by USO volume spike..."

   Used for: finding the 3 most semantically similar past opportunities
   on every future signal. Answers: "have we seen this before and what
   happened?" If a similar opportunity in Feb 2024 returned +4.1%,
   Claude can reference it in the narrative.

   Query in correlator:
     SELECT *, 1-(embedding <=> $vec::vector) AS similarity
     FROM opportunities
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $vec::vector
     LIMIT 3

WHAT POWERS THIS — pgvector + HNSW index:
  pgvector is a PostgreSQL extension that adds a vector column type and
  similarity search operators. The HNSW index (Hierarchical Navigable
  Small World) makes nearest-neighbor search fast even at millions of rows.
  The <=> operator is cosine distance — 0 means identical, 2 means opposite.
  1 - (embedding <=> other) gives a similarity score between 0 and 1.

COST:
  OpenAI text-embedding-3-small costs $0.02 per million tokens.
  Each signal embeds ~5 words. Each opportunity embeds ~50 words.
  At 1000 signals and 100 opportunities per day: fractions of a cent daily.

WHAT EMBEDDINGS DO NOT DO:
  They do not make trading decisions. They do not detect signals.
  They do not validate hypotheses. They only provide historical context
  to Claude so it can write a better narrative. The model and backtester
  make decisions. Embeddings add memory.

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
  symbol     TEXT NOT NULL,   -- ticker (e.g. 'USO', 'XOM') or Polymarket market ID
  threshold  NUMERIC,         -- optional per-user detection sensitivity override
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, source, symbol)
);

-- IMPORTANT: users never manage subscriptions directly in the UI.
-- subscriptions is a DERIVED table, populated automatically by the category resolver.
-- Users subscribe to market categories (see market_category_subscriptions below).
-- The resolver expands categories to symbols and syncs this table.
-- All existing code that reads subscriptions (producers, fan-out, signal scoping) is unchanged.

CREATE TABLE market_category_subscriptions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   TEXT NOT NULL CHECK (category IN (
               'oil_energy', 'us_equities', 'crypto',
               'rates_macro', 'commodities', 'fx'
             )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, category)
);

-- WHAT MARKET CATEGORIES ARE AND HOW THEY WORK
--
-- Users think in markets, not tickers. "I want oil trades" not
-- "I want USO, XOM, XLE, LNG subscriptions individually."
-- market_category_subscriptions is what users actually manage in the UI.
-- The subscriptions table is derived from it automatically.
--
-- CATEGORY → SYMBOL MAPPING (defined in src/config/market_categories.py):
--   oil_energy:  USO, XOM, XLE, LNG
--   us_equities: SPY, QQQ, AAPL, MSFT, NVDA
--   crypto:      BTC-USD, ETH-USD, SOL-USD
--   rates_macro: TLT, GLD, SLV
--   commodities: GLD, SLV, UNG, WEAT
--   fx:          [] (placeholder — requires forex data source)
--
-- HOW RESOLUTION WORKS:
--   When a user subscribes to a category (onboarding or settings), the resolver runs:
--   1. Reads all user's active categories from market_category_subscriptions
--   2. Expands each category to its symbols via CATEGORY_SYMBOLS map
--   3. For each symbol + each source (polymarket, news, analytics):
--      INSERT INTO subscriptions ... ON CONFLICT DO NOTHING
--   4. Removes subscriptions for symbols no longer in any active category
--   The subscriptions table is always a clean reflection of the user's categories.
--
-- ADDING A NEW SYMBOL TO A CATEGORY:
--   Add the symbol to symbol_registry and to CATEGORY_SYMBOLS in market_categories.py.
--   Run the resolver for all users (scripts/resolve_all_users.py).
--   All users with that category active now receive signals for the new symbol.
--   No user action required.
--
-- HOW SUBSCRIPTIONS ARE CREATED (updated flow):
--   1. Onboarding step 3: user selects market categories → writes to
--      market_category_subscriptions → resolver runs immediately → subscriptions populated
--   2. Settings page: user toggles categories → same flow
--   3. POST /api/categories — body: { category } — adds one category, triggers resolver
--   4. DELETE /api/categories/:category — removes category, resolver removes stale symbols
--   Users never POST to /api/subscriptions directly. That route is internal only.
--
-- SEEDING FOR DEVELOPMENT:
--   scripts/seed_test_user.py creates a test user with 'oil_energy' and 'us_equities'
--   categories. The resolver runs automatically and populates subscriptions.

-- WHAT SUBSCRIPTIONS DO — unchanged, read before touching producers or fan-out
--
-- PURPOSE 1 — PRODUCERS: what to fetch
--   SELECT DISTINCT symbol FROM subscriptions WHERE source = 'polymarket'
--   Producers fetch only symbols that at least one user is subscribed to.
--
-- PURPOSE 2 — FAN-OUT: who to notify
--   SELECT DISTINCT u.* FROM users u JOIN subscriptions s ON s.user_id = u.id
--   WHERE s.symbol = ANY(opportunity.tickers)
--   Fan-out finds users watching the opportunity's tickers.
--
-- PURPOSE 3 — SIGNAL FEED SCOPING
--   SELECT s.* FROM signals s
--   JOIN subscriptions sub ON sub.symbol = s.symbol AND sub.source = s.source
--   WHERE sub.user_id = $user_id
--   Signal history scoped to user's subscribed symbols.
--
-- THE threshold COLUMN
--   Per-subscription sensitivity override. Set by advanced users via API only.
--   Not exposed in the category-based UI.

-- PURPOSE 1 — PRODUCERS: what to fetch
--   Producers do NOT pull all available data from their APIs.
--   They query subscriptions first to find which symbols any user cares about,
--   then fetch only those. Without this, the Polymarket producer would try to
--   track thousands of markets. With it, it only tracks the ones users subscribed to.
--
--   Example — polymarket_producer:
--     symbols = SELECT DISTINCT symbol FROM subscriptions WHERE source = 'polymarket'
--     for each symbol: fetch from Polymarket API, publish to raw.polymarket
--
--   Example — news_producer:
--     tickers = SELECT DISTINCT symbol FROM subscriptions WHERE source = 'news'
--     for each ticker: fetch from Finnhub, publish to raw.news
--
-- PURPOSE 2 — FAN-OUT: who to notify
--   When the ai-correlator finds an opportunity on USO, it does not push a strategy
--   to every user. It queries subscriptions to find only users who subscribed to USO,
--   then pushes only to them via Redis pub/sub → SSE.
--
--   Example — fan_out.py:
--     users = SELECT DISTINCT u.* FROM users u
--             JOIN subscriptions s ON s.user_id = u.id
--             WHERE s.symbol = ANY(opportunity.tickers)
--     for each user: build strategy, publish to Redis strategies:{user_id}
--
-- PURPOSE 3 — SIGNAL FEED SCOPING: what each user sees
--   The correlator page and signal history queries scope results to the user's
--   subscribed symbols. Users only see signals relevant to what they care about.
--
--   Example — GET /api/signals:
--     SELECT s.* FROM signals s
--     JOIN subscriptions sub ON sub.symbol = s.symbol AND sub.source = s.source
--     WHERE sub.user_id = $user_id
--     ORDER BY s.created_at DESC
--
-- THE threshold COLUMN
--   Each subscription can override the default detection threshold for that symbol.
--   If a user wants to be notified on smaller Polymarket conviction shifts than the
--   system default (0.10), they set threshold = 0.05 on their subscription.
--   Consumers check this per-subscription threshold during detection, falling back
--   to the system default if threshold is NULL.
--
-- SEEDING FOR DEVELOPMENT (updated):
--   scripts/seed_test_user.py — creates test user with oil_energy + us_equities
--   categories, runs resolver, populates subscriptions automatically.
--   The old seed_subscriptions.py and seed_stock_subscriptions.py are replaced
--   by seed_test_user.py which uses the category flow end to end.

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

### What TimescaleDB is and why it exists in this system

TimescaleDB is a PostgreSQL extension that makes PostgreSQL fast for time-series data.
It is NOT a separate database technology — it uses the same PostgreSQL wire protocol,
the same SQL syntax, the same pg client libraries. The only difference is that tables
declared as "hypertables" are automatically partitioned by time under the hood, which
makes time-range queries (e.g. "give me all USO features from the last 90 days") orders
of magnitude faster than a plain PostgreSQL table at scale.

WHY TWO DATABASES INSTEAD OF ONE?

The app DB (PostgreSQL, port 5432) stores relational data:
  users, subscriptions, signals, opportunities, strategies, trades, positions.
  These are looked up by ID, joined by foreign key, queried by user.
  Access pattern: point lookups, joins, inserts of individual rows.

The historical DB (TimescaleDB, port 5433) stores time-series data:
  raw_polymarket, raw_news, raw_ohlcv, raw_options, raw_macro, features.
  These are always queried by symbol + time range, never by ID.
  Access pattern: range scans over millions of rows, aggregations, as-of queries.

Mixing both into one database would mean tuning PostgreSQL for two completely
different workloads simultaneously. Keeping them separate lets each be tuned,
backed up, and scaled independently. pgAdmin connects to both from one UI.

WHAT LIVES IN TIMESCALEDB — THE FIVE CATEGORIES:

1. RAW SOURCE TABLES (raw_polymarket, raw_news, raw_ohlcv, raw_options, raw_macro)
   Append-only. Written by consumers as events arrive from Redpanda.
   Never updated, never deleted. These are the source of truth.
   If feature logic changes, features are recomputed FROM these tables.
   Think of them as an immutable event log.

2. THE FEATURE STORE (features table)
   The most important table in the system. One row per symbol per hour.
   Every row contains every known feature value at that moment in time —
   poly_conviction_delta, news_sentiment, rsi_14, vol_ratio_30d, vix_level, etc.
   Also contains forward_return_5d (the outcome label, filled in nightly).
   This is what the XGBoost model trains on and scores against.
   Written by: feature-builder service (hourly).
   Labels filled by: label-filler service (nightly).

3. TECHNICALS (pre-computed RSI, MACD, Bollinger, ATR, ADX)
   Computed once nightly by the historical ingestor.
   Stored so feature-builder can read them cheaply without recomputing
   pandas-ta indicators on every hourly snapshot.

4. MACRO INDICATORS (FRED series: VIX, WTI, 10Y yield, fed funds, USD index)
   Pulled nightly from the FRED API.
   Used by: feature-builder (adds macro columns to each feature row),
            Claude prompt (macro snapshot in every narrative),
            price chart page (macro overlay).

5. CONTINUOUS AGGREGATES (ohlcv_weekly)
   TimescaleDB-native materialized views that update automatically.
   Used by the price chart page for weekly candlestick data without
   running expensive GROUP BY queries on every page load.

WHAT TIMESCALEDB GIVES YOU THAT PLAIN POSTGRES CANNOT:

- Hypertables: automatic time-based partitioning. A query for "last 90 days"
  only scans the relevant partitions, not the entire table.

- Compression: historical chunks older than 7 days are compressed ~90%.
  2 years of OHLCV for 20 symbols goes from ~50 GB to ~5 GB on disk.
  Critical for running on a MacBook with 256 GB storage.

- Continuous aggregates: pre-computed rollups that stay fresh automatically.
  Weekly OHLCV is always ready, no GROUP BY on every chart load.

- as-of queries: "give me the latest macro value at or before timestamp T"
  is extremely common in feature building and is fast with hypertable indexes.

POINT-IN-TIME CORRECTNESS — THE MOST IMPORTANT RULE:

Every value written to the features table must have been knowable at that
timestamp. No lookahead. This means:
  - poly_conviction_delta_1h at T uses only Polymarket data up to T
  - news_sentiment_4h at T uses only articles published before T
  - forward_return_5d at T looks FORWARD — it is only safe to write for
    historical rows, never for the current live row (label_filled_at is NULL
    on live rows and filled nightly once the outcome is known)

Violating this rule makes your backtest results look great and your live
system lose money. The feature builder enforces this with as-of queries:
  SELECT yes_price FROM raw_polymarket WHERE symbol=$1 AND ts <= $2 ORDER BY ts DESC LIMIT 1
                                                               ^^^^^^^^
                                                               always at-or-before, never after

HOW IT CONNECTS TO THE REST OF THE SYSTEM:

  consumers → write raw_* tables (on every event)
  feature-builder → reads raw_* tables, writes features (hourly)
  label-filler → reads raw_ohlcv, updates features.forward_return_5d (nightly)
  historical-ingestor → writes raw_ohlcv + raw_macro in bulk (nightly)
  ai-correlator → reads features to score predictions (on every signal)
  ml/train.py → reads features WHERE forward_return_5d IS NOT NULL (weekly)
  Next.js /api/history/[symbol] → reads raw_ohlcv + technicals (chart page)
  Next.js /api/backtests → reads backtest_results from app DB (NOT timescaledb)

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

### What the feature builder does and why it exists

The feature builder is the translator between raw messy data and the clean
numerical input the scoring model needs. It runs every hour and writes one
row per tracked symbol to the features table in TimescaleDB.

WHAT IT DOES EACH HOUR:
  For each symbol (USO, SPY, QQQ, XOM...):
  1. Query raw_polymarket → compute poly_conviction_delta_1h, poly_conviction_delta_4h
  2. Query raw_news       → average sentiment scores, peak hotness over 1h and 4h windows
  3. Query raw_ohlcv      → compute RSI(14), MACD, ATR, Bollinger position, SMA slope,
                            volume ratio vs 30d avg, 1d and 5d price change
  4. Query raw_options    → latest put/call ratio, count unusual sweeps in last 4h
  5. Query raw_macro      → latest VIX, WTI, 10Y yield, fed funds, USD index
  6. Write one row to features with all of the above
     forward_return_5d is written as NULL — the future is unknown

WHY IT EXISTS:
  The XGBoost model cannot read Kafka messages, API responses, or SQL joins
  across six tables. It reads one flat row of numbers where every column
  means the same thing every time. The feature builder creates that row.
  Without it, the model has nothing to read.

THE CRITICAL RULE — POINT-IN-TIME CORRECTNESS:
  Every query uses as-of logic: WHERE ts <= snapshot_time
  This means every value in the row reflects only what was knowable at that moment.
  Never future data. Never the most-recent value if that value came after snapshot_time.

  CORRECT:
    SELECT yes_price FROM raw_polymarket
    WHERE symbol = $1 AND ts <= $2          ← at-or-before snapshot time
    ORDER BY ts DESC LIMIT 1

  WRONG:
    SELECT yes_price FROM raw_polymarket
    WHERE symbol = $1
    ORDER BY ts DESC LIMIT 1               ← gives current value, not value AT snapshot

  Violating this rule makes backtests look great and live trading lose money.
  The model accidentally learns to use future information and appears to predict
  the future during training, then fails completely on live data.

HOW IT RELATES TO THE LABEL FILLER:
  Feature builder writes the row but leaves forward_return_5d = NULL.
  It cannot know what the price will do in 5 days.
  The label filler runs nightly, finds rows now 5+ trading days old,
  looks up the actual price outcome, and fills in forward_return_5d.
  This turns the feature row from a question into a question + answer.
  The model trains only on rows where forward_return_5d is not null.

  feature builder (hourly)  → writes row, forward_return_5d = NULL
  label filler (nightly)    → fills forward_return_5d = +0.042 (or whatever happened)
  model trainer (weekly)    → reads labeled rows, learns what predicts outcomes

WHERE IT SITS IN THE PIPELINE:
  consumers write raw_* tables (on every event from Redpanda)
  feature builder reads raw_* tables and writes features (every hour)
  scoring model reads features and outputs a probability (on every signal)
  feature builder is the bridge — everything upstream is data collection,
  everything downstream is intelligence

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

READ THIS BEFORE STARTING:
- Build strictly in order. Phase N+1 does not start until Phase N is verified working.
- Each phase ends with explicit verification steps. Run them. Do not assume.
- If a verification step fails, fix it before moving on.
- The prompt to give Claude Code at the start of each phase is included.
- DEV_MODE=true throughout all phases — limits symbols to USO, SPY, QQQ.

---

### Phase 1 — Infrastructure
Goal: every service starts healthy, both databases initialized with correct schemas,
pgAdmin connected to both, Redpanda console accessible.
Estimated time: 1–2 days.

PROMPT FOR CLAUDE CODE:
  "Read eventedge-ai.md fully. Implement Phase 1.
  Create docker-compose.yml using Redpanda (NOT Kafka, NOT Zookeeper).
  Create db/app_schema.sql with the full PostgreSQL + pgvector schema from the spec.
  Create db/history_schema.sql with the full TimescaleDB schema including
  hypertables, indexes, and compression policies.
  Create pgadmin/servers.json pre-connecting both databases.
  Create env/nextjs.env and env/python.env with all variables from the spec (values blank).
  All Python service images must use platform: linux/arm64.
  pgAdmin uses platform: linux/amd64 (no ARM build exists).
  Do not create any application code yet — infrastructure only."

FILES TO CREATE:
  docker-compose.yml
  docker-compose.monitoring.yml       (Prometheus + Grafana, separate file)
  db/app_schema.sql
  db/history_schema.sql
  pgadmin/servers.json
  env/nextjs.env
  env/python.env

COMMANDS TO RUN:
  docker compose up -d
  docker compose ps                   (all services should show "running")
  docker compose logs timescale       (should show "database system is ready")
  docker compose logs postgres        (should show "database system is ready")

VERIFICATION — do not proceed until all pass:
  [ ] localhost:5050 loads pgAdmin
  [ ] pgAdmin shows "App DB" and "Historical DB" in left panel, no connection errors
  [ ] App DB has all tables: users, subscriptions, signals, hypotheses,
      backtest_results, opportunities, strategies, trades, positions
  [ ] Historical DB has all tables: raw_polymarket, raw_news, raw_ohlcv,
      raw_options, raw_macro, features
  [ ] localhost:8080 loads Redpanda console, shows cluster healthy
  [ ] docker compose ps shows no "exited" or "restarting" services

COMMON ISSUES:
  TimescaleDB init fails → check db/history_schema.sql for syntax errors,
    TimescaleDB requires create_hypertable AFTER CREATE TABLE, not before
  pgvector extension missing → ensure CREATE EXTENSION IF NOT EXISTS vector
    is the first line in app_schema.sql
  pgAdmin can't connect → check servers.json host values match service names
    in docker-compose.yml exactly (postgres, timescale — not localhost)

---

### Phase 2 — Data ingest
Goal: real data from Polymarket, Finnhub, and yfinance flowing continuously
into raw_* tables in TimescaleDB. Signals appearing in PostgreSQL when
detection thresholds are crossed.
Estimated time: 3–4 days.

PROMPT FOR CLAUDE CODE:
  "Read eventedge-ai.md fully. Implement Phase 2.
  Phase 1 is complete — all services are running.
  Build the following in order:
  1. src/event_detectors/polymarket_producer/ — polls Polymarket API every 30s,
     publishes to raw.polymarket topic. Dumb — no detection logic whatsoever.
  2. src/event_processors/polymarket_consumer/ — reads raw.polymarket, runs
     conviction.py detection (moved from producer), writes to raw_polymarket
     table in TimescaleDB AND signals table in PostgreSQL when threshold crossed,
     publishes signal ID to Redis new_signal channel.
  3. Repeat pattern for news (Finnhub API → raw.news → news_consumer).
  4. Repeat pattern for analytics (yfinance → raw.analytics → analytics_consumer).
  5. Write the root Dockerfile (Python 3.11-slim, installs pyproject.toml deps,
     runs as module via CMD).
  6. Write pyproject.toml with all dependencies from the spec.
  Key rules:
  - Producers are STATELESS. Zero detection logic. Zero state. Just fetch and publish.
  - Detection algorithms (conviction.py, signal_detector.py) live in consumers only.
  - All DB writes use asyncpg. All Kafka reads/writes use confluent-kafka.
  - Consumers must commit Kafka offsets only after successful DB write."

FILES TO CREATE:
  Dockerfile
  pyproject.toml
  src/__init__.py
  src/event_detectors/polymarket_producer/__init__.py
  src/event_detectors/polymarket_producer/producer.py
  src/event_detectors/news_producer/__init__.py
  src/event_detectors/news_producer/producer.py
  src/event_detectors/analytics_producer/__init__.py
  src/event_detectors/analytics_producer/producer.py
  src/event_processors/polymarket_consumer/__init__.py
  src/event_processors/polymarket_consumer/consumer.py
  src/event_processors/polymarket_consumer/conviction.py
  src/event_processors/news_consumer/__init__.py
  src/event_processors/news_consumer/consumer.py
  src/event_processors/news_consumer/signal_detector.py
  src/event_processors/analytics_consumer/__init__.py
  src/event_processors/analytics_consumer/consumer.py
  src/event_processors/analytics_consumer/signal_detector.py

COMMANDS TO RUN:
  docker compose up -d --build
  docker compose logs polymarket-producer --follow   (watch for poll logs)
  docker compose logs polymarket-consumer --follow   (watch for signal logs)

VERIFICATION — do not proceed until all pass:
  [ ] raw_polymarket table in TimescaleDB has rows (check pgAdmin)
  [ ] raw_news table has rows
  [ ] raw_ohlcv table has rows
  [ ] signals table in PostgreSQL has at least one row
  [ ] Redpanda console shows messages on raw.polymarket, raw.news, raw.analytics
  [ ] No consumer is in a crash loop (docker compose ps)
  [ ] Signals table row has correct source, symbol, type, score, direction values

COMMON ISSUES:
  Kafka connection refused → producers starting before Redpanda is ready,
    add depends_on with condition: service_healthy to docker-compose.yml
  No rows in raw_polymarket → check FINNHUB_API_KEY and Polymarket market IDs
    in seed_subscriptions.py are valid
  Consumer not committing → ensure enable.auto.commit=false and manual commit
    after each successful DB write

---

### Phase 3 — Feature store
Goal: features table populated with real computed values for each symbol,
historical data backfilled 2 years, forward_return_5d labels filling nightly.
Estimated time: 2–3 days.

PROMPT FOR CLAUDE CODE:
  "Read eventedge-ai.md fully. Implement Phase 3.
  Phases 1 and 2 are complete — raw data is flowing into raw_* tables.
  Build the following:
  1. src/historical/ingestor.py — pulls 2 years OHLCV via yfinance and FRED
     macro series via fredapi. Writes to raw_ohlcv and raw_macro tables.
     Must support --backfill flag for first-run and normal nightly mode.
     DEV_MODE=true limits to symbols: USO, SPY, QQQ and lookback: 6 months.
  2. src/feature_store/builder.py — FeatureBuilder class with build_snapshot()
     method. Reads from raw_* tables using as-of queries (WHERE ts <= snapshot_ts).
     Computes all 22 features. Writes one row to features table per symbol per call.
     CRITICAL: every query must use WHERE ts <= snapshot_timestamp, never current time.
  3. src/feature_store/label_filler.py — fill_labels() function. Finds features rows
     where forward_return_5d IS NULL and ts is older than 5 trading days.
     Looks up actual price outcome from raw_ohlcv. Writes forward_return_5d.
  4. src/feature_store/scheduler.py — runs build_snapshot() for all symbols
     every hour. Runs fill_labels() nightly at 01:00 UTC.
  All as-of queries must use WHERE ts <= $snapshot_time ORDER BY ts DESC LIMIT 1.
  Never use ORDER BY ts DESC LIMIT 1 without the WHERE ts <= constraint."

FILES TO CREATE:
  src/historical/__init__.py
  src/historical/ingestor.py
  src/historical/sources/yfinance_source.py
  src/historical/sources/fred_source.py
  src/feature_store/__init__.py
  src/feature_store/builder.py
  src/feature_store/label_filler.py
  src/feature_store/normalizer.py
  src/feature_store/scheduler.py

COMMANDS TO RUN:
  # run historical backfill manually first (outside Docker)
  python src/historical/ingestor.py --backfill

  # run feature builder over historical data
  python src/feature_store/scheduler.py --backfill

  # run label filler
  python src/feature_store/label_filler.py

  # then start the scheduler as a container
  docker compose up -d --build feature-builder

VERIFICATION — do not proceed until all pass:
  [ ] raw_ohlcv table has rows going back ~6 months for USO, SPY, QQQ
  [ ] raw_macro table has rows for VIXCLS, DCOILWTICO, DGS10, FEDFUNDS, DTWEXBGS
  [ ] features table has rows with non-null values for price features
      (rsi_14, macd_histogram, vol_ratio_30d should have values)
  [ ] features table rows older than 5 trading days have forward_return_5d populated
  [ ] features table rows from today have forward_return_5d = NULL
  [ ] No NULL values for macro features (vix_level, wti_crude, etc.) on historical rows
  [ ] Run this query in pgAdmin — should return > 0:
      SELECT COUNT(*) FROM features WHERE forward_return_5d IS NOT NULL

COMMON ISSUES:
  yfinance rate limiting → add time.sleep(1) between symbol downloads
  FRED series not found → verify series IDs: VIXCLS, DCOILWTICO, DGS10,
    FEDFUNDS, DTWEXBGS are correct (check fred.stlouisfed.org)
  forward_return_5d not filling → check that raw_ohlcv has enough future
    bars after the feature row timestamps (need 5+ trading days of data ahead)

---

### Phase 4 — AI correlator with rule scorer
Goal: full end-to-end pipeline working. Signal fires → correlator runs →
strategy appears in browser → Alpaca paper order executes on confirm.
The XGBoost model is NOT used yet — rule_scorer.py is the placeholder.
Estimated time: 3–4 days.

PROMPT FOR CLAUDE CODE:
  "Read eventedge-ai.md fully. Implement Phase 4.
  Phases 1, 2, 3 are complete — data is flowing and features are being built.
  Build the following in order:
  1. src/ml/rule_scorer.py — the rule-based scoring placeholder as specified.
  2. src/ai_correlator/correlator.py — full correlator pipeline using rule_scorer
     (not XGBoost). Reads signal from PostgreSQL, checks 15-min time window,
     matches hypothesis (stub — return a hardcoded test hypothesis for now),
     runs rule scorer, calls Claude API, embeds result, saves opportunity,
     calls fan_out.
  3. src/ai_correlator/fan_out.py — queries subscriptions, builds per-user
     strategy, publishes to Redis strategies:{user_id}.
  4. src/web/ — Next.js app. Start with the minimum viable frontend:
     - app/layout.tsx (root layout, DM Sans + DM Mono fonts from Google Fonts)
     - app/(dashboard)/layout.tsx (NavSidebar)
     - app/(dashboard)/page.tsx (strategy inbox — just the card feed and SSE hook)
     - app/api/auth/[...nextauth]/route.ts (NextAuth credentials provider)
     - app/api/strategies/stream/route.ts (SSE route, nodejs runtime)
     - app/api/trades/route.ts (Alpaca execution)
     - lib/db.ts, lib/redis.ts, lib/auth.ts, lib/alpaca.ts
  5. Seed one test user and categories for testing:
     Run: python scripts/seed_test_user.py
     This creates test@test.com with oil_energy + us_equities categories
     and runs the resolver to populate subscriptions automatically.
  The strategy inbox only needs to show strategy cards arriving via SSE.
  No detail panel, no confirm flow yet — just prove SSE delivery works."

FILES TO CREATE:
  src/ml/__init__.py
  src/ml/rule_scorer.py
  src/ai_correlator/__init__.py
  src/ai_correlator/correlator.py
  src/ai_correlator/fan_out.py
  src/ai_correlator/prompt.py
  src/web/package.json
  src/web/tsconfig.json
  src/web/next.config.ts
  src/web/tailwind.config.ts
  src/web/app/layout.tsx
  src/web/app/(dashboard)/layout.tsx
  src/web/app/(dashboard)/page.tsx
  src/web/app/api/auth/[...nextauth]/route.ts
  src/web/app/api/strategies/stream/route.ts
  src/web/app/api/trades/route.ts
  src/web/lib/db.ts
  src/web/lib/redis.ts
  src/web/lib/auth.ts
  src/web/lib/alpaca.ts
  src/web/hooks/useStrategyStream.ts
  scripts/seed_test_user.py

COMMANDS TO RUN:
  docker compose up -d --build
  # trigger a test signal manually to prove the pipeline
  python scripts/publish_test_events.py   (already exists in your repo)

VERIFICATION — do not proceed until all pass:
  [ ] localhost:3000 loads and shows the strategy inbox page
  [ ] Sign in with test@test.com / password123 works
  [ ] A test signal published manually triggers the correlator
  [ ] An opportunity row appears in the opportunities table (pgAdmin)
  [ ] A strategy row appears in the strategies table
  [ ] The strategy card appears in the browser without page refresh (SSE working)
  [ ] Clicking confirm (or whatever placeholder button exists) submits a
      paper order to Alpaca and a trade row appears in the trades table
  [ ] Check Alpaca paper trading dashboard — order should be visible there

COMMON ISSUES:
  SSE connection drops immediately → check runtime = "nodejs" is set on the
    stream route, not edge runtime
  Correlator not waking up → check Redis is publishing to "new_signal" channel
    and correlator is subscribed to same channel name
  Alpaca order rejected → check ALPACA_KEY_ID and ALPACA_SECRET_KEY in env,
    verify is_paper=true matches the paper trading endpoint
  NextAuth session undefined → check NEXTAUTH_SECRET is set and
    NEXTAUTH_URL matches the actual URL

---

### Phase 5 — ML model
Goal: XGBoost model trained on real labeled data, SHAP values flowing through
to Claude narratives, rule scorer retired.
Estimated time: 2–3 days.
PREREQUISITE: Phase 3 must have been running for at least 2 weeks to accumulate
enough labeled rows. Check: SELECT COUNT(*) FROM features WHERE forward_return_5d IS NOT NULL
If count < 200, wait longer or proceed with the rule scorer still active.

PROMPT FOR CLAUDE CODE:
  "Read eventedge-ai.md fully. Implement Phase 5.
  Phases 1-4 are complete and the pipeline is running end-to-end.
  The features table now has labeled rows (forward_return_5d IS NOT NULL).
  Build the following:
  1. src/ml/train.py — full training script as specified. Connects to TimescaleDB
     at localhost:5433. Loads all labeled rows. Trains XGBoost with TimeSeriesSplit.
     Saves models/scoring_model.json and models/shap_explainer.pkl.
     Prints final cross-val accuracy and feature importance summary.
  2. Update src/ai_correlator/correlator.py — swap rule_scorer import for XGBoost.
     Load model and explainer from /app/models/ (the mounted path inside container).
     If model files don't exist, fall back to rule_scorer automatically.
     Compute SHAP values for each prediction. Pass top 5 to build_prompt().
  Create a models/ directory in the repo root with a .gitkeep file.
  Add models/*.json and models/*.pkl to .gitignore."

FILES TO CREATE / MODIFY:
  src/ml/train.py                       (new)
  src/ai_correlator/correlator.py       (modify — swap scorer, add SHAP)
  models/.gitkeep                       (new — empty placeholder)
  .gitignore                            (modify — add models/*.json, models/*.pkl)

COMMANDS TO RUN:
  # run outside Docker in local Python virtualenv
  cd eventedge-ai
  python -m venv .venv
  source .venv/bin/activate
  pip install xgboost shap scikit-learn asyncpg pandas
  python src/ml/train.py

  # verify model files exist
  ls -la models/

  # restart correlator to pick up new model
  docker compose restart ai-correlator

VERIFICATION — do not proceed until all pass:
  [ ] models/scoring_model.json exists and is > 0 bytes
  [ ] models/shap_explainer.pkl exists and is > 0 bytes
  [ ] train.py prints training accuracy and does not error
  [ ] After correlator restart, opportunities table shows top_features column
      is populated with SHAP values (not null, not empty array)
  [ ] Claude narrative in opportunities.thesis references specific feature names
      (not generic text — it should mention the actual top features)
  [ ] docker compose logs ai-correlator shows "XGBoost model loaded" not
      "rule-based scorer active"

COMMON ISSUES:
  Not enough labeled data → wait longer, run label filler manually:
    python src/feature_store/label_filler.py
  TimeSeriesSplit error → check that data is sorted by ts ASC before splitting
  SHAP not serializable → ensure top_features list uses Python native types
    (float, int, str), not numpy types — use float(x), int(x) explicitly

---

### Phase 6 — Full frontend
Goal: all six pages built, full design system implemented, every user flow
working end-to-end. No placeholder UI remaining.
Estimated time: 5–7 days.

PROMPT FOR CLAUDE CODE:
  "Read eventedge-ai.md fully. Implement Phase 6.
  The backend pipeline is complete. Now build the full frontend.
  Design system rules (non-negotiable):
  - Every number, price, score, percentage, ticker, timestamp: DM Mono font
  - Every label: 10px, uppercase, letter-spacing 0.06em, color var(--dim)
  - Color tokens exactly as specified in the design system section
  - Dark mode is the default
  - No spinner components — always use skeleton loaders matching content shape
  Build in this order (do not start next until current is verified):
  1. globals.css — all CSS variables, DM Sans + DM Mono Google Fonts import
  2. components/ui/ — Badge, StatCell, SectionLabel, LiveDot, Pill, Skeleton, Toast, Modal
  3. components/layout/NavSidebar.tsx
  4. Strategy inbox — full StrategyCard, StrategyDetail, ConfirmFooter with
     3-second hold-to-confirm, BacktestStats with disclaimer, SizingBreakdown,
     MacroGrid, SignalList
  5. Signal correlator page — SignalTable, PipelineSteps, SourceHealth, StatsBar
  6. Price chart page — Recharts ComposedChart, OHLCV candlesticks, volume bars,
     RSI subchart, MACD subchart, Bollinger overlay, backtest entry markers
  7. Backtest explorer — sortable table, expandable row detail
  8. Trade history — AccountSummary, PositionsTable, ClosedTradesTable
  9. Settings — RiskSelector (three cards), MarketCategorySelector (category cards
     with toggle state — same cards as onboarding step 3, shows active/inactive,
     clicking toggles the category and triggers resolver), AlpacaConnect.
     No individual ticker management in settings. Users only manage categories.
  10. Onboarding flow — 5 steps, saves to DB at each Continue click,
      resumes from last incomplete step on reload.
      Step 3 writes to market_category_subscriptions and calls resolver immediately.
  The confirm button must require a 3-second hold. Paper mode = blue button.
  Live mode = green button. Never auto-execute without the hold completing."

FILES TO CREATE:
  src/web/app/globals.css
  src/web/components/ui/Badge.tsx
  src/web/components/ui/StatCell.tsx
  src/web/components/ui/SectionLabel.tsx
  src/web/components/ui/LiveDot.tsx
  src/web/components/ui/Pill.tsx
  src/web/components/ui/Skeleton.tsx
  src/web/components/ui/Toast.tsx
  src/web/components/ui/Modal.tsx
  src/web/components/layout/NavSidebar.tsx
  src/web/components/strategy/StrategyCard.tsx
  src/web/components/strategy/StrategyDetail.tsx
  src/web/components/strategy/ConfirmFooter.tsx
  src/web/components/strategy/BacktestStats.tsx
  src/web/components/strategy/SignalList.tsx
  src/web/components/strategy/SizingBreakdown.tsx
  src/web/components/strategy/MacroGrid.tsx
  src/web/components/correlator/SignalTable.tsx
  src/web/components/correlator/PipelineSteps.tsx
  src/web/components/correlator/SourceHealth.tsx
  src/web/components/correlator/StatsBar.tsx
  src/web/components/chart/PriceChart.tsx
  src/web/components/chart/IndicatorPanel.tsx
  src/web/components/backtest/BacktestTable.tsx
  src/web/components/trades/AccountSummary.tsx
  src/web/components/trades/TradesTable.tsx
  src/web/components/settings/RiskSelector.tsx
  src/web/components/settings/MarketCategorySelector.tsx  # category cards, not ticker table
  src/web/components/settings/AlpacaConnect.tsx
  src/web/components/onboarding/OnboardingFlow.tsx
  src/web/app/(dashboard)/correlator/page.tsx
  src/web/app/(dashboard)/chart/page.tsx
  src/web/app/(dashboard)/backtests/page.tsx
  src/web/app/(dashboard)/trades/page.tsx
  src/web/app/(dashboard)/settings/page.tsx
  src/web/app/onboarding/page.tsx
  src/web/app/api/signals/route.ts
  src/web/app/api/backtests/route.ts
  src/web/app/api/history/[symbol]/route.ts
  src/web/app/api/categories/route.ts     # POST/DELETE — adds/removes a market category,
                                          # triggers resolver. Internal: subscriptions table
                                          # is populated automatically, never by the user.
  src/web/hooks/useAlpacaAccount.ts
  src/web/hooks/useCountdown.ts
  src/config/market_categories.py         # CATEGORY_SYMBOLS mapping
  scripts/resolve_category_subscriptions.py  # resolves one user's categories to subscriptions
  scripts/resolve_all_users.py            # runs resolver for all users (use when adding new symbol)

VERIFICATION — do not proceed until all pass:
  [ ] All six pages load without console errors
  [ ] New strategy arrives via SSE without page refresh
  [ ] Confirm button requires 3-second hold — single click does nothing
  [ ] Paper mode shows blue confirm button, PAPER MODE pill in topbar
  [ ] Backtest stats section always shows disclaimer text
  [ ] Dropped signals show at 45% opacity with drop reason visible
  [ ] Onboarding saves at each step — refresh mid-flow resumes at same step
  [ ] Price chart renders candlesticks with RSI subchart togglable
  [ ] Settings Alpaca connect form shows success with account equity on valid keys
  [ ] All numbers on all pages render in DM Mono font (inspect with browser devtools)

---

### Phase 7 — Hypothesis library
Goal: named hypotheses driving predictions, backtester validating them against
feature store history, Claude authoring assistant for new hypotheses,
rule scorer fully retired.
Estimated time: 3–4 days.

PROMPT FOR CLAUDE CODE:
  "Read eventedge-ai.md fully. Implement Phase 7.
  All previous phases are complete. Now build the hypothesis library.
  1. Write scripts/seed_hypotheses.py — inserts 10 initial hypotheses into the
     hypotheses table. Each hypothesis must have specific numeric thresholds
     in feature_conditions (not vague descriptions). Start with these:
     - geopolitical_oil_squeeze: poly_conviction_delta_1h > 0.10 AND
       vol_ratio_30d > 2.0 AND news_sentiment_1h > 0.70, target USO, direction up
     - oversold_momentum_reversal: rsi_14 < 28 AND price_change_5d < -0.05 AND
       vol_ratio_30d > 1.5, target SPY/QQQ, direction up
     - unusual_call_buying: put_call_ratio < 0.35 AND unusual_sweep_count_4h > 2
       AND vol_ratio_30d > 1.8, direction up
     - macro_risk_off: vix_level > 25 AND price_change_1d < -0.02 AND
       us_10y_yield > 4.5, direction down
     Add 6 more that make logical sense given available features.
  2. Build src/backtester/backtester.py — SignalBacktester class as specified.
     Queries features table WHERE conditions match AND forward_return_5d IS NOT NULL.
     Computes win_rate, avg_return_pct, expectancy, sharpe, max_drawdown_pct.
     Returns passed=True only if sample_size >= 30 AND win_rate >= 0.55.
  3. Update src/ai_correlator/correlator.py — replace the stub match_hypothesis
     with real hypothesis matching against the hypotheses table.
     Add real backtester call after hypothesis match.
  4. Build src/ai_correlator/hypothesis_author.py — takes natural language
     description from user, queries available feature names from features table
     schema, calls Claude to generate hypothesis JSON, validates it, returns it
     for human review before inserting.
  5. Add POST /api/hypotheses route in Next.js — accepts natural language,
     calls hypothesis_author, returns proposed hypothesis for user to review.
  6. Add hypothesis management UI to settings page — list active hypotheses,
     show their backtest stats, allow deactivating ones with poor performance.
  After Phase 7, rule_scorer.py still exists as a fallback but should never
  fire in normal operation. The correlator should log a warning if it falls
  back to the rule scorer."

FILES TO CREATE / MODIFY:
  scripts/seed_hypotheses.py            (new)
  src/backtester/__init__.py            (new)
  src/backtester/backtester.py          (new)
  src/backtester/metrics.py             (new)
  src/ai_correlator/correlator.py       (modify — real hypothesis matching)
  src/ai_correlator/hypothesis_author.py (new)
  src/web/app/api/hypotheses/route.ts   (new)
  src/web/components/settings/HypothesisManager.tsx (new)

COMMANDS TO RUN:
  python scripts/seed_hypotheses.py
  # verify hypotheses exist
  # in pgAdmin: SELECT name, is_active FROM hypotheses

VERIFICATION — all phases complete when these pass:
  [ ] hypotheses table has >= 10 rows, all is_active = true
  [ ] Backtester runs against feature store and produces win_rate, sample_size
  [ ] At least one hypothesis passes backtester (win_rate >= 0.55, n >= 30)
  [ ] Opportunities table shows hypothesis_id populated (not null)
  [ ] Backtest_results table shows passed=true rows linked to opportunities
  [ ] Correlator logs show "hypothesis matched: geopolitical_oil_squeeze"
      not "rule-based scorer active"
  [ ] Hypothesis manager in settings shows active hypotheses with their stats
  [ ] Entering a trade idea in plain English returns a valid hypothesis JSON
      for review before inserting
  [ ] Full pipeline runs without any placeholder code in the hot path:
      real data → real features → real hypothesis match → real backtest →
      real XGBoost score → SHAP values → Claude narrative → strategy → SSE →
      user confirms → Alpaca paper order

---

### After all phases — ongoing operations

WEEKLY (manual or cron):
  python src/ml/train.py
  docker compose restart ai-correlator
  # check new model improved on previous — compare cross-val accuracy

NIGHTLY (automated via scheduler):
  python src/feature_store/label_filler.py    (fills forward_return_5d)
  python src/historical/ingestor.py           (pulls yesterday's OHLCV + FRED)

MONTHLY:
  Review hypothesis backtest stats in pgAdmin
  Deactivate hypotheses where win_rate < 0.50 or sample_size stagnated
  Add new hypotheses via the hypothesis author tool
  docker system df                            (check Docker disk usage)
  docker system prune --volumes               (if disk > 50 GB)

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

---

## Multi-market support

NOTE: This section describes work NOT yet implemented in the build phases above.
The phases (1-7) build the system with a hardcoded symbol list (USO, SPY, QQQ, XOM).
This section describes what to add AFTER Phase 7 is complete and working to make
the symbol list dynamic and support all asset classes. Do not implement this during
the main phases — it is a post-phase-7 extension.

### What already works across all markets (no changes needed)

The following components are already fully instrument-agnostic and require zero
changes to support new symbols or asset classes:

- features table schema — a row is just (symbol, ts, 22 columns). Symbol can be anything.
- hypothesis library — target_symbol is a free-text field. Works for any symbol.
- ai-correlator — operates on whatever symbol the signal came from.
- fan-out — finds subscribed users for any ticker in the opportunity.
- Claude prompt — receives symbol as a string, asset class agnostic.
- SSE delivery, strategy builder, PostgreSQL schema — all symbol agnostic.
- Alpaca — supports US equities and crypto natively in one API.
- XGBoost model — already handles null features (fillna(0)), works across classes.

### What needs to change for full market support

#### 1. Symbol registry table (add to app_schema.sql)

Replaces the hardcoded SYMBOLS list in feature_store/builder.py and all seed scripts.
Everything that currently reads from a hardcoded list reads from this table instead.

```sql
CREATE TABLE symbol_registry (
  symbol          TEXT PRIMARY KEY,
  asset_class     TEXT NOT NULL CHECK (asset_class IN (
                    'us_equity', 'commodity', 'crypto', 'rates', 'fx'
                  )),
  data_sources    TEXT[] NOT NULL,  -- ['yfinance', 'finnhub', 'options']
  polymarket_id   TEXT,             -- linked Polymarket market ID if one exists
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  trading_hours   TEXT NOT NULL DEFAULT 'us_market',
                  -- 'us_market' | '24h' | 'futures'
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- initial symbols
INSERT INTO symbol_registry VALUES
  ('USO',    'commodity', ARRAY['yfinance','finnhub','options'], 'iran-oil-market-id', true, 'us_market'),
  ('SPY',    'us_equity', ARRAY['yfinance','finnhub','options'], null,                 true, 'us_market'),
  ('QQQ',    'us_equity', ARRAY['yfinance','finnhub','options'], null,                 true, 'us_market'),
  ('XOM',    'us_equity', ARRAY['yfinance','finnhub','options'], null,                 true, 'us_market'),
  ('XLE',    'us_equity', ARRAY['yfinance','finnhub','options'], null,                 true, 'us_market'),
  ('LNG',    'us_equity', ARRAY['yfinance','finnhub'],           null,                 true, 'us_market'),
  ('GLD',    'commodity', ARRAY['yfinance','finnhub'],           null,                 true, 'us_market'),
  ('TLT',    'rates',     ARRAY['yfinance','finnhub'],           null,                 true, 'us_market'),
  ('BTC-USD','crypto',    ARRAY['yfinance'],                     'btc-price-market-id',true, '24h'),
  ('ETH-USD','crypto',    ARRAY['yfinance'],                     null,                 true, '24h');
```

After this table exists, update feature_store/builder.py to query it:
```python
symbols = await db.fetch(
    "SELECT symbol, asset_class, data_sources, trading_hours FROM symbol_registry WHERE is_active = TRUE"
)
```

#### 2. Asset-class-aware feature building

Not every feature applies to every asset class:
- Crypto has no options flow (put_call_ratio, unusual_sweep_count_4h will be null)
- Rates instruments rarely have Polymarket markets or meaningful news sentiment
- FX has no options flow and no Polymarket coverage

The feature builder checks which features to compute per asset class:

```python
FEATURES_BY_CLASS = {
    "us_equity": ["poly", "news", "price", "options", "macro"],
    "commodity": ["poly", "news", "price", "macro"],
    "crypto":    ["poly", "news", "price", "macro"],
    "rates":     ["price", "macro"],
    "fx":        ["price", "macro"],
}

async def build_snapshot(self, symbol: str, asset_class: str, ts: datetime) -> dict:
    features = {"ts": ts, "symbol": symbol}
    sources  = FEATURES_BY_CLASS[asset_class]
    if "poly"    in sources: features.update(await self._poly_features(symbol, ts))
    if "news"    in sources: features.update(await self._news_features(symbol, ts))
    if "price"   in sources: features.update(await self._price_features(symbol, ts))
    if "options" in sources: features.update(await self._options_features(symbol, ts))
    if "macro"   in sources: features.update(await self._macro_features(ts))
    return features
```

Null features are filled with 0 in train.py (already done). The model handles them.

#### 3. Trading hours awareness in the scheduler

Crypto trades 24/7. The hourly scheduler must check trading hours before
building a snapshot so it doesn't waste compute on US equity snapshots at 3 AM:

```python
async def should_run_snapshot(symbol: str, trading_hours: str, ts: datetime) -> bool:
    if trading_hours == "24h":
        return True
    if trading_hours == "us_market":
        et = ts.astimezone(timezone("US/Eastern"))
        if et.weekday() >= 5: return False           # weekend
        if et.hour < 9 or (et.hour == 9 and et.minute < 30): return False
        if et.hour >= 16: return False
        return True
    if trading_hours == "futures":
        et = ts.astimezone(timezone("US/Eastern"))
        return not (et.hour == 17)                   # 5-6 PM ET maintenance gap
    return True
```

#### 4. Per-asset Alpaca order parameters

Crypto and equities use different Alpaca order parameters:

```python
def build_alpaca_order(symbol: str, asset_class: str, side: str,
                       sizing_usd: float, price: float) -> dict:
    if asset_class == "crypto":
        return {
            "symbol":        symbol,
            "notional":      str(round(sizing_usd, 2)),  # dollar amount, fractional
            "side":          side,
            "type":          "market",
            "time_in_force": "gtc",                       # crypto uses GTC not DAY
        }
    else:
        qty = math.floor(sizing_usd / price)
        return {
            "symbol":        symbol,
            "qty":           str(qty),                    # whole shares
            "side":          side,
            "type":          "market",
            "time_in_force": "day",
        }
```

#### 5. Class-level hypothesis matching

Add target_asset_class to hypotheses table so one hypothesis can match any
symbol of a given asset class — e.g. "oversold reversal" fires for any US equity,
not just SPY:

```sql
ALTER TABLE hypotheses ADD COLUMN target_asset_class TEXT;
-- null = only matches target_symbol
-- 'us_equity' = matches any active us_equity symbol
```

Update match_hypothesis in correlator.py:
```python
hypotheses = await db.fetch(
    """SELECT * FROM hypotheses WHERE is_active = TRUE
       AND (target_symbol = $1
            OR target_asset_class = $2
            OR (target_symbol IS NULL AND target_asset_class IS NULL))""",
    symbol, asset_class
)
```

#### 6. Onboarding market categories map to registry

The onboarding market selection chips must drive subscription creation from
the registry, not a hardcoded list. Add this mapping in a config file:

```python
# src/config/market_categories.py
MARKET_CATEGORY_SYMBOLS = {
    "Oil & Energy":  ["USO", "XOM", "XLE", "LNG"],
    "US Equities":   ["SPY", "QQQ", "AAPL", "MSFT", "NVDA"],
    "Crypto":        ["BTC-USD", "ETH-USD", "SOL-USD"],
    "Rates & Macro": ["TLT", "GLD", "SLV"],
    "Commodities":   ["GLD", "SLV", "UNG", "WEAT"],
    "FX":            [],  # placeholder — requires forex data source
}
```

When a user selects a category during onboarding, subscriptions are created
for all symbols in that category that exist in symbol_registry WHERE is_active = TRUE.
Adding a new symbol to the registry and category mapping automatically covers
all existing users with that category on their next subscription refresh.

### What limits market coverage — external constraints

Two things limit how many markets you can actually cover, neither of which is
a code problem:

DATA SOURCES:
  yfinance covers US equities, ETFs, and crypto. Free, no key needed.
  For commodity futures (crude oil contracts, gold futures) you need a paid
  feed: Quandl, barchart, or Polygon.io (~$30-200/month depending on coverage).
  For FX you need a forex data provider (OANDA, Alpaca forex API).
  The symbol_registry data_sources column tracks which sources cover each symbol.
  If a source isn't connected, those feature columns will be null for that symbol.

POLYMARKET COVERAGE:
  Polymarket doesn't have markets for every tradeable instrument.
  Strong coverage: crypto prices, geopolitical events, macro indicators, elections.
  Weak coverage: individual US equities (very few markets exist).
  For equity symbols, hypotheses should weight news_sentiment and vol_ratio
  more heavily than poly_conviction_delta. For oil and crypto, Polymarket
  conviction is often the strongest signal.

### Summary — what changes vs what doesn't

| Component | Change for multi-market | Complexity |
|-----------|------------------------|------------|
| symbol_registry table | New table, replaces hardcoded list | Low |
| feature builder | Asset-class-aware feature selection | Low |
| scheduler | Trading hours awareness per symbol | Low |
| Alpaca execution | Crypto vs equity order parameters | Low |
| hypotheses table | Add target_asset_class column | Low |
| Onboarding | Map categories to registry symbols | Low |
| Data sources | Paid feeds for futures and FX | External cost |
| Correlator and beyond | No changes needed | None |
| XGBoost model | No changes needed — handles nulls | None |
| Claude prompt | No changes needed — symbol agnostic | None |
| SSE, fan-out, strategies | No changes needed | None |