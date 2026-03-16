import { Router, Request, Response } from 'express';
import { logger, serializeError } from '../logger.js';
import { getTelegramBot } from '../services/telegramBot.js';
import {
    getWebhookSecret,
    verifyWebhookSignature,
    processWebhookUpdate,
    validateWebhookUpdate,
} from '../services/telegramWebhooks.js';
import {
    handleStartCommand,
    handleHelpCommand,
    handleStatusCommand,
    handleMyTicketsCommand,
    handleCreateCommand,
    handleSearchCommand,
    handleLinkCommand,
    handleUnlinkCommand,
    handleConversationMessage,
} from '../services/telegramBotCommands.js';
import { handleInlineQuery, handleChosenInlineResult } from '../services/telegramInlineMode.js';

const normalizeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Register Telegram webhook routes
 */
export const registerTelegramWebhookRoutes = (params: {
    app: any;
    asyncHandler: (handler: (req: Request, res: Response) => Promise<void>) => any;
}) => {
    const { app, asyncHandler } = params;

    // Webhook endpoint
    app.post('/webhook/telegram', asyncHandler(async (request: Request, response: Response) => {
        try {
            // Verify webhook secret
            const secret = getWebhookSecret();
            if (secret) {
                const signature = request.headers['x-telegram-bot-api-secret-token'] as string;
                if (!signature) {
                    logger.warn('Webhook request missing signature');
                    response.status(401).json({ error: 'Unauthorized' });
                    return;
                }

                const body = JSON.stringify(request.body);
                if (!verifyWebhookSignature(body, signature, secret)) {
                    logger.warn('Webhook signature verification failed');
                    response.status(401).json({ error: 'Unauthorized' });
                    return;
                }
            }

            const update = request.body;

            // Validate update structure
            if (!validateWebhookUpdate(update)) {
                logger.warn('Invalid webhook update structure', { update });
                response.status(400).json({ error: 'Invalid update' });
                return;
            }

            // Get bot instance
            const bot = getTelegramBot();
            if (!bot) {
                logger.error('Telegram bot not initialized');
                response.status(503).json({ error: 'Bot not available' });
                return;
            }

            // Process update with retry logic
            await processWebhookUpdate(update, async (update) => {
                await handleUpdate(bot, update);
            });

            // Respond immediately to Telegram
            response.status(200).json({ ok: true });
        } catch (error) {
            logger.error('Webhook handler error', { error: serializeError(error) });
            response.status(500).json({ error: 'Internal server error' });
        }
    }));

    // Webhook health check endpoint
    app.get('/webhook/telegram/health', asyncHandler(async (_request: Request, response: Response) => {
        const bot = getTelegramBot();
        if (!bot) {
            response.status(503).json({
                status: 'unavailable',
                message: 'Bot not initialized',
            });
            return;
        }

        response.status(200).json({
            status: 'ok',
            timestamp: new Date().toISOString(),
        });
    }));
};

/**
 * Handle Telegram update
 */
const handleUpdate = async (bot: any, update: any): Promise<void> => {
    try {
        // Handle message
        if (update.message) {
            await handleMessage(bot, update.message);
            return;
        }

        // Handle callback query
        if (update.callback_query) {
            await handleCallbackQuery(bot, update.callback_query);
            return;
        }

        // Handle inline query
        if (update.inline_query) {
            await handleInlineQuery(bot, update.inline_query);
            return;
        }

        // Handle chosen inline result
        if (update.chosen_inline_result) {
            await handleChosenInlineResult(update.chosen_inline_result);
            return;
        }

        logger.warn('Unknown update type', { updateId: update.update_id });
    } catch (error) {
        logger.error('Failed to handle update', {
            error: serializeError(error),
            updateId: update.update_id,
        });
        throw error;
    }
};

/**
 * Handle message
 */
const handleMessage = async (bot: any, message: any): Promise<void> => {
    const text = normalizeText(message?.text);

    // Check if it's a command
    if (text.startsWith('/')) {
        await handleCommand(bot, message, text);
        return;
    }

    // Check if user is in conversation state
    const handled = await handleConversationMessage(bot, message);
    if (handled) {
        return;
    }

    // Handle location sharing
    if (message.location) {
        await handleLocation(bot, message);
        return;
    }

    // Handle photo
    if (message.photo) {
        await handlePhoto(bot, message);
        return;
    }

    // Unknown message type
    logger.debug('Unhandled message type', { messageId: message.message_id });
};

/**
 * Handle command
 */
const handleCommand = async (bot: any, message: any, text: string): Promise<void> => {
    const commandMatch = text.match(/^\/([a-z_]+)(?:@\w+)?(?:\s+(.*))?$/i);
    if (!commandMatch) {
        return;
    }

    const command = commandMatch[1].toLowerCase();
    const args = normalizeText(commandMatch[2] || '');

    switch (command) {
        case 'start':
            await handleStartCommand(bot, message);
            break;

        case 'help':
            await handleHelpCommand(bot, message);
            break;

        case 'status':
            await handleStatusCommand(bot, message, args);
            break;

        case 'mytickets':
            await handleMyTicketsCommand(bot, message);
            break;

        case 'create':
            await handleCreateCommand(bot, message);
            break;

        case 'search':
            await handleSearchCommand(bot, message);
            break;

        case 'link':
            await handleLinkCommand(bot, message, args);
            break;

        case 'unlink':
            await handleUnlinkCommand(bot, message);
            break;

        default:
            logger.debug('Unknown command', { command });
            break;
    }
};

/**
 * Handle callback query
 */
const handleCallbackQuery = async (bot: any, query: any): Promise<void> => {
    const callbackData = normalizeText(query?.data);
    const chatId = query?.message?.chat?.id;

    if (!callbackData || !chatId) {
        return;
    }

    try {
        // Parse callback data
        const [action, ...params] = callbackData.split(':');

        switch (action) {
            case 'view_ticket':
                const ticketId = params[0];
                if (ticketId) {
                    // Send ticket details
                    await handleStatusCommand(bot, { chat: { id: chatId }, text: `/status ${ticketId}` }, ticketId);
                }
                break;

            default:
                logger.debug('Unknown callback action', { action });
                break;
        }

        // Answer callback query
        await bot.answerCallbackQuery(query.id, {});
    } catch (error) {
        logger.error('Failed to handle callback query', {
            error: serializeError(error),
            callbackData,
        });

        // Answer with error
        await bot.answerCallbackQuery(query.id, {
            text: '❌ Произошла ошибка',
            show_alert: true,
        });
    }
};

/**
 * Handle location
 */
const handleLocation = async (bot: any, message: any): Promise<void> => {
    const chatId = message?.chat?.id;
    const location = message?.location;

    if (!chatId || !location) {
        return;
    }

    logger.info('Location received', {
        chatId,
        latitude: location.latitude,
        longitude: location.longitude,
    });

    // Could implement check-in functionality here
    await bot.sendMessage(chatId, '📍 Местоположение получено');
};

/**
 * Handle photo
 */
const handlePhoto = async (bot: any, message: any): Promise<void> => {
    const chatId = message?.chat?.id;
    const photos = message?.photo;

    if (!chatId || !photos || photos.length === 0) {
        return;
    }

    logger.info('Photo received', {
        chatId,
        photoCount: photos.length,
    });

    // Could implement photo attachment to tickets here
    await bot.sendMessage(chatId, '📷 Фото получено');
};
