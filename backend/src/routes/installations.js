import { normalizeInstallationStage, assertInstallationStageTransition, installationStageSet, installationStageLabelMap, installationStageUpdateSchema } from '../helpers/installationHelpers.js';
export const registerMockInstallationRoutes = (params) => {
    const { app, requireAuth, projectCreateRoles, ApiError, getLocalMockBodyObject, randomUUID, projectUpdateRoles, projectDeleteRoles, } = params;
    app.get('/installations/dashboard', requireAuth, (_request, response) => {
        response.status(200).json({
            statusCounts: [
                { status: 'new', count: 2 },
                { status: 'in_progress', count: 3 },
                { status: 'done', count: 1 },
            ],
            totals: {
                total: 6,
                active: 5,
                completed: 1,
                overdue: 0,
            },
            recent: [
                { id: 'mock-inst-1', title: 'Монтаж кондиционеров', status: 'in_progress', updatedAt: new Date().toISOString() },
            ],
        });
    });
    app.get('/installations', requireAuth, (_request, response) => {
        response.status(200).json({
            items: [],
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
        });
    });
    app.post('/installations', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectCreateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const body = getLocalMockBodyObject(request.body);
        response.status(201).json({
            id: randomUUID(),
            ...body,
            isProject: false,
        });
    });
    app.get('/installations/:installationId', requireAuth, (request, response) => {
        response.status(200).json({
            id: request.params.installationId,
            title: 'Mock Installation',
            status: 'new',
            isProject: false,
            events: [],
            files: [],
            stage: 'new',
            tz: {
                content: '',
                latestRevision: null,
            },
            counters: {
                events: 0,
                chatMessages: 0,
            },
        });
    });
    app.patch('/installations/:installationId', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectUpdateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        response.status(200).json({
            id: request.params.installationId,
            ...(getLocalMockBodyObject(request.body)),
        });
    });
    app.patch('/installations/:installationId/status', requireAuth, (request, response) => {
        response.status(200).json({
            id: request.params.installationId,
            status: request.body?.status ?? 'new',
        });
    });
    app.patch('/installations/:installationId/files', requireAuth, (request, response) => {
        response.status(200).json({
            id: request.params.installationId,
            files: request.body?.files ?? [],
        });
    });
    app.delete('/installations/:installationId/files', requireAuth, (request, response) => {
        response.status(200).json({
            id: request.params.installationId,
            files: [],
        });
    });
    app.patch('/installations/:installationId/deadline', requireAuth, (request, response) => {
        response.status(200).json({
            id: request.params.installationId,
            ...(getLocalMockBodyObject(request.body)),
        });
    });
    app.patch('/installations/:installationId/stage', requireAuth, (request, response) => {
        response.status(200).json({
            id: request.params.installationId,
            stage: request.body?.stage ?? 'new',
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
        response.status(200).json({
            id: request.params.installationId,
            responsibleIds: request.body?.add ?? [],
        });
    });
    app.delete('/installations/:installationId', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectDeleteRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        response.status(204).send();
    });
    app.get('/installations/:installationId/events', requireAuth, (_request, response) => {
        response.status(200).json({
            items: [],
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
        });
    });
    app.get('/installations/:installationId/chat/messages', requireAuth, (_request, response) => {
        response.status(200).json({
            items: [],
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
        });
    });
    app.post('/installations/:installationId/chat/messages', requireAuth, (request, response) => {
        response.status(201).json({
            id: randomUUID(),
            text: request.body?.text ?? '',
            createdAt: new Date().toISOString(),
        });
    });
};
export const registerInstallationRoutes = (params) => {
    const { app, requireAuth, asyncHandler, ensureProjectSchema, ApiError, projectAdminRoles, projectOpsRoles, projectClientRoles, projectCreateRoles, projectUpdateRoles, projectDeleteRoles, projectDeadlineEditRoles, projectStageEditRoles, projectTzEditRoles, projectFilesEditRoles, projectChatWriteRoles, normalizeText, normalizeSearchQuery, parseStatusQueryFilter, isUuidValue, parseDateTimeFilter, parseDateOnlyValue, parsePositiveInt, projectSortFieldMap, appendProjectScopeCondition, escapeLikePattern, projectSelectColumnsSql, withTx, mapProjectRow, logger, serializeError, parseUuidPath, projectCreateSchema, projectUpdateSchema, projectStatusUpdateSchema, projectFilesUpdateSchema, projectDeadlineUpdateSchema, projectStageUpdateSchema, projectTzUpdateSchema, projectChatMessageCreateSchema, normalizeProjectStatus, normalizeProjectStage, normalizeProjectFiles, normalizeChatVisibility, resolveCurrentProjectStage, assertProjectStageTransition, insertProjectEventTx, insertProjectTzRevisionTx, getProjectByIdForActorTx, getInstallationByIdForActorTx, sendProjectNotificationBestEffort, resolveProjectNotificationEventType, pushProjectInAppNotification, pushInAppNotification, getAdminManagerIds, projectStageLabelMap, mapProjectEventRow, mapProjectChatMessageRow, randomUUID, hasAnyText, } = params;
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
            for (const id of adminIds)
                assignRecipients.add(id);
            if (isUuidValue(row.tenantId)) {
                try {
                    const clientsResult = await withTx(async (client) => client.query(`select u.id::text as id from app_users u join app_user_bindings ub on ub.user_id = u.id where ub.counterparty_id = $1::uuid and u.status::text = 'active'`, [row.tenantId]));
                    for (const c of clientsResult.rows) {
                        const cid = normalizeText(c.id);
                        if (cid)
                            assignRecipients.add(cid);
                    }
                }
                catch { }
            }
            if (isUuidValue(actorUserId))
                assignRecipients.delete(actorUserId);
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
            for (const id of adminIds)
                removeRecipients.add(id);
            if (isUuidValue(actorUserId))
                removeRecipients.delete(actorUserId);
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
