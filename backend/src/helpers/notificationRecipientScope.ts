import { dbQuery } from '../db.js';
import { CLIENT_ROLES } from '../types.js';
import { appendActorScopeCondition, getActorAccessContext } from './actorAccess.js';
import { canActorAccessAccessRequest } from './accessRequestAccess.js';
import { canActorAccessDirection, canActorAccessMaintenanceItem } from './directionAccess.js';
import { isUuidValue, normalizeText } from './normalize.js';
import { appendProjectScopeCondition } from './projectHelpers.js';
import { projectAdminRoles, serviceRequestManageRoles } from './roles.js';

const safeQueryRows = async (queryFn, text, values = []) => {
    try {
        const result = await queryFn(text, values);
        return Array.isArray(result?.rows) ? result.rows : [];
    }
    catch (error) {
        if (error?.code === '42P01' || error?.code === '42703') {
            return [];
        }
        throw error;
    }
};

const canActorAccessServiceRequest = async ({ actorUserId, actorRole, requestId, queryFn = dbQuery }) => {
    if (!isUuidValue(requestId)) {
        return false;
    }
    const conditions = [
        `r.id = $1::uuid`,
        `r.type <> 'installation'`,
        `r.deleted_at is null`,
    ];
    const values = [requestId];
    await appendActorScopeCondition({
        actorUserId,
        actorRole,
        conditions,
        values,
        queryFn,
        tableAlias: 'r',
        tenantIdColumn: 'tenant_id',
        directionIdColumn: 'direction_id',
        createdByIdColumn: 'created_by_id',
        executorIdsColumn: 'executor_ids',
        curatorIdColumn: 'curator_id',
        includeDirectionBindings: true,
        includeProjectBindings: false,
    });
    const rows = await safeQueryRows(queryFn, `select 1
       from requests r
       where ${conditions.join(' and ')}
       limit 1`, values);
    return rows.length > 0;
};

const canActorAccessProjectLike = async ({ actorUserId, actorRole, requestId, isProject, queryFn = dbQuery }) => {
    if (!isUuidValue(requestId)) {
        return false;
    }
    const conditions = [
        `r.id = $1::uuid`,
        `r.type = 'installation'`,
        `coalesce(r.is_project, false) = ${isProject ? 'true' : 'false'}`,
        `r.deleted_at is null`,
    ];
    const values = [requestId];
    await appendProjectScopeCondition({
        actorUserId,
        actorRole,
        conditions,
        values,
        queryFn,
    });
    const rows = await safeQueryRows(queryFn, `select 1
       from requests r
       where ${conditions.join(' and ')}
       limit 1`, values);
    return rows.length > 0;
};

const canActorAccessTenant = async ({ actorUserId, actorRole, tenantId, queryFn = dbQuery }) => {
    if (!isUuidValue(tenantId)) {
        return false;
    }
    const context = await getActorAccessContext({
        actorUserId,
        actorRole,
        queryFn,
    });
    if (context.isGlobalInternal) {
        return true;
    }
    return context.isClientScoped && context.counterpartyId === tenantId;
};

const canUserAccessNotificationEntity = async ({ userId, role, entityType, entityId, queryFn = dbQuery }) => {
    const normalizedEntityType = normalizeText(entityType).toLowerCase();
    const normalizedEntityId = normalizeText(entityId);
    const normalizedRole = normalizeText(role).toLowerCase();
    if (!normalizedEntityType) {
        return true;
    }
    if (!normalizedEntityId) {
        return true;
    }
    switch (normalizedEntityType) {
        case 'service_request':
            return canActorAccessServiceRequest({
                actorUserId: userId,
                actorRole: normalizedRole,
                requestId: normalizedEntityId,
                queryFn,
            });
        case 'project':
            return canActorAccessProjectLike({
                actorUserId: userId,
                actorRole: normalizedRole,
                requestId: normalizedEntityId,
                isProject: true,
                queryFn,
            });
        case 'installation':
            return canActorAccessProjectLike({
                actorUserId: userId,
                actorRole: normalizedRole,
                requestId: normalizedEntityId,
                isProject: false,
                queryFn,
            });
        case 'direction':
            return canActorAccessDirection({
                actorUserId: userId,
                actorRole: normalizedRole,
                directionId: normalizedEntityId,
                queryFn,
            });
        case 'maintenance_item':
            return canActorAccessMaintenanceItem({
                actorUserId: userId,
                actorRole: normalizedRole,
                itemId: normalizedEntityId,
                queryFn,
            });
        case 'access_request':
            return canActorAccessAccessRequest({
                actorUserId: userId,
                actorRole: normalizedRole,
                accessRequestId: normalizedEntityId,
                queryFn,
            });
        case 'tenant':
            return canActorAccessTenant({
                actorUserId: userId,
                actorRole: normalizedRole,
                tenantId: normalizedEntityId,
                queryFn,
            });
        case 'service_request_bulk':
            return projectAdminRoles.has(normalizedRole) || serviceRequestManageRoles.has(normalizedRole);
        case 'maintenance_plan':
        case 'maintenance_generation_run':
        case 'calendar_event':
        case 'dashboard':
            return !CLIENT_ROLES.has(normalizedRole);
        default:
            return true;
    }
};

export const filterNotificationRecipientIdsByEntityScope = async ({ recipientIds, entityType, entityId, queryFn = dbQuery }) => {
    const normalizedRecipientIds = Array.isArray(recipientIds)
        ? Array.from(new Set(recipientIds.map((value) => normalizeText(value)).filter((value) => isUuidValue(value))))
        : [];
    if (normalizedRecipientIds.length === 0) {
        return [];
    }
    const normalizedEntityType = normalizeText(entityType);
    const normalizedEntityId = normalizeText(entityId);
    if (!normalizedEntityType || !normalizedEntityId) {
        return normalizedRecipientIds;
    }
    const users = await safeQueryRows(queryFn, `select
         id::text as id,
         role::text as role
       from app_users
       where id = any($1::uuid[])
         and status::text = 'active'`, [normalizedRecipientIds]);
    const allowedIds = [];
    for (const user of users) {
        const userId = normalizeText(user.id);
        if (!userId) {
            continue;
        }
        if (await canUserAccessNotificationEntity({
            userId,
            role: normalizeText(user.role),
            entityType: normalizedEntityType,
            entityId: normalizedEntityId,
            queryFn,
        })) {
            allowedIds.push(userId);
        }
    }
    return allowedIds;
};
