import { normalizeText } from '../helpers/normalize.js';
import { logger, serializeError } from '../logger.js';

const listenersByUserId = new Map<string, Set<Function>>();

export const subscribeNotificationEvent = (userId, listener) => {
    const normalizedUserId = normalizeText(userId);
    if (!normalizedUserId || typeof listener !== 'function') {
        return () => {};
    }
    const listeners = listenersByUserId.get(normalizedUserId) ?? new Set();
    listeners.add(listener);
    listenersByUserId.set(normalizedUserId, listeners);
    return () => {
        const currentListeners = listenersByUserId.get(normalizedUserId);
        if (!currentListeners) {
            return;
        }
        currentListeners.delete(listener);
        if (currentListeners.size === 0) {
            listenersByUserId.delete(normalizedUserId);
        }
    };
};

export const publishNotificationEvent = (payload) => {
    const normalizedUserId = normalizeText(payload?.userId);
    if (!normalizedUserId) {
        return;
    }
    const listeners = listenersByUserId.get(normalizedUserId);
    if (!listeners || listeners.size === 0) {
        return;
    }
    for (const listener of listeners) {
        try {
            listener(payload);
        }
        catch (error) {
            logger.warn('Notification stream listener failed', {
                userId: normalizedUserId,
                error: serializeError(error),
            });
        }
    }
};
