import assert from 'node:assert/strict';
import test from 'node:test';

import { reportUncaughtException, reportUnhandledRejection } from '../src/runtimeAlerts.ts';

const createLoggerStub = () => {
  const entries: Array<{ message: string; meta?: Record<string, unknown> }> = [];

  return {
    entries,
    logger: {
      error: (message: string, meta?: Record<string, unknown>) => {
        entries.push({ message, meta });
      },
    },
  };
};

test('reportUnhandledRejection emits a runtime tracking event with serialized context', async () => {
  const { entries, logger } = createLoggerStub();
  const emitted: Array<Record<string, unknown>> = [];

  await reportUnhandledRejection(new Error('queue exploded'), {
    logger,
    emitAlert: async input => {
      emitted.push(input as unknown as Record<string, unknown>);
    },
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.message, 'Unhandled promise rejection');
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.type, 'runtime_unhandled_rejection');
  assert.equal((emitted[0]?.context as Record<string, unknown>)?.runtimeEvent, 'unhandledRejection');
});

test('reportUncaughtException waits for the alert flush before exiting', async () => {
  const { logger } = createLoggerStub();
  const exitCodes: number[] = [];
  let resolveAlert: (() => void) | undefined;

  const pendingAlert = new Promise<void>(resolve => {
    resolveAlert = resolve;
  });

  const handling = reportUncaughtException(new Error('fatal boom'), {
    logger,
    emitAlert: async () => pendingAlert,
    exit: code => {
      exitCodes.push(code);
    },
    flushTimeoutMs: 200,
  });

  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(exitCodes, []);

  resolveAlert?.();
  await handling;

  assert.deepEqual(exitCodes, [1]);
});

test('reportUncaughtException exits after the flush timeout when transport hangs', async () => {
  const { logger } = createLoggerStub();
  const exitCodes: number[] = [];

  const startedAt = Date.now();
  await reportUncaughtException(new Error('fatal timeout'), {
    logger,
    emitAlert: async () => new Promise<void>(() => {}),
    exit: code => {
      exitCodes.push(code);
    },
    flushTimeoutMs: 20,
  });

  assert.deepEqual(exitCodes, [1]);
  assert.ok(Date.now() - startedAt >= 20);
});
