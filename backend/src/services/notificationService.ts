import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';
import { canSendEmails } from './mailService.js';
import { pushTelegramNotification } from './telegramNotifier.js';
import { isEmailValue, isUuidValue, normalizeText } from '../helpers/normalize.js';
import { filterNotificationRecipientIdsByEntityScope } from '../helpers/notificationRecipientScope.js';
import { clientRecipientRoles } from '../helpers/roles.js';
import { sendServiceRequestEmail } from '../helpers/emailTemplates.js';
import { createOpaqueToken } from '../security.js';
import { mapNotificationRow } from '../helpers/mappers.js';
import { publishNotificationEvent } from './notificationEvents.js';
import { appConfig } from '../config.js';

const resolveAppBaseUrl = () => {
    return appConfig.appUrl || appConfig.frontendUrl;
};

export const dispatchServiceRequestCreationNotifications = async (request, serviceRequestRows) => {
    if (!Array.isArray(serviceRequestRows) || serviceRequestRows.length === 0) {
        return;
    }
    const normalizedRows = serviceRequestRows.map((row) => ({
        id: normalizeText(row?.id),
        title: normalizeText(row?.title),
        description: normalizeText(row?.description),
        priority: normalizeText(row?.priority) || 'medium',
        status: normalizeText(row?.status) || 'new',
        directionId: normalizeText(row?.direction_id ?? row?.directionId),
        tenantId: normalizeText(row?.tenant_id ?? row?.tenantId),
        bulkId: normalizeText(row?.bulk_id ?? row?.bulkId),
        itemIds: Array.isArray(row?.item_ids) ? row.item_ids.map((v) => normalizeText(v)).filter(Boolean)
            : Array.isArray(row?.itemIds) ? row.itemIds.map((v) => normalizeText(v)).filter(Boolean) : [],
        executorIds: Array.isArray(row?.executor_ids)
            ? row.executor_ids.map((value) => normalizeText(value)).filter(Boolean)
            : Array.isArray(row?.executorIds)
                ? row.executorIds.map((value) => normalizeText(value)).filter(Boolean)
                : [],
    }));
    const directionIds = Array.from(new Set(normalizedRows
        .map((item) => item.directionId)
        .filter((value) => isUuidValue(value))));
    const directionMetaById = new Map();
    if (directionIds.length > 0) {
        const directionMetaResult = await dbQuery(`select
         d.id::text as id,
         coalesce(d.name, '') as name,
         coalesce(d.address, '') as address,
         coalesce(d.tenant_id, '') as tenant_id,
         coalesce(t.brand_name, t.name, '') as tenant_name
       from directions d
       left join tenants t on t.id::text = d.tenant_id
       where d.id = any($1::uuid[])
         and d.deleted_at is null`, [directionIds]);
        for (const row of directionMetaResult.rows) {
            const id = normalizeText(row.id);
            if (!id) {
                continue;
            }
            directionMetaById.set(id, {
                directionName: normalizeText(row.name),
                directionAddress: normalizeText(row.address),
                tenantId: normalizeText(row.tenant_id),
                tenantName: normalizeText(row.tenant_name),
            });
        }
    }
    const enrichedRows = normalizedRows.map((item) => {
        const meta = directionMetaById.get(item.directionId) ?? null;
        return {
            ...item,
            directionName: normalizeText(meta?.directionName),
            directionAddress: normalizeText(meta?.directionAddress),
            tenantId: item.tenantId || normalizeText(meta?.tenantId),
            tenantName: normalizeText(meta?.tenantName),
        };
    });
    // Если tenantId не найден через направление — ищем через объекты (maintenance_items)
    const rowsWithoutTenant = enrichedRows.filter((r) => !isUuidValue(r.tenantId) && r.itemIds.length > 0);
    if (rowsWithoutTenant.length > 0) {
        const allItemIds = Array.from(new Set(rowsWithoutTenant.flatMap((r) => r.itemIds).filter((v) => isUuidValue(v))));
        if (allItemIds.length > 0) {
            const itemTenantResult = await dbQuery(`
                SELECT id::text as id, tenant_id::text as tenant_id
                FROM maintenance_items
                WHERE id = any($1::uuid[]) AND deleted_at IS NULL AND tenant_id IS NOT NULL
            `, [allItemIds]);
            const tenantByItemId = new Map<string, string>();
            for (const row of itemTenantResult.rows) {
                if (row.id && row.tenant_id) tenantByItemId.set(row.id, row.tenant_id);
            }
            for (const row of rowsWithoutTenant) {
                const foundTenantId = row.itemIds.map((id) => tenantByItemId.get(id)).find((v) => v);
                if (foundTenantId) row.tenantId = foundTenantId;
            }
        }
    }
    // Collect admin/manager/dispatcher IDs once for deduplication in subsequent blocks
    let adminRecipientIds: string[] = [];
    try {
        const firstRow = enrichedRows[0];
        const title = enrichedRows.length > 1
            ? `Создано сервисных заявок: ${enrichedRows.length}`
            : `Создана сервисная заявка: ${firstRow.title || firstRow.id}`;
        const body = firstRow.description || 'Создана новая сервисная заявка';
        const entityType = enrichedRows.length > 1 ? 'service_request_bulk' : 'service_request';
        const entityId = enrichedRows.length > 1
            ? (firstRow.bulkId || firstRow.id)
            : firstRow.id;
        const adminRecipientResult = await dbQuery(`select id::text as id
         from app_users
         where role::text in ('admin', 'manager', 'dispatcher')
           and status::text = 'active'`);
        adminRecipientIds = adminRecipientResult.rows
            .map((row) => normalizeText(row.id))
            .filter((value) => isUuidValue(value));
        if (adminRecipientIds.length > 0) {
            await pushInAppNotification({
                recipientIds: adminRecipientIds,
                eventType: 'service_request_created',
                title,
                body,
                entityType,
                entityId,
            });
        }
    }
    catch (error) {
        logger.error('Failed to create admin in-app notifications for service requests', {
            requestId: request.requestId ?? null,
            error: serializeError(error),
        });
    }
    // Notify managers bound to the maintenance objects (via app_user_object_bindings)
    try {
        const allItemIds = Array.from(new Set(enrichedRows.flatMap((r) => r.itemIds).filter((v) => isUuidValue(v))));
        if (allItemIds.length > 0) {
            const objectBoundUsersResult = await dbQuery(`
                SELECT DISTINCT u.id::text AS user_id,
                       lower(trim(u.email)) AS email,
                       coalesce(nullif(trim(u.full_name), ''), split_part(u.email, '@', 1)) AS full_name
                FROM app_user_object_bindings aob
                JOIN app_users u ON u.id = aob.user_id
                WHERE aob.object_id = ANY($1::uuid[])
                  AND u.status::text = 'active'
            `, [allItemIds]);
            const objectBoundUsers = objectBoundUsersResult.rows.filter((row) => isUuidValue(normalizeText(row.user_id)));
            if (objectBoundUsers.length > 0) {
                const firstRow = enrichedRows[0];
                const title = enrichedRows.length > 1
                    ? `Создано сервисных заявок: ${enrichedRows.length}`
                    : `Создана сервисная заявка: ${firstRow.title || firstRow.id}`;
                const body = firstRow.description || 'Создана новая сервисная заявка';
                const entityType = enrichedRows.length > 1 ? 'service_request_bulk' : 'service_request';
                const entityId = enrichedRows.length > 1
                    ? (firstRow.bulkId || firstRow.id)
                    : firstRow.id;
                // Exclude users already notified as admin/manager/dispatcher to avoid duplicates
                const adminIdSet = new Set(adminRecipientIds);
                const objectBoundUserIds = objectBoundUsers
                    .map((row) => normalizeText(row.user_id))
                    .filter((id) => !adminIdSet.has(id));
                if (objectBoundUserIds.length > 0) {
                    await pushInAppNotification({
                        recipientIds: objectBoundUserIds,
                        eventType: 'service_request_created',
                        title,
                        body,
                        entityType,
                        entityId,
                    });
                }
                // Send email to object-bound managers
                if (canSendEmails()) {
                    const objectBoundUsersWithEmail = objectBoundUsers.filter((row) => {
                        const email = normalizeText(row.email);
                        return email && isEmailValue(email);
                    });
                    for (const recipientRow of objectBoundUsersWithEmail) {
                        for (const req of enrichedRows) {
                            const allowedRecipientIds = await filterNotificationRecipientIdsByEntityScope({
                                recipientIds: [normalizeText(recipientRow.user_id)],
                                entityType: 'service_request',
                                entityId: req.id,
                                queryFn: dbQuery,
                            });
                            if (allowedRecipientIds.length === 0) {
                                continue;
                            }
                            try {
                                await sendServiceRequestEmail({
                                    to: normalizeText(recipientRow.email),
                                    toName: normalizeText(recipientRow.full_name),
                                    subject: `Новая заявка по объекту: ${req.title || req.id}`,
                                    requests: [req],
                                    description: normalizeText(req.description),
                                    directionName: req.directionName,
                                    directionAddress: req.directionAddress,
                                    recipientRole: 'manager',
                                });
                            }
                            catch (emailError) {
                                logger.error('Failed to send object-bound manager service request email', {
                                    requestId: request.requestId ?? null,
                                    recipientEmail: normalizeText(recipientRow.email),
                                    error: serializeError(emailError),
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    catch (error) {
        logger.error('Failed to notify object-bound managers for service requests', {
            requestId: request.requestId ?? null,
            error: serializeError(error),
        });
    }
    try {
        for (const row of enrichedRows) {
            for (const executorId of row.executorIds) {
                if (!isUuidValue(executorId)) {
                    continue;
                }
                await pushInAppNotification({
                    recipientIds: [executorId],
                    eventType: 'service_request_created',
                    title: `Новая заявка на ТО: ${row.title || row.id}`,
                    body: row.description || 'Создана новая сервисная заявка',
                    entityType: 'service_request',
                    entityId: row.id,
                });
            }
        }
    }
    catch (error) {
        logger.error('Failed to create executor in-app notifications for service requests', {
            requestId: request.requestId ?? null,
            error: serializeError(error),
        });
    }
    if (!canSendEmails()) {
        return;
    }
    const executorIds = Array.from(new Set(enrichedRows
        .flatMap((item) => item.executorIds)
        .filter((value) => isUuidValue(value))));
    if (executorIds.length > 0) {
        const recipientResult = await dbQuery(`select
         u.id::text as user_id,
         lower(trim(u.email)) as email,
         coalesce(nullif(trim(u.full_name), ''), split_part(u.email, '@', 1)) as full_name
       from app_users u
       where u.id = any($1::uuid[])
         and u.status::text = 'active'
         and coalesce(trim(u.email), '') <> ''`, [executorIds]);
        const byExecutor = new Map();
        for (const row of enrichedRows) {
            for (const executorId of row.executorIds) {
                if (!isUuidValue(executorId)) {
                    continue;
                }
                const current = byExecutor.get(executorId) ?? [];
                current.push(row);
                byExecutor.set(executorId, current);
            }
        }
        await Promise.all(recipientResult.rows.flatMap((recipientRow) => {
            const userId = normalizeText(recipientRow.user_id);
            const requests = byExecutor.get(userId) ?? [];
            if (requests.length === 0) return [];
            // Отдельное письмо на каждую заявку
            return requests.map(async (req) => {
                const allowedRecipientIds = await filterNotificationRecipientIdsByEntityScope({
                    recipientIds: [userId],
                    entityType: 'service_request',
                    entityId: req.id,
                    queryFn: dbQuery,
                });
                if (allowedRecipientIds.length === 0) {
                    return;
                }
                try {
                    await sendServiceRequestEmail({
                        to: normalizeText(recipientRow.email),
                        toName: normalizeText(recipientRow.full_name),
                        subject: `Новая заявка на ТО: ${req.title || req.id}`,
                        requests: [req],
                        description: normalizeText(req.description),
                        directionName: req.directionName,
                        directionAddress: req.directionAddress,
                        recipientRole: 'executor',
                    });
                }
                catch (error) {
                    logger.error('Failed to send executor service request email', {
                        requestId: request.requestId ?? null,
                        recipientEmail: normalizeText(recipientRow.email),
                        error: serializeError(error),
                    });
                }
            });
        }));
    }
    const tenantIds = Array.from(new Set(enrichedRows
        .map((item) => item.tenantId)
        .filter((value) => isUuidValue(value))));
    logger.info('Service request tenant notification check', { tenantIds, enrichedRowCount: enrichedRows.length });
    if (tenantIds.length === 0) {
        return;
    }
    const tenantRecipientsResult = await dbQuery(`select distinct
       u.id::text as user_id,
       ub.counterparty_id::text as tenant_id,
       lower(trim(u.email)) as email,
       coalesce(nullif(trim(u.full_name), ''), split_part(u.email, '@', 1)) as full_name
     from app_users u
     join app_user_bindings ub on ub.user_id = u.id
     where ub.counterparty_id = any($1::uuid[])
       and u.role::text = any($2::text[])
       and u.status::text = 'active'
       and coalesce(trim(u.email), '') <> ''`, [tenantIds, clientRecipientRoles]);
    logger.info('Tenant user recipients found', { count: tenantRecipientsResult.rows.length, emails: tenantRecipientsResult.rows.map(r => r.email) });
    const requestsByTenant = new Map();
    for (const row of enrichedRows) {
        if (!isUuidValue(row.tenantId)) {
            continue;
        }
        const current = requestsByTenant.get(row.tenantId) ?? [];
        current.push(row);
        requestsByTenant.set(row.tenantId, current);
    }
    // Собираем email адреса привязанных пользователей для дедупликации
    const sentEmails = new Set<string>();
    await Promise.all(tenantRecipientsResult.rows.flatMap((recipientRow) => {
        const userId = normalizeText(recipientRow.user_id);
        const tenantId = normalizeText(recipientRow.tenant_id);
        const requests = requestsByTenant.get(tenantId) ?? [];
        if (requests.length === 0) return [];
        // Отдельное письмо на каждую заявку
        return requests.map(async (req) => {
            const allowedRecipientIds = await filterNotificationRecipientIdsByEntityScope({
                recipientIds: [userId],
                entityType: 'service_request',
                entityId: req.id,
                queryFn: dbQuery,
            });
            if (allowedRecipientIds.length === 0) {
                return;
            }
            try {
                const email = normalizeText(recipientRow.email).toLowerCase();
                if (email) sentEmails.add(email);
                const baseUrl = resolveAppBaseUrl();
                const token = createOpaqueToken();
                await dbQuery(`INSERT INTO service_request_confirmations (request_id, token) VALUES ($1::uuid, $2)`, [req.id, token]);
                const confirmUrl = baseUrl ? `${baseUrl}/api/service-requests/${req.id}/confirm?action=confirm&token=${token}` : '';
                const rescheduleUrl = baseUrl ? `${baseUrl}/api/service-requests/${req.id}/confirm?action=reschedule&token=${token}` : '';
                await sendServiceRequestEmail({
                    to: normalizeText(recipientRow.email),
                    toName: normalizeText(recipientRow.full_name),
                    subject: `Новая заявка по вашему объекту: ${req.title || req.id}`,
                    requests: [req],
                    description: normalizeText(req.description),
                    directionName: req.directionName,
                    directionAddress: req.directionAddress,
                    confirmUrl,
                    rescheduleUrl,
                    recipientRole: 'client',
                });
            }
            catch (error) {
                logger.error('Failed to send client service request email', {
                    requestId: request.requestId ?? null,
                    recipientEmail: normalizeText(recipientRow.email),
                    tenantId,
                    error: serializeError(error),
                });
            }
        });
    }));
    // Отправка на email из tenants.contacts (контактные лица контрагента)
    try {
        const tenantContactsResult = await dbQuery(`select
             id::text as tenant_id,
             contacts
           from tenants
           where id = any($1::uuid[])
             and deleted_at is null
             and contacts is not null`, [tenantIds]);
        for (const tenantRow of tenantContactsResult.rows) {
            const tenantId = normalizeText(tenantRow.tenant_id);
            const requests = requestsByTenant.get(tenantId) ?? [];
            if (requests.length === 0) continue;
            const contacts = Array.isArray(tenantRow.contacts) ? tenantRow.contacts : [];
            for (const contact of contacts) {
                const contactEmail = normalizeText(contact?.email).toLowerCase();
                if (!contactEmail || !isEmailValue(contactEmail)) continue;
                if (sentEmails.has(contactEmail)) continue;
                sentEmails.add(contactEmail);
                const contactName = normalizeText(contact?.fullName) || normalizeText(contact?.full_name) || contactEmail.split('@')[0];
                for (const req of requests) {
                    try {
                        const baseUrl = resolveAppBaseUrl();
                        const token = createOpaqueToken();
                        await dbQuery(`INSERT INTO service_request_confirmations (request_id, token) VALUES ($1::uuid, $2)`, [req.id, token]);
                        const confirmUrl = baseUrl ? `${baseUrl}/api/service-requests/${req.id}/confirm?action=confirm&token=${token}` : '';
                        const rescheduleUrl = baseUrl ? `${baseUrl}/api/service-requests/${req.id}/confirm?action=reschedule&token=${token}` : '';
                        await sendServiceRequestEmail({
                            to: contactEmail,
                            toName: contactName,
                            subject: `Новая заявка по вашему объекту: ${req.title || req.id}`,
                            requests: [req],
                            description: normalizeText(req.description),
                            directionName: req.directionName,
                            directionAddress: req.directionAddress,
                            confirmUrl,
                            rescheduleUrl,
                            recipientRole: 'client',
                        });
                    }
                    catch (error) {
                        logger.error('Failed to send tenant contact service request email', {
                            requestId: request.requestId ?? null,
                            recipientEmail: contactEmail,
                            tenantId,
                            error: serializeError(error),
                        });
                    }
                }
            }
        }
    }
    catch (error) {
        logger.error('Failed to send tenant contacts emails', {
            requestId: request.requestId ?? null,
            error: serializeError(error),
        });
    }
};
export const pushInAppNotification = async (params) => {
    const rawRecipientIds = Array.isArray(params?.recipientIds)
        ? Array.from(new Set(params.recipientIds.map((value) => normalizeText(value)).filter(Boolean)))
        : [];
    if (rawRecipientIds.length === 0) {
        return;
    }
    const eventType = normalizeText(params?.eventType) || 'system_event';
    const title = normalizeText(params?.title);
    const body = normalizeText(params?.body);
    const entityType = normalizeText(params?.entityType);
    const entityId = normalizeText(params?.entityId);
    try {
        const recipientIds = await filterNotificationRecipientIdsByEntityScope({
            recipientIds: rawRecipientIds,
            entityType,
            entityId,
            queryFn: dbQuery,
        });
        if (recipientIds.length === 0) {
            return;
        }
        await Promise.all(recipientIds.map(async (userId) => {
            if (!isUuidValue(userId)) {
                return;
            }
            const insertResult = await dbQuery(`insert into app_notifications(
           user_id,
           event_type,
           title,
           body,
           entity_type,
           entity_id
         )
         values($1::uuid, $2, $3, $4, $5, $6)
         returning *`, [
                userId,
                eventType,
                title,
                body,
                entityType,
                entityId,
            ]);
            if (insertResult.rows.length > 0) {
                publishNotificationEvent({
                    userId,
                    action: 'created',
                    notification: mapNotificationRow(insertResult.rows[0]),
                    timestamp: new Date().toISOString(),
                });
            }
        }));
        /* Telegram notifications disabled for service requests
        void pushTelegramNotification({
            recipientIds,
            eventType,
            title,
            body,
            entityType,
            entityId,
        }).catch((error) => {
            logger.error('pushTelegramNotification failed', {
                eventType,
                entityType,
                entityId,
                error: serializeError(error),
            });
        });
        */
    }
    catch (error) {
        logger.error('pushInAppNotification failed', {
            error: serializeError(error),
        });
    }
};
export const getAdminManagerIds = async () => {
    const result = await dbQuery(`select id::text as id
     from app_users
     where role::text in ('admin', 'manager', 'dispatcher')
       and status::text = 'active'`);
    return result.rows
        .map((row) => normalizeText(row.id))
        .filter((value) => isUuidValue(value));
};
export const pushProjectInAppNotification = async (params) => {
    const projectId = normalizeText(params?.projectId);
    if (!isUuidValue(projectId)) {
        return;
    }
    try {
        const projectResult = await dbQuery(`select
         created_by_id,
         coalesce(executor_ids, '{}'::text[]) as executor_ids,
         tenant_id
       from requests
       where id = $1::uuid
       limit 1`, [projectId]);
        if (projectResult.rows.length === 0) {
            return;
        }
        const row = projectResult.rows[0];
        const recipientIds = new Set();
        if (Array.isArray(row.executor_ids)) {
            for (const executorId of row.executor_ids) {
                const normalized = normalizeText(executorId);
                if (normalized) {
                    recipientIds.add(normalized);
                }
            }
        }
        const createdById = normalizeText(row.created_by_id);
        if (createdById) {
            recipientIds.add(createdById);
        }
        const tenantId = normalizeText(row.tenant_id);
        if (isUuidValue(tenantId)) {
            const clientsResult = await dbQuery(`select u.id::text as id
         from app_users u
         join app_user_bindings ub on ub.user_id = u.id
         where ub.counterparty_id = $1::uuid
           and u.status::text = 'active'`, [tenantId]);
            for (const client of clientsResult.rows) {
                const clientId = normalizeText(client.id);
                if (clientId) {
                    recipientIds.add(clientId);
                }
            }
        }
        const adminManagerIds = await getAdminManagerIds();
        for (const userId of adminManagerIds) {
            recipientIds.add(userId);
        }
        const actorUserId = normalizeText(params?.actorUserId);
        if (actorUserId) {
            recipientIds.delete(actorUserId);
        }
        await pushInAppNotification({
            recipientIds: Array.from(recipientIds),
            eventType: normalizeText(params?.eventType) || 'project_update',
            title: normalizeText(params?.title) || 'Обновление по проекту',
            body: normalizeText(params?.body),
            entityType: 'project',
            entityId: String(projectId),
        });
    }
    catch (error) {
        logger.error('pushProjectInAppNotification failed', {
            projectId,
            error: serializeError(error),
        });
    }
};
export const dispatchContractorTenantNotifications = async ({
    tenantId,
    entityType,
    entityId,
    title,
    body,
    eventType,
    actorUserId,
    requestContext,
}: {
    tenantId: string;
    entityType: string;
    entityId: string;
    title: string;
    body: string;
    eventType: string;
    actorUserId?: string;
    requestContext?: any;
}) => {
    if (!isUuidValue(tenantId) || !isUuidValue(entityId)) {
        return;
    }
    try {
        // Find managers bound to this contractor tenant
        const managerResult = await dbQuery(`
            SELECT DISTINCT u.id::text AS user_id,
                   lower(trim(u.email)) AS email,
                   coalesce(nullif(trim(u.full_name), ''), split_part(u.email, '@', 1)) AS full_name
            FROM app_users u
            JOIN app_user_bindings ub ON ub.user_id = u.id
            WHERE ub.counterparty_id = $1::uuid
              AND u.role::text IN ('client_manager', 'manager')
              AND u.status::text = 'active'
        `, [tenantId]);
        const managers = managerResult.rows.filter((row) => isUuidValue(normalizeText(row.user_id)));
        if (managers.length > 0) {
            const managerIds = managers.map((row) => normalizeText(row.user_id));
            const filteredManagerIds = actorUserId
                ? managerIds.filter((id) => id !== normalizeText(actorUserId))
                : managerIds;
            if (filteredManagerIds.length > 0) {
                await pushInAppNotification({
                    recipientIds: filteredManagerIds,
                    eventType,
                    title,
                    body,
                    entityType,
                    entityId,
                });
            }
        }
        // Send email to tenant contacts from tenants.contacts JSONB
        if (canSendEmails()) {
            const tenantContactsResult = await dbQuery(`
                SELECT contacts
                FROM tenants
                WHERE id = $1::uuid
                  AND deleted_at IS NULL
                  AND contacts IS NOT NULL
            `, [tenantId]);
            if (tenantContactsResult.rows.length > 0) {
                const contacts = Array.isArray(tenantContactsResult.rows[0].contacts)
                    ? tenantContactsResult.rows[0].contacts
                    : [];
                for (const contact of contacts) {
                    const contactEmail = normalizeText(contact?.email).toLowerCase();
                    if (!contactEmail || !isEmailValue(contactEmail)) continue;
                    const contactName = normalizeText(contact?.fullName)
                        || normalizeText(contact?.full_name)
                        || contactEmail.split('@')[0];
                    try {
                        await sendServiceRequestEmail({
                            to: contactEmail,
                            toName: contactName,
                            subject: title,
                            requests: [],
                            description: body,
                            directionName: '',
                            directionAddress: '',
                            recipientRole: 'client',
                        });
                    }
                    catch (emailError) {
                        logger.error('Failed to send contractor tenant contact email', {
                            requestId: requestContext?.requestId ?? null,
                            recipientEmail: contactEmail,
                            tenantId,
                            entityType,
                            entityId,
                            error: serializeError(emailError),
                        });
                    }
                }
            }
        }
    }
    catch (error) {
        logger.error('dispatchContractorTenantNotifications failed', {
            tenantId,
            entityType,
            entityId,
            error: serializeError(error),
        });
    }
};
