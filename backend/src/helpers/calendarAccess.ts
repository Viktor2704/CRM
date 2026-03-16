import { dbQuery } from '../db.js';
import { appendActorScopeCondition } from './actorAccess.js';
import { isUuidValue } from './normalize.js';
import { roleAllowsGlobalBinding } from '../types.js';

type ScopeParams = {
    actorUserId: string;
    actorRole: string;
    conditions: string[];
    values: unknown[];
};

export const appendCalendarRequestScopeCondition = async ({
    actorUserId,
    actorRole,
    conditions,
    values,
}: ScopeParams) => {
    await appendActorScopeCondition({
        actorUserId,
        actorRole,
        conditions,
        values,
        queryFn: dbQuery,
        tableAlias: 'r',
        tenantIdColumn: 'tenant_id',
        directionIdColumn: 'direction_id',
        createdByIdColumn: 'created_by_id',
        executorIdsColumn: 'executor_ids',
        curatorIdColumn: 'curator_id',
        includeDirectionBindings: true,
        includeProjectBindings: false,
    });
};

export const appendMaintenancePlanScopeCondition = ({
    actorUserId,
    actorRole,
    conditions,
    values,
}: ScopeParams) => {
    if (roleAllowsGlobalBinding(actorRole)) {
        return;
    }
    if (actorRole === 'executor' && isUuidValue(actorUserId)) {
        values.push(actorUserId);
        conditions.push(`$${values.length}::text = any(coalesce(mp.default_executor_ids, '{}'::text[]))`);
        return;
    }
    conditions.push('false');
};
