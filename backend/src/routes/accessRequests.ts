import { appendAccessRequestOwnershipCondition, canActorDeleteAccessRequest, getAccessRequestActorContext } from '../helpers/accessRequestAccess.js';
import { buildPublicFilePath, extractStorageKeyFromPublicFileUrl } from '../helpers/fileUrls.js';

export const registerAccessRequestRoutes = (params) => {
    const {
        app,
        localMockAuthEnabled,
        requireAuth,
        asyncHandler,
        ensureAccessRequestSchema,
        ApiError,
        dbQuery,
        normalizeText,
        isUuidValue,
        parseUuidPath,
        getAdminManagerIds,
        pushInAppNotification,
        canSendEmails,
        sendSystemEventNotice,
        storeFile,
        parseDataUrlPayload,
    } = params;

    const normalizeAccessRequestFileUrl = (value) => {
        const storageKey = extractStorageKeyFromPublicFileUrl(value);
        if (storageKey) {
            return buildPublicFilePath(storageKey);
        }
        return normalizeText(value);
    };

    // List
    app.get('/access-requests', requireAuth, asyncHandler(async (request, response) => {
        await ensureAccessRequestSchema();
        const actorContext = getAccessRequestActorContext({
            actorUserId: request.authUser?.id,
            actorRole: request.authUser?.role,
        });
        if (!actorContext.isAdminLike && !actorContext.hasOwnedScope) {
            throw new ApiError(401, 'UNAUTHORIZED', 'Invalid authenticated user');
        }
        const status = normalizeText(typeof request.query?.status === 'string' ? request.query.status : '');
        const conditions = ['access_requests.deleted_at IS NULL'];
        const sqlParams: unknown[] = [];
        if (status) {
            sqlParams.push(status);
            conditions.push(`access_requests.status = $${sqlParams.length}`);
        }
        appendAccessRequestOwnershipCondition({
            actorContext,
            conditions,
            values: sqlParams,
            tableAlias: 'access_requests',
        });
        let sql = `SELECT id::text, title, object_name, direction_id::text, file_id, file_name, file_url, expires_at, status, created_by_id::text, notified_24h, created_at
            FROM access_requests
            WHERE ${conditions.join(' AND ')}`;
        sql += ` ORDER BY expires_at ASC`;
        const result = await dbQuery(sql, sqlParams);
        response.status(200).json({ items: result.rows.map((row) => ({
            id: String(row.id ?? ''),
            title: String(row.title ?? ''),
            objectName: String(row.object_name ?? ''),
            directionId: row.direction_id ? String(row.direction_id) : null,
            fileId: row.file_id ? String(row.file_id) : null,
            fileName: row.file_name ? String(row.file_name) : null,
            fileUrl: row.file_url ? normalizeAccessRequestFileUrl(row.file_url) || null : null,
            expiresAt: row.expires_at ? String(row.expires_at).slice(0, 10) : null,
            status: String(row.status ?? 'active'),
            createdById: row.created_by_id ? String(row.created_by_id) : null,
            createdAt: row.created_at ? String(row.created_at).slice(0, 10) : null,
        })) });
    }));

    // Create
    app.post('/access-requests', requireAuth, asyncHandler(async (request, response) => {
        await ensureAccessRequestSchema();
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const title = normalizeText(body.title);
        const objectName = normalizeText(body.objectName ?? '');
        const expiresAt = normalizeText(body.expiresAt);
        const directionId = isUuidValue(normalizeText(body.directionId)) ? normalizeText(body.directionId) : null;
        if (!title) throw new ApiError(400, 'VALIDATION_ERROR', 'title обязателен');
        if (!expiresAt || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) throw new ApiError(400, 'VALIDATION_ERROR', 'expiresAt обязателен (YYYY-MM-DD)');
        const createdById = normalizeText(request.authUser?.id) || null;

        let fileId: string | null = null;
        let fileName: string | null = null;
        let fileUrl: string | null = null;

        if (body.fileDataUrl && body.fileName) {
            const parsed = parseDataUrlPayload({ dataUrl: body.fileDataUrl, fileName: body.fileName });
            const stored = await storeFile({ fileName: parsed.fileName, mimeType: parsed.mimeType, content: parsed.content });
            fileId = stored.id;
            fileName = stored.fileName;
            fileUrl = buildPublicFilePath(stored.storageKey);
        }

        const result = await dbQuery(
            `INSERT INTO access_requests(title, object_name, direction_id, file_id, file_name, file_url, expires_at, created_by_id)
             VALUES($1,$2,$3::uuid,$4,$5,$6,$7::date,$8::uuid)
             RETURNING id::text, title, object_name, expires_at, status, created_at`,
            [title, objectName, directionId, fileId, fileName, fileUrl, expiresAt, createdById]
        );
        const row = result.rows[0];

        // Notify admins
        const adminIds = await getAdminManagerIds();
        void pushInAppNotification({
            recipientIds: adminIds,
            eventType: 'access_request_created',
            title: `Новая заявка на доступ: ${title}`,
            body: `Объект: ${objectName || 'не указан'} | Срок: ${expiresAt}`,
            entityType: 'access_request',
            entityId: String(row.id),
        });

        response.status(201).json({
            id: String(row.id ?? ''),
            title: String(row.title ?? ''),
            objectName: String(row.object_name ?? ''),
            expiresAt: row.expires_at ? String(row.expires_at).slice(0, 10) : null,
            status: String(row.status ?? 'active'),
            fileId, fileName, fileUrl,
            createdAt: row.created_at ? String(row.created_at).slice(0, 10) : null,
        });
    }));

    // Update status
    app.patch('/access-requests/:id', requireAuth, asyncHandler(async (request, response) => {
        await ensureAccessRequestSchema();
        const actorContext = getAccessRequestActorContext({
            actorUserId: request.authUser?.id,
            actorRole: request.authUser?.role,
        });
        if (!actorContext.isAdminLike) {
            throw new ApiError(403, 'FORBIDDEN', 'Only admin or manager can change request status');
        }
        const id = parseUuidPath(request.params.id);
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const status = normalizeText(body.status);
        if (!['active', 'closed', 'extended'].includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'Недопустимый статус');
        const updateResult = await dbQuery(`UPDATE access_requests
               SET status = $2,
                   updated_at = now()
             WHERE id = $1::uuid
               AND deleted_at IS NULL
         RETURNING id::text`, [id, status]);
        if (updateResult.rows.length === 0) {
            throw new ApiError(404, 'ACCESS_REQUEST_NOT_FOUND', 'Access request not found');
        }
        response.status(200).json({ ok: true });
    }));

    // Delete
    app.delete('/access-requests/:id', requireAuth, asyncHandler(async (request, response) => {
        await ensureAccessRequestSchema();
        const id = parseUuidPath(request.params.id);
        const actorContext = getAccessRequestActorContext({
            actorUserId: request.authUser?.id,
            actorRole: request.authUser?.role,
        });
        if (!actorContext.isAdminLike && !actorContext.hasOwnedScope) {
            throw new ApiError(401, 'UNAUTHORIZED', 'Invalid authenticated user');
        }
        const existing = await dbQuery(`SELECT created_by_id::text as created_by_id FROM access_requests WHERE id = $1::uuid AND deleted_at IS NULL LIMIT 1`, [id]);
        const createdById = normalizeText(existing.rows[0]?.created_by_id);
        if (existing.rows.length === 0) {
            throw new ApiError(404, 'ACCESS_REQUEST_NOT_FOUND', 'Access request not found');
        }
        if (!canActorDeleteAccessRequest({
            actorUserId: actorContext.actorUserId,
            actorRole: actorContext.actorRole,
            createdById,
        })) {
            throw new ApiError(403, 'FORBIDDEN', 'You cannot delete this access request');
        }
        await dbQuery(`UPDATE access_requests SET deleted_at=now() WHERE id=$1::uuid`, [id]);
        response.status(204).send();
    }));

    // Scheduler: check expiring in 24h
    const checkExpiring = async () => {
        try {
            await ensureAccessRequestSchema();
            const result = await dbQuery(`
                SELECT id::text, title, object_name, expires_at, created_by_id::text
                FROM access_requests
                WHERE deleted_at IS NULL
                  AND status = 'active'
                  AND notified_24h = false
                  AND expires_at <= (now() + interval '24 hours')::date
                  AND expires_at >= now()::date
            `);
            for (const row of result.rows) {
                const expiresAt = String(row.expires_at).slice(0, 10);
                const title = normalizeText(row.title) || 'Заявка на доступ';
                const objectName = normalizeText(row.object_name) || 'объект не указан';

                // In-app notification
                const adminIds = await getAdminManagerIds();
                const recipientIds = [...adminIds];
                if (isUuidValue(normalizeText(row.created_by_id))) {
                    recipientIds.push(normalizeText(row.created_by_id));
                }
                await pushInAppNotification({
                    recipientIds: Array.from(new Set(recipientIds)),
                    eventType: 'access_request_expiring',
                    title: `Заявка на доступ истекает завтра`,
                    body: `"${title}" — объект: ${objectName} | Срок: ${expiresAt}`,
                    entityType: 'access_request',
                    entityId: String(row.id),
                });

                // Email
                if (canSendEmails()) {
                    const emailsResult = await dbQuery(`SELECT email FROM app_users WHERE role IN ('admin','manager') AND status = 'active' AND deleted_at IS NULL AND coalesce(trim(email),'') <> ''`);
                    for (const emailRow of emailsResult.rows) {
                        await sendSystemEventNotice({
                            to: String(emailRow.email),
                            subject: `Заявка на доступ истекает: ${title}`,
                            body: `Заявка на доступ "${title}" по объекту "${objectName}" истекает ${expiresAt}.\n\nПожалуйста, продлите или закройте заявку в системе.`,
                        }).catch(() => {});
                    }
                }

                // Mark as notified
                await dbQuery(`UPDATE access_requests SET notified_24h=true WHERE id=$1::uuid`, [row.id]);
            }
        } catch { /* best effort */ }
    };

    if (!localMockAuthEnabled) {
        // Run every hour
        setInterval(() => { void checkExpiring(); }, 60 * 60 * 1000);
        // Run once on startup after 10s
        setTimeout(() => { void checkExpiring(); }, 10_000);
    }
};
