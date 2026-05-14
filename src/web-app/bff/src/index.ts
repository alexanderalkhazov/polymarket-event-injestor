import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import config from './config';
import { connectDB } from './db';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import exampleRoutes from './routes/example.routes';
import authRoutes from './routes/auth.routes';
import chatRoutes from './routes/chat.routes';
import tradingRoutes from './routes/trading.routes';
import ibRoutes from './routes/ib.routes';
import subscriptionRoutes from './routes/subscription.routes';
import polymarketSubscriptionRoutes from './routes/polymarket-subscription.routes';
import { requestLogger, setupLogging } from './logger/pro';
import { httpRequestDurationSeconds, httpRequestsTotal, normalizeRoutePath, registry } from './observability/metrics';

const app = express();

setupLogging();

/**
 * Database Connection
 */
connectDB();

/**
 * Middleware
 */
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use((req, res, next) => {
  const route = normalizeRoutePath(req.path || '/');
  const stopTimer = httpRequestDurationSeconds.startTimer({ method: req.method, route });
  res.on('finish', () => {
    const statusCode = String(res.statusCode);
    httpRequestsTotal.inc({ method: req.method, route, status_code: statusCode });
    stopTimer({ status_code: statusCode });
  });
  next();
});

/**
 * Routes
 */
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/trading', tradingRoutes);
app.use('/api/ib', ibRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/polymarket-subscription', polymarketSubscriptionRoutes);
app.use('/api', exampleRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Polymarket BFF API',
    version: '1.0.0',
    status: 'healthy',
  });
});

app.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});

/**
 * Error Handling
 */
app.use(notFoundHandler);
app.use(errorHandler);

/**
 * Start Server
 */
const PORT = config.port;
const server = app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Environment: ${config.node_env}`);
  console.log(`✓ Log level: ${config.log_level}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

export default app;
