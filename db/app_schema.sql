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
  onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
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

-- Users subscribe to market subcategories (e.g. equities_tech, crypto_defi).
-- The resolver expands these to the subscriptions table automatically.
CREATE TABLE market_category_subscriptions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, category)
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
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                    TEXT UNIQUE NOT NULL,
  description             TEXT NOT NULL,
  feature_conditions      JSONB NOT NULL,
  invalidation_conditions JSONB,
  target_symbol           TEXT,
  direction               TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  hold_days               INT NOT NULL DEFAULT 5,
  confidence_threshold    NUMERIC NOT NULL DEFAULT 0.65,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  version                 INT NOT NULL DEFAULT 1,
  -- SPRT health tracking: updated nightly by ai-correlator background task
  sprt_wins               INT NOT NULL DEFAULT 0,
  sprt_losses             INT NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  top_features            JSONB,
  macro_snapshot          JSONB,
  holding_period_optimal  TEXT,           -- "3d" | "5d" | "10d" from backtest
  embedding               vector(1536),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

-- ── Data lifecycle cleanup function ─────────────────────────────────────────
-- Called nightly by the feature-builder service.
-- Returns a JSON summary of rows deleted for observability.
CREATE OR REPLACE FUNCTION cleanup_old_data() RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_signals       INT;
  v_backtests     INT;
  v_opportunities INT;
  v_strategies    INT;
BEGIN
  -- 1. Signals older than 30 days that never became part of an opportunity
  DELETE FROM signals
  WHERE created_at < NOW() - INTERVAL '30 days'
    AND id NOT IN (
      SELECT UNNEST(signal_ids) FROM opportunities
    );
  GET DIAGNOSTICS v_signals = ROW_COUNT;

  -- 2. Dismissed / expired strategies older than 30 days
  --    (executed strategies kept for 180 days for trade history)
  DELETE FROM strategies
  WHERE status IN ('dismissed', 'expired')
    AND created_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS v_strategies = ROW_COUNT;

  -- 3. Backtest results older than 90 days not linked to any opportunity
  DELETE FROM backtest_results
  WHERE created_at < NOW() - INTERVAL '90 days'
    AND id NOT IN (
      SELECT backtest_id FROM opportunities WHERE backtest_id IS NOT NULL
    );
  GET DIAGNOSTICS v_backtests = ROW_COUNT;

  -- 4. Opportunities older than 180 days with no executed trade behind them
  DELETE FROM opportunities
  WHERE created_at < NOW() - INTERVAL '180 days'
    AND id NOT IN (
      SELECT opportunity_id FROM strategies
      WHERE status = 'executed'
    );
  GET DIAGNOSTICS v_opportunities = ROW_COUNT;

  RETURN jsonb_build_object(
    'signals_deleted',       v_signals,
    'strategies_deleted',    v_strategies,
    'backtests_deleted',     v_backtests,
    'opportunities_deleted', v_opportunities,
    'ran_at',                NOW()
  );
END;
$$;

-- ── Migration helpers (run manually if upgrading an existing DB) ─────────────
-- ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS sprt_wins    INT NOT NULL DEFAULT 0;
-- ALTER TABLE hypotheses ADD COLUMN IF NOT EXISTS sprt_losses  INT NOT NULL DEFAULT 0;
-- ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS holding_period_optimal TEXT;
