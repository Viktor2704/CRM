import { appConfig } from './config.js';
const levelRank = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
const normalizeLogLevel = (value) => {
    if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
        return value;
    }
    return 'info';
};
const minLevel = normalizeLogLevel(appConfig.logLevel);
export const serializeError = (error) => {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }
    if (typeof error === 'object' && error !== null) {
        return error;
    }
    return { value: String(error) };
};
const shouldLog = (level) => {
    return levelRank[level] >= levelRank[minLevel];
};
const writeLog = (level, message, meta = {}) => {
    if (!shouldLog(level)) {
        return;
    }
    const payload = {
        timestamp: new Date().toISOString(),
        service: appConfig.serviceName,
        level,
        message,
        ...meta,
    };
    const line = JSON.stringify(payload);
    if (level === 'error') {
        console.error(line);
        return;
    }
    console.log(line);
};
export const logger = {
    debug: (message, meta?) => writeLog('debug', message, meta),
    info: (message, meta?) => writeLog('info', message, meta),
    warn: (message, meta?) => writeLog('warn', message, meta),
    error: (message, meta?) => writeLog('error', message, meta),
};
