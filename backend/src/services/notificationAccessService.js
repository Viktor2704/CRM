import { dbQuery, hasProjectScopeDatabase, projectScopeQuery } from '../db.js';
import { ApiError } from '../errors.js';
import { logger, serializeError } from '../logger.js';
import { hasAnyText, isEmailValue, isUuidValue, normalizeText } from '../helpers/normalize.js';
import { clientRecipientRoles, projectEventRequireComment, projectEventRequireQuestions, projectEventRequireResolution } from '../helpers/roles.js';
const projectDataLookupMode = hasProjectScopeDatabase ? 'projects_db_then_main_db' : 'main_db_only';
const projectNotificationStrictAccess = ['1', 'true', 'yes', 'on'].includes(String(process.env.PROJECT_NOTIFICATION_STRICT_ACCESS ?? '').trim().toLowerCase());
export const resolveProjectIdFromNotificationPayload = (payload) => {
    const ticket = payload?.ticket && typeof payload.ticket === 'object' ? payload.ticket : {};
    const meta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {};
    const candidates = [
        payload?.projectId,
        payload?.project_id,
        ticket.id,
        meta.projectId,
        meta.project_id,
        meta.ticketId,
        meta.ticket_id,
    ];
    for (const candidate of candidates) {
        const normalized = normalizeText(candidate);
        if (normalized.length > 0) {
            return normalized;
        }
    }
    return '';
};
export const resolveCounterpartyIdFromNotificationPayload = (payload) => {
    const recipient = payload?.recipient && typeof payload.recipient === 'object' ? payload.recipient : {};
    const meta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {};
    const candidates = [
        recipient.clientId,
        recipient.client_id,
        meta.clientId,
        meta.client_id,
        meta.counterpartyId,
        meta.counterparty_id,
    ];
    for (const candidate of candidates) {
        const normalized = normalizeText(candidate);
        if (normalized.length > 0) {
            return normalized;
        }
    }
    return '';
};
export const resolveRecipientFromCounterpartyId = async (counterpartyId) => {
    if (!isUuidValue(counterpartyId)) {
        return null;
    }
    const result = await dbQuery(`select
         lower(trim(u.email)) as email,
         nullif(trim(u.full_name), '') as full_name,
         coalesce(nullif(trim(t.brand_name), ''), nullif(trim(t.name), '')) as tenant_name
       from app_users u
       join app_user_bindings ub on ub.user_id = u.id
       left join tenants t on t.id = ub.counterparty_id
       where ub.counterparty_id = $1::uuid
         and u.status::text = 'active'
         and u.role::text = any($2::text[])
         and coalesce(trim(u.email), '') <> ''
       order by
         case
           when u.role::text = 'client_manager' then 0
           when u.role::text = 'client_user' then 1
           else 2
         end asc,
         u.created_at asc
       limit 1`, [counterpartyId, clientRecipientRoles]);
    const row = result.rows[0];
    if (!row) {
        // Fallback: ищем email в tenants.contacts
        const tenantResult = await dbQuery(`select
             coalesce(nullif(trim(t.brand_name), ''), nullif(trim(t.name), '')) as tenant_name,
             t.contacts
           from tenants t
           where t.id = $1::uuid
             and t.deleted_at is null
           limit 1`, [counterpartyId]);
        const tenantRow = tenantResult.rows[0];
        if (!tenantRow)
            return null;
        const contacts = Array.isArray(tenantRow.contacts) ? tenantRow.contacts : [];
        for (const contact of contacts) {
            const contactEmail = normalizeText(contact?.email).toLowerCase();
            if (contactEmail && isEmailValue(contactEmail)) {
                return {
                    email: contactEmail,
                    fullName: normalizeText(contact?.fullName) || normalizeText(contact?.full_name) || '',
                    tenantName: normalizeText(tenantRow.tenant_name),
                };
            }
        }
        return null;
    }
    const email = normalizeText(row.email).toLowerCase();
    if (!email || !isEmailValue(email)) {
        return null;
    }
    return {
        email,
        fullName: normalizeText(row.full_name),
        tenantName: normalizeText(row.tenant_name),
    };
};
export const resolveActiveUserRecipientById = async (userId) => {
    if (!isUuidValue(userId)) {
        return null;
    }
    const result = await dbQuery(`select
         lower(trim(u.email)) as email,
         nullif(trim(u.full_name), '') as full_name
       from app_users u
       where u.id = $1::uuid
         and u.status::text = 'active'
         and coalesce(trim(u.email), '') <> ''
       limit 1`, [userId]);
    const row = result.rows[0];
    if (!row) {
        return null;
    }
    const email = normalizeText(row.email).toLowerCase();
    if (!email || !isEmailValue(email)) {
        return null;
    }
    return {
        email,
        fullName: normalizeText(row.full_name),
    };
};
export const resolveRecipientForNotification = async (payload) => {
    const recipient = payload?.recipient && typeof payload.recipient === 'object' ? payload.recipient : {};
    const meta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {};
    const explicitEmail = normalizeText(recipient.email).toLowerCase();
    if (explicitEmail && isEmailValue(explicitEmail)) {
        return {
            email: explicitEmail,
            name: normalizeText(recipient.name) || normalizeText(meta.clientName) || normalizeText(meta.client_name) || 'клиент',
        };
    }
    const counterpartyId = resolveCounterpartyIdFromNotificationPayload(payload);
    if (counterpartyId) {
        const fromDb = await resolveRecipientFromCounterpartyId(counterpartyId);
        if (fromDb) {
            return {
                email: fromDb.email,
                name: normalizeText(recipient.name) || fromDb.fullName || fromDb.tenantName || normalizeText(meta.clientName) || normalizeText(meta.client_name) || 'клиент',
            };
        }
    }
    return {
        email: '',
        name: normalizeText(recipient.name) || normalizeText(meta.clientName) || normalizeText(meta.client_name) || 'клиент',
    };
};
export const validateProjectEventPayload = (payload, normalizedEventType) => {
    const meta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {};
    if (normalizedEventType === 'project_digest') {
        throw new ApiError(422, 'PROJECT_EVENT_TYPE_INVALID', 'project_digest is generated by scheduler and is not accepted via project-event');
    }
    if (projectEventRequireComment.has(normalizedEventType)
        && !hasAnyText(meta.commentText, meta.comment_text)) {
        throw new ApiError(422, 'PROJECT_EVENT_COMMENT_REQUIRED', 'commentText is required for this project event');
    }
    if (projectEventRequireQuestions.has(normalizedEventType)
        && !hasAnyText(meta.questionsList, meta.questions_list, meta.commentText, meta.comment_text)) {
        throw new ApiError(422, 'PROJECT_EVENT_QUESTIONS_REQUIRED', 'questionsList is required for this project event');
    }
    if (projectEventRequireResolution.has(normalizedEventType)
        && !hasAnyText(meta.resolutionSummary, meta.resolution_summary)) {
        throw new ApiError(422, 'PROJECT_EVENT_RESOLUTION_REQUIRED', 'resolutionSummary is required for this project event');
    }
    if (normalizedEventType === 'project_due_changed'
        && !hasAnyText(meta.newDue, meta.new_due, meta.dueNew)) {
        throw new ApiError(422, 'PROJECT_EVENT_DUE_NEW_REQUIRED', 'newDue is required for project_due_changed');
    }
};
export const lookupProjectInRequestsTable = async (queryFn, source, projectId) => {
    try {
        const result = await queryFn(`select id::text as id, type::text as type
           from requests
           where id = $1::uuid
           limit 1`, [projectId]);
        const row = result.rows[0];
        if (!row) {
            return { source, found: false, type: '' };
        }
        return {
            source,
            found: true,
            type: String(row.type ?? '').toLowerCase(),
        };
    }
    catch (error) {
        logger.warn('Project lookup failed in source database', {
            source,
            projectId,
            error: serializeError(error),
        });
        return { source, found: false, type: '' };
    }
};
export const ensureInstallationProjectExists = async (projectId) => {
    const checks = [];
    if (hasProjectScopeDatabase) {
        checks.push(await lookupProjectInRequestsTable(projectScopeQuery, 'projects_db', projectId));
    }
    checks.push(await lookupProjectInRequestsTable(dbQuery, 'main_db', projectId));
    const found = checks.find((item) => item.found);
    if (!found) {
        if (projectNotificationStrictAccess) {
            throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
        }
        logger.warn('Project scope check soft-skipped: project not found in configured databases', {
            projectId,
            lookupMode: projectDataLookupMode,
            strictMode: false,
        });
        return;
    }
    const typeValue = found.type;
    if (typeValue !== 'installation') {
        if (projectNotificationStrictAccess) {
            throw new ApiError(422, 'PROJECT_ID_UNKNOWN', 'project_id must reference installation request');
        }
        logger.warn('Project scope check soft-skipped: project type is not installation in source database', {
            projectId,
            source: found.source,
            requestType: typeValue,
            strictMode: false,
        });
    }
};
export const ensureActorHasProjectAccess = async (args) => {
    if (args.actorRole === 'admin' || args.actorRole === 'manager') {
        return;
    }
    const access = await dbQuery(`select 1
       from app_users u
       left join app_user_bindings ub on ub.user_id = u.id
       where u.id = $1::uuid
         and (
           coalesce(ub.is_global, false) = true
           or exists (
             select 1
             from app_user_project_bindings upb
             where upb.user_id = u.id
               and upb.project_id = $2::uuid
           )
         )
       limit 1`, [args.actorUserId, args.projectId]);
    if (access.rows.length > 0) {
        return;
    }
    const allowSoftSkip = args.allowSoftSkip !== false;
    if (!projectNotificationStrictAccess && allowSoftSkip) {
        const scopeStats = await dbQuery(`select
           (select count(*)::int from app_user_project_bindings) as project_bindings,
           (select count(*)::int from app_user_bindings where coalesce(is_global, false) = true) as global_bindings`);
        const stats = scopeStats.rows[0] ?? {};
        const projectBindings = Number(stats.project_bindings ?? 0);
        const globalBindings = Number(stats.global_bindings ?? 0);
        if (projectBindings === 0 && globalBindings === 0) {
            logger.warn('Project access check soft-skipped: no project/global bindings configured', {
                actorUserId: args.actorUserId,
                actorRole: args.actorRole,
                projectId: args.projectId,
                strictMode: false,
            });
            return;
        }
    }
    throw new ApiError(403, 'PROJECT_ACCESS_DENIED', 'No access to this project');
};
