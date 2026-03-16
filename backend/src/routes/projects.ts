import { canUseInternalGlobalExport } from '../helpers/accessGates.js';

export const canExportProjects = canUseInternalGlobalExport;

export const registerMockProjectRoutes = (params) => {
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
    } = params;
    const now = new Date().toISOString();
    const plusDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const localMockProjects: any[] = [
        {
            id: 'mock-proj-1',
            title: 'Тестовый проект вентиляции',
            description: 'Подготовка проекта по системе вентиляции для офисного блока.',
            tenantId: 'mock-tenant-1',
            directionId: 'mock-direction-1',
            systemType: 'ventilation',
            priority: 'high',
            status: 'new',
            responsibleIds: ['local-manager-1'],
            dueDatePreliminary: plusDays(10),
            dueDateAdmin: plusDays(12),
            createdAt: now,
            updatedAt: now,
            files: [
                {
                    id: 'mock-project-file-1',
                    name: 'Исходные данные.pdf',
                    url: '/mock/projects/mock-proj-1/source.pdf',
                    type: 'application/pdf',
                },
            ],
        },
    ];
    const localMockProjectTzRevisions: any[] = [
        {
            projectId: 'mock-proj-1',
            revisionNo: 1,
            oldValue: '',
            newValue: 'Подготовка базового ТЗ для клиента.',
            reason: 'Первичная публикация ТЗ',
            changedBy: 'local-admin-1',
            changedAt: now,
            eventType: 'manual_edit',
            metadata: {},
        },
    ];
    const localMockProjectChatMessages: any[] = [
        {
            id: randomUUID(),
            projectId: 'mock-proj-1',
            authorId: 'local-admin-1',
            visibility: 'internal',
            text: 'Проект создан и ожидает подготовки ТЗ.',
            attachments: [],
            createdAt: now,
            editedAt: null,
            deletedAt: null,
            isPinned: false,
        },
    ];
    const localMockProjectEvents: any[] = [
        {
            id: randomUUID(),
            projectId: 'mock-proj-1',
            eventType: 'project_created',
            severity: 'info',
            actorUserId: 'local-admin-1',
            payload: {},
            createdAt: now,
        },
        {
            id: randomUUID(),
            projectId: 'mock-proj-1',
            eventType: 'project_tz_updated',
            severity: 'info',
            actorUserId: 'local-admin-1',
            payload: {
                revisionNo: 1,
                reason: 'Первичная публикация ТЗ',
            },
            createdAt: now,
        },
    ];
    const findProject = (projectId) => localMockProjects.find((item) => item.id === projectId) ?? null;
    const findProjectOrThrow = (projectId) => {
        const project = findProject(projectId);
        if (!project) {
            throw new ApiError(404, 'NOT_FOUND', 'Project not found');
        }
        return project;
    };
    const normalizeMockFile = (file, index) => ({
        id: normalizeText(file?.id) || `mock-project-file-${index + 1}-${randomUUID()}`,
        name: normalizeText(file?.name) || 'Файл',
        url: normalizeText(file?.url),
        type: normalizeText(file?.type),
        size: normalizeText(file?.size),
        uploadedAt: normalizeText(file?.uploadedAt) || new Date().toISOString(),
    });
    const pushProjectEvent = (projectId, eventType, actorUserId = '', payload = {}, severity = 'info') => {
        localMockProjectEvents.unshift({
            id: randomUUID(),
            projectId,
            eventType,
            severity,
            actorUserId: normalizeText(actorUserId),
            payload: payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {},
            createdAt: new Date().toISOString(),
        });
    };
    const buildProjectDetailPayload = (project) => {
        const latestRevision = localMockProjectTzRevisions
            .filter((item) => item.projectId === project.id)
            .sort((left, right) => Number(right.revisionNo ?? 0) - Number(left.revisionNo ?? 0))[0] ?? null;
        return {
            ...project,
            stage: resolveCurrentProjectStage(project.status),
            tz: {
                content: typeof project.description === 'string' ? project.description : '',
                latestRevision: latestRevision ? {
                    revisionNo: Number(latestRevision.revisionNo ?? 0),
                    oldValue: typeof latestRevision.oldValue === 'string' ? latestRevision.oldValue : '',
                    newValue: typeof latestRevision.newValue === 'string' ? latestRevision.newValue : '',
                    reason: normalizeText(latestRevision.reason),
                    changedBy: normalizeText(latestRevision.changedBy),
                    changedAt: normalizeText(latestRevision.changedAt) || null,
                    eventType: normalizeText(latestRevision.eventType),
                    metadata: latestRevision.metadata && typeof latestRevision.metadata === 'object'
                        ? latestRevision.metadata
                        : {},
                } : null,
            },
            counters: {
                events: localMockProjectEvents.filter((item) => item.projectId === project.id).length,
                chatMessages: localMockProjectChatMessages.filter((item) => item.projectId === project.id && !item.deletedAt).length,
            },
        };
    };
    app.get('/projects/dashboard', requireAuth, (_request, response) => {
        const statusCounts = [...localMockProjects.reduce((acc, item) => {
            const status = normalizeText(item.status) || 'new';
            acc.set(status, (acc.get(status) ?? 0) + 1);
            return acc;
        }, new Map()).entries()].map(([status, count]) => ({ status, count }));
        const overdue = localMockProjects.filter((item) => {
            const dueDate = normalizeText(item.dueDateAdmin || item.dueDatePreliminary);
            return Boolean(dueDate) && dueDate < new Date().toISOString().slice(0, 10) && !['done', 'closed', 'cancelled'].includes(resolveCurrentProjectStage(item.status));
        });
        response.status(200).json({
            statusCounts,
            totals: {
                total: localMockProjects.length,
                active: localMockProjects.filter((item) => !['done', 'closed', 'cancelled'].includes(resolveCurrentProjectStage(item.status))).length,
                completed: localMockProjects.filter((item) => ['done', 'closed'].includes(resolveCurrentProjectStage(item.status))).length,
                overdue: overdue.length,
            },
            recent: localMockProjects.slice(0, 5).map((item) => ({
                id: item.id,
                title: item.title,
                status: item.status,
                updatedAt: item.updatedAt,
            })),
        });
    });
    app.get('/projects', requireAuth, (_request, response) => {
        response.status(200).json({
            items: localMockProjects.map((item) => ({
                ...item,
                stage: resolveCurrentProjectStage(item.status),
            })),
            page: 1,
            limit: 20,
            total: localMockProjects.length,
            totalPages: localMockProjects.length > 0 ? 1 : 0,
        });
    });
    app.get('/projects/export', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!canExportProjects(actorRole, internalGlobalRoles)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to export projects');
        }
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', 'attachment; filename="projects.csv"');
        const rows = localMockProjects.map((item) => [
            item.id,
            item.title,
            item.status,
            item.priority || '',
            item.tenantId || '',
            item.dueDatePreliminary || '',
            String(item.createdAt || '').slice(0, 10),
        ].join(','));
        response.status(200).send(`\uFEFFid,title,status,priority,tenantId,dueDatePreliminary,createdAt\n${rows.join('\n')}`);
    });
    app.get('/projects/export-xlsx', requireAuth, async (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!canExportProjects(actorRole, internalGlobalRoles)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to export projects');
        }
        const { sendXlsxResponse } = await import('../helpers/xlsxHelpers.js');
        await sendXlsxResponse(response, 'projects', [
            { header: 'ID', key: 'id', width: 38 },
            { header: 'Название', key: 'title', width: 40 },
            { header: 'Статус', key: 'status', width: 20 },
            { header: 'Приоритет', key: 'priority', width: 14 },
            { header: 'Контрагент', key: 'tenantId', width: 38 },
            { header: 'Срок', key: 'dueDatePreliminary', width: 14 },
            { header: 'Создан', key: 'createdAt', width: 14 },
        ], localMockProjects.map((item) => ({
            id: item.id,
            title: item.title,
            status: item.status,
            priority: item.priority || '',
            tenantId: item.tenantId || '',
            dueDatePreliminary: item.dueDatePreliminary || '',
            createdAt: String(item.createdAt || '').slice(0, 10),
        })));
    });
    app.post('/projects', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectCreateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to create projects');
        }
        const body = getLocalMockBodyObject(request.body);
        const actorUserId = normalizeText(request.authUser?.id);
        const project = {
            id: randomUUID(),
            title: normalizeText(body.title) || 'Mock Project',
            description: normalizeText(body.description),
            tenantId: normalizeText(body.tenantId),
            directionId: normalizeText(body.directionId),
            systemType: normalizeText(body.systemType),
            priority: normalizeText(body.priority) || 'medium',
            status: body.status !== undefined ? normalizeProjectStatus(body.status, 'status') : 'new',
            responsibleIds: Array.isArray(body.responsibleIds) ? body.responsibleIds : [],
            dueDatePreliminary: normalizeText(body.dueDatePreliminary) || null,
            dueDateAdmin: normalizeText(body.dueDateAdmin) || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            files: (Array.isArray(body.files) ? body.files : []).map((file, index) => normalizeMockFile(file, index)),
        };
        localMockProjects.push(project);
        pushProjectEvent(project.id, 'project_created', actorUserId, {});
        response.status(201).json(project);
    });
    app.get('/projects/:projectId', requireAuth, (request, response) => {
        const existing = findProjectOrThrow(request.params.projectId);
        response.status(200).json(buildProjectDetailPayload(existing));
    });
    app.patch('/projects/:projectId', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectUpdateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to update projects');
        }
        const body = getLocalMockBodyObject(request.body);
        const actorUserId = normalizeText(request.authUser?.id);
        const existing = findProjectOrThrow(request.params.projectId);
        const updated = {
            ...existing,
            title: body.title !== undefined ? normalizeText(body.title) : existing.title,
            description: body.description !== undefined ? normalizeText(body.description) : existing.description,
            tenantId: body.tenantId !== undefined ? normalizeText(body.tenantId) : existing.tenantId,
            directionId: body.directionId !== undefined ? normalizeText(body.directionId) : existing.directionId,
            systemType: body.systemType !== undefined ? normalizeText(body.systemType) : existing.systemType,
            priority: body.priority !== undefined ? normalizeText(body.priority) : existing.priority,
            responsibleIds: Array.isArray(body.responsibleIds) ? body.responsibleIds : existing.responsibleIds,
            dueDatePreliminary: body.dueDatePreliminary !== undefined ? (normalizeText(body.dueDatePreliminary) || null) : existing.dueDatePreliminary,
            dueDateAdmin: body.dueDateAdmin !== undefined ? (normalizeText(body.dueDateAdmin) || null) : existing.dueDateAdmin,
            updatedAt: new Date().toISOString(),
        };
        const index = localMockProjects.findIndex((item) => item.id === request.params.projectId);
        localMockProjects[index] = updated;
        pushProjectEvent(updated.id, 'project_updated', actorUserId, {
            updatedFields: {
                title: body.title !== undefined,
                description: body.description !== undefined,
                tenantId: body.tenantId !== undefined,
                directionId: body.directionId !== undefined,
                systemType: body.systemType !== undefined,
                priority: body.priority !== undefined,
                dueDatePreliminary: body.dueDatePreliminary !== undefined,
                dueDateAdmin: body.dueDateAdmin !== undefined,
                responsibleIds: Array.isArray(body.responsibleIds),
            },
        });
        response.status(200).json(updated);
    });
    app.patch('/projects/:projectId/status', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to update projects');
        }
        const existing = findProjectOrThrow(request.params.projectId);
        const body = getLocalMockBodyObject(request.body);
        const nextStatus = normalizeProjectStatus(body.status, 'status');
        if (projectClientRoles.has(actorRole)) {
            const clientAllowedStatuses = new Set(['client_approval', 'done', 'closed']);
            if (!clientAllowedStatuses.has(nextStatus)) {
                throw new ApiError(403, 'FORBIDDEN', 'Client role can only set status to: client_approval, done, closed');
            }
        }
        const previousStatus = normalizeText(existing.status) || 'new';
        existing.status = nextStatus;
        existing.updatedAt = new Date().toISOString();
        pushProjectEvent(existing.id, 'project_status_changed', normalizeText(request.authUser?.id), {
            fromStatus: previousStatus,
            toStatus: nextStatus,
            source: 'legacy_status_endpoint',
        });
        response.status(200).json({
            ...existing,
            stage: resolveCurrentProjectStage(existing.status),
        });
    });
    app.patch('/projects/:projectId/files', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectFilesEditRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to update project files');
        }
        const existing = findProjectOrThrow(request.params.projectId);
        const body = getLocalMockBodyObject(request.body);
        const incomingFiles = Array.isArray(body.files) ? body.files.map((file, index) => normalizeMockFile(file, index)) : [];
        if (incomingFiles.length === 0) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'files must contain at least one non-empty file item');
        }
        const currentFiles = Array.isArray(existing.files) ? existing.files.map((file, index) => normalizeMockFile(file, index)) : [];
        const knownKeys = new Set(currentFiles.map((file) => file.id || `${file.url}|${file.name}`));
        const filesToAppend = incomingFiles.filter((file) => {
            const key = file.id || `${file.url}|${file.name}`;
            if (knownKeys.has(key)) {
                return false;
            }
            knownKeys.add(key);
            return true;
        });
        existing.files = [...currentFiles, ...filesToAppend];
        existing.updatedAt = new Date().toISOString();
        pushProjectEvent(existing.id, 'project_files_added', normalizeText(request.authUser?.id), {
            addedCount: filesToAppend.length,
            totalFiles: existing.files.length,
            files: filesToAppend.slice(0, 30).map((file) => ({
                id: file.id,
                name: file.name,
                url: file.url,
            })),
        });
        response.status(200).json({
            ...existing,
            addedCount: filesToAppend.length,
            filesTotal: existing.files.length,
        });
    });
    app.patch('/projects/:projectId/deadline', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectDeadlineEditRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to change project deadline');
        }
        const existing = findProjectOrThrow(request.params.projectId);
        const body = getLocalMockBodyObject(request.body);
        const dueDate = normalizeText(body.due_date ?? body.dueDate);
        const reason = normalizeText(body.reason);
        if (reason.length < 2) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'reason must contain at least 2 characters');
        }
        if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'due_date must use YYYY-MM-DD format');
        }
        const oldDue = normalizeText(existing.dueDateAdmin || existing.dueDatePreliminary);
        existing.dueDateAdmin = dueDate || null;
        existing.updatedAt = new Date().toISOString();
        const isBadAction = Boolean(oldDue && dueDate && dueDate > oldDue);
        pushProjectEvent(existing.id, 'project_due_changed', normalizeText(request.authUser?.id), {
            oldDue: oldDue || null,
            newDue: dueDate || null,
            reason,
            isBadAction,
        }, isBadAction ? 'warning' : 'info');
        response.status(200).json({
            ...existing,
            deadlineChange: {
                oldDue: oldDue || null,
                newDue: dueDate || null,
                severity: isBadAction ? 'warning' : 'info',
                isBadAction,
                tzRevisionNo: null,
            },
        });
    });
    app.patch('/projects/:projectId/stage', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectStageEditRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to change project stage');
        }
        const existing = findProjectOrThrow(request.params.projectId);
        const body = getLocalMockBodyObject(request.body);
        const nextStage = normalizeProjectStage(body.stage, 'stage');
        const currentStage = resolveCurrentProjectStage(existing.status);
        assertProjectStageTransition(currentStage, nextStage);
        existing.status = nextStage;
        existing.stage = nextStage;
        existing.updatedAt = new Date().toISOString();
        pushProjectEvent(existing.id, 'project_stage_changed', normalizeText(request.authUser?.id), {
            fromStage: currentStage,
            toStage: nextStage,
            reason: normalizeText(body.reason) || null,
        });
        response.status(200).json({
            ...existing,
            stageTransition: {
                from: currentStage,
                to: nextStage,
            },
        });
    });
    app.patch('/projects/:projectId/tz', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectTzEditRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to update project TZ');
        }
        const existing = findProjectOrThrow(request.params.projectId);
        const body = getLocalMockBodyObject(request.body);
        const newContent = typeof body.content === 'string' ? body.content : '';
        const reason = normalizeText(body.reason);
        if (reason.length < 10) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'reason must contain at least 10 characters');
        }
        const oldContent = typeof existing.description === 'string' ? existing.description : '';
        const revisionNo = localMockProjectTzRevisions
            .filter((item) => item.projectId === existing.id)
            .reduce((max, item) => Math.max(max, Number(item.revisionNo ?? 0)), 0) + 1;
        existing.description = newContent;
        existing.updatedAt = new Date().toISOString();
        localMockProjectTzRevisions.push({
            projectId: existing.id,
            revisionNo,
            oldValue: oldContent,
            newValue: newContent,
            reason,
            changedBy: normalizeText(request.authUser?.id),
            changedAt: new Date().toISOString(),
            eventType: 'manual_edit',
            metadata: {},
        });
        pushProjectEvent(existing.id, 'project_tz_updated', normalizeText(request.authUser?.id), {
            revisionNo,
            reason,
        });
        response.status(200).json({
            ...existing,
            tzRevision: {
                revisionNo,
                oldValue: oldContent,
                newValue: newContent,
            },
        });
    });
    app.patch('/projects/:projectId/members', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectUpdateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to manage project members');
        }
        const body = getLocalMockBodyObject(request.body);
        const existing = findProjectOrThrow(request.params.projectId);
        const currentIds = Array.isArray(existing.responsibleIds) ? existing.responsibleIds.map((value) => normalizeText(value)).filter(Boolean) : [];
        const nextIds = new Set(currentIds);
        const addUserIds = Array.isArray(body.add) ? body.add.map((value) => normalizeText(value)).filter(Boolean) : [];
        const removeUserIds = Array.isArray(body.remove) ? body.remove.map((value) => normalizeText(value)).filter(Boolean) : [];
        if (addUserIds.length === 0 && removeUserIds.length === 0) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'add or remove must contain at least one user ID');
        }
        addUserIds.forEach((value) => nextIds.add(value));
        removeUserIds.forEach((value) => nextIds.delete(value));
        existing.responsibleIds = [...nextIds];
        existing.updatedAt = new Date().toISOString();
        pushProjectEvent(existing.id, 'project_members_changed', normalizeText(request.authUser?.id), {
            added: addUserIds,
            removed: removeUserIds,
            total: existing.responsibleIds.length,
        });
        response.status(200).json(existing);
    });
    app.delete('/projects/:projectId/files', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectUpdateRoles.has(actorRole) && !projectAdminRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to delete project files');
        }
        const existing = findProjectOrThrow(request.params.projectId);
        const fileIds = Array.isArray(request.body?.fileIds) ? request.body.fileIds.map((value) => normalizeText(value)).filter(Boolean) : [];
        if (fileIds.length === 0) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'fileIds must contain at least one file ID');
        }
        const previousCount = Array.isArray(existing.files) ? existing.files.length : 0;
        existing.files = Array.isArray(existing.files)
            ? existing.files.filter((file) => !fileIds.includes(normalizeText(file?.id)))
            : [];
        existing.updatedAt = new Date().toISOString();
        pushProjectEvent(existing.id, 'project_files_removed', normalizeText(request.authUser?.id), {
            removedCount: Math.max(0, previousCount - existing.files.length),
            remainingCount: existing.files.length,
        });
        response.status(200).json(existing);
    });
    app.get('/projects/:projectId/events', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view project events');
        }
        findProjectOrThrow(request.params.projectId);
        const pageRaw = Number.parseInt(String(request.query?.page ?? '1'), 10);
        const limitRaw = Number.parseInt(String(request.query?.limit ?? '20'), 10);
        const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
        const allItems = localMockProjectEvents
            .filter((item) => item.projectId === request.params.projectId)
            .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
        const offset = (page - 1) * limit;
        const items = allItems.slice(offset, offset + limit);
        response.status(200).json({
            items,
            page,
            limit,
            total: allItems.length,
            totalPages: allItems.length > 0 ? Math.ceil(allItems.length / limit) : 0,
        });
    });
    app.get('/projects/:projectId/chat/messages', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view project chat');
        }
        findProjectOrThrow(request.params.projectId);
        const isClientRole = projectClientRoles.has(actorRole);
        const pageRaw = Number.parseInt(String(request.query?.page ?? '1'), 10);
        const limitRaw = Number.parseInt(String(request.query?.limit ?? '20'), 10);
        const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
        const allItems = localMockProjectChatMessages
            .filter((item) => item.projectId === request.params.projectId)
            .filter((item) => !item.deletedAt)
            .filter((item) => !isClientRole || item.visibility !== 'internal')
            .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
        const offset = (page - 1) * limit;
        const items = allItems.slice(offset, offset + limit);
        response.status(200).json({
            items,
            page,
            limit,
            total: allItems.length,
            totalPages: allItems.length > 0 ? Math.ceil(allItems.length / limit) : 0,
        });
    });
    app.post('/projects/:projectId/chat/messages', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectChatWriteRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to post project chat messages');
        }
        findProjectOrThrow(request.params.projectId);
        const body = getLocalMockBodyObject(request.body);
        const text = normalizeText(body.text);
        if (!text) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'text is required');
        }
        const visibility = normalizeChatVisibility(body.visibility);
        if (projectClientRoles.has(actorRole) && visibility === 'internal') {
            throw new ApiError(403, 'FORBIDDEN', 'Client roles cannot post internal messages');
        }
        const message = {
            id: randomUUID(),
            projectId: request.params.projectId,
            authorId: normalizeText(request.authUser?.id),
            visibility,
            text,
            attachments: Array.isArray(body.attachments) ? body.attachments.map((file, index) => normalizeMockFile(file, index)) : [],
            createdAt: new Date().toISOString(),
            editedAt: null,
            deletedAt: null,
            isPinned: false,
        };
        localMockProjectChatMessages.push(message);
        pushProjectEvent(message.projectId, 'project_chat_message_created', normalizeText(request.authUser?.id), {
            messageId: message.id,
            visibility,
        });
        response.status(201).json(message);
    });
    app.patch('/projects/:projectId/chat/:messageId/pin', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectChatWriteRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to pin project chat messages');
        }
        findProjectOrThrow(request.params.projectId);
        const body = getLocalMockBodyObject(request.body);
        const index = localMockProjectChatMessages.findIndex((item) => item.id === request.params.messageId && item.projectId === request.params.projectId);
        if (index < 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Message not found');
        }
        localMockProjectChatMessages[index] = {
            ...localMockProjectChatMessages[index],
            isPinned: typeof body.pinned === 'boolean' ? body.pinned : Boolean(body.isPinned),
        };
        response.status(200).json(localMockProjectChatMessages[index]);
    });
    app.delete('/projects/:projectId', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectDeleteRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to delete projects');
        }
        const index = localMockProjects.findIndex((item) => item.id === request.params.projectId);
        if (index < 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Project not found');
        }
        localMockProjects.splice(index, 1);
        response.status(204).send();
    });
};

export const registerProjectRoutes = (params) => {
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
        dispatchContractorTenantNotifications,
        projectStageLabelMap,
        mapProjectEventRow,
        mapProjectChatMessageRow,
        randomUUID,
        hasAnyText,
        toCsvCell,
        dbQuery,
    } = params;
    app.get('/projects/export', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!canExportProjects(actorRole, internalGlobalRoles)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to export projects');
        }
        const conditions = [
            `r.is_project = true`,
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
        response.setHeader('Content-Disposition', 'attachment; filename="projects.csv"');
        response.status(200).send(`\uFEFFid,title,status,priority,tenantId,dueDatePreliminary,createdAt\n${csvRows.join('\n')}`);
    }));
    app.get('/projects/export-xlsx', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!canExportProjects(actorRole, internalGlobalRoles)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to export projects');
        }
        const conditions = [
            `r.is_project = true`,
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
        await sendXlsxResponse(response, 'projects', [
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
    app.get('/projects', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view projects');
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
            `coalesce(r.is_project, false) = true`,
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
        logger.info('Projects search completed', {
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
    app.get('/projects/dashboard', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view dashboard');
        }
        const scopeConditions = [
            `r.type = 'installation'`,
            `coalesce(r.is_project, false) = true`,
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
    app.post('/projects', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectCreateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to create projects');
        }
        const body = projectCreateSchema.parse(request.body ?? {});
        const title = normalizeText(body.title);
        if (!title) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'title is required');
        }
        if (body.isProject === false) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'POST /projects can only create records with is_project=true');
        }
        const description = normalizeText(body.description);
        const tenantId = normalizeText(body.tenantId);
        if (tenantId) {
            const tenantCheck = await dbQuery('SELECT coalesce(type, \'tenant\') as type FROM tenants WHERE id = $1::uuid AND deleted_at IS NULL', [tenantId]);
            if (tenantCheck.rows.length > 0 && tenantCheck.rows[0].type !== 'contractor') {
                throw new ApiError(422, 'VALIDATION_ERROR', 'Only contractor-type tenants can be assigned to projects');
            }
        }
        const directionId = normalizeText(body.directionId);
        const systemType = normalizeText(body.systemType);
        const priority = normalizeText(body.priority) || 'medium';
        const status = body.status ? normalizeProjectStatus(body.status) : 'new';
        const dueDatePreliminary = parseDateOnlyValue(body.dueDatePreliminary, 'dueDatePreliminary');
        const dueDateAdmin = parseDateOnlyValue(body.dueDateAdmin, 'dueDateAdmin');
        const executorIds = Array.from(new Set((body.responsibleIds ?? [])
            .map((value) => normalizeText(value))
            .filter((value) => value.length > 0)));
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
                true,
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
                throw new ApiError(500, 'PROJECT_CREATE_FAILED', 'Failed to create project');
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
            commentText: 'Создан новый проект',
            dedupeToken: normalizeText(row.id),
        });
        void pushProjectInAppNotification({
            projectId: normalizeText(row.id),
            eventType: 'project_created',
            title: `Создан проект: ${normalizeText(row.title) || normalizeText(row.id)}`,
            body: 'Создан новый проект',
            actorUserId,
        });
        if (isUuidValue(tenantId) && dispatchContractorTenantNotifications) {
            void dispatchContractorTenantNotifications({
                tenantId,
                entityType: 'project',
                entityId: normalizeText(row.id),
                title: `Создан проект: ${normalizeText(row.title) || normalizeText(row.id)}`,
                body: 'Создан новый проект',
                eventType: 'project_created',
                actorUserId,
                requestContext: request,
            });
        }
        response.status(201).json(mapProjectRow(row));
    }));
    app.patch('/projects/:projectId', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectUpdateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to update projects');
        }
        const projectId = parseUuidPath(request.params.projectId);
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
            const currentRow = await getProjectByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                projectId,
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
                    throw new ApiError(422, 'VALIDATION_ERROR', 'Only contractor-type tenants can be assigned to projects');
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
                projectId,
            ]);
            const updatedRow = updateResult.rows[0];
            if (!updatedRow) {
                throw new ApiError(500, 'PROJECT_UPDATE_FAILED', 'Failed to update project');
            }
            if (hasResponsibleIds) {
                const bindableUsers = Array.from(new Set([
                    ...executorIds.filter((value) => isUuidValue(value)),
                    ...(isUuidValue(actorUserId) ? [actorUserId] : []),
                ]));
                if (bindableUsers.length > 0) {
                    await client.query(`insert into app_user_project_bindings(user_id, project_id)
                 select distinct unnest($2::uuid[]), $1::uuid
                 on conflict(user_id, project_id) do nothing`, [projectId, bindableUsers]);
                }
            }
            await insertProjectEventTx({
                client,
                projectId,
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
            return updatedRow;
        });
        await sendProjectNotificationBestEffort({
            request,
            actorUserId,
            actorRole,
            projectId,
            projectRow: row,
            eventType: 'project_update',
            commentText: 'Карточка проекта обновлена',
            dedupeToken: normalizeText(row.updated_at ?? row.updatedAt),
        });
        void pushProjectInAppNotification({
            projectId,
            eventType: 'project_update',
            title: `Обновлён проект: ${normalizeText(row.title) || projectId}`,
            body: 'Карточка проекта обновлена',
            actorUserId,
        });
        const updatedTenantId = normalizeText(row.tenant_id ?? row.tenantId);
        if (isUuidValue(updatedTenantId) && dispatchContractorTenantNotifications) {
            void dispatchContractorTenantNotifications({
                tenantId: updatedTenantId,
                entityType: 'project',
                entityId: projectId,
                title: `Обновлён проект: ${normalizeText(row.title) || projectId}`,
                body: 'Карточка проекта обновлена',
                eventType: 'project_updated',
                actorUserId,
                requestContext: request,
            });
        }
        response.status(200).json(mapProjectRow(row));
    }));
    app.patch('/projects/:projectId/status', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to update projects');
        }
        const projectId = parseUuidPath(request.params.projectId);
        const body = projectStatusUpdateSchema.parse(request.body ?? {});
        const status = normalizeProjectStatus(body.status);
        if (projectClientRoles.has(actorRole)) {
            const clientAllowedStatuses = new Set(['client_approval', 'done', 'closed']);
            if (!clientAllowedStatuses.has(status)) {
                throw new ApiError(403, 'FORBIDDEN', 'Client role can only set status to: client_approval, done, closed');
            }
        }
        const row = await withTx(async (client) => {
            const currentRow = await getProjectByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                projectId,
                lock: true,
            });
            const updateResult = await client.query(`update requests
             set status = $1::text,
                 updated_at = now()
             where id = $2::uuid
             returning
               ${projectSelectColumnsSql}`, [status, projectId]);
            const updatedRow = updateResult.rows[0];
            if (!updatedRow) {
                throw new ApiError(500, 'PROJECT_UPDATE_FAILED', 'Failed to update project status');
            }
            await insertProjectEventTx({
                client,
                projectId,
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
            projectId,
            projectRow: row,
            eventType: resolveProjectNotificationEventType(status, 'project_update'),
            commentText: `Изменен статус проекта: ${projectStageLabelMap[resolveCurrentProjectStage(status)] ?? status}`,
            dedupeToken: `status:${status}`,
        });
        void pushProjectInAppNotification({
            projectId,
            eventType: resolveProjectNotificationEventType(status, 'project_update'),
            title: `Статус проекта: ${projectStageLabelMap[resolveCurrentProjectStage(status)] ?? status}`,
            body: `Статус проекта изменён на ${status}`,
            actorUserId,
        });
        response.status(200).json(mapProjectRow(row));
    }));
    app.delete('/projects/:projectId', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectDeleteRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to delete projects');
        }
        const projectId = parseUuidPath(request.params.projectId);
        await withTx(async (client) => {
            const currentRow = await getProjectByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                projectId,
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
             returning id::text as id`, [projectId]);
            if (!deleteResult.rows[0]) {
                throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
            }
            await insertProjectEventTx({
                client,
                projectId,
                actorUserId,
                eventType: 'project_deleted',
                severity: 'warning',
                payload: {
                    previousStatus: normalizeText(currentRow.status) || null,
                },
            });
        });
        void pushProjectInAppNotification({
            projectId,
            eventType: 'project_deleted',
            title: 'Проект удалён',
            body: `Проект ${projectId} удалён`,
            actorUserId,
        });
        response.status(204).send();
    }));
    app.get('/projects/:projectId', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view projects');
        }
        const projectId = parseUuidPath(request.params.projectId);
        const result = await withTx(async (client) => {
            const row = await getProjectByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                projectId,
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
               limit 1`, [projectId]),
                client.query(`select count(*)::int as total
               from project_events
               where project_id = $1::uuid`, [projectId]),
                client.query(`select count(*)::int as total
               from project_chat_messages
               where project_id = $1::uuid
                 and deleted_at is null`, [projectId]),
            ]);
            return {
                row,
                latestTzRevision: latestTzRevisionResult.rows[0] ?? null,
                eventsTotal: Number(eventsCountResult.rows[0]?.total ?? 0),
                chatMessagesTotal: Number(chatCountResult.rows[0]?.total ?? 0),
            };
        });
        const project = mapProjectRow(result.row);
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
            ...project,
            stage: resolveCurrentProjectStage(project.status),
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
    app.patch('/projects/:projectId/files', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectFilesEditRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to update project files');
        }
        const projectId = parseUuidPath(request.params.projectId);
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
            const currentRow = await getProjectByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                projectId,
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
               ${projectSelectColumnsSql}`, [JSON.stringify(mergedFiles), projectId]);
            const updatedRow = updateResult.rows[0];
            if (!updatedRow) {
                throw new ApiError(500, 'PROJECT_UPDATE_FAILED', 'Failed to update project files');
            }
            await insertProjectEventTx({
                client,
                projectId,
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
                projectId,
                projectRow: result.row,
                eventType: 'project_update',
                commentText: `Добавлены документы: ${result.addedCount}`,
                dedupeToken: `files:${result.addedCount}:${result.filesTotal}`,
            });
            void pushProjectInAppNotification({
                projectId,
                eventType: 'project_update',
                title: `Добавлены файлы: ${result.addedCount}`,
                body: `В проект добавлены документы (${result.addedCount})`,
                actorUserId,
            });
        }
        response.status(200).json({
            ...mapProjectRow(result.row),
            addedCount: result.addedCount,
            filesTotal: result.filesTotal,
        });
    }));
    app.delete('/projects/:projectId/files', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectUpdateRoles.has(actorRole) && !projectAdminRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to delete project files');
        }
        const projectId = parseUuidPath(request.params.projectId);
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
            const currentRow = await getProjectByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                projectId,
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
               ${projectSelectColumnsSql}`, [JSON.stringify(remainingFiles), projectId]);
            const updatedRow = updateResult.rows[0];
            if (!updatedRow) {
                throw new ApiError(500, 'PROJECT_UPDATE_FAILED', 'Failed to remove files');
            }
            await insertProjectEventTx({
                client,
                projectId,
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
    app.patch('/projects/:projectId/deadline', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectDeadlineEditRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to change project deadline');
        }
        const projectId = parseUuidPath(request.params.projectId);
        const body = projectDeadlineUpdateSchema.parse(request.body ?? {});
        const dueDate = parseDateOnlyValue(body.due_date, 'due_date');
        const reason = normalizeText(body.reason);
        const result = await withTx(async (client) => {
            const currentRow = await getProjectByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                projectId,
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
               ${projectSelectColumnsSql}`, [dueDate, projectId]);
            const updatedRow = updateResult.rows[0];
            if (!updatedRow) {
                throw new ApiError(500, 'PROJECT_UPDATE_FAILED', 'Failed to update project deadline');
            }
            const isBadAction = !!oldDue && !!dueDate && dueDate > oldDue;
            const severity = isBadAction ? 'warning' : 'info';
            await insertProjectEventTx({
                client,
                projectId,
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
                projectId,
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
            projectId,
            projectRow: result.row,
            eventType: 'project_due_changed',
            commentText: reason || 'Изменен срок проекта',
            oldDue: result.oldDue,
            newDue: result.newDue,
            dedupeToken: `due:${result.oldDue || ''}->${result.newDue || ''}`,
        });
        void pushProjectInAppNotification({
            projectId,
            eventType: 'project_due_changed',
            title: `Срок проекта изменён`,
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
    app.patch('/projects/:projectId/stage', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectStageEditRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to change project stage');
        }
        const projectId = parseUuidPath(request.params.projectId);
        const body = projectStageUpdateSchema.parse(request.body ?? {});
        const nextStage = normalizeProjectStage(body.stage, 'stage');
        const reason = normalizeText(body.reason);
        const result = await withTx(async (client) => {
            const currentRow = await getProjectByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                projectId,
                lock: true,
            });
            const currentStage = resolveCurrentProjectStage(currentRow.status);
            assertProjectStageTransition(currentStage, nextStage);
            const updateResult = await client.query(`update requests
             set status = $1::text,
                 updated_at = now()
             where id = $2::uuid
             returning
               ${projectSelectColumnsSql}`, [nextStage, projectId]);
            const updatedRow = updateResult.rows[0];
            if (!updatedRow) {
                throw new ApiError(500, 'PROJECT_UPDATE_FAILED', 'Failed to update project stage');
            }
            await insertProjectEventTx({
                client,
                projectId,
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
        const stageTransitionText = `Этап проекта изменен: ${projectStageLabelMap[result.fromStage] ?? result.fromStage} -> ${projectStageLabelMap[result.toStage] ?? result.toStage}`;
        const stageNotificationEventType = resolveProjectNotificationEventType(result.toStage, 'project_update');
        await sendProjectNotificationBestEffort({
            request,
            actorUserId,
            actorRole,
            projectId,
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
            projectId,
            eventType: stageNotificationEventType,
            title: `Этап проекта: ${projectStageLabelMap[result.toStage] ?? result.toStage}`,
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
    app.patch('/projects/:projectId/tz', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectTzEditRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to update project TZ');
        }
        const projectId = parseUuidPath(request.params.projectId);
        const body = projectTzUpdateSchema.parse(request.body ?? {});
        const newContent = typeof body.content === 'string' ? body.content : '';
        const reason = normalizeText(body.reason);
        const result = await withTx(async (client) => {
            const currentRow = await getProjectByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                projectId,
                lock: true,
            });
            const oldContent = typeof currentRow.description === 'string' ? currentRow.description : '';
            const updateResult = await client.query(`update requests
             set description = $1::text,
                 updated_at = now()
             where id = $2::uuid
             returning
               ${projectSelectColumnsSql}`, [newContent, projectId]);
            const updatedRow = updateResult.rows[0];
            if (!updatedRow) {
                throw new ApiError(500, 'PROJECT_UPDATE_FAILED', 'Failed to update project TZ');
            }
            const revisionNo = await insertProjectTzRevisionTx({
                client,
                projectId,
                oldValue: oldContent,
                newValue: newContent,
                reason,
                actorUserId,
                eventType: 'manual_edit',
                metadata: {},
            });
            await insertProjectEventTx({
                client,
                projectId,
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
            projectId,
            projectRow: result.row,
            eventType: 'project_update',
            commentText: reason || 'Техническое задание проекта обновлено',
            dedupeToken: `tz:${result.revisionNo}`,
        });
        void pushProjectInAppNotification({
            projectId,
            eventType: 'project_update',
            title: 'Техническое задание обновлено',
            body: reason || 'Обновлено техническое задание проекта',
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
    app.patch('/projects/:projectId/members', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectUpdateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to manage project members');
        }
        const projectId = parseUuidPath(request.params.projectId);
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
            const currentRow = await getProjectByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                projectId,
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
               ${projectSelectColumnsSql}`, [newExecutorIds, projectId]);
            const updatedRow = updateResult.rows[0];
            if (!updatedRow) {
                throw new ApiError(500, 'PROJECT_UPDATE_FAILED', 'Failed to update members');
            }
            if (addUserIds.length > 0) {
                await client.query(`insert into app_user_project_bindings(user_id, project_id)
               select distinct unnest($2::uuid[]), $1::uuid
               on conflict(user_id, project_id) do nothing`, [projectId, addUserIds]);
            }
            if (removeUserIds.length > 0) {
                await client.query(`delete from app_user_project_bindings
               where project_id = $1::uuid
                 and user_id = any($2::uuid[])`, [projectId, removeUserIds]);
            }
            await insertProjectEventTx({
                client,
                projectId,
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
    app.get('/projects/:projectId/events', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view project events');
        }
        const projectId = parseUuidPath(request.params.projectId);
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
            await getProjectByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                projectId,
                lock: false,
            });
            const [countResult, rowsResult] = await Promise.all([
                client.query(`select count(*)::int as total
               from project_events
               where project_id = $1::uuid`, [projectId]),
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
               offset $3::int`, [projectId, limit, offset]),
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
    app.get('/projects/:projectId/chat/messages', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectAdminRoles.has(actorRole) && !projectOpsRoles.has(actorRole) && !projectClientRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view project chat');
        }
        const projectId = parseUuidPath(request.params.projectId);
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
            await getProjectByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                projectId,
                lock: false,
            });
            const [countResult, rowsResult] = await Promise.all([
                client.query(`select count(*)::int as total
               from project_chat_messages
               where project_id = $1::uuid
                 and deleted_at is null
                 ${visibilityCondition}`, [projectId]),
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
               offset $3::int`, [projectId, limit, offset]),
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
    app.post('/projects/:projectId/chat/messages', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectChatWriteRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to post project chat messages');
        }
        const projectId = parseUuidPath(request.params.projectId);
        const body = projectChatMessageCreateSchema.parse(request.body ?? {});
        const visibility = normalizeChatVisibility(body.visibility);
        if (projectClientRoles.has(actorRole) && visibility === 'internal') {
            throw new ApiError(403, 'FORBIDDEN', 'Client roles cannot post internal messages');
        }
        const attachments = normalizeProjectFiles(body.attachments ?? []);
        const text = normalizeText(body.text);
        const row = await withTx(async (client) => {
            await getProjectByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                projectId,
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
                projectId,
                authorUserId,
                visibility,
                text,
                JSON.stringify(attachments),
            ]);
            const insertedRow = insertResult.rows[0];
            if (!insertedRow) {
                throw new ApiError(500, 'PROJECT_CHAT_CREATE_FAILED', 'Failed to create project chat message');
            }
            await insertProjectEventTx({
                client,
                projectId,
                actorUserId,
                eventType: 'project_chat_message_created',
                severity: 'info',
                payload: {
                    messageId: normalizeText(insertedRow.id),
                    visibility,
                },
            });
            return insertedRow;
        });
        response.status(201).json(mapProjectChatMessageRow(row));
    }));
    app.patch('/projects/:projectId/chat/:messageId/pin', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorUserId = request.authUser?.id ?? '';
        const actorRole = request.authUser?.role ?? '';
        if (!projectChatWriteRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to pin project chat messages');
        }
        const projectId = parseUuidPath(request.params.projectId);
        const messageId = parseUuidPath(request.params.messageId);
        const body = chatMessagePinSchema.parse(request.body ?? {});
        const row = await withTx(async (client) => {
            await getProjectByIdForActorTx({
                client,
                actorUserId,
                actorRole,
                projectId,
                lock: false,
            });
            const result = await client.query(`update project_chat_messages
               set is_pinned = $3, edited_at = now()
               where id = $1::uuid
                 and project_id = $2::uuid
                 and deleted_at is null
               returning
                 id::text as id,
                 project_id::text as project_id,
                 author_id::text as author_id,
                 visibility,
                 text,
                 coalesce(attachments, '[]'::jsonb) as attachments,
                 created_at,
                 edited_at,
                 deleted_at,
                 is_pinned`, [
                messageId,
                projectId,
                body.pinned,
            ]);
            const updatedRow = result.rows[0];
            if (!updatedRow) {
                throw new ApiError(404, 'NOT_FOUND', 'Project chat message not found');
            }
            return updatedRow;
        });
        response.status(200).json(mapProjectChatMessageRow(row));
    }));
};
