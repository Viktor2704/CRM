import { appConfig } from '../config.js';
import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';
import { callLLM } from './aiService.js';
import { getTelegramBot } from './telegramBot.js';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
const isUuidValue = (value) => uuidPattern.test(value);
const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const toEntityKey = (entityId) => normalizeText(entityId).slice(0, 8);
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
export const pushTelegramNotification = async (params) => {
    if (!appConfig.telegramBotEnabled) {
        return;
    }
    const bot = getTelegramBot();
    if (!bot) {
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
        const recipientsResult = await dbQuery(`select
         id::text as id,
         telegram_chat_id
       from app_users
       where id = any($1::uuid[])
         and status::text = 'active'
         and coalesce(telegram_chat_id, '') <> ''`, [recipientIds]);
        const chatIds = Array.from(new Set(recipientsResult.rows
            .map((row) => normalizeText(row.telegram_chat_id))
            .filter(Boolean)));
        if (chatIds.length === 0) {
            return;
        }
        const ai = await enrichWithAi({ eventType, title, body, entityType, entityId }).catch(() => null);
        const text = buildMessageText({
            eventType,
            title,
            body,
            ai,
        });
        const replyMarkup = buildInlineKeyboard({
            eventType,
            entityType,
            entityId,
        });
        await Promise.all(chatIds.map(async (chatId) => {
            try {
                await bot.sendMessage(chatId, text, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    reply_markup: replyMarkup,
                });
            }
            catch (error) {
                const maskedChatId = `${chatId.slice(0, 2)}***${chatId.slice(-2)}`;
                logger.warn('Telegram notification send failed', {
                    eventType,
                    entityType,
                    entityId,
                    chatId: maskedChatId,
                    error: serializeError(error),
                });
            }
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
