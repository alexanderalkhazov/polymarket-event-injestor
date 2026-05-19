# EventEdge AI — Codebase Reference

## 1. Project Overview

EventEdge AI is an event-driven market intelligence platform that fuses real-time prediction market data (Polymarket), financial news, and trading analytics into AI-scored investment opportunities. Signals are ranked by an XGBoost model, explained by Claude, embedded via OpenAI for semantic search, and streamed to users through a Next.js dashboard that connects to Alpaca for paper or live trading execution.

---

## 2. Architecture

```
External Data Sources
  ├─ Polymarket CLOB API      ─► polymarket-producer ─► Kafka: raw.polymarket
  ├─ Finnhub News API         ─► news-producer       ─► Kafka: raw.news
  └─ Yahoo Finance / Options  ─► analytics-producer  ─► Kafka: raw.analytics
                                        │
                              Kafka (Redpanda :9092)
                                        │
               ┌────────────────────────┼───────────────────────┐
               ▼                        ▼                       ▼
     polymarket-consumer        news-consumer         analytics-consumer
               │                        │                       │
               └────────────────────────┼───────────────────────┘
                                        │
                          PostgreSQL (signals table)
                          TimescaleDB (raw_* hypertables)
                          Redis PubSub: new_signal
                                        │
                          ┌─────────────┼──────────────┐
                          ▼             ▼              ▼
                   feature-builder  historical-   ml-trainer
                   (hourly batch)   ingestor      (hourly check,
                          │         (nightly)      retrains when
                          │            │           ≥200 samples)
                          ▼            ▼              │
                    TimescaleDB: features         ./models/
                    (33 features/symbol/hour)     scoring_model.json
                          │                            │
                          └────────────┬───────────────┘
                                       ▼
                               ai-correlator
                               (subscribes: Redis new_signal)
                               1. Score with XGBoost / rules
                               2. Gate: confidence, backtest,
                                        earnings, dedup
                               3. Embed (OpenAI)
                               4. Semantic search (pgvector)
                               5. Claude narrative
                               6. Save opportunity
                               7. Fan-out per user
                                       │
                          Redis: user:{id}:opportunities
                                       │
                               Next.js (src/web)
                               SSE → Strategy Inbox
                                       │
                               Alpaca Trading API
```

---

## 3. Service Inventory

| Service | Directory / Image | Port | Restart | Purpose |
|---|---|---|---|---|
| **redpanda** | redpandadata/redpanda | 9092, 9644 | always | Kafka-compatible message broker |
| **redpanda-console** | redpandadata/console | 8080 | always | Kafka topic browser UI |
| **postgres** | pgvector/pgvector:pg16 | 5432 | always | App schema (users, signals, opportunities) |
| **timescale** | timescale/timescaledb:latest-pg16 | 5433 | always | Time-series schema (features, OHLCV, macro) |
| **redis** | redis:7-alpine | 6379 | always | Pub/Sub channels + sentiment cache |
| **pgadmin** | dpage/pgadmin4 | 5050 | always | Database admin UI |
| **polymarket-producer** | src/event_detectors/polymarket_producer | — | unless-stopped | Polls Polymarket CLOB API → raw.polymarket |
| **news-producer** | src/event_detectors/news_producer | — | unless-stopped | Polls Finnhub news → raw.news |
| **analytics-producer** | src/event_detectors/analytics_producer | — | unless-stopped | Polls yfinance / options → raw.analytics |
| **polymarket-consumer** | src/event_processors/polymarket_consumer | — | unless-stopped | Detects conviction shifts → signals |
| **news-consumer** | src/event_processors/news_consumer | — | unless-stopped | VADER sentiment → signals |
| **analytics-consumer** | src/event_processors/analytics_consumer | — | unless-stopped | Technical scoring → signals |
| **feature-builder** | src/feature_store | — | unless-stopped | Hourly 33-feature snapshots + nightly labels |
| **historical-ingestor** | src/historical | — | on-failure | Nightly OHLCV (yfinance) + macro (FRED) |
| **ml-trainer** | src/ml | — | unless-stopped | Retrains XGBoost when ≥200 labeled rows |
| **ai-correlator** | src/ai_correlator | — | unless-stopped | Orchestrates scoring → Claude → fan-out |
| **nextjs** _(commented out)_ | src/web | 3000 | unless-stopped | React dashboard + Alpaca integration |

---

## 4. Data Pipeline Walk-through

### Stage 1 — Event Detectors (Producers)
**`src/event_detectors/`**

Three producers run on independent schedules and publish raw snapshots to Kafka:

- **polymarket_producer** — polls the Polymarket CLOB API every 5–30 s. Computes a macro sentiment score across all markets, writes it to `Redis:polymarket:macro_sentiment`. Publishes one message per market to `raw.polymarket`.
- **news_producer** — fetches Finnhub articles for configured tickers, publishes to `raw.news`.
- **analytics_producer** — fetches yfinance snapshots (RSI-14, put/call ratio, volume), publishes to `raw.analytics`.

Each producer has its own `Dockerfile` and `requirements.txt` build context.

### Stage 2 — Event Processors (Consumers)
**`src/event_processors/`**

Three consumers read from Kafka and produce scored signals:

- **polymarket_consumer** — detects conviction shifts (|ΔP| ≥ 0.10 OR %Δ ≥ 0.20). Applies macro sentiment gate (`CONFIDENCE_THRESHOLD=0.40`). Writes signal to `PostgreSQL:signals`, publishes signal ID to `Redis:new_signal`.
- **news_consumer** — scores credibility × recency × keywords. Writes to `signals` + TimescaleDB `raw_news`.
- **analytics_consumer** — scores momentum / RSI / options signals with a 4-hour cooldown per ticker+type. Writes to `signals` + `raw_options`.

### Stage 3 — Feature Store
**`src/feature_store/`** — Entry: `scheduler.py`

Runs hourly. Reads from all `raw_*` TimescaleDB hypertables and writes one row per symbol per hour into `features`. Every 24th tick runs `label_filler.py` to backfill `forward_return_1d/5d/10d` from actual price data.

Two modes controlled by env var:
- **Normal**: hourly incremental build
- **Backfill** (`BACKFILL=true`): rebuilds 6-hour snapshots from history, then exits

### Stage 4 — Historical Ingestor
**`src/historical/`** — Entry: `ingestor.py::run_scheduler()`

Runs nightly. Fetches:
- **yfinance**: daily OHLCV for 20 equity tickers + commodities → `raw_ohlcv` + `technicals`
- **FRED API**: VIX, WTI crude, 10Y/2Y yields, fed funds rate, USD index → `raw_macro`

### Stage 5 — ML Trainer
**`src/ml/`** — Entry: `__main__.py`

Runs hourly. Retrains when:
1. Labeled rows ≥ `MIN_TRAIN_SAMPLES` (default 200)
2. At least `RETRAIN_INTERVAL_H` hours (default 24) since last train

Trains two **XGBoost classifiers** (long model, short model) on 33 features with time-series cross-validation (5 splits). Saves to `./models/`:
- `scoring_model.json`, `scoring_model_short.json`
- `shap_explainer.pkl`, `shap_explainer_short.pkl`

**33 Features:**

| Group | Features |
|---|---|
| Polymarket | `poly_conviction_delta_1h`, `poly_conviction_delta_4h`, `poly_volume_24h`, `poly_yes_price` |
| News | `news_sentiment_1h`, `news_sentiment_4h`, `news_hotness_peak_4h`, `news_article_count_4h` |
| Price / Technical | `rsi_14`, `macd_histogram`, `atr_14`, `bb_position`, `sma_20_slope`, `vol_ratio_30d`, `price_change_1d`, `price_change_5d` |
| Options | `put_call_ratio`, `unusual_sweep_count_4h` |
| Macro | `vix_level`, `wti_crude`, `us_10y_yield`, `fed_funds_rate`, `usd_index`, `yield_curve_10_2` |
| Advanced | `adx_14`, `bb_width`, `price_vs_sma50`, `atr_pct`, `hv_20`, `price_vs_52w_high`, `stoch_k` |

### Stage 6 — AI Correlator
**`src/ai_correlator/`** — Entry: `__main__.py` → `correlator.py::run()`

Subscribes to `Redis:new_signal`. For each signal:

1. Fetch signal from `signals` + latest feature row from TimescaleDB
2. Score with XGBoost (falls back to `rule_scorer.py` if no model loaded)
3. **Confidence gate**: drop if below threshold (0.65 baseline; 0.78–0.80 for contrarian, regime-adjusted)
4. Match against `hypotheses` table; run walk-forward backtest
5. **Backtest gate**: drop if win_rate < 45%
6. **Earnings guard**: drop if earnings within 3 days
7. **Dedup**: drop if same symbol opportunity created in last 15 min
8. Embed signal text with OpenAI `text-embedding-3-small`
9. Vector search `opportunities` via pgvector HNSW for similar past trades
10. Fetch macro snapshot from `raw_macro`
11. Call **Claude API** (`claude-sonnet-4-20250514`, max_tokens=800) with structured prompt → JSON `{summary, thesis, risk_note, historical_note}`
12. Save opportunity to `opportunities` table (with embedding)
13. Fan-out: per matching user subscription → Kelly-sized `strategies` rows → publish to `Redis:user:{id}:opportunities`
14. Publish only during NYSE/NASDAQ market hours

### Stage 7 — Frontend
**`src/web/`** — Next.js 14.2 App Router, TypeScript, Tailwind CSS

> The nextjs service is **commented out** in `docker-compose.yml`. Run locally with `npm run dev` inside `src/web/`.

Key pages:
- `/` — Strategy Inbox: real-time opportunity cards streamed via SSE
- `/auth/signin`, `/auth/register` — NextAuth 5.0 authentication
- `/(dashboard)/trades` — Alpaca trade history
- `/(dashboard)/settings` — User risk preferences + Alpaca API key setup
- `/onboarding` — Initial setup flow

Key API routes:
- `GET /api/strategies/stream` — SSE endpoint consuming `Redis:user:{id}:opportunities`
- `GET /api/strategies` — Paginated strategy list
- `PATCH /api/strategies/:id` — Update status (dismiss / execute)
- `POST /api/auth/register` — bcryptjs registration

---

## 5. Database Schemas

### PostgreSQL — `eventedge` (port 5432)
Schema file: `db/app_schema.sql`

| Table | Key Columns | Notes |
|---|---|---|
| `users` | email, password_hash, risk_level, max_position_pct, alpaca_key_id, alpaca_secret_key, paper_trading | Risk levels: conservative / moderate / aggressive |
| `subscriptions` | user_id, source (polymarket\|news\|analytics), symbol, threshold | Per-symbol alert subscriptions |
| `market_category_subscriptions` | user_id, category | Auto-expanded to `subscriptions` |
| `signals` | source, symbol, score, direction, payload (JSONB), embedding (vector) | HNSW index on embedding (cosine) |
| `hypotheses` | name, feature_conditions (JSONB), hold_days, confidence_threshold, invalidation_conditions | Named trading setups |
| `backtest_results` | hypothesis_id, sample_size, win_rate, avg_return_pct, sharpe, max_drawdown_pct, passed | Walk-forward results |
| `opportunities` | hypothesis_id, backtest_id, summary, thesis, risk_note, historical_note, action, tickers, model_confidence, embedding (vector) | HNSW index on embedding |
| `strategies` | user_id, opportunity_id, status, sizing_pct, expires_at | Per-user strategy instances |
| `trades` | user_id, symbol, side, qty, fill_price, pnl, alpaca_order_id | Execution history |
| `positions` | user_id, symbol, qty, avg_cost, realized_pnl | Active holdings |

Extensions: `vector` (pgvector), `uuid-ossp`

### TimescaleDB — `market_history` (port 5433)
Schema file: `db/history_schema.sql`

| Hypertable | Chunk Interval | Retention | Purpose |
|---|---|---|---|
| `raw_polymarket` | 1 day | 30 days | YES price ticks per market |
| `raw_news` | 1 day | 30 days | News articles with sentiment |
| `raw_ohlcv` | 1 day | 10 years | OHLCV candles (1h, 1d) |
| `raw_options` | 1 day | 30 days | Put/call volumes, unusual sweeps |
| `raw_macro` | 1 day | 10 years | FRED macro series |
| `technicals` | 1 day | 10 years | RSI, SMA, EMA, MACD, ATR, Bollinger, ADX |
| `features` | 1 hour | 90 days | 33 engineered features + forward return labels |

Auto-compression kicks in after 3–7 days on raw tables.

### Redis (port 6379)

| Key / Channel | Type | TTL | Producer | Consumer |
|---|---|---|---|---|
| `new_signal` | Pub/Sub channel | — | All consumers | ai-correlator |
| `user:{id}:opportunities` | Pub/Sub channel | — | ai-correlator | Next.js SSE |
| `polymarket:macro_sentiment` | String (JSON) | 6 h | polymarket-producer | polymarket-consumer, ai-correlator |

---

## 6. AI & ML Details

### XGBoost Models
- **Long model** (`scoring_model.json`): P(5-day return > +3%)
- **Short model** (`scoring_model_short.json`): P(5-day return < -3%)
- Hyperparameters: `n_estimators=400`, `max_depth=4`, `learning_rate=0.04`
- Class imbalance handled via `scale_pos_weight`
- SHAP explainers saved alongside for feature attribution display in UI

### Claude Integration
**File:** `src/ai_correlator/prompt.py` (prompt construction), `src/ai_correlator/correlator.py` (API call)

```python
_claude = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
response = _claude.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=800,
    messages=[{"role": "user", "content": prompt}]
)
narrative = json.loads(response.content[0].text)
```

Prompt includes: hypothesis name, signal scores, top-5 SHAP features, macro snapshot, Polymarket live probabilities, and 3 similar past opportunities. Returns JSON: `{summary, thesis, risk_note, historical_note}`.

### OpenAI Embeddings
**File:** `src/ai_correlator/correlator.py`

```python
_oai = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
_oai.embeddings.create(input=text, model="text-embedding-3-small")
```

Used to embed each signal description, then run pgvector HNSW cosine search over `opportunities.embedding` to find analogous historical trades.

### Regime Detection & Confidence Gates
- **Regime**: Bull/bear/sideways based on SPY vs 200-day SMA; volatility tier from VIX
- **Baseline gate**: `confidence < 0.65` → drop
- **Contrarian gate**: `confidence < 0.78–0.80` for trades against market trend
- **Backtest gate**: `win_rate < 45%` (loosened early when sample_size < 50)
- **Earnings guard**: skip if earnings within `EARNINGS_GUARD_DAYS` (default 3)
- **Dedup**: skip if same symbol opportunity within 15 min

### Position Sizing
Half-Kelly formula applied in fan-out step, capped by `max_position_pct` from user profile and scaled by signal confidence and realized volatility.

---

## 7. Environment Variables

### `env/python.env` (all Python services)

| Variable | Default / Example | Purpose |
|---|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | `redpanda:9092` | Redpanda broker address |
| `KAFKA_AUTO_CREATE_TOPICS` | `true` | Auto-create topics on first publish |
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/eventedge` | App PostgreSQL |
| `TIMESCALE_URL` | `postgresql://postgres:postgres@timescale:5432/market_history` | TimescaleDB |
| `REDIS_URL` | `redis://redis:6379` | Redis |
| `ANTHROPIC_API_KEY` | _(required)_ | Claude API access |
| `OPENAI_API_KEY` | _(required)_ | Embeddings |
| `FINNHUB_API_KEY` | _(required)_ | News data |
| `FRED_API_KEY` | _(required)_ | Macro data (FRED) |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `LOG_FORMAT` | `json` | `json` or `text` |
| `DEV_MODE` | `true` | Limits to smaller symbol set, 6-month lookback |
| `CONFIDENCE_THRESHOLD` | `0.40` | Polymarket conviction gate |
| `MIN_TRAIN_SAMPLES` | `200` | Minimum labeled rows to trigger retraining |
| `RETRAIN_INTERVAL_H` | `24` | Minimum hours between retrains |
| `EARNINGS_GUARD_DAYS` | `3` | Skip signals near earnings |

### `env/nextjs.env` (Next.js frontend)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL for user/auth queries |
| `TIMESCALE_URL` | TimescaleDB for historical data |
| `REDIS_URL` | Redis for SSE streaming |
| `NEXTAUTH_SECRET` | JWT signing secret (change in production) |
| `NEXTAUTH_URL` | `http://localhost:3000` |
| `ALPACA_KEY_ID` | Default Alpaca paper trading key |
| `ALPACA_SECRET_KEY` | Default Alpaca paper trading secret |

---

## 8. How to Run Locally

### Prerequisites
- Docker Desktop (Apple Silicon: all images are `platform: linux/arm64` except pgadmin which is `amd64`)
- Docker Compose v2

### Setup

```bash
# 1. Clone and enter repo
cd eventedge-ai

# 2. Fill in required secrets in env/python.env
#    Set: ANTHROPIC_API_KEY, OPENAI_API_KEY, FINNHUB_API_KEY, FRED_API_KEY

# 3. Start infrastructure first
docker compose up redpanda postgres timescale redis -d

# 4. Initialize databases (run once)
docker compose exec postgres psql -U postgres -d eventedge -f /docker-entrypoint-initdb.d/app_schema.sql
# (or mount db/ as init scripts — check docker-compose.yml for volume mounts)

# 5. Start all services
docker compose up -d

# 6. (Optional) Start the frontend separately
cd src/web
npm install
npm run dev        # http://localhost:3000
```

### Admin UIs

| UI | URL | Credentials |
|---|---|---|
| Redpanda Console (Kafka browser) | http://localhost:8080 | — |
| pgAdmin | http://localhost:5050 | Configured in pgadmin/servers.json |
| Next.js dev | http://localhost:3000 | — |

### Useful Commands

```bash
# View logs for a specific service
docker compose logs -f ai-correlator

# Force retrain the ML model
docker compose restart ml-trainer

# Trigger a feature backfill
docker compose run --rm feature-builder env BACKFILL=true python -m feature_store

# Watch Kafka topics
# Open http://localhost:8080 → Topics
```

---

## 9. Key File Index

| File | Purpose |
|---|---|
| `docker-compose.yml` | Full service orchestration (13 active services) |
| `db/app_schema.sql` | PostgreSQL DDL (users, signals, opportunities, strategies) |
| `db/history_schema.sql` | TimescaleDB DDL (raw hypertables, features) |
| `env/python.env` | Shared env vars for all Python services |
| `src/config/market_categories.py` | Symbol → category mapping used across services |
| `src/ai_correlator/correlator.py` | Main orchestration loop (signal → opportunity) |
| `src/ai_correlator/prompt.py` | Claude prompt construction |
| `src/ai_correlator/rule_scorer.py` | Fallback rule-based scorer (no ML required) |
| `src/ml/train.py` | XGBoost training pipeline |
| `src/feature_store/builder.py` | Hourly feature snapshot logic |
| `src/feature_store/label_filler.py` | Nightly forward-return label computation |
| `src/historical/ingestor.py` | yfinance + FRED nightly ingestion |
| `src/event_detectors/polymarket_producer/conviction.py` | Conviction shift detection logic |
| `src/event_processors/polymarket_consumer/consumer.py` | Polymarket signal scoring |
| `src/web/hooks/useStrategyStream.ts` | SSE client hook for real-time opportunities |
| `src/web/app/api/strategies/stream/route.ts` | SSE server endpoint |
| `pyrightconfig.json` | Python type checking configuration |

---

## 10. Development Notes

### DEV_MODE
When `DEV_MODE=true` (default), services limit to a smaller symbol set and use a 6-month historical lookback. Set to `false` for production-scale data volumes.

### No CI/CD
There is no `.github/` or CI pipeline configured. All testing is manual. The worktree directory contains some ad-hoc test scripts (`test_conviction_event.py`, `test_chat_e2e.py`).

### Frontend Status
The `nextjs` service is **commented out** in `docker-compose.yml` to avoid startup order issues. Run it separately with `npm run dev` inside `src/web/` during development.

### Python Type Checking
`pyrightconfig.json` is present at the repo root. Run `pyright` to check types across the `src/` directory.

### Model Persistence
The `./models/` directory is mounted as a Docker volume into both `ml-trainer` (read-write) and `ai-correlator` (read-only). The correlator falls back to `rule_scorer.py` if no model files are present.

### Redpanda vs Kafka
The stack uses Redpanda, a Kafka-compatible broker. The `confluent-kafka` Python library works without modification. Topics are auto-created on first publish (`KAFKA_AUTO_CREATE_TOPICS=true`).

### Logging
All Python services emit structured JSON logs when `LOG_FORMAT=json`. Set `LOG_LEVEL=debug` for verbose output during development.
