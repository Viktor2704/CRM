export const registerMockNotificationRoutes = (params) => {
    const { app, requireAuth, ApiError, normalizeText, localMockNotifications, } = params;
    app.get(['/notifications/unread-count', '/app-notifications/unread-count'], requireAuth, (request, response) => {
        const userId = normalizeText(request.authUser?.id);
        const count = localMockNotifications.filter((item) => item.userId === userId && item.isRead !== true).length;
        response.status(200).json({ count });
    });
    app.post(['/notifications/read-all', '/app-notifications/read-all'], requireAuth, (request, response) => {
        const userId = normalizeText(request.authUser?.id);
        localMockNotifications.forEach((item) => {
            if (item.userId === userId) {
                item.isRead = true;
            }
        });
        response.status(200).json({ updated: true });
    });
    app.patch(['/notifications/:notificationId/read', '/app-notifications/:notificationId/read'], requireAuth, (request, response) => {
        const userId = normalizeText(request.authUser?.id);
        const notification = localMockNotifications.find((item) => item.id === request.params.notificationId && item.userId === userId);
        if (!notification) {
            throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
        }
        notification.isRead = true;
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
    const { app, requireAuth, requireAdminLike, asyncHandler, ensureNotificationSchema, ApiError, dbQuery, normalizeText, isUuidValue, parseUuidPath, parsePositiveInt, mapNotificationRow, projectNotificationStrictAccess, projectDataLookupMode, hasProjectScopeDatabase, allowedTicketNotifierRoles, projectEventRequireComment, projectEventRequireQuestions, projectEventRequireResolution, ticketClientEventSchema, validateProjectEventPayload, resolveProjectIdFromNotificationPayload, ensureInstallationProjectExists, ensureActorHasProjectAccess, resolveRecipientForNotification, sendTicketClientNotification, sendTenantEventNotification, } = params;
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
    app.post(['/notifications/read-all', '/app-notifications/read-all'], requireAuth, asyncHandler(async (request, response) => {
        await ensureNotificationSchema();
        const userId = normalizeText(request.authUser?.id);
        if (!isUuidValue(userId)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        await dbQuery(`update app_notifications
       set is_read = true
       where user_id = $1::uuid
         and is_read = false`, [userId]);
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
        response.status(200).json(mapNotificationRow(result.rows[0]));
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
                    'recipient.clientId',
                    'recipient.client_id',
                    'meta.clientId',
                    'meta.client_id',
                    'meta.counterpartyId',
                    'meta.counterparty_id',
                ],
                source: 'app_users + app_user_bindings + tenants',
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
        const recipient = await resolveRecipientForNotification(payload);
        if (!recipient.email) {
            throw new ApiError(422, 'RECIPIENT_EMAIL_REQUIRED', 'recipient.email or recipient.clientId is required');
        }
        const normalizedPayload = {
            ...payload,
            projectId,
            suppressOutsideWorkHours: payload.suppressOutsideWorkHours ?? true,
            recipient,
            ticket: {
                ...(payload.ticket ?? {}),
                id: payload.ticket?.id ?? projectId,
            },
            meta: {
                ...(payload.meta ?? {}),
                projectId,
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
        const payload = ticketClientEventSchema.parse(request.body);
        const eventType = normalizeText(payload.eventType).toLowerCase();
        if (eventType.startsWith('project_')) {
            throw new ApiError(422, 'TICKET_EVENT_TYPE_INVALID', 'ticket-event does not accept project_* eventType');
        }
        const recipient = await resolveRecipientForNotification(payload);
        if (!recipient.email) {
            throw new ApiError(422, 'RECIPIENT_EMAIL_REQUIRED', 'recipient.email or recipient.clientId is required');
        }
        const result = await sendTicketClientNotification({
            ...payload,
            suppressOutsideWorkHours: payload.suppressOutsideWorkHours ?? true,
            recipient,
            scope: 'ticket',
            actorUserId: request.authUser?.id ?? null,
            actorRole,
            requestId: request.requestId ?? null,
            ip: request.ip ?? null,
        });
        response.status(202).json({
            status: 'accepted',
            ...result,
        });
    }));
    app.post('/notifications/tenant-event', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        const result = await sendTenantEventNotification(request, request.body ?? {});
        response.status(202).json(result);
    }));
};
