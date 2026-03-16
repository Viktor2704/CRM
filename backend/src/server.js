import app from './app.js';
import { appConfig, validateConfig } from './config.js';
import { pool } from './db.js';
import { emitAlert } from './alerts.js';
import { logger, serializeError } from './logger.js';
validateConfig();
const server = app.listen(appConfig.port, () => {
    logger.info('Backend listening', {
        port: appConfig.port,
    });
});
const shutdown = async () => {
    logger.info('Shutdown signal received');
    server.close(async () => {
        await pool.end();
        logger.info('HTTP server stopped');
        process.exit(0);
    });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', reason => {
    logger.error('Unhandled promise rejection', {
        error: serializeError(reason),
    });
    void emitAlert({
        type: 'http_5xx',
        severity: 'critical',
        message: 'Unhandled promise rejection',
        dedupeKey: 'runtime:unhandled_rejection',
    });
});
process.on('uncaughtException', error => {
    logger.error('Uncaught exception', {
        error: serializeError(error),
    });
    void emitAlert({
        type: 'http_5xx',
        severity: 'critical',
        message: 'Uncaught exception',
        dedupeKey: 'runtime:uncaught_exception',
    });
    process.exit(1);
});
