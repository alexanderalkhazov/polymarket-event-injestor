import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const serviceName = process.env.SERVICE_NAME || 'polymarket-bff';

let loggingInitialized = false;
let minimumLevel: LogLevel = 'info';

const normalizeLevel = (level: string | undefined): LogLevel => {
  const value = (level || 'info').toLowerCase();
  if (value === 'debug' || value === 'warn' || value === 'error') {
    return value;
  }
  return 'info';
};

const shouldLog = (level: LogLevel): boolean => {
  return levelRank[level] >= levelRank[minimumLevel];
};

const serializeArg = (arg: unknown): unknown => {
  if (arg instanceof Error) {
    return {
      name: arg.name,
      message: arg.message,
      stack: arg.stack,
    };
  }

  if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean' || arg === null) {
    return arg;
  }

  return arg;
};

const emit = (level: LogLevel, args: unknown[]): void => {
  if (!shouldLog(level)) {
    return;
  }

  const timestamp = new Date().toISOString();
  const payload = {
    timestamp,
    level: level.toUpperCase(),
    service: serviceName,
    message: args.map(serializeArg),
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
};

export const setupLogging = (): void => {
  if (loggingInitialized) {
    return;
  }

  loggingInitialized = true;
  minimumLevel = normalizeLevel(process.env.LOG_LEVEL);

  console.log = (...args: unknown[]) => emit('info', args);
  console.info = (...args: unknown[]) => emit('info', args);
  console.warn = (...args: unknown[]) => emit('warn', args);
  console.error = (...args: unknown[]) => emit('error', args);
  console.debug = (...args: unknown[]) => emit('debug', args);
};

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();
  (req as Request & { requestId?: string }).requestId = requestId;
  res.setHeader('x-request-id', requestId);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.info({
      event: 'http_request',
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      remoteAddress: req.ip,
    });
  });

  next();
};
