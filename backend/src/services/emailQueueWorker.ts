import { logger, serializeError } from '../logger.js';
import { getEmailRateLimitSnapshot, stopEmailRateLimiter } from './emailRateLimiter.js';
import { loadPendingEmailQueueBatch, processEmailQueueRecord, refreshEmailQueueMetrics } from './emailQueueService.js';

const EMAIL_QUEUE_WORKER_INTERVAL_MS = 5000;
const EMAIL_QUEUE_BATCH_SIZE = 10;
const EMAIL_RATE_LIMITER_SHUTDOWN_TIMEOUT_MS = 30_000;

let emailQueueWorkerTimer: NodeJS.Timeout | null = null;
let emailQueueWorkerInFlight: Promise<number> | null = null;

export const runEmailQueueWorkerTick = async () => {
    if (emailQueueWorkerInFlight) {
        return await emailQueueWorkerInFlight;
    }
    emailQueueWorkerInFlight = (async () => {
        const rows = await loadPendingEmailQueueBatch(EMAIL_QUEUE_BATCH_SIZE);
        for (const row of rows) {
            await processEmailQueueRecord(row);
        }
        await refreshEmailQueueMetrics();
        return rows.length;
    })().catch((error) => {
        logger.error('Email queue worker tick failed', {
            error: serializeError(error),
        });
        throw error;
    }).finally(() => {
        emailQueueWorkerInFlight = null;
    });
    return await emailQueueWorkerInFlight;
};

export const startEmailQueueWorker = () => {
    if (emailQueueWorkerTimer) {
        return;
    }
    void runEmailQueueWorkerTick().catch(() => { });
    emailQueueWorkerTimer = setInterval(() => {
        void runEmailQueueWorkerTick().catch(() => { });
    }, EMAIL_QUEUE_WORKER_INTERVAL_MS);
    if (typeof emailQueueWorkerTimer.unref === 'function') {
        emailQueueWorkerTimer.unref();
    }
    logger.info('Email queue worker started', {
        intervalMs: EMAIL_QUEUE_WORKER_INTERVAL_MS,
        batchSize: EMAIL_QUEUE_BATCH_SIZE,
    });
};

export const stopEmailQueueWorker = async () => {
    if (emailQueueWorkerTimer) {
        clearInterval(emailQueueWorkerTimer);
        emailQueueWorkerTimer = null;
    }
    if (emailQueueWorkerInFlight) {
        await emailQueueWorkerInFlight.catch(() => { });
    }
};

export const drainEmailRateLimiterForShutdown = async () => {
    const drained = await stopEmailRateLimiter(EMAIL_RATE_LIMITER_SHUTDOWN_TIMEOUT_MS);
    if (!drained) {
        const snapshot = getEmailRateLimitSnapshot();
        logger.warn('Email rate limiter did not drain completely before shutdown', {
            timeoutMs: EMAIL_RATE_LIMITER_SHUTDOWN_TIMEOUT_MS,
            totalQueued: snapshot.totalQueued,
            totalRunning: snapshot.totalRunning,
            oldestQueuedAgeMs: snapshot.oldestQueuedAgeMs,
            globalQueue: snapshot.global,
            perDomainQueue: snapshot.perDomain,
        });
    }
};
