import { Pool } from 'pg';
import { appConfig } from './config.js';
import { emitAlert } from './alerts.js';
import { logger, serializeError } from './logger.js';
export const pool = new Pool({
    connectionString: appConfig.databaseUrl,
});
const projectScopePool = appConfig.projectsDatabaseUrl
    ? new Pool({
        connectionString: appConfig.projectsDatabaseUrl,
    })
    : null;
export const hasProjectScopeDatabase = !!projectScopePool;
export const dbQuery = async (text, values = []) => {
    try {
        return await pool.query(text, values);
    }
    catch (error) {
        const operation = text.trim().split(/\s+/)[0]?.toUpperCase() ?? 'UNKNOWN';
        logger.error('Database query failed', {
            operation,
            error: serializeError(error),
        });
        void emitAlert({
            type: 'db_error',
            severity: 'critical',
            message: `Database query failed (${operation})`,
            dedupeKey: `db_error:${operation}`,
            context: {
                operation,
            },
        });
        throw error;
    }
};
export const projectScopeQuery = async (text, values = []) => {
    if (!projectScopePool) {
        throw new Error('PROJECT_SCOPE_DB_NOT_CONFIGURED');
    }
    try {
        return await projectScopePool.query(text, values);
    }
    catch (error) {
        const operation = text.trim().split(/\s+/)[0]?.toUpperCase() ?? 'UNKNOWN';
        logger.error('Project-scope database query failed', {
            operation,
            error: serializeError(error),
        });
        void emitAlert({
            type: 'db_error',
            severity: 'high',
            message: `Project-scope database query failed (${operation})`,
            dedupeKey: `db_error:project_scope:${operation}`,
            context: {
                operation,
            },
        });
        throw error;
    }
};
export const withTx = async (handler) => {
    const client = await pool.connect();
    try {
        await client.query('begin');
        const result = await handler(client);
        await client.query('commit');
        return result;
    }
    catch (error) {
        logger.error('Database transaction failed', {
            error: serializeError(error),
        });
        void emitAlert({
            type: 'db_error',
            severity: 'critical',
            message: 'Database transaction failed',
            dedupeKey: 'db_error:transaction',
        });
        await client.query('rollback');
        throw error;
    }
    finally {
        client.release();
    }
};
export const checkDatabaseReady = async () => {
    try {
        await pool.query('select 1');
        return true;
    }
    catch (error) {
        logger.error('Database readiness check failed', {
            error: serializeError(error),
        });
        return false;
    }
};
