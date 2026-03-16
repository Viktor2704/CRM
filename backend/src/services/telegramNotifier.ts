import { randomUUID } from 'node:crypto';
import { appConfig } from '../config.js';
import { dbQuery } from '../db.js';
import { escapeHtml, isUuidValue, normalizeText } from '../helpers/normalize.js';
import { filterNotificationRecipientIdsByEntityScope } from '../helpers/notificationRecipientScope.js';
import { logger, serializeError } from '../logger.js';
import { callLLM } from './aiService.js';
import { getTelegramBot } from './telegramBot.js';
import { getTelegramRateLimitSnapshot } from './telegramRateLimiter.js';
import { canSendEmails, sendSystemEventNotice } from './mailService.js';
import { listActiveAdminRecipients } from './userService.js';

const TELEGRAM_SEND_RETRY_DELAYS_MS = [1000, 2000, 4000];
const TELEGRAM_FAILURE_ALERT_WINDOW_MS = 10 * 60 * 1000;
const TELEGRAM_FAILURE_ALERT_THRESHOLD = 3;
const TELEGRAM_QUEUE_BATCH_SIZE = 25;

const failureTracker = new Map<string, number[]>();
let lastFailureAlertAt = 0;

const toEntityKey = (entityId) => normalizeText(entityId).slice(0, 8);

const sleep = (delayMs: number) => new Promise((resolve) => {
    setTimeout(resolve, delayMs);
});

const getEventIcon = (eventType) => {
    const type = normalizeText(eventType).toLowerCase();
    if (type.includes('created')) {
        return '🆕';
    }
    if (type.includes('deleted')) {
        return '🗑️';
    }
    if (type.includes('updated')) {
        return '✏️';
    }
    if (type.includes('checkin')) {
        return '📍';
    }
    if (type.includes('escalation')) {
        return '⚠️';
    }
    if (type.includes('reminder')) {
        return '⏰';
    }
    if (type.includes('overdue') || type.includes('report')) {
        return '🔴';
    }
    if (type.includes('digest')) {
        return '📊';
    }
    if (type.includes('confirm') || type.includes('done')) {
        return '✅';
    }
    return '🔔';
};

const isUrgentFallback = (eventType, title, body) => {
    const text = `${normalizeText(eventType)} ${normalizeText(title)} ${normalizeText(body)}`.toLowerCase();
    return text.includes('critical')
        || text.includes('авар')
        || text.includes('сроч')
        || text.includes('эскалац')
        || text.includes('overdue');
};

const parseAiJson = (value) => {
    const raw = normalizeText(value);
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw);
    }
    catch (_error) {
    }
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
        return null;
    }
    try {
        return JSON.parse(match[0]);
    }
    catch (_error) {
        return null;
    }
};

const enrichWithAi = async (params) => {
    if (!appConfig.aiEnabled) {
        return null;
    }
    try {
        const result = await callLLM(`Ты ассистент Telegram-бота Новинжстрой.
Переформулируй уведомление кратко и понятно для человека.
Верни только JSON:
{"text":"2-3 предложения","urgent":false,"action":"короткая рекомендация или null"}
Никаких комментариев вне JSON.`, `Тип: ${normalizeText(params?.eventType)}
Заголовок: ${normalizeText(params?.title)}
Текст: ${normalizeText(params?.body)}
Сущность: ${normalizeText(params?.entityType)}
ID: ${normalizeText(params?.entityId)}`);
        const parsed = parseAiJson(result);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        return {
            text: normalizeText(parsed.text),
            urgent: parsed.urgent === true,
            action: normalizeText(parsed.action),
        };
    }
    catch (error) {
        logger.warn('Telegram AI enrichment failed', {
            eventType: normalizeText(params?.eventType),
            entityType: normalizeText(params?.entityType),
            entityId: normalizeText(params?.entityId),
            error: serializeError(error),
        });
        return null;
    }
};

const buildInlineKeyboard = ({ eventType, entityType, entityId }) => {
    const key = toEntityKey(entityId);
    if (!key) {
        return undefined;
    }
    const normalizedEventType = normalizeText(eventType).toLowerCase();
    const normalizedEntityType = normalizeText(entityType).toLowerCase();
    if (normalizedEntityType === 'service_request' || normalizedEntityType === 'service_request_bulk') {
        return {
            inline_keyboard: [
                [
                    { text: '✅ Взять в работу', callback_data: `action:take:${key}` },
                    { text: '👤 Назначить', callback_data: `action:assign:${key}` },
                ],
                [
                    { text: '🔺 Приоритет', callback_data: `action:priority:${key}` },
                    { text: '📋 Подробнее', callback_data: `action:details:${key}` },
                ],
                [
                    { text: '🚀 Начать работу', callback_data: `action:status:${key}:in_progress` },
                    { text: '📍 На объекте', callback_data: `action:status:${key}:on_site` },
                ],
                [
                    { text: '✅ Выполнено', callback_data: `action:status:${key}:done` },
                ],
            ],
        };
    }
    if (normalizedEntityType === 'maintenance_plan'
        || normalizedEventType.includes('plan')
        || normalizedEventType.includes('maintenance')) {
        return {
            inline_keyboard: [[
                { text: '✅ Согласовано', callback_data: `action:confirm_plan:${key}` },
                { text: '📅 Требуется перенос', callback_data: `action:reschedule_plan:${key}` },
            ]],
        };
    }
    if (normalizedEventType.includes('escalation')
        || normalizedEventType.includes('overdue')
        || normalizedEventType.includes('reminder')) {
        return {
            inline_keyboard: [[
                { text: '📞 Позвонить клиенту', callback_data: `action:call_client:${key}` },
                { text: '🔁 Отправить повторно', callback_data: `action:resend:${key}` },
                { text: '👤 Переназначить', callback_data: `action:reassign:${key}` },
            ]],
        };
    }
    return undefined;
};

const buildMessageText = ({ eventType, title, body, ai }) => {
    const icon = getEventIcon(eventType);
    const urgent = ai?.urgent === true || isUrgentFallback(eventType, title, body);
    const header = urgent
        ? `🚨🚨🚨 ${icon} <b>${escapeHtml(title || 'Срочное уведомление')}</b>`
        : `${icon} <b>${escapeHtml(title || 'Уведомление')}</b>`;
    const details = normalizeText(ai?.text) || normalizeText(body) || 'Подробнее в системе.';
    const action = normalizeText(ai?.action);
    const parts = [header, '', escapeHtml(details)];
    if (action) {
        parts.push('', `💡 <i>${escapeHtml(action)}</i>`);
    }
    return parts.join('\n');
};

const isRetryableTelegramError = (error: unknown) => {
    const errorCode = Number((error as any)?.response?.error_code ?? (error as any)?.error_code ?? 0);
    return errorCode !== 403;
};

const extractTelegramErrorCode = (error: unknown) => {
    const errorCode = Number((error as any)?.response?.error_code ?? (error as any)?.error_code ?? 0);
    return Number.isFinite(errorCode) && errorCode > 0 ? String(errorCode) : '';
};

const recordTelegramFailure = async (context: { error: unknown; chatId: string; eventType: string }) => {
    const now = Date.now();
    const key = 'telegram';
    const timestamps = failureTracker.get(key) ?? [];
    const recent = timestamps.filter((timestamp) => now - timestamp <= TELEGRAM_FAILURE_ALERT_WINDOW_MS);
    recent.push(now);
    failureTracker.set(key, recent);
    if (recent.length < TELEGRAM_FAILURE_ALERT_THRESHOLD || now - lastFailureAlertAt < TELEGRAM_FAILURE_ALERT_WINDOW_MS) {
        return;
    }
    lastFailureAlertAt = now;
    if (!canSendEmails()) {
        return;
    }
    try {
        const admins = await listActiveAdminRecipients();
        await Promise.all(admins.map(async (admin) => {
            await sendSystemEventNotice({
                to: admin.email,
                subject: 'Telegram delivery failures detected',
                body: `В Telegram накопилось не менее ${TELEGRAM_FAILURE_ALERT_THRESHOLD} ошибок за 10 минут.\n\nСобытие: ${context.eventType}\nChat ID: ${context.chatId}\nОшибка: ${JSON.stringify(serializeError(context.error))}`,
            });
        }));
    }
    catch (error) {
        logger.error('Failed to alert admins about Telegram delivery failures', {
            error: serializeError(error),
        });
    }
};

const mapTelegramNotificationRow = (row: any) => ({
    id: String(row?.id ?? ''),
    userId: String(row?.user_id ?? ''),
    telegramChatId: String(row?.telegram_chat_id ?? ''),
    eventType: String(row?.event_type ?? ''),
    entityType: String(row?.entity_type ?? ''),
    entityId: String(row?.entity_id ?? ''),
    title: String(row?.title ?? ''),
    body: String(row?.body ?? ''),
    telegramMessageId: String(row?.telegram_message_id ?? ''),
    status: String(row?.status ?? 'pending'),
    sentAt: row?.sent_at ? String(row.sent_at) : '',
    readAt: row?.read_at ? String(row.read_at) : '',
    errorMessage: String(row?.error_message ?? ''),
    errorCode: String(row?.error_code ?? ''),
    retryCount: Number(row?.retry_count ?? 0),
    createdAt: row?.created_at ? String(row.created_at) : '',
});

export const sendTelegramWithRetry = async (params: {
    chatId: string;
    text: string;
    replyMarkup?: Record<string, unknown>;
}) => {
    const bot = getTelegramBot();
    if (!bot) {
        throw new Error('Telegram bot is not available');
    }
    let attemptsUsed = 0;
    for (let attempt = 0; attempt < TELEGRAM_SEND_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
            attemptsUsed = attempt + 1;
            const message = await bot.sendMessage(params.chatId, params.text, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: params.replyMarkup,
            });
            return {
                attemptsUsed,
                message,
            };
        }
        catch (error) {
            attemptsUsed = attempt + 1;
            const retryable = isRetryableTelegramError(error);
            logger.warn('Telegram send attempt failed', {
                chatId: params.chatId,
                attempt: attempt + 1,
                retryable,
                error: serializeError(error),
            });
            if (!retryable || attempt === TELEGRAM_SEND_RETRY_DELAYS_MS.length - 1) {
                throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
                    attemptsUsed,
                });
            }
            await sleep(TELEGRAM_SEND_RETRY_DELAYS_MS[attempt]);
        }
    }
    throw new Error('Telegram delivery failed');
};

const createTelegramNotificationRecord = async (params: {
    userId: string;
    chatId: string;
    eventType: string;
    title: string;
    body: string;
    entityType: string;
    entityId: string;
}) => {
    const id = randomUUID();
    await dbQuery(`insert into telegram_notifications(
       id,
       user_id,
       telegram_chat_id,
       event_type,
       entity_type,
       entity_id,
       title,
       body,
       status
     )
     values($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7, $8, 'pending')`, [
        id,
        params.userId,
        params.chatId,
        params.eventType,
        params.entityType || null,
        isUuidValue(params.entityId) ? params.entityId : null,
        params.title,
        params.body,
    ]);
    return id;
};

const buildNotificationPayload = async (row: any) => {
    const mapped = mapTelegramNotificationRow(row);
    const ai = await enrichWithAi({
        eventType: mapped.eventType,
        title: mapped.title,
        body: mapped.body,
        entityType: mapped.entityType,
        entityId: mapped.entityId,
    });
    return {
        chatId: mapped.telegramChatId,
        text: buildMessageText({
            eventType: mapped.eventType,
            title: mapped.title,
            body: mapped.body,
            ai,
        }),
        replyMarkup: buildInlineKeyboard({
            eventType: mapped.eventType,
            entityType: mapped.entityType,
            entityId: mapped.entityId,
        }),
    };
};

const markTelegramNotificationSent = async (row: any, messageId: unknown) => {
    await dbQuery(`update telegram_notifications
       set status = 'sent',
           telegram_message_id = $2,
           sent_at = now(),
           error_message = null,
           error_code = null
       where id = $1::uuid`, [
        String(row?.id ?? ''),
        messageId === undefined || messageId === null ? null : String(messageId),
    ]);
};

const markTelegramNotificationFailed = async (row: any, error: unknown, attemptsUsed: number) => {
    const mapped = mapTelegramNotificationRow(row);
    await dbQuery(`update telegram_notifications
       set status = 'failed',
           retry_count = $2,
           error_message = $3,
           error_code = $4
       where id = $1::uuid`, [
        mapped.id,
        mapped.retryCount + Math.max(1, attemptsUsed),
        normalizeText((error as Error)?.message) || JSON.stringify(serializeError(error)),
        extractTelegramErrorCode(error) || null,
    ]);
    await recordTelegramFailure({
        error,
        chatId: mapped.telegramChatId,
        eventType: mapped.eventType,
    });
};

export const processTelegramNotificationRecord = async (row: any) => {
    const mapped = mapTelegramNotificationRow(row);
    if (!mapped.id || !mapped.telegramChatId) {
        return false;
    }
    const bot = getTelegramBot();
    if (!bot) {
        return false;
    }
    try {
        const payload = await buildNotificationPayload(row);
        const result = await sendTelegramWithRetry(payload);
        await markTelegramNotificationSent(row, (result.message as any)?.message_id ?? null);
        return true;
    }
    catch (error) {
        const attemptsUsed = Number((error as any)?.attemptsUsed ?? TELEGRAM_SEND_RETRY_DELAYS_MS.length);
        await markTelegramNotificationFailed(row, error, attemptsUsed);
        return false;
    }
};

export const loadPendingTelegramNotificationsBatch = async (limit = TELEGRAM_QUEUE_BATCH_SIZE) => {
    const result = await dbQuery(`select *
       from telegram_notifications
       where status = 'pending'
       order by created_at
       limit $1`, [Math.max(1, Math.min(100, limit))]);
    return result.rows;
};

export const listTelegramNotificationsForUser = async (userId: string, params: { status?: string; limit?: number; offset?: number } = {}) => {
    const limit = Math.max(1, Math.min(100, Number(params.limit ?? 50)));
    const offset = Math.max(0, Number(params.offset ?? 0));
    const status = normalizeText(params.status).toLowerCase();
    const conditions = ['user_id = $1::uuid'];
    const values: unknown[] = [userId];
    if (status === 'unread') {
        conditions.push('read_at is null');
        conditions.push(`status in ('sent', 'read')`);
    }
    else if (status === 'failed') {
        conditions.push(`status = 'failed'`);
    }
    else if (status === 'sent') {
        conditions.push(`status in ('sent', 'read')`);
    }
    const itemsResult = await dbQuery(`select *
       from telegram_notifications
       where ${conditions.join(' and ')}
       order by created_at desc
       limit $2
       offset $3`, [...values, limit, offset]);
    const totalResult = await dbQuery(`select count(*)::int as total
       from telegram_notifications
       where ${conditions.join(' and ')}`, values);
    const unreadResult = await dbQuery(`select count(*)::int as total
       from telegram_notifications
       where user_id = $1::uuid
         and read_at is null
         and status in ('sent', 'read')`, [userId]);
    return {
        items: itemsResult.rows.map(mapTelegramNotificationRow),
        total: Number(totalResult.rows[0]?.total ?? 0),
        unreadCount: Number(unreadResult.rows[0]?.total ?? 0),
    };
};

export const markTelegramNotificationRead = async (userId: string, notificationId: string) => {
    const result = await dbQuery(`update telegram_notifications
       set read_at = now(),
           status = case when status = 'sent' then 'read' else status end
       where id = $1::uuid
         and user_id = $2::uuid
         and status in ('sent', 'read')`, [notificationId, userId]);
    return result.rowCount ?? 0;
};

export const markAllTelegramNotificationsRead = async (userId: string) => {
    const result = await dbQuery(`update telegram_notifications
       set read_at = now(),
           status = case when status = 'sent' then 'read' else status end
       where user_id = $1::uuid
         and read_at is null
         and status in ('sent', 'read')`, [userId]);
    return result.rowCount ?? 0;
};

export const listFailedTelegramNotifications = async (limit = 10) => {
    const result = await dbQuery(`select
       tn.*,
       coalesce(u.full_name, '') as user_full_name,
       coalesce(u.email, '') as user_email
     from telegram_notifications tn
     left join app_users u on u.id = tn.user_id
     where tn.status = 'failed'
     order by tn.created_at desc
     limit $1`, [Math.max(1, Math.min(100, limit))]);
    const countResult = await dbQuery(`select count(*)::int as total
       from telegram_notifications
       where status = 'failed'`);
    return {
        count: Number(countResult.rows[0]?.total ?? 0),
        items: result.rows.map((row) => ({
            ...mapTelegramNotificationRow(row),
            userName: String(row?.user_full_name ?? ''),
            userEmail: String(row?.user_email ?? ''),
        })),
    };
};

export const retryTelegramNotificationItems = async (ids: string[]) => {
    const normalizedIds = Array.from(new Set((ids ?? []).map((value) => normalizeText(value)).filter(Boolean)));
    if (normalizedIds.length === 0) {
        return 0;
    }
    const result = await dbQuery(`update telegram_notifications
       set status = 'pending',
           sent_at = null,
           read_at = null,
           error_message = null,
           error_code = null,
           retry_count = 0
       where id = any($1::uuid[])`, [normalizedIds]);
    return result.rowCount ?? 0;
};

export const pushTelegramNotification = async (params) => {
    if (!appConfig.telegramBotEnabled) {
        return;
    }
    const recipientIds = Array.isArray(params?.recipientIds)
        ? Array.from(new Set(params.recipientIds
            .map((value) => normalizeText(value))
            .filter((value) => isUuidValue(value))))
        : [];
    if (recipientIds.length === 0) {
        return;
    }
    const eventType = normalizeText(params?.eventType) || 'system_event';
    const title = normalizeText(params?.title);
    const body = normalizeText(params?.body);
    const entityType = normalizeText(params?.entityType);
    const entityId = normalizeText(params?.entityId);
    try {
        const allowedRecipientIds = await filterNotificationRecipientIdsByEntityScope({
            recipientIds,
            entityType,
            entityId,
            queryFn: dbQuery,
        });
        if (allowedRecipientIds.length === 0) {
            return;
        }
        const recipientsResult = await dbQuery(`select
         id::text as id,
         telegram_chat_id
       from app_users
       where id = any($1::uuid[])
         and status::text = 'active'
         and coalesce(telegram_chat_id, '') <> ''`, [allowedRecipientIds]);
        if (recipientsResult.rows.length === 0) {
            return;
        }
        const insertedRows = [];
        for (const row of recipientsResult.rows) {
            const userId = normalizeText(row.id);
            const chatId = normalizeText(row.telegram_chat_id);
            if (!isUuidValue(userId) || !chatId) {
                continue;
            }
            const notificationId = await createTelegramNotificationRecord({
                userId,
                chatId,
                eventType,
                title,
                body,
                entityType,
                entityId,
            });
            insertedRows.push({
                id: notificationId,
                user_id: userId,
                telegram_chat_id: chatId,
                event_type: eventType,
                entity_type: entityType,
                entity_id: isUuidValue(entityId) ? entityId : null,
                title,
                body,
                retry_count: 0,
                created_at: new Date().toISOString(),
                status: 'pending',
            });
        }
        const snapshot = getTelegramRateLimitSnapshot();
        if (snapshot.global.QUEUED > 1000) {
            logger.warn('Telegram notification delivery deferred because rate limiter queue is saturated', {
                queued: snapshot.global.QUEUED,
                oldestQueuedAgeMs: snapshot.oldestQueuedAgeMs,
            });
            return;
        }
        await Promise.all(insertedRows.map(async (row) => {
            await processTelegramNotificationRecord(row);
        }));
    }
    catch (error) {
        logger.error('pushTelegramNotification failed', {
            eventType,
            entityType,
            entityId,
            error: serializeError(error),
        });
    }
};
