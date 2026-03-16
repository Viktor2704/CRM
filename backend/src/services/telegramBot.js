import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { appConfig } from '../config.js';
import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';
import { storeFile } from './fileStorage.js';
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
let telegramBot = null;
let telegramBotUsername = appConfig.telegramBotUsername || 'NovinzhstroyBot';
let startPromise = null;
let cleanupTimer = null;
let TelegramBotCtor = null;
const pendingActions = new Map();
const pendingCheckins = new Map();
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
const resolveRequestByKey = async (key) => {
    const requestKey = normalizeText(key);
    if (!requestKey) {
        return null;
    }
    const result = await dbQuery(`select
       id::text as id,
       coalesce(title, '') as title,
       coalesce(description, '') as description,
       coalesce(type, '') as type,
       coalesce(system_type, '') as system_type,
       coalesce(priority, 'medium') as priority,
       coalesce(status, 'new') as status,
       coalesce(executor_ids, '{}'::text[]) as executor_ids,
       coalesce(created_by_id, '') as created_by_id,
       created_at,
       updated_at,
       due_date_preliminary
     from requests
     where deleted_at is null
       and type <> 'installation'
       and id::text like ($1 || '%')
     order by created_at desc
     limit 1`, [requestKey]);
    return result.rows[0] ?? null;
};
const resolvePlanByKey = async (key) => {
    const planKey = normalizeText(key);
    if (!planKey) {
        return null;
    }
    const result = await dbQuery(`select
       id::text as id,
       coalesce(system_type, '') as system_type,
       valid_from,
       valid_to,
       coalesce(contact_person, '') as contact_person,
       coalesce(contact_phone, '') as contact_phone
     from maintenance_plans
     where id::text like ($1 || '%')
     order by created_at desc
     limit 1`, [planKey]);
    return result.rows[0] ?? null;
};
const findUserByChatId = async (chatId) => {
    const result = await dbQuery(`select
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
    const result = await dbQuery(`select id::text as id
     from app_users
     where role::text in ('admin', 'manager')
       and status::text = 'active'`);
    return result.rows.map((row) => normalizeText(row.id)).filter((value) => isUuidValue(value));
};
const pushInAppDirect = async (recipientIds, eventType, title, body, entityType, entityId) => {
    const ids = Array.from(new Set((recipientIds ?? []).map((value) => normalizeText(value)).filter((value) => isUuidValue(value))));
    if (ids.length === 0) {
        return;
    }
    await Promise.all(ids.map(async (userId) => {
        await dbQuery(`insert into app_notifications(
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
const updateRequestStatus = async (requestId, status, resolution) => {
    if (!isUuidValue(requestId)) {
        return null;
    }
    const updates = ['status = $2', 'updated_at = now()'];
    const values = [requestId, status];
    if (resolution && typeof resolution === 'object') {
        values.push(JSON.stringify(resolution));
        updates.push(`resolution = $${values.length}::jsonb`);
    }
    const result = await dbQuery(`update requests
       set ${updates.join(', ')}
       where id = $1::uuid
         and type <> 'installation'
         and deleted_at is null
       returning id::text as id`, values);
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
    const response = await fetch(`https://api.telegram.org/file/bot${appConfig.telegramBotToken}/${filePath}`);
    if (!response.ok) {
        throw new Error(`Telegram file download failed with status ${response.status}`);
    }
    const content = Buffer.from(await response.arrayBuffer());
    const ext = path.extname(filePath).toLowerCase() || '.jpg';
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const stored = await storeFile({
        fileName: `telegram_photo_${Date.now()}${ext}`,
        mimeType,
        content,
    });
    return {
        stored,
        mimeType,
    };
};
const appendPhotoToRequest = async (requestId, uploadedBy, fileInfo) => {
    if (!isUuidValue(requestId) || !fileInfo) {
        return null;
    }
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
    const result = await dbQuery(`update requests
       set files = coalesce(files, '[]'::jsonb) || $2::jsonb,
           updated_at = now()
       where id = $1::uuid
         and deleted_at is null
         and type <> 'installation'
       returning id::text as id`, [requestId, JSON.stringify([fileRecord])]);
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
    const tokenResult = await dbQuery(`select
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
    await dbQuery(`update app_users
       set telegram_chat_id = null
       where telegram_chat_id = $1
         and id::text <> $2`, [String(chatId), userId]);
    await dbQuery(`update app_users
       set telegram_chat_id = $1
       where id = $2::uuid`, [String(chatId), userId]);
    if (isUuidValue(tokenId)) {
        await dbQuery(`update telegram_link_tokens
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
    const result = await dbQuery(`update app_users
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
    const rows = await dbQuery(`select
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
    const requestRow = await resolveRequestByKey(requestKey);
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
    const itemResult = await dbQuery(`select
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
    await dbQuery(`insert into checkins(
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
        const plan = await resolvePlanByKey(pending.entityKey);
        if (!plan || !isUuidValue(plan.id)) {
            pendingActions.delete(String(chatId));
            await telegramBot.sendMessage(chatId, 'План ТО не найден.');
            return true;
        }
        await dbQuery(`insert into maintenance_plan_confirmations(
         plan_id,
         action,
         token,
         responded_by,
         confirmed_at
       )
       values($1::uuid, 'reschedule', $2, $3, now())`, [
            plan.id,
            `tg-${randomUUID()}`,
            normalizeText(user.id),
        ]);
        const adminIds = await listAdminManagerIds();
        await pushInAppDirect(adminIds, 'plan_action', 'Запрошен перенос ТО через Telegram', `План ${toShortId(plan.id)}. Причина: ${comment}`, 'maintenance_plan', plan.id);
        pendingActions.delete(String(chatId));
        await telegramBot.sendMessage(chatId, '📅 Запрос на перенос отправлен.').catch(() => { });
        return true;
    }
    if (pending.action === 'done_resolution') {
        const requestRow = await resolveRequestByKey(pending.entityKey);
        if (!requestRow || !isUuidValue(requestRow.id)) {
            pendingActions.delete(String(chatId));
            await telegramBot.sendMessage(chatId, 'Заявка не найдена.');
            return true;
        }
        if (!comment && (!Array.isArray(message?.photo) || message.photo.length === 0)) {
            await telegramBot.sendMessage(chatId, 'Опишите выполненные работы текстом или отправьте фото.');
            return true;
        }
        await updateRequestStatus(requestRow.id, 'done', {
            text: comment || 'Работы завершены',
            completedAt: new Date().toISOString(),
            completedVia: 'telegram',
        });
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
    await dbQuery(`with latest as (
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
    const requestRow = await resolveRequestByKey(ticketKey);
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
        await appendPhotoToRequest(requestRow.id, normalizeText(user.id), uploaded);
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
    try {
        if (parsed.action === 'details') {
            const requestRow = await resolveRequestByKey(parsed.entityKey);
            if (requestRow) {
                await sendRequestDetails(chatId, requestRow);
            }
            await telegramBot.answerCallbackQuery(query.id, { text: 'Показаны детали' }).catch(() => { });
            return;
        }
        if (parsed.action === 'take') {
            const requestRow = await resolveRequestByKey(parsed.entityKey);
            if (!requestRow || !isUuidValue(requestRow.id)) {
                throw new Error('Request not found');
            }
            await dbQuery(`update requests
             set status = 'in_progress',
                 executor_ids = case
                   when $1::text = any(coalesce(executor_ids, '{}'::text[]))
                     then coalesce(executor_ids, '{}'::text[])
                   else array_append(coalesce(executor_ids, '{}'::text[]), $1::text)
                 end,
                 updated_at = now()
             where id = $2::uuid
               and deleted_at is null
               and type <> 'installation'`, [normalizeText(user.id), requestRow.id]);
            await markQueryDone(query, `Взято в работу #${toShortId(requestRow.id)}`, actorName);
            await telegramBot.answerCallbackQuery(query.id, { text: '✅ Взято в работу' }).catch(() => { });
            return;
        }
        if (parsed.action === 'assign') {
            const requestRow = await resolveRequestByKey(parsed.entityKey);
            if (!requestRow || !isUuidValue(requestRow.id)) {
                throw new Error('Request not found');
            }
            const executorsResult = await dbQuery(`select
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
            const requestRow = await resolveRequestByKey(parsed.entityKey);
            if (!requestRow || !isUuidValue(requestRow.id)) {
                throw new Error('Request not found');
            }
            const executorKey = normalizeText(parsed.extra);
            const assigneeResult = await dbQuery(`select
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
            await dbQuery(`update requests
             set executor_ids = array[$2::text],
                 status = 'assigned',
                 updated_at = now()
             where id = $1::uuid
               and deleted_at is null
               and type <> 'installation'`, [requestRow.id, assigneeId]);
            await markQueryDone(query, `Назначено: ${assigneeName}`, actorName);
            await telegramBot.answerCallbackQuery(query.id, { text: 'Исполнитель назначен' }).catch(() => { });
            return;
        }
        if (parsed.action === 'priority_set') {
            const requestRow = await resolveRequestByKey(parsed.entityKey);
            if (!requestRow || !isUuidValue(requestRow.id)) {
                throw new Error('Request not found');
            }
            const priority = ['critical', 'high', 'medium', 'low'].includes(parsed.extra) ? parsed.extra : 'medium';
            await dbQuery(`update requests
             set priority = $2,
                 updated_at = now()
             where id = $1::uuid
               and deleted_at is null
               and type <> 'installation'`, [requestRow.id, priority]);
            await markQueryDone(query, `Приоритет: ${PRIORITY_LABELS[priority] || priority}`, actorName);
            await telegramBot.answerCallbackQuery(query.id, { text: 'Приоритет обновлён' }).catch(() => { });
            return;
        }
        if (parsed.action === 'priority') {
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
            const requestRow = await resolveRequestByKey(parsed.entityKey);
            if (!requestRow || !isUuidValue(requestRow.id)) {
                throw new Error('Request not found');
            }
            if (parsed.extra === 'done') {
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
            await updateRequestStatus(requestRow.id, safeStatus, undefined);
            await markQueryDone(query, `Статус: ${STATUS_LABELS[safeStatus] || safeStatus}`, actorName);
            await telegramBot.answerCallbackQuery(query.id, { text: 'Статус обновлён' }).catch(() => { });
            return;
        }
        if (parsed.action === 'confirm_plan') {
            const plan = await resolvePlanByKey(parsed.entityKey);
            if (!plan || !isUuidValue(plan.id)) {
                throw new Error('Plan not found');
            }
            await dbQuery(`insert into maintenance_plan_confirmations(
             plan_id,
             action,
             token,
             responded_by,
             confirmed_at
           )
           values($1::uuid, 'confirm', $2, $3, now())`, [plan.id, `tg-${randomUUID()}`, normalizeText(user.id)]);
            const adminIds = await listAdminManagerIds();
            await pushInAppDirect(adminIds, 'plan_action', 'План ТО согласован через Telegram', `План ${toShortId(plan.id)} подтверждён.`, 'maintenance_plan', plan.id);
            await markQueryDone(query, `План ${toShortId(plan.id)} согласован`, actorName);
            await telegramBot.answerCallbackQuery(query.id, { text: '✅ План согласован' }).catch(() => { });
            return;
        }
        if (parsed.action === 'reschedule_plan') {
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
            const plan = await resolvePlanByKey(parsed.entityKey);
            const contact = `${normalizeText(plan?.contact_person) || 'не указан'}, ${normalizeText(plan?.contact_phone) || 'телефон не указан'}`;
            await telegramBot.sendMessage(chatId, `📞 Контакт: ${contact}`).catch(() => { });
            await telegramBot.answerCallbackQuery(query.id, { text: 'Контакт показан' }).catch(() => { });
            return;
        }
        if (parsed.action === 'resend') {
            const plan = await resolvePlanByKey(parsed.entityKey);
            if (plan && isUuidValue(plan.id)) {
                await dbQuery(`update maintenance_plans set confirmation_sent_at = now() where id = $1::uuid`, [plan.id]);
                await markQueryDone(query, `Повторная отправка отмечена для плана ${toShortId(plan.id)}`, actorName);
            }
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
        await telegramBot.answerCallbackQuery(query.id, { text: 'Ошибка. Попробуйте позже.' }).catch(() => { });
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
const ensureTelegramBotCtor = async () => {
    if (TelegramBotCtor) {
        return TelegramBotCtor;
    }
    const module = await import('node-telegram-bot-api');
    TelegramBotCtor = module.default;
    return TelegramBotCtor;
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
        const TelegramBot = await ensureTelegramBotCtor();
        const bot = new TelegramBot(appConfig.telegramBotToken, { polling: true });
        telegramBot = bot;
        if (cleanupTimer) {
            clearInterval(cleanupTimer);
        }
        cleanupTimer = setInterval(cleanupExpiredState, CLEANUP_INTERVAL_MS);
        cleanupExpiredState();
        bot.onText(/^\/start(?:@\w+)?(?:\s+.*)?$/i, (message) => {
            void handleStart(message);
        });
        bot.onText(/^\/help(?:@\w+)?(?:\s+.*)?$/i, (message) => {
            void handleHelp(message);
        });
        bot.onText(/^\/link(?:@\w+)?\s+(.+)$/i, (message, match) => {
            void handleLink(message, normalizeText(match?.[1]));
        });
        bot.onText(/^\/unlink(?:@\w+)?(?:\s+.*)?$/i, (message) => {
            void handleUnlink(message);
        });
        bot.onText(/^\/my_tasks(?:@\w+)?(?:\s+.*)?$/i, (message) => {
            void handleMyTasks(message);
        });
        bot.onText(/^\/status(?:@\w+)?\s+(.+)$/i, (message, match) => {
            void handleStatus(message, normalizeText(match?.[1]));
        });
        bot.onText(/^\/checkin(?:@\w+)?\s+(.+)$/i, (message, match) => {
            void handleCheckinCommand(message, normalizeText(match?.[1]));
        });
        bot.on('callback_query', (query) => {
            void handleCallbackQuery(query);
        });
        bot.on('message', (message) => {
            const text = normalizeText(message?.text);
            if (text.startsWith('/')) {
                return;
            }
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
        logger.info('Telegram bot initialized', {
            username: telegramBotUsername,
            polling: true,
        });
        return bot;
    })().catch((error) => {
        telegramBot = null;
        startPromise = null;
        logger.error('Telegram bot start failed', {
            error: serializeError(error),
        });
        throw error;
    });
    return startPromise;
};
