import { appConfig } from './config.js';
import { logger, serializeError } from './logger.js';
const lastSentByKey = new Map();
const shouldSkipByCooldown = (key) => {
    const cooldownMs = appConfig.alertCooldownSeconds * 1000;
    const now = Date.now();
    const previous = lastSentByKey.get(key) ?? 0;
    if (now - previous < cooldownMs) {
        return true;
    }
    lastSentByKey.set(key, now);
    return false;
};
export const emitAlert = async (input) => {
    if (!appConfig.alertWebhookUrl) {
        return;
    }
    const dedupeKey = input.dedupeKey ?? `${input.type}:${input.message}`;
    if (shouldSkipByCooldown(dedupeKey)) {
        return;
    }
    const payload = {
        timestamp: new Date().toISOString(),
        service: appConfig.serviceName,
        type: input.type,
        severity: input.severity,
        message: input.message,
        context: input.context ?? {},
    };
    try {
        const response = await fetch(appConfig.alertWebhookUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            logger.error('Alert webhook request failed', {
                status: response.status,
                statusText: response.statusText,
                type: input.type,
            });
        }
    }
    catch (error) {
        logger.error('Alert webhook transport error', {
            type: input.type,
            error: serializeError(error),
        });
    }
};
