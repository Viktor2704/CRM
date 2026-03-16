import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { appConfig } from './config.js';
import { ApiError, isApiError } from './errors.js';
import { clearCsrfCookie, clearRefreshCookie, getRequestMeta, setCsrfCookie, setRefreshCookie } from './http.js';
import { createOpaqueToken, hashPassword, verifyAccessToken } from './security.js';
import { acceptInvite, bootstrapFirstAdmin, buildInitialBindings, confirmPasswordReset, loginByEmailToken, loginByPassword, logoutSession, requestEmailLoginToken, refreshSession, requestPasswordReset, sendInvite, } from './services/authService.js';
import { createUser, deleteUser, getUserById, listUserAudit, listUsers, updateUser } from './services/userService.js';
import { storeFile } from './services/fileStorage.js';
import { checkDatabaseReady, dbQuery, hasProjectScopeDatabase, withTx } from './db.js';
import { emitAlert } from './alerts.js';
import { logger, serializeError } from './logger.js';
import { canSendEmails, sendSystemEventNotice } from './services/mailService.js';
import { sendTicketClientNotification, startTicketClientDigestScheduler } from './services/ticketClientNotifications.js';
import { callLLM, callLLMWithFallback } from './services/aiService.js';
import { getTelegramBotUsername, startTelegramBot } from './services/telegramBot.js';
import { pushTelegramNotification } from './services/telegramNotifier.js';
import { subscribeUserAuditEvent } from './services/userAuditEvents.js';
import { requireAdminLike, requireAuth, requireTenantPageAccess, requireUserPageAccess } from './middleware/auth.js';
import { acceptInviteSchema, auditQuerySchema, bootstrapAdminSchema, bulkUpsertTenantsSchema, createTenantSchema, createUserSchema, emailLoginConfirmSchema, emailLoginRequestSchema, listUsersQuerySchema, loginSchema, parseUuidPath, passwordResetConfirmSchema, passwordResetRequestSchema, sendInviteSchema, ticketClientEventSchema, updateUserSchema, } from './validators.js';
import { asyncHandler } from './helpers/asyncHandler.js';
import { hasAnyText, isEmailValue, isUuidValue, normalizeText } from './helpers/normalize.js';
import { ensureProjectSchema } from './schemas/projectSchema.js';
import { ensureMaintenanceSchema } from './schemas/maintenanceSchema.js';
import { ensureServiceRequestSchema } from './schemas/serviceRequestSchema.js';
import { ensureDirectionSchema } from './schemas/directionSchema.js';
import { ensureMaintenanceItemSchema } from './schemas/maintenanceItemSchema.js';
import { ensureNotificationSchema, ensureTelegramSchema } from './schemas/notificationSchema.js';
import { ensureAiFeedbackSchema } from './schemas/aiFeedbackSchema.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerFileRoutes } from './routes/files.js';
import { registerAuthRoutes, registerMockAuthRoutes } from './routes/auth.js';
import { registerMockTenantRoutes, registerTenantRoutes } from './routes/tenants.js';
import { registerMockContractRoutes, registerContractRoutes } from './routes/contracts.js';
import { registerMockUserAuditRoutes, registerMockUsersRoutes, registerUsersRoutes } from './routes/users.js';
import { registerMockInstallationRoutes, registerInstallationRoutes } from './routes/installations.js';
import { registerInstallationExtensionRoutes } from './routes/installationExtensions.js';
import { ensureInstallationExtendedSchema } from './schemas/installationSchema.js';
import { installationStageSet, installationStageLabelMap, installationStageTransitionMap, installationDeadlineStageSet, installationCancelReasonSet, normalizeInstallationStage, assertInstallationStageTransition, normalizeProcurementItemStatus, resolveInstallationNotificationEventType, buildProcurementSummary, installationStageUpdateSchema, installationStageDeadlinesUpdateSchema, procurementItemCreateSchema, procurementItemUpdateSchema, chatMessagePinSchema, mapProcurementItemRow as mapProcurementItemRowHelper, mapStageDeadlineRow as mapStageDeadlineRowHelper, } from './helpers/installationHelpers.js';
import { installationProcurementRoles, installationStageEditRoles, installationDeadlineEditRoles } from './helpers/roles.js';
import { registerMockProjectRoutes, registerProjectRoutes } from './routes/projects.js';
import { registerMockServiceRequestRoutes, registerServiceRequestRoutes } from './routes/serviceRequests.js';
import { registerMockMaintenancePlanRoutes, registerMaintenancePlanRoutes } from './routes/maintenancePlans.js';
import { registerMockDirectionRoutes, registerDirectionRoutes } from './routes/directions.js';
import { registerMockMaintenanceItemRoutes, registerMaintenanceItemRoutes } from './routes/maintenanceItems.js';
import { registerMockCheckinRoutes, registerCheckinRoutes } from './routes/checkins.js';
import { registerMockCalendarRoutes, registerCalendarRoutes } from './routes/calendar.js';
import { registerMockNotificationRoutes, registerNotificationRoutes } from './routes/notifications.js';
import { registerMockTelegramRoutes, registerTelegramRoutes } from './routes/telegram.js';
import { registerMockAiRoutes, registerAiRoutes } from './routes/ai.js';
import { registerAccessRequestRoutes } from './routes/accessRequests.js';
import { serviceRequestTypes, aiSimilarityValues, aiSystemTypeValues, parseAiJson, normalizeAiSystemType, buildAiSuggestionResponse, emptyAiSuggestionResponse, aiRequestSuggestSystemPrompt, aiChatSummarySystemPrompt, aiNotificationSummarySystemPrompt, aiSimilarRequestSystemPrompt, aiExpandSearchSystemPrompt, aiChatSystemPrompt } from './helpers/aiConstants.js';
import { parseDataUrlPayload, buildFileUrl } from './helpers/fileHelpers.js';
import { sendServiceRequestEmail, sendMaintenancePlanEmail } from './helpers/emailTemplates.js';
import { generateIcsEvent, wrapIcsCalendar, sendIcsResponse } from './helpers/icsHelpers.js';
import { mapProjectRow, mapMaintenancePlanRow, mapGenerationRunRow, mapServiceRequestRow, mapDirectionRow, mapMaintenanceItemRow, mapNotificationRow, mapProjectEventRow, mapProjectChatMessageRow } from './helpers/mappers.js';
import { localMockAuthEnabled, localMockUsers, localMockUsersByEmail, localMockRefreshTokens, localMockTenants, localMockDirections, localMockMaintenanceItems, localMockStaffRoles, localMockClientRoles, toLocalMockApiUser, createLocalMockSession } from './helpers/mockData.js';
import { projectSortFieldMap, projectStageLabelMap, projectSelectColumnsSql, projectCreateSchema, projectStatusUpdateSchema, projectUpdateSchema, projectDeadlineUpdateSchema, projectStageUpdateSchema, projectTzUpdateSchema, projectFilesUpdateSchema, projectChatMessageCreateSchema, escapeLikePattern, normalizeProjectStatus, normalizeProjectStage, resolveCurrentProjectStage, assertProjectStageTransition, normalizeChatVisibility, normalizeSearchQuery, parsePositiveInt, parseDateTimeFilter, parseDateOnlyValue, parseStatusQueryFilter, normalizeProjectFiles, resolveProjectNotificationEventType, appendProjectScopeCondition } from './helpers/projectHelpers.js';
import { allowedTicketNotifierRoles, projectEventRequireComment, projectEventRequireQuestions, projectEventRequireResolution, projectAdminRoles, projectOpsRoles, projectClientRoles, projectCreateRoles, projectUpdateRoles, projectDeleteRoles, maintenancePlanManageRoles, projectDeadlineEditRoles, projectStageEditRoles, projectTzEditRoles, projectFilesEditRoles, projectChatWriteRoles, serviceRequestManageRoles, serviceRequestViewRoles, directionManageRoles, directionViewRoles, maintenanceItemManageRoles, maintenanceItemViewRoles } from './helpers/roles.js';
import { normalizeTenantContacts, mapTenantRow, sendTenantEventNotification } from './helpers/tenantHelpers.js';
import { resolveProjectIdFromNotificationPayload, resolveRecipientForNotification, validateProjectEventPayload, ensureInstallationProjectExists, ensureActorHasProjectAccess } from './services/notificationAccessService.js';
import { dispatchServiceRequestCreationNotifications, pushInAppNotification, getAdminManagerIds, pushProjectInAppNotification } from './services/notificationService.js';
import { sendProjectNotificationBestEffort, insertProjectEventTx, insertProjectTzRevisionTx, getProjectByIdForActorTx, getInstallationByIdForActorTx } from './services/projectNotificationService.js';
import { startEscalationScheduler, startWeeklyDigestScheduler, startDeadlineScheduler, startPprAutoGenerationScheduler, startTokenCleanupScheduler } from './services/schedulers.js';
const isAllowedOrigin = (origin) => {
    if (!origin)
        return true;
    return appConfig.corsOrigins.includes(origin);
};
const requireCsrfToken = (request, _response, next) => {
    if (!appConfig.csrfProtectionEnabled) {
        next();
        return;
    }
    const csrfCookieToken = request.cookies?.[appConfig.csrfCookieName];
    const csrfHeaderToken = request.get(appConfig.csrfHeaderName) ?? request.get(appConfig.csrfHeaderName.toUpperCase());
    if (!csrfCookieToken || !csrfHeaderToken || csrfCookieToken !== csrfHeaderToken) {
        throw new ApiError(403, 'CSRF_TOKEN_INVALID', 'CSRF token is missing or invalid');
    }
    const origin = request.get('origin') ?? undefined;
    if (!isAllowedOrigin(origin)) {
        throw new ApiError(403, 'CSRF_ORIGIN_DENIED', 'Origin is not allowed');
    }
    next();
};
const resolveStreamAuthUser = (request) => {
    const authHeader = request.get('authorization');
    const queryToken = typeof request.query?.accessToken === 'string' ? request.query.accessToken.trim() : '';
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
    const token = headerToken || queryToken;
    if (!token) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Bearer token is required');
    }
    try {
        const payload = verifyAccessToken(token);
        if (payload.role !== 'admin' && payload.role !== 'manager') {
            throw new ApiError(403, 'FORBIDDEN', 'Admin or manager role is required');
        }
        return { id: payload.sub, role: payload.role };
    }
    catch (error) {
        if (isApiError(error)) {
            throw error;
        }
        throw new ApiError(401, 'UNAUTHORIZED', 'Invalid access token');
    }
};
const projectDataLookupMode = hasProjectScopeDatabase ? 'projects_db_then_main_db' : 'main_db_only';
const projectNotificationStrictAccess = ['1', 'true', 'yes', 'on'].includes(String(process.env.PROJECT_NOTIFICATION_STRICT_ACCESS ?? '').trim().toLowerCase());
const app = express();
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        code: 'RATE_LIMITED',
        message: 'Too many requests, try again later',
        status: 429,
    },
});
const publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        code: 'RATE_LIMITED',
        message: 'Too many requests',
        status: 429,
    },
});
const AI_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const AI_RATE_LIMIT_MAX_REQUESTS = 30;
const aiRequestTimestampsByUser = new Map();
// Periodically clean up stale entries from AI rate limiter
setInterval(() => {
    const now = Date.now();
    const oldestAllowed = now - AI_RATE_LIMIT_WINDOW_MS;
    for (const [key, timestamps] of aiRequestTimestampsByUser) {
        const active = timestamps.filter((t) => t > oldestAllowed);
        if (active.length === 0) {
            aiRequestTimestampsByUser.delete(key);
        }
        else {
            aiRequestTimestampsByUser.set(key, active);
        }
    }
}, 5 * 60 * 1000); // every 5 minutes
const aiRateLimitMiddleware = (request, _response, next) => {
    const userId = normalizeText(request.authUser?.id);
    const key = userId || `ip:${normalizeText(request.ip) || 'unknown'}`;
    const now = Date.now();
    const oldestAllowed = now - AI_RATE_LIMIT_WINDOW_MS;
    const existing = aiRequestTimestampsByUser.get(key) ?? [];
    const activeWindow = existing.filter((timestamp) => timestamp > oldestAllowed);
    if (activeWindow.length >= AI_RATE_LIMIT_MAX_REQUESTS) {
        console.warn('[AI_RATE_LIMIT] user exceeded AI rate limit', {
            userId: key,
            path: request.path,
            method: request.method,
            limitPerMinute: AI_RATE_LIMIT_MAX_REQUESTS,
        });
        throw new ApiError(429, 'RATE_LIMITED', 'Too many AI requests, try again later');
    }
    activeWindow.push(now);
    aiRequestTimestampsByUser.set(key, activeWindow);
    next();
};
if (!localMockAuthEnabled) {
    startTicketClientDigestScheduler();
    startEscalationScheduler();
    startDeadlineScheduler();
    startPprAutoGenerationScheduler();
    startTokenCleanupScheduler();
    if ((process.env.NODE_ENV ?? '').toLowerCase() === 'production' && appConfig.aiEnabled) {
        startWeeklyDigestScheduler();
    }
    if (appConfig.telegramBotEnabled) {
        void (async () => {
            await ensureTelegramSchema();
            await startTelegramBot();
            logger.info('Telegram bot started', {
                username: getTelegramBotUsername(),
            });
        })().catch((error) => {
            logger.error('Failed to start Telegram bot', {
                error: serializeError(error),
            });
        });
    }
}
if (appConfig.trustProxy) {
    app.set('trust proxy', 1);
}
app.use(cors({
    origin: (origin, callback) => {
        if (isAllowedOrigin(origin ?? undefined)) {
            callback(null, true);
            return;
        }
        callback(new Error('CORS origin denied'));
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', appConfig.csrfHeaderName],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
}));
app.use((request, response, next) => {
    if (request.method === 'POST' || request.method === 'PATCH' || request.method === 'PUT') {
        const contentType = normalizeText(request.get('content-type')).toLowerCase();
        const contentLengthHeader = normalizeText(request.get('content-length'));
        const transferEncodingHeader = normalizeText(request.get('transfer-encoding'));
        const parsedContentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;
        const hasBody = transferEncodingHeader.length > 0
            || (Number.isFinite(parsedContentLength) ? parsedContentLength > 0 : contentLengthHeader.length > 0);
        if (hasBody
            && !contentType.includes('application/json')
            && !contentType.includes('multipart/form-data')) {
            response.status(415).json({
                code: 'UNSUPPORTED_MEDIA_TYPE',
                message: 'Content-Type must be application/json',
                status: 415,
            });
            return;
        }
    }
    next();
});
app.use(express.json({ limit: `${appConfig.jsonBodyLimitMb}mb` }));
app.use(cookieParser());
app.use(appConfig.filePublicBasePath, express.static(appConfig.fileStorageDir, {
    index: false,
    fallthrough: true,
    dotfiles: 'deny',
}));
app.use((request, response, next) => {
    const requestId = request.get('x-request-id') ?? randomUUID();
    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    next();
});
app.use((request, response, next) => {
    const startedAt = Date.now();
    response.on('finish', () => {
        const durationMs = Date.now() - startedAt;
        const level = response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info';
        logger[level]('HTTP request completed', {
            requestId: request.requestId,
            method: request.method,
            path: request.originalUrl,
            status: response.statusCode,
            durationMs,
            ip: request.ip,
            userId: request.authUser?.id ?? null,
        });
    });
    next();
});
app.use('/ai', requireAuth, aiRateLimitMiddleware);
registerHealthRoutes({
    app,
    appConfig,
    localMockAuthEnabled,
    requireAuth,
    asyncHandler,
    checkDatabaseReady,
    emitAlert,
});
registerFileRoutes({
    app,
    requireAuth,
    asyncHandler,
    ApiError,
    storeFile,
    parseDataUrlPayload,
    buildFileUrl,
});
const toCsvCell = (value) => {
    const text = String(value ?? '');
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
};
if (localMockAuthEnabled) {
    const getLocalMockBodyObject = (body) => (body && typeof body === 'object' ? body : {});
    const localMockNotifications = [];
    const localMockCheckins = [];
    const localMockTelegramLinkTokens = [];
    const localMockTelegramLinks = new Map();
    registerMockAuthRoutes({
        app,
        authLimiter,
        asyncHandler,
        loginSchema,
        localMockUsersByEmail,
        ApiError,
        localMockRefreshTokens,
        localMockUsers,
        createLocalMockSession,
        setRefreshCookie,
        setCsrfCookie,
        createOpaqueToken,
        appConfig,
        clearCsrfCookie,
        clearRefreshCookie,
    });
    registerMockUsersRoutes({
        app,
        requireAuth,
        requireUserPageAccess,
        localMockUsers,
        toLocalMockApiUser,
        getLocalMockBodyObject,
        localMockStaffRoles,
        localMockClientRoles,
        requireAdminLike,
        normalizeText,
        ApiError,
        randomUUID,
        localMockUsersByEmail,
    });
    registerMockTenantRoutes({
        app,
        requireAuth,
        requireTenantPageAccess,
        requireAdminLike,
        localMockTenants,
        toCsvCell,
        normalizeTenantContacts,
        randomUUID,
        normalizeText,
        localMockUsers,
        localMockNotifications,
        getLocalMockBodyObject,
    });
    registerMockContractRoutes({
        app,
        requireAuth,
        ApiError,
        randomUUID,
        getLocalMockBodyObject,
    });
    registerMockProjectRoutes({
        app,
        requireAuth,
        projectCreateRoles,
        ApiError,
        getLocalMockBodyObject,
        randomUUID,
        normalizeText,
        projectUpdateRoles,
        projectAdminRoles,
        projectDeleteRoles,
    });
    registerMockInstallationRoutes({
        app,
        requireAuth,
        projectCreateRoles,
        ApiError,
        getLocalMockBodyObject,
        randomUUID,
        projectUpdateRoles,
        projectDeleteRoles,
    });
    registerMockMaintenancePlanRoutes({
        app,
        requireAuth,
        ApiError,
        randomUUID,
        normalizeText,
        maintenancePlanManageRoles,
        projectAdminRoles,
        getLocalMockBodyObject,
        localMockUsers,
        localMockNotifications,
        localMockDirections,
        localMockMaintenanceItems,
        generateIcsEvent,
        wrapIcsCalendar,
        sendIcsResponse,
        publicLimiter,
    });
    registerMockCalendarRoutes({
        app,
        requireAuth,
        normalizeText,
        generateIcsEvent,
        wrapIcsCalendar,
        sendIcsResponse,
        localMockDirections,
    });
    const { localMockServiceRequests } = registerMockServiceRequestRoutes({
        app,
        requireAuth,
        ApiError,
        randomUUID,
        normalizeText,
        serviceRequestManageRoles,
        serviceRequestViewRoles,
        maintenancePlanManageRoles,
        projectAdminRoles,
        projectClientRoles,
        projectOpsRoles,
        getLocalMockBodyObject,
        localMockUsers,
        localMockNotifications,
        localMockMaintenanceItems,
        serviceRequestTypes,
    });
    const createTelegramLinkToken = () => Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    registerMockAiRoutes({
        app,
        requireAuth,
        ApiError,
        normalizeText,
        localMockUsers,
        localMockServiceRequests,
        localMockNotifications,
        getLocalMockBodyObject,
        emptyAiSuggestionResponse,
        buildAiSuggestionResponse,
    });
    registerMockDirectionRoutes({
        app,
        requireAuth,
        ApiError,
        randomUUID,
        normalizeText,
        directionManageRoles,
        directionViewRoles,
        projectClientRoles,
        getLocalMockBodyObject,
        localMockUsers,
        localMockNotifications,
        localMockDirections,
        localMockTenants,
    });
    registerMockMaintenanceItemRoutes({
        app,
        requireAuth,
        ApiError,
        randomUUID,
        normalizeText,
        maintenanceItemManageRoles,
        maintenanceItemViewRoles,
        getLocalMockBodyObject,
        toCsvCell,
        localMockUsers,
        localMockNotifications,
        localMockMaintenanceItems,
    });
    registerMockCheckinRoutes({
        app,
        requireAuth,
        ApiError,
        randomUUID,
        normalizeText,
        maintenanceItemViewRoles,
        publicLimiter,
        localMockUsers,
        localMockNotifications,
        localMockCheckins,
        localMockMaintenanceItems,
    });
    registerMockNotificationRoutes({
        app,
        requireAuth,
        ApiError,
        normalizeText,
        localMockNotifications,
    });
    registerMockTelegramRoutes({
        app,
        requireAuth,
        ApiError,
        normalizeText,
        appConfig,
        randomUUID,
        getTelegramBotUsername,
        createTelegramLinkToken,
        localMockTelegramLinks,
        localMockTelegramLinkTokens,
    });
    registerMockUserAuditRoutes({
        app,
        requireAuth,
    });
}
registerAuthRoutes({
    app,
    asyncHandler,
    bootstrapAdminSchema,
    bootstrapFirstAdmin,
    getRequestMeta,
    setRefreshCookie,
    setCsrfCookie,
    createOpaqueToken,
    authLimiter,
    loginSchema,
    loginByPassword,
    emailLoginConfirmSchema,
    loginByEmailToken,
    requireCsrfToken,
    refreshSession,
    appConfig,
    logoutSession,
    clearCsrfCookie,
    clearRefreshCookie,
    passwordResetRequestSchema,
    requestPasswordReset,
    passwordResetConfirmSchema,
    confirmPasswordReset,
});
registerTenantRoutes({
    app,
    requireAuth,
    requireTenantPageAccess,
    asyncHandler,
    dbQuery,
    mapTenantRow,
    requireAdminLike,
    createTenantSchema,
    normalizeTenantContacts,
    ApiError,
    sendTenantEventNotification,
    logger,
    serializeError,
    getAdminManagerIds,
    pushInAppNotification,
    bulkUpsertTenantsSchema,
    localMockAuthEnabled,
    localMockTenants,
    parseUuidPath,
    randomUUID,
    normalizeText,
});
registerContractRoutes({
    app,
    requireAuth,
    requireAdminLike,
    asyncHandler,
    dbQuery,
    ApiError,
    parseUuidPath,
    normalizeText,
    toCsvCell,
});
registerProjectRoutes({
    app,
    requireAuth,
    asyncHandler,
    ensureProjectSchema,
    ApiError,
    projectAdminRoles,
    projectOpsRoles,
    projectClientRoles,
    projectCreateRoles,
    projectUpdateRoles,
    projectDeleteRoles,
    projectDeadlineEditRoles,
    projectStageEditRoles,
    projectTzEditRoles,
    projectFilesEditRoles,
    projectChatWriteRoles,
    normalizeText,
    normalizeSearchQuery,
    parseStatusQueryFilter,
    isUuidValue,
    parseDateTimeFilter,
    parseDateOnlyValue,
    parsePositiveInt,
    projectSortFieldMap,
    appendProjectScopeCondition,
    escapeLikePattern,
    projectSelectColumnsSql,
    withTx,
    mapProjectRow,
    logger,
    serializeError,
    parseUuidPath,
    projectCreateSchema,
    projectUpdateSchema,
    projectStatusUpdateSchema,
    projectFilesUpdateSchema,
    projectDeadlineUpdateSchema,
    projectStageUpdateSchema,
    projectTzUpdateSchema,
    projectChatMessageCreateSchema,
    normalizeProjectStatus,
    normalizeProjectStage,
    normalizeProjectFiles,
    normalizeChatVisibility,
    resolveCurrentProjectStage,
    assertProjectStageTransition,
    insertProjectEventTx,
    insertProjectTzRevisionTx,
    getProjectByIdForActorTx,
    getInstallationByIdForActorTx,
    sendProjectNotificationBestEffort,
    resolveProjectNotificationEventType,
    pushProjectInAppNotification,
    pushInAppNotification,
    getAdminManagerIds,
    projectStageLabelMap,
    mapProjectEventRow,
    mapProjectChatMessageRow,
    randomUUID,
    hasAnyText,
    toCsvCell,
    dbQuery,
});
registerInstallationRoutes({
    app,
    requireAuth,
    asyncHandler,
    ensureProjectSchema,
    ApiError,
    projectAdminRoles,
    projectOpsRoles,
    projectClientRoles,
    projectCreateRoles,
    projectUpdateRoles,
    projectDeleteRoles,
    projectDeadlineEditRoles,
    projectStageEditRoles,
    projectTzEditRoles,
    projectFilesEditRoles,
    projectChatWriteRoles,
    normalizeText,
    normalizeSearchQuery,
    parseStatusQueryFilter,
    isUuidValue,
    parseDateTimeFilter,
    parseDateOnlyValue,
    parsePositiveInt,
    projectSortFieldMap,
    appendProjectScopeCondition,
    escapeLikePattern,
    projectSelectColumnsSql,
    withTx,
    mapProjectRow,
    logger,
    serializeError,
    parseUuidPath,
    projectCreateSchema,
    projectUpdateSchema,
    projectStatusUpdateSchema,
    projectFilesUpdateSchema,
    projectDeadlineUpdateSchema,
    projectStageUpdateSchema,
    projectTzUpdateSchema,
    projectChatMessageCreateSchema,
    normalizeProjectStatus,
    normalizeProjectStage,
    normalizeProjectFiles,
    normalizeChatVisibility,
    resolveCurrentProjectStage,
    assertProjectStageTransition,
    insertProjectEventTx,
    insertProjectTzRevisionTx,
    getProjectByIdForActorTx,
    getInstallationByIdForActorTx,
    sendProjectNotificationBestEffort,
    resolveProjectNotificationEventType,
    pushProjectInAppNotification,
    pushInAppNotification,
    getAdminManagerIds,
    projectStageLabelMap,
    mapProjectEventRow,
    mapProjectChatMessageRow,
    randomUUID,
    hasAnyText,
});
registerInstallationExtensionRoutes({
    app,
    requireAuth,
    asyncHandler,
    ensureInstallationExtendedSchema,
    ensureProjectSchema,
    ApiError,
    dbQuery,
    withTx,
    normalizeText,
    isUuidValue,
    parseUuidPath,
    randomUUID,
    logger,
    serializeError,
    mapProjectRow,
    mapProjectEventRow,
    mapProjectChatMessageRow,
    insertProjectEventTx,
    sendProjectNotificationBestEffort,
    pushProjectInAppNotification,
    projectCreateRoles,
    projectUpdateRoles,
    projectDeleteRoles,
    projectAdminRoles,
    projectOpsRoles,
    projectClientRoles,
    projectFilesEditRoles,
    projectChatWriteRoles,
    installationProcurementRoles,
    installationStageEditRoles,
    installationDeadlineEditRoles,
    installationStageSet,
    installationStageLabelMap,
    installationStageTransitionMap,
    installationDeadlineStageSet,
    installationCancelReasonSet,
    normalizeInstallationStage,
    assertInstallationStageTransition,
    normalizeProcurementItemStatus,
    resolveInstallationNotificationEventType,
    buildProcurementSummary,
    installationStageUpdateSchema,
    installationStageDeadlinesUpdateSchema,
    procurementItemCreateSchema,
    procurementItemUpdateSchema,
    chatMessagePinSchema,
    mapProcurementItemRow: mapProcurementItemRowHelper,
    mapStageDeadlineRow: mapStageDeadlineRowHelper,
    appendProjectScopeCondition,
    projectSelectColumnsSql,
});
registerMaintenancePlanRoutes({
    app,
    requireAuth,
    asyncHandler,
    ensureMaintenanceSchema,
    ensureServiceRequestSchema,
    ensureNotificationSchema,
    ensureProjectSchema,
    ApiError,
    dbQuery,
    withTx,
    normalizeText,
    isUuidValue,
    isEmailValue,
    parseUuidPath,
    maintenancePlanManageRoles,
    projectAdminRoles,
    mapMaintenancePlanRow,
    mapGenerationRunRow,
    sendMaintenancePlanEmail,
    getAdminManagerIds,
    pushInAppNotification,
    pushTelegramNotification,
    logger,
    serializeError,
    randomUUID,
    generateIcsEvent,
    wrapIcsCalendar,
    sendIcsResponse,
    publicLimiter,
    parseDateOnlyValue,
    parsePositiveInt,
    dispatchServiceRequestCreationNotifications,
});
registerCalendarRoutes({
    app,
    requireAuth,
    asyncHandler,
    ensureProjectSchema,
    ensureDirectionSchema,
    ensureMaintenanceSchema,
    ensureMaintenanceItemSchema,
    ApiError,
    dbQuery,
    normalizeText,
    isUuidValue,
    parseUuidPath,
    randomUUID,
    generateIcsEvent,
    wrapIcsCalendar,
    sendIcsResponse,
});
registerServiceRequestRoutes({
    app,
    requireAuth,
    asyncHandler,
    ensureServiceRequestSchema,
    ensureNotificationSchema,
    ensureDirectionSchema,
    ensureMaintenanceItemSchema,
    ApiError,
    dbQuery,
    withTx,
    normalizeText,
    isUuidValue,
    parseUuidPath,
    serviceRequestManageRoles,
    serviceRequestViewRoles,
    serviceRequestTypes,
    mapServiceRequestRow,
    projectAdminRoles,
    projectOpsRoles,
    projectClientRoles,
    dispatchServiceRequestCreationNotifications,
    sendServiceRequestEmail,
    canSendEmails,
    sendSystemEventNotice,
    sendProjectNotificationBestEffort,
    pushProjectInAppNotification,
    getAdminManagerIds,
    pushInAppNotification,
    pushTelegramNotification,
    logger,
    serializeError,
    randomUUID,
    callLLM,
    callLLMWithFallback,
    aiRequestSuggestSystemPrompt,
    aiSimilarRequestSystemPrompt,
    parseAiJson,
    emptyAiSuggestionResponse,
    buildAiSuggestionResponse,
    normalizeAiSystemType,
    aiSimilarityValues,
    parsePositiveInt,
    parseDateOnlyValue,
});
registerAiRoutes({
    app,
    requireAuth,
    asyncHandler,
    ensureProjectSchema,
    ensureNotificationSchema,
    ApiError,
    dbQuery,
    normalizeText,
    isUuidValue,
    parseUuidPath,
    callLLM,
    callLLMWithFallback,
    aiChatSummarySystemPrompt,
    aiNotificationSummarySystemPrompt,
    aiExpandSearchSystemPrompt,
    aiChatSystemPrompt,
    parseAiJson,
    normalizeAiSystemType,
    aiSystemTypeValues,
    ensureActorHasProjectAccess,
    ensureAiFeedbackSchema,
});
registerDirectionRoutes({
    app,
    requireAuth,
    asyncHandler,
    ensureDirectionSchema,
    ensureMaintenanceItemSchema,
    ApiError,
    dbQuery,
    normalizeText,
    isUuidValue,
    parseUuidPath,
    directionManageRoles,
    directionViewRoles,
    projectClientRoles,
    mapDirectionRow,
    getAdminManagerIds,
    pushInAppNotification,
    parsePositiveInt,
});
registerMaintenanceItemRoutes({
    app,
    requireAuth,
    asyncHandler,
    ensureMaintenanceItemSchema,
    ApiError,
    dbQuery,
    normalizeText,
    parseUuidPath,
    maintenanceItemManageRoles,
    maintenanceItemViewRoles,
    mapMaintenanceItemRow,
    getAdminManagerIds,
    pushInAppNotification,
});
registerCheckinRoutes({
    app,
    requireAuth,
    asyncHandler,
    ensureMaintenanceItemSchema,
    ensureNotificationSchema,
    ApiError,
    dbQuery,
    normalizeText,
    parseUuidPath,
    publicLimiter,
    getAdminManagerIds,
    pushInAppNotification,
    logger,
    serializeError,
});
registerUsersRoutes({
    app,
    requireAuth,
    asyncHandler,
    ApiError,
    getUserById,
    requireCsrfToken,
    updateUser,
    getRequestMeta,
    requireUserPageAccess,
    listUsersQuerySchema,
    listUsers,
    requireAdminLike,
    emailLoginRequestSchema,
    requestEmailLoginToken,
    createUserSchema,
    hashPassword,
    createOpaqueToken,
    createUser,
    buildInitialBindings,
    updateUserSchema,
    parseUuidPath,
    deleteUser,
    sendInviteSchema,
    sendInvite,
    acceptInviteSchema,
    publicLimiter,
    acceptInvite,
    auditQuerySchema,
    listUserAudit,
    resolveStreamAuthUser,
    subscribeUserAuditEvent,
    toCsvCell,
    dbQuery,
});
registerTelegramRoutes({
    app,
    requireAuth,
    asyncHandler,
    ensureTelegramSchema,
    ApiError,
    dbQuery,
    normalizeText,
    isUuidValue,
    appConfig,
    getTelegramBotUsername,
    randomUUID,
});
registerNotificationRoutes({
    app,
    requireAuth,
    requireAdminLike,
    asyncHandler,
    ensureNotificationSchema,
    ApiError,
    dbQuery,
    normalizeText,
    isUuidValue,
    parseUuidPath,
    parsePositiveInt,
    mapNotificationRow,
    projectNotificationStrictAccess,
    projectDataLookupMode,
    hasProjectScopeDatabase,
    allowedTicketNotifierRoles,
    projectEventRequireComment,
    projectEventRequireQuestions,
    projectEventRequireResolution,
    ticketClientEventSchema,
    validateProjectEventPayload,
    resolveProjectIdFromNotificationPayload,
    ensureInstallationProjectExists,
    ensureActorHasProjectAccess,
    resolveRecipientForNotification,
    sendTicketClientNotification,
    sendTenantEventNotification,
});
registerAccessRequestRoutes({
    app,
    requireAuth,
    asyncHandler,
    ApiError,
    dbQuery,
    normalizeText,
    isUuidValue,
    parseUuidPath,
    getAdminManagerIds,
    pushInAppNotification,
    canSendEmails,
    sendSystemEventNotice,
    storeFile,
    parseDataUrlPayload,
    buildFileUrl,
    randomUUID,
});
app.use((error, request, response, _next) => {
    const baseMeta = {
        requestId: request.requestId ?? null,
        method: request.method,
        path: request.originalUrl,
        ip: request.ip,
    };
    const bodyParserError = error;
    if (bodyParserError?.type === 'entity.too.large' || bodyParserError?.status === 413) {
        logger.warn('Payload too large', {
            ...baseMeta,
            errorMessage: bodyParserError.message ?? 'Payload too large',
        });
        response.status(413).json({
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Payload exceeds allowed size',
            status: 413,
        });
        return;
    }
    if (error instanceof Error && error.message === 'CORS origin denied') {
        logger.warn('CORS origin denied', baseMeta);
        response.status(403).json({
            code: 'CORS_ORIGIN_DENIED',
            message: 'Origin is not allowed by CORS policy',
            status: 403,
        });
        return;
    }
    if (error instanceof ZodError) {
        logger.warn('Validation error', {
            ...baseMeta,
            issues: error.issues,
        });
        response.status(422).json({
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            status: 422,
            details: error.issues,
        });
        return;
    }
    if (isApiError(error)) {
        logger.warn('API error', {
            ...baseMeta,
            code: error.code,
            status: error.status,
            errorMessage: error.message,
        });
        const authCodes = new Set([
            'INVALID_CREDENTIALS',
            'INVALID_EMAIL_TOKEN',
            'ACCOUNT_LOCKED',
            'ACCOUNT_DISABLED',
            'ACCOUNT_PENDING_APPROVAL',
            'INVITE_PENDING',
            'RATE_LIMITED',
            'PASSWORD_LOGIN_DISABLED',
            'EMAIL_LOGIN_DISABLED',
            'EMAIL_NOT_CONFIGURED',
            'EMAIL_DELIVERY_FAILED',
            'UNAUTHORIZED',
            'CSRF_TOKEN_INVALID',
            'CSRF_ORIGIN_DENIED',
        ]);
        if (authCodes.has(error.code)) {
            void emitAlert({
                type: 'auth_error',
                severity: error.status >= 500 ? 'critical' : 'warning',
                message: `Auth error ${error.code}`,
                dedupeKey: `auth_error:${error.code}:${request.originalUrl}`,
                context: {
                    ...baseMeta,
                    code: error.code,
                    status: error.status,
                },
            });
        }
        if (error.status >= 500) {
            void emitAlert({
                type: 'http_5xx',
                severity: 'critical',
                message: `HTTP ${error.status} ${error.code}`,
                dedupeKey: `http_5xx:${error.code}:${request.originalUrl}`,
                context: {
                    ...baseMeta,
                    code: error.code,
                    status: error.status,
                },
            });
        }
        response.status(error.status).json({
            code: error.code,
            message: error.message,
            status: error.status,
        });
        return;
    }
    logger.error('Unhandled internal error', {
        ...baseMeta,
        error: serializeError(error),
    });
    void emitAlert({
        type: 'http_5xx',
        severity: 'critical',
        message: 'Unhandled internal error',
        dedupeKey: `http_5xx:internal:${request.originalUrl}`,
        context: baseMeta,
    });
    response.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        status: 500,
    });
});
export default app;
