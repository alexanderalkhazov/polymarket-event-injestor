# eventedge-ai

Algorithmic trading system with three independent signal pipelines, a backtester, and a Claude-powered AI correlator that generates per-user strategies executed via Alpaca.

---

## Architecture

```
Polymarket API  →  polymarket-producer  ─┐
Finnhub API     →  news-producer        ─┼─→ Kafka (raw.*) ─→ consumers ─→ pg (signals)
yfinance        →  analytics-producer   ─┘

signals in pg
      │
      ▼
backtester (vectorbt) — "has this setup worked historically?"
      │ pass (win_rate ≥ 45%, sample ≥ 20)
      ▼
ai-correlator (Claude API + pgvector + macro snapshot)
      │ confidence ≥ 0.60
      ▼
opportunity → per-user strategy → Redis pub/sub → Next.js SSE → browser

Next.js ←→ pg (users, strategies, trades, signals)
Next.js ←→ timescaledb (OHLCV, macro, charts)
Next.js ──→ Alpaca (order execution)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Python producers | Python 3.11, confluent-kafka (dumb — fetch + publish raw) |
| Python consumers | Python 3.11, asyncpg, redis (smart — detect signals, write to pg) |
| Message broker | Apache Kafka (Confluent 7.6) + Zookeeper |
| App DB | PostgreSQL 16 + pgvector (signals, users, strategies, trades) |
| Historical DB | PostgreSQL 16 + TimescaleDB (OHLCV, macro, technicals) |
| Cache / pub-sub | Redis 7 |
| DB admin | pgAdmin 4 (both DBs pre-registered, port 5050) |
| Backtester | Python, vectorbt |
| Historical ingest | Python, yfinance, pandas-ta, fredapi (nightly 00:30 UTC) |
| AI correlation | Claude API (claude-sonnet-4-20250514) + OpenAI embeddings |
| Execution | Alpaca Trade API (paper + live) |
| Frontend | Next.js 14 App Router (UI + BFF in one service) |
| Monitoring | Prometheus + Grafana |
| Containers | Docker Compose (17 services) |

---

## Directory Layout

```
eventedge-ai/
├── src/
│   ├── event_detectors/
│   │   ├── pg_subscription_manager.py    # shared — reads subscriptions from postgres
│   │   ├── polymarket_producer/          # polls Polymarket, publishes raw to raw.polymarket
│   │   ├── news_producer/                # polls Finnhub, publishes raw to raw.news
│   │   ├── analytics_producer/           # polls yfinance, publishes raw to raw.analytics
│   │   ├── stock_news_producer/          # (legacy — data_source.py reused by news_producer)
│   │   └── stock_analytics_producer/     # (legacy — data_source.py reused by analytics_producer)
│   ├── event_processors/
│   │   ├── polymarket_consumer/          # conviction detection → pg signals + redis
│   │   │   └── consumer.py
│   │   ├── news_consumer/                # hotness scoring → pg signals + redis
│   │   │   └── consumer.py
│   │   └── analytics_consumer/           # volume/RSI/options → pg signals + redis
│   │       └── consumer.py
│   ├── historical/
│   │   └── ingestor.py                   # nightly OHLCV + FRED macro → timescaledb
│   ├── backtester/
│   │   └── backtester.py                 # SignalBacktester (vectorbt) — called by ai-correlator
│   ├── ai_correlator/
│   │   ├── correlator.py                 # main pipeline: subscribe → backtest → Claude → fan-out
│   │   ├── prompt.py                     # build_prompt() for Claude
│   │   └── fan_out.py                    # per-user strategy sizing + Redis publish
│   ├── observability/                    # shared logging + Prometheus helpers
│   └── web/                             # Next.js 14 App Router
│       ├── app/
│       │   ├── (dashboard)/             # sidebar shell, auth-guarded
│       │   │   ├── page.tsx             # strategy inbox (default route)
│       │   │   ├── correlator/          # signal feed + pipeline status
│       │   │   ├── chart/               # OHLCV + indicators + backtest markers
│       │   │   ├── backtests/           # backtest explorer
│       │   │   ├── trades/              # trade history + open positions
│       │   │   └── settings/
│       │   ├── api/
│       │   │   ├── auth/                # NextAuth + register
│       │   │   ├── signals/             # GET signals (SWR-polled)
│       │   │   ├── strategies/
│       │   │   │   ├── route.ts         # GET/PATCH strategies
│       │   │   │   └── stream/route.ts  # SSE via Redis subscribe
│       │   │   ├── trades/route.ts      # POST execute via Alpaca
│       │   │   ├── backtests/           # GET backtest results
│       │   │   ├── history/[symbol]/    # GET OHLCV + technicals from TimescaleDB
│       │   │   └── subscriptions/       # GET/POST/DELETE subscriptions
│       │   └── layout.tsx               # root layout — DM Sans/DM Mono, CSS vars
│       ├── lib/
│       │   ├── db.ts                    # pg Pool → postgres:5432/eventedge
│       │   ├── tsdb.ts                  # pg Pool → timescale:5432/market_history
│       │   ├── redis.ts                 # ioredis singleton
│       │   ├── auth.ts                  # NextAuth Credentials provider
│       │   └── alpaca.ts               # getAlpaca(paper, keyId, secret)
│       └── hooks/
│           └── useStrategyStream.ts     # SSE with auto-reconnect
├── db/
│   ├── app_schema.sql                   # postgres schema (users, signals, strategies, trades)
│   └── history_schema.sql               # timescaledb schema (ohlcv, macro, technicals)
├── pgadmin/
│   └── servers.json                     # pre-registers both DBs for pgAdmin
├── env/
│   ├── python.env                       # shared by all Python services
│   ├── nextjs.env                       # Next.js app
│   ├── kafka.env                        # Kafka broker config
│   └── zookeeper.env
├── observability/                        # Prometheus + Grafana configs
├── scripts/                             # seed scripts, utilities
├── docker-compose.yml
├── Dockerfile                           # Python 3.11-slim, PYTHONPATH=/app/src
└── pyproject.toml
```

---

## Running Locally

```bash
docker-compose up -d
```

| Service | URL |
|---|---|
| Web UI (Next.js) | http://localhost:3000 |
| pgAdmin | http://localhost:5050 (admin@eventedge.local / admin) |
| Grafana | http://localhost:3001 (admin/admin) |
| Prometheus | http://localhost:9090 |
| PostgreSQL app DB | localhost:5432 / eventedge |
| TimescaleDB | localhost:5433 / market_history |
| Redis | localhost:6379 |

---

## Kafka Topics

| Topic | Producer | Consumer |
|---|---|---|
| `raw.polymarket` | polymarket-producer | polymarket-consumer |
| `raw.news` | news-producer | news-consumer |
| `raw.analytics` | analytics-producer | analytics-consumer |

---

## Key Environment Variables

Both `env/python.env` and `env/nextjs.env` must be filled before running.

| Variable | Required by |
|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | All Python services |
| `DATABASE_URL` | All Python consumers + Next.js |
| `TIMESCALE_URL` | historical-ingestor, backtester, ai-correlator, Next.js |
| `REDIS_URL` | Consumers, ai-correlator, Next.js |
| `ANTHROPIC_API_KEY` | ai-correlator |
| `OPENAI_API_KEY` | ai-correlator (embeddings) |
| `FINNHUB_API_KEY` | news-producer |
| `FRED_API_KEY` | historical-ingestor |
| `NEXTAUTH_SECRET` | Next.js |
| `ALPACA_KEY_ID` + `ALPACA_SECRET_KEY` | Next.js (trades route) |

---

## Signal Pipeline (end-to-end, 16 steps)

1. Producer polls API → publishes raw JSON to `raw.*` Kafka topic
2. Consumer reads raw event → runs detection algorithm → if signal: INSERT into `signals` table → PUBLISH signal ID to Redis `new_signal`
3. AI correlator wakes on Redis message → fetches signal from pg
4. **Time-window gate:** need 2+ sources in last 15 min → fewer: DROP
5. **Backtest gate:** vectorbt against 2 years TimescaleDB history
   - sample_size < 20: DROP
   - win_rate < 45%: DROP
6. Embed signal with OpenAI text-embedding-3-small → store in `signals.embedding`
7. pgvector semantic search: top-5 similar past signals + top-3 similar past opportunities
8. TimescaleDB macro snapshot: FEDFUNDS, VIX, WTI, CPI, 10Y yield, USD
9. Claude API call (claude-sonnet-4-20250514): signals + backtest + similar history + macro
10. if not opportunity or confidence < 0.60: DROP
11. Save opportunity with embedding + backtest_result
12. Fan-out: find users subscribed to tickers → build per-user strategy (sized by risk_level)
13. PUBLISH to Redis `strategies:{user_id}`
14. Next.js SSE delivers strategy to browser in real time
15. User reviews: summary, thesis, backtest stats, expected return, stop/TP, macro notes
16. User holds confirm (3s) → POST /api/trades → Alpaca market order

---

## Detection Algorithms

**Polymarket (conviction_shift):**
- Tracks YES price per market in memory
- Fires if: `|Δprice| ≥ 0.10` absolute OR `|Δprice/prev| ≥ 0.20` relative

**Stock News (hotness):**
- `hotness = recency_decay × source_credibility × keyword_multiplier`
- Recency: exponential decay, half-life 4h
- Source credibility: Reuters/Bloomberg=1.0, unknown=0.55
- Hot keywords (earnings, FDA, merger, bankruptcy, etc.) multiply up to 2×
- Fires if hotness ≥ 0.40; deduplicates by article ID

**Stock Analytics (4 independent signals, 4h cooldown each):**
- `volume_spike`: current_vol > 2× 30-day avg
- `momentum`: |1-day price change| > 5%
- `rsi_extreme`: RSI(14) < 25 or > 75
- `options_unusual`: put/call ratio < 0.33 or > 3.0

---

## App DB Schema Key Tables

```
users            — auth, risk_level, alpaca keys, paper/live toggle
subscriptions    — source + symbol per user (polymarket = market_id, news/analytics = ticker)
signals          — all detected signals with pgvector embedding
backtest_results — vectorbt output (passed/dropped, win_rate, sample_size, expectancy)
opportunities    — Claude-approved trade setups with embedding
strategies       — per-user, sized to risk profile, expires in 4h
trades           — Alpaca order records + P&L
positions        — open positions with avg cost
```

---

## Next.js Design System

- Dark-first. Colors in CSS variables (--bg, --bg1, --bg2, --border, --green, --red, --amber, etc.)
- Numbers/tickers/prices always in DM Mono font
- Labels always 10px uppercase with letter-spacing
- Confirm button requires 3-second hold for both paper and live orders
- Expected return always shown with win_rate + sample_size + disclaimer

---

## Current State (branch: `change-of-arch`)

- Full architecture redesign in progress (this branch)
- Python producers and consumers refactored to new structure
- Next.js app scaffolded with all API routes and lib/ clients
- Historical ingestor, backtester, AI correlator implemented
- Next.js UI pages and components: strategy inbox has initial implementation; remaining pages (correlator, chart, backtests, trades, settings, onboarding) need component-level implementation
- Old BFF (`src/web-app/bff/`) and React app (`src/web-app/web-client/`) still present — remove once Next.js is confirmed working

## Development Notes

- Python services share one Docker image. Entry points:
  - `python -m event_detectors.polymarket_producer`
  - `python -m event_detectors.news_producer`
  - `python -m event_detectors.analytics_producer`
  - `python -m event_processors.polymarket_consumer`
  - `python -m event_processors.news_consumer`
  - `python -m event_processors.analytics_consumer`
  - `python -m historical.ingestor`
  - `python -m ai_correlator.__main__`
- `PYTHONPATH=/app/src` set in Dockerfile so all top-level module imports work
- Python lint: `ruff`, type-check: `pyright`
- Next.js runs `next dev` in development, `next start` (compiled) in production
