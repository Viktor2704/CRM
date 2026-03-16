export const registerMockProjectRoutes = (params) => {
    const { app, requireAuth, projectCreateRoles, ApiError, getLocalMockBodyObject, randomUUID, normalizeText, projectUpdateRoles, projectAdminRoles, projectDeleteRoles, } = params;
    app.get('/projects/dashboard', requireAuth, (_request, response) => {
        response.status(200).json({
            statusCounts: [
                { status: 'new', count: 3 },
                { status: 'in_progress', count: 5 },
                { status: 'done', count: 2 },
                { status: 'closed', count: 1 },
            ],
            totals: {
                total: 11,
                active: 8,
                completed: 3,
                overdue: 1,
            },
            recent: [
                { id: 'mock-proj-1', title: 'Тестовый проект 1', status: 'in_progress', updatedAt: new Date().toISOString() },
                { id: 'mock-proj-2', title: 'Тестовый проект 2', status: 'new', updatedAt: new Date().toISOString() },
            ],
        });
    });
    app.get('/projects', requireAuth, (_request, response) => {
        response.status(200).json({
            items: [],
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
        });
    });
    app.post('/projects', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectCreateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to create projects');
        }
        const body = getLocalMockBodyObject(request.body);
        response.status(201).json({
            id: randomUUID(),
            title: normalizeText(body.title) || 'Mock Project',
            status: normalizeText(body.status) || 'new',
            events: [],
            files: [],
        });
    });
    app.get('/projects/:projectId', requireAuth, (request, response) => {
        response.status(200).json({
            id: request.params.projectId,
            title: 'Mock Project',
            status: 'new',
            events: [],
            files: [],
        });
    });
    app.patch('/projects/:projectId', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectUpdateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to update projects');
        }
        const body = getLocalMockBodyObject(request.body);
        response.status(200).json({
            id: request.params.projectId,
            ...body,
        });
    });
    app.patch('/projects/:projectId/members', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectUpdateRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to manage project members');
        }
        const body = getLocalMockBodyObject(request.body);
        response.status(200).json({
            project: {
                id: request.params.projectId,
                title: 'Mock Project',
                responsibleIds: [...(Array.isArray(body.add) ? body.add : [])],
            },
        });
    });
    app.delete('/projects/:projectId/files', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectUpdateRoles.has(actorRole) && !projectAdminRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to delete project files');
        }
        response.status(200).json({
            project: {
                id: request.params.projectId,
                files: [],
            },
        });
    });
    app.delete('/projects/:projectId', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!projectDeleteRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to delete projects');
        }
        response.status(204).send();
    });
};
export const registerProjectRoutes = (params) => {
    const { app, requireAuth, asyncHandler, ensureProjectSchema, ApiError, projectAdminRoles, projectOpsRoles, projectClientRoles, projectCreateRoles, projectUpdateRoles, projectDeleteRoles, projectDeadlineEditRoles, projectStageEditRoles, projectTzEditRoles, projectFilesEditRoles, projectChatWriteRoles, normalizeText, normalizeSearchQuery, parseStatusQueryFilter, isUuidValue, parseDateTimeFilter, parseDateOnlyValue, parsePositiveInt, projectSortFieldMap, appendProjectScopeCondition, escapeLikePattern, projectSelectColumnsSql, withTx, mapProjectRow, logger, serializeError, parseUuidPath, projectCreateSchema, projectUpdateSchema, projectStatusUpdateSchema, projectFilesUpdateSchema, projectDeadlineUpdateSchema, projectStageUpdateSchema, projectTzUpdateSchema, projectChatMessageCreateSchema, normalizeProjectStatus, normalizeProjectStage, normalizeProjectFiles, normalizeChatVisibility, resolveCurrentProjectStage, assertProjectStageTransition, insertProjectEventTx, insertProjectTzRevisionTx, getProjectByIdForActorTx, getInstallationByIdForActorTx, sendProjectNotificationBestEffort, resolveProjectNotificationEventType, pushProjectInAppNotification, projectStageLabelMap, mapProjectEventRow, mapProjectChatMessageRow, randomUUID, hasAnyText, toCsvCell, dbQuery, } = params;
    app.get('/projects/export', requireAuth, asyncHandler(async (_request, response) => {
        await ensureProjectSchema();
        const result = await dbQuery(`SELECT id, title, status, priority, tenant_id, due_date_preliminary, created_at FROM requests WHERE is_project = true AND deleted_at IS NULL ORDER BY created_at DESC`);
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
    app.get('/projects/export-xlsx', requireAuth, asyncHandler(async (_request, response) => {
        await ensureProjectSchema();
        const result = await dbQuery(`SELECT id, title, status, priority, tenant_id, due_date_preliminary, created_at FROM requests WHERE is_project = true AND deleted_at IS NULL ORDER BY created_at DESC`);
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
};
