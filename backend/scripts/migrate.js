import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { appConfig, validateConfig } from '../src/config.js';
import { pool } from '../src/db.js';
const main = async () => {
    validateConfig();
    const migrationPath = resolve(process.cwd(), 'sql', '001_auth_rbac_bootstrap.sql');
    const sql = await readFile(migrationPath, 'utf8');
    const client = await pool.connect();
    try {
        await client.query('begin');
        await client.query(sql);
        await client.query('commit');
        console.log(`Migration applied: ${migrationPath}`);
    }
    catch (error) {
        await client.query('rollback');
        console.error('Migration failed', error);
        process.exitCode = 1;
    }
    finally {
        client.release();
        await pool.end();
    }
};
console.log(`Using database: ${appConfig.databaseUrl}`);
main().catch(error => {
    console.error(error);
    process.exit(1);
});
