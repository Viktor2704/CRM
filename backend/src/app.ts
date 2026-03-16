import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { ZodError, z } from 'zod';
import { appConfig } from './config.js';
import { ApiError, isApiError } from './errors.js';
import { clearCsrfCookie, clearRefreshCookie, getRequestMeta, setCsrfCookie, setRefreshCookie } from './http.js';
import { createOpaqueToken, hashOpaqueToken, hashPassword, signAccessToken, verifyAccessToken } from './security.js';
import { acceptInvite, bootstrapFirstAdmin, buildInitialBindings, confirmPasswordReset, loginByEmailToken, loginByPassword, logoutSession, requestEmailLoginToken, refreshSession, requestPasswordReset, sendInvite, } from './services/authService.js';
import { createUser, deleteUser, findRefreshTokenByHash, getUserById, listUserAudit, listUsers, updateUser } from './services/userService.js';
import { storeFile, storeFileStream } from './services/fileStorage.js';
import { checkDatabaseReady, dbQuery, hasProjectScopeDatabase, projectScopeQuery, withTx } from './db.js';
import { emitAlert } from './alerts.js';
import { logger, serializeError } from './logger.js';
import { appMetrics } from './metrics.js';
import { canSendEmails, sendSystemEventNotice } from './services/mailService.js';
import { sendTicketClientNotification, startTicketClientDigestScheduler } from './services/ticketClientNotifications.js';
import { callLLM, callLLMWithFallback } from './services/aiService.js';
import { getTelegramBotUsername, startTelegramBot } from './services/telegramBot.js';
import {
    pushTelegramNotification,
    listTelegramNotificationsForUser,
    markTelegramNotificationRead,
    markAllTelegramNotificationsRead,
    listFailedTelegramNotifications,
    retryTelegramNotificationItems,
} from './services/telegramNotifier.js';
import { subscribeUserAuditEvent } from './services/userAuditEvents.js';
import { publishNotificationEvent, subscribeNotificationEvent } from './services/notificationEvents.js';
import { requireAdminLike, requireAuth, requireTenantPageAccess, requireUserPageAccess } from './middleware/auth.js';
import { securityHeadersMiddleware } from './middleware/securityHeaders.js';
import { apiRateLimiter, authRateLimiter, sensitiveOperationRateLimiter, uploadRateLimiter } from './middleware/rateLimiter.js';
import { queryMetricsMiddleware } from './middleware/queryLogger.js';
import { logAudit, createAuditEntry } from './services/auditLogService.js';
import { acceptInviteSchema, auditQuerySchema, bootstrapAdminSchema, bulkUpsertTenantsSchema, createTenantSchema, createUserSchema, emailLoginConfirmSchema, emailLoginRequestSchema, listUsersQuerySchema, loginSchema, parseUuidPath, passwordResetConfirmSchema, passwordResetRequestSchema, sendInviteSchema, ticketClientEventSchema, updateUserSchema, } from './validators.js';
import { asyncHandler } from './helpers/asyncHandler.js';
import { escapeHtml, hasAnyText, isEmailValue, isUuidValue, normalizeText } from './helpers/normalize.js';
import { ensureProjectSchema } from './schemas/projectSchema.js';
import { ensureMaintenanceSchema } from './schemas/maintenanceSchema.js';
import { ensureServiceRequestSchema } from './schemas/serviceRequestSchema.js';
import { ensureDirectionSchema } from './schemas/directionSchema.js';
import { ensureMaintenanceItemSchema } from './schemas/maintenanceItemSchema.js';
import { ensureNotificationSchema, ensureTelegramSchema } from './schemas/notificationSchema.js';
import { ensureAiFeedbackSchema } from './schemas/aiFeedbackSchema.js';
import { ensureAccessRequestSchema } from './schemas/accessRequestSchema.js';
import { ensureCalendarSchema } from './schemas/calendarSchema.js';
import { ensureContractSchema } from './schemas/contractSchema.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerFileRoutes } from './routes/files.js';
import { registerAuthRoutes, registerMockAuthRoutes } from './routes/auth.js';
import { registerMockTenantRoutes, registerTenantRoutes } from './routes/tenants.js';
import { registerMockContractRoutes, registerContractRoutes } from './routes/contracts.js';
import { registerMockUserAuditRoutes, registerMockUsersRoutes, registerUsersRoutes } from './routes/users.js';
import { registerMockInstallationRoutes, registerInstallationRoutes } from './routes/installations.js';
import { registerInstallationExtensionRoutes } from './routes/installationExtensions.js';
import { ensureInstallationExtendedSchema } from './schemas/installationSchema.js';
import { ensureSppzJournalSchema } from './schemas/sppzJournalSchema.js';
import {
    installationStageSet, installationStageLabelMap, installationStageTransitionMap,
    installationDeadlineStageSet, installationCancelReasonSet,
    normalizeInstallationStage, assertInstallationStageTransition,
    normalizeProcurementItemStatus, resolveInstallationNotificationEventType,
    buildProcurementSummary,
    installationStageUpdateSchema, installationStageDeadlinesUpdateSchema,
    procurementItemCreateSchema, procurementItemUpdateSchema, chatMessagePinSchema,
    mapProcurementItemRow as mapProcurementItemRowHelper, mapStageDeadlineRow as mapStageDeadlineRowHelper,
} from './helpers/installationHelpers.js';
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
import { registerTelegramWebhookRoutes } from './routes/telegramWebhook.js';
import { registerEmailQueueRoutes } from './routes/emailQueue.js';
import { registerEmailDeliverabilityRoutes } from './routes/emailDeliverability.js';
import { registerEmailTrackingRoutes } from './routes/emailTracking.js';
import { registerEmailCampaignsRoutes } from './routes/emailCampaigns.js';
import { registerEmailTemplateBuilderRoutes } from './routes/emailTemplateBuilder.js';
import { registerMockAiRoutes, registerAiRoutes } from './routes/ai.js';
import { registerMockAiPredictionRoutes, registerAiPredictionRoutes } from './routes/aiPredictions.js';
import { registerAccessRequestRoutes } from './routes/accessRequests.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerAuditLogRoutes } from './routes/auditLog.js';
import { registerActivityLogRoutes } from './routes/activityLog.js';
import { registerWorkflowRoutes } from './routes/workflow.js';
import { registerRelationshipRoutes } from './routes/relationships.js';
import { registerEnhancedTimelineRoutes } from './routes/enhancedTimeline.js';
import { registerMockSppzJournalRoutes, registerSppzJournalRoutes, registerSppzProtectedObjectRoutes } from './routes/sppzJournal.js';
import { registerModuleRoutes } from './routes/modules.js';
import { initializeModuleSystem } from './moduleInit.js';
import { registerKnowledgeBaseRoutes } from './routes/knowledgeBase.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerSavedViewsRoutes } from './routes/savedViewsSimple.js';
import { createReportsRouter } from './routes/reports.js';
import { registerMetadataRoutes } from './routes/metadata.js';
import { registerFilterRoutes } from './routes/filters.js';
import { createAnalyticsRouter } from './routes/analytics.js';
import { registerReportRoutes } from './routes/reportsCustom.js';
import { registerAnalyticsRoutes } from './routes/analyticsCustom.js';
import { createAiAdvancedRouter } from './routes/aiAdvanced.js';
import realtimeRouter from './routes/realtime.js';
import { registerWorkspaceRoutes } from './routes/workspaces.js';
import { registerCollaborationRoutes } from './routes/collaboration.js';
import { registerTeamRoutes } from './routes/team.js';
import { registerCustomFieldRoutes } from './routes/customFields.js';
import { setupSwagger, apiVersionMiddleware, deprecationWarningMiddleware } from './swagger.js';
import { serviceRequestTypes, aiConfidenceValues, aiSimilarityValues, aiRequestTypeLabels, aiSystemTypeLabels, aiSystemTypeAliasMap, aiPriorityLabels, aiSystemTypeValues, aiSearchSystemLabels, extractAiJsonPayload, parseAiJson, normalizeAiConfidence, normalizeAiRequestType, normalizeAiPriority, normalizeAiSystemType, mapAiChoice, buildAiSuggestionResponse, emptyAiSuggestionResponse, aiRequestSuggestSystemPrompt, aiChatSummarySystemPrompt, aiNotificationSummarySystemPrompt, aiSimilarRequestSystemPrompt, aiExpandSearchSystemPrompt, buildWeeklyDigestSystemPrompt, aiChatSystemPrompt } from './helpers/aiConstants.js';
import { parseDataUrlPayload, buildFileUrl, ensureSafeUploadMetadata, sendAttachmentSafeFileResponse } from './helpers/fileHelpers.js';
import { canActorAccessStoredFile, registerUploadedFile } from './helpers/fileAccess.js';
import { wrapEmailHtml, sendServiceRequestEmail, sendMaintenancePlanEmail, maintenanceSystemRegulations } from './helpers/emailTemplates.js';
import { formatIcsDate, escapeIcsText, generateIcsEvent, wrapIcsCalendar, sendIcsResponse } from './helpers/icsHelpers.js';
import { mapProjectRow, mapMaintenancePlanRow, mapGenerationRunRow, mapServiceRequestRow, mapDirectionRow, mapMaintenanceItemRow, mapNotificationRow, mapProjectEventRow, mapProjectChatMessageRow } from './helpers/mappers.js';
import { localMockAuthEnabled, localMockUsers, localMockUsersByEmail, localMockRefreshTokens, localMockTenants, localMockDirections, localMockMaintenanceItems, localMockStaffRoles, localMockClientRoles, toLocalMockApiUser, createLocalMockSession } from './helpers/mockData.js';
import { projectStatusValues, projectStageValues, projectStageSet, projectStageTransitionMap, projectLegacyStatusToStage, projectSortFieldMap, projectStageLabelMap, projectStageToNotificationEventMap, projectSelectColumnsSql, projectFileSchema, projectCreateSchema, projectStatusUpdateSchema, projectUpdateSchema, projectDeadlineUpdateSchema, projectStageUpdateSchema, projectTzUpdateSchema, projectFilesUpdateSchema, projectChatMessageCreateSchema, escapeLikePattern, normalizeProjectStatus, normalizeProjectStage, resolveCurrentProjectStage, assertProjectStageTransition, normalizeProjectEventSeverity, normalizeChatVisibility, normalizeSearchQuery, parsePositiveInt, parseDateTimeFilter, parseDateOnlyValue, parseStatusQueryFilter, normalizeProjectFiles, resolveProjectNotificationEventType, resolveProjectDueDateValue, buildProjectPortalUrl, appendProjectScopeCondition } from './helpers/projectHelpers.js';
import { allowedTicketNotifierRoles, clientRecipientRoles, projectEventRequireComment, projectEventRequireQuestions, projectEventRequireResolution, projectAdminRoles, projectOpsRoles, projectClientRoles, projectCreateRoles, projectUpdateRoles, projectDeleteRoles, maintenancePlanManageRoles, projectDeadlineEditRoles, projectStageEditRoles, projectTzEditRoles, projectFilesEditRoles, projectChatWriteRoles, serviceRequestManageRoles, serviceRequestViewRoles, directionManageRoles, directionViewRoles, maintenanceItemManageRoles, maintenanceItemViewRoles } from './helpers/roles.js';
import { INTERNAL_GLOBAL_ROLES_ARRAY } from './types.js';
import { normalizeTenantContacts, mapTenantRow, sendTenantEventNotification } from './helpers/tenantHelpers.js';
import { resolveProjectIdFromNotificationPayload, resolveCounterpartyIdFromNotificationPayload, resolveRecipientFromCounterpartyId, resolveActiveUserRecipientById, resolveRecipientForNotification, validateProjectEventPayload, lookupProjectInRequestsTable, ensureInstallationProjectExists, ensureActorHasProjectAccess, loadProjectTenantId } from './services/notificationAccessService.js';
import { dispatchServiceRequestCreationNotifications, pushInAppNotification, getAdminManagerIds, pushProjectInAppNotification, dispatchContractorTenantNotifications } from './services/notificationService.js';
import { sendProjectNotificationBestEffort, insertProjectEventTx, insertProjectTzRevisionTx, getProjectByIdForActorTx, getInstallationByIdForActorTx } from './services/projectNotificationService.js';
import { startEscalationScheduler, startWeeklyDigestScheduler, startDeadlineScheduler, startPprAutoGenerationScheduler, startTokenCleanupScheduler, startAnomalyDetectionScheduler, startScheduledReportsScheduler, startWeeklyAnomalyReportScheduler, startSppzFireCheckReminderScheduler, startSppzLicenseExpirationScheduler } from './services/schedulers.js';
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
const assertStreamAccessRole = (authUser, options) => {
    if (!options?.requireAdminLike) {
        return authUser;
    }
    if (authUser.role !== 'admin' && authUser.role !== 'manager') {
        throw new ApiError(403, 'FORBIDDEN', 'Admin or manager role is required');
    }
    return authUser;
};
const resolveRefreshCookieAuthUser = async (request) => {
    const refreshToken = typeof request.cookies?.[appConfig.refreshCookieName] === 'string'
        ? request.cookies[appConfig.refreshCookieName].trim()
        : '';
    if (!refreshToken) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required');
    }
    const origin = request.get('origin') ?? undefined;
    const fetchSite = normalizeText(request.get('sec-fetch-site')).toLowerCase();
    if (origin && !isAllowedOrigin(origin)) {
        throw new ApiError(403, 'FORBIDDEN', 'Origin is not allowed');
    }
    if (fetchSite === 'cross-site') {
        throw new ApiError(403, 'FORBIDDEN', 'Cross-site stream access is not allowed');
    }
    if (localMockAuthEnabled) {
        const tokenState = localMockRefreshTokens.get(refreshToken);
        if (!tokenState || Number(tokenState.expiresAt ?? 0) <= Date.now()) {
            localMockRefreshTokens.delete(refreshToken);
            throw new ApiError(401, 'UNAUTHORIZED', 'Invalid refresh token');
        }
        const user = localMockUsers.find((candidate) => candidate.id === tokenState.userId);
        if (!user) {
            localMockRefreshTokens.delete(refreshToken);
            throw new ApiError(401, 'UNAUTHORIZED', 'Invalid refresh token');
        }
        return { id: user.id, role: user.role };
    }
    const tokenRow = await findRefreshTokenByHash(hashOpaqueToken(refreshToken));
    if (!tokenRow || tokenRow.revoked_at || new Date(tokenRow.expires_at).getTime() <= Date.now()) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Invalid refresh token');
    }
    const user = await getUserById(tokenRow.user_id);
    if (!user) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Invalid refresh token');
    }
    if (user.status === 'blocked' || user.status === 'deactivated') {
        throw new ApiError(403, 'ACCOUNT_DISABLED', 'Account is disabled');
    }
    if (user.status === 'invited') {
        if (user.mustChangePassword) {
            throw new ApiError(403, 'INVITE_PENDING', 'Invitation must be accepted first');
        }
        throw new ApiError(403, 'ACCOUNT_PENDING_APPROVAL', 'Account is pending admin approval');
    }
    return { id: user.id, role: user.role };
};
const sensitiveLogQueryKeys = new Set(['accesstoken', 'token']);
export const redactSensitiveUrlForLogs = (urlLike) => {
    const value = typeof urlLike === 'string' ? urlLike : '';
    if (!value || !value.includes('?')) {
        return value;
    }
    try {
        const parsedUrl = new URL(value, 'http://request.invalid');
        const entries = Array.from(parsedUrl.searchParams.entries());
        const nextSearchParams = new URLSearchParams();
        let changed = false;
        for (const [key, paramValue] of entries) {
            if (sensitiveLogQueryKeys.has(key.toLowerCase())) {
                nextSearchParams.append(key, 'REDACTED');
                changed = true;
                continue;
            }
            nextSearchParams.append(key, paramValue);
        }
        if (!changed) {
            return value;
        }
        const serializedQuery = nextSearchParams.toString();
        return `${parsedUrl.pathname}${serializedQuery ? `?${serializedQuery}` : ''}${parsedUrl.hash}`;
    }
    catch (_error) {
        return value.replace(/([?&])(accessToken|token)=([^&#]*)/gi, '$1$2=REDACTED');
    }
};
export const resolveStreamAuthUser = async (request, options = { requireAdminLike: false }) => {
    const authHeader = request.get('authorization');
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
    if (headerToken) {
        try {
            const payload = verifyAccessToken(headerToken) as any;
            return assertStreamAccessRole({ id: payload.sub, role: payload.role }, options);
        }
        catch (error) {
            if (isApiError(error)) {
                throw error;
            }
            throw new ApiError(401, 'UNAUTHORIZED', 'Invalid access token');
        }
    }
    const authUser = await resolveRefreshCookieAuthUser(request);
    return assertStreamAccessRole(authUser, options);
};
const resolveFileStorageKey = (request) => {
    const rawStorageKey = typeof request.params?.[0] === 'string' ? request.params[0] : '';
    const decodedStorageKey = decodeURIComponent(rawStorageKey).replace(/\\/g, '/');
    const segments = decodedStorageKey.split('/').filter(Boolean);
    if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
        throw new ApiError(400, 'INVALID_FILE_PATH', 'Invalid file path');
    }
    return segments.join('/');
};
const resolveStoredFilePath = (storageKey) => {
    const rootDir = path.resolve(appConfig.fileStorageDir);
    const fullPath = path.resolve(rootDir, ...storageKey.split('/'));
    if (fullPath !== rootDir && !fullPath.startsWith(`${rootDir}${path.sep}`)) {
        throw new ApiError(400, 'INVALID_FILE_PATH', 'Invalid file path');
    }
    return fullPath;
};
const resolveFileAuthUser = async (request) => {
    const authHeader = request.get('authorization');
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
    if (headerToken) {
        try {
            const payload = verifyAccessToken(headerToken) as any;
            return { id: payload.sub, role: payload.role };
        }
        catch (_error) {
            throw new ApiError(401, 'UNAUTHORIZED', 'Invalid access token');
        }
    }
    return resolveRefreshCookieAuthUser(request);
};
const sendProtectedStoredFile = async (request, response) => {
    const authUser = await resolveFileAuthUser(request);
    (request as any).authUser = authUser;
    const storageKey = resolveFileStorageKey(request);
    const hasFileAccess = await canActorAccessStoredFile({
        storageKey,
        actorUserId: authUser.id,
        actorRole: authUser.role,
        queryFn: dbQuery,
    });
    if (!hasFileAccess) {
        throw new ApiError(403, 'FORBIDDEN', 'No access to this file');
    }
    const fullPath = resolveStoredFilePath(storageKey);
    let stats;
    try {
        stats = await fs.stat(fullPath);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
            throw new ApiError(404, 'FILE_NOT_FOUND', 'File not found');
        }
        throw error;
    }
    if (!stats.isFile()) {
        throw new ApiError(404, 'FILE_NOT_FOUND', 'File not found');
    }
    await sendAttachmentSafeFileResponse({
        request,
        response,
        fullPath,
        fileName: path.posix.basename(storageKey),
        sizeBytes: stats.size,
        lastModified: stats.mtime,
    });
};
const projectDataLookupMode = hasProjectScopeDatabase ? 'projects_db_then_main_db' : 'main_db_only';
const projectNotificationStrictAccess = ['1', 'true', 'yes', 'on'].includes(String(process.env.PROJECT_NOTIFICATION_STRICT_ACCESS ?? '').trim().toLowerCase());
const app = express();
app.disable('x-powered-by');
const resolveAuthLimiterKey = (request) => {
    const email = normalizeText(request.body?.email).toLowerCase();
    return `${request.ip || 'unknown'}:${request.path.toLowerCase()}:${email || 'anon'}`;
};
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    keyGenerator: resolveAuthLimiterKey,
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
const AI_RATE_LIMIT_MAX_REQUESTS = 100;
const aiRequestTimestampsByUser = new Map<string, number[]>();
let backgroundServicesStarted = false;
// Periodically clean up stale entries from AI rate limiter
setInterval(() => {
    const now = Date.now();
    const oldestAllowed = now - AI_RATE_LIMIT_WINDOW_MS;
    for (const [key, timestamps] of aiRequestTimestampsByUser) {
        const active = timestamps.filter((t) => t > oldestAllowed);
        if (active.length === 0) {
            aiRequestTimestampsByUser.delete(key);
        } else {
            aiRequestTimestampsByUser.set(key, active);
        }
    }
}, 5 * 60 * 1000); // every 5 minutes
const aiRateLimitMiddleware = (request, _response, next) => {
    const userId = normalizeText((request as any).authUser?.id);
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
export const startBackgroundServices = () => {
    if (backgroundServicesStarted || localMockAuthEnabled) {
        return;
    }
    backgroundServicesStarted = true;
    startTicketClientDigestScheduler();
    startEscalationScheduler();
    startDeadlineScheduler();
    startPprAutoGenerationScheduler();
    startTokenCleanupScheduler();
    startAnomalyDetectionScheduler();
    startScheduledReportsScheduler();
    startSppzFireCheckReminderScheduler();
    startSppzLicenseExpirationScheduler();
    if ((process.env.NODE_ENV ?? '').toLowerCase() === 'production' && appConfig.aiEnabled) {
        startWeeklyDigestScheduler();
    }
    if (appConfig.aiEnabled) {
        startWeeklyAnomalyReportScheduler();
    }
    if (appConfig.telegramBotEnabled) {
        void startTelegramBot().then(() => {
            logger.info('Telegram bot started', {
                username: getTelegramBotUsername(),
            });
        }).catch((error) => {
            logger.error('Failed to start Telegram bot', {
                error: serializeError(error),
            });
        });
    }
};
if (appConfig.trustProxy) {
    app.set('trust proxy', 1);
}
// Security headers middleware - must be early in the chain
app.use(securityHeadersMiddleware);
// API versioning and deprecation middleware
app.use(apiVersionMiddleware('1.0.0'));
app.use(deprecationWarningMiddleware('1.0.0'));
// General API rate limiting
app.use('/api', apiRateLimiter);
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
        const allowsRawUpload = request.method === 'POST' && request.path === '/files/upload';
        const parsedContentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;
        const hasBody = transferEncodingHeader.length > 0
            || (Number.isFinite(parsedContentLength) ? parsedContentLength > 0 : contentLengthHeader.length > 0);
        if (hasBody
            && !allowsRawUpload
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
app.use((request, response, next) => {
    const requestId = request.get('x-request-id') ?? randomUUID();
    (request as any).requestId = requestId;
    response.setHeader('x-request-id', requestId);
    next();
});
app.use(appMetrics.middleware);
app.use(queryMetricsMiddleware);
app.use((request, response, next) => {
    const startedAt = Date.now();
    response.on('finish', () => {
        const durationMs = Date.now() - startedAt;
        const level = response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info';
        const sanitizedPath = redactSensitiveUrlForLogs(request.originalUrl);
        logger[level]('HTTP request completed', {
            requestId: (request as any).requestId,
            method: request.method,
            path: sanitizedPath,
            status: response.statusCode,
            durationMs,
            ip: request.ip,
            userId: (request as any).authUser?.id ?? null,
        });
    });
    next();
});
app.get(`${appConfig.filePublicBasePath}/*`, asyncHandler(sendProtectedStoredFile));
app.head(`${appConfig.filePublicBasePath}/*`, asyncHandler(sendProtectedStoredFile));
app.use('/ai', requireAuth, aiRateLimitMiddleware);
registerHealthRoutes({
    app,
    appConfig,
    localMockAuthEnabled,
    requireAuth,
    asyncHandler,
    checkDatabaseReady,
    emitAlert,
    metricsRegistry: appMetrics,
});
registerFileRoutes({
    app,
    requireAuth,
    asyncHandler,
    ApiError,
    storeFile,
    storeFileStream,
    parseDataUrlPayload,
    ensureSafeUploadMetadata,
    buildFileUrl,
    registerUploadedFile,
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
    const localMockTelegramNotifications = [];
    const localMockTelegramLinkTokens = [];
    const localMockTelegramLinks = new Map();
    registerMockAuthRoutes({
        app,
        authLimiter,
        asyncHandler,
        loginSchema,
        emailLoginRequestSchema,
        emailLoginConfirmSchema,
        passwordResetRequestSchema,
        passwordResetConfirmSchema,
        requireCsrfToken,
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
        requireCsrfToken,
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
        localMockDirections,
        localMockMaintenanceItems,
        getLocalMockBodyObject,
    });
    registerMockContractRoutes({
        app,
        requireAuth,
        requireTenantPageAccess,
        ApiError,
        randomUUID,
        getLocalMockBodyObject,
    });
    registerMockProjectRoutes({
        app,
        requireAuth,
        projectCreateRoles,
        internalGlobalRoles: new Set(INTERNAL_GLOBAL_ROLES_ARRAY),
        ApiError,
        getLocalMockBodyObject,
        randomUUID,
        normalizeText,
        projectUpdateRoles,
        projectAdminRoles,
        projectOpsRoles,
        projectClientRoles,
        projectChatWriteRoles,
        projectDeleteRoles,
        projectDeadlineEditRoles,
        projectStageEditRoles,
        projectTzEditRoles,
        projectFilesEditRoles,
        normalizeProjectStatus,
        normalizeProjectStage,
        resolveCurrentProjectStage,
        assertProjectStageTransition,
        normalizeChatVisibility,
        projectStageLabelMap,
    });
    registerMockInstallationRoutes({
        app,
        requireAuth,
        projectCreateRoles,
        internalGlobalRoles: new Set(INTERNAL_GLOBAL_ROLES_ARRAY),
        ApiError,
        getLocalMockBodyObject,
        randomUUID,
        normalizeText,
        projectUpdateRoles,
        projectChatWriteRoles,
        projectDeleteRoles,
        installationProcurementRoles,
        installationStageEditRoles,
        installationDeadlineEditRoles,
    });
    registerMockMaintenancePlanRoutes({
        app,
        requireAuth,
        ApiError,
        randomUUID,
        normalizeText,
        internalGlobalRoles: new Set(INTERNAL_GLOBAL_ROLES_ARRAY),
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
        randomUUID,
        getLocalMockBodyObject,
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
        internalGlobalRoles: new Set(INTERNAL_GLOBAL_ROLES_ARRAY),
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
        serviceRequestManageRoles,
        localMockUsers,
        localMockServiceRequests,
        localMockNotifications,
        getLocalMockBodyObject,
        emptyAiSuggestionResponse,
        buildAiSuggestionResponse,
    });
    registerMockAiPredictionRoutes({
        app,
        requireAuth,
        ApiError,
    });
    registerMockDirectionRoutes({
        app,
        requireAuth,
        ApiError,
        randomUUID,
        normalizeText,
        internalGlobalRoles: new Set(INTERNAL_GLOBAL_ROLES_ARRAY),
        directionManageRoles,
        directionViewRoles,
        projectClientRoles,
        getLocalMockBodyObject,
        localMockUsers,
        localMockNotifications,
        localMockDirections,
        localMockMaintenanceItems,
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
        internalGlobalRoles: new Set(INTERNAL_GLOBAL_ROLES_ARRAY),
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
        resolveStreamAuthUser,
        subscribeNotificationEvent,
        publishNotificationEvent,
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
        localMockTelegramNotifications,
    });
    registerMockUserAuditRoutes({
        app,
        requireAuth,
    });
    registerMockSppzJournalRoutes({
        app,
        requireAuth,
        ApiError,
        normalizeText,
        appConfig,
        publicLimiter,
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
    emailLoginRequestSchema,
    requestEmailLoginToken,
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
    parsePositiveInt,
    randomUUID,
    normalizeText,
});
registerContractRoutes({
    app,
    requireAuth,
    requireTenantPageAccess,
    asyncHandler,
    ensureContractSchema,
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
    internalGlobalRoles: new Set(INTERNAL_GLOBAL_ROLES_ARRAY),
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
    chatMessagePinSchema,
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
    dispatchContractorTenantNotifications,
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
    dispatchContractorTenantNotifications,
    projectStageLabelMap,
    mapProjectEventRow,
    mapProjectChatMessageRow,
    randomUUID,
    hasAnyText,
    toCsvCell,
    dbQuery,
    internalGlobalRoles: new Set(INTERNAL_GLOBAL_ROLES_ARRAY),
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
    internalGlobalRoles: new Set(INTERNAL_GLOBAL_ROLES_ARRAY),
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
    ensureCalendarSchema,
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
if (!localMockAuthEnabled) {
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
        internalGlobalRoles: new Set(INTERNAL_GLOBAL_ROLES_ARRAY),
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
}
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
    serviceRequestManageRoles,
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
registerAiPredictionRoutes({
    app,
    requireAuth,
    ApiError,
    internalGlobalRoles: new Set(INTERNAL_GLOBAL_ROLES_ARRAY),
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
    internalGlobalRoles: new Set(INTERNAL_GLOBAL_ROLES_ARRAY),
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
    internalGlobalRoles: new Set(INTERNAL_GLOBAL_ROLES_ARRAY),
    mapMaintenanceItemRow,
    getAdminManagerIds,
    pushInAppNotification,
});
registerSppzJournalRoutes({
    app,
    requireAuth,
    asyncHandler,
    ensureSppzJournalSchema,
    dbQuery,
    ApiError,
    normalizeText,
    appConfig,
    canSendEmails,
    sendSystemEventNotice,
    publicLimiter,
});
registerSppzProtectedObjectRoutes({
    app,
    requireAuth,
    asyncHandler,
    dbQuery,
    ApiError,
    normalizeText,
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
registerEmailQueueRoutes({
    app,
    requireAuth,
    requireAdminLike,
    asyncHandler,
});
registerEmailDeliverabilityRoutes({
    app,
    requireAuth,
    requireAdminLike,
    asyncHandler,
});
registerEmailTrackingRoutes({
    app,
    requireAuth,
    requireAdminLike,
    asyncHandler,
});
registerEmailCampaignsRoutes({
    app,
    requireAuth,
    requireAdminLike,
    asyncHandler,
});
registerEmailTemplateBuilderRoutes({
    app,
    requireAuth,
    requireAdminLike,
    asyncHandler,
});
registerSearchRoutes({
    app,
    requireAuth,
});
registerTelegramRoutes({
    app,
    requireAuth,
    requireAdminLike,
    asyncHandler,
    ensureTelegramSchema,
    ApiError,
    dbQuery,
    normalizeText,
    isUuidValue,
    appConfig,
    getTelegramBotUsername,
    randomUUID,
    listTelegramNotificationsForUser,
    markTelegramNotificationRead,
    markAllTelegramNotificationsRead,
    listFailedTelegramNotifications,
    retryTelegramNotificationItems,
});
registerTelegramWebhookRoutes({
    app,
    asyncHandler,
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
    loadProjectTenantId,
    resolveRecipientForNotification,
    sendTicketClientNotification,
    sendTenantEventNotification,
    resolveStreamAuthUser,
    subscribeNotificationEvent,
    publishNotificationEvent,
});
registerAccessRequestRoutes({
    app,
    localMockAuthEnabled,
    requireAuth,
    asyncHandler,
    ensureAccessRequestSchema,
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
registerKnowledgeBaseRoutes({
    app,
    requireAuth,
    asyncHandler,
    ApiError,
    parseDataUrlPayload,
    storeFile,
});
registerFilterRoutes(app);
if (localMockAuthEnabled) {
    app.get('/dashboard/overdue', requireAuth, (_request, response) => {
        response.json({ items: [] });
    });
    app.get('/dashboard/upcoming-deadlines', requireAuth, (_request, response) => {
        const today = new Date();
        const dueDate = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        response.json({
            items: [{
                id: 'mock-req-2',
                title: 'Плановое ТО',
                type: 'service_request',
                dueDate,
                daysUntil: 3,
            }],
        });
    });
    app.get('/dashboard/recent-activity', requireAuth, (_request, response) => {
        response.json({
            items: [{
                id: 'mock-activity-1',
                eventType: 'created',
                description: 'Создан тестовый монтаж',
                entityType: 'installation',
                entityId: 'mock-inst-1',
                userName: 'Local Admin',
                createdAt: new Date().toISOString(),
            }],
        });
    });
    app.get('/dashboard/quick-stats', requireAuth, (_request, response) => {
        response.json({
            totalProjects: 1,
            activeProjects: 1,
            totalRequests: 2,
            openRequests: 2,
            totalInstallations: 2,
            completedInstallations: 0,
            totalUsers: 4,
            activeUsers: 4,
        });
    });
    app.get('/dashboard/service-requests', requireAuth, (_request, response) => {
        response.json({
            items: [{
                id: 'mock-req-1',
                title: 'Авария на объекте',
                priority: 'critical',
                status: 'new',
                createdAt: new Date().toISOString(),
            }],
        });
    });
} else {
    registerDashboardRoutes({
        app,
        requireAuth,
        asyncHandler,
        dbQuery,
        ApiError,
    });
}
registerSavedViewsRoutes({
    app,
    requireAuth,
    asyncHandler,
});
registerAuditLogRoutes(app);
registerActivityLogRoutes(app);
registerMetadataRoutes(app);
registerWorkspaceRoutes(app);
registerCollaborationRoutes(app);
registerTeamRoutes(app);
registerCustomFieldRoutes(app);
registerRelationshipRoutes(app);
registerEnhancedTimelineRoutes(app);
registerWorkflowRoutes({
    app,
    requireAuth,
    ApiError,
    dbQuery,
    randomUUID,
});
app.use('/reports', createReportsRouter({ requireAuth, internalGlobalRoles: new Set(INTERNAL_GLOBAL_ROLES_ARRAY) }));
app.use('/analytics', createAnalyticsRouter({ requireAuth }));
registerReportRoutes({ app, requireAuth, asyncHandler, dbQuery, ApiError });
registerAnalyticsRoutes({ app, requireAuth, asyncHandler, dbQuery, ApiError });
app.use('/realtime', realtimeRouter);
app.use('/ai-advanced', createAiAdvancedRouter());
registerModuleRoutes(app);

// Setup Swagger API documentation
void setupSwagger({ app, basePath: '/api', version: '1.0.0' }).catch((error) => {
    logger.error('Failed to setup Swagger documentation', { error: serializeError(error) });
});

app.use((error, request, response, _next) => {
    const sanitizedPath = redactSensitiveUrlForLogs(request.originalUrl);
    const baseMeta = {
        requestId: request.requestId ?? null,
        method: request.method,
        path: sanitizedPath,
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
                dedupeKey: `auth_error:${error.code}:${sanitizedPath}`,
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
                dedupeKey: `http_5xx:${error.code}:${sanitizedPath}`,
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
        dedupeKey: `http_5xx:internal:${sanitizedPath}`,
        context: baseMeta,
    });
    response.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        status: 500,
    });
});
export default app;
