# Polymarket Intelligence Platform — Documentation

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [The Three Data Pipelines](#the-three-data-pipelines)
4. [Data Flow](#data-flow)
5. [Services](#services)
   - [Pipeline 1 — polymarket-kafka (Prediction Market Conviction)](#pipeline-1--polymarket-kafka-prediction-market-conviction)
   - [Pipeline 2 — stock-news-kafka (Hot Stock News Detection)](#pipeline-2--stock-news-kafka-hot-stock-news-detection)
   - [Pipeline 3 — stock-analytics-kafka (Sharp Stock Analytics)](#pipeline-3--stock-analytics-kafka-sharp-stock-analytics)
   - [strategy-injestor (Multi-Pipeline Consumer)](#strategy-injestor-multi-pipeline-consumer)
   - [BFF (Backend for Frontend)](#bff-backend-for-frontend)
   - [Web Client](#web-client)
6. [Infrastructure](#infrastructure)
7. [Detection Algorithms](#detection-algorithms)
   - [Polymarket Conviction Detection](#polymarket-conviction-detection)
   - [Stock News Hotness Scoring](#stock-news-hotness-scoring)
   - [Stock Analytics Signal Detection](#stock-analytics-signal-detection)
8. [Data Models](#data-models)
9. [API Reference](#api-reference)
10. [Environment Variables](#environment-variables)
11. [Running Locally](#running-locally)
12. [Project Structure](#project-structure)
13. [Scripts](#scripts)

---

## Overview

**Polymarket Intelligence Platform** is a full-stack real-time market intelligence system built on **three independent data pipelines**, all unified in a single AI-powered dashboard. Each pipeline monitors a different signal source, detects meaningful events, and streams them through Kafka into a shared Couchbase event store — where an AI trading assistant can reason across all three simultaneously.

**The Three Pipelines:**

| # | Pipeline | Source | Signal | Kafka Topic |
|---|---|---|---|---|
| 1 | `polymarket-kafka` | Polymarket Gamma API | Conviction price shifts in prediction markets | `polymarket-events` |
| 2 | `stock-news-kafka` | Finnhub News API | Hot breaking stock news (scored by recency, sentiment, source, keywords) | `stock-news-events` |
| 3 | `stock-analytics-kafka` | yfinance (Yahoo Finance) | Sharp market moves: volume spikes, price momentum, RSI extremes, unusual options | `stock-analytics-events` |

**Tech Stack**

| Layer | Technology |
|---|---|
| Data pipelines | Python 3.11, confluent-kafka, pydantic, pymongo |
| News data | Finnhub API (free tier: 60 calls/min) |
| Market analytics data | yfinance (no API key, Yahoo Finance) |
| Prediction market data | Polymarket Gamma REST API |
| Message broker | Apache Kafka (Confluent) + Zookeeper |
| Subscription store | MongoDB 6 (per-pipeline subscription collections) |
| Event store | Couchbase Community 7.6 (all pipelines write here) |
| API server | Node.js, Express, TypeScript |
| AI inference | Ollama (local LLM, default: `tinyllama:1.1b`) |
| Web frontend | React 18, TypeScript, Vite |
| Containerisation | Docker Compose |

---

## Architecture

```
                         ┌─────────────────────────────────────────────────────┐
                         │                   Docker Compose                    │
                         │                                                     │
  Polymarket Gamma API   │  ┌──────────────────┐                               │
  ────────────────────▶  │  │ polymarket-kafka  │──▶ polymarket-events ──┐     │
                         │  │   (Pipeline 1)    │                        │     │
                         │  └──────────────────┘                        │     │
                         │                                               │     │
  Finnhub News API        │  ┌──────────────────┐                        │     │
  ────────────────────▶  │  │ stock-news-kafka  │──▶ stock-news-events ──┤     │
                         │  │   (Pipeline 2)    │                        │     │
                         │  └──────────────────┘                        ▼     │
                         │                                     ┌──────────────┐│
  Yahoo Finance (yfinance)│  ┌──────────────────┐              │  strategy-   ││
  ────────────────────▶  │  │stock-analytics-   │──▶ stock-    │  injestor    ││
                         │  │kafka (Pipeline 3) │   analytics- │  (consumer)  ││
                         │  └──────────────────┘   events ──▶ └──────┬───────┘│
                         │                                            │        │
                         │  MongoDB (subscriptions per pipeline)      ▼        │
                         │  ┌──────────────────────────────┐  ┌────────────┐  │
                         │  │ polymarket_subscriptions     │  │ Couchbase  │  │
                         │  │ stock_news_subscriptions     │  │  (unified  │  │
                         │  │ stock_analytics_subscriptions│  │ event store│  │
                         │  └──────────────────────────────┘  └─────┬──────┘  │
                         │                                           │         │
                         │                              ┌────────────▼──────┐  │
                         │                              │  BFF (Express /   │  │
                         │                              │   Node.js :5001)  │  │
                         │                              └────────────┬──────┘  │
                         │                                           │         │
                         │                              ┌────────────▼──────┐  │
                         │                              │   Web Client      │  │
                         │                              │   (React :5173)   │  │
                         │                              └───────────────────┘  │
                         └─────────────────────────────────────────────────────┘
```

---

## The Three Data Pipelines

### Pipeline 1 — Polymarket Conviction

Monitors prediction markets on Polymarket. When the YES price of a market shifts meaningfully (absolute or relative), a conviction event fires. Good for detecting what the crowd *believes* will happen — political events, sports outcomes, macro events.

**Signal:** `|Δyes_price| ≥ 0.10` OR `|Δyes_price|/prev ≥ 0.20`

### Pipeline 2 — Stock Hot News

Monitors breaking financial news via Finnhub for subscribed ticker symbols. Each article is scored on four dimensions — recency, sentiment strength, source credibility, and keyword presence — and emits a `StockNewsEvent` when the composite hotness score exceeds the subscription threshold.

**Hotness score components:**
- Recency: exponential decay, half-life = 4 hours
- Sentiment strength: `|finnhub_sentiment_score|` → 0.0–1.0
- Source credibility: Reuters/Bloomberg → 1.0, unknown → 0.55
- Keyword multiplier: matched hot keywords boost score up to 2×

**Hot keywords:** earnings beat/miss, FDA approval, merger, acquisition, bankruptcy, CEO resign, analyst upgrade/downgrade, short squeeze, layoffs, SEC investigation, and more.

### Pipeline 3 — Sharp Stock Analytics

Monitors price/volume/options data via yfinance for subscribed tickers. Fires on four signal types independently:

| Signal | Trigger |
|---|---|
| `volume_spike` | Current volume > `min_volume_ratio` × 30-day average (default 2×) |
| `price_momentum` | \|1-day price change\| > `min_price_change_pct` (default 5%) |
| `rsi_extreme` | RSI(14) > 75 (overbought) or < 25 (oversold) |
| `options_unusual` | Put/call ratio > 3.0 or < 0.33 on nearest expiry |

Each signal has a **4-hour cooldown per ticker** to avoid repeated firing on the same move.

---

## Data Flow

```
1. seed-subscriptions (all three)
   ├─▶ MongoDB: horizon.polymarket_subscriptions     (Polymarket condition_ids)
   ├─▶ MongoDB: horizon.stock_news_subscriptions     (ticker symbols)
   └─▶ MongoDB: horizon.stock_analytics_subscriptions (ticker symbols)

2. polymarket-kafka  [poll every 30s]
   ├── Read horizon.polymarket_subscriptions (ref_count > 0)
   ├── Fetch snapshots from Polymarket Gamma API
   ├── Run conviction detection (ConvictionState per market)
   └─▶ Publish PolymarketEvent → Kafka: polymarket-events (key=market_id)

3. stock-news-kafka  [poll every 5 min]
   ├── Read horizon.stock_news_subscriptions (ref_count > 0)
   ├── Fetch company news from Finnhub API (lookback 6h)
   ├── Score each article for hotness (recency × sentiment × credibility × keywords)
   ├── Skip already-seen article IDs (in-memory dedup set per ticker)
   └─▶ Publish StockNewsEvent → Kafka: stock-news-events (key=ticker)

4. stock-analytics-kafka  [poll every 15 min]
   ├── Read horizon.stock_analytics_subscriptions (ref_count > 0)
   ├── Fetch OHLCV + options data from yfinance
   ├── Compute: volume ratio, 1d price change, RSI(14), put/call ratio
   ├── Fire signals with 4h per-ticker cooldown
   └─▶ Publish StockAnalyticsEvent → Kafka: stock-analytics-events (key=ticker)

5. strategy-injestor  [multi-topic consumer]
   ├── Subscribe to: polymarket-events, stock-news-events, stock-analytics-events
   ├── Route by pipeline field in event payload
   └─▶ Upsert to Couchbase (bucket: polymarket):
         polymarket → market::{market_id}  + event::{event_id}
         stock-news → stock-news::{ticker} + event::{event_id}
         stock-analytics → stock-analytics::{ticker}::{signal_type} + event::{event_id}

6. BFF (port 5001)
   ├── N1QL query across all event types in Couchbase
   ├── Injects full cross-pipeline context into Ollama AI prompt
   ├── Stores conversation history in MongoDB
   └─▶ REST API consumed by Web Client

7. Web Client (port 5173)
   ├── /dashboard  → platform overview
   ├── /chat       → AI assistant (sees all 3 pipelines)
   └── /events     → unified event feed (filterable by pipeline, ticker, signal type)
```

---

## Services

### Pipeline 1 — polymarket-kafka (Prediction Market Conviction)

**Location:** `src/polymarket_kafka/`
**Entry point:** `python -m polymarket_kafka`

The core data pipeline producer. Polls the Polymarket Gamma API for markets that have active subscriptions in MongoDB, runs conviction detection on each price update, and publishes conviction-change events to Kafka.

**Key responsibilities:**
- Manage subscriptions via `SubscriptionManager` (MongoDB-backed, ref-count pattern)
- Fetch market snapshots from the Gamma REST API with retry + rate limiting
- Detect conviction changes using configurable per-market thresholds
- Publish `PolymarketEvent` messages to Kafka with idempotent producer, zstd compression, and `acks=all`
- Auto-create the Kafka topic if it does not exist

**Polling loops:**
- Subscription refresh: every `MONGODB_POLL_INTERVAL_SECONDS` (default 60s)
- Market poll: every `POLL_INTERVAL_SECONDS` (default 30s)

**Kafka producer settings:**

| Setting | Value |
|---|---|
| `acks` | `all` |
| `enable.idempotence` | `true` |
| `compression.type` | `zstd` |
| `linger.ms` | `10` |
| `delivery.timeout.ms` | `60000` |
| `message.max.bytes` | `5 MB` |

---

### Pipeline 2 — stock-news-kafka (Hot Stock News Detection)

**Location:** `src/stock_news_kafka/`
**Entry point:** `python -m stock_news_kafka`
**Data source:** Finnhub News API (`https://finnhub.io/api/v1`) — free tier, 60 calls/min

Polls Finnhub for breaking company news on subscribed tickers. Each article is scored with a composite hotness algorithm and published to Kafka when it exceeds the subscription threshold.

**Key responsibilities:**
- Manage ticker subscriptions in `horizon.stock_news_subscriptions` (ref-count pattern)
- Fetch company news for each active ticker (rolling 6h lookback)
- Score articles with 4-component hotness algorithm (see Detection Algorithms)
- Deduplicate via in-memory `seen_article_ids` set per ticker
- Publish `StockNewsEvent` to `stock-news-events` Kafka topic (key=ticker)

**Module breakdown:**
- `data_source.py` — `FinnhubClient`: HTTP client with rate limiting and retries
- `hotness_detector.py` — `compute_hotness()`, `is_hot()`, per-ticker `NewsHotnessState`
- `subscription_manager.py` — MongoDB CRUD with atomic `$inc ref_count`
- `kafka_client.py` — Confluent producer wrapper
- `event_builder.py` — Builds `StockNewsEvent` from article + hotness result
- `runner.py` — Async polling loop

---

### Pipeline 3 — stock-analytics-kafka (Sharp Stock Analytics)

**Location:** `src/stock_analytics_kafka/`
**Entry point:** `python -m stock_analytics_kafka`
**Data source:** yfinance (Yahoo Finance, no API key required)

Monitors price, volume, technical indicators, and options activity for subscribed tickers. Fires on four independent signal types with a per-ticker, per-signal cooldown to prevent repeated alerting.

**Key responsibilities:**
- Manage ticker subscriptions in `horizon.stock_analytics_subscriptions` (ref-count pattern)
- Fetch OHLCV (30-day daily + intraday), compute RSI(14), fetch nearest-expiry options chain
- Detect signals: volume spike, price momentum, RSI extreme, unusual options
- Enforce 4-hour cooldown per ticker+signal combination (in-memory `AnalyticsState`)
- Publish `StockAnalyticsEvent` to `stock-analytics-events` Kafka topic (key=ticker)

**Signal types:**

| Signal | Condition | Direction |
|---|---|---|
| `volume_spike` | `volume / avg_30d > min_volume_ratio` | bullish if price up, bearish if down |
| `price_momentum` | `|1d_pct_change| > min_price_change_pct` | bullish/bearish |
| `rsi_extreme` | RSI(14) > 75 or < 25 | bearish if overbought, bullish if oversold |
| `options_unusual` | put/call ratio > 3.0 (bearish) or < 0.33 (bullish) | bullish/bearish |

**Module breakdown:**
- `data_source.py` — `YFinanceClient`: wraps yfinance with executor for async compat, RSI computation, options fetch
- `signal_detector.py` — `detect_signals()`, per-ticker `AnalyticsState` with cooldown tracking
- `subscription_manager.py` — MongoDB CRUD with atomic `$inc ref_count`
- `kafka_client.py` — Confluent producer wrapper
- `event_builder.py` — Builds `StockAnalyticsEvent` from signal result
- `runner.py` — Async polling loop

---

### strategy-injestor (Multi-Pipeline Consumer)

**Location:** `src/strategy_injestor/`
**Entry point:** `python -m strategy_injestor`

Kafka consumer that subscribes to **all three topics** simultaneously. Routes events to Couchbase using different key patterns per pipeline. The `pipeline` field in every event payload is used for routing.

**Multi-topic subscription:**
```
KAFKA_TOPICS=polymarket-events,stock-news-events,stock-analytics-events
```

**Couchbase routing by pipeline:**

| Pipeline field | Latest-state key | History key |
|---|---|---|
| `polymarket` | `market::{market_id}` | `event::{event_id}` |
| `stock-news` | `stock-news::{ticker}` | `event::{event_id}` |
| `stock-analytics` | `stock-analytics::{ticker}::{signal_type}` | `event::{event_id}` |

---

### BFF (Backend for Frontend)

**Location:** `src/web-app/bff/`
**Port:** `5001`
**Runtime:** Node.js + Express + TypeScript

REST API server that bridges the Web Client with Couchbase (event data) and MongoDB (users, conversations). Integrates Ollama for local AI inference.

**Routes:**

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | No | Register a new user |
| `POST` | `/api/auth/login` | No | Login, returns JWT |
| `GET` | `/api/auth/me` | JWT | Get current user |
| `POST` | `/api/auth/logout` | JWT | Logout |
| `POST` | `/api/chat/conversations` | JWT | Create conversation |
| `GET` | `/api/chat/conversations` | JWT | List conversations |
| `GET` | `/api/chat/conversations/:id` | JWT | Get conversation + messages |
| `DELETE` | `/api/chat/conversations/:id` | JWT | Delete conversation |
| `POST` | `/api/chat/message` | JWT | Send message, get AI reply |
| `POST` | `/api/chat/message/stream` | JWT | Streaming AI reply |
| `GET` | `/api/chat/events` | JWT | Fetch market conviction events from Couchbase |

**AI pipeline (per message):**
1. Fetch recent `PolymarketEvent` records from Couchbase (N1QL, ordered by timestamp DESC)
2. Build a structured market context string
3. Prepend a system prompt defining the assistant as a Polymarket trading expert
4. Send conversation history + context to Ollama
5. Return the generated response and persist to MongoDB conversation

**Authentication:** JWT (HS256). Secret configured via `JWT_SECRET`. Tokens expire after `JWT_EXPIRES_IN` (default `7d`). Passwords hashed with bcrypt (10 salt rounds).

**MongoDB collections:**
- `users` — email, hashed password, name
- `conversations` — userId ref, title, embedded `messages[]` (role, content, timestamp)

---

### Web Client

**Location:** `src/web-app/web-client/`
**Dev port:** `5173` (Vite)
**Runtime:** React 18, TypeScript, Vite

Single-page application with JWT auth and three main views.

**Routes:**

| Path | Component | Auth | Description |
|---|---|---|---|
| `/` | `LandingPage` | No | Marketing / landing page |
| `/login` | `Login` | No | Login form |
| `/register` | `Register` | No | Registration form |
| `/dashboard` | `MainDashboard` | Required | Platform overview + capabilities |
| `/chat` | `Dashboard` | Required | AI trading chat with conversation history |
| `/events` | `PollyMarketEvents` | Required | Filterable conviction event feed |

**Events view filters:**
- Count: 25 / 50 / 100 / 200 / All
- Time range: All / Last 1h / Last 24h / Last 7d
- Indication: All / Yes / No / Neutral
- Min volume
- Free-text search across market question

**Auth flow:**
- Token stored in `localStorage` under key `token`
- Axios request interceptor injects `Authorization: Bearer <token>` on every request
- 401 response interceptor clears storage and redirects to `/login`

---

## Infrastructure

### Kafka

Confluent Platform 7.6.1. Single-broker setup using internal listener `kafka:29092` (container-to-container) and external listener `localhost:9092` (host access). Topics are auto-created by the `KafkaClient` on startup if they do not exist.

**Topic:** `polymarket-events`

### MongoDB

Version 6. Database: `horizon`. Collections:
- `polymarket_subscriptions` — market subscription documents
- `users` — BFF user accounts
- `conversations` — BFF chat history

Accessible via Mongo Express UI at `http://localhost:8081` (admin/admin).

### Couchbase

Community Edition 7.6.2. Services: KV, N1QL (query), Index.

**Bucket:** `polymarket` (128 MB RAM quota)
**Credentials:** `Administrator` / `password`
**UI:** `http://localhost:8091`

The `couchbase-init` service automatically provisions the node, sets memory quotas, creates credentials, and creates the `polymarket` bucket on first run.

Document queries run via N1QL from the BFF:
```sql
SELECT d.*
FROM `polymarket` AS d
ORDER BY STR_TO_MILLIS(d.timestamp) DESC
LIMIT $limit
```

---

## Detection Algorithms

### Polymarket Conviction Detection

Runs in `src/polymarket_kafka/conviction.py`. Per-market state held in `ConvictionState` (in-memory, resets on restart):

```
ConvictionState
  last_yes_price         — last observed YES price
  last_event_yes_price   — YES price at last emitted event
  last_event_at          — timestamp of last emitted event
```

**Algorithm (per market, per poll):**
1. First observation → record baseline, emit nothing.
2. Compute `change_abs = |current_yes − last_yes|` and `change_pct = change_abs / last_yes`
3. Resolve thresholds: per-subscription override → global defaults (`abs=0.10`, `pct=0.20`)
4. If both below threshold → noise, skip. Otherwise emit with `direction="yes"|"no"`.

---

### Stock News Hotness Scoring

Runs in `src/stock_news_kafka/hotness_detector.py`. Per-ticker `NewsHotnessState` tracks seen article IDs to prevent re-publishing.

**Score formula:**

```
recency      = exp(−age_hours × 0.693 / 4.0)      # half-life = 4 hours
sentiment    = |finnhub_sentiment_score|            # 0.0 – 1.0
credibility  = SOURCE_CREDIBILITY[source_name]      # 0.55 – 1.0
kw_boost     = min(1.0 + 0.25 × num_keyword_matches, 2.0)

raw_score    = recency × (0.35×sentiment + 0.35×credibility + 0.30) × kw_boost
hotness      = min(raw_score, 1.0)
```

Event fires when `hotness ≥ subscription.min_hotness_score` (default `0.4`) and article ID is unseen.

**Source credibility table (sample):**

| Source | Score |
|---|---|
| Reuters / Bloomberg | 1.00 |
| Financial Times / WSJ | 0.95 |
| CNBC | 0.85 |
| MarketWatch / Yahoo Finance | 0.80 |
| Seeking Alpha / Benzinga | 0.70 |
| Unknown | 0.55 |

**Hot keywords (triggers keyword multiplier):**
earnings beat/miss, FDA approval/rejection, merger, acquisition, takeover, bankruptcy, chapter 11, fraud, SEC investigation, CEO resign/fired, analyst upgrade/downgrade, price target raise/cut, short squeeze, dividend cut/increase, layoffs, restructuring, IPO, SPAC, sanctions, tariff.

---

### Stock Analytics Signal Detection

Runs in `src/stock_analytics_kafka/signal_detector.py`. Per-ticker `AnalyticsState` tracks last-fired timestamp per signal type (4-hour cooldown prevents re-firing on the same move).

**Volume Spike:**
```
volume_ratio = today_volume / avg_volume_30d
fires when volume_ratio > subscription.min_volume_ratio (default 2.0)
signal_strength = min((volume_ratio − 1.0) / 5.0, 1.0)
direction = bullish if price_change_1d > 0, else bearish
```

**Price Momentum:**
```
price_change_1d_pct = (close − prev_close) / prev_close × 100
fires when |price_change_1d_pct| > subscription.min_price_change_pct (default 5.0%)
signal_strength = min(|price_change_1d_pct| / 20.0, 1.0)
direction = bullish if up, bearish if down
```

**RSI Extreme:**
```
RSI(14) computed from 30 days of daily close prices
fires when RSI > subscription.rsi_overbought (default 75) → bearish
       or when RSI < subscription.rsi_oversold  (default 25) → bullish
signal_strength = |RSI − 50| / 50
```

RSI calculation:
```
delta = daily_close.diff()
gain  = delta.clip(lower=0).rolling(14).mean()
loss  = (-delta).clip(lower=0).rolling(14).mean()
RSI   = 100 − 100 / (1 + gain/loss)
```

**Unusual Options:**
```
fetch nearest expiry options chain via yfinance
put_call_ratio = sum(put_volume) / sum(call_volume)
fires when put_call_ratio > 3.0 → bearish (heavy put buying)
       or put_call_ratio < 0.33 → bullish (heavy call buying)
signal_strength = min(|log(put_call_ratio / 1.0)| / 2.0, 1.0)
```

---

## Data Models

### PolymarketEvent (topic: `polymarket-events`)

```python
event_id: str                       # UUID4
timestamp: datetime                 # UTC, from market snapshot
market_id: str                      # Polymarket condition_id
question: str                       # Market question text
yes_price: float                    # 0.0 – 1.0
no_price: float                     # 0.0 – 1.0
source: str                         # "polymarket-kafka"
published_at: Optional[datetime]
conviction_direction: str           # "yes" or "no"
conviction_magnitude: float         # Absolute price change
conviction_magnitude_pct: float     # Relative price change
previous_yes_price: Optional[float]
volume: Optional[float]
liquidity: Optional[float]
pipeline: str                       # "polymarket"
```

### StockNewsEvent (topic: `stock-news-events`)

```python
event_id: str                       # UUID4
timestamp: datetime                 # Article published_at UTC
ticker: str                         # e.g. "AAPL"
company_name: str
headline: str
summary: str                        # max 500 chars
source_name: str                    # e.g. "Reuters"
url: str
article_id: str                     # Finnhub article ID (dedup key)
sentiment_score: float              # -1.0 to 1.0
sentiment_label: str                # "bullish" | "bearish" | "neutral"
hotness_score: float                # 0.0 – 1.0
keywords: List[str]                 # Matched hot keywords
article_age_hours: float
pipeline: str                       # "stock-news"
published_at: Optional[datetime]
```

### StockAnalyticsEvent (topic: `stock-analytics-events`)

```python
event_id: str                       # UUID4
timestamp: datetime                 # UTC detection time
ticker: str                         # e.g. "TSLA"
company_name: str
signal_type: str                    # "volume_spike" | "price_momentum" | "rsi_extreme" | "options_unusual"
signal_strength: float              # 0.0 – 1.0
direction: str                      # "bullish" or "bearish"
current_price: float
price_change_1d_pct: float
current_volume: Optional[int]
avg_volume_30d: Optional[float]
volume_ratio: Optional[float]
rsi_14: Optional[float]
call_volume: Optional[int]
put_volume: Optional[int]
put_call_ratio: Optional[float]
pipeline: str                       # "stock-analytics"
published_at: Optional[datetime]
```

### Subscriptions (MongoDB)

All three subscription collections use the same **ref-count pattern** (`$inc` atomic operations). Active when `ref_count > 0`.

**`polymarket_subscriptions`:**
```python
market_id: str; slug: Optional[str]; ref_count: int
conviction_threshold: Optional[float]     # default 0.10 abs
conviction_threshold_pct: Optional[float] # default 0.20 pct
```

**`stock_news_subscriptions`:**
```python
ticker: str; company_name: Optional[str]; ref_count: int
min_hotness_score: float   # default 0.4
```

**`stock_analytics_subscriptions`:**
```python
ticker: str; company_name: Optional[str]; ref_count: int
min_volume_ratio: float    # default 2.0
min_price_change_pct: float # default 5.0
rsi_overbought: float      # default 75.0
rsi_oversold: float        # default 25.0
```

### User / Conversation (MongoDB — BFF)

```
User:         email, password (bcrypt), name
Conversation: userId ref, title, messages[]{role, content, timestamp}
```

---

## API Reference

### Auth

**POST `/api/auth/register`**
```json
{ "email": "user@example.com", "password": "secret123", "name": "Alice" }
```
Response:
```json
{ "success": true, "data": { "user": { "id": "...", "email": "...", "name": "..." }, "token": "<jwt>" } }
```

**POST `/api/auth/login`**
```json
{ "email": "user@example.com", "password": "secret123" }
```
Response: same shape as register.

**GET `/api/auth/me`** *(Bearer token required)*
```json
{ "success": true, "data": { "id": "...", "email": "...", "name": "..." } }
```

### Chat

**POST `/api/chat/message`** *(Bearer token required)*
```json
{ "conversationId": "<id>", "message": "What are the hottest BTC markets?" }
```
Response:
```json
{ "success": true, "data": { "message": "<ai response>", "conversationId": "..." } }
```

**GET `/api/chat/events?limit=100`** *(Bearer token required)*
```json
{
  "success": true,
  "data": {
    "events": [
      {
        "market_id": "0xabc...",
        "market_slug": "btc-above-100k",
        "question": "Will BTC be above $100k?",
        "current_price": 0.72,
        "volume": 50000,
        "timestamp": "2026-05-13T10:00:00Z",
        "outcome": "yes",
        "conviction_level": "15.20%"
      }
    ]
  }
}
```

Pass `limit=all` (string) to retrieve all events without a cap.

---

## Environment Variables

All env files live in `env/` (git-ignored). Each Docker Compose service has its own file.

### env/zookeeper.env

| Variable | Default |
|---|---|
| `ZOOKEEPER_CLIENT_PORT` | `2181` |
| `ZOOKEEPER_TICK_TIME` | `2000` |
| `ZOOKEEPER_SYNC_LIMIT` | `2` |

### env/kafka.env

| Variable | Default |
|---|---|
| `KAFKA_BROKER_ID` | `1` |
| `KAFKA_ZOOKEEPER_CONNECT` | `zookeeper:2181` |
| `KAFKA_ADVERTISED_LISTENERS` | `PLAINTEXT://kafka:29092,PLAINTEXT_HOST://localhost:9092` |
| `KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR` | `1` |
| `KAFKA_AUTO_CREATE_TOPICS_ENABLE` | `true` |
| `KAFKA_LOG_RETENTION_HOURS` | `24` |

### env/mongo.env

`MONGO_INITDB_DATABASE=horizon`

### env/mongo-express.env

`ME_CONFIG_MONGODB_SERVER=mongo` / basic auth: admin/admin

### env/seed-subscriptions.env

`MONGODB_URI=mongodb://mongo:27017` / `MONGODB_DATABASE=horizon` / `MONGODB_COLLECTION=polymarket_subscriptions`

### env/polymarket-kafka.env

| Variable | Required | Default |
|---|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | Yes | `kafka:29092` |
| `KAFKA_TOPIC` | Yes | `polymarket-events` |
| `MONGODB_URI` | Yes | `mongodb://mongo:27017` |
| `MONGODB_DATABASE` | Yes | `horizon` |
| `MONGODB_COLLECTION` | No | `polymarket_subscriptions` |
| `MONGODB_POLL_INTERVAL_SECONDS` | No | `60` |
| `POLYMARKET_BASE_URL` | No | `https://gamma-api.polymarket.com` |
| `POLYMARKET_RATE_LIMIT_DELAY_MS` | No | `200` |
| `POLL_INTERVAL_SECONDS` | No | `30` |
| `LOG_LEVEL` | No | `INFO` |
| `DISCORD_WEBHOOK_URL` | No | _(empty)_ |

### env/stock-news-kafka.env *(new)*

| Variable | Required | Default |
|---|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | Yes | `kafka:29092` |
| `KAFKA_TOPIC` | No | `stock-news-events` |
| `FINNHUB_API_KEY` | **Yes** | — |
| `FINNHUB_RATE_LIMIT_DELAY_MS` | No | `1100` (≈60 req/min) |
| `MONGODB_URI` | Yes | `mongodb://mongo:27017` |
| `MONGODB_DATABASE` | Yes | `horizon` |
| `MONGODB_COLLECTION` | No | `stock_news_subscriptions` |
| `MONGODB_POLL_INTERVAL_SECONDS` | No | `300` |
| `POLL_INTERVAL_SECONDS` | No | `300` |
| `NEWS_LOOKBACK_HOURS` | No | `6` |
| `LOG_LEVEL` | No | `INFO` |
| `DISCORD_WEBHOOK_URL` | No | _(empty)_ |

Get a free Finnhub API key at https://finnhub.io — free tier allows 60 calls/min.

### env/stock-analytics-kafka.env *(new)*

| Variable | Required | Default |
|---|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | Yes | `kafka:29092` |
| `KAFKA_TOPIC` | No | `stock-analytics-events` |
| `MONGODB_URI` | Yes | `mongodb://mongo:27017` |
| `MONGODB_DATABASE` | Yes | `horizon` |
| `MONGODB_COLLECTION` | No | `stock_analytics_subscriptions` |
| `MONGODB_POLL_INTERVAL_SECONDS` | No | `300` |
| `POLL_INTERVAL_SECONDS` | No | `900` (15 min) |
| `SIGNAL_COOLDOWN_HOURS` | No | `4` |
| `LOG_LEVEL` | No | `INFO` |
| `DISCORD_WEBHOOK_URL` | No | _(empty)_ |

No API key needed — uses yfinance (Yahoo Finance).

### env/strategy-injestor.env *(updated — multi-topic)*

| Variable | Required | Default |
|---|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | Yes | `kafka:29092` |
| `KAFKA_TOPICS` | No | `polymarket-events,stock-news-events,stock-analytics-events` |
| `KAFKA_GROUP_ID` | No | `strategy-injestor` |
| `COUCHBASE_CONNECTION_STRING` | No | `couchbase://couchbase` |
| `COUCHBASE_USERNAME` | No | `Administrator` |
| `COUCHBASE_PASSWORD` | No | `password` |
| `COUCHBASE_BUCKET` | No | `polymarket` |
| `POLL_INTERVAL_MS` | No | `1000` |
| `LOG_LEVEL` | No | `INFO` |
| `DISCORD_WEBHOOK_URL` | No | _(empty)_ |

### BFF — src/web-app/bff/.env

| Variable | Default | Notes |
|---|---|---|
| `JWT_SECRET` | — | **Required in production** |
| `JWT_EXPIRES_IN` | `7d` | |
| `COUCHBASE_CONNECTION_STRING` | `couchbase://couchbase` | |
| `COUCHBASE_BUCKET` | `polymarket` | |
| `MONGODB_URI` | `mongodb://mongo:27017` | |
| `MONGODB_DB` | `polymarket` | |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | |
| `OLLAMA_MODEL` | `tinyllama:1.1b` | |

---

## Running Locally

### Prerequisites

- Docker + Docker Compose
- Finnhub API key (free at https://finnhub.io) — add to `env/stock-news-kafka.env`
- Node.js 20+ (BFF / web-client dev)
- Python 3.11+ (Python services dev)

### Start all services

```bash
docker compose up -d

# Tail specific pipelines
docker compose logs -f polymarket-kafka
docker compose logs -f stock-news-kafka
docker compose logs -f stock-analytics-kafka
docker compose logs -f strategy-injestor
```

### Service startup order

```
zookeeper → kafka → polymarket-kafka, stock-news-kafka, stock-analytics-kafka
mongo → seed-subscriptions → polymarket-kafka
couchbase → couchbase-init → strategy-injestor
```

### Access points

| Service | URL | Credentials |
|---|---|---|
| Mongo Express | http://localhost:8081 | admin / admin |
| Couchbase UI | http://localhost:8091 | Administrator / password |
| BFF API | http://localhost:5001 | JWT Bearer token |
| Web Client (dev) | http://localhost:5173 | — |
| Kafka (host) | localhost:9092 | — |

### BFF local dev

```bash
cd src/web-app/bff
cp .env.example .env   # set JWT_SECRET and OLLAMA settings
npm install
npm run dev
```

### Web client local dev

```bash
cd src/web-app/web-client
npm install
npm run dev
# Set VITE_API_URL=http://localhost:5001 if the proxy is not configured
```

### Python services local dev

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# polymarket-kafka
KAFKA_BOOTSTRAP_SERVERS=localhost:9092 \
KAFKA_TOPIC=polymarket-events \
MONGODB_URI=mongodb://localhost:27017 \
MONGODB_DATABASE=horizon \
python -m polymarket_kafka

# strategy-injestor
KAFKA_BOOTSTRAP_SERVERS=localhost:9092 \
COUCHBASE_CONNECTION_STRING=couchbase://localhost \
python -m strategy_injestor
```

### Discord logging (optional)

Set `DISCORD_WEBHOOK_URL` in any Python service env file. Logs at or above `DISCORD_LOG_LEVEL` (defaults to `LOG_LEVEL`) will be posted to the webhook. The handler is fire-and-forget — webhook failures never crash the service.

---

## Project Structure

```
polymarket-event-injestor/
├── docker-compose.yml                    # All services + dependencies + healthchecks
├── Dockerfile                            # Shared image for all Python pipeline services
├── pyproject.toml                        # Python project config + dependencies (incl. yfinance)
├── pyrightconfig.json
├── docs.md                               # This file
│
├── env/                                  # Service env files (git-ignored)
│   ├── zookeeper.env
│   ├── kafka.env
│   ├── mongo.env
│   ├── mongo-express.env
│   ├── seed-subscriptions.env
│   ├── polymarket-kafka.env              # Pipeline 1
│   ├── stock-news-kafka.env              # Pipeline 2 (FINNHUB_API_KEY required)
│   ├── stock-analytics-kafka.env         # Pipeline 3
│   └── strategy-injestor.env            # Multi-topic consumer
│
├── src/
│   ├── polymarket_kafka/                 # Pipeline 1 — Polymarket Conviction Producer
│   │   ├── __main__.py
│   │   ├── config.py
│   │   ├── runner.py                     # Async poll → conviction → publish
│   │   ├── conviction.py                 # ConvictionState + detect_conviction_change()
│   │   ├── data_source.py                # PolymarketClient + MarketSnapshot
│   │   ├── kafka_client.py               # Confluent producer wrapper
│   │   ├── subscription_manager.py       # MongoDB ref-count CRUD
│   │   ├── event_builder.py
│   │   ├── models.py                     # PolymarketEvent, PolymarketSubscription
│   │   └── discord_logging.py
│   │
│   ├── stock_news_kafka/                 # Pipeline 2 — Stock Hot News Producer
│   │   ├── __main__.py
│   │   ├── config.py
│   │   ├── runner.py                     # Async poll → hotness → publish
│   │   ├── hotness_detector.py           # NewsHotnessState + compute_hotness() + is_hot()
│   │   ├── data_source.py                # FinnhubClient + NewsArticle
│   │   ├── kafka_client.py               # Confluent producer wrapper
│   │   ├── subscription_manager.py       # MongoDB ref-count CRUD (stock_news_subscriptions)
│   │   ├── event_builder.py
│   │   ├── models.py                     # StockNewsEvent, StockNewsSubscription
│   │   └── discord_logging.py
│   │
│   ├── stock_analytics_kafka/            # Pipeline 3 — Sharp Stock Analytics Producer
│   │   ├── __main__.py
│   │   ├── config.py
│   │   ├── runner.py                     # Async poll → signals → publish
│   │   ├── signal_detector.py            # AnalyticsState + detect_signals() + cooldown
│   │   ├── data_source.py                # YFinanceClient + TickerSnapshot (wraps yfinance)
│   │   ├── kafka_client.py               # Confluent producer wrapper
│   │   ├── subscription_manager.py       # MongoDB ref-count CRUD (stock_analytics_subscriptions)
│   │   ├── event_builder.py
│   │   ├── models.py                     # StockAnalyticsEvent, StockAnalyticsSubscription
│   │   └── discord_logging.py
│   │
│   ├── strategy_injestor/                # Multi-Pipeline Consumer → Couchbase
│   │   ├── __main__.py
│   │   ├── config.py                     # KAFKA_TOPICS (comma-separated)
│   │   ├── runner.py                     # Routes by pipeline field → Couchbase
│   │   ├── kafka_consumer.py             # Multi-topic subscribe
│   │   ├── couchbase_client.py           # upsert_event() routes by pipeline
│   │   └── discord_logging.py
│   │
│   └── web-app/
│       ├── bff/                          # Node.js / Express API (TypeScript)
│       │   └── src/
│       │       ├── index.ts
│       │       ├── config/
│       │       ├── db.ts                 # Mongoose → MongoDB
│       │       ├── couchbase.ts          # N1QL query helper (all 3 pipelines)
│       │       ├── controllers/
│       │       │   ├── auth.controller.ts
│       │       │   └── chat.controller.ts  # getMarketEvents queries all event types
│       │       ├── services/
│       │       │   ├── ai.service.ts       # Cross-pipeline context → Ollama
│       │       │   └── auth.service.ts
│       │       ├── models/
│       │       │   ├── user.model.ts
│       │       │   └── conversation.model.ts
│       │       ├── routes/
│       │       ├── middleware/
│       │       └── logger/
│       │
│       └── web-client/                   # React SPA (TypeScript + Vite)
│           └── src/
│               ├── App.tsx
│               ├── context/AuthContext.tsx
│               ├── services/api.ts
│               └── components/
│                   ├── LandingPage.tsx
│                   ├── MainDashboard.tsx   # /dashboard
│                   ├── Dashboard.tsx       # /chat — AI assistant
│                   ├── PollyMarketEvents.tsx # /events — unified feed (all pipelines)
│                   ├── Sidebar.tsx
│                   ├── ChatMessage.tsx
│                   ├── ChatInput.tsx
│                   └── MainNav.tsx
│
└── scripts/
    ├── seed_subscriptions.py             # Seed Polymarket subscriptions from API
    ├── seed_stock_subscriptions.py       # Seed stock_news + stock_analytics subscriptions
    ├── seed_sample_events.py             # Insert synthetic events into Couchbase
    ├── publish_test_events.py            # Publish test events to any Kafka topic
    ├── find_active_markets.py
    ├── check_market_status.py
    ├── debug_ids.py
    ├── test_conviction_event.py
    ├── test_chat_e2e.py
    ├── configure_groq.sh
    ├── init-couchbase.sh
    └── test-ollama-weather.js
```

---

## Scripts

| Script | Purpose |
|---|---|
| `seed_subscriptions.py` | Fetches active financial/crypto markets from Polymarket Gamma API (paginating up to 10,000 results, filtered by keyword: BTC, ETH, S&P 500, etc.) and inserts subscription documents into MongoDB with `ref_count=1`. |
| `seed_sample_events.py` | Inserts synthetic conviction events directly into Couchbase. Useful for testing the BFF and web client without running the full pipeline. |
| `publish_test_events.py` | Publishes a hand-crafted `PolymarketEvent` JSON message to Kafka to verify that `strategy-injestor` picks it up and writes to Couchbase. |
| `find_active_markets.py` | Queries MongoDB for subscriptions where `ref_count > 0` and prints them. |
| `check_market_status.py` | Checks whether specific market condition IDs are currently active on Polymarket. |
| `debug_ids.py` | Resolves condition IDs and slugs to diagnose mismatches between subscription records and Gamma API responses. |
| `test_conviction_event.py` | Runs a real conviction detection cycle against a live market and asserts the output shape. |
| `test_chat_e2e.py` | End-to-end test: registers a user, logs in, creates a conversation, sends a message, and checks the AI response via the BFF. |
| `configure_groq.sh` | Sets environment variables to switch the BFF AI backend from local Ollama to Groq cloud API. |
| `init-couchbase.sh` | Standalone shell equivalent of the `couchbase-init` Docker service — useful for manual or CI provisioning. |
| `test-ollama-weather.js` | Quick Node.js smoke test that hits the Ollama API with a simple weather prompt to confirm connectivity. |
