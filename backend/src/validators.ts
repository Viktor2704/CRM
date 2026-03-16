import { z } from 'zod';
import { USER_ROLES, USER_STATUSES } from './types.js';

const uuid = z.string().uuid();

// Shared password schema: min 12, max 256, must contain uppercase, lowercase, and digit
const passwordField = z.string().min(12).max(256).refine(
    (val) => /[a-z]/.test(val) && /[A-Z]/.test(val) && /\d/.test(val),
    { message: 'Password must contain at least one uppercase letter, one lowercase letter, and one digit' }
);

const bindingsSchema = z.object({
    counterpartyId: uuid.nullable().optional(),
    contractIds: z.array(uuid).optional(),
    objectIds: z.array(uuid).optional(),
    directionIds: z.array(uuid).optional(),
    projectIds: z.array(uuid).optional(),
    isGlobal: z.boolean().optional(),
});

export const bootstrapAdminSchema = z.object({
    fullName: z.string().trim().min(1),
    email: z.string().email(),
    password: passwordField,
});

export const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

export const emailLoginRequestSchema = z.object({
    email: z.string().email(),
});

export const emailLoginConfirmSchema = z.object({
    email: z.string().email(),
    token: z.string().min(1),
});

export const passwordResetRequestSchema = z.object({
    email: z.string().email(),
});

export const passwordResetConfirmSchema = z.object({
    token: z.string().min(1),
    password: passwordField,
});

export const createUserSchema = z.object({
    fullName: z.string().trim().min(1),
    email: z.string().email(),
    phone: z.string().trim().min(1).optional(),
    role: z.enum(USER_ROLES),
    status: z.enum(USER_STATUSES),
    bindings: bindingsSchema.optional(),
});

const tenantContactSchema = z.object({
    id: z.string().uuid().optional(),
    fullName: z.string().trim().optional(),
    position: z.string().trim().optional(),
    email: z.string().trim().optional(),
    phone: z.string().trim().optional(),
});

export const createTenantSchema = z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1),
    brandName: z.string().trim().optional(),
    inn: z.string().trim().optional(),
    email: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    contacts: z.array(tenantContactSchema).optional(),
    type: z.enum(['tenant', 'contractor']).optional(),
});

export const bulkUpsertTenantsSchema = z.object({
    rows: z.array(createTenantSchema).min(1).max(2000),
});

export const updateUserSchema = z.object({
    fullName: z.string().trim().min(1).optional(),
    phone: z.string().trim().min(1).nullable().optional(),
    role: z.enum(USER_ROLES).optional(),
    status: z.enum(USER_STATUSES).optional(),
    bindings: bindingsSchema.optional(),
});

export const listUsersQuerySchema = z.object({
    tab: z.enum(['employees', 'clients', 'invitations', 'deactivated']).optional(),
    q: z.string().optional(),
    role: z.enum(USER_ROLES).optional(),
    status: z.enum(USER_STATUSES).optional(),
    sort: z.enum(['fullName', 'createdAt', 'role', 'status']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const sendInviteSchema = z.object({
    userId: z.string().uuid(),
    expiresInHours: z.number().int().min(1).max(168).optional(),
});

export const acceptInviteSchema = z.object({
    token: z.string().min(1),
    password: passwordField,
});

export const auditQuerySchema = z.object({
    userId: z.string().uuid().optional(),
    action: z.string().min(1).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const ticketClientEventTypes = [
    'created',
    'accepted',
    'waiting_info',
    'need_info',
    'customer_info_received',
    'info_received',
    'done_for_review',
    'done_review',
    'closed',
    'due_changed',
    'waiting_info_reminder',
    'waiting_reminder',
    'support_comment',
    'support_comment_client_channel',
    'rejected_or_not_possible',
    'rejected',
    'daily_digest',
    'digest',
    'project_created',
    'project_accepted',
    'project_started',
    'project_waiting_info',
    'project_need_info',
    'project_info_received',
    'project_update',
    'project_due_changed',
    'project_done',
    'project_done_for_review',
    'project_closed',
    'project_rejected',
    'project_waiting_info_reminder',
    'project_digest',
];

const ticketRecipientSchema = z.object({
    email: z.string().email().optional(),
    name: z.string().trim().optional(),
    clientName: z.string().trim().optional(),
    client_name: z.string().trim().optional(),
    userId: z.string().uuid().optional(),
    user_id: z.string().uuid().optional(),
    clientId: z.string().uuid().optional(),
    client_id: z.string().uuid().optional(),
});

const ticketSnapshotSchema = z.object({
    id: z.string().trim().min(1).optional(),
    title: z.string().trim().optional(),
    url: z.string().trim().optional(),
    ticketUrl: z.string().trim().optional(),
    ticket_url: z.string().trim().optional(),
    dueDatetime: z.string().trim().optional(),
    due_datetime: z.string().trim().optional(),
    statusClient: z.string().trim().optional(),
    status_client: z.string().trim().optional(),
    resolutionSummary: z.string().trim().optional(),
    resolution_summary: z.string().trim().optional(),
    resolutionShort: z.string().trim().optional(),
    resolution_short: z.string().trim().optional(),
    closedDatetime: z.string().trim().optional(),
    closed_datetime: z.string().trim().optional(),
}).optional();

const ticketClientMetaSchema = z
    .object({
    clientName: z.string().trim().optional(),
    client_name: z.string().trim().optional(),
    userId: z.string().uuid().optional(),
    user_id: z.string().uuid().optional(),
    clientId: z.string().uuid().optional(),
    client_id: z.string().uuid().optional(),
    counterpartyId: z.string().uuid().optional(),
    counterparty_id: z.string().uuid().optional(),
    company: z.string().trim().optional(),
    projectId: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
    supportName: z.string().trim().optional(),
    support_name: z.string().trim().optional(),
    supportSignature: z.string().trim().optional(),
    support_signature: z.string().trim().optional(),
    title: z.string().trim().optional(),
    ticketId: z.string().trim().optional(),
    ticket_id: z.string().trim().optional(),
    ticketUrl: z.string().trim().optional(),
    ticket_url: z.string().trim().optional(),
    portalUrl: z.string().trim().optional(),
    portal_url: z.string().trim().optional(),
    dueDatetime: z.string().trim().optional(),
    due_datetime: z.string().trim().optional(),
    dueOld: z.string().trim().optional(),
    dueNew: z.string().trim().optional(),
    oldDue: z.string().trim().optional(),
    newDue: z.string().trim().optional(),
    old_due: z.string().trim().optional(),
    new_due: z.string().trim().optional(),
    questionsList: z.string().trim().optional(),
    questions_list: z.string().trim().optional(),
    resolutionSummary: z.string().trim().optional(),
    resolution_summary: z.string().trim().optional(),
    resolutionShort: z.string().trim().optional(),
    resolution_short: z.string().trim().optional(),
    commentText: z.string().trim().optional(),
    comment_text: z.string().trim().optional(),
    nextStepsList: z.string().trim().optional(),
    next_steps_list: z.string().trim().optional(),
    option1: z.string().trim().optional(),
    option2: z.string().trim().optional(),
    option_1: z.string().trim().optional(),
    option_2: z.string().trim().optional(),
    autoCloseDays: z.coerce.number().int().min(1).max(60).optional(),
    auto_close_days: z.coerce.number().int().min(1).max(60).optional(),
    closedDatetime: z.string().trim().optional(),
    closed_datetime: z.string().trim().optional(),
    date: z.string().trim().optional(),
    inProgressCount: z.coerce.number().int().min(0).optional(),
    in_progress_count: z.coerce.number().int().min(0).optional(),
    waitingCustomerCount: z.coerce.number().int().min(0).optional(),
    waiting_customer_count: z.coerce.number().int().min(0).optional(),
    readyForReviewCount: z.coerce.number().int().min(0).optional(),
    ready_for_review_count: z.coerce.number().int().min(0).optional(),
    closedTodayCount: z.coerce.number().int().min(0).optional(),
    closed_today_count: z.coerce.number().int().min(0).optional(),
    ticketList: z.string().trim().optional(),
    ticket_list: z.string().trim().optional(),
}).passthrough()
    .optional();

export const ticketClientEventSchema = z.object({
    eventType: z.enum(ticketClientEventTypes),
    projectId: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
    idempotencyKey: z.string().trim().min(1).max(300).optional(),
    idempotency_key: z.string().trim().min(1).max(300).optional(),
    recipient: ticketRecipientSchema,
    ticket: ticketSnapshotSchema,
    meta: ticketClientMetaSchema,
    dedupeKey: z.string().trim().min(1).max(300).optional(),
    dedupe_key: z.string().trim().min(1).max(300).optional(),
    suppressOutsideWorkHours: z.boolean().optional(),
});

export const parseUuidPath = (value) => {
    return z.string().uuid().parse(value);
};
