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
    model: process.env.OLLAMA_MODEL || 'qwen2.5:1.5b',
  },
  api_timeout: parseInt(process.env.API_TIMEOUT || '30000', 10),
};

export default config;
