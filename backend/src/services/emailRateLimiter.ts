import Bottleneck from 'bottleneck';
import { appConfig } from '../config.js';
import { logger, serializeError } from '../logger.js';
import { appMetrics } from '../metrics.js';

const EMAIL_RATE_LIMIT_QUEUE_SIZE_METRIC = 'novin_app_email_rate_limit_queue_size';
const EMAIL_RATE_LIMIT_QUEUE_SIZE_HELP = 'Current email rate limiter job counts by limiter type and state.';
const EMAIL_RATE_LIMIT_WARNING_THRESHOLD = 50;
const EMAIL_RATE_LIMIT_WARNING_COOLDOWN_MS = 30_000;
const EMAIL_RATE_LIMITER_STOP_ERROR = 'Email rate limiter is shutting down';
const EMAIL_RATE_LIMITER_DEFAULT_STOP_TIMEOUT_MS = 30_000;
const EMAIL_RATE_LIMITER_DOMAIN_MAX_CONCURRENT = 2;
const EMAIL_RATE_LIMITER_DOMAIN_MIN_TIME_MS = 500;
const EMAIL_RATE_LIMIT_WARNING_TOP_DOMAINS = 5;
const EMAIL_RATE_LIMITER_STATES = ['queued', 'running', 'done'] as const;

type RateLimitState = typeof EMAIL_RATE_LIMITER_STATES[number];

type LimiterCountsSnapshot = {
    queued: number;
    running: number;
    done: number;
};

type DomainLimiterEntry = {
    limiter: Bottleneck;
    run: <T>(task: () => Promise<T>) => Promise<T>;
};

type PendingEmailJob = {
    domain: string;
    enqueuedAt: number;
    stage: 'global_queued' | 'per_domain_queued' | 'executing';
};

const executeTask = async <T>(task: () => Promise<T>) => {
    return await task();
};

let globalLimiter: Bottleneck;
let runWithGlobalLimiter: <T>(task: () => Promise<T>) => Promise<T>;
let domainLimiters = new Map<string, DomainLimiterEntry>();
let pendingEmailJobs = new Map<string, PendingEmailJob>();
let pendingEmailJobSequence = 0;
let lastBacklogWarningAt = 0;
let stopEmailRateLimiterPromise: Promise<void> | null = null;

const normalizeCounts = (counts: Bottleneck.Counts): LimiterCountsSnapshot => ({
    queued: Number(counts.RECEIVED ?? 0) + Number(counts.QUEUED ?? 0),
    running: Math.max(Number(counts.RUNNING ?? 0), Number(counts.EXECUTING ?? 0)),
    done: Number(counts.DONE ?? 0),
});

const createLimiter = (options: Bottleneck.ConstructorOptions) => {
    return new Bottleneck({
        ...options,
        trackDoneStatus: true,
    });
};

const createGlobalLimiter = () => {
    return createLimiter({
        id: 'email-rate-limit-global',
        maxConcurrent: appConfig.emailRateLimitMaxConcurrent,
        minTime: appConfig.emailRateLimitMinTimeMs,
    });
};

const createDomainLimiter = (domain: string): DomainLimiterEntry => {
    const limiter = createLimiter({
        id: `email-rate-limit-domain:${domain}`,
        maxConcurrent: EMAIL_RATE_LIMITER_DOMAIN_MAX_CONCURRENT,
        minTime: EMAIL_RATE_LIMITER_DOMAIN_MIN_TIME_MS,
    });
    return {
        limiter,
        run: limiter.wrap(executeTask) as typeof executeTask,
    };
};

const getRecipientDomain = (recipient: string) => {
    const normalizedRecipient = String(recipient ?? '').trim().toLowerCase();
    const match = normalizedRecipient.match(/@([^>\s,;]+)/);
    return match?.[1] ?? '';
};

const getDomainLimiter = (domain: string) => {
    const normalizedDomain = String(domain ?? '').trim().toLowerCase();
    if (!normalizedDomain) {
        return null;
    }
    const existingLimiter = domainLimiters.get(normalizedDomain);
    if (existingLimiter) {
        return existingLimiter;
    }
    const createdLimiter = createDomainLimiter(normalizedDomain);
    domainLimiters.set(normalizedDomain, createdLimiter);
    return createdLimiter;
};

const getAggregateDomainCounts = () => {
    let queued = 0;
    let running = 0;
    let done = 0;
    for (const { limiter } of domainLimiters.values()) {
        const counts = normalizeCounts(limiter.counts());
        queued += counts.queued;
        running += counts.running;
        done += counts.done;
    }
    return { queued, running, done };
};

const getTrackedQueuedCounts = () => {
    let global = 0;
    let perDomain = 0;
    for (const job of pendingEmailJobs.values()) {
        if (job.stage === 'global_queued') {
            global += 1;
            continue;
        }
        if (job.stage === 'per_domain_queued') {
            perDomain += 1;
        }
    }
    return {
        global,
        perDomain,
        total: global + perDomain,
    };
};

const getOldestQueuedEmailAgeMs = () => {
    let oldestQueuedAt = Number.POSITIVE_INFINITY;
    for (const job of pendingEmailJobs.values()) {
        if (job.stage === 'executing') {
            continue;
        }
        if (job.enqueuedAt < oldestQueuedAt) {
            oldestQueuedAt = job.enqueuedAt;
        }
    }
    if (!Number.isFinite(oldestQueuedAt)) {
        return 0;
    }
    return Math.max(0, Date.now() - oldestQueuedAt);
};

const getQueuedDomainSummary = (limit = EMAIL_RATE_LIMIT_WARNING_TOP_DOMAINS) => {
    const queuedByDomain = new Map<string, number>();
    for (const job of pendingEmailJobs.values()) {
        if (job.stage === 'executing') {
            continue;
        }
        const domain = job.domain || 'unknown';
        queuedByDomain.set(domain, (queuedByDomain.get(domain) ?? 0) + 1);
    }

    return Array.from(queuedByDomain.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, limit)
        .map(([domain, queued]) => ({ domain, queued }));
};

export const getEmailRateLimitSnapshot = () => {
    const globalCounts = normalizeCounts(globalLimiter.counts());
    const perDomainCounts = getAggregateDomainCounts();
    const queuedCounts = getTrackedQueuedCounts();
    return {
        global: {
            queued: queuedCounts.global,
            running: globalCounts.running,
            done: globalCounts.done,
        },
        perDomain: {
            queued: queuedCounts.perDomain,
            running: perDomainCounts.running,
            done: perDomainCounts.done,
        },
        domainCount: domainLimiters.size,
        totalQueued: queuedCounts.total,
        totalRunning: globalCounts.running,
        totalDone: globalCounts.done,
        oldestQueuedAgeMs: getOldestQueuedEmailAgeMs(),
    };
};

const setMetricState = (limitType: 'global' | 'per_domain', state: RateLimitState, value: number) => {
    appMetrics.setGauge(
        EMAIL_RATE_LIMIT_QUEUE_SIZE_METRIC,
        EMAIL_RATE_LIMIT_QUEUE_SIZE_HELP,
        { limit_type: limitType, state },
        value,
    );
};

export const refreshEmailRateLimitMetrics = () => {
    const snapshot = getEmailRateLimitSnapshot();
    setMetricState('global', 'queued', snapshot.global.queued);
    setMetricState('global', 'running', snapshot.global.running);
    setMetricState('global', 'done', snapshot.global.done);
    setMetricState('per_domain', 'queued', snapshot.perDomain.queued);
    setMetricState('per_domain', 'running', snapshot.perDomain.running);
    setMetricState('per_domain', 'done', snapshot.perDomain.done);
    return snapshot;
};

const maybeLogBacklogWarning = () => {
    const snapshot = getEmailRateLimitSnapshot();
    if (snapshot.totalQueued <= EMAIL_RATE_LIMIT_WARNING_THRESHOLD) {
        return;
    }
    const now = Date.now();
    if (lastBacklogWarningAt > 0 && now - lastBacklogWarningAt < EMAIL_RATE_LIMIT_WARNING_COOLDOWN_MS) {
        return;
    }
    lastBacklogWarningAt = now;
    logger.warn('Email rate limiter backlog is high', {
        warningThreshold: EMAIL_RATE_LIMIT_WARNING_THRESHOLD,
        totalQueued: snapshot.totalQueued,
        totalRunning: snapshot.totalRunning,
        totalDone: snapshot.totalDone,
        domainCount: snapshot.domainCount,
        oldestQueuedAgeMs: snapshot.oldestQueuedAgeMs,
        oldestQueuedAgeSeconds: Number((snapshot.oldestQueuedAgeMs / 1000).toFixed(1)),
        queuedDomains: getQueuedDomainSummary(),
        globalQueue: snapshot.global,
        perDomainQueue: snapshot.perDomain,
    });
};

const resetEmailRateLimiterState = () => {
    globalLimiter = createGlobalLimiter();
    runWithGlobalLimiter = globalLimiter.wrap(executeTask) as typeof executeTask;
    domainLimiters = new Map();
    pendingEmailJobs = new Map();
    pendingEmailJobSequence = 0;
    lastBacklogWarningAt = 0;
    stopEmailRateLimiterPromise = null;
    refreshEmailRateLimitMetrics();
};

const waitForPromiseOutcome = async (promise: Promise<void>, timeoutMs: number) => {
    if (timeoutMs <= 0) {
        try {
            await promise;
            return { ok: true, timedOut: false };
        }
        catch (error) {
            return { ok: false, timedOut: false, error };
        }
    }

    return await new Promise<{ ok: boolean; timedOut: boolean; error?: unknown }>((resolve) => {
        const timer = setTimeout(() => {
            resolve({ ok: false, timedOut: true });
        }, timeoutMs);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }

        promise.then(() => {
            clearTimeout(timer);
            resolve({ ok: true, timedOut: false });
        }).catch((error) => {
            clearTimeout(timer);
            resolve({ ok: false, timedOut: false, error });
        });
    });
};

export const rateLimitEmailSend = async <T>(recipient: string, task: () => Promise<T>) => {
    const jobId = `email-rate-limit-job-${pendingEmailJobSequence += 1}`;
    const domain = getRecipientDomain(recipient);
    pendingEmailJobs.set(jobId, {
        domain,
        enqueuedAt: Date.now(),
        stage: 'global_queued',
    });

    const executeTrackedTask = async () => {
        const pendingJob = pendingEmailJobs.get(jobId);
        if (pendingJob) {
            pendingJob.stage = 'executing';
        }
        refreshEmailRateLimitMetrics();
        return await task();
    };

    const domainLimiter = getDomainLimiter(domain);
    const scheduledPromise = domainLimiter
        ? runWithGlobalLimiter(async () => {
            const pendingJob = pendingEmailJobs.get(jobId);
            if (pendingJob && pendingJob.stage === 'global_queued') {
                pendingJob.stage = 'per_domain_queued';
                refreshEmailRateLimitMetrics();
            }
            return await domainLimiter.run(executeTrackedTask);
        })
        : runWithGlobalLimiter(executeTrackedTask);

    refreshEmailRateLimitMetrics();
    maybeLogBacklogWarning();

    try {
        return await scheduledPromise;
    }
    finally {
        pendingEmailJobs.delete(jobId);
        refreshEmailRateLimitMetrics();
    }
};

export const stopEmailRateLimiter = async (timeoutMs = EMAIL_RATE_LIMITER_DEFAULT_STOP_TIMEOUT_MS) => {
    if (!stopEmailRateLimiterPromise) {
        stopEmailRateLimiterPromise = (async () => {
            await globalLimiter.stop({
                dropWaitingJobs: false,
                enqueueErrorMessage: EMAIL_RATE_LIMITER_STOP_ERROR,
            });
            for (const { limiter } of domainLimiters.values()) {
                await limiter.stop({
                    dropWaitingJobs: false,
                    enqueueErrorMessage: EMAIL_RATE_LIMITER_STOP_ERROR,
                });
            }
            refreshEmailRateLimitMetrics();
        })();
    }

    const outcome = await waitForPromiseOutcome(stopEmailRateLimiterPromise, timeoutMs);
    if (outcome.ok) {
        return true;
    }

    const snapshot = getEmailRateLimitSnapshot();
    if (outcome.timedOut) {
        logger.warn('Email rate limiter shutdown timed out', {
            timeoutMs,
            totalQueued: snapshot.totalQueued,
            totalRunning: snapshot.totalRunning,
            oldestQueuedAgeMs: snapshot.oldestQueuedAgeMs,
            globalQueue: snapshot.global,
            perDomainQueue: snapshot.perDomain,
        });
        return false;
    }

    logger.warn('Email rate limiter shutdown failed', {
        timeoutMs,
        totalQueued: snapshot.totalQueued,
        totalRunning: snapshot.totalRunning,
        oldestQueuedAgeMs: snapshot.oldestQueuedAgeMs,
        error: serializeError(outcome.error),
    });
    return false;
};

export const __emailRateLimiterTestUtils = {
    reset() {
        resetEmailRateLimiterState();
    },
};

resetEmailRateLimiterState();
