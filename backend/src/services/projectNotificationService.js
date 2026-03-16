import { randomUUID } from 'node:crypto';
import { ApiError } from '../errors.js';
import { logger, serializeError } from '../logger.js';
import { sendTicketClientNotification } from './ticketClientNotifications.js';
import { isUuidValue, normalizeText } from '../helpers/normalize.js';
import { resolveActiveUserRecipientById, resolveRecipientForNotification } from './notificationAccessService.js';
import { appendProjectScopeCondition, buildProjectPortalUrl, normalizeProjectEventSeverity, projectSelectColumnsSql, projectStageLabelMap, resolveCurrentProjectStage, resolveProjectDueDateValue } from '../helpers/projectHelpers.js';
import { enhanceDescriptionWithAI } from '../helpers/emailTemplates.js';
export const sendProjectNotificationBestEffort = async ({ request, actorUserId, actorRole, projectId, projectRow, eventType, commentText, questionsList, resolutionSummary, oldDue, newDue, dedupeToken = '', suppressOutsideWorkHours = true, }) => {
    try {
        const normalizedProjectId = normalizeText(projectId);
        if (!isUuidValue(normalizedProjectId)) {
            return;
        }
        const tenantId = normalizeText(projectRow?.tenant_id ?? projectRow?.tenantId);
        const tenantMeta = isUuidValue(tenantId) ? {
            clientId: tenantId,
            client_id: tenantId,
            counterpartyId: tenantId,
            counterparty_id: tenantId,
        } : {};
        const recipient = await resolveRecipientForNotification({
            recipient: {
                ...(isUuidValue(tenantId) ? { clientId: tenantId } : {}),
            },
            meta: {
                projectId: normalizedProjectId,
                project_id: normalizedProjectId,
                ...tenantMeta,
            },
        });
        let finalRecipient = recipient;
        if (!finalRecipient.email && isUuidValue(actorUserId)) {
            const actorRecipient = await resolveActiveUserRecipientById(actorUserId);
            if (actorRecipient) {
                finalRecipient = {
                    email: actorRecipient.email,
                    name: actorRecipient.fullName || finalRecipient.name || 'Пользователь',
                };
            }
        }
        if (!finalRecipient.email) {
            logger.warn('Project notification skipped: recipient unresolved', {
                requestId: request.requestId ?? null,
                projectId: normalizedProjectId,
                actorUserId: actorUserId || null,
                actorRole: actorRole || null,
                eventType,
            });
            return;
        }
        const stage = resolveCurrentProjectStage(projectRow?.status ?? '');
        const stageLabel = projectStageLabelMap[stage] ?? stage;
        const title = normalizeText(projectRow?.title) || `Проект ${normalizedProjectId}`;
        const dueDatetime = resolveProjectDueDateValue(projectRow);
        const ticketUrl = buildProjectPortalUrl(request, normalizedProjectId);
        const meta = {
            projectId: normalizedProjectId,
            project_id: normalizedProjectId,
            title,
            ...tenantMeta,
        };
        const normalizedComment = normalizeText(commentText);
        const enhancedComment = normalizedComment
            ? await enhanceDescriptionWithAI(normalizedComment, title).catch(() => normalizedComment)
            : '';
        if (enhancedComment) {
            meta.commentText = enhancedComment;
            meta.comment = enhancedComment;
        }
        const normalizedQuestions = normalizeText(questionsList);
        if (normalizedQuestions) {
            meta.questionsList = normalizedQuestions;
        }
        const normalizedResolution = normalizeText(resolutionSummary);
        if (normalizedResolution) {
            meta.resolutionSummary = normalizedResolution;
        }
        const normalizedOldDue = normalizeText(oldDue);
        if (normalizedOldDue) {
            meta.oldDue = normalizedOldDue;
        }
        const normalizedNewDue = normalizeText(newDue);
        if (normalizedNewDue) {
            meta.newDue = normalizedNewDue;
        }
        const normalizedDedupeToken = normalizeText(dedupeToken);
        const dedupeKey = [
            'project_auto',
            normalizeText(eventType).toLowerCase() || 'project_update',
            normalizedProjectId,
            finalRecipient.email,
            normalizedDedupeToken || stage || normalizedNewDue || normalizedOldDue || normalizeText(projectRow?.updated_at) || normalizeText(projectRow?.updatedAt),
        ].join(':');
        if (ticketUrl) {
            meta.ticketUrl = ticketUrl;
            meta.portalUrl = ticketUrl;
        }
        const result = await sendTicketClientNotification({
            scope: 'project',
            eventType: normalizeText(eventType).toLowerCase() || 'project_update',
            projectId: normalizedProjectId,
            recipientRole: 'client',
            recipient: {
                email: finalRecipient.email,
                name: finalRecipient.name || 'клиент',
                ...(isUuidValue(tenantId) ? { clientId: tenantId } : {}),
            },
            ticket: {
                id: normalizedProjectId,
                title,
                ...(ticketUrl ? { url: ticketUrl } : {}),
                ...(dueDatetime ? { dueDatetime } : {}),
                statusClient: stageLabel || 'В работе',
            },
            meta,
            dedupeKey,
            suppressOutsideWorkHours,
            actorUserId: isUuidValue(actorUserId) ? actorUserId : null,
            actorRole,
            requestId: request.requestId ?? null,
            ip: request.ip ?? null,
        });
        logger.info('Project notification dispatch completed', {
            requestId: request.requestId ?? null,
            projectId: normalizedProjectId,
            eventType,
            delivery: result.delivery ?? 'unknown',
            sent: !!result.sent,
            recipientEmail: finalRecipient.email,
        });
    }
    catch (error) {
        logger.error('Project notification dispatch failed', {
            requestId: request.requestId ?? null,
            projectId,
            eventType,
            error: serializeError(error),
        });
    }
};
export const insertProjectEventTx = async ({ client, projectId, actorUserId, eventType, severity, payload }) => {
    const actorUserIdValue = isUuidValue(actorUserId) ? actorUserId : null;
    await client.query(`insert into project_events(
         id,
         project_id,
         event_type,
         severity,
         actor_user_id,
         payload,
         created_at
       )
       values(
         $1::uuid,
         $2::uuid,
         $3::text,
         $4::text,
         $5::uuid,
         $6::jsonb,
         now()
       )`, [
        randomUUID(),
        projectId,
        normalizeText(eventType),
        normalizeProjectEventSeverity(severity),
        actorUserIdValue,
        JSON.stringify(payload ?? {}),
    ]);
};
export const insertProjectTzRevisionTx = async ({ client, projectId, oldValue, newValue, reason, actorUserId, eventType, metadata }) => {
    const actorUserIdValue = isUuidValue(actorUserId) ? actorUserId : null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const maxRevisionResult = await client.query(`select coalesce(max(revision_no), 0)::int as max_revision
           from project_tz_revisions
           where project_id = $1::uuid`, [projectId]);
        const maxRevision = Number(maxRevisionResult.rows[0]?.max_revision ?? 0);
        const nextRevision = maxRevision + 1;
        try {
            await client.query(`insert into project_tz_revisions(
             id,
             project_id,
             revision_no,
             old_value,
             new_value,
             reason,
             changed_by,
             changed_at,
             event_type,
             metadata
           )
           values(
             $1::uuid,
             $2::uuid,
             $3::int,
             $4::text,
             $5::text,
             $6::text,
             $7::uuid,
             now(),
             $8::text,
             $9::jsonb
           )`, [
                randomUUID(),
                projectId,
                nextRevision,
                typeof oldValue === 'string' ? oldValue : '',
                typeof newValue === 'string' ? newValue : '',
                normalizeText(reason),
                actorUserIdValue,
                normalizeText(eventType) || 'manual_edit',
                JSON.stringify(metadata ?? {}),
            ]);
            return nextRevision;
        }
        catch (error) {
            if (error?.code === '23505') {
                continue;
            }
            throw error;
        }
    }
    throw new ApiError(409, 'PROJECT_TZ_REVISION_CONFLICT', 'Failed to allocate project TZ revision');
};
export const getProjectByIdForActorTx = async ({ client, actorUserId, actorRole, projectId, lock }) => {
    const existsResult = await client.query(`select 1
       from requests
       where id = $1::uuid
         and type = 'installation'
         and coalesce(is_project, false) = true
         and deleted_at is null
       limit 1`, [projectId]);
    if (existsResult.rows.length === 0) {
        throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }
    const whereConditions = [
        `r.id = $1::uuid`,
        `r.type = 'installation'`,
        `coalesce(r.is_project, false) = true`,
        `r.deleted_at is null`,
    ];
    const values = [projectId];
    await appendProjectScopeCondition({
        actorUserId,
        actorRole,
        conditions: whereConditions,
        values,
        queryFn: (queryText, queryValues) => client.query(queryText, queryValues),
    });
    const whereSql = whereConditions.join('\n         and ');
    const lockClause = lock ? '\n       for update' : '';
    const result = await client.query(`select
         ${projectSelectColumnsSql}
       from requests r
       where ${whereSql}${lockClause}`, values);
    const row = result.rows[0];
    if (!row) {
        throw new ApiError(403, 'FORBIDDEN', 'No access to this project');
    }
    return row;
};
export const getInstallationByIdForActorTx = async ({ client, actorUserId, actorRole, installationId, lock }) => {
    const existsResult = await client.query(`select 1
       from requests
       where id = $1::uuid
         and type = 'installation'
         and coalesce(is_project, false) = false
         and deleted_at is null
       limit 1`, [installationId]);
    if (existsResult.rows.length === 0) {
        throw new ApiError(404, 'INSTALLATION_NOT_FOUND', 'Installation not found');
    }
    const whereConditions = [
        `r.id = $1::uuid`,
        `r.type = 'installation'`,
        `coalesce(r.is_project, false) = false`,
        `r.deleted_at is null`,
    ];
    const values = [installationId];
    await appendProjectScopeCondition({
        actorUserId,
        actorRole,
        conditions: whereConditions,
        values,
        queryFn: (queryText, queryValues) => client.query(queryText, queryValues),
    });
    const whereSql = whereConditions.join('\n         and ');
    const lockClause = lock ? '\n       for update' : '';
    const result = await client.query(`select
         ${projectSelectColumnsSql}
       from requests r
       where ${whereSql}${lockClause}`, values);
    const row = result.rows[0];
    if (!row) {
        throw new ApiError(403, 'FORBIDDEN', 'No access to this installation');
    }
    return row;
};
