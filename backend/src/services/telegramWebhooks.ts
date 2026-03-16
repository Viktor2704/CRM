import { logger, serializeError } from '../logger.js';
import { TelegramBotClient } from './telegramClient.js';
import { appConfig } from '../config.js';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

type WebhookInfo = {
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    last_error_date?: number;
    last_error_message?: string;
    max_connections?: number;
    allowed_updates?: string[];
};

type WebhookHealthStatus = {
    isHealthy: boolean;
    url: string;
    pendingUpdates: number;
    lastError?: {
        date: Date;
        message: string;
    };
    maxConnections?: number;
};

// Webhook verification secret
let webhookSecret: string | null = null;

// Retry configuration
const RETRY_DELAYS = [1000, 5000, 15000, 60000]; // 1s, 5s, 15s, 1m
const EFFECTIVE_RETRY_DELAYS = process.env.NODE_ENV === 'test' ? RETRY_DELAYS.map(() => 0) : RETRY_DELAYS;
const MAX_RETRIES = RETRY_DELAYS.length;

// Webhook health monitoring
let lastWebhookCheck: Date | null = null;
let webhookHealthStatus: WebhookHealthStatus | null = null;

/**
 * Generate webhook secret for verification
 */
export const generateWebhookSecret = (): string => {
    return randomBytes(32).toString('hex');
};

/**
 * Verify webhook request signature
 */
export const verifyWebhookSignature = (body: string, signature: string, secret: string): boolean => {
    try {
        const hmac = createHmac('sha256', secret);
        hmac.update(body);
        const expectedSignature = hmac.digest('hex');
        return timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    } catch (error) {
        logger.error('Failed to verify webhook signature', { error: serializeError(error) });
        return false;
    }
};

/**
 * Set webhook URL for bot
 */
export const setWebhook = async (bot: TelegramBotClient, webhookUrl: string, secret?: string): Promise<boolean> => {
    try {
        // Stop polling if active
        await bot.stopPolling();

        // Generate secret if not provided
        webhookSecret = secret || generateWebhookSecret();

        const params: Record<string, unknown> = {
            url: webhookUrl,
            allowed_updates: ['message', 'callback_query', 'inline_query', 'chosen_inline_result'],
            drop_pending_updates: false,
            max_connections: 40,
            secret_token: webhookSecret,
        };

        await (bot as any).callApi('setWebhook', params);

        logger.info('Webhook set successfully', { url: webhookUrl });
        return true;
    } catch (error) {
        logger.error('Failed to set webhook', { error: serializeError(error), url: webhookUrl });
        return false;
    }
};

/**
 * Delete webhook and return to polling
 */
export const deleteWebhook = async (bot: TelegramBotClient, dropPendingUpdates = false): Promise<boolean> => {
    try {
        await (bot as any).callApi('deleteWebhook', {
            drop_pending_updates: dropPendingUpdates,
        });

        webhookSecret = null;
        logger.info('Webhook deleted successfully');
        return true;
    } catch (error) {
        logger.error('Failed to delete webhook', { error: serializeError(error) });
        return false;
    }
};

/**
 * Get webhook info
 */
export const getWebhookInfo = async (bot: TelegramBotClient): Promise<WebhookInfo | null> => {
    try {
        const info = await (bot as any).callApi('getWebhookInfo') as WebhookInfo;
        return info;
    } catch (error) {
        logger.error('Failed to get webhook info', { error: serializeError(error) });
        return null;
    }
};

/**
 * Check webhook health
 */
export const checkWebhookHealth = async (bot: TelegramBotClient): Promise<WebhookHealthStatus> => {
    try {
        const info = await getWebhookInfo(bot);

        if (!info) {
            return {
                isHealthy: false,
                url: '',
                pendingUpdates: 0,
            };
        }

        const isHealthy = !info.last_error_message && info.pending_update_count < 100;

        const status: WebhookHealthStatus = {
            isHealthy,
            url: info.url,
            pendingUpdates: info.pending_update_count,
            maxConnections: info.max_connections,
        };

        if (info.last_error_date && info.last_error_message) {
            status.lastError = {
                date: new Date(info.last_error_date * 1000),
                message: info.last_error_message,
            };
        }

        lastWebhookCheck = new Date();
        webhookHealthStatus = status;

        if (!isHealthy) {
            logger.warn('Webhook health check failed', {
                pendingUpdates: info.pending_update_count,
                lastError: status.lastError,
            });
        }

        return status;
    } catch (error) {
        logger.error('Failed to check webhook health', { error: serializeError(error) });
        return {
            isHealthy: false,
            url: '',
            pendingUpdates: 0,
        };
    }
};

/**
 * Get current webhook health status
 */
export const getWebhookHealthStatus = (): WebhookHealthStatus | null => {
    return webhookHealthStatus;
};

/**
 * Get last webhook check time
 */
export const getLastWebhookCheck = (): Date | null => {
    return lastWebhookCheck;
};

/**
 * Process webhook update with retry logic
 */
export const processWebhookUpdate = async (
    update: any,
    handler: (update: any) => Promise<void>,
    retryCount = 0
): Promise<void> => {
    try {
        await handler(update);
    } catch (error) {
        logger.error('Failed to process webhook update', {
            error: serializeError(error),
            updateId: update?.update_id,
            retryCount,
        });

        // Retry logic
        if (retryCount < MAX_RETRIES) {
            const delay = EFFECTIVE_RETRY_DELAYS[retryCount];
            logger.info('Retrying webhook update', {
                updateId: update?.update_id,
                retryCount: retryCount + 1,
                delayMs: delay,
            });

            await new Promise(resolve => setTimeout(resolve, delay));
            await processWebhookUpdate(update, handler, retryCount + 1);
        } else {
            logger.error('Max retries reached for webhook update', {
                updateId: update?.update_id,
                retryCount,
            });
            // Could store failed update in database for manual review
        }
    }
};

/**
 * Start webhook health monitoring
 */
export const startWebhookHealthMonitoring = (bot: TelegramBotClient, intervalMs = 60000): NodeJS.Timeout => {
    const interval = setInterval(async () => {
        await checkWebhookHealth(bot);
    }, intervalMs);

    logger.info('Webhook health monitoring started', { intervalMs });
    return interval;
};

/**
 * Stop webhook health monitoring
 */
export const stopWebhookHealthMonitoring = (interval: NodeJS.Timeout): void => {
    clearInterval(interval);
    logger.info('Webhook health monitoring stopped');
};

/**
 * Get webhook secret
 */
export const getWebhookSecret = (): string | null => {
    return webhookSecret;
};

/**
 * Set webhook secret (for initialization)
 */
export const setWebhookSecret = (secret: string): void => {
    webhookSecret = secret;
};

/**
 * Initialize webhook mode
 */
export const initializeWebhookMode = async (bot: TelegramBotClient): Promise<boolean> => {
    try {
        // Check if webhook URL is configured
        const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
        if (!webhookUrl) {
            logger.warn('TELEGRAM_WEBHOOK_URL not configured, staying in polling mode');
            return false;
        }

        // Validate webhook URL
        try {
            new URL(webhookUrl);
        } catch {
            logger.error('Invalid TELEGRAM_WEBHOOK_URL', { url: webhookUrl });
            return false;
        }

        // Set webhook
        const secret = process.env.TELEGRAM_WEBHOOK_SECRET || generateWebhookSecret();
        const success = await setWebhook(bot, webhookUrl, secret);

        if (success) {
            logger.info('Webhook mode initialized', { url: webhookUrl });

            // Start health monitoring
            startWebhookHealthMonitoring(bot);

            // Initial health check
            await checkWebhookHealth(bot);
        }

        return success;
    } catch (error) {
        logger.error('Failed to initialize webhook mode', { error: serializeError(error) });
        return false;
    }
};

/**
 * Validate webhook update structure
 */
export const validateWebhookUpdate = (update: any): boolean => {
    if (!update || typeof update !== 'object') {
        return false;
    }

    if (typeof update.update_id !== 'number') {
        return false;
    }

    // Must have at least one update type
    const hasValidUpdateType =
        update.message ||
        update.callback_query ||
        update.inline_query ||
        update.chosen_inline_result;

    return Boolean(hasValidUpdateType);
};
