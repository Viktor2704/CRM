import { z } from 'zod';
import { ApiError } from '../errors.js';
import { normalizeText } from './normalize.js';
// ── Installation-specific statuses ──────────────────────────────────
export const installationStageValues = [
    'new',
    'awaiting_assignment',
    'assigned',
    'procurement',
    'in_progress',
    'pnr',
    'acceptance',
    'completed',
    'paused',
    'cancelled',
];
export const installationStageSet = new Set(installationStageValues);
export const installationStageLabelMap = {
    new: 'Новая',
    awaiting_assignment: 'Ожидает назначения',
    assigned: 'Назначены',
    procurement: 'Закупка',
    in_progress: 'В работе',
    pnr: 'ПНР',
    acceptance: 'Сдача',
    completed: 'Завершена',
    paused: 'На паузе',
    cancelled: 'Отменена',
};
export const installationStageTransitionMap = new Map([
    ['new', new Set(['awaiting_assignment', 'assigned', 'cancelled'])],
    ['awaiting_assignment', new Set(['assigned', 'paused', 'cancelled'])],
    ['assigned', new Set(['procurement', 'in_progress', 'paused', 'cancelled'])],
    ['procurement', new Set(['in_progress', 'paused', 'cancelled'])],
    ['in_progress', new Set(['pnr', 'acceptance', 'paused', 'cancelled'])],
    ['pnr', new Set(['acceptance', 'paused', 'cancelled'])],
    ['acceptance', new Set(['completed', 'in_progress', 'paused', 'cancelled'])],
    ['completed', new Set()],
    ['paused', new Set(['awaiting_assignment', 'assigned', 'procurement', 'in_progress', 'pnr', 'acceptance', 'cancelled'])],
    ['cancelled', new Set()],
]);
export const installationDeadlineStages = ['procurement', 'in_progress', 'pnr', 'acceptance'];
export const installationDeadlineStageSet = new Set(installationDeadlineStages);
export const installationCancelReasons = ['client_refused', 'duplicate', 'no_access', 'moved_to_other', 'other'];
export const installationCancelReasonSet = new Set(installationCancelReasons);
export const installationCancelReasonLabels = {
    client_refused: 'Клиент отказался',
    duplicate: 'Дубликат',
    no_access: 'Нет доступа',
    moved_to_other: 'Перенесли на другой проект',
    other: 'Другое',
};
export const procurementItemStatuses = ['needed', 'ordered', 'received'];
export const procurementItemStatusSet = new Set(procurementItemStatuses);
export const procurementStatusLabels = {
    needed: 'Нужно',
    ordered: 'Заказано',
    received: 'Получено',
};
// ── Notification event mapping ──────────────────────────────────────
export const installationStageToNotificationEventMap = {
    new: 'installation_created',
    awaiting_assignment: 'installation_created',
    assigned: 'installation_assigned',
    procurement: 'installation_stage_changed',
    in_progress: 'installation_stage_changed',
    pnr: 'installation_stage_changed',
    acceptance: 'installation_stage_changed',
    completed: 'installation_completed',
    paused: 'installation_paused',
    cancelled: 'installation_cancelled',
};
export const resolveInstallationNotificationEventType = (stage, fallback = 'installation_stage_changed') => {
    const normalized = normalizeText(stage).toLowerCase();
    return installationStageToNotificationEventMap[normalized] ?? fallback;
};
// ── Validation helpers ──────────────────────────────────────────────
export const normalizeInstallationStage = (value, fieldName = 'stage') => {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) {
        throw new ApiError(422, 'VALIDATION_ERROR', `${fieldName} is required`);
    }
    if (!installationStageSet.has(normalized)) {
        throw new ApiError(422, 'VALIDATION_ERROR', `${fieldName} contains unsupported value: ${normalized}`);
    }
    return normalized;
};
export const assertInstallationStageTransition = (currentStage, nextStage) => {
    if (currentStage === nextStage)
        return;
    const allowed = installationStageTransitionMap.get(currentStage);
    if (!allowed || !allowed.has(nextStage)) {
        throw new ApiError(422, 'VALIDATION_ERROR', `Недопустимый переход статуса: ${currentStage} → ${nextStage}`);
    }
};
export const normalizeProcurementItemStatus = (value, fieldName = 'status') => {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized)
        return 'needed';
    if (!procurementItemStatusSet.has(normalized)) {
        throw new ApiError(422, 'VALIDATION_ERROR', `${fieldName} contains unsupported value: ${normalized}`);
    }
    return normalized;
};
// ── Zod schemas ─────────────────────────────────────────────────────
export const installationStageUpdateSchema = z.object({
    stage: z.string().trim().min(1).max(60),
    reason: z.string().trim().max(2000).optional(),
    overrideReason: z.string().trim().max(2000).optional(),
    cancelReason: z.string().trim().max(60).optional(),
    cancelComment: z.string().trim().max(2000).optional(),
    pauseReason: z.string().trim().max(2000).optional(),
});
export const installationStageDeadlinesUpdateSchema = z.object({
    deadlines: z.array(z.object({
        stage: z.string().trim().min(1).max(60),
        dueDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    })).min(1).max(10),
    reason: z.string().trim().min(2).max(2000),
});
export const procurementItemCreateSchema = z.object({
    name: z.string().trim().min(1).max(500),
    quantity: z.number().int().min(1).max(999999).optional().default(1),
    unit: z.string().trim().max(50).optional().default('шт'),
    comment: z.string().trim().max(2000).optional().default(''),
    link: z.string().trim().max(2000).optional().default(''),
    responsibleUserId: z.string().trim().max(200).optional().nullable(),
    files: z.array(z.object({
        id: z.string().trim().max(200).optional(),
        name: z.string().trim().max(500).optional(),
        url: z.string().trim().max(2000).optional(),
        type: z.string().trim().max(60).optional(),
        size: z.string().trim().max(120).optional(),
    })).max(50).optional().default([]),
});
export const procurementItemUpdateSchema = z.object({
    name: z.string().trim().min(1).max(500).optional(),
    quantity: z.number().int().min(1).max(999999).optional(),
    unit: z.string().trim().max(50).optional(),
    comment: z.string().trim().max(2000).optional(),
    link: z.string().trim().max(2000).optional(),
    status: z.string().trim().max(60).optional(),
    responsibleUserId: z.string().trim().max(200).optional().nullable(),
    files: z.array(z.object({
        id: z.string().trim().max(200).optional(),
        name: z.string().trim().max(500).optional(),
        url: z.string().trim().max(2000).optional(),
        type: z.string().trim().max(60).optional(),
        size: z.string().trim().max(120).optional(),
    })).max(50).optional(),
});
export const chatMessagePinSchema = z.object({
    pinned: z.boolean(),
});
export const buildProcurementSummary = (items) => {
    const total = items.length;
    let needed = 0;
    let ordered = 0;
    let received = 0;
    for (const item of items) {
        const s = normalizeText(item.status).toLowerCase();
        if (s === 'received')
            received++;
        else if (s === 'ordered')
            ordered++;
        else
            needed++;
    }
    return { total, needed, ordered, received, allReceived: total > 0 && received === total };
};
// ── Mapper ────────────────────────────────────────────────────���─────
export const mapProcurementItemRow = (row) => ({
    id: normalizeText(row.id),
    installationId: normalizeText(row.installation_id),
    name: normalizeText(row.name),
    quantity: Number(row.quantity ?? 1),
    unit: normalizeText(row.unit) || 'шт',
    comment: normalizeText(row.comment),
    link: normalizeText(row.link),
    status: normalizeText(row.status) || 'needed',
    responsibleUserId: normalizeText(row.responsible_user_id) || null,
    files: Array.isArray(row.files) ? row.files : [],
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
});
export const mapStageDeadlineRow = (row) => ({
    stage: normalizeText(row.stage),
    dueDate: row.due_date
        ? (row.due_date instanceof Date ? row.due_date.toISOString().slice(0, 10) : String(row.due_date).slice(0, 10))
        : '',
});
