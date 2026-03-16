import { appendFile } from 'node:fs/promises';
import { appConfig } from './config.js';
import { escapeHtml } from './helpers/normalize.js';
import { logger, serializeError } from './logger.js';

export type AlertInput = {
    type: string;
    severity: string;
    message: string;
    dedupeKey?: string;
    context?: Record<string, unknown>;
};

type AlertPayload = {
    timestamp: string;
    service: string;
    type: string;
    severity: string;
    message: string;
    context: Record<string, unknown>;
};

type AlertConfig = Pick<typeof appConfig, 'serviceName' | 'alertLogFile' | 'alertWebhookUrl' | 'alertCooldownSeconds' | 'alertTelegramChatIds' | 'telegramBotToken'>;
type AlertFetchResponse = {
    ok: boolean;
    status: number;
    statusText: string;
};
type AlertFetch = (url: string, init: RequestInit) => Promise<AlertFetchResponse>;
type AlertDependencies = {
    fetchImpl?: AlertFetch;
    dedupeState?: Map<string, number>;
};

const lastSentByKey = new Map<string, number>();

const shouldSkipByCooldown = (dedupeState: Map<string, number>, key: string, cooldownSeconds: number) => {
    const cooldownMs = cooldownSeconds * 1000;
    const now = Date.now();
    const previous = dedupeState.get(key) ?? 0;
    if (now - previous < cooldownMs) {
        return true;
    }
    dedupeState.set(key, now);
    return false;
};

const buildAlertPayload = (config: AlertConfig, input: AlertInput): AlertPayload => ({
    timestamp: new Date().toISOString(),
    service: config.serviceName,
    type: input.type,
    severity: input.severity,
    message: input.message,
    context: input.context ?? {},
});

const buildTelegramAlertMessage = (payload: AlertPayload) => {
    const contextText = JSON.stringify(payload.context ?? {});
    const trimmedContext = contextText && contextText !== '{}'
        ? contextText.slice(0, 1200)
        : '';
    const lines = [
        '🚨 <b>Novinzhstroy Alert</b>',
        '',
        `<b>Service:</b> ${escapeHtml(payload.service)}`,
        `<b>Severity:</b> ${escapeHtml(payload.severity.toUpperCase())}`,
        `<b>Type:</b> ${escapeHtml(payload.type)}`,
        `<b>Message:</b> ${escapeHtml(payload.message)}`,
        `<b>Time:</b> ${escapeHtml(payload.timestamp)}`,
    ];
    if (trimmedContext) {
        lines.push(`<b>Context:</b> <code>${escapeHtml(trimmedContext)}</code>`);
    }
    return lines.join('\n');
};

const sendWebhookAlert = async (config: AlertConfig, payload: AlertPayload, fetchImpl: AlertFetch) => {
    if (!config.alertWebhookUrl) {
        return;
    }
    try {
        const response = await fetchImpl(config.alertWebhookUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            logger.error('Alert webhook request failed', {
                status: response.status,
                statusText: response.statusText,
                type: payload.type,
            });
        }
    }
    catch (error) {
        logger.error('Alert webhook transport error', {
            type: payload.type,
            error: serializeError(error),
        });
    }
};

const appendAlertLog = async (config: AlertConfig, payload: AlertPayload) => {
    if (!config.alertLogFile) {
        return;
    }
    try {
        await appendFile(config.alertLogFile, `${JSON.stringify(payload)}\n`, 'utf8');
    }
    catch (error) {
        logger.error('Alert log write failed', {
            type: payload.type,
            alertLogFile: config.alertLogFile,
            error: serializeError(error),
        });
    }
};

const sendTelegramAlert = async (config: AlertConfig, payload: AlertPayload, fetchImpl: AlertFetch) => {
    if (!config.telegramBotToken || config.alertTelegramChatIds.length === 0) {
        return;
    }
    const message = buildTelegramAlertMessage(payload);
    await Promise.all(config.alertTelegramChatIds.map(async (chatId) => {
        const chatIdText = String(chatId ?? '').trim();
        if (!chatIdText) {
            return;
        }
        try {
            const response = await fetchImpl(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    chat_id: chatIdText,
                    text: message,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                }),
            });
            if (!response.ok) {
                logger.error('Alert Telegram request failed', {
                    status: response.status,
                    statusText: response.statusText,
                    type: payload.type,
                    chatId: `${chatIdText.slice(0, 2)}***${chatIdText.slice(-2)}`,
                });
            }
        }
        catch (error) {
            logger.error('Alert Telegram transport error', {
                type: payload.type,
                chatId: `${chatIdText.slice(0, 2)}***${chatIdText.slice(-2)}`,
                error: serializeError(error),
            });
        }
    }));
};

export const emitAlertWithConfig = async (config: AlertConfig, input: AlertInput, dependencies: AlertDependencies = {}) => {
    const hasLogTransport = Boolean(config.alertLogFile);
    const hasWebhookTransport = Boolean(config.alertWebhookUrl);
    const hasTelegramTransport = Boolean(config.telegramBotToken) && config.alertTelegramChatIds.length > 0;
    if (!hasLogTransport && !hasWebhookTransport && !hasTelegramTransport) {
        return;
    }
    const payload = buildAlertPayload(config, input);
    await appendAlertLog(config, payload);
    if (!hasWebhookTransport && !hasTelegramTransport) {
        return;
    }
    const dedupeKey = input.dedupeKey ?? `${input.type}:${input.message}`;
    const dedupeState = dependencies.dedupeState ?? lastSentByKey;
    if (shouldSkipByCooldown(dedupeState, dedupeKey, config.alertCooldownSeconds)) {
        return;
    }
    const fetchImpl: AlertFetch = dependencies.fetchImpl ?? ((url, init) => fetch(url, init));
    await Promise.all([
        sendWebhookAlert(config, payload, fetchImpl),
        sendTelegramAlert(config, payload, fetchImpl),
    ]);
};

export const emitAlert = async (input: AlertInput) => emitAlertWithConfig(appConfig, input);
