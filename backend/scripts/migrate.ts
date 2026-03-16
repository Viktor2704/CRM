import { appConfig, validateConfig } from '../src/config.js';
import { redactDatabaseUrl } from '../src/env.js';
import { pool } from '../src/db.js';
import { applyPendingMigrations } from './migrationRunner.js';

const main = async () => {
  validateConfig();
  const client = await pool.connect();

  try {
    const result = await applyPendingMigrations(client);

    if (result.applied.length === 0) {
      console.log(`No pending migrations in ${result.migrationsDir}`);
      return;
    }

    for (const migration of result.applied) {
      console.log(`Migration applied: ${migration.path}`);
    }
  } catch (error) {
    console.error('Migration failed', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
};

console.log(`Using database: ${redactDatabaseUrl(appConfig.databaseUrl)}`);
main().catch(error => {
  console.error(error);
  process.exit(1);
});
