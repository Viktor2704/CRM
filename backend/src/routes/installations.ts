import { canUseInternalGlobalExport } from '../helpers/accessGates.js';
import {
    normalizeInstallationStage,
    assertInstallationStageTransition,
    normalizeProcurementItemStatus,
    installationStageSet,
    installationStageLabelMap,
    installationStageUpdateSchema,
    installationStageDeadlinesUpdateSchema,
    procurementItemCreateSchema,
    procurementItemUpdateSchema,
    chatMessagePinSchema,
    buildProcurementSummary,
} from '../helpers/installationHelpers.js';

export const canExportInstallations = canUseInternalGlobalExport;

export const registerMockInstallationRoutes = (params) => {
    const {
        app,
        requireAuth,
        projectCreateRoles,
        internalGlobalRoles,
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
    } = params;
    const now = new Date().toISOString();
    const plusDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const localMockInstallations: any[] = [
        {
            id: 'mock-inst-1',
            title: 'Монтаж кондиционеров',
            description: 'Монтаж и пусконаладка оборудования на объекте клиента.',
            tenantId: 'mock-tenant-1',
            status: 'in_progress',
            stage: 'in_progress',
            installationStage: 'in_progress',
            priority: 'high',
            executorIds: ['local-executor-1'],
            responsibleIds: ['local-executor-1'],
            dueDatePreliminary: plusDays(7),
            isProject: false,
            files: [],
            cancelReason: '',
            createdById: 'local-admin-1',
            createdAt: now,
            updatedAt: now,
        },
    ];
    const localMockInstallationStageDeadlines: any[] = [
        { installationId: 'mock-inst-1', stage: 'procurement', dueDate: plusDays(2) },
        { installationId: 'mock-inst-1', stage: 'in_progress', dueDate: plusDays(5) },
        { installationId: 'mock-inst-1', stage: 'acceptance', dueDate: plusDays(8) },
    ];
    const localMockInstallationProcurement: any[] = [
        {
            id: 'mock-proc-1',
            installationId: 'mock-inst-1',
            name: 'Комплект кабеля',
            quantity: 1,
            unit: 'компл',
            comment: '',
            link: '',
            status: 'needed',
            responsibleUserId: 'local-executor-1',
            files: [],
            createdAt: now,
            updatedAt: now,
        },
    ];
    const localMockInstallationChatMessages: any[] = [
        {
            id: randomUUID(),
            projectId: 'mock-inst-1',
            authorId: 'local-admin-1',
            visibility: 'internal',
            text: 'Монтаж взят в работу.',
            attachments: [],
            createdAt: now,
            editedAt: null,
            isPinned: false,
            isSystem: false,
        },
    ];
    const localMockInstallationEvents: any[] = [
        {
            id: randomUUID(),
            installationId: 'mock-inst-1',
            eventType: 'project_created',
            description: 'Монтаж создан',
            userId: 'local-admin-1',
            actorUserId: 'local-admin-1',
            payload: {},
            createdAt: now,
        },
        {
            id: randomUUID(),
            installationId: 'mock-inst-1',
            eventType: 'installation_stage_changed',
            description: 'Этап изменён на «В работе»',
            userId: 'local-admin-1',
            actorUserId: 'local-admin-1',
            payload: {},
            createdAt: now,
        },
    ];
    const findInstallation = (installationId) => localMockInstallations.find((item) => item.id === installationId) ?? null;
    const pushInstallationEvent = (installationId, eventType, description, userId = '', payload = {}) => {
        const actorUserId = normalizeText(userId);
        localMockInstallationEvents.unshift({
            id: randomUUID(),
            installationId,
            eventType,
            description,
            userId: actorUserId,
            actorUserId,
            payload: payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {},
            createdAt: new Date().toISOString(),
        });
    };
    const normalizeMockFile = (file, index, actorUserId) => ({
        id: normalizeText(file?.id) || `mock-file-${index + 1}-${randomUUID()}`,
        name: normalizeText(file?.name) || 'Файл',
        url: normalizeText(file?.url),
        type: normalizeText(file?.type),
        size: normalizeText(file?.size),
        userId: normalizeText(file?.userId) || actorUserId || undefined,
        createdAt: normalizeText(file?.createdAt) || new Date().toISOString(),
    });
    const mergeInstallationFiles = (existingFiles, nextFiles, actorUserId) => {
        const merged = new Map();
        (Array.isArray(existingFiles) ? existingFiles : []).forEach((file, index) => {
            const normalized = normalizeMockFile(file, index, normalizeText(file?.userId));
            merged.set(normalized.id, normalized);
        });
        (Array.isArray(nextFiles) ? nextFiles : []).forEach((file, index) => {
            const normalized = normalizeMockFile(file, index, actorUserId);
            merged.set(normalized.id, normalized);
        });
        return [...merged.values()];
    };
    const buildExtendedInstallationPayload = (installation) => {
        const deadlines = localMockInstallationStageDeadlines.filter((item) => item.installationId === installation.id);
        const stageDeadlines = Object.fromEntries(deadlines.map((item) => [item.stage, item.dueDate]));
        const procurementItems = localMockInstallationProcurement.filter((item) => item.installationId === installation.id);
        const procurementSummary = buildProcurementSummary(procurementItems);
        const stage = normalizeText(installation.stage || installation.installationStage || installation.status) || 'new';
        const today = new Date().toISOString().slice(0, 10);
        const overdueStages = ['completed', 'cancelled'].includes(stage)
            ? []
            : deadlines
                .filter((item) => normalizeText(item.dueDate) < today)
                .map((item) => item.stage);
        const eventsCount = localMockInstallationEvents.filter((item) => item.installationId === installation.id).length;
        const chatCount = localMockInstallationChatMessages.filter((item) => item.projectId === installation.id).length;
        const filesCount = Array.isArray(installation.files) ? installation.files.length : 0;
        return {
            ...installation,
            isProject: false,
            events: [],
            files: Array.isArray(installation.files) ? installation.files : [],
            stage,
            stageDeadlines,
            procurementSummary,
            pausedFromStage: null,
            isOverdue: Boolean(installation.isOverdue) || overdueStages.length > 0,
            overdueStages,
            tz: {
                content: '',
                latestRevision: null,
            },
            counters: {
                events: eventsCount,
                chatMessages: chatCount,
                procurementItems: procurementSummary.total,
                files: filesCount,
            },
        };
    };
    app.get('/installations/dashboard', requireAuth, (_request, response) => {
        const activeItems = localMockInstallations.filter((item) => !['done', 'closed', 'cancelled', 'completed'].includes(normalizeText(item.status).toLowerCase()));
        const completedItems = localMockInstallations.filter((item) => ['done', 'closed', 'cancelled', 'completed'].includes(normalizeText(item.status).toLowerCase()));
        const overdue = localMockInstallations.filter((item) => {
            const dueDate = normalizeText(item.dueDatePreliminary);
            return Boolean(dueDate) && dueDate < new Date().toISOString().slice(0, 10) && !['done', 'closed', 'cancelled', 'completed'].includes(normalizeText(item.status).toLowerCase());
        });
        const statusCounts = [...localMockInstallations.reduce((acc, item) => {
            const status = normalizeText(item.status) || 'new';
            acc.set(status, (acc.get(status) ?? 0) + 1);
            return acc;
        }, new Map()).entries()].map(([status, count]) => ({ status, count }));
        response.status(200).json({
            statusCounts,
            totals: {
                total: localMockInstallations.length,
                active: activeItems.length,
                completed: completedItems.length,
                overdue: overdue.length,
            },
            recent: localMockInstallations.slice(0, 5).map((item) => ({
                id: item.id,
                title: item.title,
                status: item.status,
                updatedAt: item.updatedAt,
            })),
        });
    });
    app.get('/installations', requireAuth, (_request, response) => {
        response.status(200).json({
            items: localMockInstallations,
            page: 1,
            limit: 20,
            total: localMockInstallations.length,
            totalPages: localMockInstallations.length > 0 ? 1 : 0,
        });
    });
    app.get('/installations/export', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!canExportInstallations(actorRole, internalGlobalRoles)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to export installations');
        }
        const csvRows = localMockInstallations.map((item) => [
            item.id,
            item.title,
            item.status,
            item.stage || item.installationStage || item.status,
            item.priority,
            item.tenantId,
            item.dueDatePreliminary || '',
            item.createdAt ? String(item.createdAt).slice(0, 10) : '',
        ].map((value) => {
            const text = String(value ?? '').replace(/"/g, '""');
            return `"${text}"`;
        }).join(','));
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', 'attachment; filename="installations.csv"');
        response.status(200).send(`\uFEFFid,title,status,stage,priority,tenantId,dueDatePreliminary,createdAt\n${csvRows.join('\n')}`);
    });
    app.get('/installations/export-xlsx', requireAuth, async (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!canExportInstallations(actorRole, internalGlobalRoles)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to export installations');
        }
        const { sendXlsxResponse } = await import('../helpers/xlsxHelpers.js');
        await sendXlsxResponse(response, 'installations', [
            { header: 'ID', key: 'id', width: 38 },
            { header: 'Название', key: 'title', width: 40 },
            { header: 'Статус', key: 'status', width: 20 },
            { header: 'Этап', key: 'stage', width: 20 },
            { header: 'Приоритет', key: 'priority', width: 14 },
            { header: 'Контрагент', key: 'tenantId', width: 38 },
            { header: 'Срок', key: 'dueDatePreliminary', width: 14 },
            { header: 'Создан', key: 'createdAt', width: 14 },
        ], localMockInstallations.map((item) => ({
            id: String(item.id ?? ''),
            title: String(item.title ?? ''),
            status: String(item.status ?? ''),
            stage: String(item.stage ?? item.installationStage ?? item.status ?? ''),
            priority: String(item.priority ?? ''),
            tenantId: String(item.tenantId ?? ''),
            dueDatePreliminary: String(item.dueDatePreliminary ?? ''),
            createdAt: item.createdAt ? String(item.createdAt).slice(0, 10) : '',
        })));
    });
    app.post('/installations', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectCreateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const body = getLocalMockBodyObject(request.body);
        const installation = {
            id: randomUUID(),
            title: normalizeText(body.title) || 'Mock Installation',
            description: normalizeText(body.description),
            tenantId: normalizeText(body.tenantId),
            priority: normalizeText(body.priority) || 'medium',
            executorIds: Array.isArray(body.responsibleIds) ? body.responsibleIds : (Array.isArray(body.executorIds) ? body.executorIds : []),
            responsibleIds: Array.isArray(body.responsibleIds) ? body.responsibleIds : (Array.isArray(body.executorIds) ? body.executorIds : []),
            dueDatePreliminary: normalizeText(body.dueDatePreliminary) || null,
            files: mergeInstallationFiles([], body.files, normalizeText(request.authUser?.id)),
            status: 'new',
            stage: 'new',
            installationStage: 'new',
            createdById: normalizeText(request.authUser?.id),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isProject: false,
        };
        localMockInstallations.unshift(installation);
        pushInstallationEvent(installation.id, 'created', 'Монтаж создан', normalizeText(request.authUser?.id));
        response.status(201).json(installation);
    });
    app.get('/installations/:installationId', requireAuth, (request, response) => {
        const installation = findInstallation(request.params.installationId);
        if (!installation) {
            throw new ApiError(404, 'NOT_FOUND', 'Installation not found');
        }
        const eventsCount = localMockInstallationEvents.filter((item) => item.installationId === installation.id).length;
        const chatCount = localMockInstallationChatMessages.filter((item) => item.projectId === installation.id).length;
        response.status(200).json({
            ...installation,
            isProject: false,
            events: [],
            files: Array.isArray(installation.files) ? installation.files : [],
            stage: installation.stage || installation.installationStage || installation.status || 'new',
            tz: {
                content: '',
                latestRevision: null,
            },
            counters: {
                events: eventsCount,
                chatMessages: chatCount,
            },
        });
    });
    app.get('/installations/:installationId/extended', requireAuth, (request, response) => {
        const installation = findInstallation(request.params.installationId);
        if (!installation) {
            throw new ApiError(404, 'NOT_FOUND', 'Installation not found');
        }
        response.status(200).json(buildExtendedInstallationPayload(installation));
    });
    app.patch('/installations/:installationId', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectUpdateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const installation = findInstallation(request.params.installationId);
        if (!installation) {
            throw new ApiError(404, 'NOT_FOUND', 'Installation not found');
        }
        const body = getLocalMockBodyObject(request.body);
        const previousExecutorIds = Array.isArray(installation.executorIds) ? installation.executorIds : [];
        installation.title = body.title !== undefined ? normalizeText(body.title) : installation.title;
        installation.description = body.description !== undefined ? normalizeText(body.description) : installation.description;
        installation.tenantId = body.tenantId !== undefined ? normalizeText(body.tenantId) : installation.tenantId;
        installation.priority = body.priority !== undefined ? normalizeText(body.priority) : installation.priority;
        installation.executorIds = Array.isArray(body.executorIds) ? body.executorIds : installation.executorIds;
        installation.responsibleIds = Array.isArray(body.executorIds) ? body.executorIds : installation.responsibleIds;
        installation.dueDatePreliminary = body.dueDatePreliminary !== undefined ? (normalizeText(body.dueDatePreliminary) || null) : installation.dueDatePreliminary;
        installation.updatedAt = new Date().toISOString();
        pushInstallationEvent(installation.id, 'project_updated', 'Монтаж обновлён', normalizeText(request.authUser?.id), {
            updatedFields: {
                title: body.title !== undefined,
                description: body.description !== undefined,
                tenantId: body.tenantId !== undefined,
                priority: body.priority !== undefined,
                dueDatePreliminary: body.dueDatePreliminary !== undefined,
                responsibleIds: Array.isArray(body.executorIds) && JSON.stringify(previousExecutorIds) !== JSON.stringify(body.executorIds),
            },
        });
        response.status(200).json(installation);
    });
    app.patch('/installations/:installationId/status', requireAuth, (request, response) => {
        const installation = findInstallation(request.params.installationId);
        if (!installation) {
            throw new ApiError(404, 'NOT_FOUND', 'Installation not found');
        }
        const previousStatus = normalizeText(installation.status || installation.installationStage || installation.stage) || 'new';
        const nextStatus = normalizeText(request.body?.status) || 'new';
        installation.status = nextStatus;
        installation.stage = nextStatus;
        installation.installationStage = nextStatus;
        installation.updatedAt = new Date().toISOString();
        pushInstallationEvent(installation.id, 'project_status_changed', `Статус изменён: ${nextStatus}`, normalizeText(request.authUser?.id), {
            fromStatus: previousStatus,
            toStatus: nextStatus,
            source: 'mock_status_endpoint',
        });
        response.status(200).json({
            ...installation,
        });
    });
    app.patch('/installations/:installationId/files', requireAuth, (request, response) => {
        const installation = findInstallation(request.params.installationId);
        if (!installation) {
            throw new ApiError(404, 'NOT_FOUND', 'Installation not found');
        }
        const actorUserId = normalizeText(request.authUser?.id);
        const nextFiles = Array.isArray(request.body?.files) ? request.body.files : [];
        installation.files = mergeInstallationFiles(installation.files, nextFiles, actorUserId);
        installation.updatedAt = new Date().toISOString();
        if (nextFiles.length > 0) {
            pushInstallationEvent(installation.id, 'project_files_added', 'Добавлен файл', actorUserId, {
                addedCount: nextFiles.length,
                files: nextFiles.slice(0, 30).map((file) => ({
                    id: normalizeText(file?.id),
                    name: normalizeText(file?.name),
                    url: normalizeText(file?.url),
                })),
            });
        }
        response.status(200).json({
            ...installation,
        });
    });
    app.delete('/installations/:installationId/files', requireAuth, (request, response) => {
        const installation = findInstallation(request.params.installationId);
        if (!installation) {
            throw new ApiError(404, 'NOT_FOUND', 'Installation not found');
        }
        const fileIds = Array.isArray(request.body?.fileIds) ? request.body.fileIds.map((value) => normalizeText(value)) : [];
        installation.files = (Array.isArray(installation.files) ? installation.files : []).filter((file) => !fileIds.includes(normalizeText(file?.id)));
        installation.updatedAt = new Date().toISOString();
        if (fileIds.length > 0) {
            pushInstallationEvent(installation.id, 'project_files_removed', 'Удалён файл', normalizeText(request.authUser?.id), {
                removedCount: fileIds.length,
                remainingCount: Array.isArray(installation.files) ? installation.files.length : 0,
            });
        }
        response.status(200).json({
            ...installation,
        });
    });
    app.patch('/installations/:installationId/deadline', requireAuth, (request, response) => {
        const installation = findInstallation(request.params.installationId);
        if (!installation) {
            throw new ApiError(404, 'NOT_FOUND', 'Installation not found');
        }
        const body = getLocalMockBodyObject(request.body);
        const oldDue = normalizeText(installation.dueDatePreliminary);
        const nextDue = normalizeText(body.due_date) || normalizeText(body.dueDatePreliminary) || installation.dueDatePreliminary;
        installation.dueDatePreliminary = nextDue;
        installation.dueDateAdmin = nextDue;
        installation.updatedAt = new Date().toISOString();
        pushInstallationEvent(installation.id, 'project_due_changed', 'Изменён дедлайн монтажа', normalizeText(request.authUser?.id), {
            oldDue: oldDue || null,
            newDue: normalizeText(nextDue) || null,
            reason: normalizeText(body.reason),
        });
        response.status(200).json({
            ...installation,
            deadlineChange: {
                oldDue: oldDue || null,
                newDue: normalizeText(nextDue) || null,
                severity: oldDue && nextDue && nextDue > oldDue ? 'warning' : 'info',
                isBadAction: !!oldDue && !!nextDue && nextDue > oldDue,
                tzRevisionNo: null,
            },
        });
    });
    app.patch('/installations/:installationId/stage', requireAuth, (request, response) => {
        const installation = findInstallation(request.params.installationId);
        if (!installation) {
            throw new ApiError(404, 'NOT_FOUND', 'Installation not found');
        }
        const currentStage = normalizeText(installation.stage || installation.installationStage || installation.status) || 'new';
        const nextStage = normalizeText(request.body?.stage) || 'new';
        installation.status = nextStage;
        installation.stage = nextStage;
        installation.installationStage = nextStage;
        installation.updatedAt = new Date().toISOString();
        pushInstallationEvent(installation.id, 'project_stage_changed', `Этап изменён: ${nextStage}`, normalizeText(request.authUser?.id), {
            fromStage: currentStage,
            toStage: nextStage,
            fromLabel: installationStageLabelMap[currentStage] || currentStage,
            toLabel: installationStageLabelMap[nextStage] || nextStage,
        });
        response.status(200).json({
            ...installation,
            stageTransition: {
                from: currentStage,
                to: nextStage,
            },
        });
    });
    app.patch('/installations/:installationId/installation-stage', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!installationStageEditRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const installation = findInstallation(request.params.installationId);
        if (!installation) {
            throw new ApiError(404, 'NOT_FOUND', 'Installation not found');
        }
        const body = installationStageUpdateSchema.parse(request.body ?? {});
        const nextStage = normalizeInstallationStage(body.stage);
        const currentStage = normalizeText(installation.stage || installation.installationStage || installation.status) || 'new';
        assertInstallationStageTransition(currentStage, nextStage);
        installation.status = nextStage;
        installation.stage = nextStage;
        installation.installationStage = nextStage;
        installation.cancelReason = normalizeText(body.cancelReason) || installation.cancelReason;
        installation.updatedAt = new Date().toISOString();
        const stageLabel = installationStageLabelMap[nextStage] || nextStage;
        pushInstallationEvent(installation.id, 'installation_stage_changed', `Этап изменён на «${stageLabel}»`, normalizeText(request.authUser?.id), {
            fromStage: currentStage,
            toStage: nextStage,
            fromLabel: installationStageLabelMap[currentStage] || currentStage,
            toLabel: stageLabel,
            reason: normalizeText(body.reason),
            overrideReason: normalizeText(body.overrideReason),
            cancelReason: normalizeText(body.cancelReason),
            cancelComment: normalizeText(body.cancelComment),
            pauseReason: normalizeText(body.pauseReason),
        });
        response.status(200).json(installation);
    });
    app.get('/installations/:installationId/stage-deadlines', requireAuth, (request, response) => {
        const deadlines = localMockInstallationStageDeadlines
            .filter((item) => item.installationId === request.params.installationId)
            .map((item) => ({ stage: item.stage, dueDate: item.dueDate }));
        response.status(200).json({
            items: deadlines,
            deadlines,
        });
    });
    app.put('/installations/:installationId/stage-deadlines', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!installationDeadlineEditRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const installation = findInstallation(request.params.installationId);
        if (!installation) {
            throw new ApiError(404, 'NOT_FOUND', 'Installation not found');
        }
        const body = installationStageDeadlinesUpdateSchema.parse(request.body ?? {});
        body.deadlines.forEach((item) => {
            if (!installationStageSet.has(item.stage)) {
                throw new ApiError(422, 'VALIDATION_ERROR', `Invalid stage: ${item.stage}`);
            }
            const previous = localMockInstallationStageDeadlines.find((deadline) => deadline.installationId === installation.id && deadline.stage === item.stage);
            const existingIndex = localMockInstallationStageDeadlines.findIndex((deadline) => deadline.installationId === installation.id && deadline.stage === item.stage);
            if (existingIndex >= 0) {
                localMockInstallationStageDeadlines[existingIndex] = {
                    installationId: installation.id,
                    stage: item.stage,
                    dueDate: item.dueDate,
                };
            }
            else {
                localMockInstallationStageDeadlines.push({
                    installationId: installation.id,
                    stage: item.stage,
                    dueDate: item.dueDate,
                });
            }
            pushInstallationEvent(installation.id, 'installation_deadline_changed', `Дедлайн этапа ${installationStageLabelMap[item.stage] || item.stage}: ${item.dueDate}`, normalizeText(request.authUser?.id), {
                stage: item.stage,
                oldDate: normalizeText(previous?.dueDate) || null,
                newDate: item.dueDate,
                reason: normalizeText(body.reason),
            });
        });
        const deadlines = localMockInstallationStageDeadlines
            .filter((item) => item.installationId === installation.id)
            .map((item) => ({ stage: item.stage, dueDate: item.dueDate }));
        response.status(200).json({
            items: deadlines,
            deadlines,
        });
    });
    app.patch('/installations/:installationId/tz', requireAuth, (request, response) => {
        response.status(200).json({
            id: request.params.installationId,
        });
    });
    app.patch('/installations/:installationId/members', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectUpdateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const installation = findInstallation(request.params.installationId);
        if (!installation) {
            throw new ApiError(404, 'NOT_FOUND', 'Installation not found');
        }
        const memberIds = Array.isArray(request.body?.add) ? request.body.add : [];
        const currentMembers = Array.isArray(installation.executorIds) ? installation.executorIds.map((value) => normalizeText(value)).filter(Boolean) : [];
        installation.executorIds = memberIds;
        installation.responsibleIds = memberIds;
        installation.updatedAt = new Date().toISOString();
        pushInstallationEvent(installation.id, 'project_members_changed', 'Состав исполнителей изменён', normalizeText(request.authUser?.id), {
            added: memberIds.filter((value) => !currentMembers.includes(normalizeText(value))),
            removed: currentMembers.filter((value) => !memberIds.includes(value)),
            total: memberIds.length,
        });
        response.status(200).json({
            ...installation,
        });
    });
    app.delete('/installations/:installationId', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectDeleteRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const index = localMockInstallations.findIndex((item) => item.id === request.params.installationId);
        if (index >= 0) {
            localMockInstallations.splice(index, 1);
        }
        response.status(204).send();
    });
    app.get('/installations/:installationId/procurement', requireAuth, (request, response) => {
        const items = localMockInstallationProcurement.filter((item) => item.installationId === request.params.installationId);
        response.status(200).json({
            items,
            summary: buildProcurementSummary(items),
        });
    });
    app.post('/installations/:installationId/procurement', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!installationProcurementRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const installation = findInstallation(request.params.installationId);
        if (!installation) {
            throw new ApiError(404, 'NOT_FOUND', 'Installation not found');
        }
        const body = procurementItemCreateSchema.parse(request.body ?? {});
        const item = {
            id: randomUUID(),
            installationId: installation.id,
            name: body.name,
            quantity: body.quantity,
            unit: body.unit,
            comment: body.comment,
            link: body.link,
            status: 'needed',
            responsibleUserId: normalizeText(body.responsibleUserId) || null,
            files: Array.isArray(body.files) ? body.files : [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        localMockInstallationProcurement.push(item);
        installation.updatedAt = new Date().toISOString();
        pushInstallationEvent(installation.id, 'installation_procurement_changed', `Добавлена позиция закупки «${item.name}»`, normalizeText(request.authUser?.id), {
            action: 'added',
            itemId: item.id,
            name: item.name,
            quantity: item.quantity,
        });
        response.status(201).json(item);
    });
    app.patch('/installations/:installationId/procurement/:itemId', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!installationProcurementRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const installation = findInstallation(request.params.installationId);
        if (!installation) {
            throw new ApiError(404, 'NOT_FOUND', 'Installation not found');
        }
        const index = localMockInstallationProcurement.findIndex((item) => item.installationId === installation.id && item.id === request.params.itemId);
        if (index < 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Procurement item not found');
        }
        const body = procurementItemUpdateSchema.parse(request.body ?? {});
        const nextItem = {
            ...localMockInstallationProcurement[index],
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
            ...(body.unit !== undefined ? { unit: body.unit } : {}),
            ...(body.comment !== undefined ? { comment: body.comment } : {}),
            ...(body.link !== undefined ? { link: body.link } : {}),
            ...(body.files !== undefined ? { files: body.files } : {}),
            ...(body.responsibleUserId !== undefined ? { responsibleUserId: normalizeText(body.responsibleUserId) || null } : {}),
            ...(body.status !== undefined ? { status: normalizeProcurementItemStatus(body.status) } : {}),
            updatedAt: new Date().toISOString(),
        };
        localMockInstallationProcurement[index] = nextItem;
        installation.updatedAt = new Date().toISOString();
        pushInstallationEvent(installation.id, 'installation_procurement_changed', `Обновлена позиция закупки «${nextItem.name}»`, normalizeText(request.authUser?.id), {
            action: 'updated',
            itemId: nextItem.id,
            changes: body,
        });
        const summary = buildProcurementSummary(localMockInstallationProcurement.filter((item) => item.installationId === installation.id));
        if (nextItem.status === 'received' && summary.allReceived) {
            localMockInstallationChatMessages.push({
                id: randomUUID(),
                projectId: installation.id,
                authorId: normalizeText(request.authUser?.id),
                userId: normalizeText(request.authUser?.id),
                visibility: 'client-visible',
                text: 'Закупка: все позиции получены',
                createdAt: new Date().toISOString(),
                editedAt: null,
                attachments: [],
                isPinned: false,
                isSystem: true,
            });
        }
        response.status(200).json(nextItem);
    });
    app.delete('/installations/:installationId/procurement/:itemId', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!installationProcurementRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const installation = findInstallation(request.params.installationId);
        if (!installation) {
            throw new ApiError(404, 'NOT_FOUND', 'Installation not found');
        }
        const index = localMockInstallationProcurement.findIndex((item) => item.installationId === installation.id && item.id === request.params.itemId);
        if (index < 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Procurement item not found');
        }
        const [removed] = localMockInstallationProcurement.splice(index, 1);
        installation.updatedAt = new Date().toISOString();
        pushInstallationEvent(installation.id, 'installation_procurement_changed', `Удалена позиция закупки «${normalizeText(removed?.name) || 'Без названия'}»`, normalizeText(request.authUser?.id), {
            action: 'deleted',
            itemId: normalizeText(removed?.id),
            name: normalizeText(removed?.name) || 'Без названия',
        });
        response.status(204).send();
    });
    app.get('/installations/:installationId/events', requireAuth, (request, response) => {
        const items = localMockInstallationEvents.filter((item) => item.installationId === request.params.installationId);
        response.status(200).json({
            items,
            page: 1,
            limit: 20,
            total: items.length,
            totalPages: items.length > 0 ? 1 : 0,
        });
    });
    app.get('/installations/:installationId/chat/messages', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        const isClientRole = ['installer', 'client_manager', 'client_user', 'user'].includes(actorRole);
        const items = localMockInstallationChatMessages
            .filter((item) => item.projectId === request.params.installationId)
            .filter((item) => !isClientRole || item.visibility !== 'internal')
            .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
        response.status(200).json({
            items,
            page: 1,
            limit: 20,
            total: items.length,
            totalPages: items.length > 0 ? 1 : 0,
        });
    });
    app.post('/installations/:installationId/chat/messages', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectChatWriteRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const installation = findInstallation(request.params.installationId);
        if (!installation) {
            throw new ApiError(404, 'NOT_FOUND', 'Installation not found');
        }
        const message = {
            id: randomUUID(),
            projectId: request.params.installationId,
            authorId: normalizeText(request.authUser?.id),
            userId: normalizeText(request.authUser?.id),
            visibility: normalizeText(request.body?.visibility) || 'internal',
            text: request.body?.text ?? '',
            createdAt: new Date().toISOString(),
            attachments: [],
            isPinned: false,
            isSystem: false,
        };
        localMockInstallationChatMessages.push(message);
        pushInstallationEvent(installation.id, 'project_chat_message_created', 'Добавлено сообщение в чат', normalizeText(request.authUser?.id), {
            visibility: normalizeText(message.visibility),
        });
        response.status(201).json(message);
    });
    app.patch('/installations/:installationId/chat/messages/:messageId/pin', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectChatWriteRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const body = chatMessagePinSchema.parse(request.body ?? {});
        const index = localMockInstallationChatMessages.findIndex((item) => item.projectId === request.params.installationId && item.id === request.params.messageId);
        if (index < 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Chat message not found');
        }
        localMockInstallationChatMessages[index] = {
            ...localMockInstallationChatMessages[index],
            isPinned: body.pinned,
            editedAt: new Date().toISOString(),
        };
        response.status(200).json(localMockInstallationChatMessages[index]);
    });
    app.get('/installations/:installationId/chat/pinned', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        const isClientRole = ['installer', 'client_manager', 'client_user', 'user'].includes(actorRole);
        const items = localMockInstallationChatMessages
            .filter((item) => item.projectId === request.params.installationId && item.isPinned)
            .filter((item) => !isClientRole || item.visibility !== 'internal')
            .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
        response.status(200).json({
            items,
        });
    });
};

export const registerInstallationRoutes = (params) => {
    const {
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
        internalGlobalRoles,
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
    } = params;
    app.get('/installations/export', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!canExportInstallations(actorRole, internalGlobalRoles)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to export installations');
        }
        const conditions = [
            `r.type = 'installation'`,
            `coalesce(r.is_project, false) = false`,
            `r.deleted_at is null`,
        ];
        const values = [];
        await appendProjectScopeCondition({
            actorUserId,
            actorRole,
            conditions,
            values,
        });
        const result = await dbQuery(`SELECT r.id, r.title, r.status, r.priority, r.tenant_id, r.due_date_preliminary, r.created_at
           FROM requests r
           WHERE ${conditions.join(' AND ')}
           ORDER BY r.created_at DESC`, values);
        const csvRows = result.rows.map((row) => [
            toCsvCell(row.id),
            toCsvCell(row.title),
            toCsvCell(row.status),
            toCsvCell(row.priority),
            toCsvCell(row.tenant_id),
            toCsvCell(row.due_date_preliminary ? String(row.due_date_preliminary).slice(0, 10) : ''),
            toCsvCell(row.created_at ? String(row.created_at).slice(0, 10) : ''),
        ].join(','));
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', 'attachment; filename="installations.csv"');
        response.status(200).send(`\uFEFFid,title,status,priority,tenantId,dueDatePreliminary,createdAt\n${csvRows.join('\n')}`);
    }));
    app.get('/installations/export-xlsx', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!canExportInstallations(actorRole, internalGlobalRoles)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to export installations');
        }
        const conditions = [
            `r.type = 'installation'`,
            `coalesce(r.is_project, false) = false`,
            `r.deleted_at is null`,
        ];
        const values = [];
        await appendProjectScopeCondition({
            actorUserId,
            actorRole,
            conditions,
            values,
        });
        const result = await dbQuery(`SELECT r.id, r.title, r.status, r.priority, r.tenant_id, r.due_date_preliminary, r.created_at
           FROM requests r
           WHERE ${conditions.join(' AND ')}
           ORDER BY r.created_at DESC`, values);
        const { sendXlsxResponse } = await import('../helpers/xlsxHelpers.js');
        await sendXlsxResponse(response, 'installations', [
            { header: 'ID', key: 'id', width: 38 },
            { header: 'Название', key: 'title', width: 40 },
            { header: 'Статус', key: 'status', width: 20 },
            { header: 'Приоритет', key: 'priority', width: 14 },
            { header: 'Контрагент', key: 'tenantId', width: 38 },
            { header: 'Срок', key: 'dueDatePreliminary', width: 14 },
            { header: 'Создан', key: 'createdAt', width: 14 },
        ], result.rows.map((row) => ({
            id: String(row.id ?? ''),
            title: String(row.title ?? ''),
            status: String(row.status ?? ''),
            priority: String(row.priority ?? ''),
            tenantId: String(row.tenant_id ?? ''),
            dueDatePreliminary: row.due_date_preliminary ? String(row.due_date_preliminary).slice(0, 10) : '',
            createdAt: row.created_at ? String(row.created_at).slice(0, 10) : '',
        })));
    }));
    app.get('/installations/dashboard', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view installations dashboard');
        }
        const scopeConditions = [
            `r.type = 'installation'`,
            `coalesce(r.is_project, false) = false`,
            `r.deleted_at is null`,
        ];
        const values = [];
        await appendProjectScopeCondition({
            actorUserId,
            actorRole,
            conditions: scopeConditions,
            values,
        });
        const scopeWhere = scopeConditions.join(' and ');
        const result = await withTx(async (client) => {
            await client.query(`set local statement_timeout = '3000ms'`);
            const statusCountResult = await client.query(`select
               coalesce(r.status, 'new') as status,
               count(*)::int as count
             from requests r
             where ${scopeWhere}
             group by coalesce(r.status, 'new')
             order by count desc`, values);
            const totalsResult = await client.query(`select
               count(*)::int as total,
               count(*) filter (
                 where coalesce(r.status, '') not in ('done', 'closed', 'cancelled')
               )::int as active,
               count(*) filter (
                 where coalesce(r.status, '') in ('done', 'closed', 'cancelled')
               )::int as completed,
               count(*) filter (
                 where coalesce(r.due_date_admin, r.due_date_preliminary) < current_date
                   and coalesce(r.status, '') not in ('done', 'closed', 'cancelled')
               )::int as overdue
             from requests r
             where ${scopeWhere}`, values);
            const recentResult = await client.query(`select
               r.id::text as id,
               r.title,
               r.status,
               r.updated_at
             from requests r
             where ${scopeWhere}
             order by r.updated_at desc nulls last
             limit 5`, values);
            return {
                statusCounts: statusCountResult.rows,
                totals: totalsResult.rows[0] ?? { total: 0, active: 0, completed: 0, overdue: 0 },
                recent: recentResult.rows,
            };
        });
        response.status(200).json({
            statusCounts: result.statusCounts.map((row) => ({
                status: normalizeText(row.status) || 'new',
                count: Number(row.count ?? 0),
            })),
            totals: {
                total: Number(result.totals.total ?? 0),
                active: Number(result.totals.active ?? 0),
                completed: Number(result.totals.completed ?? 0),
                overdue: Number(result.totals.overdue ?? 0),
            },
            recent: result.recent.map((row) => ({
                id: normalizeText(row.id),
                title: normalizeText(row.title),
                status: normalizeText(row.status) || 'new',
                updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
            })),
        });
    }));
    app.get('/installations', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view installations');
        }
        const typeFilter = normalizeText(request.query?.type).toLowerCase();
        if (typeFilter && typeFilter !== 'installation') {
            response.status(200).json({
                items: [],
                page: 1,
                limit: 20,
                total: 0,
                totalPages: 0,
            });
            return;
        }
        const search = normalizeSearchQuery(request.query?.search);
        const statuses = parseStatusQueryFilter(request.query?.status);
        const assigneeId = normalizeText(request.query?.responsible_id ?? request.query?.assignee_id);
        if (assigneeId && !isUuidValue(assigneeId)) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'responsible_id must be UUID');
        }
        const tenantId = normalizeText(request.query?.tenant_id);
        const directionId = normalizeText(request.query?.direction_id);
        const systemType = normalizeText(request.query?.system_type);
        const createdFrom = parseDateTimeFilter(request.query?.created_from ?? request.query?.date_from, 'created_from');
        const createdTo = parseDateTimeFilter(request.query?.created_to ?? request.query?.date_to, 'created_to');
        const dueFrom = parseDateOnlyValue(request.query?.due_from, 'due_from');
        const dueTo = parseDateOnlyValue(request.query?.due_to, 'due_to');
        if (createdFrom && createdTo && createdTo.getTime() < createdFrom.getTime()) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'created_to cannot be earlier than created_from');
        }
        if (dueFrom && dueTo && dueTo < dueFrom) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'due_to cannot be earlier than due_from');
        }
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
        const sortExpression = projectSortFieldMap[sortInput] ?? projectSortFieldMap.created_at;
        const tab = normalizeText(request.query?.tab).toLowerCase();
        const scopeConditions = [
            `r.type = 'installation'`,
            `coalesce(r.is_project, false) = false`,
            `r.deleted_at is null`,
        ];
        const values = [];
        await appendProjectScopeCondition({
            actorUserId,
            actorRole,
            conditions: scopeConditions,
            values,
        });
        const filterConditions = [];
        if (statuses.length > 0) {
            values.push(statuses);
            filterConditions.push(`s.status = any($${values.length}::text[])`);
        }
        if (assigneeId) {
            values.push(assigneeId);
            filterConditions.push(`$${values.length}::text = any(coalesce(s.executor_ids, '{}'::text[]))`);
        }
        if (tenantId) {
            values.push(tenantId);
            filterConditions.push(`s.tenant_id = $${values.length}::text`);
        }
        if (directionId) {
            values.push(directionId);
            filterConditions.push(`s.direction_id = $${values.length}::text`);
        }
        if (systemType) {
            values.push(systemType);
            filterConditions.push(`s.system_type = $${values.length}::text`);
        }
        if (createdFrom) {
            values.push(createdFrom.toISOString());
            filterConditions.push(`s.created_at >= $${values.length}::timestamptz`);
        }
        if (createdTo) {
            values.push(createdTo.toISOString());
            filterConditions.push(`s.created_at <= $${values.length}::timestamptz`);
        }
        if (dueFrom) {
            values.push(dueFrom);
            filterConditions.push(`coalesce(s.due_date_admin, s.due_date_preliminary) >= $${values.length}::date`);
        }
        if (dueTo) {
            values.push(dueTo);
            filterConditions.push(`coalesce(s.due_date_admin, s.due_date_preliminary) <= $${values.length}::date`);
        }
        if (tab === 'active') {
            filterConditions.push(`coalesce(s.status, '') not in ('done', 'closed', 'cancelled')`);
        }
        if (tab === 'closed') {
            filterConditions.push(`coalesce(s.status, '') in ('done', 'closed', 'cancelled')`);
        }
        if (search) {
            const escapedLike = `%${escapeLikePattern(search)}%`;
            if (isUuidValue(search)) {
                values.push(search);
                const idRef = `$${values.length}`;
                values.push(escapedLike);
                const likeRef = `$${values.length}`;
                filterConditions.push(`(
                  s.id::text = ${idRef}
                  or s.title ilike ${likeRef} escape '\\'
                  or s.description ilike ${likeRef} escape '\\'
                )`);
            }
            else {
                values.push(search);
                const tsRef = `$${values.length}`;
                values.push(escapedLike);
                const likeRef = `$${values.length}`;
                filterConditions.push(`(
                  to_tsvector('simple', coalesce(s.title, '') || ' ' || coalesce(s.description, '')) @@ websearch_to_tsquery('simple', ${tsRef})
                  or s.title ilike ${likeRef} escape '\\'
                  or s.description ilike ${likeRef} escape '\\'
                )`);
            }
        }
        const scopedWhereSql = scopeConditions.join('\n         and ');
        const filteredWhereSql = filterConditions.length > 0
            ? filterConditions.join('\n             and ')
            : 'true';
        const scopedCteSql = `with scoped as (
             select
               ${projectSelectColumnsSql}
             from requests r
             where ${scopedWhereSql}
           ),
           filtered as (
             select *
             from scoped s
             where ${filteredWhereSql}
           )`;
        const countSql = `${scopedCteSql}
           select count(*)::int as total
           from filtered`;
        const pageValues = [...values, limit, offset];
        const limitRef = `$${pageValues.length - 1}`;
        const offsetRef = `$${pageValues.length}`;
        const itemsSql = `${scopedCteSql}
           select *
           from filtered s
           order by ${sortExpression} ${order}, s.id desc
           limit ${limitRef}::int
           offset ${offsetRef}::int`;
        const queryResult = await withTx(async (client) => {
            await client.query(`set local statement_timeout = '1800ms'`);
            const [countResult, rowsResult] = await Promise.all([
                client.query(countSql, values),
                client.query(itemsSql, pageValues),
            ]);
            return {
                total: Number(countResult.rows[0]?.total ?? 0),
                rows: rowsResult.rows,
            };
        });
        const totalPages = queryResult.total > 0 ? Math.ceil(queryResult.total / limit) : 0;
        logger.info('Installations search completed', {
            requestId: request.requestId ?? null,
            userId: actorUserId,
            role: actorRole,
            page,
            limit,
            total: queryResult.total,
            returned: queryResult.rows.length,
            hasSearch: search.length > 0,
            hasStatusFilter: statuses.length > 0,
        });
        response.status(200).json({
            items: queryResult.rows.map(mapProjectRow),
            page,
            limit,
            total: queryResult.total,
            totalPages,
        });
    }));
    app.post('/installations', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectCreateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to create installations');
        }
        const body = projectCreateSchema.parse(request.body ?? {});
        const title = normalizeText(body.title);
        if (!title) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'title is required');
        }
        const description = normalizeText(body.description);
        const tenantId = normalizeText(body.tenantId);
        if (tenantId) {
            const tenantCheck = await dbQuery('SELECT coalesce(type, \'tenant\') as type FROM tenants WHERE id = $1::uuid AND deleted_at IS NULL', [tenantId]);
            if (tenantCheck.rows.length > 0 && tenantCheck.rows[0].type !== 'contractor') {
                throw new ApiError(422, 'VALIDATION_ERROR', 'Only contractor-type tenants can be assigned to installations');
            }
        }
        const directionId = normalizeText(body.directionId);
        const systemType = normalizeText(body.systemType);
        const priority = normalizeText(body.priority) || 'medium';
        const dueDatePreliminary = parseDateOnlyValue(body.dueDatePreliminary, 'dueDatePreliminary');
        const dueDateAdmin = parseDateOnlyValue(body.dueDateAdmin, 'dueDateAdmin');
        const executorIds = Array.from(new Set((body.responsibleIds ?? [])
            .map((value) => normalizeText(value))
            .filter((value) => value.length > 0)));
        const status = body.status ? normalizeProjectStatus(body.status) : (executorIds.length > 0 ? 'assigned' : 'awaiting_assignment');
        const bindableUsers = Array.from(new Set([
            ...executorIds.filter((value) => isUuidValue(value)),
            ...(isUuidValue(actorUserId) ? [actorUserId] : []),
        ]));
        const filesPayload = normalizeProjectFiles(body.files ?? []);
        const row = await withTx(async (client) => {
            const createdResult = await client.query(`insert into requests(
             type,
             is_project,
             title,
             description,
             tenant_id,
             direction_id,
             system_type,
             priority,
             status,
             created_by_id,
             executor_ids,
             due_date_preliminary,
             due_date_admin,
             files,
             created_at,
             updated_at
           )
           values(
             'installation',
             $1::boolean,
             $2,
             $3,
             $4,
             $5,
             $6,
             $7,
             $8,
             $9,
             $10::text[],
             $11::date,
             $12::date,
             $13::jsonb,
             now(),
             now()
           )
           returning
             id::text as id,
             type::text as type,
             coalesce(is_project, false) as is_project,
             coalesce(title, '') as title,
             coalesce(description, '') as description,
             coalesce(tenant_id, '') as tenant_id,
             coalesce(direction_id, '') as direction_id,
             coalesce(system_type, '') as system_type,
             coalesce(priority, 'medium') as priority,
             coalesce(status, 'new') as status,
             coalesce(created_by_id, '') as created_by_id,
             coalesce(executor_ids, '{}'::text[]) as executor_ids,
             coalesce(files, '[]'::jsonb) as files,
             created_at as created_at,
             updated_at as updated_at,
             due_date_preliminary as due_date_preliminary,
             due_date_admin as due_date_admin`, [
                false,
                title,
                description,
                tenantId || null,
                directionId || null,
                systemType || null,
                priority,
                status,
                actorUserId || null,
                executorIds,
                dueDatePreliminary,
                dueDateAdmin,
                JSON.stringify(filesPayload),
            ]);
            const createdRow = createdResult.rows[0];
            if (!createdRow) {
                throw new ApiError(500, 'INSTALLATION_CREATE_FAILED', 'Failed to create installation');
            }
            if (bindableUsers.length > 0) {
                await client.query(`insert into app_user_project_bindings(user_id, project_id)
             select distinct unnest($2::uuid[]), $1::uuid
             on conflict(user_id, project_id) do nothing`, [createdRow.id, bindableUsers]);
            }
            return createdRow;
        });
        await sendProjectNotificationBestEffort({
            request,
            actorUserId,
            actorRole,
            projectId: normalizeText(row.id),
            projectRow: row,
            eventType: 'project_created',
            commentText: 'Создан новый монтаж',
            dedupeToken: normalizeText(row.id),
        });
        void pushProjectInAppNotification({
            projectId: normalizeText(row.id),
            eventType: 'project_created',
            title: `Создан монтаж: ${normalizeText(row.title) || normalizeText(row.id)}`,
            body: 'Создан новый монтаж',
            actorUserId,
        });
        if (isUuidValue(tenantId) && dispatchContractorTenantNotifications) {
            void dispatchContractorTenantNotifications({
                tenantId,
                entityType: 'installation',
                entityId: normalizeText(row.id),
                title: `Создан монтаж: ${normalizeText(row.title) || normalizeText(row.id)}`,
                body: 'Создан новый монтаж',
                eventType: 'installation_created',
                actorUserId,
                requestContext: request,
            });
        }
        response.status(201).json(mapProjectRow(row));
    }));
    app.get('/installations/:installationId', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view installations');
        }
        const installationId = parseUuidPath(request.params.installationId);
        const result = await withTx(async (client) => {
            const row = await getInstallationByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                installationId,
                lock: false,
            });
            const [latestTzRevisionResult, eventsCountResult, chatCountResult] = await Promise.all([
                client.query(`select
                 revision_no,
                 old_value,
                 new_value,
                 reason,
                 changed_by::text as changed_by,
                 changed_at,
                 event_type,
                 coalesce(metadata, '{}'::jsonb) as metadata
               from project_tz_revisions
               where project_id = $1::uuid
               order by revision_no desc
               limit 1`, [installationId]),
                client.query(`select count(*)::int as total
               from project_events
               where project_id = $1::uuid`, [installationId]),
                client.query(`select count(*)::int as total
               from project_chat_messages
               where project_id = $1::uuid
                 and deleted_at is null`, [installationId]),
            ]);
            return {
                row,
                latestTzRevision: latestTzRevisionResult.rows[0] ?? null,
                eventsTotal: Number(eventsCountResult.rows[0]?.total ?? 0),
                chatMessagesTotal: Number(chatCountResult.rows[0]?.total ?? 0),
            };
        });
        const installation = mapProjectRow(result.row);
        const latestTz = result.latestTzRevision ? {
            revisionNo: Number(result.latestTzRevision.revision_no ?? 0),
            oldValue: typeof result.latestTzRevision.old_value === 'string' ? result.latestTzRevision.old_value : '',
            newValue: typeof result.latestTzRevision.new_value === 'string' ? result.latestTzRevision.new_value : '',
            reason: normalizeText(result.latestTzRevision.reason),
            changedBy: normalizeText(result.latestTzRevision.changed_by),
            changedAt: result.latestTzRevision.changed_at ? new Date(result.latestTzRevision.changed_at).toISOString() : null,
            eventType: normalizeText(result.latestTzRevision.event_type),
            metadata: result.latestTzRevision.metadata && typeof result.latestTzRevision.metadata === 'object'
                ? result.latestTzRevision.metadata
                : {},
        } : null;
        response.status(200).json({
            ...installation,
            stage: installationStageSet.has(installation.status) ? installation.status : 'new',
            tz: {
                content: typeof result.row.description === 'string' ? result.row.description : '',
                latestRevision: latestTz,
            },
            counters: {
                events: result.eventsTotal,
                chatMessages: result.chatMessagesTotal,
            },
        });
    }));
    app.patch('/installations/:installationId', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectUpdateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to update installations');
        }
        const installationId = parseUuidPath(request.params.installationId);
        const body = projectUpdateSchema.parse(request.body ?? {});
        const hasAnyField = [
            'title',
            'description',
            'tenantId',
            'directionId',
            'systemType',
            'priority',
            'dueDatePreliminary',
            'dueDateAdmin',
            'responsibleIds',
        ].some((fieldName) => Object.prototype.hasOwnProperty.call(body, fieldName));
        if (!hasAnyField) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'At least one field must be provided');
        }
        const row = await withTx(async (client) => {
            const currentRow = await getInstallationByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                installationId,
                lock: true,
            });
            const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title');
            const hasDescription = Object.prototype.hasOwnProperty.call(body, 'description');
            const hasTenant = Object.prototype.hasOwnProperty.call(body, 'tenantId');
            const hasDirection = Object.prototype.hasOwnProperty.call(body, 'directionId');
            const hasSystemType = Object.prototype.hasOwnProperty.call(body, 'systemType');
            const hasPriority = Object.prototype.hasOwnProperty.call(body, 'priority');
            const hasDuePreliminary = Object.prototype.hasOwnProperty.call(body, 'dueDatePreliminary');
            const hasDueAdmin = Object.prototype.hasOwnProperty.call(body, 'dueDateAdmin');
            const hasResponsibleIds = Object.prototype.hasOwnProperty.call(body, 'responsibleIds');
            const title = hasTitle ? normalizeText(body.title) : normalizeText(currentRow.title);
            if (!title) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'title is required');
            }
            const description = hasDescription ? normalizeText(body.description) : normalizeText(currentRow.description);
            const tenantId = hasTenant ? normalizeText(body.tenantId) : normalizeText(currentRow.tenant_id);
            if (hasTenant && tenantId) {
                const tenantCheck = await dbQuery('SELECT coalesce(type, \'tenant\') as type FROM tenants WHERE id = $1::uuid AND deleted_at IS NULL', [tenantId]);
                if (tenantCheck.rows.length > 0 && tenantCheck.rows[0].type !== 'contractor') {
                    throw new ApiError(422, 'VALIDATION_ERROR', 'Only contractor-type tenants can be assigned to installations');
                }
            }
            const directionId = hasDirection ? normalizeText(body.directionId) : normalizeText(currentRow.direction_id);
            const systemType = hasSystemType ? normalizeText(body.systemType) : normalizeText(currentRow.system_type);
            const priority = (hasPriority ? normalizeText(body.priority) : normalizeText(currentRow.priority)) || 'medium';
            const dueDatePreliminary = hasDuePreliminary
                ? parseDateOnlyValue(body.dueDatePreliminary, 'dueDatePreliminary')
                : (currentRow.due_date_preliminary ? String(currentRow.due_date_preliminary) : null);
            const dueDateAdmin = hasDueAdmin
                ? parseDateOnlyValue(body.dueDateAdmin, 'dueDateAdmin')
                : (currentRow.due_date_admin ? String(currentRow.due_date_admin) : null);
            const executorIds = hasResponsibleIds
                ? Array.from(new Set((body.responsibleIds ?? [])
                    .map((value) => normalizeText(value))
                    .filter((value) => value.length > 0)))
                : (Array.isArray(currentRow.executor_ids)
                    ? currentRow.executor_ids.map((value) => normalizeText(value)).filter(Boolean)
                    : []);
            // Auto-transition stage based on executor assignment
            const currentStatus = normalizeText(currentRow.status);
            const autoTransitionStatuses = new Set(['new', 'awaiting_assignment', 'assigned']);
            let newStatus = currentStatus;
            if (hasResponsibleIds && autoTransitionStatuses.has(currentStatus)) {
                newStatus = executorIds.length > 0 ? 'assigned' : 'awaiting_assignment';
            }
            const updateResult = await client.query(`update requests
             set title = $1::text,
                 description = $2::text,
                 tenant_id = $3::text,
                 direction_id = $4::text,
                 system_type = $5::text,
                 priority = $6::text,
                 executor_ids = $7::text[],
                 due_date_preliminary = $8::date,
                 due_date_admin = $9::date,
                 status = $11::text,
                 updated_at = now()
             where id = $10::uuid
               and deleted_at is null
             returning
               ${projectSelectColumnsSql}`, [
                title,
                description,
                tenantId || null,
                directionId || null,
                systemType || null,
                priority,
                executorIds,
                dueDatePreliminary,
                dueDateAdmin,
                installationId,
                newStatus,
            ]);
            const updatedRow = updateResult.rows[0];
            if (!updatedRow) {
                throw new ApiError(500, 'INSTALLATION_UPDATE_FAILED', 'Failed to update installation');
            }
            if (hasResponsibleIds) {
                const bindableUsers = Array.from(new Set([
                    ...executorIds.filter((value) => isUuidValue(value)),
                    ...(isUuidValue(actorUserId) ? [actorUserId] : []),
                ]));
                if (bindableUsers.length > 0) {
                    await client.query(`insert into app_user_project_bindings(user_id, project_id)
                 select distinct unnest($2::uuid[]), $1::uuid
                 on conflict(user_id, project_id) do nothing`, [installationId, bindableUsers]);
                }
            }
            await insertProjectEventTx({
                client,
                projectId: installationId,
                actorUserId,
                eventType: 'project_updated',
                severity: 'info',
                payload: {
                    updatedFields: {
                        title: hasTitle,
                        description: hasDescription,
                        tenantId: hasTenant,
                        directionId: hasDirection,
                        systemType: hasSystemType,
                        priority: hasPriority,
                        dueDatePreliminary: hasDuePreliminary,
                        dueDateAdmin: hasDueAdmin,
                        responsibleIds: hasResponsibleIds,
                    },
                },
            });
            return { updatedRow, previousExecutorIds: Array.isArray(currentRow.executor_ids) ? currentRow.executor_ids.map((v) => normalizeText(v)).filter(Boolean) : [], newExecutorIds: executorIds, hasResponsibleIds, tenantId };
        });
        const updatedRow = row.updatedRow;
        const previousExecutorIds = new Set(row.previousExecutorIds);
        const newExecutorIds = new Set(row.newExecutorIds);
        const addedExecutors = row.newExecutorIds.filter((id) => !previousExecutorIds.has(id));
        const removedExecutors = row.previousExecutorIds.filter((id) => !newExecutorIds.has(id));
        const executorsChanged = row.hasResponsibleIds && (addedExecutors.length > 0 || removedExecutors.length > 0);

        if (executorsChanged && addedExecutors.length > 0) {
            // Notify added executors + admins + tenant clients
            const assignRecipients = new Set(addedExecutors.filter((id) => isUuidValue(id)));
            const adminIds = await getAdminManagerIds();
            for (const id of adminIds) assignRecipients.add(id);
            if (isUuidValue(row.tenantId)) {
                try {
                    const clientsResult = await withTx(async (client) => client.query(`select u.id::text as id from app_users u join app_user_bindings ub on ub.user_id = u.id where ub.counterparty_id = $1::uuid and u.status::text = 'active'`, [row.tenantId]));
                    for (const c of clientsResult.rows) { const cid = normalizeText(c.id); if (cid) assignRecipients.add(cid); }
                } catch {}
            }
            if (isUuidValue(actorUserId)) assignRecipients.delete(actorUserId);
            void pushInAppNotification({
                recipientIds: Array.from(assignRecipients),
                eventType: 'installation_assigned',
                title: `Назначение на монтаж: ${normalizeText(updatedRow.title) || installationId}`,
                body: `Назначены новые исполнители на монтаж`,
                entityType: 'installation',
                entityId: String(installationId),
            });
            void sendProjectNotificationBestEffort({
                request,
                actorUserId,
                actorRole,
                projectId: installationId,
                projectRow: updatedRow,
                eventType: 'installation_assigned',
                commentText: `Назначены исполнители на монтаж: ${normalizeText(updatedRow.title) || installationId}`,
                dedupeToken: `assign:${installationId}:${Date.now()}`,
            });
        }
        if (executorsChanged && removedExecutors.length > 0) {
            // Notify removed executors + admins
            const removeRecipients = new Set(removedExecutors.filter((id) => isUuidValue(id)));
            const adminIds = await getAdminManagerIds();
            for (const id of adminIds) removeRecipients.add(id);
            if (isUuidValue(actorUserId)) removeRecipients.delete(actorUserId);
            void pushInAppNotification({
                recipientIds: Array.from(removeRecipients),
                eventType: 'installation_unassigned',
                title: `Снятие с монтажа: ${normalizeText(updatedRow.title) || installationId}`,
                body: `Исполнитель снят с монтажа`,
                entityType: 'installation',
                entityId: String(installationId),
            });
        }
        if (!executorsChanged) {
            await sendProjectNotificationBestEffort({
                request,
                actorUserId,
                actorRole,
                projectId: installationId,
                projectRow: updatedRow,
                eventType: 'project_update',
                commentText: 'Карточка монтажа обновлена',
                dedupeToken: normalizeText(updatedRow.updated_at ?? updatedRow.updatedAt),
            });
            void pushProjectInAppNotification({
                projectId: installationId,
                eventType: 'project_update',
                title: `Обновлён монтаж: ${normalizeText(updatedRow.title) || installationId}`,
                body: 'Карточка монтажа обновлена',
                actorUserId,
            });
        }
        if (isUuidValue(row.tenantId) && dispatchContractorTenantNotifications) {
            void dispatchContractorTenantNotifications({
                tenantId: row.tenantId,
                entityType: 'installation',
                entityId: installationId,
                title: `Обновлён монтаж: ${normalizeText(updatedRow.title) || installationId}`,
                body: 'Карточка монтажа обновлена',
                eventType: 'installation_updated',
                actorUserId,
                requestContext: request,
            });
        }
        response.status(200).json(mapProjectRow(updatedRow));
    }));
    app.patch('/installations/:installationId/status', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to update installations');
        }
        const installationId = parseUuidPath(request.params.installationId);
        const body = projectStatusUpdateSchema.parse(request.body ?? {});
        const status = normalizeProjectStatus(body.status);
        if (projectClientRoles.has(actorRole)) {
            const clientAllowedStatuses = new Set(['client_approval', 'done', 'closed']);
            if (!clientAllowedStatuses.has(status)) {
                throw new ApiError(403, 'FORBIDDEN', 'Client role can only set status to: client_approval, done, closed');
            }
        }
        const row = await withTx(async (client) => {
            const currentRow = await getInstallationByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                installationId,
                lock: true,
            });
            const updateResult = await client.query(`update requests
             set status = $1::text,
                 updated_at = now()
             where id = $2::uuid
             returning
               ${projectSelectColumnsSql}`, [status, installationId]);
            const updatedRow = updateResult.rows[0];
            if (!updatedRow) {
                throw new ApiError(500, 'INSTALLATION_UPDATE_FAILED', 'Failed to update installation status');
            }
            await insertProjectEventTx({
                client,
                projectId: installationId,
                actorUserId,
                eventType: 'project_status_changed',
                severity: 'info',
                payload: {
                    fromStatus: normalizeText(currentRow.status).toLowerCase() || 'new',
                    toStatus: status,
                    source: 'legacy_status_endpoint',
                },
            });
            return updatedRow;
        });
        await sendProjectNotificationBestEffort({
            request,
            actorUserId,
            actorRole,
            projectId: installationId,
            projectRow: row,
            eventType: resolveProjectNotificationEventType(status, 'project_update'),
            commentText: `Изменен статус монтажа: ${installationStageLabelMap[status] ?? status}`,
            dedupeToken: `status:${status}`,
        });
        void pushProjectInAppNotification({
            projectId: installationId,
            eventType: resolveProjectNotificationEventType(status, 'project_update'),
            title: `Статус монтажа: ${installationStageLabelMap[status] ?? status}`,
            body: `Статус монтажа изменён на ${status}`,
            actorUserId,
        });
        response.status(200).json(mapProjectRow(row));
    }));
    app.patch('/installations/:installationId/files', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectFilesEditRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to update installation files');
        }
        const installationId = parseUuidPath(request.params.installationId);
        const body = projectFilesUpdateSchema.parse(request.body ?? {});
        const incomingFiles = normalizeProjectFiles(body.files ?? []).filter((item) => item.id || item.name || item.url);
        if (incomingFiles.length === 0) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'files must contain at least one non-empty file item');
        }
        const toFileKey = (item) => {
            const id = normalizeText(item?.id);
            if (id) {
                return `id:${id}`;
            }
            const url = normalizeText(item?.url);
            const name = normalizeText(item?.name);
            const type = normalizeText(item?.type);
            return `meta:${url}|${name}|${type}`;
        };
        const result = await withTx(async (client) => {
            const currentRow = await getInstallationByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                installationId,
                lock: true,
            });
            const currentFiles = normalizeProjectFiles(Array.isArray(currentRow.files) ? currentRow.files : []);
            const existingKeys = new Set(currentFiles.map((item) => toFileKey(item)));
            const filesToAppend = [];
            for (const file of incomingFiles) {
                const key = toFileKey(file);
                if (existingKeys.has(key)) {
                    continue;
                }
                existingKeys.add(key);
                filesToAppend.push(file);
            }
            const mergedFiles = [...currentFiles, ...filesToAppend];
            const updateResult = await client.query(`update requests
             set files = $1::jsonb,
                 updated_at = now()
             where id = $2::uuid
             returning
               ${projectSelectColumnsSql}`, [JSON.stringify(mergedFiles), installationId]);
            const updatedRow = updateResult.rows[0];
            if (!updatedRow) {
                throw new ApiError(500, 'INSTALLATION_UPDATE_FAILED', 'Failed to update installation files');
            }
            await insertProjectEventTx({
                client,
                projectId: installationId,
                actorUserId,
                eventType: 'project_files_added',
                severity: 'info',
                payload: {
                    addedCount: filesToAppend.length,
                    totalFiles: mergedFiles.length,
                    files: filesToAppend.slice(0, 30).map((file) => ({
                        id: normalizeText(file.id),
                        name: normalizeText(file.name),
                        url: normalizeText(file.url),
                    })),
                },
            });
            return {
                row: updatedRow,
                addedCount: filesToAppend.length,
                filesTotal: mergedFiles.length,
            };
        });
        if (result.addedCount > 0) {
            await sendProjectNotificationBestEffort({
                request,
                actorUserId,
                actorRole,
                projectId: installationId,
                projectRow: result.row,
                eventType: 'project_update',
                commentText: `Добавлены документы: ${result.addedCount}`,
                dedupeToken: `files:${result.addedCount}:${result.filesTotal}`,
            });
            void pushProjectInAppNotification({
                projectId: installationId,
                eventType: 'project_update',
                title: `Добавлены файлы: ${result.addedCount}`,
                body: `В монтаж добавлены документы (${result.addedCount})`,
                actorUserId,
            });
        }
        response.status(200).json({
            ...mapProjectRow(result.row),
            addedCount: result.addedCount,
            filesTotal: result.filesTotal,
        });
    }));
    app.delete('/installations/:installationId/files', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectUpdateRoles.has(actorRole) && !projectAdminRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to delete installation files');
        }
        const installationId = parseUuidPath(request.params.installationId);
        const body = request.body ?? {};
        const fileIdsToRemove = Array.isArray(body.fileIds)
            ? body.fileIds
                .filter((value) => typeof value === 'string' && value.trim().length > 0)
                .map((value) => value.trim())
            : [];
        if (fileIdsToRemove.length === 0) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'fileIds must contain at least one file ID');
        }
        const removeSet = new Set(fileIdsToRemove);
        const row = await withTx(async (client) => {
            const currentRow = await getInstallationByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                installationId,
                lock: true,
            });
            const currentFiles = normalizeProjectFiles(Array.isArray(currentRow.files) ? currentRow.files : []);
            const remainingFiles = currentFiles.filter((file) => !removeSet.has(normalizeText(file.id)));
            const removedCount = currentFiles.length - remainingFiles.length;
            const updateResult = await client.query(`update requests
             set files = $1::jsonb,
                 updated_at = now()
             where id = $2::uuid
             returning
               ${projectSelectColumnsSql}`, [JSON.stringify(remainingFiles), installationId]);
            const updatedRow = updateResult.rows[0];
            if (!updatedRow) {
                throw new ApiError(500, 'INSTALLATION_UPDATE_FAILED', 'Failed to remove files');
            }
            await insertProjectEventTx({
                client,
                projectId: installationId,
                actorUserId,
                eventType: 'project_files_removed',
                severity: 'info',
                payload: {
                    removedCount,
                    remainingCount: remainingFiles.length,
                },
            });
            return updatedRow;
        });
        response.status(200).json(mapProjectRow(row));
    }));
    app.patch('/installations/:installationId/deadline', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectDeadlineEditRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to change installation deadline');
        }
        const installationId = parseUuidPath(request.params.installationId);
        const body = projectDeadlineUpdateSchema.parse(request.body ?? {});
        const dueDate = parseDateOnlyValue(body.due_date, 'due_date');
        const reason = normalizeText(body.reason);
        const result = await withTx(async (client) => {
            const currentRow = await getInstallationByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                installationId,
                lock: true,
            });
            const oldDue = currentRow.due_date_admin
                ? String(currentRow.due_date_admin)
                : currentRow.due_date_preliminary
                    ? String(currentRow.due_date_preliminary)
                    : '';
            const updateResult = await client.query(`update requests
             set due_date_admin = $1::date,
                 updated_at = now()
             where id = $2::uuid
             returning
               ${projectSelectColumnsSql}`, [dueDate, installationId]);
            const updatedRow = updateResult.rows[0];
            if (!updatedRow) {
                throw new ApiError(500, 'INSTALLATION_UPDATE_FAILED', 'Failed to update installation deadline');
            }
            const isBadAction = !!oldDue && !!dueDate && dueDate > oldDue;
            const severity = isBadAction ? 'warning' : 'info';
            await insertProjectEventTx({
                client,
                projectId: installationId,
                actorUserId,
                eventType: 'project_due_changed',
                severity,
                payload: {
                    oldDue: oldDue || null,
                    newDue: dueDate || null,
                    reason,
                    isBadAction,
                },
            });
            const tzRevisionNo = await insertProjectTzRevisionTx({
                client,
                projectId: installationId,
                oldValue: typeof currentRow.description === 'string' ? currentRow.description : '',
                newValue: typeof currentRow.description === 'string' ? currentRow.description : '',
                reason: `AUTO_DEADLINE_CHANGE: ${reason}`,
                actorUserId,
                eventType: 'deadline_changed',
                metadata: {
                    oldDue: oldDue || null,
                    newDue: dueDate || null,
                    severity,
                    isBadAction,
                },
            });
            return {
                row: updatedRow,
                oldDue,
                newDue: dueDate || '',
                severity,
                isBadAction,
                tzRevisionNo,
            };
        });
        await sendProjectNotificationBestEffort({
            request,
            actorUserId,
            actorRole,
            projectId: installationId,
            projectRow: result.row,
            eventType: 'project_due_changed',
            commentText: reason || 'Изменен срок монтажа',
            oldDue: result.oldDue,
            newDue: result.newDue,
            dedupeToken: `due:${result.oldDue || ''}->${result.newDue || ''}`,
        });
        void pushProjectInAppNotification({
            projectId: installationId,
            eventType: 'project_due_changed',
            title: 'Срок монтажа изменён',
            body: reason || `Новый срок: ${result.newDue || 'не указан'}`,
            actorUserId,
        });
        response.status(200).json({
            ...mapProjectRow(result.row),
            deadlineChange: {
                oldDue: result.oldDue || null,
                newDue: result.newDue || null,
                severity: result.severity,
                isBadAction: result.isBadAction,
                tzRevisionNo: result.tzRevisionNo,
            },
        });
    }));
    app.patch('/installations/:installationId/stage', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectStageEditRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to change installation stage');
        }
        const installationId = parseUuidPath(request.params.installationId);
        const body = installationStageUpdateSchema.parse(request.body ?? {});
        const nextStage = normalizeInstallationStage(body.stage, 'stage');
        const reason = normalizeText(body.reason);
        const result = await withTx(async (client) => {
            const currentRow = await getInstallationByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                installationId,
                lock: true,
            });
            const currentStage = normalizeText(currentRow.status).toLowerCase() || 'new';
            assertInstallationStageTransition(currentStage, nextStage);
            const updateResult = await client.query(`update requests
             set status = $1::text,
                 updated_at = now()
             where id = $2::uuid
             returning
               ${projectSelectColumnsSql}`, [nextStage, installationId]);
            const updatedRow = updateResult.rows[0];
            if (!updatedRow) {
                throw new ApiError(500, 'INSTALLATION_UPDATE_FAILED', 'Failed to update installation stage');
            }
            await insertProjectEventTx({
                client,
                projectId: installationId,
                actorUserId,
                eventType: 'project_stage_changed',
                severity: 'info',
                payload: {
                    fromStage: currentStage,
                    toStage: nextStage,
                    reason: reason || null,
                },
            });
            return {
                row: updatedRow,
                fromStage: currentStage,
                toStage: nextStage,
            };
        });
        const stageTransitionText = `Этап монтажа изменен: ${installationStageLabelMap[result.fromStage] ?? result.fromStage} -> ${installationStageLabelMap[result.toStage] ?? result.toStage}`;
        const stageNotificationEventType = resolveProjectNotificationEventType(result.toStage, 'project_update');
        await sendProjectNotificationBestEffort({
            request,
            actorUserId,
            actorRole,
            projectId: installationId,
            projectRow: result.row,
            eventType: stageNotificationEventType,
            commentText: reason || stageTransitionText,
            resolutionSummary: stageNotificationEventType === 'project_done' || stageNotificationEventType === 'project_done_for_review'
                ? (reason || stageTransitionText)
                : undefined,
            questionsList: stageNotificationEventType === 'project_rejected'
                ? (reason || stageTransitionText)
                : undefined,
            dedupeToken: `stage:${result.fromStage}->${result.toStage}`,
        });
        void pushProjectInAppNotification({
            projectId: installationId,
            eventType: stageNotificationEventType,
            title: `Этап монтажа: ${installationStageLabelMap[result.toStage] ?? result.toStage}`,
            body: reason || stageTransitionText,
            actorUserId,
        });
        response.status(200).json({
            ...mapProjectRow(result.row),
            stageTransition: {
                from: result.fromStage,
                to: result.toStage,
            },
        });
    }));
    app.patch('/installations/:installationId/tz', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectTzEditRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to update installation TZ');
        }
        const installationId = parseUuidPath(request.params.installationId);
        const body = projectTzUpdateSchema.parse(request.body ?? {});
        const newContent = typeof body.content === 'string' ? body.content : '';
        const reason = normalizeText(body.reason);
        const result = await withTx(async (client) => {
            const currentRow = await getInstallationByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                installationId,
                lock: true,
            });
            const oldContent = typeof currentRow.description === 'string' ? currentRow.description : '';
            const updateResult = await client.query(`update requests
             set description = $1::text,
                 updated_at = now()
             where id = $2::uuid
             returning
               ${projectSelectColumnsSql}`, [newContent, installationId]);
            const updatedRow = updateResult.rows[0];
            if (!updatedRow) {
                throw new ApiError(500, 'INSTALLATION_UPDATE_FAILED', 'Failed to update installation TZ');
            }
            const revisionNo = await insertProjectTzRevisionTx({
                client,
                projectId: installationId,
                oldValue: oldContent,
                newValue: newContent,
                reason,
                actorUserId,
                eventType: 'manual_edit',
                metadata: {},
            });
            await insertProjectEventTx({
                client,
                projectId: installationId,
                actorUserId,
                eventType: 'project_tz_updated',
                severity: 'info',
                payload: {
                    revisionNo,
                    reason,
                },
            });
            return {
                row: updatedRow,
                revisionNo,
                oldContent,
                newContent,
            };
        });
        await sendProjectNotificationBestEffort({
            request,
            actorUserId,
            actorRole,
            projectId: installationId,
            projectRow: result.row,
            eventType: 'project_update',
            commentText: reason || 'Техническое задание монтажа обновлено',
            dedupeToken: `tz:${result.revisionNo}`,
        });
        void pushProjectInAppNotification({
            projectId: installationId,
            eventType: 'project_update',
            title: 'Техническое задание монтажа обновлено',
            body: reason || 'Обновлено техническое задание монтажа',
            actorUserId,
        });
        response.status(200).json({
            ...mapProjectRow(result.row),
            tzRevision: {
                revisionNo: result.revisionNo,
                oldValue: result.oldContent,
                newValue: result.newContent,
            },
        });
    }));
    app.patch('/installations/:installationId/members', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectUpdateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to manage installation members');
        }
        const installationId = parseUuidPath(request.params.installationId);
        const body = request.body ?? {};
        const addUserIds = Array.isArray(body.add)
            ? body.add
                .filter((value) => typeof value === 'string' && isUuidValue(value.trim()))
                .map((value) => value.trim())
            : [];
        const removeUserIds = Array.isArray(body.remove)
            ? body.remove
                .filter((value) => typeof value === 'string' && isUuidValue(value.trim()))
                .map((value) => value.trim())
            : [];
        if (addUserIds.length === 0 && removeUserIds.length === 0) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'add or remove must contain at least one user ID');
        }
        const row = await withTx(async (client) => {
            const currentRow = await getInstallationByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                installationId,
                lock: true,
            });
            const currentExecutors = Array.isArray(currentRow.executor_ids)
                ? currentRow.executor_ids.map((value) => normalizeText(value)).filter(Boolean)
                : [];
            const executorSet = new Set(currentExecutors);
            for (const userId of addUserIds) {
                executorSet.add(userId);
            }
            for (const userId of removeUserIds) {
                executorSet.delete(userId);
            }
            const newExecutorIds = Array.from(executorSet);
            const updateResult = await client.query(`update requests
             set executor_ids = $1::text[],
                 updated_at = now()
             where id = $2::uuid
             returning
               ${projectSelectColumnsSql}`, [newExecutorIds, installationId]);
            const updatedRow = updateResult.rows[0];
            if (!updatedRow) {
                throw new ApiError(500, 'INSTALLATION_UPDATE_FAILED', 'Failed to update installation members');
            }
            if (addUserIds.length > 0) {
                await client.query(`insert into app_user_project_bindings(user_id, project_id)
               select distinct unnest($2::uuid[]), $1::uuid
               on conflict(user_id, project_id) do nothing`, [installationId, addUserIds]);
            }
            if (removeUserIds.length > 0) {
                await client.query(`delete from app_user_project_bindings
               where project_id = $1::uuid
                 and user_id = any($2::uuid[])`, [installationId, removeUserIds]);
            }
            await insertProjectEventTx({
                client,
                projectId: installationId,
                actorUserId,
                eventType: 'project_members_changed',
                severity: 'info',
                payload: {
                    added: addUserIds,
                    removed: removeUserIds,
                    total: newExecutorIds.length,
                },
            });
            return updatedRow;
        });
        response.status(200).json(mapProjectRow(row));
    }));
    app.delete('/installations/:installationId', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectDeleteRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to delete installations');
        }
        const installationId = parseUuidPath(request.params.installationId);
        await withTx(async (client) => {
            const currentRow = await getInstallationByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                installationId,
                lock: true,
            });
            const deleteResult = await client.query(`update requests
             set deleted_at = now(),
                 status = case
                   when coalesce(status, '') in ('closed', 'cancelled') then status
                   else 'cancelled'
                 end,
                 updated_at = now()
             where id = $1::uuid
               and deleted_at is null
             returning id::text as id`, [installationId]);
            if (!deleteResult.rows[0]) {
                throw new ApiError(404, 'INSTALLATION_NOT_FOUND', 'Installation not found');
            }
            await insertProjectEventTx({
                client,
                projectId: installationId,
                actorUserId,
                eventType: 'project_deleted',
                severity: 'warning',
                payload: {
                    previousStatus: normalizeText(currentRow.status) || null,
                },
            });
        });
        void pushProjectInAppNotification({
            projectId: installationId,
            eventType: 'installation_deleted',
            title: 'Монтаж удалён',
            body: `Монтаж ${installationId} удалён`,
            actorUserId,
        });
        response.status(204).send();
    }));
    app.get('/installations/:installationId/events', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view installation events');
        }
        const installationId = parseUuidPath(request.params.installationId);
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
        const result = await withTx(async (client) => {
            await getInstallationByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                installationId,
                lock: false,
            });
            const [countResult, rowsResult] = await Promise.all([
                client.query(`select count(*)::int as total
               from project_events
               where project_id = $1::uuid`, [installationId]),
                client.query(`select
                 id::text as id,
                 project_id::text as project_id,
                 event_type,
                 severity,
                 actor_user_id::text as actor_user_id,
                 coalesce(payload, '{}'::jsonb) as payload,
                 created_at
               from project_events
               where project_id = $1::uuid
               order by created_at desc, id desc
               limit $2::int
               offset $3::int`, [installationId, limit, offset]),
            ]);
            return {
                total: Number(countResult.rows[0]?.total ?? 0),
                rows: rowsResult.rows,
            };
        });
        const totalPages = result.total > 0 ? Math.ceil(result.total / limit) : 0;
        response.status(200).json({
            items: result.rows.map(mapProjectEventRow),
            page,
            limit,
            total: result.total,
            totalPages,
        });
    }));
    app.get('/installations/:installationId/chat/messages', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view installation chat');
        }
        const installationId = parseUuidPath(request.params.installationId);
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
        const isClientRole = projectClientRoles.has(actorRole);
        const visibilityCondition = isClientRole ? `and visibility <> 'internal'` : '';
        const result = await withTx(async (client) => {
            await getInstallationByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                installationId,
                lock: false,
            });
            const [countResult, rowsResult] = await Promise.all([
                client.query(`select count(*)::int as total
               from project_chat_messages
               where project_id = $1::uuid
                 and deleted_at is null
                 ${visibilityCondition}`, [installationId]),
                client.query(`select
                 id::text as id,
                 project_id::text as project_id,
                 author_id::text as author_id,
                 visibility,
                 text,
                 coalesce(attachments, '[]'::jsonb) as attachments,
                 created_at,
                 edited_at,
                 deleted_at
               from project_chat_messages
               where project_id = $1::uuid
                 and deleted_at is null
                 ${visibilityCondition}
               order by created_at desc, id desc
               limit $2::int
               offset $3::int`, [installationId, limit, offset]),
            ]);
            return {
                total: Number(countResult.rows[0]?.total ?? 0),
                rows: rowsResult.rows,
            };
        });
        const totalPages = result.total > 0 ? Math.ceil(result.total / limit) : 0;
        response.status(200).json({
            items: result.rows.map(mapProjectChatMessageRow),
            page,
            limit,
            total: result.total,
            totalPages,
        });
    }));
    app.post('/installations/:installationId/chat/messages', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectChatWriteRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to post installation chat messages');
        }
        const installationId = parseUuidPath(request.params.installationId);
        const body = projectChatMessageCreateSchema.parse(request.body ?? {});
        const visibility = normalizeChatVisibility(body.visibility);
        if (projectClientRoles.has(actorRole) && visibility === 'internal') {
            throw new ApiError(403, 'FORBIDDEN', 'Client roles cannot post internal messages');
        }
        const attachments = normalizeProjectFiles(body.attachments ?? []);
        const text = normalizeText(body.text);
        const row = await withTx(async (client) => {
            const instRow = await getInstallationByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                installationId,
                lock: false,
            });
            const authorUserId = isUuidValue(actorUserId) ? actorUserId : null;
            const insertResult = await client.query(`insert into project_chat_messages(
             id,
             project_id,
             author_id,
             visibility,
             text,
             attachments,
             created_at
           )
           values(
             $1::uuid,
             $2::uuid,
             $3::uuid,
             $4::text,
             $5::text,
             $6::jsonb,
             now()
           )
           returning
             id::text as id,
             project_id::text as project_id,
             author_id::text as author_id,
             visibility,
             text,
             coalesce(attachments, '[]'::jsonb) as attachments,
             created_at,
             edited_at,
             deleted_at`, [
                randomUUID(),
                installationId,
                authorUserId,
                visibility,
                text,
                JSON.stringify(attachments),
            ]);
            const insertedRow = insertResult.rows[0];
            if (!insertedRow) {
                throw new ApiError(500, 'INSTALLATION_CHAT_CREATE_FAILED', 'Failed to create installation chat message');
            }
            await insertProjectEventTx({
                client,
                projectId: installationId,
                actorUserId,
                eventType: 'project_chat_message_created',
                severity: 'info',
                payload: {
                    messageId: normalizeText(insertedRow.id),
                    visibility,
                },
            });
            return { messageRow: insertedRow, instTitle: normalizeText(instRow.title) };
        });
        void pushProjectInAppNotification({
            projectId: installationId,
            eventType: 'installation_chat_message',
            title: `Новое сообщение: ${row.instTitle || 'Монтаж'}`,
            body: text.slice(0, 100),
            actorUserId,
        });
        response.status(201).json(mapProjectChatMessageRow(row.messageRow));
    }));
};
