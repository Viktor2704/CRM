import { emitAlert } from './alerts.js';
import { logger, serializeError } from './logger.js';

const DEFAULT_RUNTIME_ALERT_TIMEOUT_MS = 1500;

type RuntimeLogger = Pick<typeof logger, 'error'>;
type RuntimeAlertDependencies = {
    emitAlert?: typeof emitAlert;
    logger?: RuntimeLogger;
    flushTimeoutMs?: number;
};

type FatalRuntimeAlertDependencies = RuntimeAlertDependencies & {
    exit?: (code: number) => void;
};

const waitForAlertFlush = async (alertPromise: Promise<unknown>, flushTimeoutMs: number) => {
    if (flushTimeoutMs <= 0) {
        await alertPromise;
        return;
    }
    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
        await Promise.race([
            alertPromise,
            new Promise<void>(resolve => {
                timeoutHandle = setTimeout(resolve, flushTimeoutMs);
            }),
        ]);
    }
    finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
};

const flushRuntimeAlert = async (
    input: Parameters<typeof emitAlert>[0],
    dependencies: RuntimeAlertDependencies,
) => {
    const emitAlertImpl = dependencies.emitAlert ?? emitAlert;
    const activeLogger = dependencies.logger ?? logger;

    try {
        await waitForAlertFlush(
            Promise.resolve().then(() => emitAlertImpl(input)),
            dependencies.flushTimeoutMs ?? DEFAULT_RUNTIME_ALERT_TIMEOUT_MS,
        );
    }
    catch (error) {
        activeLogger.error('Runtime alert emission failed', {
            runtimeEvent: input.type,
            error: serializeError(error),
        });
    }
};

export const reportUnhandledRejection = async (
    reason: unknown,
    dependencies: RuntimeAlertDependencies = {},
) => {
    const activeLogger = dependencies.logger ?? logger;
    const serializedError = serializeError(reason);

    activeLogger.error('Unhandled promise rejection', {
        error: serializedError,
    });

    await flushRuntimeAlert({
        type: 'runtime_unhandled_rejection',
        severity: 'critical',
        message: 'Unhandled promise rejection',
        dedupeKey: 'runtime:unhandled_rejection',
        context: {
            runtimeEvent: 'unhandledRejection',
            pid: process.pid,
            error: serializedError,
        },
    }, dependencies);
};

export const reportUncaughtException = async (
    error: unknown,
    dependencies: FatalRuntimeAlertDependencies = {},
) => {
    const activeLogger = dependencies.logger ?? logger;
    const exit = dependencies.exit ?? (code => process.exit(code));
    const serializedError = serializeError(error);

    activeLogger.error('Uncaught exception', {
        error: serializedError,
    });

    await flushRuntimeAlert({
        type: 'runtime_uncaught_exception',
        severity: 'critical',
        message: 'Uncaught exception',
        dedupeKey: 'runtime:uncaught_exception',
        context: {
            runtimeEvent: 'uncaughtException',
            pid: process.pid,
            error: serializedError,
        },
    }, dependencies);

    exit(1);
};
