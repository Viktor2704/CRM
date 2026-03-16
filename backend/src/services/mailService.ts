import { randomUUID } from 'node:crypto';
import { appConfig } from '../config.js';
import { dbQuery } from '../db.js';
import { ApiError } from '../errors.js';
import { wrapEmailHtml } from '../helpers/emailTemplates.js';
import { escapeHtml } from '../helpers/normalize.js';
import { logger, serializeError } from '../logger.js';
import { __emailRateLimiterTestUtils, rateLimitEmailSend } from './emailRateLimiter.js';

const MAIL_SEND_RETRY_DELAYS_MS = [1000, 2000, 4000];

type MailAttachment = Record<string, unknown>;

type MailSendArgs = {
    to: string;
    from: string;
    subject: string;
    text: string;
    html: string;
    attachments?: MailAttachment[];
};

type QueuedEmailInput = MailSendArgs & {
    metadata?: Record<string, unknown>;
};

type QueuedEmailRecord = {
    id: string;
    toAddress: string;
    fromAddress: string;
    subject: string;
    textBody: string;
    htmlBody: string;
    metadata: Record<string, unknown>;
};

type MailTransport = {
    sendMail: (message: Record<string, unknown>) => Promise<any>;
    verify: () => Promise<any>;
    close?: () => Promise<any> | void;
};

type MailerModule = {
    createTransport?: (config: Record<string, unknown>) => MailTransport;
    default?: {
        createTransport?: (config: Record<string, unknown>) => MailTransport;
    };
};

type MailServiceDeps = {
    loadMailer: () => Promise<MailerModule>;
    queryFn: typeof dbQuery;
    sleepFn: (delayMs: number) => Promise<void>;
};

const sleep = (delayMs: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
});

const loadMailer = async () => {
    const moduleName = 'nodemailer';
    return await import(moduleName) as MailerModule;
};

const mailServiceDeps: MailServiceDeps = {
    loadMailer,
    queryFn: dbQuery,
    sleepFn: sleep,
};

let transporterPromise: Promise<MailTransport> | null = null;

export const sender = appConfig.smtpFrom || appConfig.smtpUser;

const normalizeHeaderValue = (value: string) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

const buildHtmlEmail = (args: { title: string; preheader: string; body: string }) => {
    return wrapEmailHtml(args.body, { preheader: args.preheader });
};

const buildDkimConfig = () => {
    const domainName = String(appConfig.smtpDkimDomainName ?? '').trim();
    const keySelector = String(appConfig.smtpDkimKeySelector ?? '').trim();
    const privateKey = String(appConfig.smtpDkimPrivateKey ?? '').trim().replace(/\\n/g, '\n');
    if (!domainName || !keySelector || !privateKey) {
        return undefined;
    }
    return {
        domainName,
        keySelector,
        privateKey,
    };
};

const createTransporter = async () => {
    const module = await mailServiceDeps.loadMailer();
    const createTransport = module.createTransport ?? module.default?.createTransport;
    if (typeof createTransport !== 'function') {
        throw new Error('Nodemailer createTransport() is unavailable');
    }
    return createTransport({
        host: appConfig.smtpHost,
        port: appConfig.smtpPort,
        secure: appConfig.smtpSecure,
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        auth: appConfig.smtpUser
            ? {
                user: appConfig.smtpUser,
                pass: appConfig.smtpPass,
            }
            : undefined,
        dkim: buildDkimConfig(),
    });
};

const getTransporter = async () => {
    if (!transporterPromise) {
        transporterPromise = createTransporter();
    }
    return await transporterPromise;
};

const resetTransporter = () => {
    transporterPromise = null;
};

const toMailError = (error: unknown) => {
    if (error instanceof Error) {
        return error;
    }
    return new Error(String(error));
};

const isRetryableMailError = (error: unknown) => {
    const code = String((error as any)?.code ?? '').toUpperCase();
    const responseCode = Number((error as any)?.responseCode ?? 0);
    if (code === 'EAUTH' || code === 'EENVELOPE') {
        return false;
    }
    if (responseCode >= 400 && responseCode < 500 && ![421, 450, 451, 452].includes(responseCode)) {
        return false;
    }
    return true;
};

const toQueuedEmailRecord = (row: any): QueuedEmailRecord => ({
    id: String(row?.id ?? ''),
    toAddress: String(row?.to_address ?? ''),
    fromAddress: String(row?.from_address ?? ''),
    subject: String(row?.subject ?? ''),
    textBody: String(row?.text_body ?? ''),
    htmlBody: String(row?.html_body ?? ''),
    metadata: row?.metadata && typeof row.metadata === 'object' ? row.metadata : {},
});

const getQueuedEmailAttachments = (record: QueuedEmailRecord) => {
    const attachments = (record.metadata as Record<string, unknown>)?.attachments;
    return Array.isArray(attachments) ? attachments as MailAttachment[] : [];
};

export const canSendEmails = () => {
    return !!appConfig.smtpHost && !!sender;
};

export const smtpSendMail = async (args: MailSendArgs) => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAIL_SEND_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
            const transporter = await getTransporter();
            return await rateLimitEmailSend(args.to, async () => {
                return await transporter.sendMail({
                    from: normalizeHeaderValue(args.from),
                    to: normalizeHeaderValue(args.to),
                    subject: args.subject,
                    text: args.text,
                    html: args.html,
                    attachments: Array.isArray(args.attachments) ? args.attachments : undefined,
                });
            });
        }
        catch (error) {
            const normalizedError = toMailError(error);
            lastError = normalizedError;
            const retryable = isRetryableMailError(error);
            logger.warn('SMTP send attempt failed', {
                to: args.to,
                subject: args.subject,
                attempt: attempt + 1,
                retryable,
                error: serializeError(error),
            });
            if (!retryable || attempt === MAIL_SEND_RETRY_DELAYS_MS.length - 1) {
                resetTransporter();
                throw normalizedError;
            }
            await mailServiceDeps.sleepFn(MAIL_SEND_RETRY_DELAYS_MS[attempt]);
        }
    }
    throw lastError ?? new Error('SMTP delivery failed');
};

export const verifyMailTransporter = async () => {
    if (!canSendEmails()) {
        return false;
    }
    try {
        const transporter = await getTransporter();
        await transporter.verify();
        logger.info('SMTP transporter verified');
        return true;
    }
    catch (error) {
        resetTransporter();
        logger.error('SMTP transporter verification failed', {
            error: serializeError(error),
        });
        return false;
    }
};

export const enqueueEmail = async (args: QueuedEmailInput) => {
    const queueId = randomUUID();
    await mailServiceDeps.queryFn(`insert into email_queue(
       id,
       to_address,
       from_address,
       subject,
       text_body,
       html_body,
       metadata
     )
     values($1::uuid, $2, $3, $4, $5, $6, $7::jsonb)`, [
        queueId,
        args.to,
        args.from,
        args.subject,
        args.text,
        args.html,
        JSON.stringify({
            attachments: Array.isArray(args.attachments) ? args.attachments : [],
            ...(args.metadata ?? {}),
        }),
    ]);
    return queueId;
};

// Alias for backward compatibility
export const sendEmail = enqueueEmail;

export const sendQueuedEmailRecord = async (row: any) => {
    const record = toQueuedEmailRecord(row);
    const resolvedFromAddress = normalizeHeaderValue(record.fromAddress || sender || '');
    if (!resolvedFromAddress) {
        throw new Error('Queued email is missing from_address');
    }
    await smtpSendMail({
        to: record.toAddress,
        from: resolvedFromAddress,
        subject: record.subject,
        text: record.textBody,
        html: record.htmlBody,
        attachments: getQueuedEmailAttachments(record),
    });
    return record;
};

const assertQueueableMailConfig = () => {
    if (!canSendEmails() || !sender) {
        throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email service is not configured');
    }
};

export const sendEmailLoginToken = async (args: { to: string; token: string; expiresInMinutes: number }) => {
    assertQueueableMailConfig();
    try {
        const text = `Ваш код входа: ${args.token}\n\nКод действует ${args.expiresInMinutes} минут.\nЕсли вы не запрашивали вход, проигнорируйте это письмо.`;
        const html = buildHtmlEmail({
            title: 'Код входа',
            preheader: `Ваш код входа: ${args.token}`,
            body: `
              <h2 style="margin:0 0 8px;color:#1E293B;font-size:22px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">Код входа в систему</h2>
              <p style="margin:0 0 28px;color:#475569;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Используйте код ниже для входа в систему Новинжстрой.</p>
              <div style="text-align:center;margin:0 0 28px;">
                <div style="display:inline-block;background:#F8FAFC;border:2px solid #B91C1C;border-radius:12px;padding:24px 48px;">
                  <p style="margin:0 0 6px;color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:2px;font-family:Arial,Helvetica,sans-serif;">Ваш код</p>
                  <p style="margin:0;color:#1E293B;font-size:36px;font-weight:800;letter-spacing:8px;font-family:'Courier New',monospace;">${args.token}</p>
                </div>
              </div>
              <p style="margin:0 0 8px;color:#64748B;font-size:13px;font-family:Arial,Helvetica,sans-serif;text-align:center;">Код действует <strong style="color:#B91C1C;">${args.expiresInMinutes} минут</strong></p>
              <p style="margin:16px 0 0;color:#94A3B8;font-size:12px;font-family:Arial,Helvetica,sans-serif;text-align:center;">Если вы не запрашивали вход — просто проигнорируйте это письмо.</p>
            `,
        });
        await enqueueEmail({
            to: args.to,
            from: sender!,
            subject: 'Код входа — Новинжстрой',
            text,
            html,
        });
    }
    catch (error) {
        logger.error('Failed to queue email token', { email: args.to, error: serializeError(error) });
        throw new ApiError(502, 'EMAIL_DELIVERY_FAILED', 'Failed to deliver email token');
    }
};

export const sendInviteToken = async (args: { to: string; token: string; expiresInHours: number }) => {
    assertQueueableMailConfig();
    try {
        const inviteUrl = appConfig.appUrl
            ? `${appConfig.appUrl}/invite-accept?token=${encodeURIComponent(args.token)}`
            : null;
        const safeInviteUrl = inviteUrl ? escapeHtml(inviteUrl) : null;
        const linkBlock = inviteUrl
            ? `<div style="text-align:center;margin:28px 0;">
                 <a href="${safeInviteUrl}" style="display:inline-block;padding:18px 48px;background:#B91C1C;color:#FFFFFF;text-decoration:none;border-radius:8px;font-weight:700;font-family:Arial,Helvetica,sans-serif;font-size:17px;">Принять приглашение</a>
               </div>
               <p style="margin:0;color:#94A3B8;font-size:12px;word-break:break-all;text-align:center;font-family:Arial,Helvetica,sans-serif;">Или скопируйте ссылку: <a href="${safeInviteUrl}" style="color:#B91C1C;">${safeInviteUrl}</a></p>`
            : `<div style="text-align:center;margin:28px 0;">
                 <div style="display:inline-block;background:#F8FAFC;border:2px solid #B91C1C;border-radius:12px;padding:20px 32px;">
                   <p style="margin:0 0 6px;color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:2px;font-family:Arial,Helvetica,sans-serif;">Токен приглашения</p>
                   <p style="margin:0;color:#1E293B;font-size:16px;font-weight:700;font-family:'Courier New',monospace;word-break:break-all;">${escapeHtml(args.token)}</p>
                 </div>
               </div>`;
        const text = inviteUrl
            ? `Вы приглашены в систему Новинжстрой.\n\nПерейдите по ссылке для завершения регистрации:\n${inviteUrl}\n\nСсылка действует ${args.expiresInHours} часов.\nЕсли вы не запрашивали приглашение, проигнорируйте это письмо.`
            : `Вы приглашены в систему Новинжстрой.\n\nВаш токен приглашения: ${args.token}\n\nТокен действует ${args.expiresInHours} часов.\nЕсли вы не запрашивали приглашение, проигнорируйте это письмо.`;
        const html = buildHtmlEmail({
            title: 'Приглашение',
            preheader: 'Вы приглашены в систему Новинжстрой',
            body: `
              <h2 style="margin:0 0 8px;color:#1E293B;font-size:22px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">Вы приглашены!</h2>
              <p style="margin:0 0 8px;color:#475569;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Вас пригласили в систему управления объектами <strong>Новинжстрой</strong>.</p>
              <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-left:4px solid #3B82F6;border-radius:4px 8px 8px 4px;padding:16px 20px;margin:20px 0;font-family:Arial,Helvetica,sans-serif;color:#475569;font-size:14px;line-height:1.7;">
                <strong>Новинжстрой</strong> — система управления техническим обслуживанием объектов безопасности: пожарная сигнализация, оповещение, пожаротушение, видеонаблюдение, СКУД и другие инженерные системы.
              </div>
              ${linkBlock}
              <p style="margin:16px 0 0;color:#64748B;font-size:13px;font-family:Arial,Helvetica,sans-serif;text-align:center;">Ссылка действует <strong style="color:#B91C1C;">${args.expiresInHours} часов</strong></p>
            `,
        });
        await enqueueEmail({
            to: args.to,
            from: sender!,
            subject: 'Приглашение — Новинжстрой',
            text,
            html,
        });
    }
    catch (error) {
        logger.error('Failed to queue invite token', { email: args.to, error: serializeError(error) });
        throw new ApiError(502, 'EMAIL_DELIVERY_FAILED', 'Failed to deliver email token');
    }
};

export const sendApprovalRequiredNotice = async (args: { to: string; userFullName: string; userEmail: string }) => {
    assertQueueableMailConfig();
    try {
        const safeName = escapeHtml(args.userFullName);
        const safeEmail = escapeHtml(args.userEmail);
        const text = `Новый пользователь завершил регистрацию и ожидает подтверждения.\n\nПользователь: ${args.userFullName}\nEmail: ${args.userEmail}\n\nОткройте раздел "Пользователи" -> "Приглашения" и нажмите "Подтвердить".`;
        const html = buildHtmlEmail({
            title: 'Новый пользователь ожидает подтверждения',
            preheader: `${args.userFullName} завершил регистрацию`,
            body: `
              <h2 style="margin:0 0 8px;color:#1E293B;font-size:22px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">Новый пользователь</h2>
              <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Пользователь завершил регистрацию и ожидает подтверждения доступа.</p>
              <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-left:4px solid #3B82F6;border-radius:4px 8px 8px 4px;padding:20px 24px;margin-bottom:24px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td style="padding:6px 0;color:#64748B;font-size:13px;width:80px;font-family:Arial,Helvetica,sans-serif;">Имя</td>
                    <td style="padding:6px 0;color:#1E293B;font-size:15px;font-weight:600;font-family:Arial,Helvetica,sans-serif;">${safeName}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#64748B;font-size:13px;font-family:Arial,Helvetica,sans-serif;">Email</td>
                    <td style="padding:6px 0;color:#1E293B;font-size:15px;font-family:Arial,Helvetica,sans-serif;">${safeEmail}</td>
                  </tr>
                </table>
              </div>
              <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Перейдите в раздел <strong>Пользователи / Приглашения</strong> и нажмите <strong>Подтвердить</strong>.</p>
            `,
        });
        await enqueueEmail({
            to: args.to,
            from: sender!,
            subject: 'Новый пользователь ожидает подтверждения — Новинжстрой',
            text,
            html,
        });
    }
    catch (error) {
        logger.error('Failed to queue approval required notice', { email: args.to, error: serializeError(error) });
        throw new ApiError(502, 'EMAIL_DELIVERY_FAILED', 'Failed to deliver email token');
    }
};

export const sendSystemEventNotice = async (args: { to: string; subject: string; body: string }) => {
    assertQueueableMailConfig();
    try {
        // Sanitize subject to prevent email header injection (CRLF)
        const sanitizedSubject = normalizeHeaderValue(args.subject);
        const safeSubject = escapeHtml(sanitizedSubject);
        const html = buildHtmlEmail({
            title: sanitizedSubject,
            preheader: sanitizedSubject,
            body: `
              <h2 style="margin:0 0 16px;color:#1E293B;font-size:20px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">${safeSubject}</h2>
              <div style="color:#475569;font-size:15px;line-height:1.7;white-space:pre-line;font-family:Arial,Helvetica,sans-serif;">${args.body.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
            `,
        });
        await enqueueEmail({
            to: args.to,
            from: sender!,
            subject: sanitizedSubject,
            text: args.body,
            html,
        });
    }
    catch (error) {
        logger.error('Failed to queue system event notice', { email: args.to, error: serializeError(error) });
        throw new ApiError(502, 'EMAIL_DELIVERY_FAILED', 'Failed to deliver system event notice');
    }
};

export const sendPasswordChangedNotice = async (args: { to: string; toName?: string }) => {
    if (!canSendEmails() || !sender) {
        return;
    }
    try {
        const name = args.toName || args.to;
        const safeName = escapeHtml(name);
        const text = `Здравствуйте, ${name}!\n\nПароль вашего аккаунта в системе Новинжстрой был успешно изменён.\n\nЕсли вы не меняли пароль — немедленно свяжитесь с администратором.`;
        const html = buildHtmlEmail({
            title: 'Пароль изменён',
            preheader: 'Пароль вашего аккаунта был изменён',
            body: `
              <h2 style="margin:0 0 8px;color:#1E293B;font-size:22px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">Пароль изменён</h2>
              <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Здравствуйте, <strong>${safeName}</strong>!</p>
              <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Пароль вашего аккаунта в системе <strong>Новинжстрой</strong> был успешно изменён.</p>
              <div style="background:#FEF2F2;border:1px solid #FECACA;border-left:4px solid #DC2626;border-radius:4px 8px 8px 4px;padding:18px 20px;margin-bottom:20px;">
                <p style="margin:0;color:#991B1B;font-size:14px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Если вы не меняли пароль — немедленно свяжитесь с администратором системы.</p>
              </div>
            `,
        });
        await enqueueEmail({
            to: args.to,
            from: sender,
            subject: 'Пароль изменён — Новинжстрой',
            text,
            html,
        });
    }
    catch (error) {
        logger.warn('Failed to queue password changed notice', { email: args.to, error: serializeError(error) });
    }
};

export const __mailServiceTestUtils = {
    reset() {
        transporterPromise = null;
        mailServiceDeps.loadMailer = loadMailer;
        mailServiceDeps.queryFn = dbQuery;
        mailServiceDeps.sleepFn = sleep;
        __emailRateLimiterTestUtils.reset();
    },
    setDeps(overrides: Partial<MailServiceDeps>) {
        Object.assign(mailServiceDeps, overrides ?? {});
        transporterPromise = null;
    },
    toQueuedEmailRecord,
};
