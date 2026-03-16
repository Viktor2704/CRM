export const registerMockCheckinRoutes = (params) => {
    const {
        app,
        requireAuth,
        ApiError,
        randomUUID,
        normalizeText,
        maintenanceItemViewRoles,
        publicLimiter,
        localMockUsers,
        localMockNotifications,
        localMockCheckins,
        localMockMaintenanceItems,
    } = params;
    app.post('/checkin/:itemId', publicLimiter, (request, response) => {
        const token = normalizeText(request.query?.token ?? request.body?.token);
        if (!token) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Token is required');
        }
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const checkin = {
            id: randomUUID(),
            itemId: normalizeText(request.params.itemId),
            directionId: '',
            userId: normalizeText(body.userId) || 'anonymous',
            userName: normalizeText(body.userName) || '',
            token,
            latitude: typeof body.latitude === 'number' ? body.latitude : null,
            longitude: typeof body.longitude === 'number' ? body.longitude : null,
            checkedInAt: new Date().toISOString(),
        };
        const item = localMockMaintenanceItems.find((candidate) => candidate.id === request.params.itemId);
        const itemName = item ? item.name : request.params.itemId;
        if (item) {
            checkin.directionId = normalizeText(item.directionId);
        }
        localMockCheckins.unshift(checkin);
        for (const user of localMockUsers) {
            if (user.role !== 'admin' && user.role !== 'manager') {
                continue;
            }
            localMockNotifications.push({
                id: randomUUID(),
                userId: user.id,
                eventType: 'checkin',
                title: `Чекин: ${normalizeText(body.userName) || 'Исполнитель'} на объекте "${itemName}"`,
                body: `Время: ${checkin.checkedInAt}`,
                entityType: 'maintenance_item',
                entityId: normalizeText(request.params.itemId),
                isRead: false,
                createdAt: new Date().toISOString(),
            });
        }
        response.status(200).json({
            status: 'checked_in',
            message: `Вы отметились на объекте "${itemName}". Спасибо!`,
            checkin,
        });
    });
    app.get('/checkins/:itemId', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!maintenanceItemViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const itemId = normalizeText(request.params.itemId);
        const items = localMockCheckins
            .filter((checkin) => normalizeText(checkin.itemId) === itemId)
            .slice(0, 100);
        response.status(200).json({
            items,
            total: items.length,
        });
    });
};

export const registerCheckinRoutes = (params) => {
    const {
        app,
        requireAuth,
        asyncHandler,
        ensureMaintenanceItemSchema,
        ensureNotificationSchema,
        ApiError,
        dbQuery,
        normalizeText,
        parseUuidPath,
        publicLimiter,
        getAdminManagerIds,
        pushInAppNotification,
        logger,
        serializeError,
    } = params;
    app.post('/checkin/:itemId', publicLimiter, asyncHandler(async (request, response) => {
    await ensureMaintenanceItemSchema();
    await ensureNotificationSchema();
    const itemId = parseUuidPath(request.params.itemId);
    const token = normalizeText(request.query?.token ?? request.body?.token);
    if (!token) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Token is required');
    }
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const userId = normalizeText(body.userId) || 'anonymous';
    const userName = normalizeText(body.userName);
    const latitude = typeof body.latitude === 'number' ? body.latitude : null;
    const longitude = typeof body.longitude === 'number' ? body.longitude : null;
    const itemResult = await dbQuery(`select
       coalesce(name, '') as name,
       coalesce(direction_id, '') as direction_id
     from maintenance_items
     where id = $1::uuid
       and deleted_at is null
     limit 1`, [itemId]);
    if (itemResult.rows.length === 0) {
        throw new ApiError(404, 'ITEM_NOT_FOUND', 'Maintenance item not found');
    }
    const itemName = normalizeText(itemResult.rows[0]?.name) || `объект ${itemId}`;
    const directionId = normalizeText(itemResult.rows[0]?.direction_id);
    const result = await dbQuery(`insert into checkins(
       item_id,
       direction_id,
       user_id,
       user_name,
       token,
       latitude,
       longitude
     )
     values($1::uuid, $2, $3, $4, $5, $6, $7)
     returning *`, [
        itemId,
        directionId,
        userId,
        userName,
        token,
        latitude,
        longitude,
    ]);
    const row = result.rows[0];
    void (async () => {
        try {
            const adminIds = await getAdminManagerIds();
            const gpsText = latitude !== null && longitude !== null ? `, GPS: ${latitude},${longitude}` : '';
            await pushInAppNotification({
                recipientIds: adminIds,
                eventType: 'checkin',
                title: `Чекин: ${userName || 'Исполнитель'} на "${itemName}"`,
                body: `Время: ${row?.checked_in_at ? new Date(row.checked_in_at).toISOString() : new Date().toISOString()}${gpsText}`,
                entityType: 'maintenance_item',
                entityId: String(itemId),
            });
        }
        catch (error) {
            logger.error('Checkin notify failed', {
                itemId: String(itemId),
                error: serializeError(error),
            });
        }
    })();
    response.status(200).json({
        status: 'checked_in',
        message: `Вы отметились на объекте "${itemName}". Спасибо!`,
        checkin: {
            id: normalizeText(row?.id),
            itemId: String(itemId),
            userName,
            checkedInAt: row?.checked_in_at ? new Date(row.checked_in_at).toISOString() : new Date().toISOString(),
        },
    });
    }));
    app.get('/checkins/:itemId', requireAuth, asyncHandler(async (request, response) => {
    await ensureMaintenanceItemSchema();
    const itemId = parseUuidPath(request.params.itemId);
    const result = await dbQuery(`select *
     from checkins
     where item_id = $1::uuid
     order by checked_in_at desc
     limit 100`, [itemId]);
    const items = result.rows.map((row) => ({
        id: normalizeText(row.id),
        itemId: normalizeText(row.item_id),
        directionId: normalizeText(row.direction_id),
        userId: normalizeText(row.user_id),
        userName: normalizeText(row.user_name),
        latitude: row.latitude ?? null,
        longitude: row.longitude ?? null,
        checkedInAt: row.checked_in_at ? new Date(row.checked_in_at).toISOString() : '',
    }));
    response.status(200).json({
        items,
        total: items.length,
    });
    }));
};
