import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const backendRoot = path.resolve(new URL('..', import.meta.url).pathname);

const readBackendFile = async (relativePath: string) =>
  readFile(path.join(backendRoot, relativePath), 'utf8');

test('server initializes runtime schemas before opening the HTTP listener', async () => {
  const serverSource = await readBackendFile('src/server.ts');
  const initializeIndex = serverSource.indexOf('await initializeBackendRuntime()');
  const backgroundIndex = serverSource.indexOf('startBackgroundServices()');
  const listenIndex = serverSource.indexOf('app.listen(');

  assert.notEqual(initializeIndex, -1, 'server should await runtime initialization');
  assert.notEqual(backgroundIndex, -1, 'server should start background services explicitly');
  assert.notEqual(listenIndex, -1, 'server should start the HTTP listener');
  assert.ok(initializeIndex < backgroundIndex, 'runtime init must happen before background services');
  assert.ok(backgroundIndex < listenIndex, 'background services should start before listen returns');
});

test('runtime bootstrap covers request-path schemas that previously initialized lazily', async () => {
  const runtimeSource = await readBackendFile('src/runtime.ts');

  for (const initializerName of [
    'ensureAccessRequestSchema',
    'ensureCalendarSchema',
    'ensureContractSchema',
    'ensureSppzJournalSchema',
    'ensureTicketClientNotificationSchema',
    'ensureUploadedFileSchema',
  ]) {
    assert.match(
      runtimeSource,
      new RegExp(`\\b${initializerName}\\b`),
      `runtime bootstrap should include ${initializerName}`,
    );
  }
});
