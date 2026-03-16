export const registerMockNotificationRoutes = (params) => {
    const {
        app,
        requireAuth,
        ApiError,
        normalizeText,
        localMockNotifications,
        resolveStreamAuthUser,
        subscribeNotificationEvent,
    } = params;
    const sendSseEvent = (response, eventName, payload) => {
        if (response.writableEnded) {
            return;
        }
        response.write(`event: ${eventName}\n`);
        response.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    app.get(['/notifications/unread-count', '/app-notifications/unread-count'], requireAuth, (request, response) => {
        const userId = normalizeText(request.authUser?.id);
        const count = localMockNotifications.filter((item) => item.userId === userId && item.isRead !== true).length;
        response.status(200).json({ count });
    });
    app.get('/notifications/stream', async (request, response) => {
        request.authUser = await resolveStreamAuthUser(request);
        const userId = normalizeText(request.authUser?.id);
        const unreadCount = localMockNotifications.filter((item) => item.userId === userId && item.isRead !== true).length;
        response.status(200);
        response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache, no-transform');
        response.setHeader('Connection', 'keep-alive');
        response.setHeader('X-Accel-Buffering', 'no');
        if (typeof response.flushHeaders === 'function') {
            response.flushHeaders();
        }
        sendSseEvent(response, 'ready', {
            ok: true,
            unreadCount,
            timestamp: new Date().toISOString(),
        });
        const unsubscribe = subscribeNotificationEvent(userId, (payload) => {
            sendSseEvent(response, 'notification_changed', payload);
        });
        const heartbeat = setInterval(() => {
            if (response.writableEnded) {
                return;
            }
            response.write(': ping\n\n');
        }, 25000);
        request.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
        });
    });
    app.post(['/notifications/read-all', '/app-notifications/read-all'], requireAuth, (request, response) => {
        const userId = normalizeText(request.authUser?.id);
        let changed = false;
        localMockNotifications.forEach((item) => {
            if (item.userId === userId && item.isRead !== true) {
                item.isRead = true;
                changed = true;
            }
        });
        if (changed) {
            params.publishNotificationEvent?.({
                userId,
                action: 'read_all',
                timestamp: new Date().toISOString(),
            });
        }
        response.status(200).json({ updated: true });
    });
    app.patch(['/notifications/:notificationId/read', '/app-notifications/:notificationId/read'], requireAuth, (request, response) => {
        const userId = normalizeText(request.authUser?.id);
        const notification = localMockNotifications.find((item) => item.id === request.params.notificationId && item.userId === userId);
        if (!notification) {
            throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
        }
        notification.isRead = true;
        params.publishNotificationEvent?.({
            userId,
            action: 'read',
            notification,
            timestamp: new Date().toISOString(),
        });
        response.status(200).json(notification);
    });
    app.get(['/notifications', '/app-notifications'], requireAuth, (request, response) => {
        const userId = normalizeText(request.authUser?.id);
        const items = localMockNotifications.filter((item) => item.userId === userId);
        response.status(200).json({
            items,
            total: items.length,
        });
    });
    app.get('/notifications/project-policy', requireAuth, (request, response) => {
        response.status(200).json({
            policyVersion: 'mock',
            scope: 'project_notifications',
            user: {
                id: request.authUser?.id ?? null,
                role: request.authUser?.role ?? null,
                canSendProjectEvents: true,
            },
        });
    });
    app.get('/notifications/project-history', requireAuth, (_request, response) => {
        response.status(200).json({
            events: [],
            items: [],
            total: 0,
            page: 1,
            pageSize: 20,
        });
    });
};

export const registerNotificationRoutes = (params) => {
    const {
        app,
        requireAuth,
        requireAdminLike,
        asyncHandler,
        ensureNotificationSchema,
        ApiError,
        dbQuery,
        normalizeText,
        isUuidValue,
        parseUuidPath,
        parsePositiveInt,
        mapNotificationRow,
        projectNotificationStrictAccess,
        projectDataLookupMode,
        hasProjectScopeDatabase,
        allowedTicketNotifierRoles,
        projectEventRequireComment,
        projectEventRequireQuestions,
        projectEventRequireResolution,
        ticketClientEventSchema,
        validateProjectEventPayload,
        resolveProjectIdFromNotificationPayload,
        ensureInstallationProjectExists,
        ensureActorHasProjectAccess,
        loadProjectTenantId,
        resolveRecipientForNotification,
        sendTicketClientNotification,
        sendTenantEventNotification,
        resolveStreamAuthUser,
        subscribeNotificationEvent,
        publishNotificationEvent,
    } = params;
    const sendSseEvent = (response, eventName, payload) => {
        if (response.writableEnded) {
            return;
        }
        response.write(`event: ${eventName}\n`);
        response.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    app.get(['/notifications/unread-count', '/app-notifications/unread-count'], requireAuth, asyncHandler(async (request, response) => {
    await ensureNotificationSchema();
    const userId = normalizeText(request.authUser?.id);
    if (!isUuidValue(userId)) {
        response.status(200).json({ count: 0 });
        return;
    }
    const result = await dbQuery(`select count(*)::int as count
       from app_notifications
       where user_id = $1::uuid
         and is_read = false`, [userId]);
    response.status(200).json({
        count: Number(result.rows[0]?.count ?? 0),
    });
    }));
    app.get('/notifications/stream', asyncHandler(async (request, response) => {
    await ensureNotificationSchema();
    request.authUser = await resolveStreamAuthUser(request);
    const userId = normalizeText(request.authUser?.id);
    if (!isUuidValue(userId)) {
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
    }
    const unreadResult = await dbQuery(`select count(*)::int as count
       from app_notifications
       where user_id = $1::uuid
         and is_read = false`, [userId]);
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    if (typeof response.flushHeaders === 'function') {
        response.flushHeaders();
    }
    sendSseEvent(response, 'ready', {
        ok: true,
        unreadCount: Number(unreadResult.rows[0]?.count ?? 0),
        timestamp: new Date().toISOString(),
    });
    const unsubscribe = subscribeNotificationEvent(userId, (payload) => {
        sendSseEvent(response, 'notification_changed', payload);
    });
    const heartbeat = setInterval(() => {
        if (response.writableEnded) {
            return;
        }
        response.write(': ping\n\n');
    }, 25000);
    request.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
    });
    }));
    app.post(['/notifications/read-all', '/app-notifications/read-all'], requireAuth, asyncHandler(async (request, response) => {
    await ensureNotificationSchema();
    const userId = normalizeText(request.authUser?.id);
    if (!isUuidValue(userId)) {
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
    }
    const result = await dbQuery(`update app_notifications
       set is_read = true
       where user_id = $1::uuid
         and is_read = false
       returning id::text as id`, [userId]);
    if (result.rows.length > 0) {
        publishNotificationEvent({
            userId,
            action: 'read_all',
            notificationIds: result.rows.map((row) => normalizeText(row.id)).filter(Boolean),
            timestamp: new Date().toISOString(),
        });
    }
    response.status(200).json({ updated: true });
    }));
    app.patch(['/notifications/:notificationId/read', '/app-notifications/:notificationId/read'], requireAuth, asyncHandler(async (request, response) => {
    await ensureNotificationSchema();
    const userId = normalizeText(request.authUser?.id);
    if (!isUuidValue(userId)) {
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
    }
    const notificationId = parseUuidPath(request.params.notificationId);
    const result = await dbQuery(`update app_notifications
       set is_read = true
       where id = $1::uuid
         and user_id = $2::uuid
       returning *`, [notificationId, userId]);
    if (result.rows.length === 0) {
        throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
    }
    const mappedNotification = mapNotificationRow(result.rows[0]);
    publishNotificationEvent({
        userId,
        action: 'read',
        notification: mappedNotification,
        timestamp: new Date().toISOString(),
    });
    response.status(200).json(mappedNotification);
    }));
    app.get(['/notifications', '/app-notifications'], requireAuth, asyncHandler(async (request, response) => {
    await ensureNotificationSchema();
    const userId = normalizeText(request.authUser?.id);
    if (!isUuidValue(userId)) {
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
    }
    const page = parsePositiveInt(request.query?.page, {
        field: 'page',
        defaultValue: 1,
        min: 1,
    });
    const limit = parsePositiveInt(request.query?.limit, {
        field: 'limit',
        defaultValue: 50,
        min: 1,
        max: 200,
    });
    const offset = (page - 1) * limit;
    const countResult = await dbQuery(`select count(*)::int as total
       from app_notifications
       where user_id = $1::uuid`, [userId]);
    const total = Number(countResult.rows[0]?.total ?? 0);
    const result = await dbQuery(`select *
       from app_notifications
       where user_id = $1::uuid
       order by created_at desc
       limit $2::int
       offset $3::int`, [userId, limit, offset]);
    response.status(200).json({
        items: result.rows.map(mapNotificationRow),
        total,
        page,
        limit,
        totalPages: total > 0 ? Math.ceil(total / limit) : 0,
    });
    }));
    app.get('/notifications/project-policy', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = request.authUser?.role ?? '';
    response.status(200).json({
        policyVersion: '2026-02-20',
        scope: 'project_notifications',
        strictAccess: projectNotificationStrictAccess,
        mode: projectDataLookupMode,
        projectsDatabaseConfigured: hasProjectScopeDatabase,
        accessModel: {
            send: projectNotificationStrictAccess ? 'strict' : 'soft_if_no_bindings',
            historyRead: 'strict',
        },
        senderRoles: Array.from(allowedTicketNotifierRoles),
        eventRules: {
            commentRequired: Array.from(projectEventRequireComment),
            questionsRequired: Array.from(projectEventRequireQuestions),
            resolutionRequired: Array.from(projectEventRequireResolution),
            dueNewRequired: ['project_due_changed'],
            disallowedManualEvents: ['project_digest'],
        },
        recipientResolution: {
            acceptedFields: [
                'recipient.email',
                'recipient.userId',
                'recipient.user_id',
                'recipient.clientId',
                'recipient.client_id',
                'meta.userId',
                'meta.user_id',
                'meta.clientId',
                'meta.client_id',
                'meta.counterpartyId',
                'meta.counterparty_id',
            ],
            source: 'scoped app_users + app_user_bindings + tenants.contacts',
        },
        delivery: {
            channels: ['email'],
            digestSlots: ['10:00', '18:00'],
            dedupeWindowMinutes: 5,
        },
        user: {
            id: request.authUser?.id ?? null,
            role: actorRole,
            canSendProjectEvents: allowedTicketNotifierRoles.has(actorRole),
        },
    });
    }));
    app.get('/notifications/project-history', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = request.authUser?.role ?? '';
    if (!allowedTicketNotifierRoles.has(actorRole)) {
        throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view project notification history');
    }
    const projectId = normalizeText(request.query?.projectId);
    if (!projectId) {
        throw new ApiError(422, 'PROJECT_ID_REQUIRED', 'projectId query param is required');
    }
    if (!isUuidValue(projectId)) {
        throw new ApiError(422, 'PROJECT_ID_INVALID', 'projectId must be UUID');
    }
    const pageValue = Number.parseInt(normalizeText(request.query?.page), 10);
    const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;
    const pageSizeValue = Number.parseInt(normalizeText(request.query?.pageSize), 10);
    const pageSize = Number.isFinite(pageSizeValue) && pageSizeValue > 0
        ? Math.min(pageSizeValue, 200)
        : 20;
    await ensureActorHasProjectAccess({
        actorUserId: request.authUser?.id ?? '',
        actorRole,
        projectId,
        allowSoftSkip: false,
    });
    const offset = (page - 1) * pageSize;
    const [countResult, rowsResult] = await Promise.all([
        dbQuery(`select count(*)::int as total
           from app_notification_event_log
           where scope = 'project'
             and project_id = $1::uuid`, [projectId]),
        dbQuery(`select
           id::text as id,
           scope,
           project_id::text as "projectId",
           ticket_id as "ticketId",
           event_type as "eventType",
           severity,
           recipient_email as "recipientEmail",
           recipient_name as "recipientName",
           actor_user_id::text as "actorUserId",
           actor_role as "actorRole",
           request_id as "requestId",
           ip,
           delivery,
           sent,
           reason,
           dedupe_key as "dedupeKey",
           created_at::text as "createdAt"
         from app_notification_event_log
         where scope = 'project'
           and project_id = $1::uuid
         order by created_at desc, id desc
         limit $2::int
         offset $3::int`, [projectId, pageSize, offset]),
    ]);
    response.status(200).json({
        page,
        pageSize,
        total: Number(countResult.rows[0]?.total ?? 0),
        items: rowsResult.rows,
    });
    }));
    app.post('/notifications/project-event', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = request.authUser?.role ?? '';
    if (!allowedTicketNotifierRoles.has(actorRole)) {
        throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to send project notifications');
    }
    const payload = ticketClientEventSchema.parse(request.body);
    const eventType = normalizeText(payload.eventType).toLowerCase();
    if (!eventType.startsWith('project_')) {
        throw new ApiError(422, 'PROJECT_EVENT_TYPE_INVALID', 'project-event requires project_* eventType');
    }
    validateProjectEventPayload(payload, eventType);
    const projectId = resolveProjectIdFromNotificationPayload(payload);
    if (!projectId) {
        throw new ApiError(422, 'PROJECT_ID_REQUIRED', 'projectId is required for project-event');
    }
    if (!isUuidValue(projectId)) {
        throw new ApiError(422, 'PROJECT_ID_INVALID', 'projectId must be UUID');
    }
    await ensureInstallationProjectExists(projectId);
    await ensureActorHasProjectAccess({
        actorUserId: request.authUser?.id ?? '',
        actorRole,
        projectId,
    });
    const projectTenantId = await loadProjectTenantId(projectId);
    if (!isUuidValue(projectTenantId)) {
        throw new ApiError(422, 'PROJECT_TENANT_REQUIRED', 'Project must have tenant scope for client notifications');
    }
    const scopedPayload = {
        ...payload,
        recipient: {
            ...(payload.recipient ?? {}),
            clientId: projectTenantId,
            client_id: projectTenantId,
        },
        meta: {
            ...(payload.meta ?? {}),
            projectId,
            project_id: projectId,
            clientId: projectTenantId,
            client_id: projectTenantId,
            counterpartyId: projectTenantId,
            counterparty_id: projectTenantId,
        },
    };
    const recipient = await resolveRecipientForNotification(scopedPayload);
    if (!recipient.email) {
        throw new ApiError(422, 'RECIPIENT_SCOPE_REQUIRED', 'Scoped recipient is required');
    }
    const normalizedPayload = {
        ...scopedPayload,
        projectId,
        suppressOutsideWorkHours: payload.suppressOutsideWorkHours ?? true,
        recipient,
        ticket: {
            ...(payload.ticket ?? {}),
            id: payload.ticket?.id ?? projectId,
        },
    };
    const result = await sendTicketClientNotification({
        ...normalizedPayload,
        scope: 'project',
        actorUserId: request.authUser?.id ?? null,
        actorRole,
        requestId: request.requestId ?? null,
        ip: request.ip ?? null,
    });
    response.status(202).json({
        status: 'accepted',
        scope: 'project',
        ...result,
    });
    }));
    app.post('/notifications/ticket-event', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = request.authUser?.role ?? '';
    if (!allowedTicketNotifierRoles.has(actorRole)) {
        throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to send ticket notifications');
    }
    throw new ApiError(403, 'TICKET_EVENT_DISABLED', 'Use scoped project-event or tenant-event');
    }));
    app.post('/notifications/tenant-event', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
    const result = await sendTenantEventNotification(request, request.body ?? {});
    response.status(202).json(result);
    }));

    app.get('/notifications/unread-by-entity', requireAuth, asyncHandler(async (request, response) => {
        await ensureNotificationSchema();
        const userId = normalizeText(request.authUser?.id);
        if (!isUuidValue(userId)) {
            response.status(200).json({ counts: {} });
            return;
        }
        const entityType = normalizeText(request.query?.entityType);
        const entityId = normalizeText(request.query?.entityId);
        const conditions = [`user_id = $1::uuid`, `is_read = false`];
        const values: any[] = [userId];
        if (entityType) {
            values.push(entityType);
            conditions.push(`entity_type = $${values.length}`);
        }
        if (entityId) {
            values.push(entityId);
            conditions.push(`entity_id = $${values.length}`);
        }
        const result = await dbQuery(`SELECT entity_type, entity_id, count(*)::int as count
           FROM app_notifications
           WHERE ${conditions.join(' AND ')}
           GROUP BY entity_type, entity_id`, values);
        const counts: Record<string, number> = {};
        for (const row of result.rows) {
            const key = `${row.entity_type}:${row.entity_id}`;
            counts[key] = Number(row.count);
        }
        response.status(200).json({ counts });
    }));

    app.post('/notifications/read-by-entity', requireAuth, asyncHandler(async (request, response) => {
        await ensureNotificationSchema();
        const userId = normalizeText(request.authUser?.id);
        if (!isUuidValue(userId)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const entityType = normalizeText(body.entityType);
        const entityId = normalizeText(body.entityId);
        if (!entityType || !entityId) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'entityType and entityId are required');
        }
        const result = await dbQuery(`UPDATE app_notifications
           SET is_read = true
           WHERE user_id = $1::uuid
             AND entity_type = $2
             AND entity_id = $3
             AND is_read = false
           RETURNING id::text as id`, [userId, entityType, entityId]);
        if (result.rows.length > 0) {
            publishNotificationEvent({
                userId,
                action: 'read_by_entity',
                entityType,
                entityId,
                notificationIds: result.rows.map((row: any) => normalizeText(row.id)).filter(Boolean),
                timestamp: new Date().toISOString(),
            });
        }
        response.status(200).json({ updated: result.rows.length });
    }));

};
