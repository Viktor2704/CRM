import { dbQuery } from '../db.js';
import { isUuidValue, normalizeText } from './normalize.js';

type QueryFn = (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;

type AccessRequestActorContext = {
    actorRole: string;
    actorUserId: string;
    isAdminLike: boolean;
    hasOwnedScope: boolean;
};

type AccessRequestScopeParams = {
    actorContext: AccessRequestActorContext;
    conditions: string[];
    values: unknown[];
    tableAlias?: string;
    createdByIdColumn?: string;
};

export const accessRequestAdminRoles = new Set(['admin', 'manager']);

export const isAccessRequestAdminLikeRole = (role: unknown) =>
    accessRequestAdminRoles.has(normalizeText(role).toLowerCase());

export const getAccessRequestActorContext = ({ actorUserId, actorRole }: {
    actorUserId: unknown;
    actorRole: unknown;
}): AccessRequestActorContext => {
    const normalizedActorUserId = normalizeText(actorUserId);
    const normalizedActorRole = normalizeText(actorRole).toLowerCase();
    return {
        actorRole: normalizedActorRole,
        actorUserId: normalizedActorUserId,
        isAdminLike: isAccessRequestAdminLikeRole(normalizedActorRole),
        hasOwnedScope: isUuidValue(normalizedActorUserId),
    };
};

export const appendAccessRequestOwnershipCondition = ({
    actorContext,
    conditions,
    values,
    tableAlias = 'access_requests',
    createdByIdColumn = 'created_by_id',
}: AccessRequestScopeParams) => {
    if (actorContext.isAdminLike) {
        return actorContext;
    }
    if (!actorContext.hasOwnedScope) {
        conditions.push('false');
        return actorContext;
    }
    values.push(actorContext.actorUserId);
    conditions.push(`${tableAlias}.${createdByIdColumn} = $${values.length}::uuid`);
    return actorContext;
};

export const canActorDeleteAccessRequest = ({ actorUserId, actorRole, createdById }: {
    actorUserId: unknown;
    actorRole: unknown;
    createdById: unknown;
}) => {
    const actorContext = getAccessRequestActorContext({
        actorUserId,
        actorRole,
    });
    return actorContext.isAdminLike
        || (actorContext.hasOwnedScope && normalizeText(createdById) === actorContext.actorUserId);
};

export const canActorAccessAccessRequest = async ({
    actorUserId,
    actorRole,
    accessRequestId,
    queryFn = dbQuery,
}: {
    actorUserId: unknown;
    actorRole: unknown;
    accessRequestId: unknown;
    queryFn?: QueryFn;
}) => {
    const actorContext = getAccessRequestActorContext({
        actorUserId,
        actorRole,
    });
    const normalizedAccessRequestId = normalizeText(accessRequestId);
    if (!isUuidValue(normalizedAccessRequestId)) {
        return false;
    }
    if (actorContext.isAdminLike) {
        return true;
    }
    if (!actorContext.hasOwnedScope) {
        return false;
    }
    const result = await queryFn(`select 1
       from access_requests
       where id = $1::uuid
         and deleted_at is null
         and created_by_id = $2::uuid
       limit 1`, [normalizedAccessRequestId, actorContext.actorUserId]);
    return Array.isArray(result?.rows) && result.rows.length > 0;
};
