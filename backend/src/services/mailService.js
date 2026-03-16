import net from 'node:net';
import tls from 'node:tls';
import { once } from 'node:events';
import { appConfig } from '../config.js';
import { ApiError } from '../errors.js';
import { logger, serializeError } from '../logger.js';
import { wrapEmailHtml } from '../helpers/emailTemplates.js';
export const sender = appConfig.smtpFrom || appConfig.smtpUser;
const openSocket = async () => {
    if (appConfig.smtpSecure) {
        const socket = tls.connect({
            host: appConfig.smtpHost,
            port: appConfig.smtpPort,
            servername: appConfig.smtpHost,
        });
        await once(socket, 'secureConnect');
        socket.setEncoding('utf8');
        return socket;
    }
    const socket = net.createConnection({
        host: appConfig.smtpHost,
        port: appConfig.smtpPort,
    });
    await once(socket, 'connect');
    socket.setEncoding('utf8');
    return socket;
};
const createLineReader = (socket) => {
    let buffer = '';
    const queue = [];
    let resolver = null;
    let rejecter = null;
    socket.on('data', chunk => {
        buffer += String(chunk);
        while (true) {
            const idx = buffer.indexOf('\n');
            if (idx < 0)
                break;
            const line = buffer.slice(0, idx).replace(/\r$/, '');
            buffer = buffer.slice(idx + 1);
            if (!line)
                continue;
            if (resolver) {
                const resolve = resolver;
                resolver = null;
                rejecter = null;
                resolve(line);
            }
            else {
                queue.push(line);
            }
        }
    });
    const failPending = (error) => {
        if (rejecter) {
            const reject = rejecter;
            resolver = null;
            rejecter = null;
            reject(error);
        }
    };
    socket.on('error', error => {
        failPending(error instanceof Error ? error : new Error(String(error)));
    });
    socket.on('close', () => {
        failPending(new Error('SMTP socket closed'));
    });
    return {
        readLine: () => {
            if (queue.length > 0) {
                return Promise.resolve(queue.shift());
            }
            return new Promise((resolve, reject) => {
                resolver = resolve;
                rejecter = reject;
            });
        },
    };
};
const readResponse = async (readLine) => {
    const lines = [];
    while (true) {
        const line = await readLine();
        lines.push(line);
        if (/^\d{3} /.test(line)) {
            return {
                code: Number(line.slice(0, 3)),
                lines,
            };
        }
    }
};
const writeLine = (socket, line) => {
    return new Promise((resolve, reject) => {
        socket.write(`${line}\r\n`, error => {
            if (error) {
                reject(error);
                return;
            }
            resolve(undefined);
        });
    });
};
const sendCommand = async (args) => {
    await writeLine(args.socket, args.command);
    const response = await readResponse(args.readLine);
    if (!args.expectedCodes.includes(response.code)) {
        throw new Error(`SMTP command failed: ${args.command}; response: ${response.lines.join(' | ')}`);
    }
};
const normalizeHeaderValue = (value) => value.replace(/[\r\n]+/g, ' ').trim();
const encodeSubjectUtf8 = (value) => {
    return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
};
const buildHtmlEmail = (args) => {
    return wrapEmailHtml(args.body, { preheader: args.preheader });
};
const buildMessage = (args) => {
    const boundary = `boundary_${Date.now().toString(36)}`;
    const headers = [
        `From: ${normalizeHeaderValue(args.from)}`,
        `To: ${normalizeHeaderValue(args.to)}`,
        `Subject: ${encodeSubjectUtf8(args.subject)}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ];
    const textPart = args.text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map(line => (line.startsWith('.') ? `.${line}` : line))
        .join('\r\n');
    const htmlPart = args.html
        .split('\n')
        .map(line => (line.startsWith('.') ? `.${line}` : line))
        .join('\r\n');
    const body = [
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        textPart,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        htmlPart,
        '',
        `--${boundary}--`,
    ].join('\r\n');
    return `${headers.join('\r\n')}\r\n\r\n${body}`;
};
export const smtpSendMail = async (args) => {
    const SMTP_TIMEOUT_MS = 30000;
    const socket = await openSocket();
    socket.setTimeout(SMTP_TIMEOUT_MS);
    socket.on('timeout', () => { socket.destroy(new Error('SMTP socket timeout')); });
    const { readLine } = createLineReader(socket);
    try {
        const greeting = await readResponse(readLine);
        if (greeting.code !== 220) {
            throw new Error(`SMTP greeting failed: ${greeting.lines.join(' | ')}`);
        }
        await sendCommand({
            socket,
            readLine,
            command: `EHLO ${appConfig.serviceName}`,
            expectedCodes: [250],
        });
        if (appConfig.smtpUser) {
            await sendCommand({ socket, readLine, command: 'AUTH LOGIN', expectedCodes: [334] });
            await sendCommand({
                socket,
                readLine,
                command: Buffer.from(appConfig.smtpUser, 'utf8').toString('base64'),
                expectedCodes: [334],
            });
            await sendCommand({
                socket,
                readLine,
                command: Buffer.from(appConfig.smtpPass, 'utf8').toString('base64'),
                expectedCodes: [235],
            });
        }
        await sendCommand({
            socket,
            readLine,
            command: `MAIL FROM:<${normalizeHeaderValue(args.from)}>`,
            expectedCodes: [250],
        });
        await sendCommand({
            socket,
            readLine,
            command: `RCPT TO:<${normalizeHeaderValue(args.to)}>`,
            expectedCodes: [250, 251],
        });
        await sendCommand({
            socket,
            readLine,
            command: 'DATA',
            expectedCodes: [354],
        });
        const message = buildMessage({
            from: args.from,
            to: args.to,
            subject: args.subject,
            text: args.text,
            html: args.html,
        });
        await new Promise((resolve, reject) => {
            socket.write(`${message}\r\n.\r\n`, error => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(undefined);
            });
        });
        const sentResponse = await readResponse(readLine);
        if (sentResponse.code !== 250) {
            throw new Error(`SMTP DATA failed: ${sentResponse.lines.join(' | ')}`);
        }
        await sendCommand({
            socket,
            readLine,
            command: 'QUIT',
            expectedCodes: [221],
        });
    }
    finally {
        socket.destroy();
    }
};
export const canSendEmails = () => {
    return !!appConfig.smtpHost && !!sender;
};
export const sendEmailLoginToken = async (args) => {
    if (!canSendEmails() || !sender) {
        throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email service is not configured');
    }
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
        await smtpSendMail({ to: args.to, from: sender, subject: 'Код входа — Новинжстрой', text, html });
    }
    catch (error) {
        logger.error('Failed to send email token', { email: args.to, error: serializeError(error) });
        throw new ApiError(502, 'EMAIL_DELIVERY_FAILED', 'Failed to deliver email token');
    }
};
export const sendInviteToken = async (args) => {
    if (!canSendEmails() || !sender) {
        throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email service is not configured');
    }
    try {
        const inviteUrl = appConfig.appUrl
            ? `${appConfig.appUrl}/invite-accept?token=${encodeURIComponent(args.token)}`
            : null;
        const linkBlock = inviteUrl
            ? `<div style="text-align:center;margin:28px 0;">
                 <a href="${inviteUrl}" style="display:inline-block;padding:18px 48px;background:#B91C1C;color:#FFFFFF;text-decoration:none;border-radius:8px;font-weight:700;font-family:Arial,Helvetica,sans-serif;font-size:17px;">Принять приглашение</a>
               </div>
               <p style="margin:0;color:#94A3B8;font-size:12px;word-break:break-all;text-align:center;font-family:Arial,Helvetica,sans-serif;">Или скопируйте ссылку: <a href="${inviteUrl}" style="color:#B91C1C;">${inviteUrl}</a></p>`
            : `<div style="text-align:center;margin:28px 0;">
                 <div style="display:inline-block;background:#F8FAFC;border:2px solid #B91C1C;border-radius:12px;padding:20px 32px;">
                   <p style="margin:0 0 6px;color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:2px;font-family:Arial,Helvetica,sans-serif;">Токен приглашения</p>
                   <p style="margin:0;color:#1E293B;font-size:16px;font-weight:700;font-family:'Courier New',monospace;word-break:break-all;">${args.token}</p>
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
        await smtpSendMail({ to: args.to, from: sender, subject: 'Приглашение — Новинжстрой', text, html });
    }
    catch (error) {
        logger.error('Failed to send invite token', { email: args.to, error: serializeError(error) });
        throw new ApiError(502, 'EMAIL_DELIVERY_FAILED', 'Failed to deliver email token');
    }
};
export const sendApprovalRequiredNotice = async (args) => {
    if (!canSendEmails() || !sender) {
        throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email service is not configured');
    }
    try {
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
                    <td style="padding:6px 0;color:#1E293B;font-size:15px;font-weight:600;font-family:Arial,Helvetica,sans-serif;">${args.userFullName}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#64748B;font-size:13px;font-family:Arial,Helvetica,sans-serif;">Email</td>
                    <td style="padding:6px 0;color:#1E293B;font-size:15px;font-family:Arial,Helvetica,sans-serif;">${args.userEmail}</td>
                  </tr>
                </table>
              </div>
              <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Перейдите в раздел <strong>Пользователи / Приглашения</strong> и нажмите <strong>Подтвердить</strong>.</p>
            `,
        });
        await smtpSendMail({ to: args.to, from: sender, subject: 'Новый пользователь ожидает подтверждения — Новинжстрой', text, html });
    }
    catch (error) {
        logger.error('Failed to send approval required notice', { email: args.to, error: serializeError(error) });
        throw new ApiError(502, 'EMAIL_DELIVERY_FAILED', 'Failed to deliver email token');
    }
};
export const sendSystemEventNotice = async (args) => {
    if (!canSendEmails() || !sender) {
        throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email service is not configured');
    }
    try {
        const html = buildHtmlEmail({
            title: args.subject,
            preheader: args.subject,
            body: `
              <h2 style="margin:0 0 16px;color:#1E293B;font-size:20px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">${args.subject}</h2>
              <div style="color:#475569;font-size:15px;line-height:1.7;white-space:pre-line;font-family:Arial,Helvetica,sans-serif;">${args.body.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
            `,
        });
        await smtpSendMail({ to: args.to, from: sender, subject: args.subject, text: args.body, html });
    }
    catch (error) {
        logger.error('Failed to send system event notice', { email: args.to, error: serializeError(error) });
        throw new ApiError(502, 'EMAIL_DELIVERY_FAILED', 'Failed to deliver system event notice');
    }
};
export const sendPasswordChangedNotice = async (args) => {
    if (!canSendEmails() || !sender)
        return;
    try {
        const name = args.toName || args.to;
        const text = `Здравствуйте, ${name}!\n\nПароль вашего аккаунта в системе Новинжстрой был успешно изменён.\n\nЕсли вы не меняли пароль — немедленно свяжитесь с администратором.`;
        const html = buildHtmlEmail({
            title: 'Пароль изменён',
            preheader: 'Пароль вашего аккаунта был изменён',
            body: `
              <h2 style="margin:0 0 8px;color:#1E293B;font-size:22px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">Пароль изменён</h2>
              <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Здравствуйте, <strong>${name}</strong>!</p>
              <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Пароль вашего аккаунта в системе <strong>Новинжстрой</strong> был успешно изменён.</p>
              <div style="background:#FEF2F2;border:1px solid #FECACA;border-left:4px solid #DC2626;border-radius:4px 8px 8px 4px;padding:18px 20px;margin-bottom:20px;">
                <p style="margin:0;color:#991B1B;font-size:14px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Если вы не меняли пароль — немедленно свяжитесь с администратором системы.</p>
              </div>
            `,
        });
        await smtpSendMail({ to: args.to, from: sender, subject: 'Пароль изменён — Новинжстрой', text, html });
    }
    catch (error) {
        logger.warn('Failed to send password changed notice', { email: args.to, error: serializeError(error) });
    }
};
