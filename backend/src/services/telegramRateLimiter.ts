import { appConfig } from '../config.js';
import { logger } from '../logger.js';
import { appMetrics } from '../metrics.js';

const TELEGRAM_QUEUE_SIZE_METRIC = 'novin_app_telegram_rate_limit_queue_size';
const TELEGRAM_QUEUE_SIZE_HELP = 'Current Telegram rate limiter queue size by limiter type.';
const TELEGRAM_RATE_LIMIT_HITS_METRIC = 'novin_app_telegram_rate_limit_hits_total';
const TELEGRAM_RATE_LIMIT_HITS_HELP = 'Total observed Telegram rate limiter enqueue events by limiter type.';

type LimiterJob<T> = {
    enqueuedAt: number;
    run: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
};

class SimpleLimiter {
    private readonly maxConcurrent: number;
    private readonly minTime: number;
    private readonly reservoirRefreshAmount: number | null;
    private readonly reservoirRefreshInterval: number | null;
    private readonly initialReservoir: number | null;
    private queue: Array<LimiterJob<unknown>> = [];
    private running = 0;
    private received = 0;
    private done = 0;
    private nextAllowedAt = 0;
    private drainTimer: NodeJS.Timeout | null = null;
    private stopped = false;
    private reservoir: number | null = null;
    private nextReservoirRefreshAt = 0;

    constructor(options: {
        maxConcurrent?: number;
        minTime?: number;
        reservoir?: number | null;
        reservoirRefreshAmount?: number | null;
        reservoirRefreshInterval?: number | null;
    }) {
        this.maxConcurrent = Math.max(1, Number(options.maxConcurrent ?? 1));
        this.minTime = Math.max(0, Number(options.minTime ?? 0));
        this.initialReservoir = Number.isFinite(Number(options.reservoir))
            ? Math.max(0, Number(options.reservoir))
            : null;
        this.reservoir = this.initialReservoir;
        this.reservoirRefreshAmount = Number.isFinite(Number(options.reservoirRefreshAmount))
            ? Math.max(0, Number(options.reservoirRefreshAmount))
            : null;
        this.reservoirRefreshInterval = Number.isFinite(Number(options.reservoirRefreshInterval))
            ? Math.max(1, Number(options.reservoirRefreshInterval))
            : null;
        this.nextReservoirRefreshAt = this.reservoirRefreshInterval ? Date.now() + this.reservoirRefreshInterval : 0;
    }

    private scheduleDrain(delayMs: number) {
        if (this.drainTimer) {
            return;
        }
        this.drainTimer = setTimeout(() => {
            this.drainTimer = null;
            this.drain();
        }, Math.max(0, delayMs));
    }

    private refreshReservoir(nowMs: number) {
        if (!this.reservoirRefreshInterval || this.reservoirRefreshAmount === null) {
            return;
        }
        if (nowMs < this.nextReservoirRefreshAt) {
            return;
        }
        const elapsedWindows = Math.floor((nowMs - this.nextReservoirRefreshAt) / this.reservoirRefreshInterval) + 1;
        this.reservoir = this.reservoirRefreshAmount;
        this.nextReservoirRefreshAt += elapsedWindows * this.reservoirRefreshInterval;
    }

    private drain() {
        if (this.stopped) {
            return;
        }
        let nowMs = Date.now();
        this.refreshReservoir(nowMs);
        while (this.queue.length > 0 && this.running < this.maxConcurrent) {
            if (this.reservoir !== null && this.reservoir <= 0) {
                if (this.reservoirRefreshInterval) {
                    this.scheduleDrain(Math.max(0, this.nextReservoirRefreshAt - nowMs));
                }
                return;
            }
            if (nowMs < this.nextAllowedAt) {
                this.scheduleDrain(this.nextAllowedAt - nowMs);
                return;
            }
            const job = this.queue.shift();
            if (!job) {
                return;
            }
            if (this.reservoir !== null) {
                this.reservoir -= 1;
            }
            this.running += 1;
            this.nextAllowedAt = nowMs + this.minTime;
            Promise.resolve()
                .then(job.run)
                .then(job.resolve, job.reject)
                .finally(() => {
                    this.running = Math.max(0, this.running - 1);
                    this.done += 1;
                    this.drain();
                });
            nowMs = Date.now();
            this.refreshReservoir(nowMs);
        }
    }

    schedule<T>(run: () => Promise<T>) {
        if (this.stopped) {
            return Promise.reject(new Error('Limiter has been stopped'));
        }
        this.received += 1;
        return new Promise<T>((resolve, reject) => {
            this.queue.push({
                enqueuedAt: Date.now(),
                run,
                resolve,
                reject,
            });
            this.drain();
        });
    }

    counts() {
        return {
            RECEIVED: this.received,
            QUEUED: this.queue.length,
            RUNNING: this.running,
            EXECUTING: this.running,
            DONE: this.done,
        };
    }

    oldestQueuedAgeMs() {
        return this.queue.length > 0 ? Math.max(0, Date.now() - this.queue[0].enqueuedAt) : 0;
    }

    async stop(timeoutMs = 30000) {
        this.stopped = true;
        if (this.drainTimer) {
            clearTimeout(this.drainTimer);
            this.drainTimer = null;
        }
        const startedAt = Date.now();
        while ((this.queue.length > 0 || this.running > 0) && Date.now() - startedAt < timeoutMs) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }
}

const globalLimiter = new SimpleLimiter({
    maxConcurrent: 1,
    minTime: appConfig.telegramRateLimitGlobalMinTimeMs,
});

const perChatLimiters = new Map<string, SimpleLimiter>();

const setQueueMetrics = () => {
    appMetrics.setGauge(TELEGRAM_QUEUE_SIZE_METRIC, TELEGRAM_QUEUE_SIZE_HELP, { limit_type: 'global' }, globalLimiter.counts().QUEUED);
    let perChatQueued = 0;
    for (const limiter of perChatLimiters.values()) {
        perChatQueued += limiter.counts().QUEUED;
    }
    appMetrics.setGauge(TELEGRAM_QUEUE_SIZE_METRIC, TELEGRAM_QUEUE_SIZE_HELP, { limit_type: 'per_chat' }, perChatQueued);
};

export const getChatLimiter = (chatId: string | number) => {
    const key = String(chatId ?? '').trim();
    if (!key) {
        return globalLimiter;
    }
    const existing = perChatLimiters.get(key);
    if (existing) {
        return existing;
    }
    const limiter = new SimpleLimiter({
        maxConcurrent: 1,
        minTime: 0,
        reservoir: appConfig.telegramRateLimitPerChatReservoir,
        reservoirRefreshAmount: appConfig.telegramRateLimitPerChatReservoir,
        reservoirRefreshInterval: 60_000,
    });
    perChatLimiters.set(key, limiter);
    setQueueMetrics();
    return limiter;
};

const maybeLogRateLimitPressure = () => {
    const globalCounts = globalLimiter.counts();
    if (globalCounts.QUEUED <= 1000) {
        return;
    }
    logger.warn('Telegram rate limiter backlog is high', {
        globalQueueSize: globalCounts.QUEUED,
        running: globalCounts.RUNNING,
        oldestQueuedAgeMs: globalLimiter.oldestQueuedAgeMs(),
    });
};

const scheduleWithLimiters = async <T>(options: {
    chatId?: string | number | null;
    task: () => Promise<T>;
}) => {
    const chatId = options.chatId === undefined || options.chatId === null ? '' : String(options.chatId);
    const chatLimiter = chatId ? getChatLimiter(chatId) : null;
    if (globalLimiter.counts().QUEUED > 0) {
        appMetrics.incrementCounter(TELEGRAM_RATE_LIMIT_HITS_METRIC, TELEGRAM_RATE_LIMIT_HITS_HELP, { limit_type: 'global' });
    }
    if (chatLimiter && chatLimiter.counts().QUEUED > 0) {
        appMetrics.incrementCounter(TELEGRAM_RATE_LIMIT_HITS_METRIC, TELEGRAM_RATE_LIMIT_HITS_HELP, { limit_type: 'per_chat' });
    }
    maybeLogRateLimitPressure();
    setQueueMetrics();
    try {
        if (!chatLimiter) {
            return await globalLimiter.schedule(options.task);
        }
        return await globalLimiter.schedule(() => chatLimiter.schedule(options.task));
    }
    finally {
        setQueueMetrics();
    }
};

export const sendMessageRateLimited = async (bot: any, chatId: string | number, text: string, options?: Record<string, unknown>) => {
    return await scheduleWithLimiters({
        chatId,
        task: () => bot.sendMessage(chatId, text, options),
    });
};

export const editMessageTextRateLimited = async (bot: any, text: string, options?: Record<string, unknown>) => {
    return await scheduleWithLimiters({
        chatId: options?.chat_id as string | number | null | undefined,
        task: () => bot.editMessageText(text, options),
    });
};

export const answerCallbackQueryRateLimited = async (bot: any, callbackQueryId: string, options?: Record<string, unknown>) => {
    return await scheduleWithLimiters({
        task: () => bot.answerCallbackQuery(callbackQueryId, options),
    });
};

export const getTelegramRateLimitSnapshot = () => {
    let perChatQueued = 0;
    for (const limiter of perChatLimiters.values()) {
        perChatQueued += limiter.counts().QUEUED;
    }
    return {
        global: globalLimiter.counts(),
        perChatQueued,
        oldestQueuedAgeMs: globalLimiter.oldestQueuedAgeMs(),
    };
};

export const stopTelegramRateLimiters = async () => {
    await globalLimiter.stop(30_000);
    await Promise.all([...perChatLimiters.values()].map((limiter) => limiter.stop(30_000)));
    perChatLimiters.clear();
    setQueueMetrics();
};

export const createRateLimitedTelegramBot = (rawBot: any) => {
    if (!rawBot || typeof rawBot !== 'object') {
        return rawBot;
    }
    const proxy = new Proxy(rawBot, {
        get(target, prop, receiver) {
            if (prop === 'sendMessage') {
                return (chatId: string | number, text: string, options?: Record<string, unknown>) =>
                    sendMessageRateLimited(target, chatId, text, options);
            }
            if (prop === 'editMessageText') {
                return (text: string, options?: Record<string, unknown>) =>
                    editMessageTextRateLimited(target, text, options);
            }
            if (prop === 'answerCallbackQuery') {
                return (callbackQueryId: string, options?: Record<string, unknown>) =>
                    answerCallbackQueryRateLimited(target, callbackQueryId, options);
            }
            const value = Reflect.get(target, prop, receiver);
            if (typeof value === 'function') {
                return value.bind(target);
            }
            return value;
        },
    });
    setQueueMetrics();
    return proxy;
};
