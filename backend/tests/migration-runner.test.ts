import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MIGRATIONS_TABLE,
  MIGRATION_FILENAME_PATTERN,
  loadMigrationFiles,
} from '../scripts/migrationRunner.ts';

const backendRoot = path.resolve(new URL('..', import.meta.url).pathname);

test('loadMigrationFiles returns versioned SQL files in lexical order', async () => {
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'novin-migrations-'));

  try {
    await writeFile(path.join(fixtureDir, '010_last.sql'), 'select 10;');
    await writeFile(path.join(fixtureDir, '002_middle.sql'), 'select 2;');
    await writeFile(path.join(fixtureDir, '001_first.sql'), 'select 1;');
    await writeFile(path.join(fixtureDir, 'notes.txt'), 'ignored');

    const migrations = await loadMigrationFiles(fixtureDir);

    assert.deepEqual(
      migrations.map(migration => migration.version),
      ['001_first.sql', '002_middle.sql', '010_last.sql'],
    );
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test('project SQL migrations stay explicitly versioned', async () => {
  const migrations = await loadMigrationFiles(path.join(backendRoot, 'sql'));

  assert.equal(MIGRATIONS_TABLE, 'app_schema_migrations');
  assert.ok(migrations.length >= 2, 'expected at least bootstrap and runtime migrations');
  assert.deepEqual(
    migrations.slice(0, 2).map(migration => migration.version),
    ['001_auth_rbac_bootstrap.sql', '002_runtime_schema_changes.sql'],
  );

  for (const migration of migrations) {
    assert.match(migration.version, MIGRATION_FILENAME_PATTERN);
  }
});
