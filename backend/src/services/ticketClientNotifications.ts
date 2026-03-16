import { dbQuery, withTx } from '../db.js';
import { logger, serializeError } from '../logger.js';
import { canSendEmails, smtpSendMail, sender } from './mailService.js';
import { resolveRecipientForNotification } from './notificationAccessService.js';
import { appConfig } from '../config.js';
import { escapeHtml, isUuidValue } from '../helpers/normalize.js';
import {
    wrapEmailHtml,
    emailButton,
    emailButtonOutline,
    emailButtonsRow,
    emailStatusBadge,
    emailInfoCard,
    emailHighlightCard,
    emailDueChange,
    emailTicketHeader,
    emailGreeting,
    emailSignatureBlock,
    shortTicketId,
    enhanceForExecutor,
    enhanceForClient,
} from '../helpers/emailTemplates.js';

const DEDUPE_WINDOW_SECONDS = 5 * 60;
const DIGEST_CHECK_INTERVAL_MS = 60 * 1000;
const DIGEST_HOUR_LIST = [10, 18];
const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000;
const DEDUPE_RETENTION_DAYS = 7;
const DIGEST_RETENTION_DAYS = 30;
const EVENT_LOG_RETENTION_DAYS = 90;
const DIGEST_RUNTIME_KEY_LAST_SLOT = 'ticket_client:last_digest_slot_key';
const DIGEST_SCHEDULER_LOCK_KEY = 420260201;
let digestSchedulerStarted = false;
let digestFlushInProgress = false;
let lastHousekeepingAtMs = 0;

const EVENT_ALIASES = new Map([
    ['created', 'created'],
    ['accepted', 'accepted'],
    ['waiting_info', 'need_info'],
    ['need_info', 'need_info'],
    ['customer_info_received', 'info_received'],
    ['info_received', 'info_received'],
    ['done_for_review', 'done_review'],
    ['done_review', 'done_review'],
    ['closed', 'closed'],
    ['due_changed', 'due_changed'],
    ['waiting_info_reminder', 'waiting_reminder'],
    ['waiting_reminder', 'waiting_reminder'],
    ['support_comment', 'support_comment'],
    ['support_comment_client_channel', 'support_comment'],
    ['rejected_or_not_possible', 'rejected'],
    ['rejected', 'rejected'],
    ['daily_digest', 'digest'],
    ['digest', 'digest'],
    ['project_created', 'created'],
    ['project_accepted', 'accepted'],
    ['project_started', 'accepted'],
    ['project_waiting_info', 'need_info'],
    ['project_need_info', 'need_info'],
    ['project_info_received', 'info_received'],
    ['project_update', 'support_comment'],
    ['project_status_changed', 'support_comment'],
    ['project_stage_changed', 'support_comment'],
    ['project_due_changed', 'due_changed'],
    ['project_done', 'done_review'],
    ['project_done_for_review', 'done_review'],
    ['project_closed', 'closed'],
    ['project_rejected', 'rejected'],
    ['project_waiting_info_reminder', 'waiting_reminder'],
    ['project_digest', 'digest'],
    ['ticket_qualified', 'accepted'],
    ['ticket_status_changed', 'support_comment'],
    ['ticket_updated', 'support_comment'],
    ['ticket_action', 'support_comment'],
    ['ticket_deleted', 'closed'],
    ['ticket_comment', 'support_comment'],
]);

const EVENT_SEVERITY = {
    created: 'normal',
    accepted: 'normal',
    need_info: 'high',
    info_received: 'normal',
    support_comment: 'normal',
    due_changed: 'high',
    done_review: 'high',
    closed: 'high',
    rejected: 'high',
    waiting_reminder: 'normal',
    digest: 'normal',
};

const EVENT_LABEL = {
    created: 'Зарегистрирована',
    accepted: 'Принята в работу',
    need_info: 'Нужна информация',
    info_received: 'Получена информация',
    support_comment: 'Обновление',
    due_changed: 'Срок изменен',
    done_review: 'Выполнена, на проверке',
    closed: 'Закрыта',
    rejected: 'Нужен другой вариант решения',
    waiting_reminder: 'Напоминание клиенту',
};

const DIGEST_CATEGORY_BY_EVENT = {
    created: 'inProgress',
    accepted: 'inProgress',
    info_received: 'inProgress',
    support_comment: 'inProgress',
    due_changed: 'inProgress',
    need_info: 'waitingCustomer',
    waiting_reminder: 'waitingCustomer',
    done_review: 'readyForReview',
    closed: 'closedToday',
};

const APP_URL = appConfig.appUrl || 'http://147.45.237.188';
const TICKET_URL = `${APP_URL}/service-requests`;

const asText = (value, fallback = '') => {
    if (typeof value !== 'string') {
        return fallback;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : fallback;
};

const pickText = (candidates, fallback = '') => {
    for (const candidate of candidates) {
        const value = asText(candidate);
        if (value) {
            return value;
        }
    }
    return fallback;
};

const asPositiveIntString = (value, fallback = '3') => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return String(Math.floor(value));
    }
    if (typeof value === 'string') {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed) && parsed > 0) {
            return String(Math.floor(parsed));
        }
    }
    return fallback;
};

const normalizeEventType = (value) => {
    const normalized = asText(value).toLowerCase();
    return EVENT_ALIASES.get(normalized) ?? null;
};

const getSeverity = (eventType) => {
    return EVENT_SEVERITY[eventType] ?? 'normal';
};

const formatCount = (value) => {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return String(Math.floor(value));
    }
    if (typeof value === 'string') {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed) && parsed >= 0) {
            return String(Math.floor(parsed));
        }
    }
    return '0';
};



const safeJsonString = (value, fallback) => {
    try {
        return JSON.stringify(value);
    }
    catch (_error) {
        return JSON.stringify(fallback);
    }
};

const isOutsideWorkHours = (date) => {
    const day = date.getDay();
    if (day === 0 || day === 6) {
        return true;
    }
    const hour = date.getHours();
    return hour < 9 || hour >= 19;
};

const buildThreadSubject = (ticketId, subject) => {
    const threadId = asText(ticketId, 'TICKET');
    return `[${threadId}] ${subject}`;
};

const sanitizePayloadForLog = (input) => {
    const recipient = input?.recipient && typeof input.recipient === 'object' ? input.recipient : {};
    const ticket = input?.ticket && typeof input.ticket === 'object' ? input.ticket : {};
    const meta = input?.meta && typeof input.meta === 'object' ? input.meta : {};

    return {
        scope: pickText([input?.scope], 'ticket'),
        eventType: asText(input?.eventType),
        projectId: pickText([input?.projectId, input?.project_id, meta.projectId, meta.project_id]),
        recipient: {
            email: pickText([recipient.email]).toLowerCase(),
            name: pickText([recipient.name, recipient.clientName, recipient.client_name, meta.clientName, meta.client_name]),
            clientId: pickText([
                recipient.clientId,
                recipient.client_id,
                meta.clientId,
                meta.client_id,
                meta.counterpartyId,
                meta.counterparty_id,
            ]),
        },
        ticket: {
            id: pickText([ticket.id, meta.ticketId, meta.ticket_id]),
            title: pickText([ticket.title, meta.title]),
            url: pickText([
                ticket.url,
                ticket.ticketUrl,
                ticket.ticket_url,
                meta.ticketUrl,
                meta.ticket_url,
                meta.portalUrl,
                meta.portal_url,
            ]),
            dueDatetime: pickText([ticket.dueDatetime, ticket.due_datetime, meta.dueDatetime, meta.due_datetime]),
            statusClient: pickText([ticket.statusClient, ticket.status_client, meta.statusClient, meta.status_client]),
        },
        meta: {
            company: pickText([meta.company]),
            supportName: pickText([meta.supportName, meta.support_name]),
            supportSignature: pickText([meta.supportSignature, meta.support_signature]),
            oldDue: pickText([meta.oldDue, meta.old_due, meta.dueOld]),
            newDue: pickText([meta.newDue, meta.new_due, meta.dueNew]),
            questionsList: pickText([meta.questionsList, meta.questions_list]),
            resolutionSummary: pickText([meta.resolutionSummary, meta.resolution_summary]),
            commentText: pickText([meta.commentText, meta.comment_text]),
            autoCloseDays: asPositiveIntString(meta.autoCloseDays ?? meta.auto_close_days, ''),
        },
        dedupeKey: pickText([
            input?.dedupeKey,
            input?.dedupe_key,
            input?.idempotencyKey,
            input?.idempotency_key,
            meta.idempotencyKey,
            meta.idempotency_key,
        ]),
    };
};

const normalizeContext = (input) => {
    const recipient = input.recipient && typeof input.recipient === 'object' ? input.recipient : {};
    const ticket = input.ticket && typeof input.ticket === 'object' ? input.ticket : {};
    const meta = input.meta && typeof input.meta === 'object' ? input.meta : {};
    const eventType = normalizeEventType(input.eventType);

    const company = pickText([meta.company], 'ЮЭТКА');
    const supportName = pickText([meta.supportName, meta.support_name], 'Служба поддержки');
    const supportSignature = pickText([meta.supportSignature, meta.support_signature], '');
    const option1 = pickText([meta.option1, meta.option_1], '');
    const option2 = pickText([meta.option2, meta.option_2], '');
    const optionsBlock = [option1, option2]
        .filter(Boolean)
        .map((line) => `* ${line}`)
        .join('\n');

    return {
        scope: pickText([input.scope], 'ticket').toLowerCase() === 'project' ? 'project' : 'ticket',
        eventType,
        severity: eventType ? getSeverity(eventType) : 'normal',
        recipientEmail: pickText([recipient.email]).toLowerCase(),
        recipientClientId: pickText([
            recipient.clientId,
            recipient.client_id,
            meta.clientId,
            meta.client_id,
            meta.counterpartyId,
            meta.counterparty_id,
        ]),
        recipientUserId: pickText([
            recipient.userId,
            recipient.user_id,
            meta.userId,
            meta.user_id,
        ]),
        recipientName: pickText([
            recipient.name,
            recipient.clientName,
            recipient.client_name,
            meta.clientName,
            meta.client_name,
        ], 'клиент'),
        ticketId: pickText([
            ticket.id,
            meta.projectId,
            meta.project_id,
            meta.ticketId,
            meta.ticket_id,
            input.projectId,
            input.project_id,
        ], '-'),
        ticketTitle: pickText([ticket.title, meta.title], 'Без названия'),
        ticketUrl: pickText([
            ticket.url,
            ticket.ticketUrl,
            ticket.ticket_url,
            meta.ticketUrl,
            meta.ticket_url,
            meta.portalUrl,
            meta.portal_url,
        ], '-'),
        dueDatetime: pickText([ticket.dueDatetime, ticket.due_datetime, meta.dueDatetime, meta.due_datetime], '-'),
        oldDue: pickText([meta.oldDue, meta.old_due, meta.dueOld], '-'),
        newDue: pickText([meta.newDue, meta.new_due, meta.dueNew], '-'),
        statusClient: pickText([ticket.statusClient, ticket.status_client, meta.statusClient, meta.status_client], 'В работе'),
        questionsList: pickText([meta.questionsList, meta.questions_list], '- уточнить детали по обращению'),
        resolutionSummary: pickText([
            ticket.resolutionSummary,
            ticket.resolution_summary,
            meta.resolutionSummary,
            meta.resolution_summary,
        ], 'Результат зафиксирован в заявке.'),
        commentText: pickText([meta.commentText, meta.comment_text], 'Добавлено обновление по заявке.'),
        resolutionShort: pickText([
            ticket.resolutionShort,
            ticket.resolution_short,
            meta.resolutionShort,
            meta.resolution_short,
        ], 'Работы завершены.'),
        closedDatetime: pickText([
            ticket.closedDatetime,
            ticket.closed_datetime,
            meta.closedDatetime,
            meta.closed_datetime,
        ], new Date().toLocaleString('ru-RU')),
        autoCloseDays: asPositiveIntString(meta.autoCloseDays ?? meta.auto_close_days, '3'),
        rejectionOptions: optionsBlock || pickText([
            meta.nextStepsList,
            meta.next_steps_list,
        ], '* Уточнить детали\n* Выбрать альтернативный вариант'),
        supportSignature,
        company,
        supportName,
        digestDate: pickText([meta.date], new Date().toLocaleDateString('ru-RU')),
        digestInProgressCount: formatCount(meta.inProgressCount ?? meta.in_progress_count),
        digestWaitingCustomerCount: formatCount(meta.waitingCustomerCount ?? meta.waiting_customer_count),
        digestReadyForReviewCount: formatCount(meta.readyForReviewCount ?? meta.ready_for_review_count),
        digestClosedTodayCount: formatCount(meta.closedTodayCount ?? meta.closed_today_count),
        digestTicketList: pickText([meta.ticketList, meta.ticket_list], 'Список заявок доступен в портале.'),
        digestPortalUrl: pickText([meta.portalUrl, meta.portal_url, meta.ticketUrl, meta.ticket_url], '-'),
        projectId: pickText([input.projectId, input.project_id, meta.projectId, meta.project_id]),
        actorUserId: pickText([input.actorUserId, input.actor_user_id]),
        actorRole: pickText([input.actorRole, input.actor_role]),
        requestId: pickText([input.requestId, input.request_id]),
        ip: pickText([input.ip]),
        dedupeKey: pickText([
            input.dedupeKey,
            input.dedupe_key,
            input.idempotencyKey,
            input.idempotency_key,
            meta.idempotencyKey,
            meta.idempotency_key,
        ]),
        suppressOutsideWorkHours: !!input.suppressOutsideWorkHours,
        recipientRole: pickText([input.recipientRole, input.recipient_role]),
        payloadForLog: sanitizePayloadForLog(input),
    };
};

const buildSignature = (ctx) => {
    if (ctx.supportSignature) {
        return ctx.supportSignature;
    }
    return `С уважением,\n${ctx.company} / ${ctx.supportName}`;
};

const buildEmailFromTemplate = async (ctx) => {
    const signature = buildSignature(ctx);
    const sid = shortTicketId(ctx.ticketId);
    const signatureHtml = emailSignatureBlock(signature);
    const openBtn = emailButton(TICKET_URL, 'Открыть заявку');

    // AI-enhanced description block for key events
    const buildAiDescriptionBlock = async (rawDescription: string, label: string) => {
        if (!rawDescription) return '';
        const enhanced = ctx.recipientRole === 'executor'
            ? await enhanceForExecutor(rawDescription, ctx.ticketTitle)
            : ctx.recipientRole === 'client'
                ? await enhanceForClient(rawDescription, ctx.ticketTitle)
                : rawDescription;
        const blockLabel = ctx.recipientRole === 'executor' ? 'Инструкция по выполнению:' : label;
        return emailInfoCard(
            `<strong>${escapeHtml(blockLabel)}</strong><br/><div style="white-space:pre-wrap;margin-top:8px;">${escapeHtml(enhanced)}</div>`
        );
    };

    switch (ctx.eventType) {
        case 'created': {
            const subject = buildThreadSubject(ctx.ticketId, `Заявка №${sid} зарегистрирована`);
            const aiBlock = await buildAiDescriptionBlock(ctx.ticketTitle, 'Описание работ:');
            const bodyHtml =
                emailGreeting(ctx.recipientName) +
                emailTicketHeader(sid, ctx.ticketTitle) +
                emailInfoCard(
                    `<strong>Статус:</strong> Зарегистрирована<br/>` +
                    `<strong>Плановый срок:</strong> ${escapeHtml(ctx.dueDatetime)}`
                ) +
                aiBlock +
                emailButtonsRow([openBtn]) +
                signatureHtml;
            const html = wrapEmailHtml(bodyHtml);
            const text = `Заявка №${sid} "${ctx.ticketTitle}" зарегистрирована. Срок: ${ctx.dueDatetime}.`;
            return { subject, html, text };
        }
        case 'accepted': {
            const subject = buildThreadSubject(ctx.ticketId, `Заявка №${sid} принята в работу`);
            const aiBlock = await buildAiDescriptionBlock(ctx.ticketTitle, 'Описание работ:');
            const bodyHtml =
                emailGreeting(ctx.recipientName) +
                emailTicketHeader(sid, ctx.ticketTitle) +
                emailStatusBadge('Принята в работу', '#2563EB') +
                emailInfoCard(
                    `<strong>Плановый срок:</strong> ${escapeHtml(ctx.dueDatetime)}`
                ) +
                aiBlock +
                emailButtonsRow([openBtn]) +
                signatureHtml;
            const html = wrapEmailHtml(bodyHtml);
            const text = `Заявка №${sid} "${ctx.ticketTitle}" принята в работу. Срок: ${ctx.dueDatetime}.`;
            return { subject, html, text };
        }
        case 'need_info': {
            const subject = buildThreadSubject(ctx.ticketId, `Нужны уточнения по заявке №${sid}`);
            const bodyHtml =
                emailGreeting(ctx.recipientName) +
                emailTicketHeader(sid, ctx.ticketTitle) +
                emailStatusBadge('Нужна информация', '#F59E0B', '#78350F') +
                emailHighlightCard(
                    `<strong>Вопросы:</strong><br/><div style="white-space:pre-wrap;margin-top:8px;">${escapeHtml(ctx.questionsList)}</div>`
                ) +
                `<p style="margin:8px 0 0;color:#64748B;font-size:13px;">Пока мы ждём ответ, срок выполнения может быть скорректирован.</p>` +
                emailButtonsRow([emailButton(TICKET_URL, 'Ответить', '#F59E0B')]) +
                signatureHtml;
            const html = wrapEmailHtml(bodyHtml);
            const text = `По заявке №${sid} нужны уточнения: ${ctx.questionsList}`;
            return { subject, html, text };
        }
        case 'info_received': {
            const subject = buildThreadSubject(ctx.ticketId, `Получили информацию по заявке №${sid}`);
            const bodyHtml =
                emailGreeting(ctx.recipientName) +
                emailTicketHeader(sid, ctx.ticketTitle) +
                emailStatusBadge('Информация получена', '#16A34A') +
                emailInfoCard(
                    `Спасибо! Продолжаем работу.<br/><strong>Плановый срок:</strong> ${escapeHtml(ctx.dueDatetime)}`
                ) +
                emailButtonsRow([openBtn]) +
                signatureHtml;
            const html = wrapEmailHtml(bodyHtml);
            const text = `Получили уточнения по заявке №${sid}. Продолжаем работу. Срок: ${ctx.dueDatetime}.`;
            return { subject, html, text };
        }
        case 'support_comment': {
            const subject = buildThreadSubject(ctx.ticketId, `Обновление по заявке №${sid}`);
            const aiBlock = await buildAiDescriptionBlock(ctx.commentText, 'Обновление:');
            const bodyHtml =
                emailGreeting(ctx.recipientName) +
                emailTicketHeader(sid, ctx.ticketTitle) +
                aiBlock +
                emailButtonsRow([openBtn]) +
                signatureHtml;
            const html = wrapEmailHtml(bodyHtml);
            const text = `Обновление по заявке №${sid}: ${ctx.commentText}`;
            return { subject, html, text };
        }
        case 'due_changed': {
            const subject = buildThreadSubject(ctx.ticketId, `Изменён срок по заявке №${sid}`);
            const bodyHtml =
                emailGreeting(ctx.recipientName) +
                emailTicketHeader(sid, ctx.ticketTitle) +
                emailStatusBadge('Срок изменён', '#F59E0B', '#78350F') +
                emailDueChange(ctx.oldDue, ctx.newDue) +
                (ctx.commentText && ctx.commentText !== 'Добавлено обновление по заявке.'
                    ? emailInfoCard(`<strong>Причина:</strong> ${escapeHtml(ctx.commentText)}`)
                    : '') +
                emailButtonsRow([openBtn]) +
                signatureHtml;
            const html = wrapEmailHtml(bodyHtml);
            const text = `По заявке №${sid} изменён срок. Было: ${ctx.oldDue}. Стало: ${ctx.newDue}.`;
            return { subject, html, text };
        }
        case 'done_review': {
            const subject = buildThreadSubject(ctx.ticketId, `Заявка №${sid} выполнена — просьба проверить`);
            const aiBlock = await buildAiDescriptionBlock(ctx.resolutionSummary, 'Результат работ:');
            const bodyHtml =
                emailGreeting(ctx.recipientName) +
                emailTicketHeader(sid, ctx.ticketTitle) +
                emailStatusBadge('Выполнена, на проверке', '#7C3AED') +
                aiBlock +
                `<p style="margin:8px 0 0;color:#64748B;font-size:13px;">Если в течение ${escapeHtml(ctx.autoCloseDays)} дней не будет комментариев, заявка будет закрыта автоматически.</p>` +
                emailButtonsRow([
                    emailButton(TICKET_URL, 'Подтвердить выполнение', '#16A34A'),
                    emailButtonOutline(TICKET_URL, 'Написать замечания', '#DC2626'),
                ]) +
                signatureHtml;
            const html = wrapEmailHtml(bodyHtml);
            const text = `Заявка №${sid} выполнена. Результат: ${ctx.resolutionSummary}. Проверьте и подтвердите.`;
            return { subject, html, text };
        }
        case 'closed': {
            const subject = buildThreadSubject(ctx.ticketId, `Заявка №${sid} закрыта`);
            const bodyHtml =
                emailGreeting(ctx.recipientName) +
                emailTicketHeader(sid, ctx.ticketTitle) +
                emailStatusBadge('Закрыта', '#64748B') +
                `<p style="margin:16px 0;color:#475569;font-size:14px;">Если потребуется, создайте новую заявку и укажите номер №${escapeHtml(sid)} для ссылки.</p>` +
                emailButtonsRow([openBtn]) +
                signatureHtml;
            const html = wrapEmailHtml(bodyHtml);
            const text = `Заявка №${sid} "${ctx.ticketTitle}" закрыта.`;
            return { subject, html, text };
        }
        case 'rejected': {
            const subject = buildThreadSubject(ctx.ticketId, `По заявке №${sid} нужен другой вариант`);
            const bodyHtml =
                emailGreeting(ctx.recipientName) +
                emailTicketHeader(sid, ctx.ticketTitle) +
                emailStatusBadge('Нужен другой вариант', '#DC2626') +
                emailHighlightCard(
                    `<strong>Причина:</strong> ${escapeHtml(ctx.commentText)}`
                ) +
                emailInfoCard(
                    `<strong>Возможные варианты:</strong><br/><div style="white-space:pre-wrap;margin-top:8px;">${escapeHtml(ctx.rejectionOptions)}</div>`
                ) +
                emailButtonsRow([emailButton(TICKET_URL, 'Ответить', '#DC2626')]) +
                signatureHtml;
            const html = wrapEmailHtml(bodyHtml);
            const text = `По заявке №${sid} нужен другой вариант. Причина: ${ctx.commentText}`;
            return { subject, html, text };
        }
        case 'waiting_reminder': {
            const subject = buildThreadSubject(ctx.ticketId, `Напоминание по заявке №${sid}`);
            const bodyHtml =
                emailGreeting(ctx.recipientName) +
                emailTicketHeader(sid, ctx.ticketTitle) +
                emailStatusBadge('Ждём информацию', '#F59E0B', '#78350F') +
                emailHighlightCard(
                    `<strong>Нужна информация:</strong><br/><div style="white-space:pre-wrap;margin-top:8px;">${escapeHtml(ctx.questionsList)}</div>`
                ) +
                `<p style="margin:8px 0 0;color:#64748B;font-size:13px;">Как только получим ответ — продолжим работу.</p>` +
                emailButtonsRow([emailButton(TICKET_URL, 'Ответить', '#F59E0B')]) +
                signatureHtml;
            const html = wrapEmailHtml(bodyHtml);
            const text = `Напоминание: ждём информацию по заявке №${sid}. ${ctx.questionsList}`;
            return { subject, html, text };
        }
        case 'digest': {
            const subject = `Ваши заявки: сводка на ${ctx.digestDate}`;
            const bodyHtml =
                emailGreeting(ctx.recipientName) +
                `<h2 style="margin:0 0 16px;color:#1E293B;font-size:20px;font-weight:700;">Сводка на ${escapeHtml(ctx.digestDate)}</h2>` +
                `<table style="width:100%;border-collapse:collapse;margin:16px 0;">
  <tr style="background:#F1F5F9;">
    <td style="padding:10px 16px;font-size:14px;color:#475569;">В работе</td>
    <td style="padding:10px 16px;font-weight:700;font-size:18px;color:#2563EB;text-align:right;">${escapeHtml(ctx.digestInProgressCount)}</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:14px;color:#475569;">Ждём информацию от вас</td>
    <td style="padding:10px 16px;font-weight:700;font-size:18px;color:#F59E0B;text-align:right;">${escapeHtml(ctx.digestWaitingCustomerCount)}</td>
  </tr>
  <tr style="background:#F1F5F9;">
    <td style="padding:10px 16px;font-size:14px;color:#475569;">На проверке</td>
    <td style="padding:10px 16px;font-weight:700;font-size:18px;color:#7C3AED;text-align:right;">${escapeHtml(ctx.digestReadyForReviewCount)}</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:14px;color:#475569;">Закрыто сегодня</td>
    <td style="padding:10px 16px;font-weight:700;font-size:18px;color:#64748B;text-align:right;">${escapeHtml(ctx.digestClosedTodayCount)}</td>
  </tr>
</table>` +
                emailInfoCard(`<div style="white-space:pre-wrap;">${escapeHtml(ctx.digestTicketList)}</div>`) +
                emailButtonsRow([emailButton(TICKET_URL, 'Открыть портал')]) +
                signatureHtml;
            const html = wrapEmailHtml(bodyHtml);
            const text = `Сводка на ${ctx.digestDate}: в работе ${ctx.digestInProgressCount}, ждём от вас ${ctx.digestWaitingCustomerCount}, на проверке ${ctx.digestReadyForReviewCount}, закрыто ${ctx.digestClosedTodayCount}.`;
            return { subject, html, text };
        }
        default: {
            const subject = buildThreadSubject(ctx.ticketId, `Обновление по заявке №${sid}`);
            const bodyHtml =
                emailGreeting(ctx.recipientName) +
                emailTicketHeader(sid, ctx.ticketTitle) +
                `<p style="margin:0 0 16px;color:#475569;font-size:14px;">По вашей заявке есть обновление.</p>` +
                emailButtonsRow([openBtn]) +
                signatureHtml;
            const html = wrapEmailHtml(bodyHtml);
            const text = `По заявке №${sid} "${ctx.ticketTitle}" есть обновление.`;
            return { subject, html, text };
        }
    }
};

const buildDedupeKey = (ctx) => {
    if (ctx.dedupeKey) {
        return ctx.dedupeKey;
    }
    return `ticket_client:${ctx.eventType}:${ctx.recipientEmail}:${ctx.ticketId}`;
};

const logNotificationResult = async ({ ctx, result, error = null }) => {
    const scope = ctx.scope === 'project' ? 'project' : 'ticket';
    const projectId = isUuidValue(ctx.projectId) ? ctx.projectId : null;
    const actorUserId = isUuidValue(ctx.actorUserId) ? ctx.actorUserId : null;
    const payloadJson = safeJsonString(ctx.payloadForLog ?? {}, { unserializable: true });
    const errorPayload = error ? serializeError(error) : null;
    const errorJson = errorPayload ? safeJsonString(errorPayload, { unserializable: true }) : null;
    try {
        await dbQuery(`insert into app_notification_event_log(
            scope,
            project_id,
            ticket_id,
            event_type,
            severity,
            recipient_email,
            recipient_name,
            actor_user_id,
            actor_role,
            request_id,
            ip,
            delivery,
            sent,
            reason,
            dedupe_key,
            payload,
            error
          )
          values(
            $1,
            $2::uuid,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8::uuid,
            $9,
            $10,
            $11,
            $12,
            $13,
            $14,
            $15,
            $16::jsonb,
            $17::jsonb
          )`, [
            scope,
            projectId,
            ctx.ticketId,
            ctx.eventType,
            ctx.severity,
            ctx.recipientEmail || null,
            ctx.recipientName || null,
            actorUserId,
            ctx.actorRole || null,
            ctx.requestId || null,
            ctx.ip || null,
            result.delivery || 'unknown',
            !!result.sent,
            result.reason || null,
            result.dedupeKey || null,
            payloadJson,
            errorJson,
        ]);
    }
    catch (logError) {
        logger.error('Failed to write notification event log', {
            scope,
            eventType: ctx.eventType,
            recipientEmail: ctx.recipientEmail,
            error: serializeError(logError),
        });
    }
};

const runStorageHousekeepingMaybe = async () => {
    const nowMs = Date.now();
    if (nowMs - lastHousekeepingAtMs < HOUSEKEEPING_INTERVAL_MS) {
        return;
    }
    lastHousekeepingAtMs = nowMs;
    await dbQuery(`delete from app_notification_dedupe
        where last_seen_at < now() - make_interval(days => $1::int)`, [DEDUPE_RETENTION_DAYS]);
    await dbQuery(`delete from app_notification_digest_queue
        where sent_at is not null
          and sent_at < now() - make_interval(days => $1::int)`, [DIGEST_RETENTION_DAYS]);
    await dbQuery(`delete from app_notification_event_log
        where created_at < now() - make_interval(days => $1::int)`, [EVENT_LOG_RETENTION_DAYS]);
};

const isDuplicateByDedupeKey = async (dedupeKey) => {
    const result = await dbQuery(`insert into app_notification_dedupe(dedupe_key, last_seen_at)
        values($1, now())
        on conflict (dedupe_key) do update
          set last_seen_at = excluded.last_seen_at
        where app_notification_dedupe.last_seen_at < now() - make_interval(secs => $2::int)
        returning dedupe_key`, [dedupeKey, DEDUPE_WINDOW_SECONDS]);
    return result.rowCount === 0;
};

const queueDigestSnapshot = async (ctx) => {
    await dbQuery(`insert into app_notification_digest_queue(
        recipient_email,
        recipient_name,
        recipient_client_id,
        recipient_user_id,
        scope,
        ticket_id,
        ticket_title,
        event_type,
        ticket_url,
        support_signature,
        company,
        support_name
      )
      values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [
        ctx.recipientEmail,
        ctx.recipientName,
        ctx.recipientClientId || null,
        ctx.recipientUserId || null,
        ctx.scope,
        ctx.ticketId,
        ctx.ticketTitle,
        ctx.eventType,
        ctx.ticketUrl,
        ctx.supportSignature || null,
        ctx.company,
        ctx.supportName,
    ]);
};

const buildDigestSlotKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    return `${year}-${month}-${day}#${hour}`;
};

const readDigestSlotKeyFromStateValue = (value) => {
    if (!value) {
        return '';
    }
    if (typeof value === 'string') {
        return asText(value);
    }
    if (typeof value === 'object') {
        return asText(value.slotKey ?? value.slot_key);
    }
    return '';
};

const getLatestDigestSlotAtOrBefore = (now) => {
    let latest = null;
    for (const hour of DIGEST_HOUR_LIST) {
        const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
        if (slot.getTime() <= now.getTime()) {
            latest = slot;
        }
    }
    if (latest) {
        return latest;
    }
    const previousDay = new Date(now);
    previousDay.setDate(previousDay.getDate() - 1);
    const maxHour = DIGEST_HOUR_LIST[DIGEST_HOUR_LIST.length - 1];
    return new Date(previousDay.getFullYear(), previousDay.getMonth(), previousDay.getDate(), maxHour, 0, 0, 0);
};

const aggregateDigestRows = (rows) => {
    const uniqueInProgress = new Set();
    const uniqueWaitingCustomer = new Set();
    const uniqueReadyForReview = new Set();
    const uniqueClosedToday = new Set();
    const lineKeys = new Set();
    const lines = [];

    for (const row of rows) {
        const eventType = asText(row.eventType);
        const ticketId = asText(row.ticketId, '-');
        const category = DIGEST_CATEGORY_BY_EVENT[eventType];
        if (category === 'inProgress') {
            uniqueInProgress.add(ticketId);
        }
        if (category === 'waitingCustomer') {
            uniqueWaitingCustomer.add(ticketId);
        }
        if (category === 'readyForReview') {
            uniqueReadyForReview.add(ticketId);
        }
        if (category === 'closedToday') {
            uniqueClosedToday.add(ticketId);
        }

        const lineKey = `${ticketId}:${eventType}`;
        if (lineKeys.has(lineKey)) {
            continue;
        }
        lineKeys.add(lineKey);
        const eventLabel = EVENT_LABEL[eventType] ?? 'Обновление';
        const ticketTitle = asText(row.ticketTitle, 'Без названия');
        lines.unshift(`#${ticketId} ${ticketTitle} (${eventLabel})`);
        if (lines.length > 20) {
            lines.length = 20;
        }
    }

    return {
        inProgressCount: uniqueInProgress.size,
        waitingCustomerCount: uniqueWaitingCustomer.size,
        readyForReviewCount: uniqueReadyForReview.size,
        closedTodayCount: uniqueClosedToday.size,
        ticketList: lines.length > 0 ? lines.map((line) => `- ${line}`).join('\n') : 'Изменений за период нет.',
    };
};

const flushDigestState = async (slotKey, nowDate) => {
    const pending = await dbQuery(`select
        id,
        recipient_email as "recipientEmail",
        recipient_name as "recipientName",
        recipient_client_id as "recipientClientId",
        recipient_user_id as "recipientUserId",
        scope,
        ticket_id as "ticketId",
        ticket_title as "ticketTitle",
        event_type as "eventType",
        ticket_url as "ticketUrl",
        support_signature as "supportSignature",
        company,
        support_name as "supportName"
      from app_notification_digest_queue
      where sent_at is null
      order by id asc`);

    if (pending.rows.length === 0) {
        logger.info('Ticket digest flush skipped: no pending events', { slotKey });
        return;
    }

    const grouped = new Map();
    for (const row of pending.rows) {
        const email = asText(row.recipientEmail).toLowerCase();
        const recipientClientId = asText(row.recipientClientId);
        const recipientUserId = asText(row.recipientUserId);
        const groupingKey = recipientUserId || recipientClientId || email;
        if (!groupingKey) {
            continue;
        }
        const existing = grouped.get(groupingKey);
        if (existing) {
            existing.rows.push(row);
            continue;
        }
        grouped.set(groupingKey, {
            recipientEmail: email,
            recipientName: asText(row.recipientName, 'клиент'),
            recipientClientId,
            recipientUserId,
            scope: asText(row.scope, 'ticket'),
            portalUrl: asText(row.ticketUrl, '-'),
            supportSignature: asText(row.supportSignature),
            company: asText(row.company, 'ЮЭТКА'),
            supportName: asText(row.supportName, 'Служба поддержки'),
            rows: [row],
        });
    }

    let sentRecipients = 0;
    for (const recipient of grouped.values()) {
        const ids = recipient.rows.map((item) => Number(item.id)).filter(Number.isFinite);
        if (ids.length === 0) {
            continue;
        }
        const resolvedRecipient = await resolveRecipientForNotification({
            recipient: {
                email: recipient.recipientEmail,
                name: recipient.recipientName,
                ...(recipient.recipientClientId ? { clientId: recipient.recipientClientId } : {}),
                ...(recipient.recipientUserId ? { userId: recipient.recipientUserId } : {}),
            },
            meta: {
                ...(recipient.recipientClientId ? {
                    clientId: recipient.recipientClientId,
                    client_id: recipient.recipientClientId,
                    counterpartyId: recipient.recipientClientId,
                    counterparty_id: recipient.recipientClientId,
                } : {}),
                ...(recipient.recipientUserId ? {
                    userId: recipient.recipientUserId,
                    user_id: recipient.recipientUserId,
                } : {}),
            },
        });
        if (!resolvedRecipient.email) {
            await dbQuery(`update app_notification_digest_queue
                set sent_at = now()
                where id = any($1::bigint[])`, [ids]);
            logger.warn('Scheduled digest skipped: recipient is outside current scoped bindings', {
                slotKey,
                recipientEmail: recipient.recipientEmail || null,
                recipientClientId: recipient.recipientClientId || null,
                recipientUserId: recipient.recipientUserId || null,
            });
            continue;
        }

        const aggregate = aggregateDigestRows(recipient.rows);
        const payload = {
            eventType: 'digest',
            recipient: {
                email: resolvedRecipient.email,
                name: resolvedRecipient.name || recipient.recipientName,
                ...(recipient.recipientClientId ? { clientId: recipient.recipientClientId } : {}),
                ...(recipient.recipientUserId ? { userId: recipient.recipientUserId } : {}),
            },
            ticket: {
                url: recipient.portalUrl,
            },
            meta: {
                date: nowDate.toLocaleDateString('ru-RU'),
                inProgressCount: aggregate.inProgressCount,
                waitingCustomerCount: aggregate.waitingCustomerCount,
                readyForReviewCount: aggregate.readyForReviewCount,
                closedTodayCount: aggregate.closedTodayCount,
                ticketList: aggregate.ticketList,
                portalUrl: recipient.portalUrl,
                company: recipient.company,
                supportName: recipient.supportName,
                supportSignature: recipient.supportSignature,
                ...(recipient.recipientClientId ? {
                    clientId: recipient.recipientClientId,
                    client_id: recipient.recipientClientId,
                    counterpartyId: recipient.recipientClientId,
                    counterparty_id: recipient.recipientClientId,
                } : {}),
                ...(recipient.recipientUserId ? {
                    userId: recipient.recipientUserId,
                    user_id: recipient.recipientUserId,
                } : {}),
            },
            dedupeKey: `ticket_client:digest:${slotKey}:${resolvedRecipient.email}`,
            suppressOutsideWorkHours: false,
        };

        try {
            const result = await sendTicketClientNotification(payload);
            const delivered = !!result.sent || result.delivery === 'deduped';
            if (!delivered) {
                continue;
            }
            await dbQuery(`update app_notification_digest_queue
                set sent_at = now()
                where id = any($1::bigint[])`, [ids]);
            sentRecipients += 1;
        }
        catch (error) {
            logger.error('Failed to send scheduled digest for recipient', {
                slotKey,
                recipientEmail: recipient.recipientEmail,
                error: serializeError(error),
            });
        }
    }

    logger.info('Ticket digest flush completed', {
        slotKey,
        recipientsTotal: grouped.size,
        recipientsSent: sentRecipients,
    });
};

const maybeRunDigestScheduler = async () => {
    if (digestFlushInProgress) {
        return;
    }

    digestFlushInProgress = true;
    try {
        await runStorageHousekeepingMaybe();
        const now = new Date();
        const dueSlotDate = getLatestDigestSlotAtOrBefore(now);
        const dueSlotKey = buildDigestSlotKey(dueSlotDate);
        await withTx(async (tx) => {
            const lockResult = await tx.query(`select pg_try_advisory_xact_lock($1::bigint) as locked`, [DIGEST_SCHEDULER_LOCK_KEY]);
            const locked = !!lockResult.rows[0]?.locked;
            if (!locked) {
                return;
            }
            const runtimeResult = await tx.query(`select value
                 from app_notification_runtime_state
                 where key = $1
                 for update`, [DIGEST_RUNTIME_KEY_LAST_SLOT]);
            const lastProcessedSlotKey = readDigestSlotKeyFromStateValue(runtimeResult.rows[0]?.value);
            if (lastProcessedSlotKey && lastProcessedSlotKey >= dueSlotKey) {
                return;
            }
            await flushDigestState(dueSlotKey, dueSlotDate);
            await tx.query(`insert into app_notification_runtime_state(key, value, updated_at)
                 values($1, $2::jsonb, now())
                 on conflict(key) do update
                   set value = excluded.value,
                       updated_at = excluded.updated_at`, [
                DIGEST_RUNTIME_KEY_LAST_SLOT,
                JSON.stringify({
                    slotKey: dueSlotKey,
                    processedAt: new Date().toISOString(),
                }),
            ]);
        });
    }
    finally {
        digestFlushInProgress = false;
    }
};

export const startTicketClientDigestScheduler = () => {
    if (digestSchedulerStarted) {
        return;
    }
    digestSchedulerStarted = true;

    const timer = setInterval(() => {
        void maybeRunDigestScheduler();
    }, DIGEST_CHECK_INTERVAL_MS);
    if (typeof timer.unref === 'function') {
        timer.unref();
    }

    logger.info('Ticket client digest scheduler started', {
        slots: ['10:00', '18:00'],
    });

    void maybeRunDigestScheduler();
};

export const sendTicketClientNotification = async (payload) => {
    await runStorageHousekeepingMaybe();

    const ctx = normalizeContext(payload);

    if (!canSendEmails()) {
        const result = {
            sent: false,
            delivery: 'disabled',
            reason: 'EMAIL_NOT_CONFIGURED',
        };
        await logNotificationResult({ ctx, result });
        return result;
    }

    if (!ctx.eventType) {
        const result = {
            sent: false,
            delivery: 'skipped',
            reason: 'EVENT_TYPE_UNKNOWN',
        };
        await logNotificationResult({ ctx, result });
        return result;
    }
    if (!ctx.recipientEmail) {
        const result = {
            sent: false,
            delivery: 'skipped',
            reason: 'RECIPIENT_EMAIL_EMPTY',
        };
        await logNotificationResult({ ctx, result });
        return result;
    }

    if (ctx.suppressOutsideWorkHours && ctx.severity === 'normal' && isOutsideWorkHours(new Date())) {
        const result = {
            sent: false,
            delivery: 'suppressed_quiet_hours',
            eventType: ctx.eventType,
            severity: ctx.severity,
        };
        await logNotificationResult({ ctx, result });
        return result;
    }

    const dedupeKey = buildDedupeKey(ctx);
    if (await isDuplicateByDedupeKey(dedupeKey)) {
        const result = {
            sent: false,
            delivery: 'deduped',
            dedupeKey,
            eventType: ctx.eventType,
            severity: ctx.severity,
        };
        await logNotificationResult({ ctx, result });
        return result;
    }

    if (ctx.eventType !== 'digest') {
        await queueDigestSnapshot(ctx);
    }

    const message = await buildEmailFromTemplate(ctx);
    try {
        await smtpSendMail({
            to: ctx.recipientEmail,
            from: sender,
            subject: message.subject,
            text: message.text,
            html: message.html,
        });
    }
    catch (error) {
        const result = {
            sent: false,
            delivery: 'error',
            reason: 'SEND_FAILED',
            dedupeKey,
            eventType: ctx.eventType,
            severity: ctx.severity,
        };
        await logNotificationResult({ ctx, result, error });
        logger.error('Failed to send ticket client notification', {
            eventType: ctx.eventType,
            severity: ctx.severity,
            recipientEmail: ctx.recipientEmail,
            dedupeKey,
            error: serializeError(error),
        });
        throw error;
    }

    const result = {
        sent: true,
        delivery: 'email',
        dedupeKey,
        eventType: ctx.eventType,
        severity: ctx.severity,
    };
    await logNotificationResult({ ctx, result });
    return result;
};
