import app, { startBackgroundServices } from './app.js';
import { appConfig, validateConfig } from './config.js';
import { pool } from './db.js';
import { logger, serializeError } from './logger.js';
import { initializeBackendRuntime } from './runtime.js';
import { reportUncaughtException, reportUnhandledRejection } from './runtimeAlerts.js';
import { drainEmailRateLimiterForShutdown, stopEmailQueueWorker } from './services/emailQueueWorker.js';
import { websocketServer } from './services/websocketServer.js';
import { initializeModuleSystem } from './moduleInit.js';
import { stopAllSchedulers } from './services/schedulers.js';
import { stopTelegramBot } from './services/telegramBot.js';

validateConfig();
await initializeBackendRuntime();
await initializeModuleSystem();
startBackgroundServices();

const server = app.listen(appConfig.port, appConfig.host, () => {
    logger.info('Backend listening', {
        host: appConfig.host,
        port: appConfig.port,
    });
});

websocketServer.initialize(server);
let shutdownPromise: Promise<void> | null = null;

const closeServer = async () => {
    return Promise.race([
        new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        }),
        new Promise<void>((resolve) => {
            setTimeout(() => {
                logger.info('HTTP server close timeout, continuing');
                resolve();
            }, 2000);
        })
    ]);
};

const shutdown = async (signal: 'SIGINT' | 'SIGTERM') => {
    if (shutdownPromise) {
        return await shutdownPromise;
    }
    shutdownPromise = (async () => {
        logger.info('Shutdown signal received', { signal });

        try {
            // Stop accepting new connections
            logger.info('Closing HTTP server');
            const serverClosed = closeServer();

            // Stop background services
            logger.info('Stopping schedulers');
            stopAllSchedulers();

            logger.info('Stopping Telegram bot');
            await stopTelegramBot();

            logger.info('Stopping email queue worker');
            await stopEmailQueueWorker();

            // Close WebSocket connections
            logger.info('Closing WebSocket server');
            await websocketServer.close();

            // Wait for HTTP server to close
            logger.info('Waiting for HTTP server to close');
            await serverClosed;

            // Drain remaining tasks
            logger.info('Draining email rate limiter');
            await drainEmailRateLimiterForShutdown();

            // Close database pool
            logger.info('Closing database pool');
            await pool.end();

            logger.info('Graceful shutdown completed', { signal });
            process.exit(0);
        } catch (error) {
            logger.error('Error during shutdown', { error: serializeError(error) });
            throw error;
        }
    })().catch((error) => {
        logger.error('Graceful shutdown failed', {
            signal,
            error: serializeError(error),
        });
        process.exit(1);
    });
    return await shutdownPromise;
};

process.on('SIGINT', () => {
    void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
});
process.on('unhandledRejection', reason => {
    void reportUnhandledRejection(reason);
});
process.on('uncaughtException', error => {
    void reportUncaughtException(error);
});
