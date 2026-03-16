import { randomUUID } from 'node:crypto';
import { appConfig } from '../config.js';
import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';
import { canSendEmails, sendSystemEventNotice } from './mailService.js';
import { callLLM } from './aiService.js';
import { pushTelegramNotification } from './telegramNotifier.js';
import { ensureMaintenanceSchema } from '../schemas/maintenanceSchema.js';
import { ensureMaintenanceItemSchema } from '../schemas/maintenanceItemSchema.js';
import { ensureProjectSchema } from '../schemas/projectSchema.js';
import { ensureNotificationSchema } from '../schemas/notificationSchema.js';
import { ensureDirectionSchema } from '../schemas/directionSchema.js';
import { ensureServiceRequestSchema } from '../schemas/serviceRequestSchema.js';
import { ensureInstallationExtendedSchema } from '../schemas/installationSchema.js';
import { buildWeeklyDigestSystemPrompt } from '../helpers/aiConstants.js';
import { sendMaintenancePlanEmail, wrapEmailHtml } from '../helpers/emailTemplates.js';
import { escapeHtml, isEmailValue, isUuidValue, normalizeText } from '../helpers/normalize.js';
import { clientRecipientRoles } from '../helpers/roles.js';
import { filterNotificationRecipientIdsByEntityScope } from '../helpers/notificationRecipientScope.js';
import { getAdminManagerIds, pushInAppNotification } from './notificationService.js';
import { createOpaqueToken } from '../security.js';

// Interval storage for cleanup
let escalationInterval: NodeJS.Timeout | null = null;
let ticketClientDigestInterval: NodeJS.Timeout | null = null;
let deadlineInterval: NodeJS.Timeout | null = null;
let pprAutoGenerationInterval: NodeJS.Timeout | null = null;
let tokenCleanupInterval: NodeJS.Timeout | null = null;
let anomalyDetectionInterval: NodeJS.Timeout | null = null;
let scheduledReportsInterval: NodeJS.Timeout | null = null;
let weeklyDigestInterval: NodeJS.Timeout | null = null;
let sppzFireCheckInterval: NodeJS.Timeout | null = null;
let sppzLicenseExpirationInterval: NodeJS.Timeout | null = null;
let shutdownRequested = false;

const loadScopedActiveEmailRecipients = async ({ recipientIds, entityType, entityId }) => {
    const normalizedIds = Array.isArray(recipientIds)
        ? Array.from(new Set(recipientIds.map((value) => normalizeText(value)).filter((value) => isUuidValue(value))))
        : [];
    if (normalizedIds.length === 0) {
        return [];
    }
    const allowedIds = await filterNotificationRecipientIdsByEntityScope({
        recipientIds: normalizedIds,
        entityType,
        entityId,
        queryFn: dbQuery,
    });
    if (allowedIds.length === 0) {
        return [];
    }
    const result = await dbQuery(`select
         id::text as id,
         lower(trim(email)) as email,
         coalesce(nullif(trim(full_name), ''), split_part(lower(trim(email)), '@', 1)) as full_name
       from app_users
       where id = any($1::uuid[])
         and status::text = 'active'
         and coalesce(trim(email), '') <> ''`, [allowedIds]);
    return result.rows;
};

export const startEscalationScheduler = () => {
    const INTERVAL_MS = 15 * 60 * 1000;
    let running = false;
    const runEscalation = async () => {
        if (running || shutdownRequested) {
            return;
        }
        running = true;
        try {
            await ensureMaintenanceSchema();
            await ensureMaintenanceItemSchema();
            await ensureDirectionSchema();
            await ensureNotificationSchema();
            const now = new Date();
            const adminIds = await getAdminManagerIds();
            const dispatchersResult = await dbQuery(`select id::text as id
         from app_users
         where role::text = 'dispatcher'
           and status::text = 'active'`);
            const dispatcherIds = dispatchersResult.rows
                .map((row) => normalizeText(row.id))
                .filter((value) => isUuidValue(value));
            const escalationRecipients = Array.from(new Set([...adminIds, ...dispatcherIds]));
            const noResponse48h = await dbQuery(`select
         mp.id::text as id,
         mp.contact_person,
         mp.contact_phone,
         mp.tenant_id,
         d.name as dir_name
       from maintenance_plans mp
       left join directions d on d.id::text = mp.direction_id
       where mp.is_active = true
         and mp.confirmation_sent_at is not null
         and mp.escalation_48h_sent = false
         and mp.confirmation_sent_at + interval '48 hours' <= now()
         and not exists (
           select 1
           from maintenance_plan_confirmations c
           where c.plan_id = mp.id
         )
       limit 20`);
            for (const plan of noResponse48h.rows) {
                await pushInAppNotification({
                    recipientIds: escalationRecipients,
                    eventType: 'escalation_no_response',
                    title: `Нет ответа по ТО: ${normalizeText(plan.dir_name) || 'Направление'}`,
                    body: `Прошло 48ч, подтверждение не получено. План: ${normalizeText(plan.id)}`,
                    entityType: 'maintenance_plan',
                    entityId: normalizeText(plan.id),
                });
                await dbQuery(`update maintenance_plans
           set escalation_48h_sent = true
           where id = $1::uuid`, [normalizeText(plan.id)]);
                logger.info('Escalation 48h sent', {
                    planId: normalizeText(plan.id),
                });
            }
            const noResponse72h = await dbQuery(`select
         mp.id::text as id,
         mp.tenant_id,
         mp.contact_person,
         mp.contact_phone,
         mp.valid_from,
         d.name as dir_name,
         d.address as dir_address
       from maintenance_plans mp
       left join directions d on d.id::text = mp.direction_id
       where mp.is_active = true
         and mp.confirmation_sent_at is not null
         and mp.escalation_48h_sent = true
         and mp.escalation_72h_sent = false
         and mp.confirmation_sent_at + interval '72 hours' <= now()
         and not exists (
           select 1
           from maintenance_plan_confirmations c
           where c.plan_id = mp.id
         )
       limit 20`);
            for (const plan of noResponse72h.rows) {
                const tenantId = normalizeText(plan.tenant_id);
                if (isUuidValue(tenantId) && canSendEmails()) {
                    const clients = await dbQuery(`select
               u.id::text as user_id,
               lower(trim(u.email)) as email,
               coalesce(nullif(trim(u.full_name), ''), split_part(u.email, '@', 1)) as full_name
             from app_users u
             join app_user_bindings ub on ub.user_id = u.id
             where ub.counterparty_id = $1::uuid
               and u.role::text = any($2::text[])
               and u.status::text = 'active'
               and coalesce(trim(u.email), '') <> ''`, [tenantId, clientRecipientRoles]);
                    for (const client of clients.rows) {
                        const token = createOpaqueToken();
                        await dbQuery(`INSERT INTO maintenance_plan_confirmations (plan_id, token) VALUES ($1::uuid, $2) ON CONFLICT (plan_id, token) DO NOTHING`, [plan.id, token]);
                        const baseUrl = appConfig.appUrl || 'http://147.45.237.188';
                        const confirmUrl = `${baseUrl}/api/maintenance-plans/${encodeURIComponent(normalizeText(plan.id))}/confirm?token=${encodeURIComponent(token)}&action=confirm`;
                        const rescheduleUrl = `${baseUrl}/api/maintenance-plans/${encodeURIComponent(normalizeText(plan.id))}/confirm?token=${encodeURIComponent(token)}&action=reschedule`;
                        try {
                            await sendMaintenancePlanEmail({
                                to: normalizeText(client.email),
                                toName: normalizeText(client.full_name),
                                planDate: plan.valid_from ? String(plan.valid_from) : '',
                                directionName: normalizeText(plan.dir_name),
                                directionAddress: normalizeText(plan.dir_address),
                                contactPerson: normalizeText(plan.contact_person),
                                contactPhone: normalizeText(plan.contact_phone),
                                items: [],
                                description: 'Мы не получили подтверждение. Пожалуйста, подтвердите ТО или запросите перенос.',
                                confirmUrl,
                                rescheduleUrl,
                            });
                        }
                        catch (error) {
                            logger.error('Escalation 72h email failed', {
                                planId: normalizeText(plan.id),
                                recipientEmail: normalizeText(client.email),
                                error: serializeError(error),
                            });
                        }
                    }
                }
                await dbQuery(`update maintenance_plans
           set escalation_72h_sent = true
           where id = $1::uuid`, [normalizeText(plan.id)]);
                logger.info('Escalation 72h sent', {
                    planId: normalizeText(plan.id),
                });
            }
            const nowMsk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
            const todayMsk = nowMsk.toISOString().split('T')[0];
            const mskHour = nowMsk.getUTCHours();
            if (mskHour >= 12) {
                const noCheckin = await dbQuery(`select
           mp.id::text as id,
           mp.default_executor_ids,
           d.name as dir_name
         from maintenance_plans mp
         left join directions d on d.id::text = mp.direction_id
         where mp.is_active = true
           and mp.valid_from = $1::date
           and mp.visit_reminder_sent = false
           and exists (
             select 1
             from maintenance_plan_confirmations c
             where c.plan_id = mp.id
               and c.action = 'confirm'
           )
         limit 20`, [todayMsk]);
                for (const plan of noCheckin.rows) {
                    const executorIds = Array.isArray(plan.default_executor_ids)
                        ? plan.default_executor_ids.map((value) => normalizeText(value)).filter(Boolean)
                        : [];
                    if (executorIds.length === 0) {
                        continue;
                    }
                    const checkinResult = await dbQuery(`select 1
             from checkins
             where user_id = any($1::text[])
               and checked_in_at::date = $2::date
             limit 1`, [executorIds, todayMsk]);
                    if (checkinResult.rows.length === 0) {
                        await pushInAppNotification({
                            recipientIds: executorIds,
                            eventType: 'visit_reminder',
                            title: `Напоминание: ТО сегодня - ${normalizeText(plan.dir_name)}`,
                            body: 'Вы ещё не отметились на объекте. Не забудьте сканировать QR.',
                            entityType: 'maintenance_plan',
                            entityId: normalizeText(plan.id),
                        });
                        await dbQuery(`update maintenance_plans
               set visit_reminder_sent = true
               where id = $1::uuid`, [normalizeText(plan.id)]);
                        logger.info('Visit reminder sent', {
                            planId: normalizeText(plan.id),
                        });
                    }
                }
            }
            const noReport = await dbQuery(`select
         mp.id::text as id,
         d.name as dir_name
       from maintenance_plans mp
       left join directions d on d.id::text = mp.direction_id
       where mp.is_active = true
         and mp.valid_from + interval '1 day' <= now()
         and mp.report_reminder_sent = false
         and exists (
           select 1
           from maintenance_plan_confirmations c
           where c.plan_id = mp.id
             and c.action = 'confirm'
         )
       limit 20`);
            for (const plan of noReport.rows) {
                await pushInAppNotification({
                    recipientIds: adminIds,
                    eventType: 'report_overdue',
                    title: `Нет отчёта по ТО: ${normalizeText(plan.dir_name)}`,
                    body: `Прошло 24ч после визита, отчёт не загружен. План: ${normalizeText(plan.id)}`,
                    entityType: 'maintenance_plan',
                    entityId: normalizeText(plan.id),
                });
                await dbQuery(`update maintenance_plans
           set report_reminder_sent = true
           where id = $1::uuid`, [normalizeText(plan.id)]);
                logger.info('Report reminder sent', {
                    planId: normalizeText(plan.id),
                });
            }
        }
        catch (error) {
            logger.error('Escalation scheduler error', {
                error: serializeError(error),
            });
        }
        finally {
            running = false;
        }
    };
    escalationInterval = setInterval(() => {
        void runEscalation();
    }, INTERVAL_MS);
    setTimeout(() => {
        void runEscalation();
    }, 60000);
    logger.info('Escalation scheduler started', { intervalMs: INTERVAL_MS });
};
export const startWeeklyDigestScheduler = () => {
    const INTERVAL_MS = 60 * 60 * 1000;
    let running = false;
    let lastDigestKey = '';
    const getMoscowDateParts = (date = new Date()) => {
        const formatter = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/Moscow',
            weekday: 'short',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        });
        const parts = formatter.formatToParts(date);
        const get = (type) => normalizeText(parts.find((item) => item.type === type)?.value);
        return {
            weekday: get('weekday').toLowerCase(),
            year: get('year'),
            month: get('month'),
            day: get('day'),
            hour: Number.parseInt(get('hour'), 10),
            minute: Number.parseInt(get('minute'), 10),
        };
    };
    const runDigest = async () => {
        if (running || !appConfig.aiEnabled) {
            return;
        }
        running = true;
        try {
            await ensureServiceRequestSchema();
            await ensureNotificationSchema();
            const nowParts = getMoscowDateParts();
            const digestKey = `${nowParts.year}-${nowParts.month}-${nowParts.day}`;
            if (nowParts.weekday !== 'mon' || !Number.isFinite(nowParts.hour) || nowParts.hour !== 10) {
                return;
            }
            if (lastDigestKey === digestKey) {
                return;
            }
            const [statusBreakdownResult, overdueCountResult, topExecutorsResult] = await Promise.all([
                dbQuery(`select
           coalesce(status, '') as status,
           coalesce(type, '') as type,
           coalesce(system_type, '') as system_type,
           coalesce(priority, '') as priority,
           count(*)::int as count
         from requests
         where created_at > now() - interval '7 days'
           and coalesce(is_project, false) = false
           and type <> 'installation'
           and deleted_at is null
         group by coalesce(status, ''), coalesce(type, ''), coalesce(system_type, ''), coalesce(priority, '')`),
                dbQuery(`select count(*)::int as count
         from requests
         where coalesce(status, '') not in ('done', 'closed', 'cancelled')
           and due_date_preliminary is not null
           and due_date_preliminary < current_date
           and coalesce(is_project, false) = false
           and type <> 'installation'
           and deleted_at is null`),
                dbQuery(`select executor_id, count(*)::int as count
         from (
           select unnest(coalesce(executor_ids, '{}'::text[])) as executor_id
           from requests
           where created_at > now() - interval '7 days'
             and coalesce(is_project, false) = false
             and type <> 'installation'
             and deleted_at is null
         ) source
         where coalesce(executor_id, '') <> ''
         group by executor_id
         order by count(*) desc
         limit 5`),
            ]);
            const topExecutorIds = topExecutorsResult.rows
                .map((row) => normalizeText(row.executor_id))
                .filter(Boolean);
            let executorNamesById = {};
            if (topExecutorIds.length > 0) {
                const executorRows = await dbQuery(`select id::text as id, coalesce(nullif(trim(full_name), ''), email) as full_name
           from app_users
           where id::text = any($1::text[])`, [topExecutorIds]);
                executorNamesById = executorRows.rows.reduce((accumulator, row) => {
                    const id = normalizeText(row.id);
                    if (id) {
                        accumulator[id] = normalizeText(row.full_name) || id;
                    }
                    return accumulator;
                }, {});
            }
            const statusBreakdown = statusBreakdownResult.rows.map((row) => ({
                status: normalizeText(row.status),
                type: normalizeText(row.type),
                systemType: normalizeText(row.system_type),
                priority: normalizeText(row.priority),
                count: Number(row.count ?? 0),
            }));
            const overdueCount = Number(overdueCountResult.rows[0]?.count ?? 0);
            const topExecutors = topExecutorsResult.rows.map((row) => {
                const id = normalizeText(row.executor_id);
                return {
                    id,
                    name: executorNamesById[id] ?? id,
                    count: Number(row.count ?? 0),
                };
            });
            const totalRequests = statusBreakdown.reduce((sum, item) => sum + item.count, 0);
            const digestSource = {
                period: '7_days',
                totalRequests,
                overdueCount,
                statusBreakdown,
                topExecutors,
            };
            const aiText = await callLLM(buildWeeklyDigestSystemPrompt, `Сырые данные:\n${JSON.stringify(digestSource, null, 2)}`);
            const fallbackText = [
                `Итоги за 7 дней: ${totalRequests} заявок.`,
                `Просроченные заявки: ${overdueCount}.`,
                topExecutors.length > 0
                    ? `Топ исполнители: ${topExecutors.map((item) => `${item.name} (${item.count})`).join(', ')}.`
                    : 'Топ исполнители: данных нет.',
            ].join('\n');
            const digestText = normalizeText(aiText) || fallbackText;
            const adminManagerResult = await dbQuery(`select
         id::text as id,
         lower(trim(email)) as email,
         coalesce(nullif(trim(full_name), ''), split_part(lower(trim(email)), '@', 1)) as full_name
       from app_users
       where role in ('admin', 'manager')
         and status = 'active'
         and coalesce(trim(email), '') <> ''`);
            if (canSendEmails() && adminManagerResult.rows.length > 0) {
                await Promise.all(adminManagerResult.rows.map(async (recipient) => {
                    const email = normalizeText(recipient.email).toLowerCase();
                    if (!email || !isEmailValue(email)) {
                        return;
                    }
                    try {
                        await sendSystemEventNotice({
                            to: email,
                            subject: 'Новинжстрой: еженедельный AI-дайджест',
                            body: digestText,
                        });
                    }
                    catch (error) {
                        logger.error('Failed to send weekly digest email', {
                            recipientEmail: email,
                            error: serializeError(error),
                        });
                    }
                }));
            }
            const recipientIds = adminManagerResult.rows
                .map((row) => normalizeText(row.id))
                .filter((value) => isUuidValue(value));
            if (recipientIds.length > 0) {
                await pushInAppNotification({
                    recipientIds,
                    eventType: 'weekly_digest',
                    title: 'Еженедельный AI-дайджест готов',
                    body: 'Сводка за 7 дней сформирована и отправлена руководству.',
                    entityType: 'dashboard',
                    entityId: digestKey,
                });
            }
            lastDigestKey = digestKey;
            logger.info('Weekly digest sent', {
                digestKey,
                totalRequests,
                overdueCount,
                recipientCount: adminManagerResult.rows.length,
            });
        }
        catch (error) {
            logger.error('Weekly digest scheduler error', {
                error: serializeError(error),
            });
        }
        finally {
            running = false;
        }
    };
    ticketClientDigestInterval = setInterval(() => {
        void runDigest();
    }, INTERVAL_MS);
    setTimeout(() => {
        void runDigest();
    }, 90_000);
    logger.info('Weekly digest scheduler started', {
        intervalMs: INTERVAL_MS,
    });
};

export const startDeadlineScheduler = () => {
    const INTERVAL_MS = 30 * 60 * 1000; // every 30 min
    let running = false;

    const run = async () => {
        if (running || shutdownRequested) return;
        running = true;
        try {
            await ensureServiceRequestSchema();
            await ensureNotificationSchema();
            const adminIds = await getAdminManagerIds();
            const today = new Date().toISOString().slice(0, 10);

            // 1. Mark overdue: deadline passed and not closed
            await dbQuery(`UPDATE requests SET is_overdue = true, updated_at = now()
                WHERE deleted_at IS NULL
                  AND is_overdue = false
                  AND coalesce(status, '') NOT IN ('done', 'closed', 'cancelled')
                  AND (
                    (due_date_preliminary IS NOT NULL AND due_date_preliminary < $1::date)
                    OR (visit_date IS NOT NULL AND visit_date < $1::date)
                  )`, [today]);

            // 2. Clear overdue if closed
            await dbQuery(`UPDATE requests SET is_overdue = false, updated_at = now()
                WHERE deleted_at IS NULL
                  AND is_overdue = true
                  AND coalesce(status, '') IN ('done', 'closed', 'cancelled')`, []);

            // 3. Deadline reminders: 3 days before
            const deadline3d = await dbQuery(`SELECT id::text, title, due_date_preliminary, executor_ids
                FROM requests
                WHERE deleted_at IS NULL
                  AND coalesce(status, '') NOT IN ('done', 'closed', 'cancelled')
                  AND due_date_preliminary = ($1::date + interval '3 days')::date
                  AND NOT EXISTS (
                    SELECT 1 FROM app_notifications n
                    WHERE n.entity_id = requests.id::text
                      AND n.event_type = 'deadline_3d'
                      AND n.created_at > now() - interval '1 day'
                  )
                LIMIT 50`, [today]);

            for (const row of deadline3d.rows) {
                const recipients = new Set<string>([...adminIds]);
                if (Array.isArray(row.executor_ids)) {
                    for (const eid of row.executor_ids) { const n = normalizeText(eid); if (n) recipients.add(n); }
                }
                const title = normalizeText(row.title) || row.id;
                const dueDate = row.due_date_preliminary ? String(row.due_date_preliminary).slice(0, 10) : '';
                await pushInAppNotification({
                    recipientIds: Array.from(recipients),
                    eventType: 'deadline_3d',
                    title: `Дедлайн через 3 дня: ${title}`,
                    body: `Срок выполнения заявки "${title}" — ${dueDate}`,
                    entityType: 'service_request',
                    entityId: row.id,
                });
                if (canSendEmails() && Array.isArray(row.executor_ids) && row.executor_ids.length > 0) {
                    const execEmails = await loadScopedActiveEmailRecipients({
                        recipientIds: row.executor_ids,
                        entityType: 'service_request',
                        entityId: row.id,
                    });
                    for (const rec of execEmails) {
                        void sendSystemEventNotice({
                            to: normalizeText(rec.email),
                            subject: `Дедлайн через 3 дня: ${title}`,
                            body: `Заявка "${title}" — срок выполнения ${dueDate}. Пожалуйста, завершите работы вовремя.`,
                        }).catch(() => {});
                    }
                }
            }

            // 4. Deadline reminders: 1 day before
            const deadline1d = await dbQuery(`SELECT id::text, title, due_date_preliminary, executor_ids
                FROM requests
                WHERE deleted_at IS NULL
                  AND coalesce(status, '') NOT IN ('done', 'closed', 'cancelled')
                  AND due_date_preliminary = ($1::date + interval '1 day')::date
                  AND NOT EXISTS (
                    SELECT 1 FROM app_notifications n
                    WHERE n.entity_id = requests.id::text
                      AND n.event_type = 'deadline_1d'
                      AND n.created_at > now() - interval '1 day'
                  )
                LIMIT 50`, [today]);

            for (const row of deadline1d.rows) {
                const recipients = new Set<string>([...adminIds]);
                if (Array.isArray(row.executor_ids)) {
                    for (const eid of row.executor_ids) { const n = normalizeText(eid); if (n) recipients.add(n); }
                }
                const title = normalizeText(row.title) || row.id;
                const dueDate = row.due_date_preliminary ? String(row.due_date_preliminary).slice(0, 10) : '';
                await pushInAppNotification({
                    recipientIds: Array.from(recipients),
                    eventType: 'deadline_1d',
                    title: `Дедлайн завтра: ${title}`,
                    body: `Срок выполнения заявки "${title}" — ${dueDate}. Осталось менее суток!`,
                    entityType: 'service_request',
                    entityId: row.id,
                });
                if (canSendEmails() && Array.isArray(row.executor_ids) && row.executor_ids.length > 0) {
                    const execEmails = await loadScopedActiveEmailRecipients({
                        recipientIds: row.executor_ids,
                        entityType: 'service_request',
                        entityId: row.id,
                    });
                    for (const rec of execEmails) {
                        void sendSystemEventNotice({
                            to: normalizeText(rec.email),
                            subject: `Дедлайн завтра: ${title}`,
                            body: `Заявка "${title}" — срок выполнения ${dueDate}. Осталось менее суток!`,
                        }).catch(() => {});
                    }
                }
            }

            // 5. Visit date reminder: 1 day before
            const visit1d = await dbQuery(`SELECT id::text, title, visit_date, executor_ids, tenant_id
                FROM requests
                WHERE deleted_at IS NULL
                  AND coalesce(status, '') NOT IN ('done', 'closed', 'cancelled')
                  AND visit_date = ($1::date + interval '1 day')::date
                  AND NOT EXISTS (
                    SELECT 1 FROM app_notifications n
                    WHERE n.entity_id = requests.id::text
                      AND n.event_type = 'visit_1d'
                      AND n.created_at > now() - interval '1 day'
                  )
                LIMIT 50`, [today]);

            for (const row of visit1d.rows) {
                const recipients = new Set<string>([...adminIds]);
                if (Array.isArray(row.executor_ids)) {
                    for (const eid of row.executor_ids) { const n = normalizeText(eid); if (n) recipients.add(n); }
                }
                const title = normalizeText(row.title) || row.id;
                const visitDate = row.visit_date ? String(row.visit_date).slice(0, 10) : '';
                await pushInAppNotification({
                    recipientIds: Array.from(recipients),
                    eventType: 'visit_1d',
                    title: `Выезд завтра: ${title}`,
                    body: `Выезд по заявке "${title}" запланирован на ${visitDate}`,
                    entityType: 'service_request',
                    entityId: row.id,
                });
                // Email исполнителям
                if (canSendEmails() && Array.isArray(row.executor_ids) && row.executor_ids.length > 0) {
                    const execEmails = await loadScopedActiveEmailRecipients({
                        recipientIds: row.executor_ids,
                        entityType: 'service_request',
                        entityId: row.id,
                    });
                    for (const rec of execEmails) {
                        void sendSystemEventNotice({
                            to: normalizeText(rec.email),
                            subject: `Выезд завтра: ${title}`,
                            body: `Выезд по заявке "${title}" запланирован на ${visitDate}. Не забудьте подготовиться.`,
                        }).catch(() => {});
                    }
                }
                // Email клиенту
                const tenantId = normalizeText(row.tenant_id);
                if (canSendEmails() && isUuidValue(tenantId)) {
                    const tenantUserResult = await dbQuery(`SELECT u.id::text as id FROM app_users u
                        JOIN app_user_bindings ub ON ub.user_id = u.id
                        WHERE ub.counterparty_id = $1::uuid
                          AND u.role::text = any($2::text[])
                          AND u.status = 'active'
                          AND trim(coalesce(u.email,'')) <> ''`, [tenantId, clientRecipientRoles]);
                    const tenantEmails = await loadScopedActiveEmailRecipients({
                        recipientIds: tenantUserResult.rows.map((item) => normalizeText(item.id)),
                        entityType: 'service_request',
                        entityId: row.id,
                    });
                    for (const rec of tenantEmails) {
                        void sendSystemEventNotice({
                            to: normalizeText(rec.email),
                            subject: `Напоминание: выезд специалиста завтра — ${title}`,
                            body: `Завтра (${visitDate}) запланирован выезд специалиста по заявке "${title}". Пожалуйста, обеспечьте доступ.`,
                        }).catch(() => {});
                    }
                }
            }

            // ── 6. Installation stage deadline reminders ──────────────
            try {
                await ensureInstallationExtendedSchema();

                // T-24h: stage deadline approaching
                const stageDeadline24h = await dbQuery(`
                    SELECT isd.installation_id::text as id, isd.stage, isd.due_date,
                           r.title, r.executor_ids
                    FROM installation_stage_deadlines isd
                    JOIN requests r ON r.id = isd.installation_id
                    WHERE r.deleted_at IS NULL
                      AND r.type = 'installation' AND r.is_project = false
                      AND coalesce(r.status, '') NOT IN ('completed', 'cancelled', 'paused')
                      AND isd.due_date = ($1::date + interval '1 day')::date
                      AND NOT EXISTS (
                        SELECT 1 FROM app_notifications n
                        WHERE n.entity_id = isd.installation_id::text
                          AND n.event_type = 'installation_deadline_approaching'
                          AND n.body LIKE '%' || isd.stage || '%'
                          AND n.created_at > now() - interval '1 day'
                      )
                    LIMIT 50`, [today]);

                for (const row of stageDeadline24h.rows) {
                    const recipients = new Set<string>([...adminIds]);
                    if (Array.isArray(row.executor_ids)) {
                        for (const eid of row.executor_ids) { const n = normalizeText(eid); if (n) recipients.add(n); }
                    }
                    const title = normalizeText(row.title) || row.id;
                    const dueDate = row.due_date ? String(row.due_date).slice(0, 10) : '';
                    const stage = normalizeText(row.stage);
                    await pushInAppNotification({
                        recipientIds: Array.from(recipients),
                        eventType: 'installation_deadline_approaching',
                        title: `Дедлайн этапа «${stage}» завтра: ${title}`,
                        body: `Этап «${stage}» монтажа "${title}" — срок ${dueDate}. Осталось менее суток!`,
                        entityType: 'installation',
                        entityId: row.id,
                    });
                }

                // Overdue: stage deadline passed
                const stageOverdue = await dbQuery(`
                    SELECT isd.installation_id::text as id, isd.stage, isd.due_date,
                           r.title, r.executor_ids
                    FROM installation_stage_deadlines isd
                    JOIN requests r ON r.id = isd.installation_id
                    WHERE r.deleted_at IS NULL
                      AND r.type = 'installation' AND r.is_project = false
                      AND coalesce(r.status, '') NOT IN ('completed', 'cancelled', 'paused')
                      AND isd.due_date < $1::date
                      AND NOT EXISTS (
                        SELECT 1 FROM app_notifications n
                        WHERE n.entity_id = isd.installation_id::text
                          AND n.event_type = 'installation_deadline_overdue'
                          AND n.body LIKE '%' || isd.stage || '%'
                          AND n.created_at > now() - interval '1 day'
                      )
                    LIMIT 50`, [today]);

                for (const row of stageOverdue.rows) {
                    const recipients = new Set<string>([...adminIds]);
                    if (Array.isArray(row.executor_ids)) {
                        for (const eid of row.executor_ids) { const n = normalizeText(eid); if (n) recipients.add(n); }
                    }
                    const title = normalizeText(row.title) || row.id;
                    const dueDate = row.due_date ? String(row.due_date).slice(0, 10) : '';
                    const stage = normalizeText(row.stage);
                    await pushInAppNotification({
                        recipientIds: Array.from(recipients),
                        eventType: 'installation_deadline_overdue',
                        title: `Просрочен этап «${stage}»: ${title}`,
                        body: `Этап «${stage}» монтажа "${title}" просрочен (дедлайн был ${dueDate}).`,
                        entityType: 'installation',
                        entityId: row.id,
                    });

                    // Mark installation as overdue
                    await dbQuery(`UPDATE requests SET is_overdue = true, updated_at = now()
                        WHERE id = $1::uuid AND coalesce(is_overdue, false) = false`, [row.id]);
                }
            } catch (stageErr) {
                logger.error('Installation stage deadline check error', { error: serializeError(stageErr) });
            }

            logger.info('Deadline scheduler tick completed');
        } catch (error) {
            logger.error('Deadline scheduler error', { error: serializeError(error) });
        } finally {
            running = false;
        }
    };

    deadlineInterval = setInterval(() => { void run(); }, INTERVAL_MS);
    setTimeout(() => { void run(); }, 30_000);
    logger.info('Deadline scheduler started', { intervalMs: INTERVAL_MS });
};

// ── PPR Auto-generation scheduler ──────────────────────────────────
export const startPprAutoGenerationScheduler = () => {
    const INTERVAL_MS = 60 * 60 * 1000; // every hour
    let running = false;
    let lastRunKey = '';

    const NOT_STARTED_STATUSES = new Set(['new', 'pending', 'draft']);

    const getMoscowDate = (date = new Date()) => {
        const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' });
        return formatter.format(date); // YYYY-MM-DD
    };

    const getMoscowDay = (date = new Date()) => {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', day: '2-digit' }).formatToParts(date);
        return Number(parts.find((p) => p.type === 'day')?.value ?? 0);
    };

    const run = async () => {
        if (running || shutdownRequested) return;
        running = true;
        try {
            const todayKey = getMoscowDate();
            if (lastRunKey === todayKey) return; // already ran today

            await ensureMaintenanceSchema();
            await ensureMaintenanceItemSchema();
            await ensureProjectSchema();
            await ensureNotificationSchema();

            const todayDay = getMoscowDay();

            // Find active plans where today is the generation day
            const plansResult = await dbQuery(`select * from maintenance_plans
               where status = 'active' and deleted_at is null
                 and day_of_month = $1
                 and valid_from <= current_date
                 and (valid_to is null or valid_to >= current_date)
               order by created_at asc`, [todayDay]);

            if (plansResult.rows.length === 0) {
                lastRunKey = todayKey;
                return;
            }

            logger.info('PPR auto-generation starting', { plansCount: plansResult.rows.length, todayDay });

            for (const plan of plansResult.rows) {
                const planId = normalizeText(plan.id);
                const offset = Number(plan.period_offset ?? 1);
                const updateMode = normalizeText(plan.update_mode) || 'skip';

                // Calculate target period (current month + offset)
                const now = new Date();
                const targetMonth = now.getUTCMonth() + offset;
                const targetYear = now.getUTCFullYear() + Math.floor(targetMonth / 12);
                const targetMonthNorm = ((targetMonth % 12) + 12) % 12;

                const periodStart = new Date(Date.UTC(targetYear, targetMonthNorm, 1)).toISOString().split('T')[0];
                const periodEnd = new Date(Date.UTC(targetYear, targetMonthNorm + 1, 0)).toISOString().split('T')[0];
                const daysInMonth = new Date(Date.UTC(targetYear, targetMonthNorm + 1, 0)).getUTCDate();

                const itemIds = Array.isArray(plan.maintenance_item_ids)
                    ? plan.maintenance_item_ids.map((v: any) => normalizeText(v)).filter(Boolean)
                    : [];
                if (itemIds.length === 0) continue;

                const itemsResult = await dbQuery(`select id::text as id, name, address, systems, direction_id
                   from maintenance_items where id = any($1::uuid[]) and deleted_at is null`, [itemIds]);
                const itemsMap = new Map<string, any>();
                for (const row of itemsResult.rows) itemsMap.set(normalizeText(row.id), row);

                const arrFrom = Math.min(Math.max(Number(plan.arrival_from_day ?? 1), 1), daysInMonth);
                const arrTo = Math.min(Math.max(Number(plan.arrival_to_day ?? 28), 1), daysInMonth);
                const pad2 = (n: number) => String(n).padStart(2, '0');
                const monthStr = pad2(targetMonthNorm + 1);
                const arrivalFrom = `${targetYear}-${monthStr}-${pad2(arrFrom)}`;
                const arrivalTo = `${targetYear}-${monthStr}-${pad2(arrTo)}`;

                const executorIds = Array.isArray(plan.default_executor_ids)
                    ? plan.default_executor_ids.map((v: any) => normalizeText(v)).filter(Boolean)
                    : [];

                let created = 0, skipped = 0, updated = 0, errors = 0;
                const details: any[] = [];

                for (const itemId of itemIds) {
                    const item = itemsMap.get(itemId);
                    if (!item) { skipped++; continue; }

                    const objectName = normalizeText(item.name) || itemId;
                    const objectAddress = normalizeText(item.address);
                    const systemsSnapshot = item.systems && typeof item.systems === 'object' ? item.systems : {};
                    const systemKeys = Object.keys(systemsSnapshot).filter((k) => systemsSnapshot[k] === true);
                    const directionId = normalizeText(item.direction_id);

                    // Anti-duplicate check
                    const existingLink = await dbQuery(`select lnk.id, lnk.request_id, r.status as request_status
                       from ppr_generated_request_link lnk
                       left join requests r on r.id = lnk.request_id
                       where lnk.plan_id = $1::uuid and lnk.object_id = $2 and lnk.period_start = $3::date and lnk.period_end = $4::date and lnk.status = 'active'
                       limit 1`, [planId, itemId, periodStart, periodEnd]);

                    if (existingLink.rows.length > 0) {
                        const existing = existingLink.rows[0];
                        const reqStatus = normalizeText(existing.request_status);

                        if (updateMode === 'skip') {
                            skipped++;
                            continue;
                        }
                        if (updateMode === 'update_not_started' && NOT_STARTED_STATUSES.has(reqStatus)) {
                            try {
                                await dbQuery(`update requests set executor_ids = $2::text[], due_date_preliminary = $3::date, visit_date = $4::date, system_type = $5, updated_at = now() where id = $1::uuid`,
                                    [existing.request_id, executorIds, arrivalFrom, arrivalTo, normalizeText(plan.system_type) || null]);
                                updated++;
                            } catch { errors++; }
                            continue;
                        }
                        if (updateMode === 'versioning') {
                            await dbQuery(`update requests set status = 'cancelled', updated_at = now() where id = $1::uuid`, [existing.request_id]);
                            await dbQuery(`update ppr_generated_request_link set status = 'replaced' where id = $1::uuid`, [existing.id]);
                            // fall through to create new
                        } else {
                            skipped++;
                            continue;
                        }
                    }

                    // Create request
                    const title = `ТО: ${objectName} — ${normalizeText(plan.system_type) || 'ТО'} (${periodStart.slice(0, 7)})`;
                    const systemsList = systemKeys.length > 0 ? `Системы: ${systemKeys.join(', ')}` : 'Системы не указаны';
                    const description = `Плановое ТО. Объект: ${objectName}. Адрес: ${objectAddress || '—'}. ${systemsList}. Окно прибытия: ${arrivalFrom} — ${arrivalTo}.`;

                    try {
                        const reqResult = await dbQuery(`insert into requests(
                           type, is_project, title, description, tenant_id, direction_id, system_type,
                           priority, status, created_by_id, executor_ids, item_ids, system_types,
                           due_date_preliminary, visit_date, maintenance_data, created_at, updated_at
                         ) values(
                           'installation', false, $1, $2, $3, $4, $5,
                           'medium', 'new', null, $6::text[], $7::text[], $8::text[],
                           $9::date, $10::date, $11::jsonb, now(), now()
                         ) returning id::text as id`, [
                            title, description,
                            normalizeText(plan.tenant_id) || null,
                            directionId || null,
                            normalizeText(plan.system_type) || null,
                            executorIds, [itemId], systemKeys,
                            arrivalFrom, arrivalTo,
                            JSON.stringify({ planId, objectName, objectAddress, systemsSnapshot, arrivalFrom, arrivalTo, contactPerson: normalizeText(plan.contact_person), contactPhone: normalizeText(plan.contact_phone) }),
                        ]);
                        const requestId = normalizeText(reqResult.rows[0]?.id);
                        await dbQuery(`insert into ppr_generated_request_link(plan_id, object_id, period_start, period_end, request_id)
                           values($1::uuid, $2, $3::date, $4::date, $5::uuid)`, [planId, itemId, periodStart, periodEnd, requestId]);
                        created++;
                        details.push({ planId, maintenanceItemId: itemId, status: 'created', requestId, objectName });

                        // Per-object email
                        if (plan.send_email === true) {
                            try {
                                await sendMaintenancePlanEmail({
                                    to: normalizeText(plan.contact_person),
                                    toName: normalizeText(plan.contact_person),
                                    planDate: arrivalFrom,
                                    directionName: '',
                                    directionAddress: objectAddress,
                                    executorName: '',
                                    contactPerson: normalizeText(plan.contact_person),
                                    contactPhone: normalizeText(plan.contact_phone),
                                    description,
                                    items: [{ name: objectName, address: objectAddress, systems: systemsSnapshot }],
                                });
                            } catch { /* best effort */ }
                        }
                    } catch (error: any) {
                        errors++;
                        details.push({ planId, maintenanceItemId: itemId, status: 'error', message: String(error?.message ?? error) });
                    }
                }

                // Log the run
                await dbQuery(`insert into maintenance_generation_runs(plan_id, executed_by_id, period_month, period_year, period_start, period_end, mode, total_created, total_skipped, total_updated, total_errors, coverage, details)
                   values($1::uuid, null, $2, $3, $4::date, $5::date, 'auto', $6, $7, $8, $9, $10::jsonb, $11::jsonb)`, [
                    planId, targetMonthNorm, targetYear, periodStart, periodEnd,
                    created, skipped, updated, errors,
                    JSON.stringify({ totalPlannedObjects: itemIds.length, coveredObjects: created + updated + skipped }),
                    JSON.stringify(details),
                ]);

                // Update plan
                await dbQuery(`update maintenance_plans set last_generated = now(), confirmation_sent_at = now(),
                   escalation_48h_sent = false, escalation_72h_sent = false, visit_reminder_sent = false, report_reminder_sent = false, updated_at = now()
                   where id = $1::uuid`, [planId]);

                // Notify managers
                const adminIds = await getAdminManagerIds();
                if (adminIds.length > 0) {
                    const summary = `${normalizeText(plan.name) || planId}: создано ${created}, пропущено ${skipped}, обновлено ${updated}, ошибок ${errors}`;
                    void pushInAppNotification({
                        recipientIds: adminIds,
                        eventType: errors > 0 ? 'generation_partial_error' : 'generation_success',
                        title: errors > 0 ? 'Автогенерация ТО: есть ошибки' : 'Автогенерация ТО выполнена',
                        body: summary,
                        entityType: 'maintenance_plan',
                        entityId: planId,
                    });
                }

                logger.info('PPR auto-generation completed for plan', { planId, created, skipped, updated, errors, period: periodStart });
            }

            lastRunKey = todayKey;
        } catch (error) {
            logger.error('PPR auto-generation scheduler error', { error: serializeError(error) });
        } finally {
            running = false;
        }
    };

    pprAutoGenerationInterval = setInterval(() => { void run(); }, INTERVAL_MS);
    setTimeout(() => { void run(); }, 120_000); // first run after 2 min
    logger.info('PPR auto-generation scheduler started', { intervalMs: INTERVAL_MS });
};

export const startTokenCleanupScheduler = () => {
    const INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
    const run = async () => {
        try {
            const result = await dbQuery(`DELETE FROM auth_refresh_tokens WHERE expires_at < now()`);
            const deleted = result.rowCount ?? 0;
            if (deleted > 0) {
                logger.info('Token cleanup: deleted expired refresh tokens', { deleted });
            }
        } catch (error) {
            logger.error('Token cleanup scheduler error', { error: serializeError(error) });
        }
    };

    tokenCleanupInterval = setInterval(() => { void run(); }, INTERVAL_MS);
    setTimeout(() => { void run(); }, 30_000); // first run after 30s
    logger.info('Token cleanup scheduler started', { intervalMs: INTERVAL_MS });
};

export const startAnomalyDetectionScheduler = () => {
    const INTERVAL_MS = 60 * 60 * 1000; // every 1 hour
    let running = false;

    const run = async () => {
        if (running || shutdownRequested) {
            return;
        }
        running = true;

        try {
            const { detectAnomalies, alertAdminsAboutAnomalies } = await import('./aiPredictiveService.js');
            const anomalies = await detectAnomalies();

            if (anomalies.length > 0) {
                logger.info('Anomaly detection found issues', { count: anomalies.length });
                await alertAdminsAboutAnomalies(anomalies);
            } else {
                logger.debug('Anomaly detection: no issues found');
            }
        } catch (error) {
            logger.error('Anomaly detection scheduler error', { error: serializeError(error) });
        } finally {
            running = false;
        }
    };

    anomalyDetectionInterval = setInterval(() => { void run(); }, INTERVAL_MS);
    setTimeout(() => { void run(); }, 5 * 60 * 1000); // first run after 5 min
    logger.info('Anomaly detection scheduler started', { intervalMs: INTERVAL_MS });
};

export const startScheduledReportsScheduler = () => {
    const INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes
    let running = false;

    const run = async () => {
        if (running || shutdownRequested) {
            return;
        }
        running = true;

        try {
            const { processScheduledReports } = await import('./scheduledReportsService.js');
            await processScheduledReports();
        } catch (error) {
            logger.error('Scheduled reports scheduler error', { error: serializeError(error) });
        } finally {
            running = false;
        }
    };

    scheduledReportsInterval = setInterval(() => { void run(); }, INTERVAL_MS);
    setTimeout(() => { void run(); }, 2 * 60 * 1000); // first run after 2 min
    logger.info('Scheduled reports scheduler started', { intervalMs: INTERVAL_MS });
};

// ── Weekly AI Anomaly Report (every Monday at 09:00 Moscow time) ────────
let weeklyAnomalyReportInterval: NodeJS.Timeout | null = null;

export const startWeeklyAnomalyReportScheduler = () => {
    const INTERVAL_MS = 60 * 60 * 1000; // check every hour
    let running = false;
    let lastReportKey = '';

    const getMoscowDateParts = (date = new Date()) => {
        const formatter = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/Moscow',
            weekday: 'short',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        });
        const parts = formatter.formatToParts(date);
        const get = (type: string) => normalizeText(parts.find((item) => item.type === type)?.value);
        return {
            weekday: get('weekday').toLowerCase(),
            year: get('year'),
            month: get('month'),
            day: get('day'),
            hour: Number.parseInt(get('hour'), 10),
            minute: Number.parseInt(get('minute'), 10),
        };
    };

    const run = async () => {
        if (running || shutdownRequested || !appConfig.aiEnabled) {
            return;
        }
        running = true;

        try {
            const { ensureAiWeeklyReportSchema } = await import('../schemas/aiWeeklyReportSchema.js');
            await ensureAiWeeklyReportSchema();
            await ensureServiceRequestSchema();
            await ensureNotificationSchema();

            const nowParts = getMoscowDateParts();
            const reportKey = `anomaly-${nowParts.year}-${nowParts.month}-${nowParts.day}`;

            // Only run on Monday at 09:00 Moscow time
            if (nowParts.weekday !== 'mon' || !Number.isFinite(nowParts.hour) || nowParts.hour !== 9) {
                return;
            }
            if (lastReportKey === reportKey) {
                return;
            }

            // Check if report already generated today
            const existingReport = await dbQuery(
                `SELECT id FROM ai_weekly_reports WHERE report_key = $1 LIMIT 1`,
                [reportKey],
            );
            if (existingReport.rows.length > 0) {
                lastReportKey = reportKey;
                return;
            }

            logger.info('Weekly AI anomaly report: starting generation', { reportKey });

            // 1. Collect anomalies from past 7 days
            let anomaliesData: any[] = [];
            try {
                const { detectAnomalies } = await import('./aiPredictiveService.js');
                anomaliesData = await detectAnomalies();
            } catch (error) {
                logger.warn('Weekly anomaly report: anomaly detection failed', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }

            // 2. Collect service request statistics
            const [createdResult, completedResult, overdueResult, byTypeResult, byPriorityResult, bySystemResult] = await Promise.all([
                dbQuery(`SELECT count(*)::int as count FROM requests
                    WHERE created_at > now() - interval '7 days'
                      AND type = 'service_request'
                      AND deleted_at IS NULL`),
                dbQuery(`SELECT count(*)::int as count FROM requests
                    WHERE updated_at > now() - interval '7 days'
                      AND type = 'service_request'
                      AND status IN ('done', 'closed')
                      AND deleted_at IS NULL`),
                dbQuery(`SELECT count(*)::int as count FROM requests
                    WHERE type = 'service_request'
                      AND status NOT IN ('done', 'closed', 'cancelled')
                      AND due_date_preliminary IS NOT NULL
                      AND due_date_preliminary < current_date
                      AND deleted_at IS NULL`),
                dbQuery(`SELECT coalesce(type, 'unknown') as type, count(*)::int as count
                    FROM requests
                    WHERE created_at > now() - interval '7 days'
                      AND type = 'service_request'
                      AND deleted_at IS NULL
                    GROUP BY coalesce(type, 'unknown')`),
                dbQuery(`SELECT coalesce(priority, 'unknown') as priority, count(*)::int as count
                    FROM requests
                    WHERE created_at > now() - interval '7 days'
                      AND type = 'service_request'
                      AND deleted_at IS NULL
                    GROUP BY coalesce(priority, 'unknown')`),
                dbQuery(`SELECT coalesce(system_type, 'unknown') as system_type, count(*)::int as count
                    FROM requests
                    WHERE created_at > now() - interval '7 days'
                      AND type = 'service_request'
                      AND deleted_at IS NULL
                    GROUP BY coalesce(system_type, 'unknown')`),
            ]);

            const requestsCreated = Number(createdResult.rows[0]?.count ?? 0);
            const requestsCompleted = Number(completedResult.rows[0]?.count ?? 0);
            const requestsOverdue = Number(overdueResult.rows[0]?.count ?? 0);

            const requestStats = {
                created: requestsCreated,
                completed: requestsCompleted,
                overdue: requestsOverdue,
                byType: byTypeResult.rows.map((r: any) => ({ type: normalizeText(r.type), count: Number(r.count) })),
                byPriority: byPriorityResult.rows.map((r: any) => ({ priority: normalizeText(r.priority), count: Number(r.count) })),
                bySystem: bySystemResult.rows.map((r: any) => ({ systemType: normalizeText(r.system_type), count: Number(r.count) })),
            };

            // 3. Generate AI summary report in Russian
            const reportSystemPrompt = `Ты — аналитик системы обслуживания инженерных систем безопасности Новинжстрой.
Подготовь еженедельный отчёт об аномалиях и статистике сервисных заявок.

Структура отчёта:
1. Общая сводка за неделю (2-3 предложения)
2. Статистика заявок: создано, завершено, просрочено
3. Обнаруженные аномалии (если есть) с описанием и рекомендациями
4. Распределение по типам систем и приоритетам
5. Рекомендации на следующую неделю (2-3 пункта)

Правила:
- Пиши на русском деловом языке
- Не более 400 слов
- Конкретные цифры, без воды
- Если аномалий нет — отметь это как положительный факт
- Используй формат Telegram (без HTML, допустимы эмодзи)
/no_think`;

            const reportUserPrompt = `Данные за последние 7 дней:

Статистика заявок:
- Создано: ${requestsCreated}
- Завершено: ${requestsCompleted}
- Просрочено: ${requestsOverdue}

По типам: ${requestStats.byType.map((r) => `${r.type}: ${r.count}`).join(', ') || 'нет данных'}
По приоритетам: ${requestStats.byPriority.map((r) => `${r.priority}: ${r.count}`).join(', ') || 'нет данных'}
По системам: ${requestStats.bySystem.map((r) => `${r.systemType}: ${r.count}`).join(', ') || 'нет данных'}

Обнаруженные аномалии (${anomaliesData.length}):
${anomaliesData.length > 0
    ? anomaliesData.map((a, i) => `${i + 1}. [${a.severity}] ${a.type}: ${a.description} (затронуто: ${a.affectedEntities?.length ?? 0})`).join('\n')
    : 'Аномалий не обнаружено.'}`;

            let reportText = '';
            try {
                reportText = normalizeText(await callLLM(reportSystemPrompt, reportUserPrompt));
            } catch (error) {
                logger.warn('Weekly anomaly report: LLM generation failed', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }

            if (!reportText) {
                reportText = [
                    `Еженедельный отчёт Новинжстрой`,
                    ``,
                    `Заявки за 7 дней: создано ${requestsCreated}, завершено ${requestsCompleted}, просрочено ${requestsOverdue}.`,
                    anomaliesData.length > 0
                        ? `Обнаружено аномалий: ${anomaliesData.length}. ${anomaliesData.map((a) => `${a.type}: ${a.description}`).join('; ')}`
                        : 'Аномалий не обнаружено.',
                ].join('\n');
            }

            // 4. Send via Telegram to admins
            let sentViaTelegram = false;
            const adminIds = await getAdminManagerIds();
            if (adminIds.length > 0) {
                try {
                    await pushTelegramNotification({
                        recipientIds: adminIds,
                        eventType: 'weekly_anomaly_report',
                        title: 'Еженедельный AI-отчёт об аномалиях',
                        body: reportText,
                        entityType: 'dashboard',
                        entityId: reportKey,
                    });
                    sentViaTelegram = true;
                } catch (error) {
                    logger.error('Weekly anomaly report: Telegram notification failed', {
                        error: serializeError(error),
                    });
                }

                // Also send in-app notification
                await pushInAppNotification({
                    recipientIds: adminIds,
                    eventType: 'weekly_anomaly_report',
                    title: 'Еженедельный AI-отчёт об аномалиях готов',
                    body: `Обнаружено аномалий: ${anomaliesData.length}. Заявок: создано ${requestsCreated}, завершено ${requestsCompleted}, просрочено ${requestsOverdue}.`,
                    entityType: 'dashboard',
                    entityId: reportKey,
                });
            }

            // 5. Send via email
            let sentViaEmail = false;
            const adminManagerResult = await dbQuery(`SELECT
                id::text as id,
                lower(trim(email)) as email,
                coalesce(nullif(trim(full_name), ''), split_part(lower(trim(email)), '@', 1)) as full_name
              FROM app_users
              WHERE role IN ('admin', 'manager')
                AND status = 'active'
                AND coalesce(trim(email), '') <> ''`);

            if (canSendEmails() && adminManagerResult.rows.length > 0) {
                await Promise.all(adminManagerResult.rows.map(async (recipient) => {
                    const email = normalizeText(recipient.email).toLowerCase();
                    if (!email || !isEmailValue(email)) {
                        return;
                    }
                    try {
                        await sendSystemEventNotice({
                            to: email,
                            subject: 'Новинжстрой: еженедельный AI-отчёт об аномалиях',
                            body: reportText,
                        });
                        sentViaEmail = true;
                    } catch (error) {
                        logger.error('Weekly anomaly report: email failed', {
                            recipientEmail: email,
                            error: serializeError(error),
                        });
                    }
                }));
            }

            // 6. Store report in ai_weekly_reports table
            const periodEnd = new Date();
            const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

            await dbQuery(
                `INSERT INTO ai_weekly_reports
                    (report_key, period_start, period_end, anomalies_count,
                     requests_created, requests_completed, requests_overdue,
                     anomalies_data, request_stats, report_text,
                     sent_via_telegram, sent_via_email, recipient_count)
                 VALUES ($1, $2::date, $3::date, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13)`,
                [
                    reportKey,
                    periodStart.toISOString().slice(0, 10),
                    periodEnd.toISOString().slice(0, 10),
                    anomaliesData.length,
                    requestsCreated,
                    requestsCompleted,
                    requestsOverdue,
                    JSON.stringify(anomaliesData),
                    JSON.stringify(requestStats),
                    reportText,
                    sentViaTelegram,
                    sentViaEmail,
                    adminIds.length,
                ],
            );

            lastReportKey = reportKey;
            logger.info('Weekly AI anomaly report generated', {
                reportKey,
                anomaliesCount: anomaliesData.length,
                requestsCreated,
                requestsCompleted,
                requestsOverdue,
                sentViaTelegram,
                sentViaEmail,
                recipientCount: adminIds.length,
            });
        } catch (error) {
            logger.error('Weekly AI anomaly report scheduler error', {
                error: serializeError(error),
            });
        } finally {
            running = false;
        }
    };

    weeklyAnomalyReportInterval = setInterval(() => { void run(); }, INTERVAL_MS);
    setTimeout(() => { void run(); }, 3 * 60 * 1000); // first run after 3 min
    logger.info('Weekly AI anomaly report scheduler started', { intervalMs: INTERVAL_MS });
};

// --- F-041: SPPZ Fire Safety Check Reminders (daily at 09:00 Moscow) ---
export const startSppzFireCheckReminderScheduler = () => {
    const INTERVAL_MS = 60 * 60 * 1000; // check every hour
    let running = false;
    let lastRunKey = '';

    const getMoscowHour = () => {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/Moscow',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(new Date());
        const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
        return {
            dateKey: `${get('year')}-${get('month')}-${get('day')}`,
            hour: Number.parseInt(get('hour'), 10),
        };
    };

    const run = async () => {
        if (running || shutdownRequested) return;
        running = true;

        try {
            const { dateKey, hour } = getMoscowHour();
            // Only run at 09:xx Moscow time
            if (hour !== 9) return;
            const runKey = `sppz-fire-${dateKey}`;
            if (lastRunKey === runKey) return;
            lastRunKey = runKey;

            await ensureNotificationSchema();

            // Check if schedule table exists
            const tableCheck = await dbQuery(
                `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sppz_check_schedule') AS exists`,
            );
            if (!tableCheck.rows[0]?.exists) return;

            const adminIds = await getAdminManagerIds();

            // 14 days before
            const in14d = await dbQuery(`
                SELECT * FROM sppz_check_schedule
                WHERE next_check_date BETWEEN now() AND now() + interval '14 days'
                  AND next_check_date > now() + interval '7 days'
                  AND notified_14d = false
            `);
            for (const row of in14d.rows) {
                const title = `Проверка ${row.check_type_label || row.section} через 14 дней`;
                const body = `Объект: ${row.object_key || 'Не указан'}. Следующая проверка: ${new Date(row.next_check_date).toLocaleDateString('ru-RU')}`;
                await pushInAppNotification({
                    recipientIds: adminIds,
                    eventType: 'sppz_check_reminder_14d',
                    title,
                    body,
                    entityType: 'sppz_check_schedule',
                    entityId: row.id,
                });
                await dbQuery(`UPDATE sppz_check_schedule SET notified_14d = true, updated_at = now() WHERE id = $1`, [row.id]);
            }

            // 7 days before
            const in7d = await dbQuery(`
                SELECT * FROM sppz_check_schedule
                WHERE next_check_date BETWEEN now() AND now() + interval '7 days'
                  AND next_check_date > now() + interval '1 day'
                  AND notified_7d = false
            `);
            for (const row of in7d.rows) {
                const title = `Проверка ${row.check_type_label || row.section} через 7 дней`;
                const body = `Объект: ${row.object_key || 'Не указан'}. Следующая проверка: ${new Date(row.next_check_date).toLocaleDateString('ru-RU')}`;
                await pushInAppNotification({
                    recipientIds: adminIds,
                    eventType: 'sppz_check_reminder_7d',
                    title,
                    body,
                    entityType: 'sppz_check_schedule',
                    entityId: row.id,
                });
                await dbQuery(`UPDATE sppz_check_schedule SET notified_7d = true, updated_at = now() WHERE id = $1`, [row.id]);
            }

            // 1 day before
            const in1d = await dbQuery(`
                SELECT * FROM sppz_check_schedule
                WHERE next_check_date BETWEEN now() AND now() + interval '1 day'
                  AND notified_1d = false
            `);
            for (const row of in1d.rows) {
                const title = `Проверка ${row.check_type_label || row.section} завтра!`;
                const body = `Объект: ${row.object_key || 'Не указан'}. Дата проверки: ${new Date(row.next_check_date).toLocaleDateString('ru-RU')}`;
                await pushInAppNotification({
                    recipientIds: adminIds,
                    eventType: 'sppz_check_reminder_1d',
                    title,
                    body,
                    entityType: 'sppz_check_schedule',
                    entityId: row.id,
                });
                await dbQuery(`UPDATE sppz_check_schedule SET notified_1d = true, updated_at = now() WHERE id = $1`, [row.id]);
            }

            // Overdue — daily notification
            const overdue = await dbQuery(`
                SELECT * FROM sppz_check_schedule
                WHERE next_check_date < now()
            `);
            for (const row of overdue.rows) {
                const daysOverdue = Math.ceil((Date.now() - new Date(row.next_check_date).getTime()) / (24 * 60 * 60 * 1000));
                const title = `ПРОСРОЧЕНО: проверка ${row.check_type_label || row.section}`;
                const body = `Объект: ${row.object_key || 'Не указан'}. Просрочено на ${daysOverdue} дн. Плановая дата: ${new Date(row.next_check_date).toLocaleDateString('ru-RU')}`;
                await pushInAppNotification({
                    recipientIds: adminIds,
                    eventType: 'sppz_check_overdue',
                    title,
                    body,
                    entityType: 'sppz_check_schedule',
                    entityId: row.id,
                });
            }

            logger.info('SPPZ fire check reminders processed', {
                in14d: in14d.rows.length,
                in7d: in7d.rows.length,
                in1d: in1d.rows.length,
                overdue: overdue.rows.length,
            });
        } catch (error) {
            logger.error('SPPZ fire check reminder scheduler error', { error: serializeError(error) });
        } finally {
            running = false;
        }
    };

    sppzFireCheckInterval = setInterval(() => { void run(); }, INTERVAL_MS);
    setTimeout(() => { void run(); }, 5 * 60 * 1000);
    logger.info('SPPZ fire check reminder scheduler started', { intervalMs: INTERVAL_MS });
};

// --- F-043: Contractor License Expiration Alerts ---
export const startSppzLicenseExpirationScheduler = () => {
    const INTERVAL_MS = 60 * 60 * 1000; // check every hour
    let running = false;
    let lastRunKey = '';

    const getMoscowDateKey = () => {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/Moscow',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(new Date());
        const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
        return {
            dateKey: `${get('year')}-${get('month')}-${get('day')}`,
            hour: Number.parseInt(get('hour'), 10),
        };
    };

    const run = async () => {
        if (running || shutdownRequested) return;
        running = true;

        try {
            const { dateKey, hour } = getMoscowDateKey();
            if (hour !== 9) return;
            const runKey = `sppz-license-${dateKey}`;
            if (lastRunKey === runKey) return;
            lastRunKey = runKey;

            await ensureNotificationSchema();
            const adminIds = await getAdminManagerIds();
            if (adminIds.length === 0) return;

            // Check license_checks table for latest check per contractor
            const tableCheck = await dbQuery(
                `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sppz_journal_license_checks') AS exists`,
            );
            if (!tableCheck.rows[0]?.exists) return;

            // Find contractors with license expiration info from the most recent license check
            // We use sppz_journal_entries to find contractors and their license data
            const contractorsResult = await dbQuery(`
                SELECT DISTINCT ON (contractor_id)
                    contractor_id,
                    entry_data->>'contractor' AS contractor_name,
                    entry_data->>'licenseNumber' AS license_number,
                    (entry_data->>'licenseValidTo')::text AS license_valid_to
                FROM sppz_journal_entries
                WHERE contractor_id IS NOT NULL
                  AND deleted_at IS NULL
                  AND entry_data->>'licenseValidTo' IS NOT NULL
                  AND entry_data->>'licenseValidTo' != ''
                ORDER BY contractor_id, event_datetime DESC
            `);

            let alertCount = 0;
            for (const row of contractorsResult.rows) {
                const validTo = new Date(row.license_valid_to);
                if (Number.isNaN(validTo.getTime())) continue;

                const daysUntilExpiry = Math.ceil((validTo.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
                const contractorName = normalizeText(row.contractor_name) || 'Контрагент';
                const licenseNumber = normalizeText(row.license_number) || 'не указан';

                if (daysUntilExpiry <= 0) {
                    await pushInAppNotification({
                        recipientIds: adminIds,
                        eventType: 'sppz_license_expired',
                        title: `Лицензия истекла: ${contractorName}`,
                        body: `Лицензия ${licenseNumber} контрагента "${contractorName}" истекла ${validTo.toLocaleDateString('ru-RU')}.`,
                        entityType: 'contractor_license',
                        entityId: normalizeText(row.contractor_id),
                    });
                    alertCount++;
                } else if (daysUntilExpiry <= 30) {
                    await pushInAppNotification({
                        recipientIds: adminIds,
                        eventType: 'sppz_license_expiring_30d',
                        title: `Лицензия истекает через ${daysUntilExpiry} дн.: ${contractorName}`,
                        body: `Лицензия ${licenseNumber} контрагента "${contractorName}" истекает ${validTo.toLocaleDateString('ru-RU')}.`,
                        entityType: 'contractor_license',
                        entityId: normalizeText(row.contractor_id),
                    });
                    alertCount++;
                } else if (daysUntilExpiry <= 60) {
                    await pushInAppNotification({
                        recipientIds: adminIds,
                        eventType: 'sppz_license_expiring_60d',
                        title: `Лицензия истекает через ${daysUntilExpiry} дн.: ${contractorName}`,
                        body: `Лицензия ${licenseNumber} контрагента "${contractorName}" истекает ${validTo.toLocaleDateString('ru-RU')}.`,
                        entityType: 'contractor_license',
                        entityId: normalizeText(row.contractor_id),
                    });
                    alertCount++;
                }
            }

            logger.info('SPPZ license expiration check completed', {
                contractorsChecked: contractorsResult.rows.length,
                alertsSent: alertCount,
            });
        } catch (error) {
            logger.error('SPPZ license expiration scheduler error', { error: serializeError(error) });
        } finally {
            running = false;
        }
    };

    sppzLicenseExpirationInterval = setInterval(() => { void run(); }, INTERVAL_MS);
    setTimeout(() => { void run(); }, 6 * 60 * 1000);
    logger.info('SPPZ license expiration scheduler started', { intervalMs: INTERVAL_MS });
};

export const stopAllSchedulers = () => {
    shutdownRequested = true;
    if (escalationInterval) clearInterval(escalationInterval);
    if (ticketClientDigestInterval) clearInterval(ticketClientDigestInterval);
    if (deadlineInterval) clearInterval(deadlineInterval);
    if (pprAutoGenerationInterval) clearInterval(pprAutoGenerationInterval);
    if (tokenCleanupInterval) clearInterval(tokenCleanupInterval);
    if (anomalyDetectionInterval) clearInterval(anomalyDetectionInterval);
    if (scheduledReportsInterval) clearInterval(scheduledReportsInterval);
    if (weeklyDigestInterval) clearInterval(weeklyDigestInterval);
    if (weeklyAnomalyReportInterval) clearInterval(weeklyAnomalyReportInterval);
    if (sppzFireCheckInterval) clearInterval(sppzFireCheckInterval);
    if (sppzLicenseExpirationInterval) clearInterval(sppzLicenseExpirationInterval);
    logger.info('All schedulers stopped');
};

