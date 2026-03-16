import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { PoolClient } from 'pg';

export const MIGRATIONS_TABLE = 'app_schema_migrations';
export const MIGRATION_FILENAME_PATTERN = /^\d+_[a-z0-9][a-z0-9_.-]*\.sql$/i;

const MIGRATION_LOCK_KEY = '2503202601';

export type MigrationFile = {
  version: string;
  path: string;
  sql: string;
};

const defaultMigrationsDir = fileURLToPath(new URL('../sql', import.meta.url));

const toSortedMigrationNames = (fileNames: string[]) =>
  [...fileNames]
    .filter(fileName => MIGRATION_FILENAME_PATTERN.test(fileName))
    .sort((left, right) => left.localeCompare(right));

export const loadMigrationFiles = async (migrationsDir = defaultMigrationsDir): Promise<MigrationFile[]> => {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrationNames = toSortedMigrationNames(
    entries.filter(entry => entry.isFile()).map(entry => entry.name),
  );

  return Promise.all(
    migrationNames.map(async version => ({
      version,
      path: path.join(migrationsDir, version),
      sql: await readFile(path.join(migrationsDir, version), 'utf8'),
    })),
  );
};

const ensureMigrationsTable = async (client: Pick<PoolClient, 'query'>) => {
  await client.query(`
    create table if not exists app_schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);
};

const getAppliedMigrationVersions = async (client: Pick<PoolClient, 'query'>) => {
  const result = await client.query(`select version from ${MIGRATIONS_TABLE} order by version asc`);
  return new Set(result.rows.map(row => String(row.version)));
};

const applyMigration = async (client: Pick<PoolClient, 'query'>, migration: MigrationFile) => {
  await client.query('begin');

  try {
    await client.query(migration.sql);
    await client.query(
      `insert into ${MIGRATIONS_TABLE}(version) values ($1) on conflict (version) do nothing`,
      [migration.version],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
};

export const applyPendingMigrations = async (
  client: Pick<PoolClient, 'query'>,
  migrationsDir = defaultMigrationsDir,
) => {
  await client.query('select pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY]);

  try {
    await ensureMigrationsTable(client);

    const migrationFiles = await loadMigrationFiles(migrationsDir);
    const appliedVersions = await getAppliedMigrationVersions(client);
    const pendingMigrations = migrationFiles.filter(
      migration => !appliedVersions.has(migration.version),
    );

    for (const migration of pendingMigrations) {
      await applyMigration(client, migration);
    }

    return {
      migrationsDir,
      applied: pendingMigrations,
    };
  } finally {
    await client.query('select pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]);
  }
};
