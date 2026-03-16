export const registerMockTelegramRoutes = (params) => {
    const {
        app,
        requireAuth,
        ApiError,
        normalizeText,
        appConfig,
        randomUUID,
        getTelegramBotUsername,
        createTelegramLinkToken,
        localMockTelegramLinks,
        localMockTelegramLinkTokens,
        localMockTelegramNotifications,
    } = params;
    const parsePositiveInt = (value, fallback) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };
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
    app.get('/telegram/notifications', requireAuth, (request, response) => {
        const userId = normalizeText(request.authUser?.id);
        const status = normalizeText(request.query?.status).toLowerCase();
        const limit = Math.max(1, Math.min(100, parsePositiveInt(request.query?.limit, 50)));
        const offset = Math.max(0, parsePositiveInt(request.query?.offset, 0));
        const userItems = localMockTelegramNotifications.filter((item) => normalizeText(item.userId) === userId);
        const filtered = userItems.filter((item) => {
            if (status === 'failed') {
                return normalizeText(item.status) === 'failed';
            }
            if (status === 'sent') {
                return ['sent', 'read'].includes(normalizeText(item.status));
            }
            if (status === 'unread') {
                return !item.readAt && ['sent', 'read'].includes(normalizeText(item.status));
            }
            return true;
        });
        response.status(200).json({
            items: filtered.slice(offset, offset + limit),
            total: filtered.length,
            unreadCount: userItems.filter((item) => !item.readAt && ['sent', 'read'].includes(normalizeText(item.status))).length,
        });
    });
    app.patch('/telegram/notifications/:notificationId/read', requireAuth, (request, response) => {
        const userId = normalizeText(request.authUser?.id);
        const notificationId = normalizeText(request.params?.notificationId);
        const item = localMockTelegramNotifications.find((candidate) => candidate.id === notificationId && normalizeText(candidate.userId) === userId);
        if (item) {
            item.readAt = new Date().toISOString();
            if (normalizeText(item.status) === 'sent') {
                item.status = 'read';
            }
        }
        response.status(200).json({ updated: item ? 1 : 0 });
    });
    app.patch('/telegram/notifications/mark-all-read', requireAuth, (request, response) => {
        const userId = normalizeText(request.authUser?.id);
        let updated = 0;
        for (const item of localMockTelegramNotifications) {
            if (normalizeText(item.userId) !== userId || item.readAt) {
                continue;
            }
            item.readAt = new Date().toISOString();
            if (normalizeText(item.status) === 'sent') {
                item.status = 'read';
            }
            updated += 1;
        }
        response.status(200).json({ updated });
    });
    app.get('/admin/telegram/notifications/failed', requireAuth, (request, response) => {
        const items = localMockTelegramNotifications.filter((item) => normalizeText(item.status) === 'failed');
        response.status(200).json({
            count: items.length,
            items: items.slice(0, 10),
        });
    });
    app.post('/admin/telegram/notifications/retry', requireAuth, (request, response) => {
        const ids = Array.isArray(request.body?.ids) ? request.body.ids.map((item) => normalizeText(item)).filter(Boolean) : [];
        let updated = 0;
        for (const item of localMockTelegramNotifications) {
            if (!ids.includes(item.id)) {
                continue;
            }
            item.status = 'pending';
            item.readAt = null;
            item.sentAt = null;
            item.errorMessage = '';
            item.errorCode = '';
            item.retryCount = 0;
            updated += 1;
        }
        response.status(200).json({ updated });
    });
};

export const registerTelegramRoutes = (params) => {
    const {
        app,
        requireAuth,
        requireAdminLike,
        asyncHandler,
        ensureTelegramSchema,
        ApiError,
        dbQuery,
        normalizeText,
        isUuidValue,
        appConfig,
        getTelegramBotUsername,
        randomUUID,
        listTelegramNotificationsForUser,
        markTelegramNotificationRead,
        markAllTelegramNotificationsRead,
        listFailedTelegramNotifications,
        retryTelegramNotificationItems,
    } = params;
    const generateTelegramLinkToken = () => randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
    const parsePositiveInt = (value, fallback) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };
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
    app.get('/telegram/notifications', requireAuth, asyncHandler(async (request, response) => {
        await ensureTelegramSchema();
        const userId = normalizeText(request.authUser?.id);
        if (!isUuidValue(userId)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const result = await listTelegramNotificationsForUser(userId, {
            status: request.query?.status,
            limit: parsePositiveInt(request.query?.limit, 50),
            offset: parsePositiveInt(request.query?.offset, 0),
        });
        response.status(200).json(result);
    }));
    app.patch('/telegram/notifications/:notificationId/read', requireAuth, asyncHandler(async (request, response) => {
        await ensureTelegramSchema();
        const userId = normalizeText(request.authUser?.id);
        if (!isUuidValue(userId)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const updated = await markTelegramNotificationRead(userId, normalizeText(request.params?.notificationId));
        response.status(200).json({ updated });
    }));
    app.patch('/telegram/notifications/mark-all-read', requireAuth, asyncHandler(async (request, response) => {
        await ensureTelegramSchema();
        const userId = normalizeText(request.authUser?.id);
        if (!isUuidValue(userId)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const updated = await markAllTelegramNotificationsRead(userId);
        response.status(200).json({ updated });
    }));
    app.get('/admin/telegram/notifications/failed', requireAuth, requireAdminLike, asyncHandler(async (_request, response) => {
        await ensureTelegramSchema();
        response.status(200).json(await listFailedTelegramNotifications(10));
    }));
    app.post('/admin/telegram/notifications/retry', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        await ensureTelegramSchema();
        const ids = Array.isArray(request.body?.ids) ? request.body.ids.map((item) => normalizeText(item)).filter(Boolean) : [];
        const updated = await retryTelegramNotificationItems(ids);
        response.status(200).json({ updated });
    }));
};
