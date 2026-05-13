import * as promClient from 'prom-client';

export const registry = new promClient.Registry();

promClient.collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new promClient.Counter({
  name: 'bff_http_requests_total',
  help: 'Total HTTP requests handled by the BFF',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

export const httpRequestDurationSeconds = new promClient.Histogram({
  name: 'bff_http_request_duration_seconds',
  help: 'HTTP request duration in seconds for the BFF',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export function normalizeRoutePath(path: string): string {
  const compact = path.replace(/\d+/g, ':id');
  return compact.length > 80 ? compact.slice(0, 80) : compact;
}