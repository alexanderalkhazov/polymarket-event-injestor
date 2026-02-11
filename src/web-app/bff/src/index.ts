import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import config from './config';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import exampleRoutes from './routes/example.routes';

const app = express();

/**
 * Middleware
 */
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

/**
 * Routes
 */
app.use('/api', exampleRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Polymarket BFF API',
    version: '1.0.0',
    status: 'healthy',
  });
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
