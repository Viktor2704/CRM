import { normalizeText } from './normalize.js';
import { normalizeProjectFiles, normalizeProjectEventSeverity, normalizeChatVisibility } from './projectHelpers.js';

export const mapProjectRow = (row) => {
    const files = Array.isArray(row.files) ? row.files : [];
    return {
        id: row.id,
        title: normalizeText(row.title),
        description: normalizeText(row.description),
        type: normalizeText(row.type) || 'installation',
        isProject: row.is_project === true,
        tenantId: normalizeText(row.tenant_id),
        directionId: normalizeText(row.direction_id),
        systemType: normalizeText(row.system_type),
        createdById: normalizeText(row.created_by_id),
        executorIds: Array.isArray(row.executor_ids) ? row.executor_ids.map((value) => normalizeText(value)).filter(Boolean) : [],
        status: normalizeText(row.status) || 'new',
        priority: normalizeText(row.priority) || 'medium',
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
        dueDatePreliminary: row.due_date_preliminary ? (row.due_date_preliminary instanceof Date ? row.due_date_preliminary.toISOString().slice(0, 10) : String(row.due_date_preliminary).slice(0, 10)) : '',
        dueDateAdmin: row.due_date_admin ? (row.due_date_admin instanceof Date ? row.due_date_admin.toISOString().slice(0, 10) : String(row.due_date_admin).slice(0, 10)) : '',
        files: normalizeProjectFiles(files),
        commentCount: 0,
        chatMessagesCount: Number(row.chat_messages_count ?? 0),
    };
};
export const mapMaintenancePlanRow = (row) => ({
    id: normalizeText(row?.id),
    name: normalizeText(row?.name),
    tenantId: normalizeText(row?.tenant_id),
    directionId: normalizeText(row?.direction_id),
    maintenanceItemIds: Array.isArray(row?.maintenance_item_ids)
        ? row.maintenance_item_ids.map((value) => normalizeText(value)).filter(Boolean)
        : [],
    systemType: normalizeText(row?.system_type),
    frequency: normalizeText(row?.frequency) || 'monthly',
    dayOfMonth: Number(row?.day_of_month ?? 1),
    leadDays: Number(row?.lead_days ?? 5),
    workdayRule: normalizeText(row?.workday_rule) || 'PREVIOUS_WORKDAY',
    validFrom: row?.valid_from ? (row.valid_from instanceof Date ? row.valid_from.toISOString().slice(0, 10) : String(row.valid_from).slice(0, 10)) : '',
    validTo: row?.valid_to ? (row.valid_to instanceof Date ? row.valid_to.toISOString().slice(0, 10) : String(row.valid_to).slice(0, 10)) : null,
    status: normalizeText(row?.status) || 'active',
    isActive: row?.is_active === true,
    arrivalFromDay: Number(row?.arrival_from_day ?? 1),
    arrivalToDay: Number(row?.arrival_to_day ?? 28),
    periodOffset: Number(row?.period_offset ?? 1),
    updateMode: normalizeText(row?.update_mode) || 'skip',
    sendEmail: row?.send_email === true,
    notifyExecutor: row?.notify_executor !== false,
    notifyManager: row?.notify_manager !== false,
    defaultExecutorIds: Array.isArray(row?.default_executor_ids)
        ? row.default_executor_ids.map((value) => normalizeText(value)).filter(Boolean)
        : [],
    contactPerson: normalizeText(row?.contact_person),
    contactPhone: normalizeText(row?.contact_phone),
    description: normalizeText(row?.description),
    lastGenerated: row?.last_generated ? new Date(row.last_generated).toISOString() : null,
    createdById: normalizeText(row?.created_by_id),
    createdAt: row?.created_at ? new Date(row.created_at).toISOString() : '',
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : '',
});
export const mapGenerationRunRow = (row) => ({
    id: normalizeText(row?.id),
    planId: normalizeText(row?.plan_id),
    executedById: normalizeText(row?.executed_by_id),
    periodMonth: Number(row?.period_month ?? 0),
    periodYear: Number(row?.period_year ?? 0),
    periodStart: row?.period_start ? String(row.period_start) : '',
    periodEnd: row?.period_end ? String(row.period_end) : '',
    mode: normalizeText(row?.mode) || 'execute',
    created: Number(row?.total_created ?? 0),
    skipped: Number(row?.total_skipped ?? 0),
    updated: Number(row?.total_updated ?? 0),
    errors: Number(row?.total_errors ?? 0),
    coverage: row?.coverage && typeof row.coverage === 'object'
        ? row.coverage
        : {
            totalPlannedObjects: 0,
            coveredObjects: 0,
            missedObjects: [],
        },
    details: Array.isArray(row?.details) ? row.details : [],
    executedAt: row?.executed_at ? new Date(row.executed_at).toISOString() : '',
});

export const mapServiceRequestRow = (row) => {
    const parseJsonLike = (value, fallback) => {
        if (value && typeof value === 'object') {
            return value;
        }
        if (typeof value !== 'string' || value.trim().length === 0) {
            return fallback;
        }
        try {
            return JSON.parse(value);
        }
        catch {
            return fallback;
        }
    };
    const filesValue = parseJsonLike(row?.files, []);
    const resolutionValue = parseJsonLike(row?.resolution, null);
    const maintenanceDataValue = parseJsonLike(row?.maintenance_data, null);
    const operationDataValue = parseJsonLike(row?.operation_data, null);
    const generalDataValue = parseJsonLike(row?.general_data, null);
    const clientActionRaw = normalizeText(row?.client_action).toLowerCase();
    const clientAction = clientActionRaw === 'confirmed' || clientActionRaw === 'reschedule_requested'
        ? clientActionRaw
        : null;
    return {
        id: row?.id ? String(row.id) : '',
        title: normalizeText(row?.title),
        description: normalizeText(row?.description),
        type: normalizeText(row?.type) || 'general',
        directionId: normalizeText(row?.direction_id),
        systemType: normalizeText(row?.system_type),
        systemTypes: Array.isArray(row?.system_types)
            ? row.system_types.map((value) => normalizeText(value)).filter(Boolean)
            : [],
        itemIds: Array.isArray(row?.item_ids)
            ? row.item_ids.map((value) => normalizeText(value)).filter(Boolean)
            : [],
        createdById: normalizeText(row?.created_by_id),
        executorIds: Array.isArray(row?.executor_ids)
            ? row.executor_ids.map((value) => normalizeText(value)).filter(Boolean)
            : [],
        curatorId: normalizeText(row?.curator_id) || null,
        status: normalizeText(row?.status) || 'new',
        clientAction,
        clientActionAt: row?.client_action_at ? new Date(row.client_action_at).toISOString() : null,
        priority: normalizeText(row?.priority) || 'medium',
        createdAt: row?.created_at ? new Date(row.created_at).toISOString() : '',
        updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : '',
        dueDatePreliminary: row?.due_date_preliminary ? (row.due_date_preliminary instanceof Date ? row.due_date_preliminary.toISOString().slice(0, 10) : String(row.due_date_preliminary).slice(0, 10)) : null,
        visitDate: row?.visit_date ? (row.visit_date instanceof Date ? row.visit_date.toISOString().slice(0, 10) : String(row.visit_date).slice(0, 10)) : null,
        isOverdue: row?.is_overdue === true,
        commentCount: Number(row?.comment_count ?? 0),
        files: Array.isArray(filesValue) ? filesValue : [],
        isProject: false,
        resolution: resolutionValue && typeof resolutionValue === 'object' ? resolutionValue : null,
        maintenanceData: maintenanceDataValue && typeof maintenanceDataValue === 'object' ? maintenanceDataValue : null,
        operationData: operationDataValue && typeof operationDataValue === 'object' ? operationDataValue : null,
        generalData: generalDataValue && typeof generalDataValue === 'object' ? generalDataValue : null,
        bulkId: normalizeText(row?.bulk_id) || null,
    };
};

export const mapDirectionRow = (row) => ({
    id: row?.id ? String(row.id) : '',
    name: normalizeText(row?.name),
    address: normalizeText(row?.address),
    tenantId: normalizeText(row?.tenant_id),
    tenantName: normalizeText(row?.tenant_name),
    description: normalizeText(row?.description),
    createdById: normalizeText(row?.created_by_id),
    createdAt: row?.created_at ? new Date(row.created_at).toISOString() : '',
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : '',
});

export const mapMaintenanceItemRow = (row) => ({
    id: row?.id ? String(row.id) : '',
    directionId: normalizeText(row?.direction_id),
    positionNumber: normalizeText(row?.position_number),
    name: normalizeText(row?.name),
    address: normalizeText(row?.address),
    legalEntity: normalizeText(row?.legal_entity),
    contractNumber: normalizeText(row?.contract_number),
    tenantId: row?.tenant_id ? String(row.tenant_id) : null,
    managerId: row?.manager_id ? String(row.manager_id) : null,
    managerName: row?.manager_name ? String(row.manager_name) : null,
    systems: (() => {
        if (row?.systems && typeof row.systems === 'object') {
            return row.systems;
        }
        if (typeof row?.systems === 'string') {
            try {
                return JSON.parse(row.systems);
            }
            catch {
                return {};
            }
        }
        return {};
    })(),
    createdAt: row?.created_at ? new Date(row.created_at).toISOString() : '',
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : '',
});

export const mapNotificationRow = (row) => ({
    id: row?.id ? String(row.id) : '',
    userId: normalizeText(row?.user_id),
    eventType: normalizeText(row?.event_type),
    title: normalizeText(row?.title),
    body: normalizeText(row?.body),
    entityType: normalizeText(row?.entity_type),
    entityId: normalizeText(row?.entity_id),
    isRead: Boolean(row?.is_read),
    createdAt: row?.created_at ? new Date(row.created_at).toISOString() : '',
});
export const mapProjectEventRow = (row) => {
    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
    return {
        id: normalizeText(row.id),
        projectId: normalizeText(row.project_id),
        eventType: normalizeText(row.event_type),
        severity: normalizeProjectEventSeverity(row.severity),
        actorUserId: normalizeText(row.actor_user_id),
        payload,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    };
};
export const mapProjectChatMessageRow = (row) => {
    const attachments = Array.isArray(row.attachments) ? row.attachments : [];
    return {
        id: normalizeText(row.id),
        projectId: normalizeText(row.project_id),
        authorId: normalizeText(row.author_id),
        visibility: normalizeChatVisibility(row.visibility),
        text: normalizeText(row.text),
        attachments: normalizeProjectFiles(attachments),
        isPinned: row.is_pinned === true,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        editedAt: row.edited_at ? new Date(row.edited_at).toISOString() : null,
        deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    };
};

export const mapInstallationProcurementItemRow = (row) => ({
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

export const mapInstallationStageDeadlineRow = (row) => ({
    stage: normalizeText(row.stage),
    dueDate: row.due_date
        ? (row.due_date instanceof Date ? row.due_date.toISOString().slice(0, 10) : String(row.due_date).slice(0, 10))
        : '',
});
