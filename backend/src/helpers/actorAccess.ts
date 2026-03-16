import { dbQuery } from '../db.js';
import { CLIENT_ROLES, INTERNAL_ASSIGNED_ROLES, roleAllowsGlobalBinding } from '../types.js';
import { isUuidValue, normalizeText } from './normalize.js';

type QueryFn = (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;

type ActorAccessParams = {
    actorUserId: string;
    actorRole: string;
    queryFn?: QueryFn;
};

type AppendScopeParams = ActorAccessParams & {
    conditions: string[];
    values: unknown[];
    tableAlias?: string;
    tenantIdColumn?: string;
    directionIdColumn?: string;
    createdByIdColumn?: string | null;
    executorIdsColumn?: string | null;
    curatorIdColumn?: string | null;
    includeDirectionBindings?: boolean;
    includeProjectBindings?: boolean;
};

type MaintenancePlanAppendScopeParams = ActorAccessParams & {
    conditions: string[];
    values: unknown[];
    tableAlias?: string;
    defaultExecutorIdsColumn?: string;
};

export const buildTenantScopeWithDirectionFallback = ({
    tableAlias = 'r',
    tenantRef,
    tenantIdColumn = 'tenant_id',
    directionIdColumn = 'direction_id',
}: {
    tableAlias?: string;
    tenantRef: string;
    tenantIdColumn?: string;
    directionIdColumn?: string;
}) => `(
  ${tableAlias}.${tenantIdColumn} = ${tenantRef}::text
  or (
    coalesce(${tableAlias}.${tenantIdColumn}, '') = ''
    and exists (
      select 1
      from directions d
      where d.id::text = ${tableAlias}.${directionIdColumn}
        and coalesce(d.tenant_id::text, '') = ${tenantRef}::text
        and d.deleted_at is null
    )
  )
)`;

export const loadActorCounterpartyId = async (actorUserId: string, queryFn: QueryFn = dbQuery) => {
    if (!isUuidValue(actorUserId)) {
        return '';
    }
    const bindingResult = await queryFn(`select counterparty_id::text as counterparty_id
       from app_user_bindings
       where user_id = $1::uuid
       limit 1`, [actorUserId]);
    return normalizeText(bindingResult.rows[0]?.counterparty_id);
};

export const getActorAccessContext = async ({ actorUserId, actorRole, queryFn = dbQuery }: ActorAccessParams) => {
    const role = normalizeText(actorRole);
    const userId = normalizeText(actorUserId);
    const isGlobalInternal = roleAllowsGlobalBinding(role);
    const isAssignedInternal = INTERNAL_ASSIGNED_ROLES.has(role);
    const isClientScoped = CLIENT_ROLES.has(role);
    const counterpartyId = isClientScoped ? await loadActorCounterpartyId(userId, queryFn) : '';
    return {
        role,
        userId,
        counterpartyId,
        isGlobalInternal,
        isAssignedInternal,
        isClientScoped,
    };
};

export const appendActorScopeCondition = async ({
    actorUserId,
    actorRole,
    conditions,
    values,
    queryFn = dbQuery,
    tableAlias = 'r',
    tenantIdColumn = 'tenant_id',
    directionIdColumn = 'direction_id',
    createdByIdColumn = 'created_by_id',
    executorIdsColumn = 'executor_ids',
    curatorIdColumn = 'curator_id',
    includeDirectionBindings = false,
    includeProjectBindings = false,
}: AppendScopeParams) => {
    const context = await getActorAccessContext({
        actorUserId,
        actorRole,
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
        const tenantRef = `$${values.length}`;
        conditions.push(buildTenantScopeWithDirectionFallback({
            tableAlias,
            tenantRef,
            tenantIdColumn,
            directionIdColumn,
        }));
        return context;
    }
    if (context.isAssignedInternal && isUuidValue(context.userId)) {
        values.push(context.userId);
        const actorRef = `$${values.length}`;
        const scopeParts: string[] = [];
        if (createdByIdColumn) {
            scopeParts.push(`${tableAlias}.${createdByIdColumn} = ${actorRef}::text`);
        }
        if (executorIdsColumn) {
            scopeParts.push(`${actorRef}::text = any(coalesce(${tableAlias}.${executorIdsColumn}, '{}'::text[]))`);
        }
        if (curatorIdColumn) {
            scopeParts.push(`${tableAlias}.${curatorIdColumn} = ${actorRef}::text`);
        }
        if (includeProjectBindings) {
            scopeParts.push(`exists (
              select 1
              from app_user_project_bindings upb
              where upb.user_id = ${actorRef}::uuid
                and upb.project_id = ${tableAlias}.id
            )`);
        }
        if (includeDirectionBindings) {
            scopeParts.push(`exists (
              select 1
              from app_user_direction_bindings udb
              where udb.user_id = ${actorRef}::uuid
                and udb.direction_id::text = ${tableAlias}.${directionIdColumn}
            )`);
        }
        conditions.push(scopeParts.length > 0 ? `(${scopeParts.join(' or ')})` : 'false');
        return context;
    }
    conditions.push('false');
    return context;
};

export const appendServiceRequestActorScopeCondition = async ({
    actorUserId,
    actorRole,
    conditions,
    values,
    queryFn = dbQuery,
    tableAlias = 'r',
}: ActorAccessParams & {
    conditions: string[];
    values: unknown[];
    queryFn?: QueryFn;
    tableAlias?: string;
}) => appendActorScopeCondition({
    actorUserId,
    actorRole,
    conditions,
    values,
    queryFn,
    tableAlias,
    tenantIdColumn: 'tenant_id',
    directionIdColumn: 'direction_id',
    createdByIdColumn: 'created_by_id',
    executorIdsColumn: 'executor_ids',
    curatorIdColumn: 'curator_id',
    includeDirectionBindings: true,
    includeProjectBindings: false,
});

export const appendMaintenancePlanActorScopeCondition = ({
    actorUserId,
    actorRole,
    conditions,
    values,
    tableAlias = 'mp',
    defaultExecutorIdsColumn = 'default_executor_ids',
}: MaintenancePlanAppendScopeParams) => {
    const role = normalizeText(actorRole);
    const userId = normalizeText(actorUserId);
    if (roleAllowsGlobalBinding(role)) {
        return;
    }
    if (role === 'executor' && isUuidValue(userId)) {
        values.push(userId);
        conditions.push(`$${values.length}::text = any(coalesce(${tableAlias}.${defaultExecutorIdsColumn}, '{}'::text[]))`);
        return;
    }
    conditions.push('false');
};
