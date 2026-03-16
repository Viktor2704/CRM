import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { appConfig } from '../config.js';
import { dbQuery } from '../db.js';
import { appendMaintenancePlanActorScopeCondition, appendServiceRequestActorScopeCondition } from '../helpers/actorAccess.js';
import { maintenancePlanManageRoles, serviceRequestManageRoles, serviceRequestViewRoles } from '../helpers/roles.js';
import { filterNotificationRecipientIdsByEntityScope } from '../helpers/notificationRecipientScope.js';
import { logger, serializeError } from '../logger.js';
import { canTransitionServiceRequestStatus } from '../routes/serviceRequests.js';
import { storeFile } from './fileStorage.js';
import { TelegramBotClient } from './telegramClient.js';
import { createRateLimitedTelegramBot } from './telegramRateLimiter.js';
import {
    handleStartCommand,
    handleHelpCommand,
    handleStatusCommand,
    handleMyTicketsCommand,
    handleCreateCommand,
    handleSearchCommand,
    handleLinkCommand,
    handleUnlinkCommand,
    handleConversationMessage,
    setBotCommands,
} from './telegramBotCommands.js';
import { handleInlineQuery, handleChosenInlineResult, enableInlineMode } from './telegramInlineMode.js';
import { initializeWebhookMode } from './telegramWebhooks.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION_TTL_MS = 10 * 60 * 1000;
const CHECKIN_LOCATION_TTL_MS = 2 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const STATUS_LABELS = {
    new: 'Новая',
    triage: 'Сортировка',
    assigned: 'Назначена',
    in_progress: 'В работе',
    on_site: 'На объекте',
    done: 'Выполнена',
    closed: 'Закрыта',
    cancelled: 'Отменена',
};
const PRIORITY_LABELS = {
    critical: 'Критический',
    high: 'Высокий',
    medium: 'Средний',
    low: 'Низкий',
};
const PRIORITY_ICONS = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '⚪',
};
const SYSTEM_LABELS = {
    aps: 'АПС',
    soue: 'СОУЭ',
    aupt: 'АУПТ',
    vpv: 'ВПВ',
    fireExtinguishers: 'Огнетушители',
    exitSigns: 'Табло ВЫХОД',
    gas: 'Газ',
    skud: 'СКУД',
    sks: 'СКС',
    svn: 'СВН',
    asutp: 'АСУ ТП',
    sots: 'СОТС',
};

let telegramBot: TelegramBotClient | null = null;
let telegramBotUsername = appConfig.telegramBotUsername || 'NovinzhstroyBot';
let startPromise = null;
let cleanupTimer = null;
const pendingActions = new Map();
const pendingCheckins = new Map();
const telegramBotDeps: {
    queryFn: typeof dbQuery;
    storeFile: typeof storeFile;
    fetchImpl: (input: string | URL, init?: RequestInit) => Promise<any>;
} = {
    queryFn: dbQuery,
    storeFile,
    fetchImpl: (input, init) => fetch(input as any, init),
};

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const isUuidValue = (value) => uuidPattern.test(value);
const nowMskLabel = () => new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});
const toShortId = (value) => normalizeText(value).slice(0, 8);
const parseMessageText = (message) => normalizeText(message?.text) || normalizeText(message?.caption);
const parseActionData = (value) => {
    const chunks = normalizeText(value).split(':');
    if (chunks.length < 3 || chunks[0] !== 'action') {
        return null;
    }
    return {
        action: normalizeText(chunks[1]),
        entityKey: normalizeText(chunks[2]),
        extra: normalizeText(chunks[3]),
    };
};
const canReadTelegramRequest = (role) => serviceRequestViewRoles.has(normalizeText(role));
const canMutateTelegramRequestStatus = (role) => serviceRequestManageRoles.has(normalizeText(role)) || normalizeText(role) === 'executor';
const canManageTelegramRequest = (role) => serviceRequestManageRoles.has(normalizeText(role));
const canManageTelegramPlan = (role) => maintenancePlanManageRoles.has(normalizeText(role));
const cleanupExpiredState = () => {
    const now = Date.now();
    for (const [chatId, pending] of pendingActions.entries()) {
        if (Number(pending?.expiresAt ?? 0) <= now) {
            pendingActions.delete(chatId);
        }
    }
    for (const [chatId, pending] of pendingCheckins.entries()) {
        if (Number(pending?.expiresAt ?? 0) <= now) {
            pendingCheckins.delete(chatId);
        }
    }
};
const resolveRequestByKeyForActor = async (key, actorUserId, actorRole) => {
    const requestKey = normalizeText(key);
    if (!requestKey || !canReadTelegramRequest(actorRole)) {
        return null;
    }
    const conditions = [
        `r.deleted_at is null`,
        `r.type <> 'installation'`,
        `r.id::text like ($1 || '%')`,
    ];
    const values = [requestKey];
    await appendServiceRequestActorScopeCondition({
        actorUserId: normalizeText(actorUserId),
        actorRole: normalizeText(actorRole),
        conditions,
        values,
        queryFn: telegramBotDeps.queryFn,
        tableAlias: 'r',
    });
    const result = await telegramBotDeps.queryFn(`select
       r.id::text as id,
       coalesce(r.title, '') as title,
       coalesce(r.description, '') as description,
       coalesce(r.type, '') as type,
       coalesce(r.system_type, '') as system_type,
       coalesce(r.priority, 'medium') as priority,
       coalesce(r.status, 'new') as status,
       coalesce(r.executor_ids, '{}'::text[]) as executor_ids,
       coalesce(r.created_by_id, '') as created_by_id,
       r.created_at,
       r.updated_at,
       r.due_date_preliminary
     from requests r
     where ${conditions.join(' and ')}
     order by r.created_at desc
     limit 1`, values);
    return result.rows[0] ?? null;
};
const resolvePlanByKeyForActor = async (key, actorUserId, actorRole) => {
    const planKey = normalizeText(key);
    if (!planKey) {
        return null;
    }
    const conditions = [
        `mp.id::text like ($1 || '%')`,
        `mp.deleted_at is null`,
    ];
    const values = [planKey];
    appendMaintenancePlanActorScopeCondition({
        actorUserId: normalizeText(actorUserId),
        actorRole: normalizeText(actorRole),
        conditions,
        values,
        tableAlias: 'mp',
    });
    const result = await telegramBotDeps.queryFn(`select
       mp.id::text as id,
       coalesce(mp.system_type, '') as system_type,
       mp.valid_from,
       mp.valid_to,
       coalesce(mp.contact_person, '') as contact_person,
       coalesce(mp.contact_phone, '') as contact_phone
     from maintenance_plans mp
     where ${conditions.join(' and ')}
     order by mp.created_at desc
     limit 1`, values);
    return result.rows[0] ?? null;
};
const buildScopedRequestConditionsById = async (requestId, actorUserId, actorRole) => {
    if (!isUuidValue(requestId)) {
        return null;
    }
    const conditions = [
        `r.id = $1::uuid`,
        `r.deleted_at is null`,
        `r.type <> 'installation'`,
    ];
    const values: unknown[] = [requestId];
    await appendServiceRequestActorScopeCondition({
        actorUserId: normalizeText(actorUserId),
        actorRole: normalizeText(actorRole),
        conditions,
        values,
        queryFn: telegramBotDeps.queryFn,
        tableAlias: 'r',
    });
    return {
        conditions,
        values,
    };
};
const buildScopedPlanConditionsById = async (planId, actorUserId, actorRole) => {
    if (!isUuidValue(planId)) {
        return null;
    }
    const conditions = [
        `mp.id = $1::uuid`,
        `mp.deleted_at is null`,
    ];
    const values: unknown[] = [planId];
    appendMaintenancePlanActorScopeCondition({
        actorUserId: normalizeText(actorUserId),
        actorRole: normalizeText(actorRole),
        conditions,
        values,
        tableAlias: 'mp',
    });
    return {
        conditions,
        values,
    };
};
const findUserByChatId = async (chatId) => {
    const result = await telegramBotDeps.queryFn(`select
       id::text as id,
       coalesce(full_name, '') as full_name,
       coalesce(email, '') as email,
       role::text as role
     from app_users
     where telegram_chat_id = $1
       and status::text = 'active'
     limit 1`, [String(chatId)]);
    return result.rows[0] ?? null;
};
const ensureUserLinked = async (chatId) => {
    const user = await findUserByChatId(chatId);
    if (user) {
        return user;
    }
    await telegramBot?.sendMessage(chatId, 'Сначала привяжите аккаунт: /link <код>').catch(() => { });
    return null;
};
const listAdminManagerIds = async () => {
    const result = await telegramBotDeps.queryFn(`select id::text as id
     from app_users
     where role::text in ('admin', 'manager')
       and status::text = 'active'`);
    return result.rows.map((row) => normalizeText(row.id)).filter((value) => isUuidValue(value));
};
const pushInAppDirect = async (recipientIds, eventType, title, body, entityType, entityId) => {
    const rawIds = Array.from(new Set((recipientIds ?? []).map((value) => normalizeText(value)).filter((value) => isUuidValue(value))));
    const ids = await filterNotificationRecipientIdsByEntityScope({
        recipientIds: rawIds,
        entityType,
        entityId,
        queryFn: telegramBotDeps.queryFn,
    });
    if (ids.length === 0) {
        return;
    }
    await Promise.all(ids.map(async (userId) => {
        await telegramBotDeps.queryFn(`insert into app_notifications(
         user_id,
         event_type,
         title,
         body,
         entity_type,
         entity_id
       )
       values($1::uuid, $2, $3, $4, $5, $6)`, [userId, eventType, title, body, entityType, entityId]);
    }));
};
const markQueryDone = async (query, actionDescription, actorName) => {
    if (!telegramBot || !query?.message?.chat?.id || !query?.message?.message_id) {
        return;
    }
    const base = parseMessageText(query.message);
    const mark = `✅ ${escapeHtml(actionDescription)} — ${escapeHtml(actorName)}, ${escapeHtml(nowMskLabel())}`;
    const nextText = [base, mark].filter(Boolean).join('\n\n');
    await telegramBot.editMessageText(nextText, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] },
    }).catch(() => { });
};
const sendRequestDetails = async (chatId, requestRow) => {
    const requestId = normalizeText(requestRow?.id);
    const title = normalizeText(requestRow?.title) || 'Без названия';
    const description = normalizeText(requestRow?.description);
    const system = SYSTEM_LABELS[normalizeText(requestRow?.system_type)] || normalizeText(requestRow?.system_type) || '—';
    const priorityKey = normalizeText(requestRow?.priority) || 'medium';
    const priority = PRIORITY_LABELS[priorityKey] || priorityKey;
    const priorityIcon = PRIORITY_ICONS[priorityKey] || '⚪';
    const statusKey = normalizeText(requestRow?.status) || 'new';
    const status = STATUS_LABELS[statusKey] || statusKey;
    const dueDate = requestRow?.due_date_preliminary ? new Date(requestRow.due_date_preliminary).toLocaleDateString('ru-RU') : '—';
    const createdAt = requestRow?.created_at ? new Date(requestRow.created_at).toLocaleDateString('ru-RU') : '—';
    const updatedAt = requestRow?.updated_at ? new Date(requestRow.updated_at).toLocaleDateString('ru-RU') : '—';
    const text = [
        `📄 <b>Заявка #${escapeHtml(toShortId(requestId))}</b>`,
        '',
        `Название: ${escapeHtml(title)}`,
        `Система: ${escapeHtml(system)}`,
        `Приоритет: ${priorityIcon} ${escapeHtml(priority)}`,
        `Статус: ${escapeHtml(status)}`,
        `Срок: ${escapeHtml(dueDate)}`,
        `Создана: ${escapeHtml(createdAt)}`,
        `Обновлена: ${escapeHtml(updatedAt)}`,
    ];
    if (description) {
        text.push('', `Описание:\n${escapeHtml(description)}`);
    }
    await telegramBot?.sendMessage(chatId, text.join('\n'), { parse_mode: 'HTML' }).catch(() => { });
};
const updateRequestStatus = async (requestId, currentStatus, status, resolution, actorUserId, actorRole) => {
    if (!isUuidValue(requestId)) {
        return null;
    }
    if (!canTransitionServiceRequestStatus(currentStatus, status)) {
        return null;
    }
    const scopedRequest = await buildScopedRequestConditionsById(requestId, actorUserId, actorRole);
    if (!scopedRequest) {
        return null;
    }
    const { conditions, values } = scopedRequest;
    const statusRef = `$${values.push(status)}`;
    const updates = [`status = ${statusRef}`, 'updated_at = now()'];
    if (resolution && typeof resolution === 'object') {
        const resolutionRef = `$${values.push(JSON.stringify(resolution))}`;
        updates.push(`resolution = ${resolutionRef}::jsonb`);
    }
    const result = await telegramBotDeps.queryFn(`update requests r
       set ${updates.join(', ')}
       where ${conditions.join(' and ')}
       returning r.id::text as id`, values);
    return result.rows[0] ?? null;
};
const parseCaptionTicketKey = (caption) => {
    const text = normalizeText(caption);
    if (!text) {
        return '';
    }
    const match = text.match(/#(?:заявка|ticket)\s+([0-9a-f-]{4,36})/i);
    return normalizeText(match?.[1]);
};
const downloadTelegramPhoto = async (fileId) => {
    if (!telegramBot || !appConfig.telegramBotToken) {
        return null;
    }
    const fileInfo = await telegramBot.getFile(fileId);
    const filePath = normalizeText(fileInfo?.file_path);
    if (!filePath) {
        return null;
    }
    const response = await telegramBotDeps.fetchImpl(`https://api.telegram.org/file/bot${appConfig.telegramBotToken}/${filePath}`);
    if (!response.ok) {
        throw new Error(`Telegram file download failed with status ${response.status}`);
    }
    const content = Buffer.from(await response.arrayBuffer());
    const ext = path.extname(filePath).toLowerCase() || '.jpg';
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const stored = await telegramBotDeps.storeFile({
        fileName: `telegram_photo_${Date.now()}${ext}`,
        mimeType,
        content,
    });
    return {
        stored,
        mimeType,
    };
};
const appendPhotoToRequest = async (requestId, uploadedBy, fileInfo, actorUserId, actorRole) => {
    if (!isUuidValue(requestId) || !fileInfo) {
        return null;
    }
    const scopedRequest = await buildScopedRequestConditionsById(requestId, actorUserId, actorRole);
    if (!scopedRequest) {
        return null;
    }
    const { conditions, values } = scopedRequest;
    const fileRecord = {
        id: randomUUID(),
        name: fileInfo.stored.fileName,
        url: `${appConfig.filePublicBasePath}/${fileInfo.stored.storageKey}`,
        type: fileInfo.mimeType,
        size: String(fileInfo.stored.sizeBytes ?? 0),
        uploadedAt: fileInfo.stored.uploadedAt || new Date().toISOString(),
        source: 'telegram',
        uploadedBy: normalizeText(uploadedBy),
    };
    const filesRef = `$${values.push(JSON.stringify([fileRecord]))}`;
    const result = await telegramBotDeps.queryFn(`update requests r
       set files = coalesce(r.files, '[]'::jsonb) || ${filesRef}::jsonb,
           updated_at = now()
       where ${conditions.join(' and ')}
       returning r.id::text as id`, values);
    return result.rows[0] ?? null;
};
const takeRequestForActor = async (requestId, actorUserId, actorRole) => {
    const scopedRequest = await buildScopedRequestConditionsById(requestId, actorUserId, actorRole);
    if (!scopedRequest) {
        return null;
    }
    const { conditions, values } = scopedRequest;
    const actorRef = `$${values.push(normalizeText(actorUserId))}`;
    const result = await telegramBotDeps.queryFn(`update requests r
       set status = 'in_progress',
           executor_ids = case
             when ${actorRef}::text = any(coalesce(r.executor_ids, '{}'::text[]))
               then coalesce(r.executor_ids, '{}'::text[])
             else array_append(coalesce(r.executor_ids, '{}'::text[]), ${actorRef}::text)
           end,
           updated_at = now()
       where ${conditions.join(' and ')}
       returning r.id::text as id`, values);
    return result.rows[0] ?? null;
};
const assignRequestExecutorForActor = async (requestId, assigneeId, actorUserId, actorRole) => {
    const scopedRequest = await buildScopedRequestConditionsById(requestId, actorUserId, actorRole);
    if (!scopedRequest || !isUuidValue(assigneeId)) {
        return null;
    }
    const { conditions, values } = scopedRequest;
    const assigneeRef = `$${values.push(assigneeId)}`;
    const result = await telegramBotDeps.queryFn(`update requests r
       set executor_ids = array[${assigneeRef}::text],
           status = 'assigned',
           updated_at = now()
       where ${conditions.join(' and ')}
       returning r.id::text as id`, values);
    return result.rows[0] ?? null;
};
const updateRequestPriorityForActor = async (requestId, priority, actorUserId, actorRole) => {
    const scopedRequest = await buildScopedRequestConditionsById(requestId, actorUserId, actorRole);
    if (!scopedRequest) {
        return null;
    }
    const { conditions, values } = scopedRequest;
    const priorityRef = `$${values.push(priority)}`;
    const result = await telegramBotDeps.queryFn(`update requests r
       set priority = ${priorityRef},
           updated_at = now()
       where ${conditions.join(' and ')}
       returning r.id::text as id`, values);
    return result.rows[0] ?? null;
};
const insertMaintenancePlanConfirmationForActor = async ({
    planId,
    action,
    actorUserId,
    actorRole,
    respondedBy,
}: {
    planId: string;
    action: 'confirm' | 'reschedule';
    actorUserId: string;
    actorRole: string;
    respondedBy: string;
}) => {
    const scopedPlan = await buildScopedPlanConditionsById(planId, actorUserId, actorRole);
    if (!scopedPlan) {
        return null;
    }
    const { conditions, values } = scopedPlan;
    const actionRef = `$${values.push(action)}`;
    const tokenRef = `$${values.push(`tg-${randomUUID()}`)}`;
    const respondedByRef = `$${values.push(normalizeText(respondedBy))}`;
    const result = await telegramBotDeps.queryFn(`insert into maintenance_plan_confirmations(
         plan_id,
         action,
         token,
         responded_by,
         confirmed_at
       )
       select
         mp.id,
         ${actionRef},
         ${tokenRef},
         ${respondedByRef},
         now()
       from maintenance_plans mp
       where ${conditions.join(' and ')}
       returning plan_id::text as plan_id`, values);
    return result.rows[0] ?? null;
};
const markPlanConfirmationSentForActor = async (planId, actorUserId, actorRole) => {
    const scopedPlan = await buildScopedPlanConditionsById(planId, actorUserId, actorRole);
    if (!scopedPlan) {
        return null;
    }
    const { conditions, values } = scopedPlan;
    const result = await telegramBotDeps.queryFn(`update maintenance_plans mp
       set confirmation_sent_at = now()
       where ${conditions.join(' and ')}
       returning mp.id::text as id`, values);
    return result.rows[0] ?? null;
};
const handleStart = async (message) => {
    const chatId = message?.chat?.id;
    if (!telegramBot || !chatId) {
        return;
    }
    const text = [
        'Добро пожаловать в бот Новинжстрой!',
        '',
        '/link <код> — привязать аккаунт',
        '/my_tasks — мои текущие задачи',
        '/status <номер> — статус заявки',
        '/checkin <код_объекта> — отметиться на объекте',
        '/help — список команд',
        '/unlink — отвязать аккаунт',
    ].join('\n');
    await telegramBot.sendMessage(chatId, text).catch(() => { });
};
const handleHelp = async (message) => {
    const chatId = message?.chat?.id;
    if (!telegramBot || !chatId) {
        return;
    }
    await telegramBot.sendMessage(chatId, [
        '📖 Команды бота Новинжстрой:',
        '/my_tasks',
        '/status <номер>',
        '/checkin <код>',
        '/link <код>',
        '/unlink',
        '/help',
    ].join('\n')).catch(() => { });
};
const handleLink = async (message, token) => {
    const chatId = message?.chat?.id;
    if (!telegramBot || !chatId) {
        return;
    }
    const normalizedToken = normalizeText(token).toUpperCase();
    if (!normalizedToken) {
        await telegramBot.sendMessage(chatId, 'Использование: /link <код>');
        return;
    }
    const tokenResult = await telegramBotDeps.queryFn(`select
       t.id::text as token_id,
       t.user_id::text as user_id,
       coalesce(u.full_name, '') as full_name,
       u.role::text as role
     from telegram_link_tokens t
     join app_users u on u.id = t.user_id
     where upper(t.token) = $1
       and t.used_at is null
       and t.expires_at > now()
     limit 1`, [normalizedToken]);
    if (tokenResult.rows.length === 0) {
        await telegramBot.sendMessage(chatId, 'Код недействителен или истёк. Получите новый код в веб-интерфейсе.');
        return;
    }
    const row = tokenResult.rows[0];
    const userId = normalizeText(row.user_id);
    const tokenId = normalizeText(row.token_id);
    await telegramBotDeps.queryFn(`update app_users
       set telegram_chat_id = null
       where telegram_chat_id = $1
         and id::text <> $2`, [String(chatId), userId]);
    await telegramBotDeps.queryFn(`update app_users
       set telegram_chat_id = $1
       where id = $2::uuid`, [String(chatId), userId]);
    if (isUuidValue(tokenId)) {
        await telegramBotDeps.queryFn(`update telegram_link_tokens
         set used_at = now()
         where id = $1::uuid`, [tokenId]);
    }
    await telegramBot.sendMessage(chatId, `Аккаунт привязан! Вы: ${normalizeText(row.full_name) || 'пользователь'} (${normalizeText(row.role)}).`).catch(() => { });
};
const handleUnlink = async (message) => {
    const chatId = message?.chat?.id;
    if (!telegramBot || !chatId) {
        return;
    }
    const result = await telegramBotDeps.queryFn(`update app_users
       set telegram_chat_id = null
       where telegram_chat_id = $1
       returning id::text as id`, [String(chatId)]);
    if (result.rows.length === 0) {
        await telegramBot.sendMessage(chatId, 'Аккаунт не привязан.');
        return;
    }
    await telegramBot.sendMessage(chatId, 'Аккаунт отвязан. Уведомления больше не будут приходить в Telegram.').catch(() => { });
};
const handleMyTasks = async (message) => {
    const chatId = message?.chat?.id;
    if (!telegramBot || !chatId) {
        return;
    }
    const user = await ensureUserLinked(chatId);
    if (!user) {
        return;
    }
    const rows = await telegramBotDeps.queryFn(`select
       id::text as id,
       coalesce(title, '') as title,
       coalesce(status, 'new') as status,
       coalesce(priority, 'medium') as priority,
       coalesce(system_type, '') as system_type,
       due_date_preliminary
     from requests
     where deleted_at is null
       and coalesce(is_project, false) = false
       and status not in ('closed', 'cancelled', 'done')
       and ($1::text = any(coalesce(executor_ids, '{}'::text[])) or curator_id = $1::text)
     order by created_at desc
     limit 10`, [normalizeText(user.id)]);
    if (rows.rows.length === 0) {
        await telegramBot.sendMessage(chatId, 'У вас нет активных задач. Отличная работа! 👍').catch(() => { });
        return;
    }
    const lines = [`📋 Ваши задачи (${rows.rows.length}):`, ''];
    for (const row of rows.rows) {
        const id = toShortId(normalizeText(row.id));
        const title = normalizeText(row.title) || 'Без названия';
        const status = STATUS_LABELS[normalizeText(row.status)] || normalizeText(row.status);
        const priorityKey = normalizeText(row.priority) || 'medium';
        const priority = PRIORITY_LABELS[priorityKey] || priorityKey;
        const priorityIcon = PRIORITY_ICONS[priorityKey] || '⚪';
        const system = SYSTEM_LABELS[normalizeText(row.system_type)] || normalizeText(row.system_type) || '—';
        const due = row.due_date_preliminary ? new Date(row.due_date_preliminary).toLocaleDateString('ru-RU') : '—';
        lines.push(`${priorityIcon} #${id} ${title}`);
        lines.push(`Система: ${system} | Приоритет: ${priority} | Статус: ${status}`);
        lines.push(`Срок: ${due}`);
        lines.push('');
    }
    await telegramBot.sendMessage(chatId, lines.join('\n')).catch(() => { });
};
const handleStatus = async (message, requestKey) => {
    const chatId = message?.chat?.id;
    if (!telegramBot || !chatId) {
        return;
    }
    const user = await ensureUserLinked(chatId);
    if (!user) {
        return;
    }
    const requestRow = await resolveRequestByKeyForActor(requestKey, user.id, user.role);
    if (!requestRow) {
        await telegramBot.sendMessage(chatId, 'Заявка не найдена. Проверьте номер.');
        return;
    }
    await sendRequestDetails(chatId, requestRow);
};
const handleCheckinCommand = async (message, itemKey) => {
    const chatId = message?.chat?.id;
    if (!telegramBot || !chatId) {
        return;
    }
    const user = await ensureUserLinked(chatId);
    if (!user) {
        return;
    }
    const key = normalizeText(itemKey);
    if (!key) {
        await telegramBot.sendMessage(chatId, 'Использование: /checkin <код_объекта>');
        return;
    }
    const itemResult = await telegramBotDeps.queryFn(`select
       id::text as id,
       coalesce(name, '') as name,
       coalesce(direction_id, '') as direction_id
     from maintenance_items
     where deleted_at is null
       and id::text like ($1 || '%')
     order by created_at desc
     limit 1`, [key]);
    if (itemResult.rows.length === 0) {
        await telegramBot.sendMessage(chatId, 'Объект не найден. Проверьте код с QR.');
        return;
    }
    const item = itemResult.rows[0];
    const itemId = normalizeText(item.id);
    await telegramBotDeps.queryFn(`insert into checkins(
       item_id,
       direction_id,
       user_id,
       user_name,
       token
     )
     values($1::uuid, $2, $3, $4, $5)`, [
        itemId,
        normalizeText(item.direction_id),
        normalizeText(user.id),
        normalizeText(user.full_name),
        key,
    ]);
    pendingCheckins.set(String(chatId), {
        itemId,
        userId: normalizeText(user.id),
        expiresAt: Date.now() + CHECKIN_LOCATION_TTL_MS,
    });
    const adminIds = await listAdminManagerIds();
    await pushInAppDirect(adminIds, 'checkin', `Чекин: ${normalizeText(user.full_name) || 'Исполнитель'} на "${normalizeText(item.name) || itemId}"`, `Время: ${new Date().toISOString()}`, 'maintenance_item', itemId);
    await telegramBot.sendMessage(chatId, `Вы отметились на объекте "${normalizeText(item.name) || itemId}". Время: ${nowMskLabel()} МСК`).catch(() => { });
};
const handlePendingActionMessage = async (message) => {
    const chatId = message?.chat?.id;
    if (!chatId || !telegramBot) {
        return false;
    }
    const pending = pendingActions.get(String(chatId));
    if (!pending) {
        return false;
    }
    if (Date.now() > Number(pending.expiresAt ?? 0)) {
        pendingActions.delete(String(chatId));
        return false;
    }
    const user = await ensureUserLinked(chatId);
    if (!user) {
        pendingActions.delete(String(chatId));
        return true;
    }
    const comment = parseMessageText(message);
    if (pending.action === 'reschedule_comment') {
        if (!comment) {
            await telegramBot.sendMessage(chatId, 'Пожалуйста, укажите причину переноса текстом.');
            return true;
        }
        if (!canManageTelegramPlan(user.role)) {
            pendingActions.delete(String(chatId));
            await telegramBot.sendMessage(chatId, 'План ТО недоступен.');
            return true;
        }
        const plan = await resolvePlanByKeyForActor(pending.entityKey, user.id, user.role);
        if (!plan || !isUuidValue(plan.id)) {
            pendingActions.delete(String(chatId));
            await telegramBot.sendMessage(chatId, 'План ТО недоступен.');
            return true;
        }
        const confirmation = await insertMaintenancePlanConfirmationForActor({
            planId: plan.id,
            action: 'reschedule',
            actorUserId: user.id,
            actorRole: user.role,
            respondedBy: user.id,
        });
        if (!confirmation) {
            pendingActions.delete(String(chatId));
            await telegramBot.sendMessage(chatId, 'План ТО недоступен.');
            return true;
        }
        const adminIds = await listAdminManagerIds();
        await pushInAppDirect(adminIds, 'plan_action', 'Запрошен перенос ТО через Telegram', `План ${toShortId(plan.id)}. Причина: ${comment}`, 'maintenance_plan', plan.id);
        pendingActions.delete(String(chatId));
        await telegramBot.sendMessage(chatId, '📅 Запрос на перенос отправлен.').catch(() => { });
        return true;
    }
    if (pending.action === 'done_resolution') {
        if (!canMutateTelegramRequestStatus(user.role)) {
            pendingActions.delete(String(chatId));
            await telegramBot.sendMessage(chatId, 'Заявка недоступна.');
            return true;
        }
        const requestRow = await resolveRequestByKeyForActor(pending.entityKey, user.id, user.role);
        if (!requestRow || !isUuidValue(requestRow.id)) {
            pendingActions.delete(String(chatId));
            await telegramBot.sendMessage(chatId, 'Заявка не найдена.');
            return true;
        }
        if (!comment && (!Array.isArray(message?.photo) || message.photo.length === 0)) {
            await telegramBot.sendMessage(chatId, 'Опишите выполненные работы текстом или отправьте фото.');
            return true;
        }
        if (!canTransitionServiceRequestStatus(requestRow.status, 'done')) {
            pendingActions.delete(String(chatId));
            await telegramBot.sendMessage(chatId, 'Недопустимый переход статуса. Обновите заявку и повторите действие.');
            return true;
        }
        const updated = await updateRequestStatus(requestRow.id, requestRow.status, 'done', {
            text: comment || 'Работы завершены',
            completedAt: new Date().toISOString(),
            completedVia: 'telegram',
        }, user.id, user.role);
        if (!updated) {
            pendingActions.delete(String(chatId));
            await telegramBot.sendMessage(chatId, 'Заявка недоступна. Обновите заявку и повторите действие.');
            return true;
        }
        const adminIds = await listAdminManagerIds();
        await pushInAppDirect(adminIds, 'ticket_done_telegram', 'Заявка выполнена через Telegram', `Заявка ${toShortId(requestRow.id)} отмечена как выполненная.`, 'service_request', requestRow.id);
        pendingActions.delete(String(chatId));
        await telegramBot.sendMessage(chatId, `✅ Заявка #${toShortId(requestRow.id)} выполнена.`).catch(() => { });
        return true;
    }
    return false;
};
const handleLocationMessage = async (message) => {
    const chatId = message?.chat?.id;
    if (!chatId || !telegramBot || !message?.location) {
        return false;
    }
    const pending = pendingCheckins.get(String(chatId));
    if (!pending) {
        return false;
    }
    if (Date.now() > Number(pending.expiresAt ?? 0)) {
        pendingCheckins.delete(String(chatId));
        return false;
    }
    const latitude = Number(message.location.latitude);
    const longitude = Number(message.location.longitude);
    await telegramBotDeps.queryFn(`with latest as (
         select id
         from checkins
         where item_id = $1::uuid
           and user_id = $2
         order by checked_in_at desc
         limit 1
       )
       update checkins c
       set latitude = $3,
           longitude = $4
       where c.id in (select id from latest)`, [pending.itemId, pending.userId, latitude, longitude]);
    pendingCheckins.delete(String(chatId));
    await telegramBot.sendMessage(chatId, `📍 Геолокация сохранена: ${latitude}, ${longitude}`).catch(() => { });
    return true;
};
const handlePhotoMessage = async (message) => {
    if (!telegramBot || !Array.isArray(message?.photo) || message.photo.length === 0) {
        return false;
    }
    const chatId = message?.chat?.id;
    if (!chatId) {
        return false;
    }
    const user = await ensureUserLinked(chatId);
    if (!user) {
        return true;
    }
    const ticketKey = parseCaptionTicketKey(message.caption);
    if (!ticketKey) {
        return false;
    }
    const requestRow = await resolveRequestByKeyForActor(ticketKey, user.id, user.role);
    if (!requestRow || !isUuidValue(requestRow.id)) {
        await telegramBot.sendMessage(chatId, 'Заявка не найдена. Формат: #заявка <номер>').catch(() => { });
        return true;
    }
    const fileId = normalizeText(message.photo[message.photo.length - 1]?.file_id);
    if (!fileId) {
        return true;
    }
    try {
        const uploaded = await downloadTelegramPhoto(fileId);
        if (!uploaded) {
            throw new Error('Unable to download telegram photo');
        }
        const attached = await appendPhotoToRequest(requestRow.id, normalizeText(user.id), uploaded, user.id, user.role);
        if (!attached) {
            await telegramBot.sendMessage(chatId, 'Заявка недоступна. Обновите номер и повторите.').catch(() => { });
            return true;
        }
        await telegramBot.sendMessage(chatId, `Фото прикреплено к заявке #${toShortId(requestRow.id)} ✅`).catch(() => { });
    }
    catch (error) {
        logger.error('Telegram photo upload failed', {
            requestId: requestRow.id,
            error: serializeError(error),
        });
        await telegramBot.sendMessage(chatId, 'Не удалось прикрепить фото. Попробуйте позже.').catch(() => { });
    }
    return true;
};
const handleCallbackQuery = async (query) => {
    if (!telegramBot || !query?.id) {
        return;
    }
    const chatId = query?.message?.chat?.id;
    const parsed = parseActionData(query?.data);
    if (!chatId || !parsed) {
        await telegramBot.answerCallbackQuery(query.id).catch(() => { });
        return;
    }
    const user = await findUserByChatId(chatId);
    if (!user) {
        await telegramBot.answerCallbackQuery(query.id, { text: 'Аккаунт не привязан' }).catch(() => { });
        return;
    }
    const actorName = normalizeText(user.full_name) || normalizeText(user.email) || 'пользователь';
    const actorRole = normalizeText(user.role);
    try {
        if (parsed.action === 'details') {
            const requestRow = await resolveRequestByKeyForActor(parsed.entityKey, user.id, actorRole);
            if (!requestRow) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Заявка недоступна' }).catch(() => { });
                return;
            }
            await sendRequestDetails(chatId, requestRow);
            await telegramBot.answerCallbackQuery(query.id, { text: 'Показаны детали' }).catch(() => { });
            return;
        }
        if (parsed.action === 'take') {
            if (!canMutateTelegramRequestStatus(actorRole)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Недостаточно прав' }).catch(() => { });
                return;
            }
            const requestRow = await resolveRequestByKeyForActor(parsed.entityKey, user.id, actorRole);
            if (!requestRow || !isUuidValue(requestRow.id)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Заявка недоступна' }).catch(() => { });
                return;
            }
            if (!canTransitionServiceRequestStatus(requestRow.status, 'in_progress')) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Недопустимый переход статуса' }).catch(() => { });
                return;
            }
            const updated = await takeRequestForActor(requestRow.id, user.id, actorRole);
            if (!updated) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Заявка недоступна' }).catch(() => { });
                return;
            }
            await markQueryDone(query, `Взято в работу #${toShortId(requestRow.id)}`, actorName);
            await telegramBot.answerCallbackQuery(query.id, { text: '✅ Взято в работу' }).catch(() => { });
            return;
        }
        if (parsed.action === 'assign') {
            if (!canManageTelegramRequest(actorRole)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Недостаточно прав' }).catch(() => { });
                return;
            }
            const requestRow = await resolveRequestByKeyForActor(parsed.entityKey, user.id, actorRole);
            if (!requestRow || !isUuidValue(requestRow.id)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Заявка недоступна' }).catch(() => { });
                return;
            }
            const executorsResult = await telegramBotDeps.queryFn(`select
             id::text as id,
             coalesce(full_name, '') as full_name
           from app_users
           where status::text = 'active'
             and role::text = 'executor'
           order by full_name asc
           limit 12`);
            if (executorsResult.rows.length === 0) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Нет доступных исполнителей' }).catch(() => { });
                return;
            }
            const keyboard = [];
            for (const row of executorsResult.rows) {
                const executorId = normalizeText(row.id);
                if (!isUuidValue(executorId)) {
                    continue;
                }
                keyboard.push([
                    {
                        text: normalizeText(row.full_name) || `Исполнитель ${toShortId(executorId)}`,
                        callback_data: `action:assign_set:${parsed.entityKey}:${toShortId(executorId)}`,
                    },
                ]);
            }
            await telegramBot.sendMessage(chatId, 'Выберите исполнителя:', {
                reply_markup: {
                    inline_keyboard: keyboard,
                },
            }).catch(() => { });
            await telegramBot.answerCallbackQuery(query.id, { text: 'Выберите исполнителя' }).catch(() => { });
            return;
        }
        if (parsed.action === 'assign_set') {
            if (!canManageTelegramRequest(actorRole)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Недостаточно прав' }).catch(() => { });
                return;
            }
            const requestRow = await resolveRequestByKeyForActor(parsed.entityKey, user.id, actorRole);
            if (!requestRow || !isUuidValue(requestRow.id)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Заявка недоступна' }).catch(() => { });
                return;
            }
            const executorKey = normalizeText(parsed.extra);
            const assigneeResult = await telegramBotDeps.queryFn(`select
             id::text as id,
             coalesce(full_name, '') as full_name
           from app_users
           where status::text = 'active'
             and role::text = 'executor'
             and id::text like ($1 || '%')
           limit 1`, [executorKey]);
            if (assigneeResult.rows.length === 0) {
                throw new Error('Assignee not found');
            }
            const assigneeId = normalizeText(assigneeResult.rows[0]?.id);
            const assigneeName = normalizeText(assigneeResult.rows[0]?.full_name) || `Исполнитель ${toShortId(assigneeId)}`;
            if (!canTransitionServiceRequestStatus(requestRow.status, 'assigned')) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Недопустимый переход статуса' }).catch(() => { });
                return;
            }
            const updated = await assignRequestExecutorForActor(requestRow.id, assigneeId, user.id, actorRole);
            if (!updated) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Заявка недоступна' }).catch(() => { });
                return;
            }
            await markQueryDone(query, `Назначено: ${assigneeName}`, actorName);
            await telegramBot.answerCallbackQuery(query.id, { text: 'Исполнитель назначен' }).catch(() => { });
            return;
        }
        if (parsed.action === 'priority_set') {
            if (!canManageTelegramRequest(actorRole)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Недостаточно прав' }).catch(() => { });
                return;
            }
            const requestRow = await resolveRequestByKeyForActor(parsed.entityKey, user.id, actorRole);
            if (!requestRow || !isUuidValue(requestRow.id)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Заявка недоступна' }).catch(() => { });
                return;
            }
            const priority = ['critical', 'high', 'medium', 'low'].includes(parsed.extra) ? parsed.extra : 'medium';
            const updated = await updateRequestPriorityForActor(requestRow.id, priority, user.id, actorRole);
            if (!updated) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Заявка недоступна' }).catch(() => { });
                return;
            }
            await markQueryDone(query, `Приоритет: ${PRIORITY_LABELS[priority] || priority}`, actorName);
            await telegramBot.answerCallbackQuery(query.id, { text: 'Приоритет обновлён' }).catch(() => { });
            return;
        }
        if (parsed.action === 'priority') {
            if (!canManageTelegramRequest(actorRole)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Недостаточно прав' }).catch(() => { });
                return;
            }
            const keyboard = [
                [
                    { text: '🔴 Критический', callback_data: `action:priority_set:${parsed.entityKey}:critical` },
                    { text: '🟠 Высокий', callback_data: `action:priority_set:${parsed.entityKey}:high` },
                ],
                [
                    { text: '🟡 Средний', callback_data: `action:priority_set:${parsed.entityKey}:medium` },
                    { text: '⚪ Низкий', callback_data: `action:priority_set:${parsed.entityKey}:low` },
                ],
            ];
            await telegramBot.sendMessage(chatId, 'Изменить приоритет:', { reply_markup: { inline_keyboard: keyboard } }).catch(() => { });
            await telegramBot.answerCallbackQuery(query.id, { text: 'Выберите приоритет' }).catch(() => { });
            return;
        }
        if (parsed.action === 'status') {
            if (!canMutateTelegramRequestStatus(actorRole)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Недостаточно прав' }).catch(() => { });
                return;
            }
            const requestRow = await resolveRequestByKeyForActor(parsed.entityKey, user.id, actorRole);
            if (!requestRow || !isUuidValue(requestRow.id)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Заявка недоступна' }).catch(() => { });
                return;
            }
            if (parsed.extra === 'done') {
                if (!canTransitionServiceRequestStatus(requestRow.status, 'done')) {
                    await telegramBot.answerCallbackQuery(query.id, { text: 'Недопустимый переход статуса' }).catch(() => { });
                    return;
                }
                pendingActions.set(String(chatId), {
                    action: 'done_resolution',
                    entityKey: parsed.entityKey,
                    userId: normalizeText(user.id),
                    expiresAt: Date.now() + ACTION_TTL_MS,
                });
                await telegramBot.sendMessage(chatId, 'Опишите что было сделано (или отправьте фото):').catch(() => { });
                await telegramBot.answerCallbackQuery(query.id, { text: 'Жду описание выполнения' }).catch(() => { });
                return;
            }
            const safeStatus = ['in_progress', 'on_site', 'assigned', 'triage'].includes(parsed.extra) ? parsed.extra : 'in_progress';
            if (!canTransitionServiceRequestStatus(requestRow.status, safeStatus)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Недопустимый переход статуса' }).catch(() => { });
                return;
            }
            const updated = await updateRequestStatus(requestRow.id, requestRow.status, safeStatus, undefined, user.id, actorRole);
            if (!updated) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Заявка недоступна' }).catch(() => { });
                return;
            }
            await markQueryDone(query, `Статус: ${STATUS_LABELS[safeStatus] || safeStatus}`, actorName);
            await telegramBot.answerCallbackQuery(query.id, { text: 'Статус обновлён' }).catch(() => { });
            return;
        }
        if (parsed.action === 'confirm_plan') {
            if (!canManageTelegramPlan(actorRole)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Недостаточно прав' }).catch(() => { });
                return;
            }
            const plan = await resolvePlanByKeyForActor(parsed.entityKey, user.id, actorRole);
            if (!plan || !isUuidValue(plan.id)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'План ТО недоступен' }).catch(() => { });
                return;
            }
            const confirmation = await insertMaintenancePlanConfirmationForActor({
                planId: plan.id,
                action: 'confirm',
                actorUserId: user.id,
                actorRole,
                respondedBy: user.id,
            });
            if (!confirmation) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'План ТО недоступен' }).catch(() => { });
                return;
            }
            const adminIds = await listAdminManagerIds();
            await pushInAppDirect(adminIds, 'plan_action', 'План ТО согласован через Telegram', `План ${toShortId(plan.id)} подтверждён.`, 'maintenance_plan', plan.id);
            await markQueryDone(query, `План ${toShortId(plan.id)} согласован`, actorName);
            await telegramBot.answerCallbackQuery(query.id, { text: '✅ План согласован' }).catch(() => { });
            return;
        }
        if (parsed.action === 'reschedule_plan') {
            if (!canManageTelegramPlan(actorRole)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Недостаточно прав' }).catch(() => { });
                return;
            }
            const plan = await resolvePlanByKeyForActor(parsed.entityKey, user.id, actorRole);
            if (!plan || !isUuidValue(plan.id)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'План ТО недоступен' }).catch(() => { });
                return;
            }
            pendingActions.set(String(chatId), {
                action: 'reschedule_comment',
                entityKey: parsed.entityKey,
                userId: normalizeText(user.id),
                expiresAt: Date.now() + ACTION_TTL_MS,
            });
            await telegramBot.sendMessage(chatId, 'Укажите причину переноса или желаемую дату:').catch(() => { });
            await telegramBot.answerCallbackQuery(query.id, { text: 'Жду причину переноса' }).catch(() => { });
            return;
        }
        if (parsed.action === 'call_client') {
            if (!canManageTelegramPlan(actorRole)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Недостаточно прав' }).catch(() => { });
                return;
            }
            const plan = await resolvePlanByKeyForActor(parsed.entityKey, user.id, actorRole);
            if (!plan) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'План ТО недоступен' }).catch(() => { });
                return;
            }
            const contact = `${normalizeText(plan?.contact_person) || 'не указан'}, ${normalizeText(plan?.contact_phone) || 'телефон не указан'}`;
            await telegramBot.sendMessage(chatId, `📞 Контакт: ${contact}`).catch(() => { });
            await telegramBot.answerCallbackQuery(query.id, { text: 'Контакт показан' }).catch(() => { });
            return;
        }
        if (parsed.action === 'resend') {
            if (!canManageTelegramPlan(actorRole)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'Недостаточно прав' }).catch(() => { });
                return;
            }
            const plan = await resolvePlanByKeyForActor(parsed.entityKey, user.id, actorRole);
            if (!plan || !isUuidValue(plan.id)) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'План ТО недоступен' }).catch(() => { });
                return;
            }
            const resent = await markPlanConfirmationSentForActor(plan.id, user.id, actorRole);
            if (!resent) {
                await telegramBot.answerCallbackQuery(query.id, { text: 'План ТО недоступен' }).catch(() => { });
                return;
            }
            await markQueryDone(query, `Повторная отправка отмечена для плана ${toShortId(plan.id)}`, actorName);
            await telegramBot.answerCallbackQuery(query.id, { text: 'Повторная отправка отмечена' }).catch(() => { });
            return;
        }
        if (parsed.action === 'reassign') {
            await telegramBot.sendMessage(chatId, 'Переназначение выполняется из веб-интерфейса.').catch(() => { });
            await telegramBot.answerCallbackQuery(query.id, { text: 'Откройте веб-интерфейс' }).catch(() => { });
            return;
        }
        await telegramBot.answerCallbackQuery(query.id, { text: 'Неизвестное действие' }).catch(() => { });
    }
    catch (error) {
        logger.error('Telegram callback error', {
            action: parsed.action,
            entityKey: parsed.entityKey,
            error: serializeError(error),
        });
        await telegramBot.answerCallbackQuery(query.id, { text: 'Ошибка. Попробуйте позже.', show_alert: true }).catch(() => { });
    }
};
const handleMessage = async (message) => {
    if (!telegramBot || !message?.chat?.id) {
        return;
    }
    try {
        if (await handleLocationMessage(message)) {
            return;
        }
        if (await handlePendingActionMessage(message)) {
            return;
        }
        if (await handlePhotoMessage(message)) {
            return;
        }
    }
    catch (error) {
        logger.error('Telegram message handler failed', {
            error: serializeError(error),
        });
    }
};
export const __telegramBotTestUtils = {
    reset() {
        pendingActions.clear();
        pendingCheckins.clear();
        if (cleanupTimer) {
            clearInterval(cleanupTimer);
            cleanupTimer = null;
        }
        telegramBot = null;
        startPromise = null;
        telegramBotUsername = appConfig.telegramBotUsername || 'NovinzhstroyBot';
        telegramBotDeps.queryFn = dbQuery;
        telegramBotDeps.storeFile = storeFile;
        telegramBotDeps.fetchImpl = (input, init) => fetch(input as any, init);
    },
    setBot(bot) {
        telegramBot = createRateLimitedTelegramBot(bot) as TelegramBotClient;
    },
    setDeps(overrides) {
        Object.assign(telegramBotDeps, overrides ?? {});
    },
    handleStatus,
    handlePhotoMessage,
    handleCallbackQuery,
};
export const getTelegramBot = () => telegramBot;
export const getTelegramBotUsername = () => telegramBotUsername;
export const startTelegramBot = async () => {
    if (!appConfig.telegramBotEnabled) {
        return null;
    }
    if (!normalizeText(appConfig.telegramBotToken)) {
        logger.warn('Telegram bot start skipped: token is empty');
        return null;
    }
    if (telegramBot) {
        return telegramBot;
    }
    if (startPromise) {
        return startPromise;
    }
    startPromise = (async () => {
        // Check if webhook mode is enabled
        const useWebhook = Boolean(process.env.TELEGRAM_WEBHOOK_URL);

        const rawBot = new TelegramBotClient(appConfig.telegramBotToken, { polling: !useWebhook });
        const bot = createRateLimitedTelegramBot(rawBot) as TelegramBotClient;
        telegramBot = bot;
        if (cleanupTimer) {
            clearInterval(cleanupTimer);
        }
        cleanupTimer = setInterval(cleanupExpiredState, CLEANUP_INTERVAL_MS);
        cleanupExpiredState();

        // Register new advanced commands
        bot.onText(/^\/start(?:@\w+)?(?:\s+.*)?$/i, (message) => {
            void handleStartCommand(bot, message);
        });
        bot.onText(/^\/help(?:@\w+)?(?:\s+.*)?$/i, (message) => {
            void handleHelpCommand(bot, message);
        });
        bot.onText(/^\/status(?:@\w+)?(?:\s+(.+))?$/i, (message, match) => {
            void handleStatusCommand(bot, message, normalizeText(match?.[1]));
        });
        bot.onText(/^\/mytickets(?:@\w+)?(?:\s+.*)?$/i, (message) => {
            void handleMyTicketsCommand(bot, message);
        });
        bot.onText(/^\/create(?:@\w+)?(?:\s+.*)?$/i, (message) => {
            void handleCreateCommand(bot, message);
        });
        bot.onText(/^\/search(?:@\w+)?(?:\s+.*)?$/i, (message) => {
            void handleSearchCommand(bot, message);
        });
        bot.onText(/^\/link(?:@\w+)?\s+(.+)$/i, (message, match) => {
            void handleLinkCommand(bot, message, normalizeText(match?.[1]));
        });
        bot.onText(/^\/unlink(?:@\w+)?(?:\s+.*)?$/i, (message) => {
            void handleUnlinkCommand(bot, message);
        });

        // Keep legacy commands for backward compatibility
        bot.onText(/^\/my_tasks(?:@\w+)?(?:\s+.*)?$/i, (message) => {
            void handleMyTasks(message);
        });
        bot.onText(/^\/checkin(?:@\w+)?\s+(.+)$/i, (message, match) => {
            void handleCheckinCommand(message, normalizeText(match?.[1]));
        });

        // Register callback query handler
        bot.on('callback_query', (query) => {
            void handleCallbackQuery(query);
        });

        // Register inline query handlers
        (bot as any).on('inline_query', (query: any) => {
            void handleInlineQuery(bot, query);
        });
        (bot as any).on('chosen_inline_result', (result: any) => {
            void handleChosenInlineResult(result);
        });

        // Register message handler with conversation state support
        bot.on('message', async (message) => {
            const text = normalizeText(message?.text);
            if (text.startsWith('/')) {
                return;
            }

            // Try conversation handler first
            const handled = await handleConversationMessage(bot, message);
            if (handled) {
                return;
            }

            // Fall back to legacy handler
            void handleMessage(message);
        });

        bot.on('polling_error', (error) => {
            logger.error('Telegram polling error', {
                error: serializeError(error),
            });
        });

        try {
            const me = await bot.getMe();
            const username = normalizeText(me?.username);
            if (username) {
                telegramBotUsername = username;
            }
        }
        catch (error) {
            logger.warn('Failed to resolve Telegram bot username', {
                error: serializeError(error),
            });
        }

        // Set bot commands menu
        await setBotCommands(bot);

        // Enable inline mode
        await enableInlineMode(bot);

        // Initialize webhook mode if configured
        if (useWebhook) {
            const webhookInitialized = await initializeWebhookMode(bot);
            logger.info('Telegram bot initialized', {
                username: telegramBotUsername,
                mode: webhookInitialized ? 'webhook' : 'polling',
                webhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
            });
        } else {
            logger.info('Telegram bot initialized', {
                username: telegramBotUsername,
                mode: 'polling',
            });
        }

        return bot;
    })().catch((error) => {
        void telegramBot?.stopPolling();
        telegramBot = null;
        startPromise = null;
        logger.error('Telegram bot start failed', {
            error: serializeError(error),
        });
        throw error;
    });
    return startPromise;
};

export const stopTelegramBot = async () => {
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
    if (telegramBot) {
        try {
            await telegramBot.stopPolling();
            logger.info('Telegram bot stopped');
        } catch (error) {
            logger.error('Error stopping Telegram bot', { error: serializeError(error) });
        }
        telegramBot = null;
    }
    startPromise = null;
};
