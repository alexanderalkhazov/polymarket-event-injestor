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
  alpaca_key_id         TEXT,
  alpaca_secret         TEXT,
  is_paper              BOOLEAN NOT NULL DEFAULT TRUE,
  onboarding_complete   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE signals (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source        TEXT NOT NULL CHECK (source IN ('polymarket', 'news', 'analytics')),
  symbol        TEXT NOT NULL,
  tickers       TEXT[] NOT NULL DEFAULT '{}',
  type          TEXT NOT NULL,
  score         NUMERIC NOT NULL,
  direction     TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'processing', 'processed', 'dropped')),
  pipeline_step INT NOT NULL DEFAULT 0,
  payload       JSONB NOT NULL DEFAULT '{}',
  embedding     vector(384),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX signals_created_at    ON signals (created_at DESC);
CREATE INDEX signals_source_symbol ON signals (source, symbol);
CREATE INDEX signals_embedding_idx ON signals
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE TABLE backtest_results (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_ids         UUID[] NOT NULL,
  strategy_name      TEXT NOT NULL,
  signal_type        TEXT,
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
  embedding           vector(384),
  raw_response        JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX opportunities_embedding_idx ON opportunities
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE TABLE opportunities_signals (
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  signal_id      UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  PRIMARY KEY (opportunity_id, signal_id)
);

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
  executed_at      TIMESTAMPTZ,
  filled_at        TIMESTAMPTZ
);

CREATE TABLE positions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol           TEXT NOT NULL,
  qty              NUMERIC NOT NULL,
  avg_entry_price  NUMERIC NOT NULL,
  current_price    NUMERIC,
  market_value     NUMERIC,
  unrealized_pl    NUMERIC,
  unrealized_plpc  NUMERIC,
  side             TEXT NOT NULL DEFAULT 'long' CHECK (side IN ('long', 'short')),
  is_paper         BOOLEAN NOT NULL DEFAULT TRUE,
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at        TIMESTAMPTZ,
  realized_pnl     NUMERIC,
  UNIQUE (user_id, symbol, is_paper)
);
