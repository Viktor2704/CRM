export const registerMockTelegramRoutes = (params) => {
    const { app, requireAuth, ApiError, normalizeText, appConfig, randomUUID, getTelegramBotUsername, createTelegramLinkToken, localMockTelegramLinks, localMockTelegramLinkTokens, } = params;
    app.get('/telegram/status', requireAuth, (request, response) => {
        if (!appConfig.telegramBotEnabled) {
            response.status(503).json({
                code: 'TELEGRAM_BOT_DISABLED',
                message: 'Telegram bot is disabled',
                status: 503,
            });
            return;
        }
        const userId = normalizeText(request.authUser?.id);
        const chatId = normalizeText(localMockTelegramLinks.get(userId));
        response.status(200).json({
            linked: Boolean(chatId),
            chatId: chatId || null,
        });
    });
    app.post('/telegram/link-token', requireAuth, (request, response) => {
        if (!appConfig.telegramBotEnabled) {
            response.status(503).json({
                code: 'TELEGRAM_BOT_DISABLED',
                message: 'Telegram bot is disabled',
                status: 503,
            });
            return;
        }
        const userId = normalizeText(request.authUser?.id);
        if (!userId) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const token = createTelegramLinkToken();
        const now = Date.now();
        for (let index = localMockTelegramLinkTokens.length - 1; index >= 0; index -= 1) {
            const item = localMockTelegramLinkTokens[index];
            if (normalizeText(item.userId) === userId) {
                localMockTelegramLinkTokens.splice(index, 1);
            }
        }
        localMockTelegramLinkTokens.push({
            id: randomUUID(),
            userId,
            token,
            createdAt: new Date(now).toISOString(),
            expiresAt: now + 10 * 60 * 1000,
            usedAt: null,
        });
        const botUsername = normalizeText(getTelegramBotUsername()) || normalizeText(appConfig.telegramBotUsername) || 'NovinzhstroyBot';
        response.status(200).json({
            token,
            expiresIn: 600,
            botUsername,
            instruction: `Отправьте боту @${botUsername} команду: /link ${token}`,
        });
    });
    app.delete('/telegram/unlink', requireAuth, (request, response) => {
        if (!appConfig.telegramBotEnabled) {
            response.status(503).json({
                code: 'TELEGRAM_BOT_DISABLED',
                message: 'Telegram bot is disabled',
                status: 503,
            });
            return;
        }
        const userId = normalizeText(request.authUser?.id);
        if (!userId) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        localMockTelegramLinks.delete(userId);
        response.status(200).json({
            status: 'unlinked',
            message: 'Telegram отвязан. Уведомления больше не будут приходить в Telegram.',
        });
    });
};
export const registerTelegramRoutes = (params) => {
    const { app, requireAuth, asyncHandler, ensureTelegramSchema, ApiError, dbQuery, normalizeText, isUuidValue, appConfig, getTelegramBotUsername, randomUUID, } = params;
    const generateTelegramLinkToken = () => randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
    app.get('/telegram/status', requireAuth, asyncHandler(async (request, response) => {
        if (!appConfig.telegramBotEnabled) {
            response.status(503).json({
                code: 'TELEGRAM_BOT_DISABLED',
                message: 'Telegram bot is disabled',
                status: 503,
            });
            return;
        }
        await ensureTelegramSchema();
        const userId = normalizeText(request.authUser?.id);
        if (!isUuidValue(userId)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const result = await dbQuery(`select coalesce(telegram_chat_id, '') as telegram_chat_id
       from app_users
       where id = $1::uuid
       limit 1`, [userId]);
        if (result.rows.length === 0) {
            throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
        }
        const chatId = normalizeText(result.rows[0]?.telegram_chat_id);
        response.status(200).json({
            linked: Boolean(chatId),
            chatId: chatId || null,
        });
    }));
    app.post('/telegram/link-token', requireAuth, asyncHandler(async (request, response) => {
        if (!appConfig.telegramBotEnabled) {
            response.status(503).json({
                code: 'TELEGRAM_BOT_DISABLED',
                message: 'Telegram bot is disabled',
                status: 503,
            });
            return;
        }
        await ensureTelegramSchema();
        const userId = normalizeText(request.authUser?.id);
        if (!isUuidValue(userId)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const token = generateTelegramLinkToken();
        await dbQuery(`delete from telegram_link_tokens
       where user_id = $1::uuid
         and used_at is null`, [userId]);
        await dbQuery(`insert into telegram_link_tokens(
       user_id,
       token,
       created_at,
       expires_at
     )
     values($1::uuid, $2, now(), now() + interval '10 minutes')`, [userId, token]);
        const botUsername = normalizeText(getTelegramBotUsername()) || normalizeText(appConfig.telegramBotUsername) || 'NovinzhstroyBot';
        response.status(200).json({
            token,
            expiresIn: 600,
            botUsername,
            instruction: `Отправьте боту @${botUsername} команду: /link ${token}`,
        });
    }));
    app.delete('/telegram/unlink', requireAuth, asyncHandler(async (request, response) => {
        if (!appConfig.telegramBotEnabled) {
            response.status(503).json({
                code: 'TELEGRAM_BOT_DISABLED',
                message: 'Telegram bot is disabled',
                status: 503,
            });
            return;
        }
        await ensureTelegramSchema();
        const userId = normalizeText(request.authUser?.id);
        if (!isUuidValue(userId)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        await dbQuery(`update app_users
       set telegram_chat_id = null
       where id = $1::uuid`, [userId]);
        response.status(200).json({
            status: 'unlinked',
            message: 'Telegram отвязан. Уведомления больше не будут приходить в Telegram.',
        });
    }));
};
