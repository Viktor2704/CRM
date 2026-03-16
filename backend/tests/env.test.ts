import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadBackendEnv, redactDatabaseUrl } from '../src/env.ts';

const makeTempDir = async () => mkdtemp(path.join(os.tmpdir(), 'novin-backend-env-'));

test('prefers local .env and skips fallback when required values are already loaded', async () => {
  const tempDir = await makeTempDir();

  try {
    await writeFile(
      path.join(tempDir, '.env'),
      'DATABASE_URL=postgres://local-db\nJWT_ACCESS_SECRET=local-secret\n',
      'utf8',
    );

    const fallbackEnvFile = path.join(tempDir, 'backend.env');
    await writeFile(
      fallbackEnvFile,
      'DATABASE_URL=postgres://fallback-db\nJWT_ACCESS_SECRET=fallback-secret\n',
      'utf8',
    );

    const env: NodeJS.ProcessEnv = {};
    const loadedEnvFiles = loadBackendEnv({
      cwd: tempDir,
      env,
      fallbackEnvFiles: [fallbackEnvFile],
    });

    assert.deepEqual(loadedEnvFiles, [path.join(tempDir, '.env')]);
    assert.equal(env.DATABASE_URL, 'postgres://local-db');
    assert.equal(env.JWT_ACCESS_SECRET, 'local-secret');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('loads fallback env file when local .env is absent', async () => {
  const tempDir = await makeTempDir();

  try {
    const fallbackEnvFile = path.join(tempDir, 'backend.env');
    await writeFile(
      fallbackEnvFile,
      'DATABASE_URL=postgres://prod-db\nJWT_ACCESS_SECRET=prod-secret\n',
      'utf8',
    );

    const env: NodeJS.ProcessEnv = {};
    const loadedEnvFiles = loadBackendEnv({
      cwd: tempDir,
      env,
      fallbackEnvFiles: [fallbackEnvFile],
    });

    assert.deepEqual(loadedEnvFiles, [fallbackEnvFile]);
    assert.equal(env.DATABASE_URL, 'postgres://prod-db');
    assert.equal(env.JWT_ACCESS_SECRET, 'prod-secret');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('redacts passwords in database urls before logging', () => {
  const redacted = redactDatabaseUrl('postgres://novin_user:super-secret@127.0.0.1:5432/novinzhstroy');

  assert.equal(redacted, 'postgres://novin_user:***@127.0.0.1:5432/novinzhstroy');
});
