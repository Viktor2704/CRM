import path from 'node:path';
import { loadBackendEnv } from './env.js';

loadBackendEnv();
const toInt = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};
const toFloat = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};
const toCsvList = (value) => {
    if (!value)
        return [];
    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
};
const toBool = (value, fallback) => {
    if (value === undefined)
        return fallback;
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    return fallback;
};
const toSameSite = (value, fallback) => {
    if (value === 'lax' || value === 'strict' || value === 'none') {
        return value;
    }
    return fallback;
};
const toLogLevel = (value, fallback) => {
    if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
        return value;
    }
    return fallback;
};
const toStorageProvider = (value) => {
    if (!value || value === 'local')
        return 'local';
    throw new Error(`Unsupported FILE_STORAGE_PROVIDER: ${value}`);
};
const toUploadMimeList = (value) => {
    if (!value) {
        return [
            'image/*',
            'video/*',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/plain',
        ];
    }
    return value
        .split(',')
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
};
const corsOrigins = toCsvList(process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN ?? 'http://localhost:5173');
export const appConfig = {
    serviceName: process.env.SERVICE_NAME ?? 'novinzhstroy-backend',
    logLevel: toLogLevel(process.env.LOG_LEVEL, 'info'),
    alertLogFile: (process.env.ALERT_LOG_FILE ?? '').trim(),
    alertWebhookUrl: process.env.ALERT_WEBHOOK_URL ?? '',
    alertCooldownSeconds: toInt(process.env.ALERT_COOLDOWN_SECONDS, 300),
    alertTelegramChatIds: toCsvList(process.env.ALERT_TELEGRAM_CHAT_IDS),
    host: (process.env.HOST ?? '127.0.0.1').trim() || '127.0.0.1',
    port: toInt(process.env.PORT, 8080),
    databaseUrl: process.env.DATABASE_URL ?? '',
    projectsDatabaseUrl: process.env.PROJECTS_DATABASE_URL ?? process.env.PROJECT_DATABASE_URL ?? '',
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessTokenTtlSeconds: toInt(process.env.ACCESS_TOKEN_TTL_SECONDS, 900),
    refreshTokenTtlDays: toInt(process.env.REFRESH_TOKEN_TTL_DAYS, 30),
    refreshCookieName: process.env.REFRESH_COOKIE_NAME ?? 'refresh_token',
    csrfCookieName: process.env.CSRF_COOKIE_NAME ?? 'csrf_token',
    csrfHeaderName: (process.env.CSRF_HEADER_NAME ?? 'x-csrf-token').toLowerCase(),
    csrfProtectionEnabled: toBool(process.env.CSRF_PROTECTION_ENABLED, true),
    cookieSameSite: toSameSite(process.env.COOKIE_SAME_SITE, 'lax'),
    cookieSecure: toBool(process.env.COOKIE_SECURE, true),
    trustProxy: toBool(process.env.TRUST_PROXY, false),
    corsOrigins,
    inviteTtlHours: toInt(process.env.INVITE_TTL_HOURS, 72),
    passwordResetTtlHours: toInt(process.env.PASSWORD_RESET_TTL_HOURS, 1),
    loginLockThreshold: toInt(process.env.LOGIN_LOCK_THRESHOLD, 5),
    loginLockMinutes: toInt(process.env.LOGIN_LOCK_MINUTES, 15),
    loginRateLimitWindowMinutes: toInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES, 10),
    loginRateLimitMaxAttempts: toInt(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 20),
    authPasswordLoginEnabled: toBool(process.env.AUTH_PASSWORD_LOGIN_ENABLED, true),
    authEmailLoginEnabled: toBool(process.env.AUTH_EMAIL_LOGIN_ENABLED, true),
    emailLoginTokenTtlMinutes: toInt(process.env.EMAIL_LOGIN_TOKEN_TTL_MINUTES, 15),
    smtpHost: process.env.SMTP_HOST ?? '',
    smtpPort: toInt(process.env.SMTP_PORT, 587),
    smtpSecure: toBool(process.env.SMTP_SECURE, false),
    smtpUser: process.env.SMTP_USER ?? '',
    smtpPass: process.env.SMTP_PASS ?? '',
    smtpFrom: process.env.SMTP_FROM ?? '',
    emailRateLimitMaxConcurrent: toInt(process.env.EMAIL_RATE_LIMIT_MAX_CONCURRENT, 5),
    emailRateLimitMinTimeMs: toInt(process.env.EMAIL_RATE_LIMIT_MIN_TIME_MS, 200),
    smtpDkimDomainName: process.env.DKIM_DOMAIN_NAME ?? '',
    smtpDkimKeySelector: process.env.DKIM_KEY_SELECTOR ?? '',
    smtpDkimPrivateKey: process.env.DKIM_PRIVATE_KEY ?? '',
    appUrl: (process.env.APP_URL ?? '').replace(/\/$/, ''),
    mchsRegistryLookupUrl: (process.env.MCHS_REGISTRY_LOOKUP_URL ?? '').trim(),
    mchsRegistryLookupTimeoutMs: toInt(process.env.MCHS_REGISTRY_LOOKUP_TIMEOUT_MS, 8000),
    metadataDir: (process.env.METADATA_DIR ?? '/var/lib/novinzhstroy/metadata').trim(),
    telegramWebhookUrl: (process.env.TELEGRAM_WEBHOOK_URL ?? '').trim(),
    telegramWebhookSecret: (process.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim(),
    frontendUrl: (process.env.FRONTEND_URL ?? '').replace(/\/$/, ''),
    aiEnabled: toBool(process.env.AI_ENABLED, false),
    aiProvider: (process.env.AI_PROVIDER ?? 'groq').trim().toLowerCase(),
    groqApiKey: process.env.GROQ_API_KEY ?? '',
    groqModel: process.env.GROQ_MODEL ?? 'llama-3.3-70b-instruct',
    groqMaxTokens: toInt(process.env.GROQ_MAX_TOKENS, 1024),
    groqTemperature: toFloat(process.env.GROQ_TEMPERATURE, 0.3),
    arceeApiKey: process.env.ARCEE_API_KEY ?? '',
    arceeModel: process.env.ARCEE_MODEL ?? 'trinity-large-preview',
    arceeMaxTokens: toInt(process.env.ARCEE_MAX_TOKENS, 1024),
    arceeTemperature: toFloat(process.env.ARCEE_TEMPERATURE, 0.3),
    aiProxyUrl: (process.env.AI_PROXY_URL ?? '').trim(),
    groqProxy: (process.env.GROQ_PROXY ?? '').trim(),
    arceeProxy: (process.env.ARCEE_PROXY ?? '').trim(),
    openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
    openrouterModel: process.env.OPENROUTER_MODEL ?? 'google/gemini-2.0-flash-exp:free',
    openrouterMaxTokens: toInt(process.env.OPENROUTER_MAX_TOKENS, 1024),
    openrouterTemperature: toFloat(process.env.OPENROUTER_TEMPERATURE, 0.3),
    openrouterProxy: (process.env.OPENROUTER_PROXY ?? '').trim(),
    aiProxyBearerToken: (process.env.AI_PROXY_BEARER_TOKEN ?? '').trim(),
    telegramBotEnabled: toBool(process.env.TELEGRAM_BOT_ENABLED, false),
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    telegramLinkSecret: process.env.TELEGRAM_LINK_SECRET ?? '',
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME ?? 'NovinzhstroyBot',
    telegramRateLimitGlobalMinTimeMs: toInt(process.env.TELEGRAM_RATE_LIMIT_GLOBAL_MIN_TIME_MS, 34),
    telegramRateLimitPerChatReservoir: toInt(process.env.TELEGRAM_RATE_LIMIT_PER_CHAT_RESERVOIR, 20),
    allowDebugTokens: toBool(process.env.ALLOW_DEBUG_TOKENS, false),
    jsonBodyLimitMb: toInt(process.env.JSON_BODY_LIMIT_MB, 35),
    fileUploadMaxMb: toInt(process.env.FILE_UPLOAD_MAX_MB, 20),
    fileStorageProvider: toStorageProvider(process.env.FILE_STORAGE_PROVIDER),
    fileStorageDir: process.env.FILE_STORAGE_DIR ?? path.resolve(process.cwd(), '.data', 'uploads'),
    filePublicBasePath: process.env.FILE_PUBLIC_BASE_PATH && process.env.FILE_PUBLIC_BASE_PATH.startsWith('/')
        ? process.env.FILE_PUBLIC_BASE_PATH
        : '/uploads',
    fileAllowedMimeTypes: toUploadMimeList(process.env.FILE_ALLOWED_MIME_TYPES),
};
export const validateConfig = () => {
    if (!appConfig.databaseUrl) {
        throw new Error('DATABASE_URL is required');
    }
    if (!appConfig.jwtAccessSecret) {
        throw new Error('JWT_ACCESS_SECRET is required');
    }
    if (appConfig.accessTokenTtlSeconds <= 0) {
        throw new Error('ACCESS_TOKEN_TTL_SECONDS must be greater than 0');
    }
    if (appConfig.refreshTokenTtlDays <= 0) {
        throw new Error('REFRESH_TOKEN_TTL_DAYS must be greater than 0');
    }
    if (appConfig.loginLockThreshold <= 0) {
        throw new Error('LOGIN_LOCK_THRESHOLD must be greater than 0');
    }
    if (appConfig.loginLockMinutes <= 0) {
        throw new Error('LOGIN_LOCK_MINUTES must be greater than 0');
    }
    if (appConfig.loginRateLimitWindowMinutes <= 0) {
        throw new Error('LOGIN_RATE_LIMIT_WINDOW_MINUTES must be greater than 0');
    }
    if (appConfig.loginRateLimitMaxAttempts <= 0) {
        throw new Error('LOGIN_RATE_LIMIT_MAX_ATTEMPTS must be greater than 0');
    }
    if (!appConfig.authPasswordLoginEnabled && !appConfig.authEmailLoginEnabled) {
        throw new Error('At least one auth method must be enabled');
    }
    if (appConfig.emailLoginTokenTtlMinutes <= 0) {
        throw new Error('EMAIL_LOGIN_TOKEN_TTL_MINUTES must be greater than 0');
    }
    if (appConfig.smtpPort <= 0) {
        throw new Error('SMTP_PORT must be greater than 0');
    }
    if (appConfig.emailRateLimitMaxConcurrent <= 0) {
        throw new Error('EMAIL_RATE_LIMIT_MAX_CONCURRENT must be greater than 0');
    }
    if (appConfig.emailRateLimitMinTimeMs <= 0) {
        throw new Error('EMAIL_RATE_LIMIT_MIN_TIME_MS must be greater than 0');
    }
    if (appConfig.telegramRateLimitGlobalMinTimeMs <= 0) {
        throw new Error('TELEGRAM_RATE_LIMIT_GLOBAL_MIN_TIME_MS must be greater than 0');
    }
    if (appConfig.telegramRateLimitPerChatReservoir <= 0) {
        throw new Error('TELEGRAM_RATE_LIMIT_PER_CHAT_RESERVOIR must be greater than 0');
    }
    if (appConfig.aiProvider && appConfig.aiProvider !== 'groq' && appConfig.aiProvider !== 'arcee' && appConfig.aiProvider !== 'openrouter') {
        throw new Error('AI_PROVIDER must be "groq", "arcee" or "openrouter"');
    }
    if (appConfig.groqMaxTokens <= 0) {
        throw new Error('GROQ_MAX_TOKENS must be greater than 0');
    }
    if (appConfig.groqTemperature < 0 || appConfig.groqTemperature > 2) {
        throw new Error('GROQ_TEMPERATURE must be between 0 and 2');
    }
    if (appConfig.arceeMaxTokens <= 0) {
        throw new Error('ARCEE_MAX_TOKENS must be greater than 0');
    }
    if (appConfig.arceeTemperature < 0 || appConfig.arceeTemperature > 2) {
        throw new Error('ARCEE_TEMPERATURE must be between 0 and 2');
    }
    for (const proxyUrl of [appConfig.aiProxyUrl, appConfig.groqProxy, appConfig.arceeProxy]) {
        if (!proxyUrl) {
            continue;
        }
        try {
            new URL(proxyUrl);
        }
        catch (_) {
            throw new Error(`Invalid AI proxy URL: ${proxyUrl}`);
        }
    }
    if (appConfig.telegramBotEnabled && !appConfig.telegramBotToken) {
        throw new Error('TELEGRAM_BOT_TOKEN is required when TELEGRAM_BOT_ENABLED=true');
    }
    if (appConfig.alertTelegramChatIds.length > 0 && !appConfig.telegramBotToken) {
        throw new Error('TELEGRAM_BOT_TOKEN is required when ALERT_TELEGRAM_CHAT_IDS is set');
    }
    if (appConfig.corsOrigins.length === 0) {
        throw new Error('CORS_ORIGINS must contain at least one origin');
    }
    if (appConfig.cookieSameSite === 'none' && !appConfig.cookieSecure) {
        throw new Error('COOKIE_SECURE must be true when COOKIE_SAME_SITE=none');
    }
    if (appConfig.alertCooldownSeconds <= 0) {
        throw new Error('ALERT_COOLDOWN_SECONDS must be greater than 0');
    }
    if (appConfig.jsonBodyLimitMb <= 0) {
        throw new Error('JSON_BODY_LIMIT_MB must be greater than 0');
    }
    if (appConfig.fileUploadMaxMb <= 0) {
        throw new Error('FILE_UPLOAD_MAX_MB must be greater than 0');
    }
    const minimumJsonLimit = Math.ceil(appConfig.fileUploadMaxMb * 1.4);
    if (appConfig.jsonBodyLimitMb < minimumJsonLimit) {
        throw new Error(`JSON_BODY_LIMIT_MB must be at least ${minimumJsonLimit} for FILE_UPLOAD_MAX_MB=${appConfig.fileUploadMaxMb}`);
    }
    if (!appConfig.filePublicBasePath.startsWith('/')) {
        throw new Error('FILE_PUBLIC_BASE_PATH must start with "/"');
    }
    if (appConfig.fileAllowedMimeTypes.length === 0) {
        throw new Error('FILE_ALLOWED_MIME_TYPES must contain at least one MIME rule');
    }
    if (appConfig.mchsRegistryLookupTimeoutMs <= 0) {
        throw new Error('MCHS_REGISTRY_LOOKUP_TIMEOUT_MS must be greater than 0');
    }
};
