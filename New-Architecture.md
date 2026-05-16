Backend + System Design
# eventedge-ai — algo trading system

## What this system actually does

1. Ingests real-time signals from Polymarket, news, and market analytics
2. Enriches them against a historical data store (OHLCV, fundamentals, macro)
3. Runs a backtester to validate any signal cluster against history before escalating it
4. Sends validated cross-source opportunities through Claude for narrative reasoning
5. Generates per-user strategies sized to risk profile with a simulated expected-return estimate
6. Executes via Alpaca (paper or live) with position tracking and P&L accounting

The system does not promise returns. It estimates edge based on historically similar setups,
surfaces the confidence interval, and lets the user decide. Everything is auditable.

---

## Full stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Producers | Python 3.11, confluent-kafka | Dumb fetchers — poll and publish raw |
| Message broker | Apache Kafka + Zookeeper | Raw event streaming |
| Consumers | Python 3.11 | Smart detectors — signal detection lives here |
| Historical store | PostgreSQL 16 + TimescaleDB | OHLCV, fundamentals, macro time-series |
| Signal/app store | PostgreSQL 16 + pgvector | Signals, opportunities, strategies, trades, users |
| Cache | Redis 7 | SSE pub/sub fan-out, rate-limit counters |
| AI correlation | Claude API (claude-sonnet-4-20250514) | Cross-source reasoning with historical context |
| Embeddings | OpenAI text-embedding-3-small | Signal and opportunity semantic memory |
| Backtester | Python (vectorbt) | Validate setups before escalating |
| Historical ingest | Python (yfinance, FRED API) | Nightly OHLCV + macro pull |
| Frontend | Next.js 14 (App Router) | UI + BFF in one service |
| DB admin UI | pgAdmin 4 | SQL GUI — connects to both PostgreSQL instances |
| Execution | Alpaca Trade API | Paper and live order management |
| Monitoring | Prometheus + Grafana | Metrics across all services |

---

## Architecture

```
                    ┌─ Polymarket API ─→ polymarket-producer ─┐
                    ├─ Finnhub API    ─→ news-producer        ─┼─→ Kafka (raw.*) ─→ consumers ─→ pg (signals)
                    └─ yfinance       ─→ analytics-producer   ─┘         ↑
                                                                          │ enrich from
                    ┌─ yfinance/FRED  ─→ historical-ingestor ────────────┤
                    └─ (nightly batch)                         timescaledb (OHLCV, macro)

    new signal in pg
          │
          ▼
    backtester (vectorbt)
    "has this setup worked historically?"
          │
          ├── win_rate < 45% or sample_size < 20 → DROP (logged)
          │
          ▼
    AI correlator (Claude API)
    recent signals + similar past signals (pgvector) + backtest result + macro snapshot
          │
          ├── confidence < 0.60 → DROP (logged)
          │
          ▼
    opportunity saved → per-user strategy generated → Redis pub/sub → Next.js SSE → browser

    Next.js ←─→ pg (users, strategies, trades)
    Next.js ←─→ timescaledb (charts, backtests)
    Next.js ─→  Alpaca (order execution)

    pgAdmin ←─→ pg + timescaledb (DB admin GUI at :5050)
```

---

## Docker Compose services

| Service | Port | Notes |
|---------|------|-------|
| `nextjs` | 3000 | App + API routes |
| `kafka` | 9092 | Confluent 7.6 |
| `zookeeper` | 2181 | Required by Kafka |
| `postgres` | 5432 | App DB — signals, users, trades (pgvector extension) |
| `timescale` | 5433 | Historical DB — OHLCV, macro, technicals (TimescaleDB extension) |
| `redis` | 6379 | SSE fan-out pub/sub |
| `pgadmin` | 5050 | DB admin GUI — both DBs pre-connected, no login needed locally |
| `polymarket-producer` | — | Python, polls 30s |
| `news-producer` | — | Python, polls 5m |
| `analytics-producer` | — | Python, polls 15m |
| `historical-ingestor` | — | Python, nightly at 00:30 UTC |
| `polymarket-consumer` | 9101 | Detects conviction shifts |
| `news-consumer` | 9102 | Hotness scoring + dedupe |
| `analytics-consumer` | 9103 | Volume / RSI / options detection |
| `backtester` | 9104 | Validates signal clusters before AI escalation |
| `ai-correlator` | 9105 | Claude API + pgvector semantic search |
| `grafana` | 3001 | Dashboards |
| `prometheus` | 9090 | Metrics scrape |

### pgAdmin setup (docker-compose.yml snippet)

```yaml
pgadmin:
  image: dpage/pgadmin4:latest
  environment:
    PGADMIN_DEFAULT_EMAIL: admin@eventedge.local
    PGADMIN_DEFAULT_PASSWORD: admin
    PGADMIN_CONFIG_SERVER_MODE: "False"
    PGADMIN_CONFIG_MASTER_PASSWORD_REQUIRED: "False"
  ports:
    - "5050:80"
  volumes:
    - pgadmin_data:/var/lib/pgadmin
    - ./pgadmin/servers.json:/pgadmin4/servers.json:ro
  depends_on:
    - postgres
    - timescale
```

```json
// pgadmin/servers.json — pre-registers both DBs on first boot
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
      "Name": "Historical DB (OHLCV, macro)",
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

## Directory layout

```
eventedge-ai/
├── src/
│   ├── event_detectors/               # dumb — fetch raw, publish to Kafka
│   │   ├── polymarket_producer/
│   │   ├── news_producer/
│   │   └── analytics_producer/
│   ├── event_processors/              # smart — detection logic lives here
│   │   ├── polymarket_consumer/
│   │   │   ├── consumer.py
│   │   │   └── conviction.py          # moved from producer
│   │   ├── news_consumer/
│   │   │   ├── consumer.py
│   │   │   └── signal_detector.py     # moved from producer
│   │   └── analytics_consumer/
│   │       ├── consumer.py
│   │       └── signal_detector.py     # moved from producer
│   ├── historical/
│   │   ├── ingestor.py                # nightly OHLCV + macro pull
│   │   ├── sources/
│   │   │   ├── yfinance_source.py
│   │   │   └── fred_source.py
│   │   └── schema.sql
│   ├── backtester/
│   │   ├── backtester.py              # vectorbt signal validation
│   │   ├── strategies/
│   │   │   ├── base.py
│   │   │   ├── conviction_momentum.py
│   │   │   ├── news_catalyst.py
│   │   │   └── multi_signal.py
│   │   └── metrics.py                 # sharpe, drawdown, expectancy
│   ├── ai_correlator/
│   │   ├── correlator.py
│   │   ├── embedder.py
│   │   ├── prompt.py
│   │   └── fan_out.py
│   ├── observability/
│   └── web/                           # Next.js app
│       ├── app/
│       │   ├── (dashboard)/
│       │   │   ├── layout.tsx
│       │   │   ├── correlator/page.tsx
│       │   │   ├── signals/page.tsx
│       │   │   ├── strategies/page.tsx
│       │   │   ├── backtests/page.tsx
│       │   │   ├── history/page.tsx
│       │   │   └── trades/page.tsx
│       │   ├── api/
│       │   │   ├── auth/[...nextauth]/route.ts
│       │   │   ├── signals/route.ts
│       │   │   ├── strategies/route.ts
│       │   │   ├── strategies/stream/route.ts
│       │   │   ├── trades/route.ts
│       │   │   ├── backtests/route.ts
│       │   │   └── history/[symbol]/route.ts
│       │   └── layout.tsx
│       ├── lib/
│       │   ├── db.ts
│       │   ├── tsdb.ts
│       │   ├── redis.ts
│       │   ├── auth.ts
│       │   └── alpaca.ts
│       └── components/
│           ├── SignalFeed.tsx
│           ├── OpportunityCard.tsx
│           ├── BacktestResult.tsx
│           ├── PriceChart.tsx
│           ├── StrategyCard.tsx
│           └── TradeConfirm.tsx
├── db/
│   ├── app_schema.sql
│   └── history_schema.sql
├── pgadmin/
│   └── servers.json
├── env/
├── observability/
├── scripts/
├── docker-compose.yml
├── Dockerfile
└── pyproject.toml
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

CREATE TABLE backtest_results (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_ids         UUID[] NOT NULL,
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

CREATE TABLE opportunities (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_ids          UUID[] NOT NULL,
  backtest_id         UUID REFERENCES backtest_results(id),
  confidence          NUMERIC NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  summary             TEXT NOT NULL,
  thesis              TEXT NOT NULL,
  action              TEXT NOT NULL CHECK (action IN ('buy', 'sell', 'watch')),
  tickers             TEXT[] NOT NULL DEFAULT '{}',
  expected_return_pct NUMERIC,
  hold_days           INT,
  stop_loss_pct       NUMERIC,
  historical_context  TEXT,
  macro_notes         TEXT,
  embedding           vector(1536),
  raw_response        JSONB,
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
                     CHECK (status IN ('pending', 'submitted', 'filled', 'cancelled', 'rejected')),
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

CREATE TABLE ohlcv (
  time     TIMESTAMPTZ NOT NULL,
  symbol   TEXT NOT NULL,
  open     NUMERIC NOT NULL,
  high     NUMERIC NOT NULL,
  low      NUMERIC NOT NULL,
  close    NUMERIC NOT NULL,
  volume   BIGINT NOT NULL,
  interval TEXT NOT NULL CHECK (interval IN ('1d', '1h')),
  PRIMARY KEY (time, symbol, interval)
);
SELECT create_hypertable('ohlcv', 'time');
CREATE INDEX ohlcv_symbol ON ohlcv (symbol, time DESC);

CREATE TABLE macro_indicators (
  time      TIMESTAMPTZ NOT NULL,
  series_id TEXT NOT NULL,
  value     NUMERIC NOT NULL,
  PRIMARY KEY (time, series_id)
);
SELECT create_hypertable('macro_indicators', 'time');

CREATE TABLE technicals (
  time        TIMESTAMPTZ NOT NULL,
  symbol      TEXT NOT NULL,
  interval    TEXT NOT NULL,
  rsi_14      NUMERIC,
  sma_20      NUMERIC,
  sma_50      NUMERIC,
  ema_12      NUMERIC,
  ema_26      NUMERIC,
  macd        NUMERIC,
  macd_signal NUMERIC,
  atr_14      NUMERIC,
  bb_upper    NUMERIC,
  bb_lower    NUMERIC,
  adx_14      NUMERIC,
  PRIMARY KEY (time, symbol, interval)
);
SELECT create_hypertable('technicals', 'time');

-- weekly continuous aggregate (TimescaleDB computes this automatically)
CREATE MATERIALIZED VIEW ohlcv_weekly
  WITH (timescaledb.continuous) AS
  SELECT time_bucket('7 days', time) AS week,
         symbol,
         first(open, time)  AS open,
         max(high)          AS high,
         min(low)           AS low,
         last(close, time)  AS close,
         sum(volume)        AS volume
  FROM ohlcv WHERE interval = '1d'
  GROUP BY week, symbol;
```

---

## Historical ingestor (nightly batch)

```python
# historical/ingestor.py
import yfinance as yf
import pandas as pd
import pandas_ta as ta
from fredapi import Fred
import asyncpg, asyncio, os

FRED_SERIES = [
  "FEDFUNDS",   # fed funds rate
  "CPIAUCSL",   # CPI
  "DCOILWTICO", # WTI crude
  "DGS10",      # US 10Y yield
  "VIXCLS",     # VIX
  "DTWEXBGS",   # USD index
]

async def ingest_ohlcv(symbols: list[str], conn: asyncpg.Connection):
    df = yf.download(symbols, period="2y", interval="1d", auto_adjust=True)
    for symbol in symbols:
        try:
            s = df.xs(symbol, axis=1, level=1).dropna()
        except KeyError:
            continue

        s["rsi_14"]      = ta.rsi(s["Close"], length=14)
        s["sma_20"]      = ta.sma(s["Close"], length=20)
        s["sma_50"]      = ta.sma(s["Close"], length=50)
        macd             = ta.macd(s["Close"])
        s["macd"]        = macd["MACD_12_26_9"]
        s["macd_signal"] = macd["MACDs_12_26_9"]
        s["atr_14"]      = ta.atr(s["High"], s["Low"], s["Close"], 14)
        bb               = ta.bbands(s["Close"], length=20)
        s["bb_upper"]    = bb["BBU_20_2.0"]
        s["bb_lower"]    = bb["BBL_20_2.0"]

        rows = [
            (row.Index.to_pydatetime(), symbol,
             row.Open, row.High, row.Low, row.Close, int(row.Volume), "1d")
            for row in s.itertuples()
        ]
        await conn.executemany(
            """INSERT INTO ohlcv (time,symbol,open,high,low,close,volume,interval)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (time,symbol,interval) DO UPDATE
               SET open=$3,high=$4,low=$5,close=$6,volume=$7""",
            rows
        )

async def ingest_macro(conn: asyncpg.Connection):
    fred = Fred(api_key=os.environ["FRED_API_KEY"])
    for series_id in FRED_SERIES:
        data = fred.get_series(series_id, observation_start="2020-01-01")
        rows = [(ts.to_pydatetime(), series_id, float(val))
                for ts, val in data.items() if pd.notna(val)]
        await conn.executemany(
            """INSERT INTO macro_indicators (time,series_id,value)
               VALUES ($1,$2,$3)
               ON CONFLICT (time,series_id) DO UPDATE SET value=$3""",
            rows
        )
```

---

## Backtester — validate before Claude sees it

```python
# backtester/backtester.py
import vectorbt as vbt
import numpy as np
import pandas as pd

MIN_SAMPLE = 20
MIN_WIN    = 0.45

class SignalBacktester:
    def __init__(self, tsdb):
        self.tsdb = tsdb

    async def validate(self, signals: list[dict]) -> dict:
        symbol = signals[0]["symbol"]
        ohlcv  = await self._load_ohlcv(symbol)
        if ohlcv is None or len(ohlcv) < 60:
            return self._fail("insufficient history")

        entry_dates = await self._find_similar_setups(signals, ohlcv)
        if len(entry_dates) < MIN_SAMPLE:
            return self._fail(f"only {len(entry_dates)} occurrences, need {MIN_SAMPLE}")

        returns  = self._forward_returns(ohlcv, entry_dates, hold_days=5)
        wins     = [r for r in returns if r > 0]
        losses   = [r for r in returns if r <= 0]
        win_rate = len(wins) / len(returns)
        avg_ret  = float(np.mean(returns))
        med_ret  = float(np.median(returns))
        avg_win  = float(np.mean(wins))   if wins   else 0.0
        avg_loss = float(np.mean(losses)) if losses else 0.0
        expect   = win_rate * avg_win - (1 - win_rate) * abs(avg_loss)

        passed = win_rate >= MIN_WIN and len(returns) >= MIN_SAMPLE

        return {
            "passed":             passed,
            "sample_size":        len(returns),
            "win_rate":           round(win_rate, 4),
            "avg_return_pct":     round(avg_ret * 100, 2),
            "median_return_pct":  round(med_ret * 100, 2),
            "expectancy":         round(expect * 100, 2),
            "sharpe":             round(self._sharpe(returns), 2),
            "max_drawdown_pct":   round(self._max_dd(returns) * 100, 2),
            "strategy_name":      "multi_" + "+".join(sorted({s["type"] for s in signals})),
            "symbol":             symbol,
        }

    async def _find_similar_setups(self, signals, ohlcv) -> list:
        mask = pd.Series(True, index=ohlcv.index)
        for s in signals:
            if s["type"] == "volume_spike":
                avg30 = ohlcv["volume"].rolling(30).mean()
                mask &= ohlcv["volume"] > 2 * avg30
            elif s["type"] == "rsi_extreme":
                rsi = vbt.RSI.run(ohlcv["close"], window=14).rsi
                mask &= (rsi > 75) if s["direction"] == "up" else (rsi < 25)
            elif s["type"] == "momentum":
                chg = ohlcv["close"].pct_change(1)
                mask &= (chg > 0.05) if s["direction"] == "up" else (chg < -0.05)
            elif s["type"] == "conviction_shift":
                vix = await self._load_macro("VIXCLS", ohlcv.index)
                if vix is not None:
                    mask &= vix > vix.rolling(20).mean() * 1.2
        return list(ohlcv.index[mask])

    def _forward_returns(self, ohlcv, dates, hold_days) -> list[float]:
        closes  = ohlcv["close"]
        results = []
        for d in dates:
            try:
                i   = closes.index.get_loc(d)
                j   = min(i + hold_days, len(closes) - 1)
                results.append((closes.iloc[j] - closes.iloc[i]) / closes.iloc[i])
            except Exception:
                continue
        return results

    def _sharpe(self, r):
        a = np.array(r)
        return float(np.mean(a) / np.std(a) * np.sqrt(252)) if np.std(a) > 0 else 0.0

    def _max_dd(self, r):
        curve = np.cumprod(1 + np.array(r))
        peak  = np.maximum.accumulate(curve)
        return float(((curve - peak) / peak).min())

    def _fail(self, reason):
        return {"passed": False, "drop_reason": reason,
                "sample_size": 0, "win_rate": 0, "expectancy": 0}
```

---

## AI correlator — full pipeline

```python
# ai_correlator/correlator.py
import anthropic, json
from openai import OpenAI

claude = anthropic.Anthropic()
oai    = OpenAI()

def embed(text: str) -> list[float]:
    return oai.embeddings.create(
        input=text, model="text-embedding-3-small"
    ).data[0].embedding

def sig_text(s: dict) -> str:
    return f"{s['source']} {s['type']} {s['symbol']} score={s['score']} dir={s['direction']}"

async def run(new_signal: dict, db, tsdb):
    # 1. embed and store
    vec = embed(sig_text(new_signal))
    await db.execute("UPDATE signals SET embedding=$1 WHERE id=$2",
                     [vec, new_signal["id"]])

    # 2. time-window gate — need 2+ sources
    recent  = await db.fetch(
        "SELECT * FROM signals WHERE created_at > NOW()-INTERVAL '15 minutes'"
    )
    sources = {s["source"] for s in recent}
    if len(sources) < 2:
        return None

    # 3. backtest gate — drop if no historical edge
    bt = await SignalBacktester(tsdb).validate(recent)
    if not bt["passed"]:
        await db.execute(
            "INSERT INTO backtest_results (signal_ids,strategy_name,symbol,sample_size,"
            "win_rate,avg_return_pct,median_return_pct,expectancy,passed,drop_reason,payload) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10)",
            [[s["id"] for s in recent], bt.get("strategy_name","unknown"),
             new_signal["symbol"], bt["sample_size"], bt["win_rate"],
             bt.get("avg_return_pct",0), bt.get("median_return_pct",0),
             bt["expectancy"], bt.get("drop_reason"), json.dumps(bt)]
        )
        return None

    # 4. semantic context
    sim_sigs = await db.fetch(
        """SELECT *, 1-(embedding<=>$1::vector) AS sim FROM signals
           WHERE created_at < NOW()-INTERVAL '15 minutes' AND embedding IS NOT NULL
           ORDER BY embedding<=>$1::vector LIMIT 5""", [vec]
    )
    sim_opps = await db.fetch(
        """SELECT *, 1-(embedding<=>$1::vector) AS sim FROM opportunities
           WHERE embedding IS NOT NULL
           ORDER BY embedding<=>$1::vector LIMIT 3""", [vec]
    )

    # 5. macro snapshot
    macro = await tsdb.fetch(
        """SELECT DISTINCT ON (series_id) series_id, value
           FROM macro_indicators
           ORDER BY series_id, time DESC"""
    )

    # 6. Claude reasoning
    prompt = build_prompt(new_signal, recent, sim_sigs, sim_opps, macro, bt)
    resp   = claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1200,
        messages=[{"role": "user", "content": prompt}]
    )
    opp = json.loads(resp.content[0].text)
    if not opp["is_opportunity"] or opp["confidence"] < 0.60:
        return None

    # 7. save backtest + opportunity + embedding
    saved_bt = await db.fetchrow(
        """INSERT INTO backtest_results
           (signal_ids,strategy_name,symbol,sample_size,win_rate,avg_return_pct,
            median_return_pct,sharpe,max_drawdown_pct,expectancy,passed,payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11) RETURNING id""",
        [[s["id"] for s in recent], bt["strategy_name"], new_signal["symbol"],
         bt["sample_size"], bt["win_rate"], bt["avg_return_pct"],
         bt["median_return_pct"], bt.get("sharpe"), bt.get("max_drawdown_pct"),
         bt["expectancy"], json.dumps(bt)]
    )
    opp_vec   = embed(opp["summary"] + " " + opp["thesis"])
    saved_opp = await db.fetchrow(
        """INSERT INTO opportunities
           (signal_ids,backtest_id,confidence,summary,thesis,action,tickers,
            expected_return_pct,hold_days,stop_loss_pct,historical_context,
            macro_notes,embedding,raw_response)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *""",
        [[s["id"] for s in recent], saved_bt["id"], opp["confidence"],
         opp["summary"], opp["thesis"], opp["action"], opp["tickers"],
         opp.get("expected_return_pct"), opp.get("hold_days"),
         opp.get("stop_loss_pct"), opp.get("historical_context"),
         opp.get("macro_notes"), opp_vec, json.dumps(opp)]
    )

    await fan_out_to_users(saved_opp, db)
    return saved_opp


def build_prompt(new_signal, recent, sim_sigs, sim_opps, macro, bt) -> str:
    recent_str  = "\n".join(f"  {sig_text(s)}" for s in recent)
    sim_sig_str = "\n".join(
        f"  [{s['sim']:.0%}] {sig_text(s)}" for s in sim_sigs
    ) or "  none"
    sim_opp_str = "\n".join(
        f"  [{o['sim']:.0%}] {o['summary']} — action={o['action']} conf={o['confidence']:.0%}"
        for o in sim_opps
    ) or "  none"
    macro_str = "\n".join(f"  {r['series_id']}: {r['value']}" for r in macro)

    return f"""You are a quantitative analyst inside an algorithmic trading system.

NEW SIGNAL:
  {sig_text(new_signal)}

RECENT CROSS-SOURCE SIGNALS (last 15 min, {len(recent)} signals, {len({s['source'] for s in recent})} sources):
{recent_str}

BACKTEST RESULT (how this exact signal combination performed historically):
  sample_size={bt['sample_size']} occurrences over 2 years
  win_rate={bt['win_rate']:.0%}
  avg_return={bt['avg_return_pct']}% (5-day hold)
  median_return={bt['median_return_pct']}%
  sharpe={bt.get('sharpe','n/a')}
  max_drawdown={bt.get('max_drawdown_pct','n/a')}%
  expectancy={bt['expectancy']}% per trade

SEMANTICALLY SIMILAR PAST SIGNALS:
{sim_sig_str}

SIMILAR PAST OPPORTUNITIES AND OUTCOMES:
{sim_opp_str}

CURRENT MACRO CONDITIONS:
{macro_str}

INSTRUCTIONS:
- Base expected_return_pct directly on the backtest avg_return_pct — do not fabricate.
- If win_rate < 50%, cap confidence at 0.65 regardless of signal strength.
- Factor macro context into your thesis (e.g. rising rates affect equities differently than commodities).
- Reference similar past opportunities if found and note whether they played out.

Respond ONLY in valid JSON with no preamble:
{{
  "is_opportunity": <bool>,
  "confidence": <0.0–1.0>,
  "summary": "<one sentence, plain English, for a non-expert user>",
  "thesis": "<2–3 sentences: why signals correlate, what the trade is>",
  "action": "<buy|sell|watch>",
  "tickers": ["<symbols>"],
  "expected_return_pct": <number sourced from backtest>,
  "hold_days": <suggested holding period>,
  "stop_loss_pct": <e.g. 0.03>,
  "historical_context": "<note on similar past setups, or null>",
  "macro_notes": "<how current macro affects this trade, or null>"
}}"""
```

---

## Fan-out and position sizing

```python
# ai_correlator/fan_out.py
import json

RISK_PCT = {"conservative": 0.01, "moderate": 0.03, "aggressive": 0.06}

async def fan_out_to_users(opp: dict, db):
    users = await db.fetch(
        """SELECT DISTINCT u.* FROM users u
           JOIN subscriptions s ON s.user_id = u.id
           WHERE s.symbol = ANY($1::text[])""",
        [opp["tickers"]]
    )
    for user in users:
        pct     = min(RISK_PCT[user["risk_level"]], user["max_position_pct"])
        tp_pct  = (opp["expected_return_pct"] or 3.0) / 100
        sl_pct  = opp["stop_loss_pct"] or 0.03
        rr      = round(tp_pct / sl_pct, 1)

        rationale = (
            f"{opp['summary']} "
            f"Historical base rate: {int(opp.get('win_rate', 0)*100)}% win rate "
            f"over {opp['backtest_sample_size']} similar setups. "
            f"Expected return: ~{opp['expected_return_pct']}% over {opp.get('hold_days',5)} days. "
            f"Suggested position: {int(pct*100)}% of account. "
            f"Stop: {int(sl_pct*100)}%. Risk/reward: 1:{rr}. "
            f"Confidence: {int(opp['confidence']*100)}%."
        )
        saved = await db.fetchrow(
            """INSERT INTO strategies
               (user_id,opportunity_id,sizing_pct,stop_loss_pct,take_profit_pct,
                rationale,expires_at)
               VALUES ($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '4 hours') RETURNING *""",
            [user["id"], opp["id"], pct, sl_pct, tp_pct, rationale]
        )
        await redis.publish(f"strategies:{user['id']}", json.dumps(dict(saved)))
```

---

## Next.js: key API routes

### SSE stream — `app/api/strategies/stream/route.ts`

```ts
import { auth } from "@/lib/auth"
import { getRedis } from "@/lib/redis"

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

### Trade execution — `app/api/trades/route.ts`

```ts
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getAlpaca } from "@/lib/alpaca"

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 })

  const { strategy_id, confirmed } = await req.json()
  if (!confirmed) return Response.json({ error: "explicit confirmation required" }, { status: 400 })

  const dup = await db.query(
    "SELECT id FROM trades WHERE strategy_id=$1 AND user_id=$2 AND status!='rejected'",
    [strategy_id, session.user.id]
  )
  if (dup.rows.length) return Response.json({ error: "already submitted" }, { status: 409 })

  const strat   = (await db.query("SELECT s.*, o.tickers, o.action FROM strategies s JOIN opportunities o ON o.id=s.opportunity_id WHERE s.id=$1", [strategy_id])).rows[0]
  const user    = (await db.query("SELECT * FROM users WHERE id=$1", [session.user.id])).rows[0]
  const alpaca  = getAlpaca(user.is_paper, user.alpaca_key_id, user.alpaca_secret)
  const account = await alpaca.getAccount()
  const equity  = parseFloat(account.equity)
  const sizing  = strat.sizing_usd ?? equity * strat.sizing_pct
  const symbol  = strat.tickers[0]
  const quote   = await alpaca.getLatestQuote(symbol)
  const price   = parseFloat(quote.ap)
  const qty     = Math.floor(sizing / price)

  if (qty < 1) return Response.json({ error: "position too small for account size" }, { status: 422 })

  const order = await alpaca.createOrder({
    symbol, qty, side: strat.action === "sell" ? "sell" : "buy",
    type: "market", time_in_force: "day",
  })

  await db.query(
    `INSERT INTO trades (user_id,strategy_id,alpaca_order_id,symbol,side,qty,status,is_paper)
     VALUES ($1,$2,$3,$4,$5,$6,'submitted',$7)`,
    [session.user.id, strategy_id, order.id, symbol, order.side, qty, user.is_paper]
  )
  await db.query("UPDATE strategies SET status='executed' WHERE id=$1", [strategy_id])

  return Response.json({ order_id: order.id, qty, estimated_cost: qty * price })
}
```

### Historical data for charts — `app/api/history/[symbol]/route.ts`

```ts
import { tsdb } from "@/lib/tsdb"
import { auth } from "@/lib/auth"

export async function GET(req: Request, { params }: { params: { symbol: string } }) {
  const session = await auth()
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const days     = parseInt(searchParams.get("days") ?? "90")
  const interval = searchParams.get("interval") ?? "1d"

  const result = await tsdb.query(
    `SELECT o.time, o.open, o.high, o.low, o.close, o.volume,
            t.rsi_14, t.macd, t.macd_signal, t.bb_upper, t.bb_lower, t.atr_14
     FROM ohlcv o
     LEFT JOIN technicals t USING (time, symbol, interval)
     WHERE o.symbol=$1 AND o.interval=$2
       AND o.time > NOW() - ($3 || ' days')::interval
     ORDER BY o.time ASC`,
    [params.symbol, interval, days]
  )
  return Response.json(result.rows)
}
```

---

## lib/ clients

```ts
// lib/db.ts
import { Pool } from "pg"
export const db = new Pool({ connectionString: process.env.DATABASE_URL })

// lib/tsdb.ts
import { Pool } from "pg"
export const tsdb = new Pool({ connectionString: process.env.TIMESCALE_URL })

// lib/redis.ts
import Redis from "ioredis"
let client: Redis
export const getRedis = () => {
  if (!client) client = new Redis(process.env.REDIS_URL!)
  return client
}

// lib/alpaca.ts
import Alpaca from "@alpacahq/alpaca-trade-api"
export const getAlpaca = (paper: boolean, keyId?: string, secret?: string) =>
  new Alpaca({
    keyId:     keyId  ?? process.env.ALPACA_KEY_ID!,
    secretKey: secret ?? process.env.ALPACA_SECRET_KEY!,
    paper,
  })
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

# env/python.env (all Python services share this)
KAFKA_BOOTSTRAP_SERVERS=kafka:9092
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/eventedge
TIMESCALE_URL=postgresql://postgres:postgres@timescale:5432/market_history
REDIS_URL=redis://redis:6379
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
FINNHUB_API_KEY=
FRED_API_KEY=
LOG_LEVEL=info
LOG_FORMAT=json
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
  "pydantic>=2.0",
  "structlog>=24.0",
  "prometheus-client>=0.20",
]
```

---

## Full signal pipeline — end to end

```
1.  producer polls API → publishes raw event to Kafka raw.*

2.  consumer reads raw event → runs detection algorithm
      → if signal: write to signals table, publish signal ID to Redis

3.  correlator wakes on Redis "new_signal" message
      → fetches signal from DB

4.  TIME-WINDOW GATE: need 2+ sources in last 15 min
      → fewer than 2 sources: DROP silently

5.  BACKTEST GATE: run vectorbt against 2 years of TimescaleDB history
      → sample_size < 20: DROP and log reason to backtest_results
      → win_rate < 45%:   DROP and log reason to backtest_results

6.  embed signal → store vector in signals.embedding

7.  pgvector semantic search:
      → top-5 similar past signals
      → top-3 similar past opportunities with their outcomes

8.  TimescaleDB macro snapshot: FEDFUNDS, VIX, WTI, CPI, 10Y yield, USD

9.  Claude API call with:
      recent signals + backtest stats + similar past signals
      + similar past opportunities + macro context

10. if not is_opportunity or confidence < 0.60: DROP

11. save opportunity with embedding
    save backtest_result linked to opportunity

12. fan_out:
      find users subscribed to any ticker in opportunity
      build per-user strategy (sized to risk_level, stop/take_profit from backtest)
      save strategy
      publish to Redis strategies:{user_id}

13. Next.js SSE route delivers strategy to connected browser in real time

14. user reviews:
      summary, thesis, backtest stats (win_rate, sample_size, expectancy),
      expected return, stop loss, risk/reward ratio, confidence, macro notes

15. user confirms (explicit tap) → POST /api/trades
      → idempotency check
      → fetch Alpaca account equity → size position
      → create market order via Alpaca
      → write trade record

16. position tracked in positions table
    P&L computed on close
```

---

## Key design decisions

**Why two PostgreSQL instances instead of one?**
TimescaleDB and pgvector are both PostgreSQL extensions but have different operational
profiles. TimescaleDB is tuned for append-heavy time-series with aggressive compression
and continuous aggregates. The app DB is tuned for relational lookups and vector search.
Separating them lets each be tuned independently and keeps the schemas clean.
pgAdmin connects to both from a single UI at localhost:5050.

**Why validate with a backtester before calling Claude?**
Claude cannot know historical win rates. Sending it a signal cluster with a 35% historical
win rate and asking if there's an opportunity produces confident-sounding nonsense.
The backtester runs first and supplies hard statistics. The prompt then instructs Claude
to anchor its confidence to those statistics — win_rate < 50% caps confidence at 0.65.

**Why pgvector instead of a dedicated vector DB (Qdrant/Pinecone)?**
No new service, SDK, auth, or backup strategy. pgvector with HNSW handles millions of
vectors at sub-5ms latency — more than sufficient at this signal volume. A dedicated
vector DB earns its place at 100M+ vectors or when you need fine-grained access control
on the vector layer. You don't need that here.

**Why OpenAI embeddings and not a local model?**
text-embedding-3-small costs $0.02/1M tokens and produces 1536-dimensional embeddings.
Signal text volume is tiny (tens of KB per day). This costs cents per month and produces
meaningfully better semantic similarity than anything runnable locally without a GPU.

**On expected returns.**
expected_return_pct in every opportunity is sourced directly from backtest avg_return_pct.
The prompt explicitly prohibits Claude from fabricating this number. The UI must display
it alongside sample_size, win_rate, and max_drawdown so users understand the statistical
basis. Past performance does not guarantee future results. The system makes this clear.

**On the backtest thresholds.**
sample_size >= 20 and win_rate >= 45% are conservative minimums. Below 20 occurrences
the win rate has too much variance to be actionable. Below 45% there is no measurable
edge. These are configurable per-environment and should be tuned as real trade data
accumulates in the positions and trades tables.

Frontend:



# eventedge-ai — frontend specification
## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v3 |
| Components | shadcn/ui (base primitives only) |
| Charts | Recharts |
| Fonts | DM Sans (body) + DM Mono (numbers, code, tickers) |
| Auth | NextAuth.js v5 (Credentials provider) |
| State | React built-in (useState, useReducer, useContext) — no external store |
| Live data | EventSource (SSE) via custom hooks |
| HTTP | Native fetch in Server Components, SWR for client-side polling |
| Forms | React Hook Form + Zod |
| Animations | Tailwind transitions + CSS keyframes only |

---

## Design system

### Theme

Dark-first. One light mode toggle in settings but dark is the default and primary.
The aesthetic is precise, data-dense, authoritative — quantitative terminal meets modern SaaS.
Never generic. Numbers always in DM Mono. Labels always uppercase with letter-spacing.

### Color tokens (CSS variables in globals.css)

```css
:root {
  --bg:        #0a0c0f;   /* page background */
  --bg1:       #0f1217;   /* surface (cards, panels) */
  --bg2:       #151a21;   /* elevated surface */
  --bg3:       #1c2330;   /* hover state, active nav */
  --border:    #1e2835;   /* default border */
  --border2:   #263041;   /* hover border */
  --text:      #e2e8f0;   /* primary text */
  --muted:     #64748b;   /* secondary text */
  --dim:       #334155;   /* labels, tertiary */

  --green:     #22c55e;
  --green-bg:  rgba(34,197,94,0.07);
  --green-dim: #14532d;
  --red:       #ef4444;
  --red-bg:    rgba(239,68,68,0.07);
  --amber:     #f59e0b;
  --amber-bg:  rgba(245,158,11,0.07);
  --blue:      #3b82f6;
  --blue-bg:   rgba(59,130,246,0.07);
  --purple:    #a78bfa;
  --purple-bg: rgba(167,139,250,0.08);
}
```

### Typography rules

- Body text: DM Sans, 13px, weight 400
- Headings: DM Sans, weight 600, letter-spacing -0.01em
- All numbers, tickers, prices, scores, timestamps: DM Mono
- All column labels and section labels: 10px, uppercase, letter-spacing 0.06em, color `--dim`
- Never use Inter, Roboto, or system fonts

### Spacing

- Page padding: 20px horizontal
- Card padding: 14px
- Section gap: 14px
- Inline gap: 8px

### Border radius

- Cards: 10px
- Badges / chips: 4px
- Buttons: 8px
- Cells / small elements: 6px

### Status colors

| State | Color | Usage |
|-------|-------|-------|
| Buy / positive | `--green` | Action badges, positive P&L, passed backtests |
| Sell / negative | `--red` | Action badges, losses, failed gates |
| Watch / neutral | `--amber` | Watch signals, expiry warnings, pending states |
| Info / analytics | `--blue` | Analytics source chips, info states |
| Polymarket | `--purple` | Polymarket source chips only |
| Dropped | opacity 0.45 on row + `--red` label | Any dropped/filtered signal |

### Reusable component patterns

**Action badge** — `BUY` / `SELL` / `WATCH`
Monospace, 10px, 3px/7px padding, 4px radius, colored bg + border matching action color.

**Source chip** — `POLYMARKET` / `NEWS` / `ANALYTICS`
Monospace, 10px, colored per source table above.

**Stat cell** — label + value pair
Label: 10px uppercase dim. Value: DM Mono 12-16px depending on context.

**Live dot** — 6px circle, `--green`, CSS pulse animation at 2s.

**Pill** — small outlined label for mode indicators (PAPER MODE, 3 sources active).
Monospace 10px, `--border2` border, `--muted` text.

**Section label** — 10px, uppercase, `--dim`, letter-spacing 0.08em, font-weight 600.
Always followed by 8px margin before content.

**Card accent bar** — 2px full-width colored strip at top of strategy cards.
Color matches action (green=buy, red=sell, amber=watch).

---

## Layout

### Shell

Two-column grid: `52px nav | 1fr content`.
Nav is a narrow icon sidebar, always visible, never collapses.
Content area fills the remaining width, height 100vh, overflow hidden (each panel scrolls internally).

### Nav sidebar

52px wide, `--bg1` background, `--border` right border.
Top: 32px logo mark (green rounded square with chart icon).
Then icon buttons (36px × 36px, 8px radius):
- Strategies (bar chart icon) — active color `--green`
- Signal correlator (radio wave icon) — active color `--blue`
- Price chart (waveform icon) — active color `--blue`
- Backtests (line chart icon) — active color `--blue`
- separator line
- Trade history (monitor icon) — active color `--blue`
- Settings (gear icon) — active color `--muted`

Active nav item: `--bg3` background, icon in page accent color.
Hover: `--bg3` background, icon in `--text`.
Tooltips on hover (title attribute sufficient).

### Content area patterns

Most pages use one of two layouts:

**Two-panel horizontal** — `1fr | fixed-width right panel`
Used by: strategy inbox (380px right), signal correlator (320px right), price chart (300px right).
Left panel: list / feed / chart. Right panel: detail or status.
`--border` vertical separator between panels.

**Single column with topbar**
Used by: trade history, backtests, settings, onboarding.

---

## Pages

### 1. Onboarding (`/onboarding`)

First screen for new users. Only shown if user has no profile set up.
Multi-step flow, no sidebar, centered card layout, full-page dark background.

**Step 1 — Welcome**
Headline: "eventedge" in large DM Mono, subtitle explaining what the system does in one sentence.
Single CTA: "Get started".

**Step 2 — Risk profile**
Three cards in a row: Conservative / Moderate / Aggressive.
Each card shows:
- Risk label in large text
- Max position size (1% / 3% / 6% of account per trade)
- Short description of who this suits
- Example: what a $10,000 account would risk per trade
Cards are selectable — selected state has `--green` border and subtle green background tint.
User picks one. "Continue" button.

**Step 3 — Markets**
Multi-select grid of market categories: Oil & Energy, US Equities, Crypto, Rates & Macro, Commodities, FX.
Each is a toggleable chip. User picks one or more.
Helper text: "We'll only surface opportunities in your selected markets."
"Continue" button.

**Step 4 — Alpaca connection**
Two inputs: API Key ID, Secret Key.
Toggle: Paper trading / Live trading. Paper is default and highlighted as recommended.
Explanatory note: "Your keys are stored encrypted and only used to submit orders on your behalf. We never custody funds."
"Test connection" button — calls Alpaca API, shows account equity on success.
On success: green checkmark + "Connected — account equity: $XX,XXX". "Finish setup" button.
On failure: red error with exact Alpaca error message.

**Step 5 — Complete**
Confirmation screen: "You're all set."
Summary of their choices. "Go to strategies" button → navigates to `/`.

Progress indicator: dots or step numbers at top of each step (1 of 5).
All steps persist to `users` table immediately on "Continue" — no data lost on refresh.

---

### 2. Strategy inbox (`/`) — default route

The primary screen. Where users spend most of their time.

**Layout**: Two-panel horizontal. Left: strategy card feed. Right: strategy detail panel.

**Topbar** (left panel)
- Live dot + "Strategy inbox" title
- Right side: PAPER MODE pill (green if paper, amber if live) + "N sources active" pill

**Filter tabs** below topbar
Tabs: All | Pending | Executed | Dismissed | Dropped
Each tab shows a count badge. Dropped tab is faded relative to others — it's audit info, not primary.

**Strategy card feed** (left panel, scrollable)

Each card contains:

Top accent bar — 2px, colored by action (green/red/amber).

Card header row:
- Action badge (BUY / SELL / WATCH)
- Ticker symbols in DM Mono (e.g. "USO / XOM")
- Confidence score right-aligned ("conf 84%")

Summary text — 2-3 line plain English summary from Claude. 12px, `--muted`.

Stats row (4 cells, separated by `--border` lines):
- EXP. RETURN: e.g. "+4.2%" in green
- WIN RATE: e.g. "68%"
- STOP LOSS: e.g. "−3%" in red
- HOLD: e.g. "5d" in muted

Footer row:
- Source chips (POLYMARKET, NEWS, ANALYTICS — whichever contributed)
- Timestamp right-aligned in DM Mono

Card states:
- Default: `--bg1` background
- Hover: `--bg2` background, `--border2` border
- Selected: `--bg2` background, `--green` border
- New (just arrived via SSE): slide-in animation from top + `rgba(34,197,94,0.3)` border glow for 3s
- Executed: opacity 0.6, no hover effect, shows fill price and P&L instead of expected stats
- Dropped: opacity 0.45, no cursor pointer, shows drop reason right-aligned in red mono

**Strategy detail panel** (right panel, fixed)

Shown when a card is selected. Defaults to the first pending card on load.
If no strategies exist yet, shows an empty state: "Waiting for signals. The system is actively monitoring your markets."

Header:
- Large ticker in DM Mono (20px, weight 600)
- Subtitle: "Full name · Action · Paper/Live mode"

Scrollable body sections (each preceded by a section label):

**Thesis section**
Claude's thesis text, 12px, `--muted`, line-height 1.7.
Left border 2px `--border2` (blockquote style).
Below thesis: "Historical context" in smaller text if Claude found a similar past opportunity.

**Backtest results section**
2×2 grid of stat cells:
- Win rate (green if ≥60%, amber if 45-60%)
- Avg return (green)
- Sample size (muted — just a number)
- Max drawdown (red)
Below grid: disclaimer note with amber left border — "Historical results do not guarantee future returns. This is a base rate, not a prediction."

**Contributing signals section**
List of rows, each showing:
- Source label (DM Mono, 60px min-width, source color)
- Signal description
- Score right-aligned (DM Mono, muted)

**Position sizing section**
List of label/value rows:
- Account equity (from Alpaca)
- Risk allocation (% × equity = dollar amount)
- Estimated shares / units (dollar amount ÷ current price)
- Stop loss price (exact dollar amount + "max loss $X")
- Take profit price (exact dollar amount + "expected gain $X")
- Risk / reward ratio (e.g. "1 : 1.4") — green if ≥1.5, amber if 1-1.5, red if <1

**Macro context section**
3-column grid of macro cells: WTI CRUDE, VIX, FED FUNDS, 10Y YIELD, USD INDEX, CPI YoY.
Each cell: label (9px uppercase dim) + value (DM Mono 11px).

**Confirm footer** (sticky at bottom of right panel)

Expiry row: clock icon + "Strategy expires in Xh Ym" — time in amber DM Mono.
Updates every minute via setInterval.

Two buttons side by side (1fr : 2fr grid):
- Dismiss: ghost style, `--bg3` background
- Execute on Alpaca: primary CTA

Execute button behavior:
- Paper mode: blue background, label "Execute on Alpaca (paper)"
- Live mode: green background, label "Execute on Alpaca (LIVE)"
- On first click: changes to "Hold to confirm (3s)..." and starts a 3-second countdown
- Each second the label updates: "Hold to confirm (2s)...", "Hold to confirm (1s)..."
- If user clicks elsewhere during countdown: resets to original state
- After 3 seconds: label becomes "✓ Submitted to Alpaca", button disabled, background darkens
- 3 seconds later: resets (in case of error) or card moves to Executed state

On dismiss: card moves to Dismissed tab, detail panel shows next pending card.

---

### 3. Signal correlator (`/correlator`)

Where power users monitor the raw pipeline. Shows every signal that fired, its journey through the gates, and why it was or wasn't escalated.

**Layout**: Two-panel horizontal. Left: signal feed table. Right: pipeline status panel.

**Topbar**
- Live dot + "Signal correlator"
- Right side: "today: N signals", "N escalated", "N dropped" pills

**Stats bar** (4 cells, full width, below topbar)
- Signals today (+ delta vs yesterday)
- Escalation rate % (green)
- Backtest drops count (red)
- Avg confidence of escalated signals

**Filter row** (below stats bar)
Two filter groups:
- SOURCE: ALL | POLY | NEWS | ANA
- STATUS: ALL | ESCALATED | DROPPED | WATCHING | PENDING
Toggle buttons, multiple can be active.

**Signal feed table** (left panel, scrollable)

Sticky header row with column labels:
SOURCE | TYPE | SYMBOL / DETAIL | SCORE | STATUS | PIPELINE | TIME

Each data row:
- SOURCE: colored source label in DM Mono
- TYPE: signal type (conviction shift, hotness, volume spike, rsi extreme, momentum, options unusual)
- SYMBOL / DETAIL: ticker + brief detail (e.g. "USO 3.2× 30d avg")
- SCORE: DM Mono, colored (≥0.75 green, 0.50-0.74 amber, <0.50 muted)
- STATUS: badge (ESCALATED green, DROPPED red, WATCHING amber, PENDING amber)
- PIPELINE: short status of where in the pipeline this signal is or stopped
  - "1 source" → didn't pass cross-source gate
  - "backtest: N samples" → dropped at backtest, N is the sample count
  - "win rate 41%" → dropped at backtest for low edge
  - "Claude ✓" → made it through to opportunity
  - "conf 0.52" → Claude returned below-threshold confidence
- TIME: relative timestamp, DM Mono

Dropped rows: opacity 0.45.
Clicking a row updates the right panel with that signal's pipeline detail.

**Pipeline status panel** (right panel)

Header: "Correlator pipeline" + "Last signal: N seconds ago".

**Current signal pipeline** — vertical step list
Each step has:
- Status dot (22px circle): done (green), failed (red), active (amber), idle (dim)
- Step name (12px, weight 500)
- Step detail (11px, muted)
- Technical note below in DM Mono 10px dim

Steps:
1. Signal detected — N signals across N sources in 15-min window
2. Backtest validation — N occurrences · N% win rate / OR: reason for drop
3. Semantic search — N similar past signals found, top match info
4. Claude correlation — confidence % · action · ticker / OR: below threshold
5. Strategy delivered — N users notified · expires in Nh

Steps after a failure point show as idle (dim dot, no detail).
Vertical connector line between steps.

**Source health section** (below pipeline)
Four rows: POLYMARKET, FINNHUB, ANALYTICS, HIST. INGEST
Each row: source name | status dot + "live"/"nightly" | last poll timestamp

---

### 4. Price chart (`/chart`)

For researching a ticker — OHLCV with technicals, plus backtest entry markers overlaid.

**Layout**: Two-panel horizontal. Left: chart area. Right: ticker detail / indicator panel.

**Topbar**
Ticker search input (DM Mono, types ahead from subscriptions list).
Interval selector: 1D | 1W | 1M | 3M | 1Y — pill buttons.
Indicator toggles: RSI | MACD | BB — toggleable pills.

**Chart area** (left panel)

Primary chart: Recharts ComposedChart with OHLCV candlestick bars.
Candlesticks: green fill for up bars, red fill for down bars. Thin wicks.
X-axis: date labels, DM Mono 10px.
Y-axis: price labels, DM Mono 10px, right-aligned.

Volume bars at bottom of the main chart (20% of height), same colors as candles, opacity 0.4.

Backtest entry markers: small vertical dashed lines at dates where the backtester found similar historical setups. Amber color, 1px dashed. On hover: tooltip showing "Backtest entry · +X% / −X% outcome".

Indicator subcharts (shown below main chart if toggled, each ~20% height):
- RSI: line chart, horizontal reference lines at 25 and 75 (dashed, dim). RSI line in blue. Background tint red when RSI>75, green when RSI<25.
- MACD: MACD line in blue, signal line in amber, histogram bars (green positive, red negative).
- Bollinger: upper and lower bands as area chart overlaid on main price chart (not a subchart). Fill between bands in very low opacity white.

Crosshair: thin vertical + horizontal lines following cursor, DM Mono tooltip showing date, OHLCV values, and active indicator values.

**Ticker detail panel** (right panel)

Current price in large DM Mono (20px).
1D change in green or red.

Latest indicator values:
- RSI(14): value + "overbought" / "oversold" / "neutral" label
- MACD: value + "bullish" / "bearish" crossover if recent
- Volume: today vs 30-day avg (e.g. "1.4× avg")
- ATR(14): average true range

Recent signals for this ticker:
List of the last 5 signals from any source for this symbol.
Same format as signal correlator rows but condensed.

Recent opportunities for this ticker:
List of the last 3 opportunities that included this ticker.
Shows action, confidence, date, outcome if closed.

---

### 5. Backtest explorer (`/backtests`)

For understanding system performance over time. Which signal types have the best edge.

**Layout**: Single column with topbar.

**Topbar**
Title: "Backtest explorer".
Filter: date range picker (last 7d / 30d / 90d / all time).
Filter: passed only / dropped only / all.

**Summary stats row** (4 cards across top)
- Total backtests run
- Pass rate % (green)
- Best performing signal type (label + win rate)
- Total dropped (insufficient edge)

**Backtest results table**

Columns:
SIGNAL TYPES | SYMBOL | SAMPLE SIZE | WIN RATE | AVG RETURN | EXPECTANCY | SHARPE | MAX DD | PASSED | DATE

- SIGNAL TYPES: comma-separated signal type names that formed this cluster
- WIN RATE: colored (green ≥60%, amber 45-60%, red <45%)
- AVG RETURN: green if positive
- EXPECTANCY: green if positive, red if negative
- SHARPE: muted number
- MAX DD: red
- PASSED: green "✓ PASS" or red "✗ DROP" badge
- DATE: relative, DM Mono

Clicking a row expands an inline detail panel showing:
- Full signal list with scores
- Entry dates found in history (list of dates)
- Distribution of returns (simple text: "range: −8.2% to +12.4%, median +3.1%")
- Claude opportunity if this backtest was escalated (linked)
- Drop reason if not passed

Sortable columns. Default sort: date descending.

---

### 6. Trade history (`/trades`)

Record of all orders submitted via Alpaca, paper and live.

**Layout**: Single column.

**Topbar**
Title: "Trade history".
Toggle: Paper | Live (switches which orders are shown).
Date range filter.

**Account summary bar** (shown when Alpaca connection is active)
4 cells: Portfolio value | Cash | Day P&L | Total P&L (since account connection).
All in DM Mono. Portfolio value large (18px). P&L green or red.

**Open positions section**

Table with columns:
SYMBOL | SIDE | QTY | AVG COST | CURRENT PRICE | UNREALIZED P&L | UNREALIZED % | STRATEGY

- UNREALIZED P&L: green or red
- STRATEGY: links to the strategy card that generated this position

**Closed trades section**

Table with columns:
SYMBOL | SIDE | QTY | ENTRY | EXIT | P&L | % RETURN | HOLD TIME | STRATEGY | DATE

- P&L and % RETURN: green or red
- Clicking a row shows a side panel with the full strategy that generated the trade,
  the backtest result that validated it, and the opportunity thesis.

**Empty state**
"No trades yet. Execute a strategy from your inbox to see it here."

---

### 7. Settings (`/settings`)

**Layout**: Single column, max-width 640px, centered.

Sections (each with a section label and a card):

**Profile**
- Email (read only)
- Change password (opens inline form: current password, new password, confirm)

**Risk profile**
Same three-card selector as onboarding step 2.
Current selection highlighted. "Save" button below.

**Markets**
Same multi-select chip grid as onboarding step 3.
"Save" button below.

**Alpaca connection**
Shows current connection status (connected / disconnected).
If connected: shows account type (paper/live), equity, last sync time. "Disconnect" button.
If not: same Alpaca key form as onboarding step 4.
Paper / Live toggle with clear warning on Live: "Live trading uses real money. Orders execute immediately."

**Subscription management**
Table of current subscriptions: SOURCE | SYMBOL | THRESHOLD | ADDED.
"Remove" button per row.
"Add subscription" inline form: source dropdown + symbol input + optional threshold override.

**Notification preferences** (future — show as coming soon, disabled)
Toggle rows for: Email on new strategy, Browser notification on new strategy.
Shown but disabled with "Coming soon" label.

**Danger zone**
"Delete account" button — red outline, opens confirmation modal requiring typed confirmation.

---

## Shared components

### Empty states

Each page has a contextual empty state when no data exists.
Format: icon (SVG, 32px, `--dim`) + headline (14px, `--muted`) + optional sub-text (12px, `--dim`).
No CTA buttons in empty states except onboarding completion.

Examples:
- Strategy inbox: "Waiting for signals. The system is monitoring your markets."
- Signal correlator: "No signals yet today. Producers are running."
- Trade history: "No trades yet. Execute a strategy from your inbox."
- Backtests: "No backtest results yet. Signal clusters are needed first."

### Loading states

Each data section shows a skeleton loader (not a spinner) while fetching.
Skeleton: same dimensions as the content it replaces, `--bg3` background, subtle pulse animation.
Use CSS animation: `opacity: 0.5 → 1 → 0.5` at 1.5s loop.

### Error states

API errors show inline (not toast) in the section that failed.
Format: red left border on a `--bg2` card, error message in `--muted`, retry button.

### Toasts

Used only for success confirmations:
- "Strategy dismissed"
- "Order submitted to Alpaca"
- "Settings saved"

Appear bottom-right. Auto-dismiss 3s. `--bg2` background, `--border2` border, no color coding (they're always positive — errors are inline).

### Modals

Used only for destructive actions (delete account, disconnect Alpaca).
Dark overlay `rgba(0,0,0,0.7)`. Centered card, 400px max-width.
Two buttons: cancel (ghost) + confirm (red for destructive).
Never used for forms or information display — those are inline or in panels.

---

## Data fetching patterns

### Server components (Next.js App Router)

Pages that don't need real-time updates fetch in Server Components:
- `/backtests` — full backtest table
- `/trades` — trade history
- `/settings` — user profile, subscriptions

Use `async` Server Component with direct DB query via `lib/db.ts`.

### Client components with SWR

Pages that need periodic refresh without SSE:
- Price chart — polls `/api/history/[symbol]` every 60s
- Signal correlator table — polls `/api/signals` every 15s

```ts
const { data, error } = useSWR('/api/signals', fetcher, { refreshInterval: 15000 })
```

### SSE hooks

Real-time push used only for strategy inbox.

```ts
// hooks/useStrategyStream.ts
export function useStrategyStream(): Strategy[] {
  const [strategies, setStrategies] = useState<Strategy[]>([])

  useEffect(() => {
    let es: EventSource
    let retry: ReturnType<typeof setTimeout>

    const connect = () => {
      es = new EventSource('/api/strategies/stream')
      es.onmessage = (e) => {
        const s: Strategy = JSON.parse(e.data)
        setStrategies(prev => [s, ...prev].slice(0, 100))
      }
      es.onerror = () => {
        es.close()
        retry = setTimeout(connect, 5000)
      }
    }

    connect()
    return () => { es?.close(); clearTimeout(retry) }
  }, [])

  return strategies
}
```

Auto-reconnects after 5s on disconnect. Caps at 100 strategies in memory.

---

## Route structure

```
app/
├── layout.tsx                      # root layout — fonts, CSS variables, auth check
├── page.tsx                        # redirects to /onboarding if no profile, else /
├── onboarding/
│   └── page.tsx                    # multi-step onboarding (no sidebar)
├── (dashboard)/                    # layout group — includes sidebar nav
│   ├── layout.tsx                  # sidebar shell, auth guard
│   ├── page.tsx                    # strategy inbox (default route)
│   ├── correlator/
│   │   └── page.tsx
│   ├── chart/
│   │   └── page.tsx
│   ├── backtests/
│   │   └── page.tsx
│   ├── trades/
│   │   └── page.tsx
│   └── settings/
│       └── page.tsx
└── api/
    ├── auth/[...nextauth]/route.ts
    ├── signals/route.ts
    ├── strategies/
    │   ├── route.ts
    │   └── stream/route.ts
    ├── trades/route.ts
    ├── backtests/route.ts
    ├── history/[symbol]/route.ts
    └── subscriptions/route.ts
```

---

## Auth flow

NextAuth.js Credentials provider.
Session strategy: JWT (no DB session table needed).
`auth()` called in every API route and Server Component that needs the user ID.

Protected routes: everything under `(dashboard)/`.
Root layout checks session server-side and redirects to `/onboarding` or `/auth/signin`.

Sign-in page: `/auth/signin` — custom page (not NextAuth default).
Two inputs: email + password. No OAuth. No "forgot password" in v1.

New user registration: `POST /api/auth/register` — creates user row, hashes password with bcrypt.

---

## Environment variables (frontend-relevant)

```bash
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/eventedge
TIMESCALE_URL=postgresql://postgres:postgres@timescale:5432/market_history
REDIS_URL=redis://redis:6379
ALPACA_KEY_ID=                      # fallback if user hasn't set their own
ALPACA_SECRET_KEY=
```

---

## Component file map

```
src/web/
├── app/                            # routes (see above)
├── components/
│   ├── layout/
│   │   ├── NavSidebar.tsx          # icon nav with tooltips
│   │   └── Topbar.tsx              # reusable topbar with title + right slot
│   ├── strategy/
│   │   ├── StrategyCard.tsx        # card in the feed
│   │   ├── StrategyDetail.tsx      # right panel detail view
│   │   ├── ConfirmFooter.tsx       # expiry + hold-to-confirm buttons
│   │   ├── BacktestStats.tsx       # 2×2 stat grid + disclaimer
│   │   ├── SignalList.tsx          # contributing signals rows
│   │   ├── SizingBreakdown.tsx     # position sizing rows
│   │   └── MacroGrid.tsx           # 3-col macro snapshot
│   ├── correlator/
│   │   ├── SignalTable.tsx         # full signal feed table
│   │   ├── PipelineSteps.tsx       # vertical pipeline status
│   │   ├── SourceHealth.tsx        # 4-row source status
│   │   └── StatsBar.tsx            # 4-cell summary bar
│   ├── chart/
│   │   ├── PriceChart.tsx          # Recharts OHLCV + overlays
│   │   ├── IndicatorPanel.tsx      # RSI / MACD subchart
│   │   ├── BacktestMarkers.tsx     # dashed vertical lines on chart
│   │   └── TickerDetail.tsx        # right panel for chart page
│   ├── backtest/
│   │   ├── BacktestTable.tsx       # sortable results table
│   │   └── BacktestRow.tsx         # expandable row detail
│   ├── trades/
│   │   ├── AccountSummary.tsx      # portfolio value + P&L bar
│   │   ├── PositionsTable.tsx      # open positions
│   │   └── ClosedTradesTable.tsx   # trade history
│   ├── settings/
│   │   ├── RiskSelector.tsx        # three-card risk picker (reused from onboarding)
│   │   ├── MarketSelector.tsx      # chip grid (reused from onboarding)
│   │   ├── AlpacaConnect.tsx       # key form + connection status
│   │   └── SubscriptionManager.tsx # table + add form
│   ├── onboarding/
│   │   └── OnboardingFlow.tsx      # multi-step wrapper
│   └── ui/
│       ├── Badge.tsx               # action / source / status badges
│       ├── StatCell.tsx            # label + value pair
│       ├── SectionLabel.tsx        # uppercase dim label
│       ├── LiveDot.tsx             # pulsing green dot
│       ├── Pill.tsx                # outlined mode indicator
│       ├── Skeleton.tsx            # loading skeleton
│       ├── Toast.tsx               # bottom-right success toast
│       └── Modal.tsx               # destructive action modal
├── hooks/
│   ├── useStrategyStream.ts        # SSE connection with auto-reconnect
│   ├── useAlpacaAccount.ts         # fetches account equity from Alpaca
│   └── useCountdown.ts             # strategy expiry countdown timer
└── lib/
    ├── db.ts
    ├── tsdb.ts
    ├── redis.ts
    ├── auth.ts
    └── alpaca.ts
```

---

## Key UX rules

1. Numbers always DM Mono. Never render a price, score, percentage, or timestamp in a sans-serif font.

2. Dropped signals are never hidden. They are shown at 45% opacity with the drop reason visible. The user should always be able to see what the system filtered and why.

3. The confirm button requires a 3-second hold. This applies to both paper and live. The only difference is the button color and label. Prevents accidental execution.

4. Expected return is always shown with its statistical basis. Never show "+4.2% expected return" without showing "68% win rate, 31 samples" immediately adjacent. The disclaimer about historical performance is part of the BacktestStats component and cannot be removed.

5. Paper mode is always visually distinct from live mode. The PAPER MODE pill is shown in the topbar on every page. The confirm button is blue in paper mode, green in live mode. This distinction is never ambiguous.

6. Empty states are informative, not decorative. They tell the user what the system is doing ("The system is monitoring your markets") not just that there's no data.

7. Errors are inline, not modal. API errors appear in the section that failed, not as overlays or toasts. The user can see the error in context and retry without losing their place.

8. The strategy detail panel always shows something. If no strategy is selected, it shows the most recent pending strategy by default. If there are no strategies at all, it shows the empty state.

9. All relative timestamps update without page refresh. Use a single setInterval at the app level and pass the current time as context, not per-component intervals.

10. The onboarding flow saves progress at each step. If the user closes the browser mid-onboarding, they resume where they left off.