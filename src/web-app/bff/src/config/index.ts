import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  node_env: string;
  port: number;
  log_level: string;
  couchbase: {
    connection_string: string;
    username: string;
    password: string;
    bucket: string;
  };
  mongodb: {
    uri: string;
    db: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  ollama: {
    baseUrl: string;
    model: string;
  };
  api_timeout: number;
  ibkr: {
    base_url: string;
    paper: boolean;
    timeout_ms: number;
  };
  trading: {
    max_order_notional_usd: number;
    max_daily_loss_usd: number;
  };
}

const config: AppConfig = {
  node_env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  log_level: process.env.LOG_LEVEL || 'info',
  couchbase: {
    connection_string: process.env.COUCHBASE_CONNECTION_STRING || 'couchbase://localhost',
    username: process.env.COUCHBASE_USERNAME || 'Administrator',
    password: process.env.COUCHBASE_PASSWORD || 'password',
    bucket: process.env.COUCHBASE_BUCKET || 'polymarket',
  },
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
    db: process.env.MONGODB_DB || 'polymarket',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'tinyllama:1.1b',
  },
  api_timeout: parseInt(process.env.API_TIMEOUT || '30000', 10),
  ibkr: {
    base_url: process.env.IBKR_BASE_URL || 'http://localhost:5002/v1/api',
    paper: (process.env.IBKR_PAPER || 'true').toLowerCase() === 'true',
    timeout_ms: parseInt(process.env.IBKR_TIMEOUT_MS || '20000', 10),
  },
  trading: {
    max_order_notional_usd: parseFloat(process.env.MAX_ORDER_NOTIONAL_USD || '10000'),
    max_daily_loss_usd: parseFloat(process.env.MAX_DAILY_LOSS_USD || '1500'),
  },
};

export default config;
