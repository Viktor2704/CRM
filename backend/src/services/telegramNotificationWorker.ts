import { logger, serializeError } from '../logger.js';
import { loadPendingTelegramNotificationsBatch, processTelegramNotificationRecord } from './telegramNotifier.js';

const TELEGRAM_NOTIFICATION_WORKER_INTERVAL_MS = 5000;

let telegramNotificationWorkerTimer: NodeJS.Timeout | null = null;
let telegramNotificationWorkerPromise: Promise<number> | null = null;

export const runTelegramNotificationWorkerTick = async () => {
    if (telegramNotificationWorkerPromise) {
        return await telegramNotificationWorkerPromise;
    }
    telegramNotificationWorkerPromise = (async () => {
        const rows = await loadPendingTelegramNotificationsBatch();
        for (const row of rows) {
            await processTelegramNotificationRecord(row);
        }
        return rows.length;
    })().catch((error) => {
        logger.error('Telegram notification worker tick failed', {
            error: serializeError(error),
        });
        throw error;
    }).finally(() => {
        telegramNotificationWorkerPromise = null;
    });
    return await telegramNotificationWorkerPromise;
};

export const startTelegramNotificationWorker = () => {
    if (telegramNotificationWorkerTimer) {
        return;
    }
    void runTelegramNotificationWorkerTick().catch(() => { });
    telegramNotificationWorkerTimer = setInterval(() => {
        void runTelegramNotificationWorkerTick().catch(() => { });
    }, TELEGRAM_NOTIFICATION_WORKER_INTERVAL_MS);
    if (typeof telegramNotificationWorkerTimer.unref === 'function') {
        telegramNotificationWorkerTimer.unref();
    }
    logger.info('Telegram notification worker started', {
        intervalMs: TELEGRAM_NOTIFICATION_WORKER_INTERVAL_MS,
    });
};

export const stopTelegramNotificationWorker = async () => {
    if (telegramNotificationWorkerTimer) {
        clearInterval(telegramNotificationWorkerTimer);
        telegramNotificationWorkerTimer = null;
    }
    if (telegramNotificationWorkerPromise) {
        await telegramNotificationWorkerPromise.catch(() => { });
    }
};
