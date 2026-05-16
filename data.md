# Data Flow & Schema Reference

## End-to-End Data Flow

```
Polymarket API ──► polymarket-producer ──► raw.polymarket (Kafka)
Finnhub API    ──► news-producer       ──► raw.news       (Kafka)
yfinance       ──► analytics-producer  ──► raw.analytics  (Kafka)
                                               │
                              ┌────────────────┼────────────────┐
                              ▼                ▼                ▼
                   polymarket-consumer  news-consumer  analytics-consumer
                   conviction_shift     hotness score  volume/RSI/momentum
                   score + urgency + CI score + CI     score + CI
                              │                │                │
                              └────────────────┴────────────────┘
                                               │
                              INSERT signals (pg) + PUBLISH new_signal (Redis)
                                               │
                                     ai-correlator wakes
                                               │
                         ┌─────────────────────▼──────────────────────┐
                         │ 1. fetch signal from pg                     │
                         │ 2. time-window gate: 2+ sources in 15 min   │
                         │ 3. backtester.estimate() → stats from tsdb  │
                         │ 4. macro snapshot from tsdb macro_indicators │
                         │ 5. Groq classify (≤20 signals, JSON out)    │
                         │ 6. decision: base_conf + adj + macro_boost  │
                         │ 7. always INSERT backtest_results           │
                         │ 8. if conf ≥ 0.55 → INSERT opportunity      │
                         │ 9. fan_out: INSERT strategies per user      │
                         │10. PUBLISH strategies:{user_id} (Redis SSE) │
                         └─────────────────────────────────────────────┘
                                               │
                          Next.js SSE (/api/strategies/stream)
                                               │
                              browser: strategy inbox (hold-to-confirm)
                                               │
                              POST /api/trades → Alpaca order
```

---

## PostgreSQL (app DB · port 5432 · db: eventedge)

| Table | Key columns | Relations |
|---|---|---|
| `users` | id, email, risk_level, max_position_pct, alpaca_key_id, is_paper, onboarding_complete | root — referenced by all user-owned tables |
| `subscriptions` | user_id, source, symbol | → users |
| `signals` | id, source, symbol, tickers[], type, score, direction, status, pipeline_step, payload, embedding(384) | standalone insert by consumers |
| `backtest_results` | id, signal_ids[], symbol, sample_size, win_rate, avg_return_pct, sharpe, max_drawdown_pct, expectancy, passed, drop_reason | signal_ids[] → signals.id |
| `opportunities` | id, signal_ids[], backtest_id, confidence, action, tickers[], expected_return_pct, hold_days, stop_loss_pct, summary, thesis, embedding(384) | backtest_id → backtest_results |
| `opportunities_signals` | opportunity_id, signal_id | junction: opportunities ↔ signals |
| `strategies` | id, user_id, opportunity_id, sizing_pct, stop_loss_pct, take_profit_pct, rationale, status, expires_at | user_id → users · opportunity_id → opportunities |
| `trades` | id, user_id, strategy_id, alpaca_order_id, symbol, side, qty, fill_price, status, pnl_usd | user_id → users · strategy_id → strategies |
| `positions` | id, user_id, symbol, qty, avg_entry_price, unrealized_pl, is_paper | user_id → users · UNIQUE(user_id, symbol, is_paper) |

**signal.status lifecycle:** `active → processing → processed | dropped`  
**strategy.status lifecycle:** `pending → executed | dismissed | expired`  
**signal.pipeline_step:** 0=received, 1=time-gate check, 6=dropped, 8=processed

---

## TimescaleDB (history DB · port 5433 · db: market_history)

| Table | Key columns | Notes |
|---|---|---|
| `ohlcv` | time, symbol, open/high/low/close, volume, interval | hypertable · PK (time, symbol, interval) · ingestor writes 2y daily bars |
| `macro_indicators` | time, series_id, value | hypertable · series: FEDFUNDS CPIAUCSL DCOILWTICO DGS10 VIXCLS DTWEXBGS |
| `technicals` | time, symbol, interval, rsi_14, macd, macd_signal, bb_upper/lower, atr_14 | hypertable · computed by ingestor via pandas-ta |
| `ohlcv_weekly` | week, symbol, open/high/low/close/volume | continuous aggregate over ohlcv (7-day buckets) |

**Ingestor:** nightly 00:30 UTC · 2y lookback · symbols from subscriptions table · upserts on conflict

---

## Redis channels

| Channel | Publisher | Subscriber |
|---|---|---|
| `new_signal` | consumers (after INSERT into signals) | ai-correlator |
| `strategies:{user_id}` | ai-correlator fan_out | Next.js SSE route |

---

## Confidence decision formula

```
base_confidence = f(backtest stats)        # 0.30 floor if no history; up to 0.85
conf_adj        = Groq output [-0.20,+0.20]
macro_boost     = strong:+0.08 | moderate:0 | weak:-0.08 | negative:-0.15
final           = clamp(base + adj + boost, 0, 1)
threshold       = 0.55  →  pass: save opportunity + fan-out strategies
```
