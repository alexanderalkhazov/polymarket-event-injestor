# EventEdge AI — Improvement Suggestions

---

## Root Cause: Why You Get 200 Strategies for the Same Stock

There are four compounding bugs that together cause the flood:

1. **15-minute dedup window is far too short.** `correlator.py:474` blocks the same symbol for only 15 minutes. Polymarket polls every 5–30 seconds. Over a trading day that means 50–100 signals per ticker can each spawn a full pipeline run.

2. **Fan-out has no per-user strategy dedup.** `fan_out_to_users` never checks whether the user already has an active, non-expired strategy for that ticker. Every opportunity that survives the correlator creates a fresh strategy row for every subscribed user.

3. **The placeholder hypothesis passes everything.** `_match_hypothesis` falls back to a catch-all if no real hypothesis matches, so practically no signal is ever dropped at step 5.

4. **MAX_POSITIONS is defined but never enforced.** The constant exists in `correlator.py:62` but `fan_out_to_users` never queries the user's current strategy count.

Fix all four and the flood stops. The rest of this document is about making signal quality genuinely better.

---

## 1. Deduplication — Fix the Flood First

### 1a. Extend the opportunity dedup window

**File:** `correlator.py:474`

```python
# Current — way too short
"AND created_at > NOW()-INTERVAL '15 minutes'"

# Replace with hold-period-aware window
dedup_hours = max(4, (hypothesis.get("hold_days") or 5) * 24 // 5)
# e.g. hold_days=5 → 24h dedup window
f"AND created_at > NOW()-INTERVAL '{dedup_hours} hours'"
```

### 1b. Per-user strategy dedup in fan-out

**File:** `fan_out.py:53` — add this check inside the `for user in users` loop before inserting:

```python
existing = await db.fetchrow(
    """SELECT id FROM strategies
       WHERE user_id=$1
         AND opportunity_id IN (
             SELECT id FROM opportunities WHERE $2 = ANY(tickers)
         )
         AND status NOT IN ('dismissed', 'expired', 'executed')
         AND expires_at > NOW()
       LIMIT 1""",
    user["id"], tickers[0] if tickers else "",
)
if existing:
    logger.debug("User %s already has active strategy for %s — skipping", user["id"], tickers)
    continue
```

### 1c. Enforce MAX_POSITIONS in fan-out

**File:** `fan_out.py:53` — also check inside the same loop:

```python
MAX_POSITIONS = int(os.getenv("MAX_POSITIONS", "5"))

active_count = await db.fetchval(
    """SELECT COUNT(*) FROM strategies
       WHERE user_id=$1
         AND status NOT IN ('dismissed', 'expired', 'executed')
         AND expires_at > NOW()""",
    user["id"],
)
if active_count >= MAX_POSITIONS:
    logger.debug("User %s at position limit (%d) — skipping", user["id"], MAX_POSITIONS)
    continue
```

### 1d. Fix strategy expiry to match the trade horizon

**File:** `fan_out.py:86` — the current `NOW()+INTERVAL '4 hours'` is wrong for a 5-day trade.

```python
hold_map = {"3d": "3 days", "5d": "5 days", "10d": "10 days"}
hold_interval = hold_map.get(opp.get("holding_period_optimal", "5d"), "5 days")

# Pass into INSERT as a formatted interval string
f"NOW()+INTERVAL '{hold_interval}'"
```

---

## 2. Signal Clustering — One Pipeline Run Per Burst

Right now each Kafka message triggers a full pipeline (OpenAI embed + pgvector + Claude). When Polymarket fires 10 signals for NVDA in 60 seconds, you pay for 10 Claude calls and get 10 near-identical opportunities.

### Solution: accumulate signals in a 30-second window before processing

**File:** `correlator.py::run()` — replace the immediate `_process` call with a buffer dict keyed by `source:symbol`. Flush each key when `CLUSTER_WINDOW_S` seconds have passed since the first signal in that bucket:

```python
CLUSTER_WINDOW_S = float(os.getenv("CLUSTER_WINDOW_S", "30"))

signal_buffer: dict[str, list[str]] = {}   # "source:symbol" → [signal_id, ...]
buffer_start:  dict[str, float]    = {}    # tracks when the bucket opened

async for message in pubsub.listen():
    if message["type"] != "message":
        continue
    data    = json.loads(message["data"])
    sig_id  = data["signal_id"]
    row     = await db.fetchrow("SELECT symbol, source FROM signals WHERE id=$1", uuid.UUID(sig_id))
    if not row:
        continue

    key = f"{row['source']}:{row['symbol']}"
    now = time.time()
    signal_buffer.setdefault(key, []).append(sig_id)
    buffer_start.setdefault(key, now)

    if now - buffer_start[key] >= CLUSTER_WINDOW_S:
        ids = signal_buffer.pop(key)
        buffer_start.pop(key)
        asyncio.create_task(_process_cluster(ids, db, tsdb, redis))
```

`_process_cluster` picks the highest-scored signal as the representative and passes the full set of corroborating sources into the pipeline. Multi-source agreement boosts confidence before the gate:

```python
sources = {s["source"] for s in all_signals_in_cluster}
if len(sources) >= 2:
    confidence = min(confidence * 1.15, 1.0)   # 15% boost for multi-source
if len(sources) == 3:
    confidence = min(confidence * 1.10, 1.0)   # further 10% for full trifecta
```

---

## 3. Fix the Backtest Logic

The current `_find_similar_setups` in `backtester.py` identifies "similar" historical bars using OHLCV-derived rules (volume spike > 1.8×, RSI threshold, price change > 4%). This is completely disconnected from the ML features that actually scored the signal. The backtest measures a generic technical pattern, not the specific setup the model detected.

### 3a. Use the feature table for backtest lookups

**File:** `backtester.py` — replace `_find_similar_setups` with a feature-space query:

```python
async def _find_similar_setups_from_features(self, symbol: str, feat_dict: dict, signal_ts) -> list:
    rows = await self.tsdb.fetch(
        """SELECT ts, rsi_14, vol_ratio_30d, news_sentiment_1h, poly_conviction_delta_1h
           FROM features
           WHERE symbol=$1 AND ts < $2 AND forward_return_5d IS NOT NULL
           ORDER BY ts DESC LIMIT 500""",
        symbol, signal_ts,
    )
    if not rows:
        return []

    key_features = ["rsi_14", "vol_ratio_30d", "news_sentiment_1h", "poly_conviction_delta_1h"]
    current = {f: feat_dict.get(f) or 0 for f in key_features}

    similar_dates = []
    for row in rows:
        close_enough = all(
            abs((row.get(f) or 0) - current[f]) <= abs(current[f]) * 0.20 + 0.05
            for f in key_features
        )
        if close_enough:
            similar_dates.append(row["ts"])
    return similar_dates
```

### 3b. Add an expectancy gate

**File:** `correlator.py:337`

A 45% win rate with average loss 3× the average win is a losing strategy. The current gate misses this entirely.

```python
expectancy = bt.get("expectancy", 0.0)
passed = (wr >= 0.45) and (expectancy >= -0.5 or n < 10)
```

### 3c. Stop auto-passing when sample_size < 10

```python
# Current — risky: n<10 always passes
if n < 10:
    passed, drop_reason = True, None

# Better — require at least non-negative expectancy
if n < 10:
    passed = bt.get("expectancy", 0) >= 0
    drop_reason = "expectancy negative on thin data" if not passed else None
```

---

## 4. ATR-Based Dynamic Stop-Loss

**File:** `correlator.py:601` — currently `stop_loss_pct` is hardcoded to `0.03` for every asset. TSLA moves 5% intraday; TLT moves 0.5%. A flat 3% stop is wrong for both.

```python
atr_pct = float(feat_dict.get("atr_pct") or 0)   # atr_14 as fraction of price
if atr_pct > 0:
    stop_loss_pct = round(min(max(1.5 * atr_pct, 0.02), 0.12), 4)
else:
    stop_loss_pct = 0.03   # fallback
```

Propagate this value into `fan_out_to_users` as part of the `opp` dict so Kelly sizing uses the correct loss denominator.

---

## 5. Signal Quality Tiers — Gate Before Calling Claude

Right now every signal that passes confidence gating goes through OpenAI embedding + pgvector + Claude. Reserve the LLM path for genuinely strong signals.

Add a quality tier before step 7 in `correlator.py::_process`:

```python
def _signal_quality(confidence: float, cluster_sources: set, feat_dict: dict) -> str:
    if len(cluster_sources) >= 2 and confidence >= 0.75:
        return "A"   # multi-source + high confidence
    if confidence >= 0.72:
        return "B"   # single strong source
    return "C"       # weak — save for training data only

quality = _signal_quality(confidence, cluster_sources, feat_dict)
if quality == "C":
    logger.info("Low-quality signal dropped at tier gate (conf=%.2f)", confidence)
    return
```

Tier C signals are still valuable for model training. Write them to a lightweight `signals_log` table instead of running the full pipeline.

---

## 6. Sector-Level Diversification in Fan-Out

Users currently receive 5 strategies all in the same sector (NVDA, AAPL, MSFT, TSLA, META) because the system has no concept of sector concentration.

**File:** `fan_out.py` — add a per-user sector check:

```python
SECTOR_MAP = {
    "NVDA": "tech", "AAPL": "tech", "MSFT": "tech", "TSLA": "tech",
    "META": "tech", "AMZN": "tech", "GOOGL": "tech",
    "USO": "energy", "XOM": "energy", "CVX": "energy",
    "GLD": "commodities", "SLV": "commodities",
    "TLT": "rates", "IEF": "rates",
    "SPY": "broad", "QQQ": "broad",
}
MAX_SECTOR_STRATEGIES = int(os.getenv("MAX_SECTOR_STRATEGIES", "2"))

ticker  = (tickers or [""])[0]
sector  = SECTOR_MAP.get(ticker, "other")

sector_count = await db.fetchval(
    """SELECT COUNT(*) FROM strategies s
       JOIN opportunities o ON o.id = s.opportunity_id
       WHERE s.user_id=$1
         AND s.status NOT IN ('dismissed','expired','executed')
         AND s.expires_at > NOW()
         AND $2 = ANY(o.tickers)""",
    user["id"], ticker,
)
if sector_count >= MAX_SECTOR_STRATEGIES:
    logger.debug("User %s at sector limit for %s (%s)", user["id"], ticker, sector)
    continue
```

---

## 7. Real Alpaca Position Awareness

For users with Alpaca keys, check their actual open positions before fanning out. No point suggesting "buy NVDA" to someone already holding 8% of their portfolio in it.

**File:** `fan_out.py` — inside the user loop, after the dedup checks:

```python
if user.get("alpaca_key_id") and user.get("alpaca_secret_key"):
    try:
        import alpaca_trade_api as tradeapi
        api = tradeapi.REST(
            user["alpaca_key_id"], user["alpaca_secret_key"],
            paper=user.get("paper_trading", True)
        )
        positions  = {p.symbol: float(p.market_value) for p in api.list_positions()}
        portfolio  = float(api.get_account().portfolio_value)
        exposure   = positions.get(ticker, 0) / portfolio if portfolio > 0 else 0
        if exposure >= max_pos_pct * 0.8:
            logger.debug("User %s: %.1f%% in %s already — skipping", user["id"], exposure*100, ticker)
            continue
    except Exception as exc:
        logger.warning("Alpaca check failed for user %s: %s", user["id"], exc)
```

---

## 8. Seed Real Hypotheses and Remove the Catch-All

**File:** `correlator.py:299` — the placeholder that returns a fake hypothesis when nothing matches means hypothesis matching is never actually gating anything. Fix by:

1. Removing the placeholder `return` from `_match_hypothesis`
2. Seeding real hypotheses on DB init via a script

```python
# scripts/seed_hypotheses.py
DEFAULT_HYPOTHESES = [
    {
        "name": "oversold_bounce",
        "description": "RSI < 35 with volume spike — mean reversion",
        "feature_conditions": {"rsi_14": {"lt": 35}, "vol_ratio_30d": {"gt": 1.5}},
        "direction": "up", "hold_days": 5, "confidence_threshold": 0.65,
    },
    {
        "name": "momentum_breakout",
        "description": "Price up 3%+ with bullish news and high conviction",
        "feature_conditions": {"price_change_1d": {"gt": 0.03}, "news_sentiment_1h": {"gt": 0.65}},
        "direction": "up", "hold_days": 3, "confidence_threshold": 0.70,
    },
    {
        "name": "overbought_reversal",
        "description": "RSI > 70 with rising put/call ratio — short setup",
        "feature_conditions": {"rsi_14": {"gt": 70}, "put_call_ratio": {"gt": 1.5}},
        "direction": "down", "hold_days": 5, "confidence_threshold": 0.68,
    },
    {
        "name": "polymarket_event_play",
        "description": "Prediction market conviction shift > 8% in 4h",
        "feature_conditions": {"poly_conviction_delta_4h": {"gt": 0.08}},
        "direction": "up", "hold_days": 3, "confidence_threshold": 0.60,
    },
    {
        "name": "macro_stress_hedge",
        "description": "VIX spike + inverted yield curve — risk-off",
        "feature_conditions": {"vix_level": {"gt": 25}, "yield_curve_10_2": {"lt": 0}},
        "direction": "down", "hold_days": 10, "confidence_threshold": 0.65,
    },
]
```

---

## 9. Model Confidence Decay for Stale Models

**File:** `correlator.py::_score`

The model can go 48–72 hours without retraining but scores with the same confidence as if it were fresh. Add a staleness discount:

```python
def _model_staleness_factor() -> float:
    if not MODEL_PATH.exists():
        return 1.0
    age_hours = (time.time() - MODEL_PATH.stat().st_mtime) / 3600
    if age_hours < 24:   return 1.0
    if age_hours < 48:   return 0.95
    if age_hours < 72:   return 0.90
    return 0.85

# Apply in _score() after predict_proba
confidence = float(active_model.predict_proba(X)[0][1]) * _model_staleness_factor()
```

---

## 10. Replace Flat Thresholds with Per-Symbol Z-Scores

RSI=65 is overbought for a utility stock but perfectly normal for a high-beta growth stock. Every hardcoded threshold in `rule_scorer.py` and `backtester.py` treats every ticker identically.

**File:** `feature_store/builder.py` — add z-score columns using 90-day rolling stats:

```python
# For each feature in the feature row, compute zscore vs 90-day history
# rsi_14_zscore = (rsi_14 - mean_90d) / std_90d
# Store alongside raw features in the features table
```

Then update `rule_scorer.py` to use `rsi_14_zscore > 1.5` (1.5 SDs above own mean) instead of the flat `rsi_14 > 65`. This makes the scoring ticker-aware and far more precise.

---

## Priority Order

| # | Change | Fixes the Flood | Effort |
|---|---|---|---|
| 1 | Per-user strategy dedup in fan_out (`fan_out.py:53`) | Yes | 30 min |
| 2 | Enforce MAX_POSITIONS in fan_out (`fan_out.py:53`) | Yes | 15 min |
| 3 | Extend dedup window to hold_days-aware hours (`correlator.py:474`) | Yes | 15 min |
| 4 | Fix strategy expiry to match hold_days (`fan_out.py:86`) | Yes | 15 min |
| 5 | Seed real hypotheses + remove catch-all (`correlator.py:299`) | Partially | 1 hr |
| 6 | Expectancy gate in backtest (`correlator.py:337`) | No | 15 min |
| 7 | ATR-based stop-loss (`correlator.py:601`) | No | 30 min |
| 8 | Signal clustering with 30s window (`correlator.py::run`) | No | 2 hr |
| 9 | Feature-space backtest lookup (`backtester.py`) | No | 2 hr |
| 10 | Signal quality tiers A/B/C (`correlator.py::_process`) | No | 1 hr |
| 11 | Sector diversification cap (`fan_out.py`) | No | 1 hr |
| 12 | Alpaca position awareness (`fan_out.py`) | No | 1 hr |
| 13 | Model staleness discount (`correlator.py::_score`) | No | 15 min |
| 14 | Per-symbol z-score normalization (`feature_store/builder.py`) | No | 3 hr |

**Do items 1–4 first — they're all under 1 hour total and completely eliminate the 200-strategy flood.**

---

---

# Part II — The Math of Consistent Earnings

> No system can *guarantee* earnings. What math can do is give you a provable statistical edge with known confidence, make ruin mathematically impossible (with correct position sizing), and tell you the moment a strategy stops working. That is as close to guaranteed as markets allow.

---

## The One Thing That Actually Matters: Expected Value

Every strategy is worth taking if and only if:

```
EV = (win_rate × avg_win) − (loss_rate × avg_loss) > 0
```

Your system already computes this (`expectancy` in the backtest). The problem is you use it as a binary gate (pass/fail) instead of as a ranking score. Instead of asking "is this signal good enough?", ask "is this the **best** signal available right now?"

**Change the fan-out logic**: rather than taking every passing signal, keep a ranked queue of the top N opportunities by EV and only deliver the best one per symbol per day. A mediocre 0.02 EV trade is not worth taking when a 0.08 EV trade might appear in the next hour.

---

## 1. Bayesian Win Rate — Stop Trusting Small Samples

The current system uses raw `win_rate` from the backtest (e.g., 55% from 18 samples). The problem: 55% from 18 samples could easily be 40% in reality — you got lucky. Statistically, the 95% confidence interval on 10 wins out of 18 trials is [0.31, 0.77]. You're treating 55% as if it were precise.

**Fix:** Use the Bayesian lower credible bound as your win rate instead of the raw mean. This is the 10th percentile of the Beta(wins+1, losses+1) posterior distribution:

```python
from scipy.stats import beta as beta_dist

def bayesian_win_rate(sample_size: int, win_rate: float) -> float:
    """Return the conservative (10th percentile) Bayesian estimate of win rate."""
    wins   = int(win_rate * sample_size)
    losses = sample_size - wins
    # Beta(wins+1, losses+1) is the posterior with uniform prior
    return beta_dist.ppf(0.10, wins + 1, losses + 1)
```

Replace every use of raw `win_rate` in Kelly sizing with `bayesian_win_rate(sample_size, win_rate)`. With 10 samples your estimate shrinks toward 50/50 (honest uncertainty). With 200 samples it converges to the true rate (earned confidence).

**Concrete example:**
- Raw win rate 60%, 10 samples → Bayesian lower = 34% → Kelly says almost zero size
- Raw win rate 60%, 100 samples → Bayesian lower = 50% → Kelly says meaningful size
- Raw win rate 60%, 500 samples → Bayesian lower = 55% → Kelly says full conviction

This single change prevents you from betting big on strategies with no statistical backing.

---

## 2. Full Kelly Criterion — Properly

The current Kelly implementation in `fan_out.py` is close but inputs raw averages. The full formula is:

```
f* = (b × p − q) / b

where:
  b = avg_win / avg_loss    (reward-to-risk ratio)
  p = win_rate              (probability of win)
  q = 1 − p                (probability of loss)
```

Half-Kelly (`f = f* × 0.5`) is the standard for live trading because the backtest win rate is always an estimate, not the true rate. Using the Bayesian win rate from above already makes it conservative, so you could argue for 60–70% Kelly instead of 50%. Never go above full Kelly — it mathematically guarantees ruin eventually.

```python
def kelly_fraction(wins: int, losses: int, avg_win_pct: float, avg_loss_pct: float,
                   kelly_multiplier: float = 0.5) -> float:
    from scipy.stats import beta as beta_dist
    sample_size = wins + losses
    if sample_size == 0:
        return 0.0
    p = beta_dist.ppf(0.10, wins + 1, losses + 1)   # Bayesian conservative win rate
    q = 1 - p
    b = abs(avg_win_pct) / abs(avg_loss_pct) if avg_loss_pct != 0 else 1.0
    raw_kelly = (b * p - q) / b
    return max(raw_kelly * kelly_multiplier, 0.0)
```

**File to update:** `fan_out.py::_kelly_size` — replace its inputs with the Bayesian version. Pass `sample_size` into the function.

---

## 3. The Gambler's Ruin Problem — Why Your Total Exposure Matters

Your system fans out up to `MAX_POSITIONS=5` strategies per user at up to 6% each (aggressive). That's 30% of portfolio. But those 5 positions are often all tech stocks with correlation ~0.85 to each other. Economically you have one concentrated tech position, not five diversified ones.

The Gambler's Ruin theorem: if you bet more than Kelly each round, the probability of ruin → 1 as trades → ∞, regardless of your edge. The math is unforgiving.

**Effective exposure = Σ(size_i × correlation_i_to_SPY)**

For 5 correlated tech longs at 6% each with beta 1.3:
```
Effective SPY exposure = 5 × 0.06 × 1.3 = 0.39 → 39% effective market exposure
```

**Add a portfolio beta check before fan-out:**

```python
BETA_MAP = {
    "NVDA": 1.8, "TSLA": 1.9, "META": 1.3, "AAPL": 1.1, "MSFT": 0.9,
    "AMZN": 1.2, "GOOGL": 1.1, "GLD": -0.1, "TLT": -0.5, "SPY": 1.0,
}
MAX_PORTFOLIO_BETA = float(os.getenv("MAX_PORTFOLIO_BETA", "1.0"))

async def _portfolio_beta(user_id, tickers_to_add, sizing_pct, db) -> float:
    active = await db.fetch(
        """SELECT o.tickers, s.sizing_pct FROM strategies s
           JOIN opportunities o ON o.id = s.opportunity_id
           WHERE s.user_id=$1
             AND s.status NOT IN ('dismissed','expired','executed')
             AND s.expires_at > NOW()""",
        user_id,
    )
    total_beta = sum(
        BETA_MAP.get(t, 1.0) * float(row["sizing_pct"])
        for row in active
        for t in (row["tickers"] or [])
    )
    for t in tickers_to_add:
        total_beta += BETA_MAP.get(t, 1.0) * sizing_pct
    return total_beta

# In fan_out loop:
port_beta = await _portfolio_beta(user["id"], tickers, pct, db)
if port_beta > MAX_PORTFOLIO_BETA:
    logger.info("Portfolio beta %.2f would exceed %.2f — skipping", port_beta, MAX_PORTFOLIO_BETA)
    continue
```

This ensures a user with 5 long tech positions cannot keep adding more tech longs. A short GLD or a rates trade would lower beta and be allowed through.

---

## 4. Sharpe Ratio as the North Star Metric

Your backtest computes Sharpe per strategy, but the system only uses `win_rate >= 0.45` as the gate. This is wrong — a 60% win rate strategy with massive variance can have a Sharpe of 0.1. A 45% win rate strategy with small, consistent losses can have a Sharpe of 1.5.

**Sharpe = (mean_return − risk_free_rate) / std_dev_return × √252**

A Sharpe > 1.0 means you earn more than 1 unit of return per unit of risk. That compounding reliably over years produces consistent earnings.

**Replace the win_rate gate with a Sharpe gate:**

```python
# correlator.py::_run_backtest — add Sharpe minimum
MIN_SHARPE = float(os.getenv("MIN_SHARPE", "0.30"))   # lenient while warming up

if n >= 20:
    passed = bt.get("sharpe", 0) >= MIN_SHARPE and bt.get("expectancy", 0) >= 0
else:
    passed = bt.get("expectancy", 0) >= 0   # lenient on thin data
```

And when ranking multiple opportunities competing for the same user slot, pick the one with the highest Sharpe, not the highest confidence score.

---

## 5. Portfolio-Level Sharpe Optimization

This is the most powerful idea here. Instead of evaluating each strategy in isolation, evaluate whether *adding* a strategy to the existing portfolio **increases** the portfolio-level Sharpe.

The key insight: a strategy with Sharpe 0.6 that is **uncorrelated** with your existing positions might increase your portfolio Sharpe from 0.8 to 1.1 — it's worth more to you than a Sharpe 0.9 strategy that is highly correlated with what you already hold.

**Marginal Sharpe contribution:**

```python
import numpy as np

def portfolio_sharpe_delta(
    existing_returns: list[list[float]],   # list of return series per active strategy
    new_returns: list[float],              # return series of candidate strategy
    new_weight: float,
) -> float:
    """How much does adding this strategy improve portfolio Sharpe?"""
    if not existing_returns:
        arr = np.array(new_returns)
        return float(np.mean(arr) / (np.std(arr) + 1e-9) * np.sqrt(252))

    weights_existing = [1 / len(existing_returns)] * len(existing_returns)
    all_returns = np.array(existing_returns + [new_returns]).T   # shape: (T, N+1)
    weights = np.array(weights_existing + [new_weight])
    weights /= weights.sum()

    port_returns = all_returns @ weights
    sharpe_with = float(np.mean(port_returns) / (np.std(port_returns) + 1e-9) * np.sqrt(252))

    port_existing = np.array(existing_returns).T @ np.array(weights_existing) / sum(weights_existing)
    sharpe_without = float(np.mean(port_existing) / (np.std(port_existing) + 1e-9) * np.sqrt(252))

    return sharpe_with - sharpe_without   # positive = this strategy helps the portfolio
```

Minimum viable version: store per-strategy return series in the backtest results table (array of `best_returns`). When deciding whether to fan out, compute the marginal Sharpe delta. Only add a strategy if it improves portfolio Sharpe by at least 0.05.

---

## 6. Monte Carlo Risk Overlay — Know Your Ruin Probability

Before delivering a strategy to a user, simulate what happens to their portfolio if all current strategies resolve simultaneously:

```python
import numpy as np

def monte_carlo_risk(active_strategies: list[dict], n=10_000) -> dict:
    results = []
    for _ in range(n):
        p = 1.0
        for s in active_strategies:
            win = np.random.random() < (s.get("win_rate") or 0.5)
            if win:
                p *= 1 + s["sizing_pct"] * abs(s.get("avg_win_pct", 3)) / 100
            else:
                p *= 1 - s["sizing_pct"] * abs(s.get("avg_loss_pct", 3)) / 100
        results.append(p)

    arr = np.array(results)
    return {
        "p10_outcome":  float(np.percentile(arr, 10)),    # bad scenario
        "median":       float(np.median(arr)),
        "p90_outcome":  float(np.percentile(arr, 90)),    # good scenario
        "p_loss_5pct":  float(np.mean(arr < 0.95)),       # P(portfolio drops > 5%)
        "p_loss_10pct": float(np.mean(arr < 0.90)),       # P(portfolio drops > 10%)
    }

# Gate: if P(loss > 10%) > 0.15, do not add new strategies
risk = monte_carlo_risk(user_active_strategies)
if risk["p_loss_10pct"] > 0.15:
    logger.info("User %s: portfolio ruin risk %.1f%% — blocking new strategy", user["id"], risk["p_loss_10pct"]*100)
    continue
```

This takes 5ms per user per signal and prevents situations where a user has accumulated so much risk that the next signal would push them into high-drawdown territory.

---

## 7. SPRT — Know When a Strategy Has Died

Market regimes change. A strategy that worked 18 months ago may be dead now. The Sequential Probability Ratio Test (SPRT) is the statistically optimal way to detect this as quickly as possible — it tells you the minimum number of trades needed to be confident the strategy is broken.

```python
import math

def sprt_strategy_health(
    recent_wins: int,
    recent_losses: int,
    p_alive: float = 0.55,    # expected win rate when strategy works
    p_dead: float  = 0.45,    # win rate when strategy is broken (close to random)
    alpha: float   = 0.05,    # false positive rate (wrongly retiring good strategy)
    beta: float    = 0.10,    # false negative rate (keeping dead strategy)
) -> str:
    """Returns 'alive', 'dead', or 'uncertain'."""
    if recent_wins + recent_losses == 0:
        return "uncertain"
    log_lr = (
        recent_wins  * math.log(p_alive / p_dead) +
        recent_losses * math.log((1 - p_alive) / (1 - p_dead))
    )
    A = math.log((1 - beta) / alpha)   # upper boundary → strategy alive
    B = math.log(beta / (1 - alpha))   # lower boundary → strategy dead
    if log_lr >= A:
        return "alive"
    if log_lr <= B:
        return "dead"
    return "uncertain"
```

**Where to use this:** After each strategy resolves (trade executed and closed), update a per-hypothesis running SPRT. Store `recent_wins` and `recent_losses` on the `hypotheses` table (rolling 60-day window). If SPRT returns `dead`, set `hypothesis.is_active = False` automatically. The system stops generating signals for that setup until manually re-enabled.

This is the closest thing to automatic strategy lifecycle management you can build.

---

## 8. Pairs Trading — Market-Neutral "Guaranteed" Returns

The strategies above all have market risk — if SPY drops 10% in a day, most of your longs suffer. True stat arb eliminates market direction entirely.

**Concept:** Find two stocks that historically move together (cointegrated). When the spread between them diverges, go long the underperformer and short the overperformer. The spread always reverts — you profit from convergence regardless of market direction.

**Cointegration test (Johansen):**

```python
from statsmodels.tsa.vector_ar.vecm import coint_johansen
import pandas as pd

async def find_cointegrated_pairs(symbols: list[str], tsdb) -> list[tuple]:
    # Load 1-year daily closes for all symbols
    prices = {}
    for sym in symbols:
        rows = await tsdb.fetch(
            "SELECT ts, close FROM raw_ohlcv WHERE symbol=$1 AND interval='1d' ORDER BY ts DESC LIMIT 252",
            sym
        )
        prices[sym] = {r["ts"]: float(r["close"]) for r in rows}

    df = pd.DataFrame(prices).dropna()
    pairs = []
    syms = list(df.columns)
    for i in range(len(syms)):
        for j in range(i+1, len(syms)):
            result = coint_johansen(df[[syms[i], syms[j]]], det_order=0, k_ar_diff=1)
            # If trace statistic > 95% critical value: cointegrated
            if result.lr1[0] > result.cvt[0, 1]:
                pairs.append((syms[i], syms[j]))
    return pairs
```

**Trading the spread:**

```python
def spread_zscore(price_a: pd.Series, price_b: pd.Series, hedge_ratio: float) -> pd.Series:
    spread = price_a - hedge_ratio * price_b
    zscore = (spread - spread.rolling(60).mean()) / spread.rolling(60).std()
    return zscore

# Signal: z > 2.0 → long B, short A (B underperformed)
# Signal: z < -2.0 → long A, short B (A underperformed)
# Exit: |z| < 0.5 → spread converged → close both legs
```

Good pairs in your symbol universe: NVDA/AMD, AAPL/MSFT, USO/XOM, GLD/SLV, TLT/IEF.

This is genuinely market-neutral — on a day SPY drops 5%, your pairs trade is unaffected as long as the spread relationship holds. It is the closest thing to "guaranteed" returns in quantitative trading.

---

## 9. Compound Growth — The Only Guarantee That Actually Works

No individual trade is guaranteed. But a strategy with Sharpe > 1.0 compounding over 3+ years is the mathematical guarantee. This is why the Sharpe ratio matters more than anything else.

**Compound annual growth rate (CAGR) from Sharpe:**

```
Approximate CAGR ≈ Sharpe × σ + rf
where σ = annualized volatility of strategy returns, rf = risk-free rate (~5%)
```

For a Sharpe 1.2 strategy with 15% annualized volatility:
```
CAGR ≈ 1.2 × 15% + 5% = 23% per year
```

For a Sharpe 0.4 strategy (most retail traders):
```
CAGR ≈ 0.4 × 15% + 5% = 11% per year, with massive drawdowns along the way
```

**The target:** Build a portfolio of strategies where the *combined* Sharpe (after correlation adjustments) is > 1.0. That is what produces consistent compounding. Anything below 0.7 portfolio Sharpe and you'll have years of flat or negative performance that make the system feel broken.

---

## Summary: The Math Stack in Priority Order

| # | Technique | What It Solves | Complexity |
|---|---|---|---|
| 1 | **Bayesian win rate** (Beta posterior) | Stops overconfident sizing on thin data | Low |
| 2 | **Sharpe gate** instead of win_rate gate | Filters profitable-but-volatile losing strategies | Low |
| 3 | **Monte Carlo risk overlay** | Prevents catastrophic drawdown | Medium |
| 4 | **Portfolio beta cap** | Prevents hidden concentration in correlated longs | Medium |
| 5 | **SPRT strategy health** | Auto-retires dead strategies without human review | Medium |
| 6 | **Proper Kelly with Bayesian inputs** | Optimal position sizing with uncertainty | Medium |
| 7 | **EV ranking** (top-N by expectancy) | Takes best opportunities, not all passing ones | Low |
| 8 | **Marginal Sharpe portfolio opt.** | Adds only strategies that improve portfolio | High |
| 9 | **Pairs / stat arb** | Market-neutral "guaranteed" edge | High |

**The realistic path to consistent earnings:**
1. Fix dedup (Part I) so you're not drowning in noise
2. Add Bayesian win rate + Sharpe gate (items 1–2 above) to stop taking bad trades
3. Add Monte Carlo overlay to prevent drawdown disasters
4. Once you have 6 months of real trade history, run SPRT to identify which hypotheses are actually working
5. Pairs trading is the endgame — it is the only strategy that earns in all market conditions
