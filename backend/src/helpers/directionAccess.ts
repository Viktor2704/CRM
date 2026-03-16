import { dbQuery } from '../db.js';
import { getActorAccessContext } from './actorAccess.js';
import { isUuidValue, normalizeText } from './normalize.js';

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

export const appendDirectionScopeCondition = async ({ actorUserId, actorRole, conditions, values, queryFn = dbQuery, tableAlias = 'd', directionIdColumn = 'id' }) => {
    const context = await getActorAccessContext({
        actorUserId: normalizeText(actorUserId),
        actorRole: normalizeText(actorRole),
        queryFn,
    });
    if (context.isGlobalInternal) {
        return context;
    }
    if (context.isClientScoped) {
        if (!context.counterpartyId) {
            conditions.push('false');
            return context;
        }
        values.push(context.counterpartyId);
        conditions.push(`${tableAlias}.tenant_id = $${values.length}::text`);
        return context;
    }
    if (context.isAssignedInternal && isUuidValue(context.userId)) {
        values.push(context.userId);
        const actorRef = `$${values.length}`;
        conditions.push(`(
          exists (
            select 1
            from app_user_direction_bindings udb
            where udb.user_id = ${actorRef}::uuid
              and udb.direction_id = ${tableAlias}.${directionIdColumn}
          )
          or exists (
            select 1
            from requests r
            where r.deleted_at is null
              and r.direction_id = ${tableAlias}.${directionIdColumn}::text
              and (
                r.created_by_id = ${actorRef}::text
                or ${actorRef}::text = any(coalesce(r.executor_ids, '{}'::text[]))
                or r.curator_id = ${actorRef}::text
              )
          )
        )`);
        return context;
    }
    conditions.push('false');
    return context;
};

export const canActorAccessDirection = async ({ actorUserId, actorRole, directionId, queryFn = dbQuery }) => {
    if (!isUuidValue(directionId)) {
        return false;
    }
    const conditions = [
        `d.id = $1::uuid`,
        `d.deleted_at is null`,
    ];
    const values = [directionId];
    await appendDirectionScopeCondition({
        actorUserId,
        actorRole,
        conditions,
        values,
        queryFn,
        tableAlias: 'd',
        directionIdColumn: 'id',
    });
    const rows = await safeQueryRows(queryFn, `select 1
       from directions d
       where ${conditions.join(' and ')}
       limit 1`, values);
    return rows.length > 0;
};

export const canActorAccessMaintenanceItem = async ({ actorUserId, actorRole, itemId, queryFn = dbQuery }) => {
    if (!isUuidValue(itemId)) {
        return false;
    }
    const conditions = [
        `mi.id = $1::uuid`,
        `mi.deleted_at is null`,
        `d.deleted_at is null`,
    ];
    const values = [itemId];
    await appendDirectionScopeCondition({
        actorUserId,
        actorRole,
        conditions,
        values,
        queryFn,
        tableAlias: 'd',
        directionIdColumn: 'id',
    });
    const rows = await safeQueryRows(queryFn, `select 1
       from maintenance_items mi
       join directions d on d.id::text = mi.direction_id
       where ${conditions.join(' and ')}
       limit 1`, values);
    return rows.length > 0;
};
