import { appendServiceRequestActorScopeCondition } from '../helpers/actorAccess.js';
import { loadActorCounterpartyId } from '../helpers/actorAccess.js';
import { CLIENT_ROLES } from '../types.js';
import { canUseInternalGlobalExport } from '../helpers/accessGates.js';
import { filterNotificationRecipientIdsByEntityScope } from '../helpers/notificationRecipientScope.js';
import { serviceRequestSavedViewConfig } from '../helpers/serviceRequestHelpers.js';
import { stripHtml } from '../helpers/sanitization.js';
import {
    createLocalMockSavedView,
    createSavedView,
    deleteLocalMockSavedView,
    deleteSavedView,
    listLocalMockSavedViews,
    listSavedViews,
    updateLocalMockSavedView,
    updateSavedView,
} from '../helpers/savedViews.js';
import {
    getCustomFieldsWithValuesByRole,
    setCustomFieldValues,
} from '../services/customFieldsService.js';

const AI_INPUT_MAX_LENGTH = 2000;

export const canExportServiceRequests = canUseInternalGlobalExport;

const assertAiInputTextLength = (value, fieldName, ApiError) => {
    if (typeof value !== 'string') {
        return;
    }
    if (value.trim().length > AI_INPUT_MAX_LENGTH) {
        throw new ApiError(422, 'VALIDATION_ERROR', `${fieldName} must be at most ${AI_INPUT_MAX_LENGTH} characters`);
    }
};

export const SERVICE_REQUEST_STATUS_TRANSITIONS: Record<string, string[]> = {
    new: ['triage', 'assigned', 'in_progress', 'cancelled'],
    triage: ['new', 'assigned', 'in_progress', 'paused', 'cancelled'],
    assigned: ['triage', 'in_progress', 'on_site', 'paused', 'cancelled'],
    in_progress: ['assigned', 'on_site', 'review', 'done', 'paused', 'cancelled'],
    on_site: ['in_progress', 'review', 'done', 'paused', 'cancelled'],
    review: ['in_progress', 'on_site', 'done', 'paused', 'cancelled'],
    paused: ['triage', 'assigned', 'in_progress', 'on_site', 'review', 'cancelled'],
    done: ['closed'],
    closed: [],
    cancelled: [],
};

export const VALID_SERVICE_REQUEST_STATUSES = new Set([
    ...Object.keys(SERVICE_REQUEST_STATUS_TRANSITIONS),
    ...Object.values(SERVICE_REQUEST_STATUS_TRANSITIONS).flat(),
]);

export const canTransitionServiceRequestStatus = (currentStatus, nextStatus) => {
    const normalizedCurrent = String(currentStatus ?? '').trim().toLowerCase() || 'new';
    const normalizedNext = String(nextStatus ?? '').trim().toLowerCase();
    if (!VALID_SERVICE_REQUEST_STATUSES.has(normalizedCurrent) || !VALID_SERVICE_REQUEST_STATUSES.has(normalizedNext)) {
        return false;
    }
    if (normalizedCurrent === normalizedNext) {
        return true;
    }
    return (SERVICE_REQUEST_STATUS_TRANSITIONS[normalizedCurrent] ?? []).includes(normalizedNext);
};

export const assertServiceRequestStatusTransition = (currentStatus, nextStatus, ApiError) => {
    const normalizedCurrent = String(currentStatus ?? '').trim().toLowerCase() || 'new';
    const normalizedNext = String(nextStatus ?? '').trim().toLowerCase();
    if (!VALID_SERVICE_REQUEST_STATUSES.has(normalizedNext)) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid status');
    }
    if (!canTransitionServiceRequestStatus(normalizedCurrent, normalizedNext)) {
        throw new ApiError(422, 'INVALID_TRANSITION', `Cannot transition from ${normalizedCurrent} to ${normalizedNext}`);
    }
};

export const registerMockServiceRequestRoutes = (params) => {
    const {
        app,
        requireAuth,
        ApiError,
        randomUUID,
        normalizeText,
        internalGlobalRoles,
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
    } = params;
        const now = new Date().toISOString();
        const localMockServiceRequests = [
            {
                id: 'mock-req-1',
                title: 'Авария на объекте',
                description: 'Протечка',
                type: 'emergency',
                directionId: 'mock-dir-1',
                systemType: '',
                createdById: 'local-admin-1',
                executorIds: ['local-executor-1'],
                curatorId: null,
                status: 'new',
                priority: 'critical',
                createdAt: now,
                updatedAt: now,
                files: [],
                isProject: false,
                resolution: null,
                bulkId: null,
            },
            {
                id: 'mock-req-2',
                title: 'Плановое ТО',
                description: 'Обслуживание',
                type: 'maintenance_planned',
                directionId: 'mock-dir-1',
                systemType: 'APS',
                createdById: 'local-dispatcher-1',
                executorIds: [],
                curatorId: null,
                status: 'assigned',
                priority: 'medium',
                createdAt: now,
                updatedAt: now,
                files: [],
                isProject: false,
                resolution: null,
                bulkId: null,
            },
        ];
        const localMockRequestComments: any[] = [];
        const localMockRequestAudit: any[] = [];
        const localMockRequestConfirmations: any[] = [
            { requestId: 'mock-req-1', token: 'mock-confirm-token-1', action: null, confirmedAt: null },
            { requestId: 'mock-req-2', token: 'mock-confirm-token-2', action: null, confirmedAt: null },
        ];
        const findMockRequest = (requestId) => localMockServiceRequests.find((item) => item.id === requestId) ?? null;
        const findMockRequestOrThrow = (requestId) => {
            const existing = findMockRequest(requestId);
            if (!existing) {
                throw new ApiError(404, 'REQUEST_NOT_FOUND', 'Service request not found');
            }
            return existing;
        };
        const ensureMockRequestConfirmation = (requestId) => {
            let record = localMockRequestConfirmations.find((item) => item.requestId === requestId) ?? null;
            if (!record) {
                record = {
                    requestId,
                    token: `mock-confirm-${requestId}`,
                    action: null,
                    confirmedAt: null,
                };
                localMockRequestConfirmations.push(record);
            }
            return record;
        };
        const getMockAuthorName = (userId) =>
            localMockUsers.find((candidate) => candidate.id === normalizeText(userId))?.fullName || 'Пользователь';
        const pushMockRequestAudit = (requestId, eventType, changes = [], actorName = 'Пользователь') => {
            localMockRequestAudit.unshift({
                id: randomUUID(),
                requestId,
                eventType,
                actorName,
                changes,
                createdAt: new Date().toISOString(),
            });
        };
        const pushMockAdminManagerNotification = (title, body, entityType, entityId) => {
            for (const user of localMockUsers) {
                if (user.role !== 'admin' && user.role !== 'manager') {
                    continue;
                }
                localMockNotifications.push({
                    id: randomUUID(),
                    userId: user.id,
                    eventType: 'service_request_created',
                    title,
                    body,
                    entityType,
                    entityId,
                    isRead: false,
                    createdAt: new Date().toISOString(),
                });
            }
        };
        const assertServiceRequestViewsAccess = (request) => {
            const actorRole = request.authUser?.role ?? '';
            if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to manage service request views');
            }
            return request.authUser?.id ?? '';
        };
        app.get('/service-requests/views', requireAuth, (request, response) => {
            const actorUserId = assertServiceRequestViewsAccess(request);
            response.status(200).json(listLocalMockSavedViews({
                actorUserId,
                config: serviceRequestSavedViewConfig,
            }));
        });
        app.post('/service-requests/views', requireAuth, (request, response) => {
            const actorUserId = assertServiceRequestViewsAccess(request);
            const result = createLocalMockSavedView({
                actorUserId,
                config: serviceRequestSavedViewConfig,
                input: getLocalMockBodyObject(request.body),
                createId: randomUUID,
            });
            response.status(201).json(result);
        });
        app.patch('/service-requests/views/:viewId', requireAuth, (request, response) => {
            const actorUserId = assertServiceRequestViewsAccess(request);
            const result = updateLocalMockSavedView({
                actorUserId,
                config: serviceRequestSavedViewConfig,
                viewId: request.params?.viewId,
                input: getLocalMockBodyObject(request.body),
            });
            response.status(200).json(result);
        });
        app.delete('/service-requests/views/:viewId', requireAuth, (request, response) => {
            const actorUserId = assertServiceRequestViewsAccess(request);
            deleteLocalMockSavedView({
                actorUserId,
                config: serviceRequestSavedViewConfig,
                viewId: request.params?.viewId,
            });
            response.status(204).send();
        });
        app.get('/service-requests', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!serviceRequestViewRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            const tab = normalizeText(request.query?.tab).toLowerCase();
            const type = normalizeText(request.query?.type).toLowerCase();
            const systemType = normalizeText(request.query?.system_type).toLowerCase();
            const bulkId = normalizeText(request.query?.bulk_id);
            let items = [...localMockServiceRequests];
            if (tab === 'active') {
                items = items.filter((item) => !['done', 'closed', 'cancelled'].includes(normalizeText(item.status).toLowerCase()));
            }
            else if (tab === 'closed') {
                items = items.filter((item) => ['done', 'closed', 'cancelled'].includes(normalizeText(item.status).toLowerCase()));
            }
            else if (tab === 'my_tasks') {
                const actorId = normalizeText(request.authUser?.id);
                items = items.filter((item) => item.executorIds.includes(actorId) || normalizeText(item.curatorId) === actorId);
                items = items.filter((item) => !['closed', 'cancelled'].includes(normalizeText(item.status).toLowerCase()));
            }
            if (type && serviceRequestTypes.has(type)) {
                items = items.filter((item) => normalizeText(item.type).toLowerCase() === type);
            }
            if (systemType) {
                items = items.filter((item) => normalizeText(item.systemType).toLowerCase() === systemType);
            }
            if (bulkId) {
                items = items.filter((item) => normalizeText(item.bulkId) === bulkId);
            }
            response.status(200).json({
                items,
                page: 1,
                limit: 20,
                total: items.length,
                totalPages: 1,
            });
        });
        app.get('/service-requests/export', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!canExportServiceRequests(actorRole, internalGlobalRoles)) {
                throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to export service requests');
            }
            const csvRows = localMockServiceRequests.map((item) => [
                item.id,
                item.title,
                item.type,
                item.status,
                item.priority,
                item.systemType,
                item.directionId,
                item.createdAt ? String(item.createdAt).slice(0, 10) : '',
            ].map((value) => {
                const text = String(value ?? '').replace(/"/g, '""');
                return `"${text}"`;
            }).join(','));
            response.setHeader('Content-Type', 'text/csv; charset=utf-8');
            response.setHeader('Content-Disposition', 'attachment; filename="service-requests.csv"');
            response.status(200).send(`\uFEFFid,title,type,status,priority,systemType,directionId,createdAt\n${csvRows.join('\n')}`);
        });
        app.get('/service-requests/export-xlsx', requireAuth, async (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!canExportServiceRequests(actorRole, internalGlobalRoles)) {
                throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to export service requests');
            }
            const { sendXlsxResponse } = await import('../helpers/xlsxHelpers.js');
            await sendXlsxResponse(response, 'service-requests', [
                { header: 'ID', key: 'id', width: 38 },
                { header: 'Название', key: 'title', width: 40 },
                { header: 'Тип', key: 'type', width: 24 },
                { header: 'Статус', key: 'status', width: 20 },
                { header: 'Приоритет', key: 'priority', width: 14 },
                { header: 'Система', key: 'systemType', width: 18 },
                { header: 'Направление', key: 'directionId', width: 38 },
                { header: 'Создана', key: 'createdAt', width: 14 },
            ], localMockServiceRequests.map((item) => ({
                id: String(item.id ?? ''),
                title: String(item.title ?? ''),
                type: String(item.type ?? ''),
                status: String(item.status ?? ''),
                priority: String(item.priority ?? ''),
                systemType: String(item.systemType ?? ''),
                directionId: String(item.directionId ?? ''),
                createdAt: item.createdAt ? String(item.createdAt).slice(0, 10) : '',
            })));
        });
        app.post('/service-requests', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!serviceRequestViewRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            const body = getLocalMockBodyObject(request.body);
            const type = normalizeText(body.type).toLowerCase() || 'general';
            const title = normalizeText(body.title);
            if (!serviceRequestTypes.has(type)) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid service request type');
            }
            if (!title) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'title is required');
            }
            const req = {
                id: randomUUID(),
                title,
                description: normalizeText(body.description),
                type,
                directionId: normalizeText(body.directionId),
                systemType: normalizeText(body.systemType),
                createdById: normalizeText(request.authUser?.id),
                executorIds: Array.isArray(body.executorIds) ? body.executorIds.map((value) => normalizeText(value)).filter(Boolean) : [],
                curatorId: normalizeText(body.curatorId) || null,
                status: 'new',
                priority: normalizeText(body.priority) || 'medium',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                files: Array.isArray(body.files) ? body.files : [],
                isProject: false,
                resolution: null,
                bulkId: null,
                maintenanceData: body.maintenanceData && typeof body.maintenanceData === 'object' ? body.maintenanceData : null,
                operationData: body.operationData && typeof body.operationData === 'object' ? body.operationData : null,
                generalData: body.generalData && typeof body.generalData === 'object' ? body.generalData : null,
            };
            localMockServiceRequests.push(req);
            ensureMockRequestConfirmation(req.id);
            pushMockRequestAudit(req.id, 'created', [
                { field: 'status', from: '', to: req.status },
            ]);
            pushMockAdminManagerNotification(`Создана сервисная заявка: ${req.title}`, req.description || 'Создана новая сервисная заявка', 'service_request', req.id);
            response.status(201).json(req);
        });
        app.post('/service-requests/bulk', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!serviceRequestManageRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            const body = getLocalMockBodyObject(request.body);
            const directionId = normalizeText(body.directionId);
            const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map((value) => normalizeText(value)).filter(Boolean) : [];
            const description = normalizeText(body.description);
            const type = normalizeText(body.type).toLowerCase() || 'maintenance_planned';
            const executorIds = Array.isArray(body.executorIds) ? body.executorIds.map((value) => normalizeText(value)).filter(Boolean) : [];
            const priority = normalizeText(body.priority) || 'medium';
            if (itemIds.length === 0) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'itemIds must contain at least one item');
            }
            if (!serviceRequestTypes.has(type)) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid service request type');
            }
            const bulkId = randomUUID();
            const created = [];
            for (const itemId of itemIds) {
                const item = localMockMaintenanceItems.find((candidate) => candidate.id === itemId);
                const requestItem = {
                    id: randomUUID(),
                    title: item ? `ТО: ${item.name}` : `ТО: объект ${itemId}`,
                    description,
                    type,
                    directionId: directionId || normalizeText(item?.directionId),
                    systemType: '',
                    createdById: normalizeText(request.authUser?.id),
                    executorIds,
                    curatorId: null,
                    status: 'new',
                    priority,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    files: [],
                    isProject: false,
                    resolution: null,
                    maintenanceItemId: itemId,
                    bulkId,
                };
                localMockServiceRequests.push(requestItem);
                ensureMockRequestConfirmation(requestItem.id);
                created.push(requestItem);
                for (const executorId of executorIds) {
                    localMockNotifications.push({
                        id: randomUUID(),
                        userId: executorId,
                        eventType: 'service_request_created',
                        title: `Новая заявка на ТО: ${normalizeText(item?.name) || itemId}`,
                        body: stripHtml(description),
                        entityType: 'service_request',
                        entityId: requestItem.id,
                        isRead: false,
                        createdAt: new Date().toISOString(),
                    });
                }
            }
            for (const item of created) {
                pushMockRequestAudit(item.id, 'bulk_created', [
                    { field: 'bulkId', from: '', to: bulkId },
                ]);
            }
            pushMockAdminManagerNotification(`Создано сервисных заявок: ${created.length}`, description || 'Создана новая сервисная заявка', 'service_request_bulk', bulkId);
            response.status(201).json({
                created: created.length,
                bulkId,
                items: created,
            });
        });
        app.post('/service-requests/:requestId/qualify', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!serviceRequestManageRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            const idx = localMockServiceRequests.findIndex((item) => item.id === request.params.requestId);
            if (idx < 0) {
                response.status(404).json({ code: 'REQUEST_NOT_FOUND' });
                return;
            }
            const body = getLocalMockBodyObject(request.body);
            localMockServiceRequests[idx].status = 'assigned';
            if (body.priority) {
                localMockServiceRequests[idx].priority = normalizeText(body.priority) || localMockServiceRequests[idx].priority;
            }
            if (body.generalData && typeof body.generalData === 'object') {
                (localMockServiceRequests[idx] as any).generalData = body.generalData;
            }
            localMockServiceRequests[idx].updatedAt = new Date().toISOString();
            pushMockRequestAudit(localMockServiceRequests[idx].id, 'qualified', [
                { field: 'status', from: 'new', to: 'assigned' },
            ]);
            response.status(200).json(localMockServiceRequests[idx]);
        });
        app.patch('/service-requests/:requestId/status', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!serviceRequestViewRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            const idx = localMockServiceRequests.findIndex((item) => item.id === request.params.requestId);
            if (idx < 0) {
                response.status(404).json({ code: 'REQUEST_NOT_FOUND' });
                return;
            }
            const body = getLocalMockBodyObject(request.body);
            const nextStatus = normalizeText(body.status).toLowerCase();
            if (!nextStatus) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'status is required');
            }
            const currentStatus = normalizeText(localMockServiceRequests[idx].status).toLowerCase() || 'new';
            assertServiceRequestStatusTransition(currentStatus, nextStatus, ApiError);
            localMockServiceRequests[idx].status = nextStatus;
            if (body.resolution && typeof body.resolution === 'object') {
                localMockServiceRequests[idx].resolution = body.resolution;
            }
            localMockServiceRequests[idx].updatedAt = new Date().toISOString();
            pushMockRequestAudit(localMockServiceRequests[idx].id, 'status_changed', [
                { field: 'status', from: '', to: localMockServiceRequests[idx].status },
            ]);
            response.status(200).json(localMockServiceRequests[idx]);
        });
        app.get('/service-requests/:requestId', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!serviceRequestViewRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            const req = findMockRequestOrThrow(request.params.requestId);
            const confirmation = ensureMockRequestConfirmation(req.id);
            response.status(200).json({
                ...req,
                commentCount: localMockRequestComments.filter((item) => item.requestId === req.id && !item.deletedAt).length,
                clientAction: confirmation.action,
                clientActionAt: confirmation.confirmedAt,
                confirmationToken: confirmation.token,
            });
        });
        app.patch('/service-requests/:requestId', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!serviceRequestManageRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            const idx = localMockServiceRequests.findIndex((item) => item.id === request.params.requestId);
            if (idx < 0) {
                response.status(404).json({ code: 'REQUEST_NOT_FOUND' });
                return;
            }
            const body = getLocalMockBodyObject(request.body);
            Object.assign(localMockServiceRequests[idx], body, {
                updatedAt: new Date().toISOString(),
            });
            pushMockRequestAudit(localMockServiceRequests[idx].id, 'updated');
            response.status(200).json(localMockServiceRequests[idx]);
        });
        app.delete('/service-requests/:requestId', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!serviceRequestManageRoles.has(actorRole) && actorRole !== 'executor') {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            const idx = localMockServiceRequests.findIndex((item) => item.id === request.params.requestId);
            if (idx < 0) {
                response.status(404).json({ code: 'REQUEST_NOT_FOUND' });
                return;
            }
            pushMockRequestAudit(localMockServiceRequests[idx].id, 'deleted');
            localMockServiceRequests.splice(idx, 1);
            response.status(204).send();
        });
        app.get('/service-requests/:requestId/comments', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!serviceRequestViewRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            findMockRequestOrThrow(request.params.requestId);
            const comments = localMockRequestComments
                .filter((item) => item.requestId === request.params.requestId)
                .filter((item) => !item.deletedAt)
                .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
            response.status(200).json(comments.map((item) => ({
                id: item.id,
                requestId: item.requestId,
                userId: item.userId,
                authorName: item.authorName,
                text: item.text,
                files: Array.isArray(item.files) ? item.files : [],
                createdAt: item.createdAt,
            })));
        });
        app.post('/service-requests/:requestId/comments', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!serviceRequestViewRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            findMockRequestOrThrow(request.params.requestId);
            const body = getLocalMockBodyObject(request.body);
            const text = normalizeText(body.text);
            if (!text) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'Text is required');
            }
            const authorId = normalizeText(request.authUser?.id);
            const comment = {
                id: randomUUID(),
                requestId: request.params.requestId,
                text,
                visibility: normalizeText(body.visibility) || 'public',
                userId: authorId,
                authorName: getMockAuthorName(authorId),
                files: Array.isArray(body.files) ? body.files : [],
                createdAt: new Date().toISOString(),
                deletedAt: null,
            };
            localMockRequestComments.push(comment);
            pushMockRequestAudit(request.params.requestId, 'comment_added');
            response.status(201).json({
                id: comment.id,
                requestId: comment.requestId,
                userId: comment.userId,
                authorName: comment.authorName,
                text: comment.text,
                files: comment.files,
                createdAt: comment.createdAt,
            });
        });
        app.delete('/service-requests/:requestId/comments/:commentId', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!serviceRequestViewRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            findMockRequestOrThrow(request.params.requestId);
            const commentIndex = localMockRequestComments.findIndex((item) => item.id === request.params.commentId && item.requestId === request.params.requestId && !item.deletedAt);
            if (commentIndex < 0) {
                throw new ApiError(404, 'NOT_FOUND', 'Comment not found');
            }
            localMockRequestComments[commentIndex] = {
                ...localMockRequestComments[commentIndex],
                deletedAt: new Date().toISOString(),
            };
            response.status(204).send();
        });
        app.get('/service-requests/:requestId/audit', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!serviceRequestViewRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            findMockRequestOrThrow(request.params.requestId);
            const items = localMockRequestAudit.filter((item) => item.requestId === request.params.requestId);
            response.status(200).json(items.map((item) => ({
                id: item.id,
                actorName: item.actorName,
                changes: item.changes,
                createdAt: item.createdAt,
            })));
        });
        app.get('/service-requests/:requestId/confirm', (request, response) => {
            const existing = findMockRequestOrThrow(request.params.requestId);
            const token = normalizeText(request.query?.token);
            const action = normalizeText(request.query?.action) || 'confirm';
            if (!token) throw new ApiError(422, 'VALIDATION_ERROR', 'Token is required');
            if (!['confirm', 'reschedule'].includes(action)) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'Action must be confirm or reschedule');
            }
            const confirmation = ensureMockRequestConfirmation(existing.id);
            if (confirmation.token !== token) {
                throw new ApiError(403, 'INVALID_TOKEN', 'Invalid or expired confirmation token');
            }
            if (action === 'confirm' && ['new', 'triage'].includes(normalizeText(existing.status))) {
                existing.status = 'assigned';
                existing.updatedAt = new Date().toISOString();
            }
            confirmation.action = action === 'confirm' ? 'confirmed' : 'reschedule_requested';
            confirmation.confirmedAt = new Date().toISOString();
            pushMockRequestAudit(existing.id, 'client_confirmed', [
                { field: 'action', from: null, to: confirmation.action },
                ...(action === 'confirm' ? [{ field: 'status', from: 'new', to: 'assigned' }] : []),
            ], 'Клиент');
            response.status(200).send(`<!DOCTYPE html><html><body>${action === 'confirm' ? 'Заявка согласована. Спасибо!' : 'Запрос на перенос отправлен. Диспетчер свяжется с вами.'}</body></html>`);
        });
        app.post('/service-requests/:requestId/confirm', (request, response) => {
            const existing = findMockRequestOrThrow(request.params.requestId);
            const body = getLocalMockBodyObject(request.body);
            const token = normalizeText(request.query?.token ?? body.token);
            const action = normalizeText(request.query?.action ?? body.action) || 'confirm';
            if (!token) throw new ApiError(422, 'VALIDATION_ERROR', 'Token is required');
            if (!['confirm', 'reschedule'].includes(action)) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'Action must be confirm or reschedule');
            }
            const confirmation = ensureMockRequestConfirmation(existing.id);
            if (confirmation.token !== token) {
                throw new ApiError(403, 'INVALID_TOKEN', 'Invalid or expired confirmation token');
            }
            if (action === 'confirm' && ['new', 'triage'].includes(normalizeText(existing.status))) {
                existing.status = 'assigned';
                existing.updatedAt = new Date().toISOString();
            }
            confirmation.action = action === 'confirm' ? 'confirmed' : 'reschedule_requested';
            confirmation.confirmedAt = new Date().toISOString();
            pushMockRequestAudit(existing.id, 'client_confirmed', [
                { field: 'action', from: null, to: confirmation.action },
                ...(action === 'confirm' ? [{ field: 'status', from: 'new', to: 'assigned' }] : []),
            ], 'Клиент');
            response.status(200).json({
                status: confirmation.action,
                message: action === 'confirm' ? 'Заявка согласована. Спасибо!' : 'Запрос на перенос отправлен. Диспетчер свяжется с вами.',
            });
        });
        return { localMockServiceRequests };
};

export const registerServiceRequestRoutes = (params) => {
    const {
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
        internalGlobalRoles,
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
        toCsvCell,
    } = params;

    const requestStatusLabels: Record<string, string> = {
        new: 'Новая',
        triage: 'На разборе',
        assigned: 'Назначена',
        in_progress: 'В работе',
        on_site: 'На объекте',
        review: 'На проверке',
        done: 'Выполнена',
        closed: 'Закрыта',
        cancelled: 'Отменена',
        paused: 'Приостановлена',
    };

    const requestActorRoleLabels: Record<string, string> = {
        admin: 'Администратор',
        manager: 'Менеджер',
        curator: 'Куратор',
        dispatcher: 'Диспетчер',
        executor: 'Исполнитель',
        client: 'Клиент',
        system: 'Система',
    };

    const localizeRequestStatus = (value) => {
        const normalized = normalizeText(value).toLowerCase();
        return requestStatusLabels[normalized] ?? (normalized || 'Не указан');
    };

    const localizeActorRole = (value) => {
        const normalized = normalizeText(value).toLowerCase();
        return requestActorRoleLabels[normalized] ?? (normalized || 'Пользователь');
    };

    const appendServiceRequestScopeCondition = async ({ actorUserId, actorRole, conditions, values, queryFn = dbQuery, tableAlias = 'r' }) => {
        await appendServiceRequestActorScopeCondition({
            actorUserId,
            actorRole,
            conditions,
            values,
            queryFn,
            tableAlias,
        });
    };

    const getServiceRequestByIdForActor = async ({ requestId, actorUserId, actorRole, queryFn = dbQuery }) => {
        const conditions = [
            `r.id = $1::uuid`,
            `r.type <> 'installation'`,
            `r.deleted_at is null`,
        ];
        const values: unknown[] = [requestId];
        await appendServiceRequestScopeCondition({
            actorUserId,
            actorRole,
            conditions,
            values,
            queryFn,
            tableAlias: 'r',
        });
        const result = await queryFn(`select *
           from requests r
           where ${conditions.join(' and ')}
           limit 1`, values);
        return result.rows[0] ?? null;
    };

    const writeRequestAuditLog = async ({ requestId, actorId, actorName, changes }) => {
        if (!isUuidValue(requestId) || !changes || typeof changes !== 'object' || Array.isArray(changes)) {
            return;
        }
        const normalizedActorId = normalizeText(actorId);
        const normalizedActorName = normalizeText(actorName) || 'Пользователь';
        await dbQuery(
            `INSERT INTO request_audit_log(request_id, actor_id, actor_name, changes)
             VALUES($1::uuid, $2::uuid, $3, $4::jsonb)`,
            [
                requestId,
                isUuidValue(normalizedActorId) ? normalizedActorId : null,
                normalizedActorName,
                JSON.stringify(changes),
            ],
        );
    };

    const normalizeIpForEmail = (value) => {
        const normalized = normalizeText(value);
        if (!normalized) return '-';
        if (normalized.startsWith('::ffff:')) {
            return normalized.slice('::ffff:'.length);
        }
        return normalized;
    };

    const formatActionTimestampRu = (dateValue: Date) =>
        new Intl.DateTimeFormat('ru-RU', {
            timeZone: 'Europe/Moscow',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }).format(dateValue);

    const resolveServiceRequestActionEmailRecipients = async (requestRow) => {
        const requestId = normalizeText(requestRow?.id);
        const recipientIds = new Set<string>();
        const createdById = normalizeText(requestRow?.created_by_id ?? requestRow?.createdById);
        if (isUuidValue(createdById)) recipientIds.add(createdById);
        const curatorId = normalizeText(requestRow?.curator_id ?? requestRow?.curatorId);
        if (isUuidValue(curatorId)) recipientIds.add(curatorId);
        const executorIds = Array.isArray(requestRow?.executor_ids)
            ? requestRow.executor_ids
            : Array.isArray(requestRow?.executorIds)
                ? requestRow.executorIds
                : [];
        for (const executorIdRaw of executorIds) {
            const executorId = normalizeText(executorIdRaw);
            if (isUuidValue(executorId)) {
                recipientIds.add(executorId);
            }
        }
        const adminIds = await getAdminManagerIds();
        for (const adminId of adminIds) {
            if (isUuidValue(adminId)) recipientIds.add(adminId);
        }
        const normalizedIds = Array.from(recipientIds).filter((value) => isUuidValue(value));
        if (normalizedIds.length === 0) {
            return [];
        }
        const scopedRecipientIds = requestId
            ? await filterNotificationRecipientIdsByEntityScope({
                recipientIds: normalizedIds,
                entityType: 'service_request',
                entityId: requestId,
                queryFn: dbQuery,
            })
            : normalizedIds;
        if (scopedRecipientIds.length === 0) {
            return [];
        }
        const recipientsResult = await dbQuery(`select
             id::text as id,
             lower(trim(email)) as email,
             coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1)) as full_name
           from app_users
           where id = any($1::uuid[])
             and status::text = 'active'
             and coalesce(trim(email), '') <> ''`, [scopedRecipientIds]);
        return recipientsResult.rows
            .map((row) => ({
            userId: normalizeText(row.id),
            email: normalizeText(row.email).toLowerCase(),
            fullName: normalizeText(row.full_name),
        }))
            .filter((row) => isUuidValue(row.userId) && row.email);
    };

    const notifyServiceRequestActionByEmail = async (args) => {
        if (!canSendEmails()) {
            return;
        }
        const actionDate = new Date();
        const requestId = normalizeText(args?.requestId);
        const title = normalizeText(args?.requestRow?.title) || requestId;
        const actionTitle = normalizeText(args?.actionTitle) || 'Обновление заявки';
        const details = normalizeText(args?.details);
        const actorId = normalizeText(args?.actorId) || 'system';
        const actorRole = normalizeText(args?.actorRole) || 'system';
        const actionIp = normalizeIpForEmail(args?.actionIp);
        const actorRoleLabel = localizeActorRole(actorRole);
        const actorNameResult = isUuidValue(actorId)
            ? await dbQuery(`select coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1)) as actor_name
               from app_users
               where id = $1::uuid
               limit 1`, [actorId]).catch(() => ({ rows: [] }))
            : { rows: [] };
        const actorName = normalizeText(actorNameResult.rows?.[0]?.actor_name);
        const actorLabel = actorName ? `${actorRoleLabel} (${actorName})` : actorRoleLabel;
        const recipients = await resolveServiceRequestActionEmailRecipients(args?.requestRow);
        if (recipients.length === 0) {
            return;
        }
        const subject = `${actionTitle}: ${title}`;
        const lines = [
            `Заявка: ${title}`,
            requestId ? `ID: ${requestId}` : '',
            details ? `Детали: ${details}` : '',
            `Кто выполнил: ${actorLabel}`,
            `IP: ${actionIp}`,
            `Время: ${formatActionTimestampRu(actionDate)} (МСК)`,
        ].filter(Boolean);
        const body = lines.join('\n');
        await Promise.all(recipients.map(async (recipient) => {
            try {
                await sendSystemEventNotice({
                    to: recipient.email,
                    subject,
                    body,
                });
            }
            catch (error) {
                logger.error('Failed to send service request action email', {
                    serviceRequestId: requestId || null,
                    recipientEmail: recipient.email,
                    actionTitle,
                    error: serializeError(error),
                });
            }
        }));
    };

    const assertServiceRequestViewsAccess = (request) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to manage service request views');
        }
        return request.authUser?.id ?? '';
    };

    app.get('/service-requests/views', requireAuth, asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        const actorUserId = assertServiceRequestViewsAccess(request);
        const result = await listSavedViews({
            actorUserId,
            config: serviceRequestSavedViewConfig,
            dbQuery,
        });
        response.status(200).json(result);
    }));

    app.post('/service-requests/views', requireAuth, asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        const actorUserId = assertServiceRequestViewsAccess(request);
        const result = await createSavedView({
            actorUserId,
            config: serviceRequestSavedViewConfig,
            input: request.body,
            withTx,
            createId: randomUUID,
        });
        response.status(201).json(result);
    }));

    app.patch('/service-requests/views/:viewId', requireAuth, asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        const actorUserId = assertServiceRequestViewsAccess(request);
        const viewId = parseUuidPath(request.params?.viewId);
        const result = await updateSavedView({
            actorUserId,
            config: serviceRequestSavedViewConfig,
            viewId,
            input: request.body,
            withTx,
        });
        response.status(200).json(result);
    }));

    app.delete('/service-requests/views/:viewId', requireAuth, asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        const actorUserId = assertServiceRequestViewsAccess(request);
        const viewId = parseUuidPath(request.params?.viewId);
        await deleteSavedView({
            actorUserId,
            config: serviceRequestSavedViewConfig,
            viewId,
            withTx,
        });
        response.status(204).send();
    }));

    app.get('/service-requests/export', requireAuth, asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        const actorRole = request.authUser?.role ?? '';
        const actorId = request.authUser?.id ?? '';
        if (!canExportServiceRequests(actorRole, internalGlobalRoles)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to export service requests');
        }
        const conditions = [`r.deleted_at is null`, `r.type <> 'installation'`];
        const values: unknown[] = [];
        await appendServiceRequestScopeCondition({
            actorUserId: actorId,
            actorRole,
            conditions,
            values,
            tableAlias: 'r',
        });
        const result = await dbQuery(`SELECT r.id, r.title, r.type, r.status, r.priority, r.system_type, r.direction_id, r.created_at
           FROM requests r
           WHERE ${conditions.join(' AND ')}
           ORDER BY r.created_at DESC`, values);
        const csvRows = result.rows.map((row) => [
            toCsvCell(row.id),
            toCsvCell(row.title),
            toCsvCell(row.type),
            toCsvCell(row.status),
            toCsvCell(row.priority),
            toCsvCell(row.system_type),
            toCsvCell(row.direction_id),
            toCsvCell(row.created_at ? String(row.created_at).slice(0, 10) : ''),
        ].join(','));
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', 'attachment; filename="service-requests.csv"');
        response.status(200).send(`\uFEFFid,title,type,status,priority,systemType,directionId,createdAt\n${csvRows.join('\n')}`);
    }));
    app.get('/service-requests/export-xlsx', requireAuth, asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        await ensureDirectionSchema();
        const actorRole = request.authUser?.role ?? '';
        const actorId = request.authUser?.id ?? '';
        if (!canExportServiceRequests(actorRole, internalGlobalRoles)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to export service requests');
        }
        const conditions = [`r.deleted_at is null`, `r.type <> 'installation'`];
        const values: unknown[] = [];
        await appendServiceRequestScopeCondition({
            actorUserId: actorId,
            actorRole,
            conditions,
            values,
            tableAlias: 'r',
        });
        const result = await dbQuery(`SELECT r.id, r.title, r.description, r.type, r.status, r.priority,
            r.system_type, r.direction_id, r.executor_ids, r.curator_id,
            r.visit_date, r.due_date_preliminary, r.is_overdue,
            r.created_at, r.updated_at,
            d.name as direction_name
            FROM requests r
            LEFT JOIN directions d ON d.id::text = r.direction_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY r.created_at DESC`, values);

        // Resolve executor names
        const allExecutorIds = new Set<string>();
        for (const row of result.rows) {
            if (Array.isArray(row.executor_ids)) {
                for (const eid of row.executor_ids) { const n = normalizeText(eid); if (n) allExecutorIds.add(n); }
            }
            const cid = normalizeText(row.curator_id);
            if (cid) allExecutorIds.add(cid);
        }
        const userMap: Record<string, string> = {};
        if (allExecutorIds.size > 0) {
            const userResult = await dbQuery(`SELECT id::text, full_name, email FROM app_users WHERE id = ANY($1::uuid[])`, [Array.from(allExecutorIds)]);
            for (const u of userResult.rows) {
                userMap[String(u.id)] = normalizeText(u.full_name) || normalizeText(u.email) || String(u.id);
            }
        }

        const statusLabels: Record<string, string> = { new: 'Новая', assigned: 'Назначена', in_progress: 'В работе', review: 'На проверке', done: 'Выполнена', closed: 'Закрыта', cancelled: 'Отменена' };
        const priorityLabels: Record<string, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критический' };
        const typeLabels: Record<string, string> = { maintenance: 'Плановое ТО', repair: 'Ремонт', inspection: 'Осмотр', consultation: 'Консультация', general: 'Общая', emergency: 'Аварийная' };

        const { sendXlsxResponse } = await import('../helpers/xlsxHelpers.js');
        await sendXlsxResponse(response, 'service-requests', [
            { header: '№', key: 'num', width: 6 },
            { header: 'Название', key: 'title', width: 40 },
            { header: 'Описание', key: 'description', width: 50 },
            { header: 'Тип', key: 'type', width: 18 },
            { header: 'Направление', key: 'direction', width: 28 },
            { header: 'Система', key: 'systemType', width: 18 },
            { header: 'Исполнители', key: 'executors', width: 30 },
            { header: 'Куратор', key: 'curator', width: 22 },
            { header: 'Приоритет', key: 'priority', width: 14 },
            { header: 'Статус', key: 'status', width: 16 },
            { header: 'Просрочено', key: 'overdue', width: 12 },
            { header: 'Дата выезда', key: 'visitDate', width: 14 },
            { header: 'Дедлайн', key: 'deadline', width: 14 },
            { header: 'Создана', key: 'createdAt', width: 14 },
            { header: 'Обновлена', key: 'updatedAt', width: 14 },
            { header: 'Дней в работе', key: 'daysInProgress', width: 14 },
        ], result.rows.map((row, idx) => {
            const executorNames = Array.isArray(row.executor_ids)
                ? row.executor_ids.map((eid: string) => userMap[normalizeText(eid)] || normalizeText(eid)).filter(Boolean).join(', ')
                : '';
            const curatorName = row.curator_id ? (userMap[normalizeText(row.curator_id)] || normalizeText(row.curator_id)) : '';
            const createdDate = row.created_at ? new Date(row.created_at) : null;
            const updatedDate = row.updated_at ? new Date(row.updated_at) : null;
            const daysInProgress = createdDate ? Math.floor((Date.now() - createdDate.getTime()) / 86400000) : '';
            return {
                num: idx + 1,
                title: normalizeText(row.title),
                description: normalizeText(row.description),
                type: typeLabels[normalizeText(row.type)] || normalizeText(row.type),
                direction: normalizeText(row.direction_name) || normalizeText(row.direction_id),
                systemType: normalizeText(row.system_type),
                executors: executorNames,
                curator: curatorName,
                priority: priorityLabels[normalizeText(row.priority)] || normalizeText(row.priority),
                status: statusLabels[normalizeText(row.status)] || normalizeText(row.status),
                overdue: row.is_overdue ? 'Да' : 'Нет',
                visitDate: row.visit_date ? String(row.visit_date).slice(0, 10) : '',
                deadline: row.due_date_preliminary ? String(row.due_date_preliminary).slice(0, 10) : '',
                createdAt: createdDate ? createdDate.toISOString().slice(0, 10) : '',
                updatedAt: updatedDate ? updatedDate.toISOString().slice(0, 10) : '',
                daysInProgress: String(daysInProgress),
            };
        }));
    }));
    app.get('/service-requests', requireAuth, asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        const actorRole = request.authUser?.role ?? '';
        const actorUserId = request.authUser?.id ?? '';
        if (!serviceRequestViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view service requests');
        }
        const tab = normalizeText(request.query?.tab).toLowerCase();
        const typeFilter = normalizeText(request.query?.type).toLowerCase();
        const systemTypeFilter = normalizeText(request.query?.system_type).toLowerCase();
        const statusFilter = normalizeText(request.query?.status).toLowerCase();
        const directionId = normalizeText(request.query?.direction_id);
        const bulkIdFilter = normalizeText(request.query?.bulk_id);
        const assigneeId = normalizeText(request.query?.assignee_id);
        const requestedTenantId = normalizeText(request.query?.tenant_id);

        // Validate tenant_id for client_manager role
        if (requestedTenantId && CLIENT_ROLES.has(actorRole)) {
            const actorTenantId = await loadActorCounterpartyId(actorUserId);
            if (actorTenantId && requestedTenantId !== actorTenantId) {
                throw new ApiError(403, 'FORBIDDEN', 'Cannot access data from other tenants');
            }
        }

        const search = normalizeText(request.query?.search).toLowerCase();
        const executorSearch = normalizeText(request.query?.executor_search).toLowerCase();
        const itemSearch = normalizeText(request.query?.item_search).toLowerCase();
        const createdFrom = parseDateOnlyValue(request.query?.created_from, 'created_from');
        const createdTo = parseDateOnlyValue(request.query?.created_to, 'created_to');
        const page = parsePositiveInt(request.query?.page, {
            field: 'page',
            defaultValue: 1,
            min: 1,
        });
        const limit = parsePositiveInt(request.query?.limit, {
            field: 'limit',
            defaultValue: 20,
            min: 1,
            max: 100,
        });
        const offset = (page - 1) * limit;
        const order = normalizeText(request.query?.order).toLowerCase() === 'asc' ? 'asc' : 'desc';
        const sortInput = normalizeText(request.query?.sort).toLowerCase();
        const sortMap = {
            created_at: 'r.created_at',
            updated_at: 'r.updated_at',
            status: 'r.status',
            priority: 'r.priority',
            title: 'r.title',
        };
        const sortExpr = sortMap[sortInput] ?? 'r.created_at';
        const conditions = [`r.type <> 'installation'`, `r.deleted_at is null`];
        const values = [];
        const push = (value) => {
            values.push(value);
            return `$${values.length}`;
        };
        await appendServiceRequestScopeCondition({
            actorUserId,
            actorRole,
            conditions,
            values,
            tableAlias: 'r',
        });
        if (tab === 'active') {
            conditions.push(`coalesce(r.status, '') not in ('done', 'closed', 'cancelled')`);
        }
        else if (tab === 'closed') {
            conditions.push(`coalesce(r.status, '') in ('done', 'closed', 'cancelled')`);
        }
        else if (tab === 'my_tasks') {
            if (!isUuidValue(actorUserId)) {
                conditions.push('false');
            }
            else {
                const actorRef = push(actorUserId);
                conditions.push(`(
              ${actorRef}::text = any(coalesce(r.executor_ids, '{}'::text[]))
              or r.curator_id = ${actorRef}::text
            )`);
                conditions.push(`coalesce(r.status, '') not in ('closed', 'cancelled')`);
            }
        }
        if (typeFilter && serviceRequestTypes.has(typeFilter)) {
            const typeRef = push(typeFilter);
            conditions.push(`r.type = ${typeRef}`);
        }
        if (systemTypeFilter) {
            const systemTypeRef = push(systemTypeFilter);
            conditions.push(`lower(coalesce(r.system_type, '')) = ${systemTypeRef}`);
        }
        if (statusFilter) {
            const statusRef = push(statusFilter);
            conditions.push(`r.status = ${statusRef}`);
        }
        if (directionId) {
            const directionRef = push(directionId);
            conditions.push(`r.direction_id = ${directionRef}::text`);
        }
        if (bulkIdFilter) {
            const bulkRef = push(bulkIdFilter);
            conditions.push(`r.bulk_id = ${bulkRef}`);
        }
        if (assigneeId && isUuidValue(assigneeId)) {
            const assigneeRef = push(assigneeId);
            conditions.push(`${assigneeRef}::text = any(coalesce(r.executor_ids, '{}'::text[]))`);
        }
        if (search) {
            const searchRef = push(`%${search}%`);
            conditions.push(`(
            lower(coalesce(r.title, '')) like ${searchRef}
            or lower(coalesce(r.description, '')) like ${searchRef}
          )`);
        }
        if (createdFrom) {
            const createdFromRef = push(createdFrom);
            conditions.push(`r.created_at::date >= ${createdFromRef}::date`);
        }
        if (createdTo) {
            const createdToRef = push(createdTo);
            conditions.push(`r.created_at::date <= ${createdToRef}::date`);
        }
        if (executorSearch) {
            const executorSearchRef = push(`%${executorSearch}%`);
            conditions.push(`exists(
            select 1
            from unnest(coalesce(r.executor_ids, '{}'::text[])) as executor_id
            left join app_users u on u.id::text = executor_id
            where lower(executor_id) like ${executorSearchRef}
               or lower(coalesce(u.full_name, '')) like ${executorSearchRef}
               or lower(coalesce(u.email, '')) like ${executorSearchRef}
          )`);
        }
        if (itemSearch) {
            const itemSearchRef = push(`%${itemSearch}%`);
            conditions.push(`exists(
            select 1
            from unnest(coalesce(r.item_ids, '{}'::text[])) as item_id
            where lower(item_id) like ${itemSearchRef}
          )`);
        }
        const whereSql = conditions.join(' and ');
        const countResult = await dbQuery(`select count(*)::int as total
           from requests r
           where ${whereSql}`, values);
        const total = Number(countResult.rows[0]?.total ?? 0);
        const pageValues = [...values, limit, offset];
        const limitRef = `$${pageValues.length - 1}`;
        const offsetRef = `$${pageValues.length}`;
        const itemsResult = await dbQuery(`select
           r.*,
           (select count(*) from request_comments c where c.request_id = r.id and c.deleted_at is null)::int as comment_count,
           coalesce(client_audit.client_action, client_confirmation.client_action) as client_action,
           coalesce(client_audit.client_action_at, client_confirmation.client_action_at) as client_action_at
           from requests r
           left join lateral (
             select
               al.changes->'action'->>'to' as client_action,
               al.created_at as client_action_at
             from request_audit_log al
             where al.request_id = r.id
               and (al.changes->'action'->>'to') in ('confirmed', 'reschedule_requested')
             order by al.created_at desc
             limit 1
           ) client_audit on true
           left join lateral (
             select
               case
                 when src.action = 'confirm' then 'confirmed'
                 when src.action = 'reschedule' then 'reschedule_requested'
                 else null
               end as client_action,
               src.confirmed_at as client_action_at
             from service_request_confirmations src
             where src.request_id = r.id
               and src.confirmed_at is not null
               and src.action in ('confirm', 'reschedule')
             order by src.confirmed_at desc
             limit 1
           ) client_confirmation on true
           where ${whereSql}
           order by ${sortExpr} ${order}
           limit ${limitRef}::int
           offset ${offsetRef}::int`, pageValues);
        response.status(200).json({
            items: itemsResult.rows.map(mapServiceRequestRow),
            page,
            limit,
            total,
            totalPages: total > 0 ? Math.ceil(total / limit) : 0,
        });
    }));
    app.post('/service-requests', requireAuth, asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        await ensureNotificationSchema();
        await ensureDirectionSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!serviceRequestViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to create service requests');
        }
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const type = normalizeText(body.type).toLowerCase() || 'general';
        if (!serviceRequestTypes.has(type)) {
            throw new ApiError(422, 'VALIDATION_ERROR', `type must be one of: ${Array.from(serviceRequestTypes).join(', ')}`);
        }
        const title = normalizeText(body.title);
        if (!title) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'title is required');
        }
        const directionId = normalizeText(body.directionId) || null;
        let tenantId = normalizeText(body.tenantId) || null;
        if (!tenantId && directionId && isUuidValue(directionId)) {
            const directionResult = await dbQuery(`select tenant_id
             from directions
             where id = $1::uuid
               and deleted_at is null
             limit 1`, [directionId]);
            tenantId = normalizeText(directionResult.rows[0]?.tenant_id) || null;
        }
        const result = await dbQuery(`insert into requests(
           type,
           is_project,
           title,
           description,
           tenant_id,
           direction_id,
           system_type,
           system_types,
           item_ids,
           priority,
           status,
           created_by_id,
           executor_ids,
           curator_id,
           due_date_preliminary,
           visit_date,
           files,
           maintenance_data,
           operation_data,
           general_data,
           bulk_id,
           created_at,
           updated_at
         )
         values(
           $1,
           false,
           $2,
           $3,
           $4,
           $5,
           $6,
           $7::text[],
           $8::text[],
           $9,
           $10,
           $11,
           $12::text[],
           $13,
           $14::date,
           $15::date,
           $16::jsonb,
           $17::jsonb,
           $18::jsonb,
           $19::jsonb,
           $20,
           now(),
           now()
         )
         returning *`, [
            type,
            title,
            normalizeText(body.description),
            tenantId,
            directionId,
            normalizeText(body.systemType) || null,
            Array.isArray(body.systemTypes) ? body.systemTypes.map((value) => normalizeText(value)).filter(Boolean) : [],
            Array.isArray(body.itemIds) ? body.itemIds.map((value) => normalizeText(value)).filter(Boolean) : [],
            normalizeText(body.priority) || 'medium',
            'new',
            normalizeText(request.authUser?.id) || null,
            Array.isArray(body.executorIds) ? body.executorIds.map((value) => normalizeText(value)).filter(Boolean) : [],
            normalizeText(body.curatorId) || null,
            parseDateOnlyValue(body.dueDatePreliminary, 'dueDatePreliminary'),
            parseDateOnlyValue(body.visitDate, 'visitDate'),
            JSON.stringify(Array.isArray(body.files) ? body.files : []),
            body.maintenanceData && typeof body.maintenanceData === 'object' ? JSON.stringify(body.maintenanceData) : null,
            body.operationData && typeof body.operationData === 'object' ? JSON.stringify(body.operationData) : null,
            body.generalData && typeof body.generalData === 'object' ? JSON.stringify(body.generalData) : null,
            null,
        ]);
        void dispatchServiceRequestCreationNotifications(request, [result.rows[0]]).catch((error) => {
            logger.error('Failed to dispatch service request notifications', {
                requestId: request.requestId ?? null,
                error: serializeError(error),
            });
        });

        const createdRequestId = String(result.rows[0].id);

        // Handle custom fields if provided
        if (body.customFields && typeof body.customFields === 'object') {
            try {
                await setCustomFieldValues('service_request', createdRequestId, body.customFields, actorRole);
            } catch (error) {
                logger.error('Failed to save custom fields on creation', {
                    requestId: createdRequestId,
                    error: serializeError(error),
                });
            }
        }

        response.status(201).json(mapServiceRequestRow(result.rows[0]));
    }));
    app.post('/service-requests/bulk', requireAuth, asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        await ensureMaintenanceItemSchema();
        await ensureNotificationSchema();
        await ensureDirectionSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!serviceRequestManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed to create bulk requests');
        }
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const directionId = normalizeText(body.directionId);
        const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map((value) => normalizeText(value)).filter(Boolean) : [];
        const description = normalizeText(body.description);
        const type = normalizeText(body.type).toLowerCase() || 'maintenance_planned';
        const executorIds = Array.isArray(body.executorIds) ? body.executorIds.map((value) => normalizeText(value)).filter(Boolean) : [];
        const priority = normalizeText(body.priority) || 'medium';
        const actorUserId = normalizeText(request.authUser?.id);
        if (itemIds.length === 0) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'itemIds must contain at least one item');
        }
        if (!serviceRequestTypes.has(type)) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid service request type');
        }
        const bulkId = randomUUID();
        const created = [];
        const createdRows = [];
        for (const itemId of itemIds) {
            let itemName = `объект ${itemId}`;
            let resolvedDirectionId = directionId;
            let resolvedTenantId = '';
            if (isUuidValue(itemId)) {
                const itemResult = await dbQuery(`select
               mi.name,
               mi.direction_id,
               coalesce(d.tenant_id, '') as tenant_id
             from maintenance_items mi
             left join directions d on d.id::text = mi.direction_id
             where mi.id = $1::uuid
               and mi.deleted_at is null
             limit 1`, [itemId]);
                const row = itemResult.rows[0];
                itemName = normalizeText(row?.name) || itemName;
                if (!resolvedDirectionId) {
                    resolvedDirectionId = normalizeText(row?.direction_id);
                }
                resolvedTenantId = normalizeText(row?.tenant_id);
            }
            if (!resolvedTenantId && resolvedDirectionId && isUuidValue(resolvedDirectionId)) {
                const directionResult = await dbQuery(`select tenant_id
             from directions
             where id = $1::uuid
               and deleted_at is null
             limit 1`, [resolvedDirectionId]);
                resolvedTenantId = normalizeText(directionResult.rows[0]?.tenant_id);
            }
            const title = `ТО: ${itemName}`;
            const result = await dbQuery(`insert into requests(
               id,
               type,
               is_project,
               title,
               description,
               tenant_id,
               direction_id,
               priority,
               status,
               created_by_id,
               executor_ids,
               bulk_id,
               created_at,
               updated_at
             )
             values(
               gen_random_uuid(),
               $1,
               false,
               $2,
               $3,
               $4,
               $5,
               $6,
               'new',
               $7,
               $8::text[],
               $9,
               now(),
               now()
             )
             returning *`, [
                type,
                title,
                description,
                resolvedTenantId || null,
                resolvedDirectionId || null,
                priority,
                actorUserId || null,
                executorIds,
                bulkId,
            ]);
            const row = result.rows[0];
            createdRows.push(row);
            created.push(mapServiceRequestRow(row));
        }
        void dispatchServiceRequestCreationNotifications(request, createdRows).catch((error) => {
            logger.error('Failed to dispatch bulk service request notifications', {
                requestId: request.requestId ?? null,
                error: serializeError(error),
            });
        });
        response.status(201).json({
            created: created.length,
            bulkId,
            items: created,
        });
    }));
    app.post('/service-requests/:requestId/qualify', requireAuth, asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!serviceRequestManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to qualify service requests');
        }
        const requestId = parseUuidPath(request.params.requestId);
        const actorId = normalizeText(request.authUser?.id);
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const existing = await getServiceRequestByIdForActor({
            requestId,
            actorUserId: actorId,
            actorRole,
        });
        if (!existing) {
            throw new ApiError(404, 'REQUEST_NOT_FOUND', 'Service request not found');
        }
        const result = await dbQuery(`update requests
           set status = 'assigned',
               priority = coalesce(nullif($2, ''), priority),
               general_data = coalesce($3::jsonb, general_data),
               updated_at = now()
           where id = $1::uuid
           returning *`, [
            requestId,
            normalizeText(body.priority),
            body.generalData && typeof body.generalData === 'object' ? JSON.stringify(body.generalData) : null,
        ]);
        const actorName = normalizeText(request.authUser?.fullName ?? request.authUser?.email) || 'Пользователь';
        const previousStatus = normalizeText(existing?.status);
        const previousPriority = normalizeText(existing?.priority);
        const nextPriority = normalizeText(result.rows[0]?.priority);
        const qualifyAuditChanges = {
            action: { from: null, to: 'qualified' },
            status: { from: previousStatus || null, to: 'assigned' },
        };
        if (previousPriority !== nextPriority) {
            qualifyAuditChanges['priority'] = { from: previousPriority || null, to: nextPriority || null };
        }
        void writeRequestAuditLog({
            requestId,
            actorId,
            actorName,
            changes: qualifyAuditChanges,
        }).catch(() => {});
        try {
            void sendProjectNotificationBestEffort({
                request,
                actorUserId: normalizeText(request.authUser?.id),
                actorRole: normalizeText(request.authUser?.role),
                projectId: requestId,
                projectRow: result.rows[0],
                eventType: 'ticket_qualified',
                commentText: `Заявка квалифицирована, статус: assigned`,
                dedupeToken: `svc-qualify:${requestId}:${Date.now()}`,
            }).catch(() => {
            });
            void pushProjectInAppNotification({
                projectId: requestId,
                eventType: 'ticket_qualified',
                title: `Заявка квалифицирована`,
                body: `Заявка переведена в статус «${localizeRequestStatus('assigned')}»`,
                actorUserId: normalizeText(request.authUser?.id),
            });
            void notifyServiceRequestActionByEmail({
                requestId,
                requestRow: result.rows[0],
                actionTitle: 'Квалификация заявки',
                details: `Заявка переведена в статус «${localizeRequestStatus('assigned')}»`,
                actorId: normalizeText(request.authUser?.id),
                actorRole: normalizeText(request.authUser?.role),
                actionIp: normalizeText(request.ip),
            }).catch(() => {});
        }
        catch {
        }
        response.status(200).json(mapServiceRequestRow(result.rows[0]));
    }));
    app.patch('/service-requests/:requestId/status', requireAuth, asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        const actorRole = request.authUser?.role ?? '';
        const actorUserId = normalizeText(request.authUser?.id);
        if (!serviceRequestManageRoles.has(actorRole) && actorRole !== 'executor') {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to update service request status');
        }
        const requestId = parseUuidPath(request.params.requestId);
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const status = normalizeText(body.status).toLowerCase();
        if (!status) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'status is required');
        }
        if (!VALID_SERVICE_REQUEST_STATUSES.has(status)) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid status');
        }
        const existing = await getServiceRequestByIdForActor({
            requestId,
            actorUserId,
            actorRole,
        });
        if (!existing) {
            throw new ApiError(404, 'REQUEST_NOT_FOUND', 'Service request not found');
        }
        const currentStatus = normalizeText(existing.status).toLowerCase() || 'new';
        assertServiceRequestStatusTransition(currentStatus, status, ApiError);
        const updates = [`status = $2`, `updated_at = now()`];
        const values = [requestId, status];
        if (body.resolution && typeof body.resolution === 'object') {
            values.push(JSON.stringify(body.resolution));
            updates.push(`resolution = $${values.length}::jsonb`);
        }
        const result = await dbQuery(`update requests
           set ${updates.join(', ')}
           where id = $1::uuid
           returning *`, values);
        const actorId = normalizeText(request.authUser?.id);
        const actorName = normalizeText(request.authUser?.fullName ?? request.authUser?.email) || 'Пользователь';
        const previousStatus = normalizeText(existing?.status);
        void writeRequestAuditLog({
            requestId,
            actorId,
            actorName,
            changes: {
                action: { from: null, to: 'status_changed' },
                status: { from: previousStatus || null, to: status || null },
            },
        }).catch(() => {});
        try {
            const localizedStatus = localizeRequestStatus(status);
            void sendProjectNotificationBestEffort({
                request,
                actorUserId: normalizeText(request.authUser?.id),
                actorRole: normalizeText(request.authUser?.role),
                projectId: requestId,
                projectRow: result.rows[0],
                eventType: 'ticket_status_changed',
                commentText: `Статус заявки изменён: ${localizedStatus}`,
                dedupeToken: `svc-status:${requestId}:${status}`,
            }).catch(() => {
            });
            void pushProjectInAppNotification({
                projectId: requestId,
                eventType: 'ticket_status_changed',
                title: `Статус сервисной заявки: ${localizedStatus}`,
                body: `Статус заявки изменён на ${localizedStatus}`,
                actorUserId: normalizeText(request.authUser?.id),
            });
            void notifyServiceRequestActionByEmail({
                requestId,
                requestRow: result.rows[0],
                actionTitle: 'Изменение статуса заявки',
                details: `Новый статус: ${localizeRequestStatus(status)}`,
                actorId: normalizeText(request.authUser?.id),
                actorRole: normalizeText(request.authUser?.role),
                actionIp: normalizeText(request.ip),
            }).catch(() => {});
        }
        catch {
        }
        response.status(200).json(mapServiceRequestRow(result.rows[0]));
    }));
    app.get('/service-requests/:requestId', requireAuth, asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        const actorRole = request.authUser?.role ?? '';
        const actorUserId = normalizeText(request.authUser?.id);
        if (!serviceRequestViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view service requests');
        }
        const requestId = parseUuidPath(request.params.requestId);
        const row = await getServiceRequestByIdForActor({
            requestId,
            actorUserId,
            actorRole,
        });
        if (!row) {
            throw new ApiError(404, 'REQUEST_NOT_FOUND', 'Service request not found');
        }

        // Get custom fields with values filtered by user role
        const customFields = await getCustomFieldsWithValuesByRole('service_request', requestId, actorRole).catch(() => []);

        response.status(200).json({
            ...mapServiceRequestRow(row),
            customFields,
        });
    }));
    app.patch('/service-requests/:requestId', requireAuth, asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        const actorRole = request.authUser?.role ?? '';
        const actorUserId = normalizeText(request.authUser?.id);
        if (!serviceRequestManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to update service requests');
        }
        const requestId = parseUuidPath(request.params.requestId);
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        if (actorRole === 'curator' && (Array.isArray(body.executorIds) && body.executorIds.length > 0 || body.assigneeId)) {
            throw new ApiError(403, 'FORBIDDEN', 'Curator cannot assign executors');
        }
        const existing = await getServiceRequestByIdForActor({
            requestId,
            actorUserId,
            actorRole,
        });
        if (!existing) {
            throw new ApiError(404, 'REQUEST_NOT_FOUND', 'Service request not found');
        }
        const result = await dbQuery(`update requests
           set title = coalesce(nullif($2, ''), title),
               description = coalesce($3, description),
               direction_id = coalesce(nullif($4, ''), direction_id),
               system_type = coalesce($5, system_type),
               system_types = coalesce($6::text[], system_types),
               item_ids = coalesce($7::text[], item_ids),
               priority = coalesce(nullif($8, ''), priority),
               executor_ids = coalesce($9::text[], executor_ids),
               curator_id = coalesce(nullif($10, ''), curator_id),
               due_date_preliminary = coalesce($11::date, due_date_preliminary),
               general_data = coalesce($12::jsonb, general_data),
               files = coalesce($13::jsonb, files),
               resolution_text = coalesce($14, resolution_text),
               resolution_files = coalesce($15::jsonb, resolution_files),
               visit_date = case when $16::text = '__clear__' then null else coalesce($17::date, visit_date) end,
               updated_at = now()
           where id = $1::uuid
           returning *`, [
            requestId,
            body.title ?? '',
            body.description !== undefined ? body.description : null,
            body.directionId ?? '',
            body.systemType !== undefined ? body.systemType : null,
            Array.isArray(body.systemTypes) ? body.systemTypes.map((value) => normalizeText(value)).filter(Boolean) : null,
            Array.isArray(body.itemIds) ? body.itemIds.map((value) => normalizeText(value)).filter(Boolean) : null,
            body.priority ?? '',
            Array.isArray(body.executorIds) ? body.executorIds.map((value) => normalizeText(value)).filter(Boolean) : null,
            body.curatorId ?? '',
            body.dueDatePreliminary !== undefined ? parseDateOnlyValue(body.dueDatePreliminary, 'dueDatePreliminary') : null,
            body.generalData && typeof body.generalData === 'object' ? JSON.stringify(body.generalData) : null,
            Array.isArray(body.files) ? JSON.stringify(body.files) : null,
            body.resolutionText !== undefined ? normalizeText(body.resolutionText) : null,
            body.resolutionFiles !== undefined && Array.isArray(body.resolutionFiles) ? JSON.stringify(body.resolutionFiles) : null,
            body.visitDate !== undefined && !body.visitDate ? '__clear__' : '',
            body.visitDate !== undefined ? parseDateOnlyValue(body.visitDate, 'visitDate') : null,
        ]);
        // Автосмена статуса: assigned если есть исполнитель без даты, in_progress если есть и исполнитель и дата
        {
            const row = result.rows[0];
            const currentStatus = normalizeText(row.status);
            const hasExecutors = Array.isArray(row.executor_ids) && row.executor_ids.length > 0;
            const hasDate = !!row.due_date_preliminary;
            const autoStatuses = new Set(['new', 'assigned', 'in_progress', 'triage']);
            if (autoStatuses.has(currentStatus)) {
                let newStatus: string | null = null;
                if (hasExecutors && hasDate) newStatus = 'in_progress';
                else if (hasExecutors && !hasDate) newStatus = 'assigned';
                else if (!hasExecutors) newStatus = 'new';
                if (newStatus && newStatus !== currentStatus) {
                    await dbQuery(`UPDATE requests SET status = $2, updated_at = now() WHERE id = $1::uuid`, [requestId, newStatus]);
                    result.rows[0].status = newStatus;
                }
            }
        }
        // Audit log
        const actorId = normalizeText(request.authUser?.id);
        const actorName = normalizeText(request.authUser?.fullName ?? request.authUser?.email) || 'Пользователь';
        const prev = existing;
        const next = result.rows[0];
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (body.title && body.title !== prev.title) changes['title'] = { from: prev.title, to: body.title };
        if (body.description !== undefined && body.description !== prev.description) changes['description'] = { from: '...', to: '...' };
        if (body.priority && body.priority !== prev.priority) changes['priority'] = { from: prev.priority, to: body.priority };
        if (body.dueDatePreliminary !== undefined) changes['dueDate'] = { from: prev.due_date_preliminary ? String(prev.due_date_preliminary).slice(0,10) : null, to: body.dueDatePreliminary || null };
        if (body.visitDate !== undefined) changes['visitDate'] = { from: prev.visit_date ? String(prev.visit_date).slice(0,10) : null, to: body.visitDate || null };
        if (Array.isArray(body.executorIds)) changes['executorIds'] = { from: prev.executor_ids, to: body.executorIds };
        if (Array.isArray(body.itemIds)) changes['itemIds'] = { from: prev.item_ids, to: body.itemIds };
        if (Object.keys(changes).length > 0) {
            void writeRequestAuditLog({
                requestId,
                actorId,
                actorName,
                changes,
            }).catch(() => {});
        }
        try {
            // In-app уведомление: исполнителям, куратору, админам — всегда
            {
                const row = result.rows[0];
                const internalRecipients = new Set<string>();
                if (Array.isArray(row.executor_ids)) {
                    for (const eid of row.executor_ids) { const n = normalizeText(eid); if (n) internalRecipients.add(n); }
                }
                const curId = normalizeText(row.curator_id);
                if (curId) internalRecipients.add(curId);
                const creatorId = normalizeText(row.created_by_id);
                if (creatorId) internalRecipients.add(creatorId);
                const admIds = await getAdminManagerIds();
                for (const aid of admIds) internalRecipients.add(aid);
                if (internalRecipients.size > 0) {
                    void pushInAppNotification({
                        recipientIds: Array.from(internalRecipients),
                        eventType: 'ticket_updated',
                        title: `Сервисная заявка обновлена`,
                        body: `Заявка отредактирована`,
                        entityType: 'service_request',
                        entityId: requestId,
                    });
                }
            }
            // Email уведомление об изменении с контактами
            if (canSendEmails()) {
                const row = result.rows[0];
                const updatedRow = mapServiceRequestRow(row);
                const prevRow = existing.rows[0];
                // Определяем изменилась ли дата выезда
                const prevVisitDate = prevRow.visit_date ? String(prevRow.visit_date).slice(0, 10) : '';
                const newVisitDate = row.visit_date ? String(row.visit_date).slice(0, 10) : '';
                const visitDateChanged = body.visitDate !== undefined && newVisitDate !== prevVisitDate && !!newVisitDate;
                // Получаем контакты исполнителей и арендатора
                const executorIds = Array.isArray(row.executor_ids) ? row.executor_ids.filter(Boolean) : [];
                const tenantId = normalizeText(row.tenant_id);
                const itemIds = Array.isArray(row.item_ids) ? row.item_ids.filter(Boolean) : [];
                // Находим арендатора через объекты если не указан напрямую
                let resolvedTenantId = tenantId;
                if (!resolvedTenantId && itemIds.length > 0) {
                    const itemTenant = await dbQuery(`SELECT tenant_id::text FROM maintenance_items WHERE id = any($1::uuid[]) AND deleted_at IS NULL AND tenant_id IS NOT NULL LIMIT 1`, [itemIds]);
                    resolvedTenantId = normalizeText(itemTenant.rows[0]?.tenant_id);
                }
                // Контакты арендатора
                let tenantContactName = '';
                let tenantContactPhone = '';
                if (resolvedTenantId) {
                    const tenantContacts = await dbQuery(`
                        SELECT u.full_name, u.phone, u.email
                        FROM app_users u
                        JOIN app_user_bindings ub ON ub.user_id = u.id
                        WHERE ub.counterparty_id = $1::uuid AND u.status = 'active'
                        LIMIT 1`, [resolvedTenantId]);
                    if (tenantContacts.rows[0]) {
                        tenantContactName = normalizeText(tenantContacts.rows[0].full_name);
                        tenantContactPhone = normalizeText(tenantContacts.rows[0].phone);
                    }
                }
                // Контакты исполнителя
                let executorContactName = '';
                let executorContactPhone = '';
                if (executorIds.length > 0) {
                    const execInfo = await dbQuery(`SELECT full_name, phone FROM app_users WHERE id = $1::uuid LIMIT 1`, [executorIds[0]]);
                    if (execInfo.rows[0]) {
                        executorContactName = normalizeText(execInfo.rows[0].full_name);
                        executorContactPhone = normalizeText(execInfo.rows[0].phone);
                    }
                }
                const scheduledDate = normalizeText(row.visit_date ? String(row.visit_date).slice(0, 10) : (row.due_date_preliminary ? String(row.due_date_preliminary).slice(0, 10) : ''));
                // Письмо исполнителям (с контактом арендатора) — при любом обновлении
                if (executorIds.length > 0) {
                    const changes: string[] = [];
                    if (body.title && body.title !== prevRow.title) changes.push(`Название: ${body.title}`);
                    if (body.description !== undefined && body.description !== prevRow.description) changes.push(`Описание обновлено`);
                    if (body.priority && body.priority !== prevRow.priority) changes.push(`Приоритет: ${body.priority}`);
                    if (body.dueDatePreliminary !== undefined) changes.push(`Дедлайн: ${body.dueDatePreliminary || 'не указан'}`);
                    if (body.visitDate !== undefined) changes.push(`Дата выезда: ${body.visitDate || 'не указана'}`);
                    if (Array.isArray(body.executorIds)) changes.push(`Исполнители обновлены`);
                    const changesText = changes.length > 0 ? changes.join('\n') : 'Заявка обновлена';
                    const execRecipients = await dbQuery(`SELECT email, full_name FROM app_users WHERE id = any($1::uuid[]) AND status = 'active' AND trim(coalesce(email,'')) <> ''`, [executorIds]);
                    for (const rec of execRecipients.rows) {
                        void sendServiceRequestEmail({
                            to: normalizeText(rec.email),
                            toName: normalizeText(rec.full_name),
                            subject: `Заявка обновлена: ${normalizeText(row.title) || requestId}`,
                            requests: [updatedRow],
                            description: changesText,
                            scheduledDate,
                            contactName: tenantContactName,
                            contactPhone: tenantContactPhone,
                            recipientRole: 'executor',
                        }).catch(() => {});
                    }
                }
                // Письмо арендатору — ТОЛЬКО при назначении/изменении даты выезда
                if (visitDateChanged && resolvedTenantId) {
                    const tenantRecipients = await dbQuery(`
                        SELECT u.email, u.full_name, u.id::text as id FROM app_users u
                        JOIN app_user_bindings ub ON ub.user_id = u.id
                        WHERE ub.counterparty_id = $1::uuid AND u.status = 'active' AND trim(coalesce(u.email,'')) <> ''`, [resolvedTenantId]);
                    const tenantUserIds = tenantRecipients.rows.map((r) => r.id).filter(Boolean);
                    // In-app уведомление (колокольчик) клиенту
                    if (tenantUserIds.length > 0) {
                        void pushInAppNotification({
                            recipientIds: tenantUserIds,
                            eventType: 'visit_date_assigned',
                            title: `Назначена дата выезда: ${newVisitDate}`,
                            body: `По заявке "${normalizeText(row.title) || requestId}" назначен выезд специалиста на ${newVisitDate}`,
                            entityType: 'service_request',
                            entityId: requestId,
                        });
                    }
                    // Email клиенту
                    for (const rec of tenantRecipients.rows) {
                        void sendServiceRequestEmail({
                            to: normalizeText(rec.email),
                            toName: normalizeText(rec.full_name),
                            subject: `Назначена дата выезда: ${newVisitDate} — ${normalizeText(row.title) || requestId}`,
                            requests: [updatedRow],
                            description: `Назначена дата выезда специалиста: ${newVisitDate}`,
                            scheduledDate: newVisitDate,
                            contactName: executorContactName,
                            contactPhone: executorContactPhone,
                            recipientRole: 'client',
                        }).catch(() => {});
                    }
                }
            }
        }
        catch {
        }

        // Handle custom fields if provided
        if (body.customFields && typeof body.customFields === 'object') {
            try {
                await setCustomFieldValues('service_request', requestId, body.customFields, actorRole);
            } catch (error) {
                logger.error('Failed to save custom fields', {
                    requestId,
                    error: serializeError(error),
                });
            }
        }

        response.status(200).json(mapServiceRequestRow(result.rows[0]));
    }));
    app.get('/service-requests/:requestId/confirm', asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        const requestId = parseUuidPath(request.params.requestId);
        const token = normalizeText(request.query?.token);
        const action = normalizeText(request.query?.action) || 'confirm';
        if (!token) throw new ApiError(422, 'VALIDATION_ERROR', 'Token is required');
        if (!['confirm', 'reschedule'].includes(action)) throw new ApiError(422, 'VALIDATION_ERROR', 'Action must be confirm or reschedule');
        const tokenCheck = await dbQuery(`SELECT id FROM service_request_confirmations WHERE request_id = $1::uuid AND token = $2 LIMIT 1`, [requestId, token]);
        if (tokenCheck.rows.length === 0) throw new ApiError(403, 'INVALID_TOKEN', 'Invalid or expired confirmation token');
        const existing = await dbQuery(`SELECT id::text, title, status, created_by_id, curator_id, executor_ids
           FROM requests
           WHERE id = $1::uuid AND deleted_at IS NULL
           LIMIT 1`, [requestId]);
        if (existing.rows.length === 0) throw new ApiError(404, 'REQUEST_NOT_FOUND', 'Request not found');
        const title = normalizeText(existing.rows[0].title) || requestId;
        const previousStatus = normalizeText(existing.rows[0].status);
        if (action === 'confirm') {
            await dbQuery(`UPDATE requests SET status = 'assigned', updated_at = now() WHERE id = $1::uuid AND status IN ('new','triage') AND deleted_at IS NULL`, [requestId]);
        }
        await dbQuery(`UPDATE service_request_confirmations SET action = $1, confirmed_at = now() WHERE request_id = $2::uuid AND token = $3`, [action, requestId, token]);
        const confirmationAuditChanges = {
            action: { from: null, to: action === 'confirm' ? 'confirmed' : 'reschedule_requested' },
        };
        if (action === 'confirm') {
            confirmationAuditChanges['status'] = { from: previousStatus || null, to: 'assigned' };
        }
        void writeRequestAuditLog({
            requestId,
            actorId: null,
            actorName: 'Клиент',
            changes: confirmationAuditChanges,
        }).catch(() => {});
        const adminIds = await getAdminManagerIds();
        void pushInAppNotification({
            recipientIds: adminIds,
            eventType: 'ticket_action',
            title: action === 'confirm' ? `Заявка согласована: ${title}` : `Запрошен перенос: ${title}`,
            body: action === 'confirm' ? 'Арендатор согласовал заявку' : 'Арендатор запросил перенос даты',
            entityType: 'service_request',
            entityId: requestId,
        });
        void notifyServiceRequestActionByEmail({
            requestId,
            requestRow: existing.rows[0],
            actionTitle: action === 'confirm' ? 'Согласование заявки' : 'Запрос переноса заявки',
            details: action === 'confirm'
                ? 'Клиент подтвердил заявку'
                : 'Клиент запросил перенос даты',
            actorId: 'client',
            actorRole: 'client',
            actionIp: normalizeText(request.ip),
        }).catch(() => {});
        const message = action === 'confirm' ? 'Заявка согласована. Спасибо!' : 'Запрос на перенос отправлен. Диспетчер свяжется с вами.';
        response.status(200).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Новинжстрой</title></head><body style="font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;"><div style="text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.1);max-width:400px;"><h1 style="color:#16a34a;font-size:24px;margin:0 0 12px;">&#10003;</h1><p style="color:#1e293b;font-size:16px;margin:0;">${message}</p></div></body></html>`);
    }));
    app.post('/service-requests/:requestId/confirm', asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        const requestId = parseUuidPath(request.params.requestId);
        const token = normalizeText(request.query?.token ?? request.body?.token);
        const action = normalizeText(request.query?.action ?? request.body?.action) || 'confirm';
        if (!token) throw new ApiError(422, 'VALIDATION_ERROR', 'Token is required');
        if (!['confirm', 'reschedule'].includes(action)) throw new ApiError(422, 'VALIDATION_ERROR', 'Action must be confirm or reschedule');
        const tokenCheck = await dbQuery(`SELECT id FROM service_request_confirmations WHERE request_id = $1::uuid AND token = $2 LIMIT 1`, [requestId, token]);
        if (tokenCheck.rows.length === 0) throw new ApiError(403, 'INVALID_TOKEN', 'Invalid or expired confirmation token');
        const existing = await dbQuery(`SELECT id::text, title, status, created_by_id, curator_id, executor_ids
           FROM requests
           WHERE id = $1::uuid AND deleted_at IS NULL
           LIMIT 1`, [requestId]);
        if (existing.rows.length === 0) throw new ApiError(404, 'REQUEST_NOT_FOUND', 'Request not found');
        const title = normalizeText(existing.rows[0].title) || requestId;
        const previousStatus = normalizeText(existing.rows[0].status);
        // Меняем статус заявки
        if (action === 'confirm') {
            await dbQuery(`UPDATE requests SET status = 'assigned', updated_at = now() WHERE id = $1::uuid AND status IN ('new','triage') AND deleted_at IS NULL`, [requestId]);
        }
        await dbQuery(`UPDATE service_request_confirmations SET action = $1, confirmed_at = now() WHERE request_id = $2::uuid AND token = $3`, [action, requestId, token]);
        const confirmationAuditChanges = {
            action: { from: null, to: action === 'confirm' ? 'confirmed' : 'reschedule_requested' },
        };
        if (action === 'confirm') {
            confirmationAuditChanges['status'] = { from: previousStatus || null, to: 'assigned' };
        }
        void writeRequestAuditLog({
            requestId,
            actorId: null,
            actorName: 'Клиент',
            changes: confirmationAuditChanges,
        }).catch(() => {});
        const adminIds = await getAdminManagerIds();
        void pushInAppNotification({
            recipientIds: adminIds,
            eventType: 'ticket_action',
            title: action === 'confirm' ? `Заявка согласована: ${title}` : `Запрошен перенос: ${title}`,
            body: action === 'confirm' ? 'Арендатор согласовал заявку' : 'Арендатор запросил перенос даты',
            entityType: 'service_request',
            entityId: requestId,
        });
        void notifyServiceRequestActionByEmail({
            requestId,
            requestRow: existing.rows[0],
            actionTitle: action === 'confirm' ? 'Согласование заявки' : 'Запрос переноса заявки',
            details: action === 'confirm'
                ? 'Клиент подтвердил заявку'
                : 'Клиент запросил перенос даты',
            actorId: 'client',
            actorRole: 'client',
            actionIp: normalizeText(request.ip),
        }).catch(() => {});
        response.status(200).json({
            status: action === 'confirm' ? 'confirmed' : 'reschedule_requested',
            message: action === 'confirm' ? 'Заявка согласована. Спасибо!' : 'Запрос на перенос отправлен. Диспетчер свяжется с вами.',
        });
    }));
    app.delete('/service-requests/:requestId', requireAuth, asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        const actorRole = request.authUser?.role ?? '';
        const actorUserId = normalizeText(request.authUser?.id);
        if (actorRole !== 'admin' && actorRole !== 'manager') {
            throw new ApiError(403, 'FORBIDDEN', 'Only admin and manager can delete service requests');
        }
        const requestId = parseUuidPath(request.params.requestId);
        const existing = await getServiceRequestByIdForActor({
            requestId,
            actorUserId,
            actorRole,
        });
        if (!existing) {
            throw new ApiError(404, 'REQUEST_NOT_FOUND', 'Service request not found');
        }
        const result = await dbQuery(`update requests
           set deleted_at = now(),
               updated_at = now()
           where id = $1::uuid
             and type <> 'installation'
             and deleted_at is null
           returning id::text as id`, [requestId]);
        if (result.rows.length === 0) {
            throw new ApiError(404, 'REQUEST_NOT_FOUND', 'Service request not found');
        }
        const deletedRow = existing ?? { id: requestId, title: requestId };
        void writeRequestAuditLog({
            requestId,
            actorId: normalizeText(request.authUser?.id),
            actorName: normalizeText(request.authUser?.fullName ?? request.authUser?.email) || 'Пользователь',
            changes: {
                action: { from: null, to: 'deleted' },
            },
        }).catch(() => {});
        const adminManagerIds = await getAdminManagerIds();
        void pushInAppNotification({
            recipientIds: adminManagerIds,
            eventType: 'ticket_deleted',
            title: 'Сервисная заявка удалена',
            body: `Заявка ${requestId} удалена`,
            entityType: 'service_request',
            entityId: String(requestId),
        });
        void notifyServiceRequestActionByEmail({
            requestId,
            requestRow: deletedRow,
            actionTitle: 'Удаление заявки',
            details: 'Заявка помечена как удалённая',
            actorId: normalizeText(request.authUser?.id),
            actorRole: normalizeText(request.authUser?.role),
            actionIp: normalizeText(request.ip),
        }).catch(() => {});
        response.status(204).send();
    }));

    // ─── Comments ────────────────────────────────────────────────────────────
    app.get('/service-requests/:requestId/comments', requireAuth, asyncHandler(async (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        const actorUserId = normalizeText(request.authUser?.id);
        if (!serviceRequestViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view service requests');
        }
        const requestId = parseUuidPath(request.params.requestId);
        const existing = await getServiceRequestByIdForActor({
            requestId,
            actorUserId,
            actorRole,
        });
        if (!existing) {
            throw new ApiError(404, 'REQUEST_NOT_FOUND', 'Service request not found');
        }
        const result = await dbQuery(`
            SELECT
                c.id::text as id,
                c.request_id::text as request_id,
                c.user_id::text as user_id,
                coalesce(u.full_name, u.email, 'Пользователь') as author_name,
                c.text,
                c.files,
                c.created_at
            FROM request_comments c
            LEFT JOIN app_users u ON u.id = c.user_id
            WHERE c.request_id = $1::uuid AND c.deleted_at IS NULL
            ORDER BY c.created_at ASC
        `, [requestId]);
        response.status(200).json(result.rows.map((row) => ({
            id: row.id,
            requestId: row.request_id,
            userId: row.user_id,
            authorName: row.author_name,
            text: row.text,
            files: Array.isArray(row.files) ? row.files : [],
            createdAt: row.created_at,
        })));
    }));

    app.post('/service-requests/:requestId/comments', requireAuth, asyncHandler(async (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        const actorUserId = normalizeText(request.authUser?.id);
        if (!serviceRequestViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to comment service requests');
        }
        const requestId = parseUuidPath(request.params.requestId);
        const existing = await getServiceRequestByIdForActor({
            requestId,
            actorUserId,
            actorRole,
        });
        if (!existing) {
            throw new ApiError(404, 'REQUEST_NOT_FOUND', 'Service request not found');
        }
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const text = normalizeText(body.text);
        if (!text) throw new ApiError(422, 'VALIDATION_ERROR', 'Text is required');
        const files = Array.isArray(body.files) ? body.files : [];
        const userId = normalizeText(request.authUser?.id);
        const result = await dbQuery(`
            INSERT INTO request_comments(request_id, user_id, text, files)
            VALUES($1::uuid, $2::uuid, $3, $4::jsonb)
            RETURNING id::text, request_id::text, user_id::text, text, files, created_at
        `, [requestId, userId, text, JSON.stringify(files)]);
        const row = result.rows[0];
        const userResult = await dbQuery(`SELECT coalesce(full_name, email, 'Пользователь') as name FROM app_users WHERE id = $1::uuid`, [userId]);
        const authorName = userResult.rows[0]?.name || 'Пользователь';
        // In-app уведомление участникам заявки
        const reqResult = await dbQuery(`SELECT executor_ids, created_by_id, curator_id, title FROM requests WHERE id = $1::uuid AND deleted_at IS NULL`, [requestId]);
        if (reqResult.rows[0]) {
            const req = reqResult.rows[0];
            const admIds = await getAdminManagerIds();
            const recipientIds = Array.from(new Set([
                ...(Array.isArray(req.executor_ids) ? req.executor_ids : []),
                req.created_by_id,
                req.curator_id,
                ...admIds,
            ].filter(Boolean)));
            if (recipientIds.length > 0) {
                void pushInAppNotification({
                    recipientIds,
                    eventType: 'ticket_comment',
                    title: `Новый комментарий: ${normalizeText(req.title) || requestId}`,
                    body: text.slice(0, 100),
                    entityType: 'service_request',
                    entityId: requestId,
                });
                // Email уведомление о новом комментарии
                if (canSendEmails()) {
                    const allowedRecipientIds = await filterNotificationRecipientIdsByEntityScope({
                        recipientIds,
                        entityType: 'service_request',
                        entityId: requestId,
                        queryFn: dbQuery,
                    });
                    if (allowedRecipientIds.length > 0) {
                        const emailRows = await dbQuery(
                            `SELECT email FROM app_users WHERE id = any($1::uuid[]) AND status = 'active' AND email IS NOT NULL`,
                            [allowedRecipientIds],
                        );
                        const reqTitle = normalizeText(req.title) || requestId;
                        const subject = `Новый комментарий: ${reqTitle}`;
                        const bodyText = `${authorName} оставил комментарий к заявке «${reqTitle}»:\n\n${text.slice(0, 500)}\n\nIP: ${normalizeIpForEmail(request.ip)}`;
                        for (const eRow of emailRows.rows) {
                            void sendSystemEventNotice({ to: eRow.email, subject, body: bodyText }).catch(() => {});
                        }
                    }
                }
            }
        }
        response.status(201).json({
            id: row.id,
            requestId: row.request_id,
            userId: row.user_id,
            authorName,
            text: row.text,
            files: Array.isArray(row.files) ? row.files : [],
            createdAt: row.created_at,
        });
    }));

    app.delete('/service-requests/:requestId/comments/:commentId', requireAuth, asyncHandler(async (request, response) => {
        const requestId = parseUuidPath(request.params.requestId);
        const commentId = parseUuidPath(request.params.commentId);
        const userId = normalizeText(request.authUser?.id);
        const actorRole = request.authUser?.role ?? '';
        const existing = await getServiceRequestByIdForActor({
            requestId,
            actorUserId: userId,
            actorRole,
        });
        if (!existing) {
            throw new ApiError(404, 'REQUEST_NOT_FOUND', 'Service request not found');
        }
        const isAdmin = projectAdminRoles.has(actorRole);
        const result = await dbQuery(`
            UPDATE request_comments SET deleted_at = now()
            WHERE id = $1::uuid AND request_id = $2::uuid AND deleted_at IS NULL
            ${isAdmin ? '' : 'AND user_id = $3::uuid'}
            RETURNING id
        `, isAdmin ? [commentId, requestId] : [commentId, requestId, userId]);
        if (result.rows.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Comment not found');
        response.status(204).send();
    }));

    // ─── Audit log ───────────────────────────────────────────────────────────
    app.get('/service-requests/:requestId/audit', requireAuth, asyncHandler(async (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        const actorUserId = normalizeText(request.authUser?.id);
        if (!serviceRequestViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view service requests');
        }
        const requestId = parseUuidPath(request.params.requestId);
        const existing = await getServiceRequestByIdForActor({
            requestId,
            actorUserId,
            actorRole,
        });
        if (!existing) {
            throw new ApiError(404, 'REQUEST_NOT_FOUND', 'Service request not found');
        }
        const result = await dbQuery(`
            SELECT id::text, request_id::text, actor_id::text, actor_name, changes, created_at
            FROM request_audit_log
            WHERE request_id = $1::uuid
            ORDER BY created_at DESC
            LIMIT 100
        `, [requestId]);
        response.status(200).json(result.rows.map((row) => ({
            id: row.id,
            actorName: row.actor_name,
            changes: row.changes,
            createdAt: row.created_at,
        })));
    }));

    app.post('/ai/suggest-request-fields', requireAuth, asyncHandler(async (request, response) => {
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        assertAiInputTextLength(body.description, 'description', ApiError);
        const description = normalizeText(body.description);
        if (!description) {
            response.status(200).json({ ...emptyAiSuggestionResponse(), _meta: { source: 'none', provider: null } });
            return;
        }
        const result = await callLLMWithFallback(aiRequestSuggestSystemPrompt, `Описание заявки:\n${description}`);
        if (!result.content) {
            response.status(200).json({
                ...emptyAiSuggestionResponse(),
                _meta: { source: result.source, provider: result.provider, error: result.error },
            });
            return;
        }
        const parsed = parseAiJson(result.content);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            response.status(200).json({
                ...emptyAiSuggestionResponse(),
                _meta: { source: result.source, provider: result.provider, error: 'invalid_json' },
            });
            return;
        }
        response.status(200).json({
            ...buildAiSuggestionResponse(parsed),
            _meta: { source: result.source, provider: result.provider },
        });
    }));
    app.post('/ai/similar-requests', requireAuth, asyncHandler(async (request, response) => {
        await ensureServiceRequestSchema();
        const actorRole = request.authUser?.role ?? '';
        const actorUserId = normalizeText(request.authUser?.id);
        if (!serviceRequestViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to access similar requests');
        }
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        assertAiInputTextLength(body.title, 'title', ApiError);
        assertAiInputTextLength(body.description, 'description', ApiError);
        const title = normalizeText(body.title);
        const description = normalizeText(body.description);
        const systemType = normalizeAiSystemType(body.systemType);
        if (!title && !description) {
            response.status(200).json({
                suggestions: [],
                _meta: { source: 'none', provider: null },
            });
            return;
        }
        const values = [];
        const push = (value) => {
            values.push(value);
            return `$${values.length}`;
        };
        const conditions = [
            `coalesce(r.is_project, false) = false`,
            `r.type <> 'installation'`,
            `r.deleted_at is null`,
            `coalesce(r.status, '') in ('done', 'closed')`,
        ];
        await appendServiceRequestScopeCondition({
            actorUserId,
            actorRole,
            conditions,
            values,
            tableAlias: 'r',
        });
        if (systemType) {
            const systemTypeRef = push(systemType);
            conditions.push(`r.system_type = ${systemTypeRef}`);
        }
        const rowsResult = await dbQuery(`select
           r.id::text as id,
           r.title,
           r.description,
           r.resolution,
           r.system_type,
           r.updated_at
         from requests r
         where ${conditions.join(' and ')}
         order by r.updated_at desc
         limit 30`, values);
        if (rowsResult.rows.length === 0) {
            response.status(200).json({
                suggestions: [],
                _meta: { source: 'none', provider: null },
            });
            return;
        }
        const requestMap = rowsResult.rows.reduce((accumulator, row) => {
            const id = normalizeText(row.id);
            if (!id) {
                return accumulator;
            }
            let resolutionText = '';
            const resolutionValue = row.resolution;
            if (resolutionValue && typeof resolutionValue === 'object') {
                resolutionText = normalizeText(resolutionValue.text);
            }
            else if (typeof resolutionValue === 'string') {
                try {
                    const parsedResolution = JSON.parse(resolutionValue);
                    resolutionText = normalizeText(parsedResolution?.text);
                }
                catch {
                    resolutionText = '';
                }
            }
            accumulator[id] = {
                requestId: id,
                title: normalizeText(row.title),
                description: normalizeText(row.description),
                resolution: resolutionText,
                systemType: normalizeText(row.system_type),
            };
            return accumulator;
        }, {});
        const candidatesPayload = Object.values(requestMap).map((item: any, index: number) => ({
            index: index + 1,
            requestId: item.requestId,
            title: item.title,
            description: item.description,
            resolution: item.resolution,
            systemType: item.systemType,
        }));
        const userPrompt = [
            `Текущая заявка:`,
            `title=${title}`,
            `description=${description}`,
            `systemType=${systemType || '-'}`,
            '',
            `Закрытые заявки:`,
            JSON.stringify(candidatesPayload, null, 2),
        ].join('\n');
        const llmResult = await callLLMWithFallback(aiSimilarRequestSystemPrompt, userPrompt);
        if (!llmResult.content) {
            response.status(200).json({
                suggestions: [],
                _meta: { source: llmResult.source, provider: llmResult.provider, error: llmResult.error },
            });
            return;
        }
        const parsed = parseAiJson(llmResult.content);
        const rawSuggestions = Array.isArray(parsed)
            ? parsed
            : (parsed && typeof parsed === 'object' && Array.isArray(parsed.suggestions) ? parsed.suggestions : []);
        const suggestions = rawSuggestions
            .map((item) => item && typeof item === 'object' ? item : {})
            .map((item) => {
            const requestId = normalizeText(item.requestId);
            if (!requestId || !requestMap[requestId]) {
                return null;
            }
            const similarityRaw = normalizeText(item.similarity).toLowerCase();
            const similarity = aiSimilarityValues.has(similarityRaw) ? similarityRaw : 'medium';
            const related = requestMap[requestId];
            return {
                requestId,
                title: related.title || requestId,
                resolution: normalizeText(item.summary) || related.resolution || related.description || '',
                similarity,
            };
        })
            .filter(Boolean)
            .slice(0, 3);
        response.status(200).json({
            suggestions,
            _meta: { source: llmResult.source, provider: llmResult.provider },
        });
    }));
};
