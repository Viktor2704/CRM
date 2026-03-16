import { appMetrics } from '../metrics.js';
import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';
import { sendQueuedEmailRecord } from './mailService.js';

const EMAIL_QUEUE_SIZE_METRIC = 'novin_app_email_queue_size';
const EMAIL_QUEUE_SIZE_HELP = 'Current number of queued email records by status.';
const EMAIL_SENT_TOTAL_METRIC = 'novin_app_email_sent_total';
const EMAIL_SENT_TOTAL_HELP = 'Completed queued email delivery outcomes by provider and status.';
const EMAIL_MAX_ATTEMPTS = 5;
const EMAIL_BATCH_SIZE = 10;
const EMAIL_BATCH_DELAY_MS = 1000;

const EMAIL_QUEUE_STATUSES = ['pending', 'sent', 'failed', 'bounced'] as const;
const EMAIL_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;

type EmailQueueStatus = typeof EMAIL_QUEUE_STATUSES[number];
type EmailPriority = typeof EMAIL_PRIORITIES[number];

const PRIORITY_ORDER: Record<EmailPriority, number> = {
    urgent: 0,
    high: 1,
    normal: 2,
    low: 3,
};

const normalizeStatuses = (statuses?: string[]) => {
    if (!Array.isArray(statuses) || statuses.length === 0) {
        return [...EMAIL_QUEUE_STATUSES];
    }
    const normalized = Array.from(new Set(statuses.map((value) => String(value ?? '').trim().toLowerCase())));
    return normalized.filter((value): value is EmailQueueStatus => EMAIL_QUEUE_STATUSES.includes(value as EmailQueueStatus));
};

const mapEmailQueueRow = (row: any) => ({
    id: String(row?.id ?? ''),
    to: String(row?.to_address ?? ''),
    from: String(row?.from_address ?? ''),
    subject: String(row?.subject ?? ''),
    textBody: String(row?.text_body ?? ''),
    htmlBody: String(row?.html_body ?? ''),
    status: String(row?.status ?? 'pending'),
    attempts: Number(row?.attempts ?? 0),
    lastError: String(row?.last_error ?? ''),
    bounceReason: String(row?.bounce_reason ?? ''),
    priority: String(row?.priority ?? 'normal'),
    metadata: row?.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdAt: row?.created_at ? String(row.created_at) : '',
    sentAt: row?.sent_at ? String(row.sent_at) : '',
    nextRetryAt: row?.next_retry_at ? String(row.next_retry_at) : '',
  });

const setEmailQueueMetric = (status: EmailQueueStatus, value: number) => {
    appMetrics.setGauge(EMAIL_QUEUE_SIZE_METRIC, EMAIL_QUEUE_SIZE_HELP, { status }, value);
};

export const refreshEmailQueueMetrics = async () => {
    const countsResult = await dbQuery(`select status, count(*)::int as total
       from email_queue
       group by status`);
    const counts = new Map<string, number>();
    for (const row of countsResult.rows) {
        counts.set(String(row.status ?? ''), Number(row.total ?? 0));
    }
    for (const status of EMAIL_QUEUE_STATUSES) {
        setEmailQueueMetric(status, counts.get(status) ?? 0);
    }
};

export const listEmailQueue = async (params: { statuses?: string[]; limit?: number; offset?: number } = {}) => {
    const statuses = normalizeStatuses(params.statuses);
    const limit = Math.max(1, Math.min(200, Number(params.limit ?? 50)));
    const offset = Math.max(0, Number(params.offset ?? 0));
    const result = await dbQuery(`select
       id,
       to_address,
       from_address,
       subject,
       text_body,
       html_body,
       status,
       attempts,
       last_error,
       metadata,
       created_at,
       sent_at,
       next_retry_at
     from email_queue
     where status = any($1::text[])
     order by created_at desc
     limit $2
     offset $3`, [statuses, limit, offset]);
    const totalResult = await dbQuery(`select count(*)::int as total
       from email_queue
       where status = any($1::text[])`, [statuses]);
    return {
        items: result.rows.map(mapEmailQueueRow),
        total: Number(totalResult.rows[0]?.total ?? 0),
    };
};

export const retryEmailQueueItems = async (ids: string[]) => {
    const normalizedIds = Array.from(new Set((ids ?? []).map((value) => String(value ?? '').trim()).filter(Boolean)));
    if (normalizedIds.length === 0) {
        return 0;
    }
    const result = await dbQuery(`update email_queue
       set status = 'pending',
           attempts = 0,
           last_error = null,
           sent_at = null,
           next_retry_at = null
       where id = any($1::uuid[])`, [normalizedIds]);
    await refreshEmailQueueMetrics();
    return result.rowCount ?? 0;
};

export const deleteEmailQueueItems = async (ids: string[]) => {
    const normalizedIds = Array.from(new Set((ids ?? []).map((value) => String(value ?? '').trim()).filter(Boolean)));
    if (normalizedIds.length === 0) {
        return 0;
    }
    const result = await dbQuery(`delete from email_queue
       where id = any($1::uuid[])`, [normalizedIds]);
    await refreshEmailQueueMetrics();
    return result.rowCount ?? 0;
};

export const loadPendingEmailQueueBatch = async (limit = 10) => {
    const result = await dbQuery(`select *
       from email_queue
       where status = 'pending'
         and (next_retry_at is null or next_retry_at <= now())
       order by
         case priority
           when 'urgent' then 0
           when 'high' then 1
           when 'normal' then 2
           when 'low' then 3
           else 2
         end,
         created_at
       limit $1`, [Math.max(1, Math.min(100, limit))]);
    return result.rows;
};

const markEmailQueueSent = async (row: any) => {
    await dbQuery(`update email_queue
       set status = 'sent',
           attempts = $2,
           last_error = null,
           next_retry_at = null,
           sent_at = now()
       where id = $1::uuid`, [
        String(row?.id ?? ''),
        Number(row?.attempts ?? 0) + 1,
    ]);
    appMetrics.incrementCounter(EMAIL_SENT_TOTAL_METRIC, EMAIL_SENT_TOTAL_HELP, {
        provider: 'smtp',
        status: 'sent',
    });
};

const markEmailQueueFailedAttempt = async (row: any, error: unknown) => {
    const nextAttempts = Number(row?.attempts ?? 0) + 1;
    const permanentFailure = nextAttempts >= EMAIL_MAX_ATTEMPTS;

    // Exponential backoff: 2^attempts minutes (2, 4, 8, 16, 32 minutes)
    const backoffMinutes = Math.min(2 ** Number(row?.attempts ?? 0), 60);
    const nextRetryAt = permanentFailure
        ? null
        : new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

    // Check if error is a bounce
    const errorMessage = String((error as Error)?.message ?? error);
    const isBounce = /bounce|invalid.*address|recipient.*reject|mailbox.*not.*found|user.*unknown/i.test(errorMessage);
    const newStatus = isBounce ? 'bounced' : (permanentFailure ? 'failed' : 'pending');

    await dbQuery(`update email_queue
       set status = $2,
           attempts = $3,
           last_error = $4,
           next_retry_at = $5,
           bounce_reason = case when $6 then $4 else bounce_reason end
       where id = $1::uuid`, [
        String(row?.id ?? ''),
        newStatus,
        nextAttempts,
        serializeError(error).message ?? errorMessage,
        nextRetryAt,
        isBounce,
    ]);

    if (permanentFailure || isBounce) {
        appMetrics.incrementCounter(EMAIL_SENT_TOTAL_METRIC, EMAIL_SENT_TOTAL_HELP, {
            provider: 'smtp',
            status: isBounce ? 'bounced' : 'failed',
        });

        // Auto-disable bounced email addresses
        if (isBounce) {
            await handleBouncedEmail(String(row?.to_address ?? ''), errorMessage);
        }
    }
};

export const processEmailQueueRecord = async (row: any) => {
    try {
        await sendQueuedEmailRecord(row);
        await markEmailQueueSent(row);
    }
    catch (error) {
        logger.warn('Email queue delivery failed', {
            emailQueueId: String(row?.id ?? ''),
            to: String(row?.to_address ?? ''),
            error: serializeError(error),
        });
        await markEmailQueueFailedAttempt(row, error);
    }
};

const handleBouncedEmail = async (emailAddress: string, bounceReason: string) => {
    try {
        // Check if email belongs to a user
        const userResult = await dbQuery(`select id, email, email_verified from app_users where lower(email) = lower($1)`, [emailAddress]);

        if (userResult.rows.length > 0) {
            const user = userResult.rows[0];

            // Mark email as unverified
            await dbQuery(`update app_users set email_verified = false where id = $1::uuid`, [user.id]);

            logger.warn('Email bounced - marked as unverified', {
                userId: user.id,
                email: emailAddress,
                bounceReason,
            });

            // TODO: Alert admins about bounce (could send notification or log to admin dashboard)
        }
    } catch (error) {
        logger.error('Failed to handle bounced email', {
            email: emailAddress,
            error: serializeError(error),
        });
    }
};

export const getBounceStatistics = async () => {
    const result = await dbQuery(`
        select
            count(*) filter (where status = 'bounced')::int as total_bounced,
            count(*) filter (where status = 'bounced' and created_at > now() - interval '7 days')::int as bounced_last_7_days,
            count(*) filter (where status = 'bounced' and created_at > now() - interval '30 days')::int as bounced_last_30_days,
            count(distinct to_address) filter (where status = 'bounced')::int as unique_bounced_addresses
        from email_queue
    `);

    const topBouncedResult = await dbQuery(`
        select
            to_address,
            count(*)::int as bounce_count,
            max(created_at) as last_bounce_at,
            max(bounce_reason) as last_bounce_reason
        from email_queue
        where status = 'bounced'
        group by to_address
        order by bounce_count desc
        limit 10
    `);

    return {
        summary: result.rows[0] || {
            total_bounced: 0,
            bounced_last_7_days: 0,
            bounced_last_30_days: 0,
            unique_bounced_addresses: 0,
        },
        topBounced: topBouncedResult.rows.map(row => ({
            email: String(row.to_address),
            bounceCount: Number(row.bounce_count),
            lastBounceAt: String(row.last_bounce_at),
            lastBounceReason: String(row.last_bounce_reason || ''),
        })),
    };
};

export const processBatchWithRateLimit = async (batchSize = EMAIL_BATCH_SIZE) => {
    const batch = await loadPendingEmailQueueBatch(batchSize);

    if (batch.length === 0) {
        return 0;
    }

    let processed = 0;
    for (const row of batch) {
        await processEmailQueueRecord(row);
        processed++;

        // Add delay between emails to avoid rate limits
        if (processed < batch.length) {
            await new Promise(resolve => setTimeout(resolve, EMAIL_BATCH_DELAY_MS));
        }
    }

    await refreshEmailQueueMetrics();
    return processed;
};
