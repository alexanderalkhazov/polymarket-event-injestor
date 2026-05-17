CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Raw source tables (append-only, used to recompute features if logic changes)

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

-- Pre-computed technical indicators (written nightly by historical ingestor)
CREATE TABLE technicals (
  ts          TIMESTAMPTZ NOT NULL,
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
  PRIMARY KEY (ts, symbol, interval)
);
SELECT create_hypertable('technicals', 'ts');

-- THE FEATURE STORE — one row per symbol per hour, every known feature.
-- forward_return_Nd columns are NULL on live rows, filled nightly by label_filler.
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

  -- Social features (placeholder)
  social_sentiment_z        NUMERIC,

  -- Outcome labels (filled nightly for rows >= hold_days old)
  forward_return_1d         NUMERIC,
  forward_return_5d         NUMERIC,
  forward_return_10d        NUMERIC,
  label_filled_at           TIMESTAMPTZ,

  PRIMARY KEY (ts, symbol)
);
SELECT create_hypertable('features', 'ts');
CREATE INDEX features_symbol    ON features (symbol, ts DESC);
CREATE INDEX features_unlabeled ON features (ts) WHERE forward_return_5d IS NULL;

-- Compress features older than 7 days (~90% disk savings)
ALTER TABLE features SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol'
);
SELECT add_compression_policy('features', INTERVAL '7 days');

-- Compress raw_ohlcv older than 7 days
ALTER TABLE raw_ohlcv SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol'
);
SELECT add_compression_policy('raw_ohlcv', INTERVAL '7 days');
