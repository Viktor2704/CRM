import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createMetricsRegistry } from '../src/metrics.js';
import { registerHealthRoutes } from '../src/routes/health.js';

const createResponse = () => ({
  body: undefined as any,
  headers: {} as Record<string, string>,
  statusCode: 200,
  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  },
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(payload: unknown) {
    this.body = payload;
    return this;
  },
  send(payload: unknown) {
    this.body = payload;
    return this;
  },
});

test('metrics registry exports Prometheus counters and skips self-scrapes', () => {
  const timestamps = [1_000, 1_250, 2_000, 2_500];
  const metricsRegistry = createMetricsRegistry({
    startedAtMs: 500,
    nowMs: () => timestamps.shift() ?? 2_500,
    uptimeSeconds: () => 42.5,
    cpuUsage: () => ({ user: 900_000, system: 300_000 }),
    memoryUsage: () => ({
      rss: 11,
      heapTotal: 22,
      heapUsed: 33,
      external: 44,
      arrayBuffers: 55,
    }),
  });

  const trackedResponse = new EventEmitter() as EventEmitter & { statusCode: number };
  trackedResponse.statusCode = 204;

  let nextCalled = false;
  metricsRegistry.middleware({
    method: 'get',
    path: '/health',
    baseUrl: '',
    route: { path: '/health' },
  }, trackedResponse, () => {
    nextCalled = true;
  });

  trackedResponse.emit('finish');

  const skippedResponse = new EventEmitter() as EventEmitter & { statusCode: number };
  skippedResponse.statusCode = 200;
  metricsRegistry.middleware({
    method: 'get',
    path: '/metrics',
    baseUrl: '',
    route: { path: '/metrics' },
  }, skippedResponse, () => {});
  skippedResponse.emit('finish');

  assert.equal(nextCalled, true);

  const rendered = metricsRegistry.renderMetrics('novinzhstroy-backend');

  assert.match(rendered, /novin_app_info\{service="novinzhstroy-backend"\} 1/);
  assert.match(rendered, /novin_app_process_uptime_seconds 42\.500/);
  assert.match(rendered, /novin_app_process_cpu_seconds_total\{type="user"\} 0\.900000/);
  assert.match(rendered, /novin_app_process_memory_bytes\{type="heap_used"\} 33/);
  assert.match(rendered, /novin_app_http_requests_total\{method="GET",route="\/health",status="204"\} 1/);
  assert.match(rendered, /novin_app_http_request_duration_seconds_sum\{method="GET",route="\/health"\} 0\.250000/);
  assert.doesNotMatch(rendered, /route="\/metrics"/);
  assert.equal(metricsRegistry.getSnapshot().inFlightRequests, 0);
});

test('registerHealthRoutes exposes /metrics with Prometheus content type', async () => {
  const handlers = new Map<string, (request: any, response: any) => Promise<void> | void>();
  const metricsRegistry = createMetricsRegistry({
    startedAtMs: 0,
    nowMs: () => 0,
    uptimeSeconds: () => 5,
    cpuUsage: () => ({ user: 0, system: 0 }),
    memoryUsage: () => ({
      rss: 1,
      heapTotal: 2,
      heapUsed: 3,
      external: 4,
      arrayBuffers: 5,
    }),
  });

  const app = {
    get(path: string, ...routeHandlers: Array<(request: any, response: any) => Promise<void> | void>) {
      handlers.set(`GET ${path}`, routeHandlers.at(-1)!);
    },
  };

  registerHealthRoutes({
    app,
    appConfig: { serviceName: 'novinzhstroy-backend' },
    localMockAuthEnabled: false,
    requireAuth: (_request: any, _response: any, next: () => void) => next(),
    asyncHandler: <T extends (request: any, response: any) => Promise<void>>(handler: T) => handler,
    checkDatabaseReady: async () => true,
    emitAlert: async () => {},
    metricsRegistry,
  });

  const metricsHandler = handlers.get('GET /metrics');
  assert.ok(metricsHandler, 'GET /metrics should be registered');

  const response = createResponse();
  await metricsHandler!({}, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], metricsRegistry.contentType);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(String(response.body), /# TYPE novin_app_http_requests_total counter/);
});
