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
