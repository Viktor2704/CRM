import assert from 'node:assert/strict';
import test from 'node:test';

import { appConfig } from '../src/config.ts';
import { logger } from '../src/logger.ts';
import { appMetrics } from '../src/metrics.ts';
import {
  __emailRateLimiterTestUtils,
  getEmailRateLimitSnapshot,
  rateLimitEmailSend,
  stopEmailRateLimiter,
} from '../src/services/emailRateLimiter.ts';

const wait = async (delayMs: number) => {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const originalRateLimitConfig = {
  emailRateLimitMaxConcurrent: appConfig.emailRateLimitMaxConcurrent,
  emailRateLimitMinTimeMs: appConfig.emailRateLimitMinTimeMs,
};

const originalLoggerWarn = logger.warn;

test.afterEach(() => {
  appConfig.emailRateLimitMaxConcurrent = originalRateLimitConfig.emailRateLimitMaxConcurrent;
  appConfig.emailRateLimitMinTimeMs = originalRateLimitConfig.emailRateLimitMinTimeMs;
  logger.warn = originalLoggerWarn;
  __emailRateLimiterTestUtils.reset();
});

test('email rate limiter tracks per-domain queue stats and Prometheus gauges', async () => {
  let releaseSend: (() => void) | null = null;
  const sendGate = new Promise<void>((resolve) => {
    releaseSend = resolve;
  });

  appConfig.emailRateLimitMaxConcurrent = 5;
  appConfig.emailRateLimitMinTimeMs = 1;
  __emailRateLimiterTestUtils.reset();

  const firstSend = rateLimitEmailSend('first@example.com', async () => {
    await sendGate;
    return 'first';
  });
  const secondSend = rateLimitEmailSend('second@example.com', async () => {
    await sendGate;
    return 'second';
  });

  await wait(20);

  const snapshotWhileQueued = getEmailRateLimitSnapshot();
  assert.equal(snapshotWhileQueued.perDomain.queued, 1);
  assert.equal(snapshotWhileQueued.totalQueued, 1);
  assert.ok(snapshotWhileQueued.totalRunning >= 1);
  assert.ok(snapshotWhileQueued.oldestQueuedAgeMs >= 0);

  const renderedMetrics = appMetrics.renderMetrics('novinzhstroy-backend');
  assert.match(
    renderedMetrics,
    /novin_app_email_rate_limit_queue_size\{limit_type="per_domain",state="queued"\} 1/,
  );

  releaseSend?.();

  const results = await Promise.all([firstSend, secondSend]);
  assert.deepEqual(results, ['first', 'second']);

  const snapshotAfterDrain = getEmailRateLimitSnapshot();
  assert.equal(snapshotAfterDrain.totalQueued, 0);
  assert.equal(snapshotAfterDrain.perDomain.done, 2);
});

test('email rate limiter warns when backlog exceeds 50 queued emails', async () => {
  let releaseSend: (() => void) | null = null;
  const sendGate = new Promise<void>((resolve) => {
    releaseSend = resolve;
  });
  const warnings: Array<{ message: string; meta: Record<string, unknown> }> = [];

  appConfig.emailRateLimitMaxConcurrent = 1;
  appConfig.emailRateLimitMinTimeMs = 1;
  __emailRateLimiterTestUtils.reset();

  logger.warn = ((message: string, meta?: Record<string, unknown>) => {
    warnings.push({ message, meta: meta ?? {} });
  }) as typeof logger.warn;

  const sends = Array.from({ length: 52 }, (_, index) => {
    return rateLimitEmailSend(`user${index}@domain${index}.example`, async () => {
      await sendGate;
      return index;
    });
  });

  await wait(20);

  const backlogWarning = warnings.find((entry) => entry.message === 'Email rate limiter backlog is high');
  assert.ok(backlogWarning);
  assert.equal(backlogWarning?.meta.warningThreshold, 50);
  assert.ok(Number(backlogWarning?.meta.totalQueued ?? 0) >= 51);
  assert.ok(typeof backlogWarning?.meta.oldestQueuedAgeMs === 'number');
  assert.equal(typeof backlogWarning?.meta.oldestQueuedAgeSeconds, 'number');
  assert.ok(Array.isArray(backlogWarning?.meta.queuedDomains));
  assert.equal((backlogWarning?.meta.queuedDomains as Array<unknown>).length, 5);
  for (const queuedDomain of backlogWarning?.meta.queuedDomains as Array<{ domain: string; queued: number }>) {
    assert.equal(typeof queuedDomain.domain, 'string');
    assert.equal(queuedDomain.queued, 1);
  }

  releaseSend?.();

  const results = await Promise.all(sends);
  assert.equal(results.length, 52);
});

test('email rate limiter drains queued work on stop and rejects new jobs afterwards', async () => {
  let releaseSend: (() => void) | null = null;
  const sendGate = new Promise<void>((resolve) => {
    releaseSend = resolve;
  });

  appConfig.emailRateLimitMaxConcurrent = 1;
  appConfig.emailRateLimitMinTimeMs = 1;
  __emailRateLimiterTestUtils.reset();

  const firstSend = rateLimitEmailSend('first@example.com', async () => {
    await sendGate;
    return 'first';
  });
  const secondSend = rateLimitEmailSend('second@example.org', async () => {
    await sendGate;
    return 'second';
  });

  await wait(20);

  const stopPromise = stopEmailRateLimiter(1_000);
  await wait(20);
  releaseSend?.();

  assert.equal(await stopPromise, true);
  assert.deepEqual(await Promise.all([firstSend, secondSend]), ['first', 'second']);

  await assert.rejects(
    rateLimitEmailSend('third@example.net', async () => 'third'),
    /Email rate limiter is shutting down/,
  );
});
