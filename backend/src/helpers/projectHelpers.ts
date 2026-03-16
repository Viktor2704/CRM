import { z } from 'zod';
import { dbQuery } from '../db.js';
import { ApiError } from '../errors.js';
import { appConfig } from '../config.js';
import { normalizeText } from './normalize.js';
import { appendActorScopeCondition } from './actorAccess.js';

export const projectStatusValues = new Set([
    'new',
    'tz_preparation',
    'design',
    'internal_review',
    'client_approval',
    'ready_for_installation',
    'triage',
    'accepted',
    'assigned',
    'on_the_way',
    'on_site',
    'diagnostics',
    'waiting_info',
    'waiting_parts',
    'in_progress',
    'partially_completed',
    'not_completed',
    'done',
    'closed',
    'cancelled',
]);
export const projectStageValues = [
    'new',
    'tz_preparation',
    'design',
    'internal_review',
    'client_approval',
    'ready_for_installation',
    'done',
    'closed',
    'cancelled',
];
export const projectStageSet = new Set(projectStageValues);
export const projectStageTransitionMap = new Map([
    ['new', new Set(['tz_preparation', 'cancelled'])],
    ['tz_preparation', new Set(['design', 'cancelled'])],
    ['design', new Set(['internal_review', 'cancelled'])],
    ['internal_review', new Set(['design', 'client_approval', 'cancelled'])],
    ['client_approval', new Set(['design', 'ready_for_installation', 'cancelled'])],
    ['ready_for_installation', new Set(['done', 'cancelled'])],
    ['done', new Set(['closed'])],
    ['closed', new Set()],
    ['cancelled', new Set()],
]);
export const projectLegacyStatusToStage = {
    new: 'new',
    assigned: 'tz_preparation',
    in_progress: 'design',
    diagnostics: 'internal_review',
    waiting_info: 'client_approval',
    done: 'done',
    closed: 'closed',
    cancelled: 'cancelled',
};
export const projectSortFieldMap = {
    created_at: 'created_at',
    updated_at: 'updated_at',
    due_date: `coalesce(due_date_admin, due_date_preliminary)`,
    status: 'status',
    title: 'title',
};
export const projectFileSchema = z.object({
    id: z.string().trim().max(200).optional(),
    name: z.string().trim().max(500).optional(),
    url: z.string().trim().max(2000).optional(),
    type: z.string().trim().max(60).optional(),
    size: z.string().trim().max(120).optional(),
    uploadedAt: z.string().trim().max(120).optional(),
}).strict();
export const projectCreateSchema = z.object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(10000).optional(),
    tenantId: z.string().trim().max(200).optional(),
    directionId: z.string().trim().max(200).optional(),
    systemType: z.string().trim().max(120).optional(),
    priority: z.string().trim().max(60).optional(),
    dueDatePreliminary: z.string().trim().optional().nullable(),
    dueDateAdmin: z.string().trim().optional().nullable(),
    responsibleIds: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
    status: z.string().trim().max(60).optional(),
    files: z.array(projectFileSchema).max(200).optional(),
    isProject: z.boolean().optional(),
});
export const projectStatusUpdateSchema = z.object({
    status: z.string().trim().min(1).max(60),
});
export const projectUpdateSchema = z.object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(10000).optional(),
    tenantId: z.string().trim().max(200).optional().nullable(),
    directionId: z.string().trim().max(200).optional().nullable(),
    systemType: z.string().trim().max(120).optional().nullable(),
    priority: z.string().trim().max(60).optional().nullable(),
    dueDatePreliminary: z.string().trim().optional().nullable(),
    dueDateAdmin: z.string().trim().optional().nullable(),
    responsibleIds: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
}).strict();
export const projectDeadlineUpdateSchema = z.object({
    due_date: z.string().trim().optional().nullable(),
    reason: z.string().trim().min(2).max(2000),
});
export const projectStageUpdateSchema = z.object({
    stage: z.string().trim().min(1).max(60),
    reason: z.string().trim().max(2000).optional(),
});
export const projectTzUpdateSchema = z.object({
    content: z.string().max(20000),
    reason: z.string().trim().min(10).max(2000),
});
export const projectFilesUpdateSchema = z.object({
    files: z.array(projectFileSchema).min(1).max(200),
});
export const projectChatMessageCreateSchema = z.object({
    text: z.string().trim().min(1).max(10000),
    visibility: z.enum(['internal', 'client-visible']).optional(),
    attachments: z.array(projectFileSchema).max(100).optional(),
});
export const escapeLikePattern = (value) => value.replace(/[\\%_]/g, '\\$&');
export const normalizeProjectStatus = (value, fieldName = 'status') => {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) {
        throw new ApiError(422, 'VALIDATION_ERROR', `${fieldName} is required`);
    }
    if (!projectStatusValues.has(normalized)) {
        throw new ApiError(422, 'VALIDATION_ERROR', `${fieldName} contains unsupported value`);
    }
    return normalized;
};
export const normalizeProjectStage = (value, fieldName = 'stage') => {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) {
        throw new ApiError(422, 'VALIDATION_ERROR', `${fieldName} is required`);
    }
    if (!projectStageSet.has(normalized)) {
        throw new ApiError(422, 'VALIDATION_ERROR', `${fieldName} contains unsupported value`);
    }
    return normalized;
};
export const resolveCurrentProjectStage = (status) => {
    const normalized = normalizeText(status).toLowerCase();
    if (projectStageSet.has(normalized)) {
        return normalized;
    }
    return projectLegacyStatusToStage[normalized] ?? 'new';
};
export const assertProjectStageTransition = (currentStage, nextStage) => {
    if (currentStage === nextStage) {
        return;
    }
    const allowed = projectStageTransitionMap.get(currentStage);
    if (!allowed || !allowed.has(nextStage)) {
        throw new ApiError(422, 'VALIDATION_ERROR', `invalid stage transition: ${currentStage} -> ${nextStage}`);
    }
};
export const normalizeProjectEventSeverity = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'warning' || normalized === 'critical') {
        return normalized;
    }
    return 'info';
};
export const normalizeChatVisibility = (value) => {
    return normalizeText(value).toLowerCase() === 'internal' ? 'internal' : 'client-visible';
};
export const normalizeSearchQuery = (value) => {
    const search = normalizeText(value);
    if (!search) {
        return '';
    }
    if (search.length > 255) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'search must be <= 255 characters');
    }
    const meaningful = search.replace(/[%_\\\s]+/g, '');
    return meaningful.length > 0 ? search : '';
};
export const parsePositiveInt = (value, options) => {
    const normalized = normalizeText(value);
    if (!normalized) {
        return options.defaultValue;
    }
    if (!/^\d+$/.test(normalized)) {
        throw new ApiError(422, 'VALIDATION_ERROR', `${options.field} must be a positive integer`);
    }
    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isFinite(parsed) || parsed < options.min) {
        throw new ApiError(422, 'VALIDATION_ERROR', `${options.field} must be >= ${options.min}`);
    }
    if (options.max && parsed > options.max) {
        return options.max;
    }
    return parsed;
};
export const parseDateTimeFilter = (value, fieldName) => {
    const normalized = normalizeText(value);
    if (!normalized) {
        return null;
    }
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
        throw new ApiError(422, 'VALIDATION_ERROR', `${fieldName} must be a valid ISO date`);
    }
    return parsed;
};
export const parseDateOnlyValue = (value, fieldName) => {
    const normalized = normalizeText(value);
    if (!normalized) {
        return null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        throw new ApiError(422, 'VALIDATION_ERROR', `${fieldName} must use YYYY-MM-DD format`);
    }
    return normalized;
};
export const parseStatusQueryFilter = (value) => {
    const source = Array.isArray(value) ? value : [value];
    const statuses = [];
    for (const chunk of source) {
        if (typeof chunk !== 'string') {
            continue;
        }
        const split = chunk.split(',');
        for (const item of split) {
            const normalized = normalizeText(item).toLowerCase();
            if (!normalized) {
                continue;
            }
            statuses.push(normalizeProjectStatus(normalized, 'status'));
        }
    }
    const unique = Array.from(new Set(statuses));
    if (unique.length > 20) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'status filter can contain up to 20 values');
    }
    return unique;
};
export const normalizeProjectFiles = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
        id: normalizeText(item.id),
        name: normalizeText(item.name),
        url: normalizeText(item.url),
        type: normalizeText(item.type),
        size: normalizeText(item.size),
        uploadedAt: normalizeText(item.uploadedAt),
    }));
};

export const projectStageLabelMap = {
    new: 'Новый',
    tz_preparation: 'Подготовка ТЗ',
    design: 'Проектирование',
    internal_review: 'Внутренняя проверка',
    client_approval: 'Согласование с клиентом',
    ready_for_installation: 'Готов к монтажу',
    done: 'Сдан',
    closed: 'Закрыт',
    cancelled: 'Отменен',
};
export const projectStageToNotificationEventMap = {
    new: 'project_created',
    tz_preparation: 'project_started',
    design: 'project_started',
    internal_review: 'project_update',
    client_approval: 'project_waiting_info',
    ready_for_installation: 'project_update',
    done: 'project_done',
    closed: 'project_closed',
    cancelled: 'project_rejected',
};
export const resolveProjectNotificationEventType = (stage, fallback = 'project_update') => {
    const normalizedStage = resolveCurrentProjectStage(stage);
    return projectStageToNotificationEventMap[normalizedStage] ?? fallback;
};
export const resolveProjectDueDateValue = (row) => {
    if (row?.due_date_admin) {
        return String(row.due_date_admin);
    }
    if (row?.due_date_preliminary) {
        return String(row.due_date_preliminary);
    }
    const dueDateAdmin = normalizeText(row?.dueDateAdmin);
    if (dueDateAdmin) {
        return dueDateAdmin;
    }
    return normalizeText(row?.dueDatePreliminary);
};
export const buildProjectPortalUrl = (request, projectId) => {
    const originHeader = normalizeText(request.get('origin'));
    const configuredOrigin = normalizeText(appConfig.corsOrigins[0]);
    const origin = originHeader || configuredOrigin;
    if (!origin) {
        return '';
    }
    const base = origin.replace(/\/+$/, '');
    return `${base}/#/installation?requestId=${encodeURIComponent(projectId)}`;
};

export const projectSelectColumnsSql = `id::text as id,
         type::text as type,
         coalesce(is_project, false) as is_project,
         coalesce(title, '') as title,
         coalesce(description, '') as description,
         coalesce(tenant_id, '') as tenant_id,
         coalesce(direction_id, '') as direction_id,
         coalesce(system_type, '') as system_type,
         coalesce(priority, 'medium') as priority,
         coalesce(status, 'new') as status,
         coalesce(created_by_id, '') as created_by_id,
         coalesce(executor_ids, '{}'::text[]) as executor_ids,
         coalesce(files, '[]'::jsonb) as files,
         created_at as created_at,
         updated_at as updated_at,
         due_date_preliminary as due_date_preliminary,
         due_date_admin as due_date_admin,
         (select count(*)::int from project_chat_messages pcm where pcm.project_id = id and pcm.deleted_at is null) as chat_messages_count`;

export const appendProjectScopeCondition = async (params) => {
    const { actorUserId, actorRole, conditions, values, queryFn } = params;
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
        curatorIdColumn: null,
        includeDirectionBindings: true,
        includeProjectBindings: true,
    });
};
