# EventEdge AI — End-to-End Data Flow

This document traces every object and field as data moves through the system, from raw external APIs to the user's browser.

---

## Top-Level Flow

```
External APIs
  ├─ Polymarket CLOB API
  ├─ Finnhub News API
  └─ Yahoo Finance / Options

      │  (HTTP polls)
      ▼

┌─────────────────────────────────────────────────────────┐
│                    STAGE 1 — PRODUCERS                   │
│     polymarket-producer · news-producer · analytics-producer │
└──────────────────────────┬──────────────────────────────┘
                           │ Kafka topics
                           │  raw.polymarket
                           │  raw.news
                           │  raw.analytics
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    STAGE 2 — CONSUMERS                   │
│  polymarket-consumer · news-consumer · analytics-consumer│
└──────────────────────────┬──────────────────────────────┘
                           │
              ┌────────────┴─────────────┐
              ▼                          ▼
     PostgreSQL: signals          TimescaleDB: raw_*
     Redis PubSub: new_signal

              │
      ┌───────┼────────────────────────────────────────┐
      ▼       ▼                                        ▼
  STAGE 3     STAGE 4                             STAGE 5
  feature-    historical-                          ml-trainer
  builder     ingestor
      │                                               │
      ▼                                               ▼
  TimescaleDB: features                        ./models/*.json
  (33 cols/symbol/hour)                        ./models/*.pkl

              │                                       │
              └──────────────┬────────────────────────┘
                             ▼
              ┌─────────────────────────────────────────┐
              │          STAGE 6 — AI CORRELATOR         │
              │  Subscribes: Redis new_signal channel    │
              │  12-step pipeline per signal             │
              └──────────────┬──────────────────────────┘
                             │
                    PostgreSQL: opportunities
                    Redis: strategies:{user_id}
                             │
              ┌──────────────▼──────────────────────────┐
              │          STAGE 7 — NEXT.JS               │
              │  SSE stream → Strategy Inbox             │
              │  Alpaca API for trade execution          │
              └─────────────────────────────────────────┘
```

---

## Stage 1 — Producers (Object Shapes on Kafka)

### `raw.polymarket` message
```json
{
  "event_type": "conviction_shift",
  "market_id": "0xabc123...",
  "question": "Will the Fed cut rates before June 2025?",
  "yes_price": 0.72,
  "liquidity": 485000,
  "volume_24h": 12300,
  "prev_yes_price": 0.58,
  "delta_abs": 0.14,
  "delta_pct": 0.24,
  "confidence": 0.81,
  "matched_tickers": ["TLT"],
  "ts": "2025-05-18T14:32:00Z"
}
```

### `raw.news` message
```json
{
  "symbol": "NVDA",
  "headline": "Nvidia announces next-gen Blackwell GPU...",
  "source": "Reuters",
  "url": "https://...",
  "sentiment_score": 0.82,
  "credibility_score": 0.90,
  "recency_weight": 0.95,
  "published_at": "2025-05-18T13:00:00Z"
}
```

### `raw.analytics` message
```json
{
  "symbol": "TSLA",
  "rsi_14": 28.4,
  "put_call_ratio": 1.8,
  "volume": 42000000,
  "avg_volume_30d": 18000000,
  "price_change_1d": -0.06,
  "unusual_sweep_count": 3,
  "ts": "2025-05-18T14:00:00Z"
}
```

---

## Stage 2 — Consumers (Signal Written to PostgreSQL)

Each consumer processes its Kafka message and writes one row to `signals`:

```
PostgreSQL: signals
┌────────────────────────────────────────────────────────┐
│ id          UUID PRIMARY KEY                           │
│ source      "polymarket" | "news" | "analytics"        │
│ symbol      "NVDA"  (or Polymarket hex ID)             │
│ type        "conviction_shift" | "news_catalyst"       │
│             "volume_spike" | "rsi_extreme" | etc.      │
│ score       0.0 – 1.0  (raw producer signal strength)  │
│ direction   "up" | "down" | null                       │
│ payload     JSONB  (full producer message)             │
│ embedding   vector(1536)  (filled later by correlator) │
│ created_at  TIMESTAMPTZ                                │
└────────────────────────────────────────────────────────┘
```

After writing the row, each consumer publishes to Redis:
```
Redis PubSub: new_signal
{ "signal_id": "550e8400-e29b-..." }
```

---

## Stage 3 — Feature Builder (TimescaleDB)

Runs hourly. Joins all raw tables for a symbol into one feature snapshot.
Retention: **730 days** (2 years) — extended from 90 days so the ML trainer
can learn long-term seasonal patterns and regime shifts.

```
TimescaleDB: features  (one row per symbol per hour)
┌────────────────────────────────────────────────────┐
│ ts          TIMESTAMPTZ (hypertable partition key)  │
│ symbol      "NVDA"                                  │
│                                                     │
│ — Polymarket ──────────────────────────────────── │
│ poly_conviction_delta_1h   float                   │
│ poly_conviction_delta_4h   float                   │
│ poly_volume_24h             float                   │
│ poly_yes_price              float                   │
│                                                     │
│ — News ────────────────────────────────────────── │
│ news_sentiment_1h           float  (-1 to +1)       │
│ news_sentiment_4h           float                   │
│ news_hotness_peak_4h        float                   │
│ news_article_count_4h       int                     │
│                                                     │
│ — Price / Technical ───────────────────────────── │
│ rsi_14                      float  (0–100)          │
│ macd_histogram              float                   │
│ atr_14                      float  (avg true range) │
│ bb_position                 float  (0=lower, 1=upper│
│ sma_20_slope                float                   │
│ vol_ratio_30d               float  (vol/avg30)      │
│ price_change_1d             float  (%)              │
│ price_change_5d             float  (%)              │
│                                                     │
│ — Options ─────────────────────────────────────── │
│ put_call_ratio              float                   │
│ unusual_sweep_count_4h      int                     │
│                                                     │
│ — Macro ───────────────────────────────────────── │
│ vix_level                   float                   │
│ wti_crude                   float                   │
│ us_10y_yield                float                   │
│ fed_funds_rate              float                   │
│ usd_index                   float                   │
│ yield_curve_10_2            float                   │
│                                                     │
│ — Advanced ────────────────────────────────────── │
│ adx_14                      float                   │
│ bb_width                    float                   │
│ price_vs_sma50              float                   │
│ atr_pct                     float                   │
│ hv_20                       float  (hist. vol)      │
│ price_vs_52w_high           float                   │
│ stoch_k                     float                   │
│                                                     │
│ — Labels (filled nightly by label_filler.py) ─── │
│ forward_return_1d           float  (actual % ret)   │
│ forward_return_5d           float                   │
│ forward_return_10d          float                   │
└────────────────────────────────────────────────────┘
```

---

## Stage 4 — Historical Ingestor (TimescaleDB)

Runs nightly. Fills the tables the feature builder and backtester rely on:

```
raw_ohlcv   ← yfinance daily candles (20 tickers + commodities, 10yr retention)
raw_macro   ← FRED API: VIXCLS, DCOILWTICO, DGS10, DGS2, FEDFUNDS, DTWEXBGS
technicals  ← RSI, SMA, EMA, MACD, ATR, Bollinger, ADX derived from raw_ohlcv
```

---

## Stage 5 — ML Trainer

Reads from `features` where `forward_return_5d IS NOT NULL`.  
Trains when `labeled_rows >= 200 AND hours_since_last_train >= 24`.

```
Input: features table (33 cols)  →  Label: forward_return_5d > +3% (long)
                                            forward_return_5d < -3% (short)

Output files written to ./models/:
  scoring_model.json       XGBoost long classifier
  scoring_model_short.json XGBoost short classifier
  shap_explainer.pkl       TreeExplainer for long model
  shap_explainer_short.pkl TreeExplainer for short model

Hyperparams: n_estimators=400, max_depth=4, learning_rate=0.04
CV: TimeSeriesSplit(n_splits=5)  — no lookahead leakage
```

---

## Stage 6 — AI Correlator (12-Step Pipeline)

Triggered by every message on `Redis new_signal`.

```
Redis: new_signal
{ "signal_id": "550e8400-..." }
                │
                ▼
        ┌───────────────┐
        │  STEP 1       │  SELECT * FROM signals WHERE id=$1
        │  Fetch signal │──► signal = { id, source, symbol, type,
        └───────────────┘             score, direction, payload, created_at }
                │
                ▼
        ┌───────────────┐  SELECT * FROM features
        │  STEP 2       │  WHERE symbol=$1 ORDER BY ts DESC LIMIT 1
        │  Fetch feats  │──► feat_dict = { rsi_14: 28.4, vix_level: 19.2,
        └───────────────┘               vol_ratio_30d: 2.3, ... 33 fields }
                │
                ▼
        ┌───────────────┐  feat_dict → XGBoost.predict_proba(X)[0][1]
        │  STEP 3       │             × _model_staleness_factor()
        │  Score        │──► confidence = 0.79  (discounted if model > 24h old)
        │               │   top_features = [
        └───────────────┘     { feature: "rsi_14", current_value: 28.4,
                                 shap_value: +0.14 },  ← supports
                               { feature: "vol_ratio_30d", ..., shap_value: +0.11 },
                               ... top 5 by |shap|
                             ]
                │
                ▼
        ┌───────────────┐  SPY vs 200d SMA → trend: "bull"|"bear"|"sideways"
        │  STEP 3.5     │  VIX level      → volatility: "low"|"elevated"|"high"
        │  Regime       │──► regime = { trend: "bull", volatility: "elevated",
        └───────────────┘             vix: 19.2, spy_vs_200d_pct: +4.1 }
                │
                ▼
        ┌───────────────┐  REGIME_THRESHOLD lookup:
        │  STEP 4       │    bull+buy  → 0.65 (baseline)
        │  Confidence   │    bear+buy  → 0.80 (contrarian)
        │  gate         │    bull+sell → 0.78 (contrarian)
        └───────────────┘  confidence < threshold → DROP
                │                                  ▲ most signals die here
                ▼
        ┌───────────────┐  Non-polymarket: SELECT FROM opportunities
        │  STEP 4.5     │    WHERE $symbol = ANY(tickers) AND created_at > NOW()-6h
        │  Dedup        │  Polymarket: check matched_tickers && opp.tickers
        └───────────────┘    AND created_at > NOW()-4h  (polls fire every 5–30s)
                           exists → DROP
                │
                ▼
        ┌───────────────┐  yfinance earnings calendar check
        │  STEP 4.6     │  earnings within EARNINGS_GUARD_DAYS (3) → DROP
        │  Earnings     │
        └───────────────┘
                │
                ▼
        ┌───────────────┐  SELECT * FROM hypotheses WHERE is_active=TRUE
        │  STEP 5       │  For each: _sprt_check(sprt_wins, sprt_losses)
        │  Hypothesis   │    "dead" → skip
        │  matching     │  _conditions_met(feat_dict, conditions)
        └───────────────┘──► hypothesis = { id, name, description,
                                             feature_conditions: {"rsi_14": {"lt": 30}},
                                             direction: "up",
                                             hold_days: 5,
                                             confidence_threshold: 0.65,
                                             sprt_wins: 12, sprt_losses: 4 }
                │             None → DROP
                ▼
        ┌───────────────┐  SignalBacktester.estimate([signal])
        │  STEP 6       │  Finds historical dates where same signal type fired
        │  Backtest     │  Computes forward returns at 3d/5d/10d holding periods
        │               │  Picks holding period with best Sharpe
        └───────────────┘
                │
                ▼ bt dict:
                { sample_size: 34,
                  win_rate: 0.62,
                  avg_return_pct: 3.1,
                  avg_win_pct: 5.2,
                  avg_loss_pct: -2.8,
                  expectancy: 1.84,        ← win_rate×avg_win - loss_rate×avg_loss
                  edge_exists: True,
                  sharpe: 0.83,            ← mean/std × sqrt(252/hold_days)
                  max_drawdown_pct: -8.2,             correctly scaled per period
                  holding_period_optimal: "5d",
                  data_quality: "sufficient" }

                Gate: n < MIN_SAMPLE_SIZE (30)  → always DROP  (too thin to trust)
                      n ≥ 30                    → need sharpe ≥ 0.80 AND expectancy ≥ 0
                Saved to backtest_results table.
                passed=False → DROP
                │
                ▼
        ┌───────────────┐  confidence ≥ 0.75 → Tier A (full Kelly)
        │  STEP 7       │  confidence ≥ 0.70 → Tier B (85% Kelly)
        │  Quality tier │  confidence < 0.70 → Tier C → DROP
        └───────────────┘
                │
                ▼
        ┌───────────────┐  OpenAI text-embedding-3-small
        │  STEP 8       │  Input: "{source} {type} {symbol}"
        │  Embed signal │──► sig_vec = [0.023, -0.118, ...] (1536 floats)
        │               │  UPDATE signals SET embedding=$1 WHERE id=$2
        └───────────────┘  pgvector cosine search:
                           SELECT *, 1-(embedding<=>$vec) AS sim
                           FROM opportunities LIMIT 3
                           ──► similar_opps = [
                                 { sim: 0.94, summary: "...", model_confidence: 0.76 },
                                 ...
                               ]
                │
                ▼
        ┌───────────────┐  TimescaleDB:
        │  STEP 9       │    SELECT series_id, value FROM raw_macro  → macro []
        │  Context      │  Redis polymarket:macro_sentiment (TTL 6h) → poly_sentiment {}
        └───────────────┘
                │
                ▼ prompt inputs assembled:
                { signal, confidence: 0.79, top_features: [...5],
                  bt: { win_rate, avg_return_pct, sharpe, ... },
                  similar_opps: [...3],
                  macro: [{ series_id: "VIXCLS", value: 19.2 }, ...],
                  hypothesis: { name, description },
                  polymarket_sentiment: { equities_tech: { avg_prob: 0.61,
                    market_count: 4, top_question: "..." }, _meta: { age_hours: 1.2 } }
                }
                │
                ▼
        ┌───────────────┐  claude-sonnet-4-20250514
        │  STEP 10      │  max_tokens=800
        │  Claude API   │──► narrative = {
        └───────────────┘     "summary": "NVDA shows oversold RSI with rising options activity.",
                               "thesis":  "RSI touched 28 while unusual sweeps spiked 3×...",
                               "risk_note": "Macro headwind: VIX elevated at 19...",
                               "historical_note": "Similar setup in Oct 2024 returned +4.8%.",
                               "confidence_note": null
                                 ← non-null if sample_size<20 or data_quality=low/very_low
                                   e.g. "Only 14 precedents — treat sizing with caution."
                                   appended to risk_note before saving
                             }
                │
                ▼
        ┌───────────────┐  OpenAI embed(narrative.summary + narrative.thesis)
        │  STEP 11      │  ──► opp_vec = [...]  (1536 floats)
        │  Save         │
        │  opportunity  │  INSERT INTO opportunities:
        └───────────────┘
                │
                ▼ opportunity row:
                { id: UUID,
                  hypothesis_id: UUID,
                  signal_ids: [UUID],
                  backtest_id: UUID,
                  model_confidence: 0.79,
                  summary: "...",
                  thesis: "...",
                  risk_note: "...",
                  historical_note: "...",
                  action: "buy",
                  tickers: ["NVDA"],
                  expected_return_pct: 3.1,
                  hold_days: 5,
                  stop_loss_pct: 0.034,     ← dynamic: VIX×vol_ratio, clamped [0.02,0.12]
                  top_features: JSONB,
                  macro_snapshot: JSONB,
                  holding_period_optimal: "5d",
                  embedding: vector(1536) }

                + enriched in memory for fan-out:
                  win_rate: 0.62
                  avg_win_pct: 5.2
                  avg_loss_pct: -2.8
                  backtest_sample_size: 34
                  sharpe: 0.81
                  expectancy: 1.84
                  quality_tier: "A"
                │
                ▼
        ┌───────────────┐  Market hours gate: NYSE 9:30–16:00 ET, Mon–Fri
        │  STEP 12      │  closed → save but don't fan out
        │  Fan-out      │  open  → fan_out_to_users(opp, db, redis, regime)
        └───────────────┘
```

---

## Stage 6.5 — Fan-Out (Per-User Strategy Generation)

```
fan_out_to_users(opp, db, redis, regime)
        │
        ▼
SELECT users WHERE subscriptions.symbol = ANY(opp.tickers)
        │
        ▼  For each matching user:
┌──────────────────────────────────────────────────────────┐
│  GATE 1 — Position limit                                  │
│  COUNT active strategies < MAX_POSITIONS (5) ?           │
│  No → skip user                                          │
└──────────────────────────────────────────────────────────┘
        │ pass
        ▼
┌──────────────────────────────────────────────────────────┐
│  GATE 2 — Ticker dedup                                    │
│  No active strategy for same ticker already? (per user)  │
│  Duplicate → skip user                                   │
└──────────────────────────────────────────────────────────┘
        │ pass
        ▼
┌──────────────────────────────────────────────────────────┐
│  GATE 3 — Sector concentration                           │
│  COUNT active strategies in same sector < 2 ?           │
│  At cap → skip user                                      │
└──────────────────────────────────────────────────────────┘
        │ pass
        ▼
┌──────────────────────────────────────────────────────────┐
│  SIZING — Bayesian half-Kelly                             │
│                                                          │
│  p  = Beta(wins+1, losses+1).ppf(0.10)  ← conservative  │
│       10 samples: raw 60% → 36% Bayesian                │
│       200 samples: converges to true rate               │
│                                                          │
│  b  = avg_win / avg_loss  (reward:risk ratio)           │
│  Kelly = (b×p − q) / b                                  │
│  half_Kelly = Kelly × 0.5                               │
│  sized = min(half_Kelly, MAX_SIZE_PCT[risk_level],       │
│              user.max_position_pct)                      │
│       × VOL_SIZE_FACTOR[volatility]                     │
│                                                          │
│  Tier A: full sized                                      │
│  Tier B: sized × 0.85                                   │
└──────────────────────────────────────────────────────────┘
        │ pct (e.g. 0.028 = 2.8% of equity)
        ▼
┌──────────────────────────────────────────────────────────┐
│  GATE 4 — Portfolio beta cap                             │
│  Sum(BETA_MAP[ticker] × sizing_pct) + new position      │
│  total > MAX_PORTFOLIO_BETA (1.0) → skip user           │
└──────────────────────────────────────────────────────────┘
        │ pass
        ▼
┌──────────────────────────────────────────────────────────┐
│  GATE 5 — Monte Carlo ruin check                         │
│  Simulate 4000 portfolio paths with all active           │
│  strategies + candidate                                  │
│  P(drawdown > 10%) > MAX_RUIN_PROB (0.15) → skip user   │
└──────────────────────────────────────────────────────────┘
        │ pass
        ▼
INSERT INTO strategies:
{ user_id, opportunity_id,
  sizing_pct: 0.028,
  stop_loss_pct: 0.034,
  take_profit_pct: 0.031,
  rationale: "NVDA oversold RSI. Bayesian WR: 42% (n=34). EV: +1.12% | Sharpe: 0.81 | Tier: A...",
  expires_at: NOW() + INTERVAL '5 days',
  status: 'pending' }
        │
        ▼
Redis PUBLISH strategies:{user_id}:
{
  id, user_id, opportunity_id,
  action:              "buy",
  tickers:             ["NVDA"],
  summary:             "NVDA shows oversold RSI with rising options activity.",
  thesis:              "RSI touched 28 while unusual sweeps spiked 3×...",
  confidence:          0.79,
  expected_return_pct: 3.1,
  hold_days:           5,
  win_rate:            0.42,       ← Bayesian (conservative)
  avg_win_pct:         5.2,
  avg_loss_pct:        -2.8,
  sample_size:         34,
  sharpe:              0.81,
  ev_pct:              1.12,
  bayesian_win_rate:   0.42,
  ruin_probability:    0.08,
  quality_tier:        "A",
  sizing_pct:          0.028,
  stop_loss_pct:       0.034,
  take_profit_pct:     0.031,
  expires_at:          "2025-05-23T14:32:00Z",
  regime_trend:        "bull",
  regime_volatility:   "elevated"
}
```

---

## SPRT Background Task (runs every 6 hours)

```
_run_sprt_loop()  →  _sprt_maintenance()
        │
        ▼
SELECT expired strategies (status=pending, expires_at < NOW(),
       expires_at > NOW()-48h, hypothesis_id IS NOT NULL)
        │
        ▼  For each expired strategy:
Lookup entry price: raw_ohlcv WHERE symbol AND ts >= strategy.created_at LIMIT 1
Lookup exit  price: raw_ohlcv WHERE symbol AND ts >= entry + hold_days  LIMIT 1
        │
        ▼
pnl = (exit - entry) / entry × 100
      (negated for short/sell trades)
        │
        ├─ pnl > 0 → UPDATE hypotheses SET sprt_wins  = sprt_wins  + 1
        └─ pnl ≤ 0 → UPDATE hypotheses SET sprt_losses = sprt_losses + 1

UPDATE strategies SET status = 'expired'
        │
        ▼
For all active hypotheses:
  log_LR = wins × log(0.55/0.45) + losses × log(0.45/0.55)
  A = log(0.90/0.05)   ← "alive" boundary
  B = log(0.10/0.95)   ← "dead" boundary
  log_LR ≥ A → "alive"
  log_LR ≤ B → "dead"  → UPDATE hypotheses SET is_active=FALSE
  else → "uncertain" (wait for more data)
```

---

## Stage 7 — Frontend (Next.js)

### SSE Strategy Stream

```
Redis SUBSCRIBE strategies:{user_id}
        │
        ▼
GET /api/strategies/stream  (SSE endpoint)
Content-Type: text/event-stream
        │
        ▼  browser useStrategyStream() hook
        │  data: { ...strategy payload }
        ▼
Strategy Inbox UI cards:
  ticker chip · BUY/SELL badge · AI confidence %
  summary text
  [Execute] [Dismiss]  → click opens StrategyDetail modal
```

### StrategyDetail Modal → OrderEntry

```
User opens modal:
  GET /api/strategies?id={id}
  ──► { win_rate, avg_return_pct, sample_size, sharpe,
        hold_days, stop_loss_pct, expected_return_pct, sizing_pct }

  GET /api/trades?type=account  → { equity, cash, buying_power, is_paper }
  GET /api/trades?type=quote&symbol=NVDA → { price: 142.50, atr: 3.84 }

OrderEntry renders:
  leverage:   1× / 2× / 4×      (multiplies sizing_pct × leverage)
  order_type: market | limit     (limit = direct dollar price input)
  stop_loss:  fixed | trailing   (defaults: 1×ATR / 1.5% trailing)
  take_profit: ON | OFF          (default: 2×ATR above entry)
  ─────────────────────────────
  QTY   = floor(equity × sizing_pct × leverage / price)
  ALLOC = equity × sizing_pct × leverage
  MAX LOSS = slPts × qty
  R/R   = tpPts / slPts

Hold-to-execute (2.5s hold):
  POST /api/trades
  { strategy_id, confirmed: true, order_type, limit_price,
    stop_loss_price, take_profit_price, trail_percent, leverage }
        │
        ▼
Alpaca createOrder({
  symbol, qty, side,
  type: "market" | "limit",
  order_class: "bracket" | "oto",
  stop_loss: { stop_price } | { trail_percent },
  take_profit: { limit_price }
})
        │
        ▼
INSERT INTO trades (alpaca_order_id, symbol, side, qty, status='submitted')
UPDATE strategies SET status='executed'
```

### Live Trades Page (SSE)

```
GET /api/trades/stream  (SSE, reconnects every 5s on drop)
        │  polls Alpaca every 3s
        ▼
data: {
  account: { equity, cash, buying_power, unrealized_pl, last_equity },
  positions: [
    { symbol, side, qty, avg_entry_price, current_price,
      market_value, unrealized_pl, unrealized_plpc }
  ],
  ts: 1747576323000
}
        │
        ▼
AccountSummary: portfolio value · cash · buying power · P/L · return %
PositionsTable rows:  (updates every 3s — no polling delay)
  click row → PositionPanel expands inline:
  ┌─ real-time P/L + return % ──────────────────────────┐
  │  Tabs: [+ Buy More] [Sell Partial] [Close All]       │
  │                                                      │
  │  Buy More:                                           │
  │    shares input · leverage 1×/2×/4×                 │
  │    order type: market | limit (dollar price input)   │
  │    POST /api/trades { action:"add_to_position",      │
  │                       qty, leverage, limit_price }   │
  │                                                      │
  │  Sell Partial:                                       │
  │    shares input (max current qty)                    │
  │    order type: market | limit                        │
  │    POST /api/trades { action:"sell_partial",         │
  │                       qty, limit_price }             │
  │                                                      │
  │  Close All:                                          │
  │    confirm gate                                      │
  │    POST /api/trades { action:"close_position",       │
  │                       symbol, qty }                  │
  └──────────────────────────────────────────────────────┘

SWR (30s) for orders + closed trades (no need for 3s there)
```

---

## Database Write Summary

| Step | Writer | Table / Key | Notes |
|------|--------|-------------|-------|
| Consumer detects signal | polymarket/news/analytics-consumer | `signals` | Score + direction |
| Consumer publishes | consumer | Redis `new_signal` | Signal ID only |
| Correlator updates signal | ai-correlator | `signals.embedding` | After OpenAI embed |
| Backtest run | ai-correlator | `backtest_results` | All runs, pass or fail |
| Opportunity created | ai-correlator | `opportunities` | Only after all gates pass |
| Strategy created | fan-out | `strategies` | Per matching user |
| Strategy published | fan-out | Redis `strategies:{id}` | Full payload |
| SPRT outcome | SPRT loop | `hypotheses.sprt_wins/losses` | Every 6h |
| Hypothesis deactivated | SPRT loop | `hypotheses.is_active=FALSE` | When statistically dead |
| Order submitted | Next.js | `trades` | Alpaca order ID |
| Order filled | Next.js GET sync | `trades.status/fill_price` | On next page load |

---

## Gate Summary (How Many Signals Get Through)

```
100 signals enter
   │
   ├─ 60 → confidence gate drops (below regime threshold 0.65–0.80)
   │
   ├─ 18 → dedup / earnings guard drops
   │        (polymarket now included: 4h window on matched tickers)
   │
   ├─ 10 → no hypothesis matched → drop
   │
   ├─  8 → backtest gate drops:
   │        sample_size < 30  → always drop  (MIN_SAMPLE_SIZE hard floor)
   │        sharpe < 0.80 or expectancy < 0  → drop
   │        (Sharpe now correctly scaled: mean/std × sqrt(252/hold_days))
   │
   ├─  2 → quality tier C drops (conf < 0.70)
   │
   └─  2 → opportunities saved
            │
            ▼  fan-out (per user):
            ├─ MAX_POSITIONS cap (5)
            ├─ per-ticker dedup
            ├─ sector concentration cap (2 per sector)
            ├─ portfolio beta cap (≤ 1.0 net)
            └─ Monte Carlo ruin gate (P(drawdown>10%) ≤ 15%)
            ──► 1–3 strategies created (across all users)

Note: fewer opportunities is the goal — quality over quantity.
The raised MIN_SHARPE (0.30→0.80) and MIN_SAMPLE_SIZE (none→30)
are the main drivers of the tighter funnel.
```
