export const allowedTicketNotifierRoles = new Set(['admin', 'manager', 'dispatcher', 'curator', 'executor']);
export const clientRecipientRoles = ['client_manager', 'client_user', 'user', 'installer'];
export const projectEventRequireComment = new Set(['project_update', 'project_due_changed', 'project_rejected']);
export const projectEventRequireQuestions = new Set(['project_waiting_info', 'project_need_info', 'project_waiting_info_reminder']);
export const projectEventRequireResolution = new Set(['project_done', 'project_done_for_review']);

export const projectAdminRoles = new Set(['admin', 'manager']);
export const projectOpsRoles = new Set(['dispatcher', 'curator', 'executor']);
export const projectClientRoles = new Set(['installer', 'client_manager', 'client_user', 'user']);
export const projectCreateRoles = new Set(['admin', 'manager', 'dispatcher', 'curator']);
export const projectUpdateRoles = new Set(['admin', 'manager', 'dispatcher', 'curator']);
export const projectDeleteRoles = new Set(['admin', 'manager']);
export const maintenancePlanManageRoles = new Set(['admin', 'manager', 'dispatcher', 'curator']);
export const projectDeadlineEditRoles = new Set(['admin', 'manager', 'curator', 'dispatcher']);
export const projectStageEditRoles = new Set(['admin', 'manager', 'curator', 'dispatcher', 'executor']);
export const projectTzEditRoles = new Set(['admin', 'manager', 'curator']);
export const projectFilesEditRoles = new Set(['admin', 'manager', 'dispatcher', 'curator', 'executor']);
export const projectChatWriteRoles = new Set([
    'admin',
    'manager',
    'curator',
    'dispatcher',
    'executor',
    'installer',
    'client_manager',
    'client_user',
    'user',
]);

export const serviceRequestManageRoles = new Set(['admin', 'manager', 'dispatcher', 'curator']);
export const serviceRequestViewRoles = new Set(['admin', 'manager', 'dispatcher', 'curator', 'executor', 'installer', 'client_manager', 'client_user', 'user']);

export const directionManageRoles = new Set(['admin', 'manager']);
export const directionViewRoles = new Set(['admin', 'manager', 'curator', 'dispatcher', 'executor', 'installer', 'client_manager', 'client_user', 'user']);

export const maintenanceItemManageRoles = new Set(['admin', 'manager']);
export const maintenanceItemViewRoles = new Set(['admin', 'manager', 'curator', 'dispatcher', 'executor', 'installer', 'client_manager', 'client_user', 'user']);

// ── Installation (Монтажи) roles ────────────────────────────────────
export const installationProcurementRoles = new Set(['admin', 'manager', 'dispatcher', 'curator']);
export const installationStageEditRoles = new Set(['admin', 'manager', 'curator', 'dispatcher']);
export const installationDeadlineEditRoles = new Set(['admin', 'manager', 'curator', 'dispatcher']);
