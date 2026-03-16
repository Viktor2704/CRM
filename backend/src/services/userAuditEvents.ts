import { logger, serializeError } from '../logger.js';
const listeners = new Set<Function>();
export const subscribeUserAuditEvent = (listener) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
export const publishUserAuditEvent = (payload) => {
    for (const listener of listeners) {
        try {
            listener(payload);
        }
        catch (error) {
            logger.warn('User audit stream listener failed', {
                error: serializeError(error),
            });
        }
    }
};
