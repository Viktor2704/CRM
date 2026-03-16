import { canUseInternalGlobalExport } from '../helpers/accessGates.js';

export const canExportMaintenancePlans = canUseInternalGlobalExport;

export const registerMockMaintenancePlanRoutes = (params) => {
    const {
        app,
        requireAuth,
        ApiError,
        randomUUID,
        normalizeText,
        internalGlobalRoles,
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
    } = params;
        const localMockMaintenancePlans = [
            {
                id: 'mock-plan-1',
                tenantId: 'mock-tenant-1',
                maintenanceItemIds: ['obj-1', 'obj-2'],
                systemType: 'APS',
                frequency: 'monthly',
                dayOfMonth: 20,
                leadDays: 5,
                workdayRule: 'PREVIOUS_WORKDAY',
                validFrom: '2026-01-01',
                validTo: null,
                isActive: true,
                defaultExecutorIds: ['local-executor-1'],
                contactPerson: 'Иванов И.И.',
                contactPhone: '+79001234567',
                lastGenerated: null,
                createdById: 'local-admin-1',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        ];
        const localMockGenerationRuns = [];
        app.get('/maintenance-plans/runs', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!maintenancePlanManageRoles.has(actorRole) && !projectAdminRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            response.status(200).json({
                items: localMockGenerationRuns,
                total: localMockGenerationRuns.length,
            });
        });
        app.post('/maintenance-plans/generate', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!maintenancePlanManageRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            const body = getLocalMockBodyObject(request.body);
            const monthRaw = Number(body.month);
            const month = Number.isInteger(monthRaw) && monthRaw >= 0 && monthRaw <= 11 ? monthRaw : 0;
            const yearRaw = Number(body.year);
            const year = Number.isInteger(yearRaw) && yearRaw >= 2020 && yearRaw <= 2100 ? yearRaw : new Date().getUTCFullYear();
            const mode = body.mode === 'preview' ? 'preview' : 'execute';
            const monthNumber = String(month + 1).padStart(2, '0');
            const periodStart = `${year}-${monthNumber}-01`;
            const periodEnd = `${year}-${monthNumber}-28`;
            const details = [
                {
                    planId: 'mock-plan-1',
                    maintenanceItemId: 'obj-1',
                    message: mode === 'preview' ? 'Request will be created' : 'Request created',
                    status: 'created',
                },
                {
                    planId: 'mock-plan-1',
                    maintenanceItemId: 'obj-2',
                    message: mode === 'preview' ? 'Request will be created' : 'Request created',
                    status: 'created',
                },
            ];
            const run = {
                mode,
                runId: mode === 'execute' ? randomUUID() : null,
                periodStart,
                periodEnd,
                created: 2,
                skipped: 0,
                errors: 0,
                coverage: {
                    totalPlannedObjects: 2,
                    coveredObjects: 2,
                    missedObjects: [],
                },
                details,
            };
            if (mode === 'execute') {
                localMockGenerationRuns.unshift({
                    id: run.runId,
                    executedById: request.authUser?.id ?? '',
                    periodMonth: month,
                    periodYear: year,
                    periodStart,
                    periodEnd,
                    mode,
                    created: run.created,
                    skipped: run.skipped,
                    errors: run.errors,
                    coverage: run.coverage,
                    details: run.details,
                    executedAt: new Date().toISOString(),
                });
                for (const plan of localMockMaintenancePlans) {
                    plan.lastGenerated = new Date().toISOString();
                    plan.updatedAt = new Date().toISOString();
                }
            }
            response.status(200).json(run);
        });
        app.get('/maintenance-plans', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!maintenancePlanManageRoles.has(actorRole) && !projectAdminRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            response.status(200).json({
                items: localMockMaintenancePlans,
                total: localMockMaintenancePlans.length,
            });
        });
        app.get('/maintenance-plans/export-xlsx', requireAuth, async (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!canExportMaintenancePlans(actorRole, internalGlobalRoles)) {
                throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to export maintenance plans');
            }
            const { sendXlsxResponse } = await import('../helpers/xlsxHelpers.js');
            await sendXlsxResponse(response, 'maintenance-plans', [
                { header: 'ID', key: 'id', width: 38 },
                { header: 'Система', key: 'systemType', width: 16 },
                { header: 'Частота', key: 'frequency', width: 14 },
                { header: 'День месяца', key: 'dayOfMonth', width: 14 },
                { header: 'Действует с', key: 'validFrom', width: 14 },
                { header: 'Действует по', key: 'validTo', width: 14 },
                { header: 'Активен', key: 'isActive', width: 10 },
                { header: 'Контактное лицо', key: 'contactPerson', width: 25 },
                { header: 'Телефон', key: 'contactPhone', width: 18 },
                { header: 'Создан', key: 'createdAt', width: 14 },
            ], localMockMaintenancePlans.map((plan) => ({
                id: String(plan.id ?? ''),
                systemType: String(plan.systemType ?? ''),
                frequency: String(plan.frequency ?? ''),
                dayOfMonth: String(plan.dayOfMonth ?? ''),
                validFrom: String(plan.validFrom ?? ''),
                validTo: String(plan.validTo ?? ''),
                isActive: plan.isActive ? 'да' : 'нет',
                contactPerson: String(plan.contactPerson ?? ''),
                contactPhone: String(plan.contactPhone ?? ''),
                createdAt: plan.createdAt ? String(plan.createdAt).slice(0, 10) : '',
            })));
        });
        app.post('/maintenance-plans', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!maintenancePlanManageRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            const body = getLocalMockBodyObject(request.body);
            const plan = {
                id: randomUUID(),
                tenantId: normalizeText(body.tenantId),
                maintenanceItemIds: Array.isArray(body.maintenanceItemIds)
                    ? body.maintenanceItemIds.map((value) => normalizeText(value)).filter(Boolean)
                    : [],
                systemType: normalizeText(body.systemType),
                frequency: normalizeText(body.frequency) || 'monthly',
                dayOfMonth: Number(body.dayOfMonth ?? 1),
                leadDays: Number(body.leadDays ?? 5),
                workdayRule: normalizeText(body.workdayRule) || 'PREVIOUS_WORKDAY',
                validFrom: normalizeText(body.validFrom) || new Date().toISOString().split('T')[0],
                validTo: body.validTo ? normalizeText(body.validTo) : null,
                isActive: body.isActive !== false,
                defaultExecutorIds: Array.isArray(body.defaultExecutorIds)
                    ? body.defaultExecutorIds.map((value) => normalizeText(value)).filter(Boolean)
                    : [],
                contactPerson: normalizeText(body.contactPerson),
                contactPhone: normalizeText(body.contactPhone),
                lastGenerated: null,
                createdById: request.authUser?.id ?? '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            localMockMaintenancePlans.push(plan);
            response.status(201).json(plan);
        });
        app.patch('/maintenance-plans/:planId', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!maintenancePlanManageRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            const idx = localMockMaintenancePlans.findIndex((plan) => plan.id === request.params.planId);
            if (idx < 0) {
                response.status(404).json({ code: 'PLAN_NOT_FOUND' });
                return;
            }
            const body = getLocalMockBodyObject(request.body);
            localMockMaintenancePlans[idx] = {
                ...localMockMaintenancePlans[idx],
                ...body,
                updatedAt: new Date().toISOString(),
            };
            response.status(200).json(localMockMaintenancePlans[idx]);
        });
        app.get('/maintenance-plans/:planId/requests', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!maintenancePlanManageRoles.has(actorRole) && !projectAdminRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            const plan = localMockMaintenancePlans.find((item) => item.id === request.params.planId);
            if (!plan) {
                response.status(404).json({ code: 'PLAN_NOT_FOUND' });
                return;
            }
            const items = localMockGenerationRuns
                .flatMap((run) => Array.isArray(run.details) ? run.details.map((detail, index) => ({ run, detail, index })) : [])
                .filter(({ detail }) => detail.planId === request.params.planId)
                .map(({ run, detail, index }) => {
                    const maintenanceItem = localMockMaintenanceItems.find((item) => item.id === detail.maintenanceItemId);
                    return {
                        linkId: `${run.id || 'preview'}-${index}`,
                        objectId: detail.maintenanceItemId || '',
                        objectName: normalizeText(maintenanceItem?.name) || `Объект ${index + 1}`,
                        objectAddress: normalizeText(maintenanceItem?.address),
                        periodStart: normalizeText(run.periodStart),
                        periodEnd: normalizeText(run.periodEnd),
                        linkStatus: normalizeText(detail.status) || 'created',
                        requestId: detail.requestId || '',
                        requestTitle: detail.requestTitle || `ТО: ${normalizeText(maintenanceItem?.name) || 'Объект'}`,
                        requestStatus: detail.requestStatus || 'new',
                        requestPriority: detail.requestPriority || 'medium',
                        requestDueDate: detail.requestDueDate || normalizeText(run.periodEnd),
                        createdAt: normalizeText(run.executedAt) || new Date().toISOString(),
                    };
                });
            response.status(200).json({ items });
        });
        app.get('/maintenance-plans/:planId/logs', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!maintenancePlanManageRoles.has(actorRole) && !projectAdminRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            const plan = localMockMaintenancePlans.find((item) => item.id === request.params.planId);
            if (!plan) {
                response.status(404).json({ code: 'PLAN_NOT_FOUND' });
                return;
            }
            const items = localMockGenerationRuns
                .filter((run) => Array.isArray(run.details) && run.details.some((detail) => detail.planId === request.params.planId))
                .map((run) => ({
                    id: run.id,
                    planId: request.params.planId,
                    mode: run.mode,
                    periodStart: run.periodStart,
                    periodEnd: run.periodEnd,
                    created: Number(run.created ?? 0),
                    skipped: Number(run.skipped ?? 0),
                    updated: Number(run.updated ?? 0),
                    errors: Number(run.errors ?? 0),
                    createdAt: normalizeText(run.executedAt) || new Date().toISOString(),
                }));
            response.status(200).json({ items });
        });
        app.delete('/maintenance-plans/:planId', requireAuth, (request, response) => {
            const actorRole = request.authUser?.role ?? '';
            if (!maintenancePlanManageRoles.has(actorRole)) {
                throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
            }
            const idx = localMockMaintenancePlans.findIndex((plan) => plan.id === request.params.planId);
            if (idx < 0) {
                response.status(404).json({ code: 'PLAN_NOT_FOUND' });
                return;
            }
            localMockMaintenancePlans.splice(idx, 1);
            response.status(204).send();
        });
        app.post('/maintenance-plans/:planId/confirm', publicLimiter, (request, response) => {
            const action = normalizeText(request.query?.action ?? request.body?.action) || 'confirm';
            const token = normalizeText(request.query?.token ?? request.body?.token);
            if (!token) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'Token is required');
            }
            const notifyAdmins = (title, body) => {
                for (const user of localMockUsers) {
                    if (user.role !== 'admin' && user.role !== 'manager') {
                        continue;
                    }
                    localMockNotifications.push({
                        id: randomUUID(),
                        userId: user.id,
                        eventType: 'plan_action',
                        title,
                        body,
                        entityType: 'maintenance_plan',
                        entityId: request.params.planId,
                        isRead: false,
                        createdAt: new Date().toISOString(),
                    });
                }
            };
            if (action === 'confirm') {
                notifyAdmins('ТО согласовано', `План ${request.params.planId}`);
                response.status(200).json({
                    status: 'confirmed',
                    message: 'ТО согласовано. Спасибо!',
                });
                return;
            }
            if (action === 'reschedule') {
                notifyAdmins('Запрошен перенос ТО', `План ${request.params.planId}`);
                response.status(200).json({
                    status: 'reschedule_requested',
                    message: 'Запрос на перенос отправлен.',
                });
                return;
            }
            throw new ApiError(422, 'VALIDATION_ERROR', 'Action must be confirm or reschedule');
        });
        app.get('/calendar/maintenance-plans/:planId.ics', requireAuth, (request, response) => {
            const plan = localMockMaintenancePlans.find((candidate) => candidate.id === request.params.planId) ?? localMockMaintenancePlans[0] ?? null;
            const direction = localMockDirections[0] ?? null;
            const event = generateIcsEvent({
                uid: request.params.planId,
                summary: `ТО - ${normalizeText(direction?.name) || 'Направление'}`,
                description: `Плановое ТО (${normalizeText(plan?.systemType) || 'без типа'})`,
                location: normalizeText(direction?.address),
                dtstart: new Date(Date.now() + 86400000).toISOString(),
            });
            sendIcsResponse(response, wrapIcsCalendar(event), `to-${request.params.planId}.ics`);
        });
};

export const registerMaintenancePlanRoutes = (params) => {
    const {
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
        internalGlobalRoles,
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
        toCsvCell,
    } = params;
    app.get('/maintenance-plans/export', requireAuth, asyncHandler(async (request, response) => {
        await ensureMaintenanceSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!canExportMaintenancePlans(actorRole, internalGlobalRoles)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to export maintenance plans');
        }
        const result = await dbQuery(`SELECT id, name, system_type, frequency, day_of_month, valid_from, valid_to, status, is_active, contact_person, contact_phone, created_at FROM maintenance_plans WHERE deleted_at IS NULL ORDER BY created_at DESC`);
        const csvRows = result.rows.map((row) => [
            toCsvCell(row.id),
            toCsvCell(row.system_type),
            toCsvCell(row.frequency),
            toCsvCell(row.day_of_month),
            toCsvCell(row.valid_from ? String(row.valid_from).slice(0, 10) : ''),
            toCsvCell(row.valid_to ? String(row.valid_to).slice(0, 10) : ''),
            toCsvCell(row.is_active ? 'да' : 'нет'),
            toCsvCell(row.contact_person),
            toCsvCell(row.contact_phone),
            toCsvCell(row.created_at ? String(row.created_at).slice(0, 10) : ''),
        ].join(','));
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', 'attachment; filename="maintenance-plans.csv"');
        response.status(200).send(`\uFEFFid,systemType,frequency,dayOfMonth,validFrom,validTo,isActive,contactPerson,contactPhone,createdAt\n${csvRows.join('\n')}`);
    }));
    app.get('/maintenance-plans/export-xlsx', requireAuth, asyncHandler(async (request, response) => {
        await ensureMaintenanceSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!canExportMaintenancePlans(actorRole, internalGlobalRoles)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to export maintenance plans');
        }
        const result = await dbQuery(`SELECT id, system_type, frequency, day_of_month, valid_from, valid_to, is_active, contact_person, contact_phone, created_at FROM maintenance_plans WHERE deleted_at IS NULL ORDER BY created_at DESC`);
        const { sendXlsxResponse } = await import('../helpers/xlsxHelpers.js');
        await sendXlsxResponse(response, 'maintenance-plans', [
            { header: 'ID', key: 'id', width: 38 },
            { header: 'Система', key: 'systemType', width: 16 },
            { header: 'Частота', key: 'frequency', width: 14 },
            { header: 'День месяца', key: 'dayOfMonth', width: 14 },
            { header: 'Действует с', key: 'validFrom', width: 14 },
            { header: 'Действует по', key: 'validTo', width: 14 },
            { header: 'Активен', key: 'isActive', width: 10 },
            { header: 'Контактное лицо', key: 'contactPerson', width: 25 },
            { header: 'Телефон', key: 'contactPhone', width: 18 },
            { header: 'Создан', key: 'createdAt', width: 14 },
        ], result.rows.map((row) => ({
            id: String(row.id ?? ''),
            systemType: String(row.system_type ?? ''),
            frequency: String(row.frequency ?? ''),
            dayOfMonth: String(row.day_of_month ?? ''),
            validFrom: row.valid_from ? String(row.valid_from).slice(0, 10) : '',
            validTo: row.valid_to ? String(row.valid_to).slice(0, 10) : '',
            isActive: row.is_active ? 'да' : 'нет',
            contactPerson: String(row.contact_person ?? ''),
            contactPhone: String(row.contact_phone ?? ''),
            createdAt: row.created_at ? String(row.created_at).slice(0, 10) : '',
        })));
    }));
    app.get('/maintenance-plans/runs', requireAuth, asyncHandler(async (request, response) => {
        await ensureMaintenanceSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!maintenancePlanManageRoles.has(actorRole) && !projectAdminRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view generation runs');
        }
        const result = await dbQuery(`select *
           from maintenance_generation_runs
           order by executed_at desc
           limit 50`);
        response.status(200).json({
            items: result.rows.map(mapGenerationRunRow),
            total: result.rows.length,
        });
    }));
    // Statuses that are considered "not started" and can be updated by auto-generation
    const NOT_STARTED_STATUSES = new Set(['new', 'pending', 'draft']);

    app.post('/maintenance-plans/generate', requireAuth, asyncHandler(async (request, response) => {
        await ensureMaintenanceSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!maintenancePlanManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to generate maintenance requests');
        }
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const month = Number(body.month);
        const year = Number(body.year);
        const mode = body.mode === 'preview' ? 'preview' : 'execute';
        const planIdFilter = body.planId ? normalizeText(body.planId) : null;
        if (!Number.isInteger(month) || month < 0 || month > 11) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'month must be 0-11');
        }
        if (!Number.isInteger(year) || year < 2020 || year > 2100) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'year must be 2020-2100');
        }
        const periodStart = new Date(Date.UTC(year, month, 1)).toISOString().split('T')[0];
        const periodEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().split('T')[0];
        const planQuery = planIdFilter
            ? await dbQuery(`select * from maintenance_plans
               where id = $1::uuid and status = 'active' and deleted_at is null
               and valid_from <= $2::date and (valid_to is null or valid_to >= $3::date)`,
                [planIdFilter, periodEnd, periodStart])
            : await dbQuery(`select * from maintenance_plans
               where status = 'active' and deleted_at is null
               and valid_from <= $1::date and (valid_to is null or valid_to >= $2::date)
               order by created_at asc`, [periodEnd, periodStart]);
        if (mode === 'execute') {
            await ensureProjectSchema();
        }
        const details: any[] = [];
        let totalCreated = 0;
        let totalSkipped = 0;
        let totalUpdated = 0;
        let totalErrors = 0;
        const coveredObjectIds = new Set<string>();
        const allPlannedObjectIds = new Set<string>();
        const missedObjects: any[] = [];
        const warnings: any[] = [];
        const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

        for (const plan of planQuery.rows) {
            const planId = normalizeText(plan.id);
            const updateMode = normalizeText(plan.update_mode) || 'skip';
            const itemIds = Array.isArray(plan.maintenance_item_ids)
                ? plan.maintenance_item_ids.map((value) => normalizeText(value)).filter(Boolean)
                : [];
            if (itemIds.length === 0) {
                totalSkipped += 1;
                details.push({ planId, maintenanceItemId: null, message: 'Plan has no maintenance items', status: 'skipped' });
                missedObjects.push({ planId, maintenanceItemId: null, reason: 'NO_ITEMS' });
                continue;
            }
            // Fetch objects with their systems and contacts
            const itemsResult = await dbQuery(`select
               mi.id::text as id, mi.name, mi.address, mi.systems, mi.direction_id,
               d.name as direction_name
             from maintenance_items mi
             left join directions d on d.id = mi.direction_id and d.deleted_at is null
             where mi.id = any($1::uuid[]) and mi.deleted_at is null`, [itemIds]);
            const itemsMap = new Map<string, any>();
            for (const row of itemsResult.rows) { itemsMap.set(normalizeText(row.id), row); }

            // Arrival window
            const arrFrom = Number(plan.arrival_from_day ?? 1);
            const arrTo = Number(plan.arrival_to_day ?? 28);
            const safeArrFrom = Math.min(Math.max(arrFrom, 1), daysInMonth);
            const safeArrTo = Math.min(Math.max(arrTo, 1), daysInMonth);
            const pad2 = (n: number) => String(n).padStart(2, '0');
            const monthStr = pad2(month + 1);
            const arrivalFrom = `${year}-${monthStr}-${pad2(safeArrFrom)}`;
            const arrivalTo = `${year}-${monthStr}-${pad2(safeArrTo)}`;

            const executorIds = Array.isArray(plan.default_executor_ids)
                ? plan.default_executor_ids.map((value) => normalizeText(value)).filter(Boolean)
                : [];

            for (const itemId of itemIds) {
                allPlannedObjectIds.add(itemId);
                const item = itemsMap.get(itemId);
                if (!item) {
                    totalSkipped += 1;
                    details.push({ planId, maintenanceItemId: itemId, message: 'Object not found or deleted', status: 'skipped' });
                    missedObjects.push({ planId, maintenanceItemId: itemId, reason: 'OBJECT_NOT_FOUND' });
                    continue;
                }
                const objectName = normalizeText(item.name) || itemId;
                const objectAddress = normalizeText(item.address);
                const systemsSnapshot = item.systems && typeof item.systems === 'object' ? item.systems : {};
                const directionId = normalizeText(item.direction_id);

                // Warnings
                if (!normalizeText(plan.contact_person)) {
                    warnings.push({ planId, maintenanceItemId: itemId, type: 'NO_CONTACT', message: `No contact for object ${objectName}` });
                }
                const systemKeys = Object.keys(systemsSnapshot).filter((k) => systemsSnapshot[k] === true);
                if (systemKeys.length === 0) {
                    warnings.push({ planId, maintenanceItemId: itemId, type: 'NO_SYSTEMS', message: `No systems for object ${objectName}` });
                }

                // Check for existing link (anti-duplicate)
                const existingLink = await dbQuery(`select lnk.id, lnk.request_id, r.status as request_status
                   from ppr_generated_request_link lnk
                   left join requests r on r.id = lnk.request_id
                   where lnk.plan_id = $1::uuid and lnk.object_id = $2 and lnk.period_start = $3::date and lnk.period_end = $4::date and lnk.status = 'active'
                   limit 1`, [planId, itemId, periodStart, periodEnd]);

                if (existingLink.rows.length > 0) {
                    const existingRow = existingLink.rows[0];
                    const existingRequestStatus = normalizeText(existingRow.request_status);

                    if (updateMode === 'skip') {
                        totalSkipped += 1;
                        details.push({ planId, maintenanceItemId: itemId, message: `Already exists (${existingRequestStatus}), skipped`, status: 'skipped', requestId: normalizeText(existingRow.request_id) });
                        coveredObjectIds.add(itemId);
                        continue;
                    }
                    if (updateMode === 'update_not_started' && NOT_STARTED_STATUSES.has(existingRequestStatus)) {
                        if (mode === 'execute') {
                            try {
                                await dbQuery(`update requests set
                                   executor_ids = $2::text[],
                                   due_date_preliminary = $3::date,
                                   visit_date = $4::date,
                                   system_type = $5,
                                   updated_at = now()
                                 where id = $1::uuid`, [
                                    existingRow.request_id,
                                    executorIds,
                                    arrivalFrom,
                                    arrivalTo ? new Date(arrivalTo) : null,
                                    normalizeText(plan.system_type) || null,
                                ]);
                                totalUpdated += 1;
                                details.push({ planId, maintenanceItemId: itemId, message: 'Updated (not started)', status: 'updated', requestId: normalizeText(existingRow.request_id) });
                            } catch (error: any) {
                                totalErrors += 1;
                                details.push({ planId, maintenanceItemId: itemId, message: String(error?.message ?? error), status: 'error' });
                            }
                        } else {
                            totalUpdated += 1;
                            details.push({ planId, maintenanceItemId: itemId, message: 'Will be updated (not started)', status: 'updated', requestId: normalizeText(existingRow.request_id) });
                        }
                        coveredObjectIds.add(itemId);
                        continue;
                    }
                    if (updateMode === 'versioning') {
                        if (mode === 'execute') {
                            // Cancel old
                            await dbQuery(`update requests set status = 'cancelled', updated_at = now() where id = $1::uuid`, [existingRow.request_id]);
                            await dbQuery(`update ppr_generated_request_link set status = 'replaced' where id = $1::uuid`, [existingRow.id]);
                        } else {
                            totalCreated += 1;
                            details.push({ planId, maintenanceItemId: itemId, message: 'Will create new version (old cancelled)', status: 'created' });
                            coveredObjectIds.add(itemId);
                            continue;
                        }
                        // Fall through to create new
                    } else {
                        // update_not_started but status is already started
                        totalSkipped += 1;
                        details.push({ planId, maintenanceItemId: itemId, message: `Already exists (${existingRequestStatus}), in progress — skipped`, status: 'skipped', requestId: normalizeText(existingRow.request_id) });
                        coveredObjectIds.add(itemId);
                        continue;
                    }
                }

                // Create new request
                const title = `ТО: ${objectName} — ${normalizeText(plan.system_type) || 'ТО'} (${periodStart.slice(0, 7)})`;
                const systemsList = systemKeys.length > 0 ? `Системы: ${systemKeys.join(', ')}` : 'Системы не указаны';
                const planDescription = normalizeText(plan.description);
                const description = planDescription
                    ? `${planDescription}\n\nОбъект: ${objectName}. Адрес: ${objectAddress || '—'}. ${systemsList}. Окно прибытия: ${arrivalFrom} — ${arrivalTo}.`
                    : `Плановое ТО. Объект: ${objectName}. Адрес: ${objectAddress || '—'}. ${systemsList}. Окно прибытия: ${arrivalFrom} — ${arrivalTo}.`;

                if (mode === 'execute') {
                    try {
                        const reqResult = await dbQuery(`insert into requests(
                           type, is_project, title, description,
                           tenant_id, direction_id, system_type,
                           priority, status, created_by_id,
                           executor_ids, item_ids, system_types,
                           due_date_preliminary, visit_date,
                           maintenance_data,
                           created_at, updated_at
                         ) values(
                           'maintenance_planned', false, $1, $2,
                           $3, $4, $5,
                           'medium', 'new', $6,
                           $7::text[], $8::text[], $9::text[],
                           $10::date, $11::date,
                           $12::jsonb,
                           now(), now()
                         ) returning id::text as id`, [
                            title,
                            description,
                            normalizeText(plan.tenant_id) || null,
                            directionId || null,
                            normalizeText(plan.system_type) || null,
                            normalizeText(request.authUser?.id) || null,
                            executorIds,
                            [itemId],
                            systemKeys,
                            arrivalFrom,
                            arrivalTo,
                            JSON.stringify({
                                planId,
                                objectName,
                                objectAddress,
                                systemsSnapshot,
                                arrivalFrom,
                                arrivalTo,
                                contactPerson: normalizeText(plan.contact_person),
                                contactPhone: normalizeText(plan.contact_phone),
                            }),
                        ]);
                        const requestId = normalizeText(reqResult.rows[0]?.id);
                        // Insert anti-duplicate link
                        await dbQuery(`insert into ppr_generated_request_link(plan_id, object_id, period_start, period_end, request_id)
                           values($1::uuid, $2, $3::date, $4::date, $5::uuid)`, [planId, itemId, periodStart, periodEnd, requestId]);

                        details.push({ planId, maintenanceItemId: itemId, message: 'Request created', status: 'created', requestId, objectName });
                        totalCreated += 1;
                        coveredObjectIds.add(itemId);

                        // Send per-object email if enabled
                        if (plan.send_email === true) {
                            try {
                                await sendMaintenancePlanEmail({
                                    to: normalizeText(plan.contact_person), // will be validated inside
                                    toName: normalizeText(plan.contact_person),
                                    planDate: arrivalFrom,
                                    directionName: normalizeText(item.direction_name),
                                    directionAddress: objectAddress,
                                    executorName: '',
                                    contactPerson: normalizeText(plan.contact_person),
                                    contactPhone: normalizeText(plan.contact_phone),
                                    description,
                                    items: [{ name: objectName, address: objectAddress, systems: systemsSnapshot }],
                                });
                            } catch { /* email best effort */ }
                        }
                        // Send executor instruction email
                        if (plan.notify_executor !== false && executorIds.length > 0) {
                            try {
                                const execResult = await dbQuery(
                                    `select lower(trim(email)) as email, coalesce(nullif(trim(full_name),''), split_part(email,'@',1)) as full_name
                                     from app_users where id = any($1::text[]) and status = 'active' and coalesce(trim(email),'') <> ''`,
                                    [executorIds]
                                );
                                for (const exec of execResult.rows) {
                                    try {
                                        await sendMaintenancePlanEmail({
                                            to: normalizeText(exec.email),
                                            toName: normalizeText(exec.full_name),
                                            planDate: arrivalFrom,
                                            directionName: normalizeText(item.direction_name),
                                            directionAddress: objectAddress,
                                            contactPerson: normalizeText(plan.contact_person),
                                            contactPhone: normalizeText(plan.contact_phone),
                                            description,
                                            items: [{ name: objectName, address: objectAddress, systems: systemsSnapshot }],
                                            recipientRole: 'executor',
                                        });
                                    } catch { /* best effort */ }
                                }
                            } catch { /* best effort */ }
                        }
                    } catch (error: any) {
                        details.push({ planId, maintenanceItemId: itemId, message: String(error?.message ?? error), status: 'error', objectName });
                        totalErrors += 1;
                        missedObjects.push({ objectName, planId, maintenanceItemId: itemId, reason: 'CREATE_FAILED' });
                    }
                } else {
                    details.push({ planId, maintenanceItemId: itemId, message: 'Request will be created', status: 'created', objectName });
                    totalCreated += 1;
                    coveredObjectIds.add(itemId);
                }
            }
        }
        if (mode === 'execute' && planQuery.rows.length > 0) {
            const planIds = planQuery.rows
                .map((row) => normalizeText(row.id))
                .filter((value) => isUuidValue(value));
            if (planIds.length > 0) {
                await dbQuery(`update maintenance_plans
               set last_generated = now(),
                   confirmation_sent_at = now(),
                   escalation_48h_sent = false,
                   escalation_72h_sent = false,
                   visit_reminder_sent = false,
                   report_reminder_sent = false,
                   updated_at = now()
               where id = any($1::uuid[])`, [planIds]);
            }
        }
        const coverage = {
            totalPlannedObjects: allPlannedObjectIds.size,
            coveredObjects: coveredObjectIds.size,
            missedObjects,
        };
        let runId = null;
        if (mode === 'execute') {
            const runResult = await dbQuery(`insert into maintenance_generation_runs(
             plan_id,
             executed_by_id,
             period_month,
             period_year,
             period_start,
             period_end,
             mode,
             total_created,
             total_skipped,
             total_updated,
             total_errors,
             coverage,
             details
           )
           values($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)
           returning id::text as id`, [
                planIdFilter || null,
                normalizeText(request.authUser?.id) || null,
                month,
                year,
                periodStart,
                periodEnd,
                mode,
                totalCreated,
                totalSkipped,
                totalUpdated,
                totalErrors,
                JSON.stringify(coverage),
                JSON.stringify(details),
            ]);
            runId = normalizeText(runResult.rows[0]?.id) || null;
            // Notify managers about generation results
            const adminManagerIds = await getAdminManagerIds();
            if (adminManagerIds.length > 0) {
                const summary = `Создано: ${totalCreated}, пропущено: ${totalSkipped}, обновлено: ${totalUpdated}, ошибок: ${totalErrors}`;
                void pushInAppNotification({
                    recipientIds: adminManagerIds,
                    eventType: totalErrors > 0 ? 'generation_partial_error' : 'generation_success',
                    title: totalErrors > 0 ? 'Генерация ТО: есть ошибки' : 'Генерация ТО выполнена',
                    body: summary,
                    entityType: 'maintenance_generation_run',
                    entityId: runId || '',
                });
            }
        }
        response.status(200).json({
            mode,
            runId,
            periodStart,
            periodEnd,
            created: totalCreated,
            skipped: totalSkipped,
            updated: totalUpdated,
            errors: totalErrors,
            coverage,
            warnings,
            details,
        });
    }));
    // ── Allowed status transitions ────────────────────────────────────
    const PLAN_STATUS_TRANSITIONS = {
        draft: ['active'],
        active: ['paused', 'archived'],
        paused: ['active', 'archived'],
        archived: [] as string[],
    };
    const VALID_PLAN_STATUSES = new Set(['draft', 'active', 'paused', 'archived']);
    const VALID_UPDATE_MODES = new Set(['skip', 'update_not_started', 'versioning']);

    app.get('/maintenance-plans', requireAuth, asyncHandler(async (request, response) => {
        await ensureMaintenanceSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!maintenancePlanManageRoles.has(actorRole) && !projectAdminRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view maintenance plans');
        }
        const conditions = ['mp.deleted_at IS NULL'];
        const params: any[] = [];
        let paramIdx = 0;
        const q = request.query ?? {};
        if (q.status && typeof q.status === 'string' && VALID_PLAN_STATUSES.has(q.status)) {
            paramIdx++; conditions.push(`mp.status = $${paramIdx}`); params.push(q.status);
        }
        if (q.directionId && typeof q.directionId === 'string') {
            paramIdx++; conditions.push(`mp.direction_id = $${paramIdx}`); params.push(normalizeText(q.directionId));
        }
        if (q.executorId && typeof q.executorId === 'string') {
            paramIdx++; conditions.push(`$${paramIdx} = any(mp.default_executor_ids)`); params.push(normalizeText(q.executorId));
        }
        if (q.tenantId && typeof q.tenantId === 'string') {
            paramIdx++; conditions.push(`mp.tenant_id = $${paramIdx}`); params.push(normalizeText(q.tenantId));
        }
        if (q.search && typeof q.search === 'string' && q.search.trim()) {
            const escapedSearch = q.search.trim().replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
            paramIdx++; conditions.push(`(mp.name ilike $${paramIdx} escape '\\' OR mp.system_type ilike $${paramIdx} escape '\\')`); params.push(`%${escapedSearch}%`);
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await dbQuery(`SELECT mp.*, d.name as direction_name
           FROM maintenance_plans mp
           LEFT JOIN directions d ON d.id::text = mp.direction_id AND d.deleted_at IS NULL
           ${where}
           ORDER BY mp.created_at DESC`, params);
        const items = result.rows.map((row) => ({
            ...mapMaintenancePlanRow(row),
            directionName: normalizeText(row.direction_name),
        }));
        response.status(200).json({ items, total: items.length });
    }));
    app.post('/maintenance-plans', requireAuth, asyncHandler(async (request, response) => {
        await ensureMaintenanceSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!maintenancePlanManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to create maintenance plans');
        }
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const maintenanceItemIds = Array.isArray(body.maintenanceItemIds)
            ? body.maintenanceItemIds.map((value) => normalizeText(value)).filter(Boolean)
            : [];
        const dayOfMonth = Number(body.dayOfMonth ?? 1);
        if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'dayOfMonth must be in range 1..31');
        }
        const leadDays = Number(body.leadDays ?? 5);
        if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'leadDays must be in range 0..365');
        }
        const arrivalFromDay = Number(body.arrivalFromDay ?? 1);
        const arrivalToDay = Number(body.arrivalToDay ?? 28);
        if (!Number.isInteger(arrivalFromDay) || arrivalFromDay < 1 || arrivalFromDay > 31) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'arrivalFromDay must be in range 1..31');
        }
        if (!Number.isInteger(arrivalToDay) || arrivalToDay < 1 || arrivalToDay > 31) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'arrivalToDay must be in range 1..31');
        }
        if (arrivalFromDay > arrivalToDay) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'arrivalFromDay must be <= arrivalToDay');
        }
        const periodOffset = Number(body.periodOffset ?? 1);
        if (!Number.isInteger(periodOffset) || periodOffset < 0 || periodOffset > 12) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'periodOffset must be in range 0..12');
        }
        const updateMode = normalizeText(body.updateMode) || 'skip';
        if (!VALID_UPDATE_MODES.has(updateMode)) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'updateMode must be skip, update_not_started, or versioning');
        }
        const status = normalizeText(body.status) || 'draft';
        if (!VALID_PLAN_STATUSES.has(status)) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid status');
        }
        // For activation require mandatory fields
        if (status === 'active') {
            if (maintenanceItemIds.length === 0) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'At least one object is required to activate a plan');
            }
            const defaultExecutorIdsCheck = Array.isArray(body.defaultExecutorIds)
                ? body.defaultExecutorIds.map((value) => normalizeText(value)).filter(Boolean)
                : [];
            if (defaultExecutorIdsCheck.length === 0) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'At least one executor is required to activate a plan');
            }
        }
        const validFrom = parseDateOnlyValue(body.validFrom, 'validFrom') ?? new Date().toISOString().split('T')[0];
        const validTo = body.validTo === null
            ? null
            : parseDateOnlyValue(body.validTo, 'validTo');
        const defaultExecutorIds = Array.isArray(body.defaultExecutorIds)
            ? body.defaultExecutorIds.map((value) => normalizeText(value)).filter(Boolean)
            : [];
        const planName = normalizeText(body.name) || '';
        const directionId = normalizeText(body.directionId) || null;
        const result = await dbQuery(`insert into maintenance_plans(
           name,
           tenant_id,
           direction_id,
           maintenance_item_ids,
           system_type,
           frequency,
           day_of_month,
           lead_days,
           workday_rule,
           valid_from,
           valid_to,
           status,
           is_active,
           arrival_from_day,
           arrival_to_day,
           period_offset,
           update_mode,
           send_email,
           notify_executor,
           notify_manager,
           default_executor_ids,
           contact_person,
           contact_phone,
           created_by_id,
           description
         )
         values($1, $2, $3, $4::text[], $5, $6, $7, $8, $9, $10::date, $11::date, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::text[], $22, $23, $24, $25)
         returning *`, [
            planName,
            normalizeText(body.tenantId) || null,
            directionId,
            maintenanceItemIds,
            normalizeText(body.systemType),
            normalizeText(body.frequency) || 'monthly',
            dayOfMonth,
            leadDays,
            normalizeText(body.workdayRule) || 'PREVIOUS_WORKDAY',
            validFrom,
            validTo,
            status,
            status === 'active',
            arrivalFromDay,
            arrivalToDay,
            periodOffset,
            updateMode,
            body.sendEmail === true,
            body.notifyExecutor !== false,
            body.notifyManager !== false,
            defaultExecutorIds,
            normalizeText(body.contactPerson),
            normalizeText(body.contactPhone),
            normalizeText(request.authUser?.id) || null,
            normalizeText(body.description),
        ]);
        const adminManagerIds = await getAdminManagerIds();
        void pushInAppNotification({
            recipientIds: adminManagerIds,
            eventType: 'maintenance_plan_created',
            title: 'Создан план ТО',
            body: `${planName || normalizeText(body.systemType) || 'Новый план'}`,
            entityType: 'maintenance_plan',
            entityId: String(result.rows[0]?.id ?? ''),
        });
        response.status(201).json(mapMaintenancePlanRow(result.rows[0]));
    }));
    app.patch('/maintenance-plans/:planId', requireAuth, asyncHandler(async (request, response) => {
        await ensureMaintenanceSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!maintenancePlanManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to update maintenance plans');
        }
        const planId = parseUuidPath(request.params.planId);
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const existingResult = await dbQuery(`select * from maintenance_plans where id = $1::uuid and deleted_at is null limit 1`, [planId]);
        const existing = existingResult.rows[0];
        if (!existing) {
            throw new ApiError(404, 'PLAN_NOT_FOUND', 'Maintenance plan not found');
        }
        const currentStatus = normalizeText(existing.status) || 'active';
        // Archived plans cannot be edited (except status change is not allowed either)
        if (currentStatus === 'archived') {
            throw new ApiError(422, 'PLAN_ARCHIVED', 'Archived plans cannot be edited');
        }
        // Status transition validation
        let newStatus = currentStatus;
        if (body.status !== undefined) {
            newStatus = normalizeText(body.status);
            if (!VALID_PLAN_STATUSES.has(newStatus)) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid status');
            }
            if (newStatus !== currentStatus) {
                const allowed = PLAN_STATUS_TRANSITIONS[currentStatus] || [];
                if (!allowed.includes(newStatus)) {
                    throw new ApiError(422, 'INVALID_TRANSITION', `Cannot transition from ${currentStatus} to ${newStatus}`);
                }
                // Archive requires admin/manager
                if (newStatus === 'archived' && !projectAdminRoles.has(actorRole) && actorRole !== 'manager') {
                    throw new ApiError(403, 'FORBIDDEN', 'Only admin or manager can archive plans');
                }
            }
        }
        let maintenanceItemIds = Array.isArray(existing.maintenance_item_ids)
            ? existing.maintenance_item_ids.map((value) => normalizeText(value)).filter(Boolean)
            : [];
        if (Array.isArray(body.maintenanceItemIds)) {
            maintenanceItemIds = body.maintenanceItemIds.map((value) => normalizeText(value)).filter(Boolean);
        }
        let dayOfMonth = Number(existing.day_of_month ?? 1);
        if (body.dayOfMonth !== undefined) {
            dayOfMonth = Number(body.dayOfMonth);
            if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'dayOfMonth must be in range 1..31');
            }
        }
        let leadDays = Number(existing.lead_days ?? 5);
        if (body.leadDays !== undefined) {
            leadDays = Number(body.leadDays);
            if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'leadDays must be in range 0..365');
            }
        }
        let arrivalFromDay = Number(existing.arrival_from_day ?? 1);
        let arrivalToDay = Number(existing.arrival_to_day ?? 28);
        if (body.arrivalFromDay !== undefined) {
            arrivalFromDay = Number(body.arrivalFromDay);
            if (!Number.isInteger(arrivalFromDay) || arrivalFromDay < 1 || arrivalFromDay > 31) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'arrivalFromDay must be in range 1..31');
            }
        }
        if (body.arrivalToDay !== undefined) {
            arrivalToDay = Number(body.arrivalToDay);
            if (!Number.isInteger(arrivalToDay) || arrivalToDay < 1 || arrivalToDay > 31) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'arrivalToDay must be in range 1..31');
            }
        }
        if (arrivalFromDay > arrivalToDay) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'arrivalFromDay must be <= arrivalToDay');
        }
        let periodOffset = Number(existing.period_offset ?? 1);
        if (body.periodOffset !== undefined) {
            periodOffset = Number(body.periodOffset);
            if (!Number.isInteger(periodOffset) || periodOffset < 0 || periodOffset > 12) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'periodOffset must be in range 0..12');
            }
        }
        let updateMode = normalizeText(existing.update_mode) || 'skip';
        if (body.updateMode !== undefined) {
            updateMode = normalizeText(body.updateMode);
            if (!VALID_UPDATE_MODES.has(updateMode)) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'updateMode must be skip, update_not_started, or versioning');
            }
        }
        // Activation requires mandatory fields
        if (newStatus === 'active') {
            if (maintenanceItemIds.length === 0) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'At least one object is required to activate a plan');
            }
            const execIds = Array.isArray(body.defaultExecutorIds)
                ? body.defaultExecutorIds.map((value) => normalizeText(value)).filter(Boolean)
                : (Array.isArray(existing.default_executor_ids) ? existing.default_executor_ids.filter(Boolean) : []);
            if (execIds.length === 0) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'At least one executor is required to activate a plan');
            }
        }
        const validFrom = body.validFrom !== undefined
            ? (parseDateOnlyValue(body.validFrom, 'validFrom') ?? (existing.valid_from instanceof Date ? existing.valid_from.toISOString().slice(0, 10) : String(existing.valid_from ?? '')))
            : (existing.valid_from instanceof Date ? existing.valid_from.toISOString().slice(0, 10) : String(existing.valid_from ?? ''));
        const validTo = body.validTo !== undefined
            ? (body.validTo === null ? null : parseDateOnlyValue(body.validTo, 'validTo'))
            : (existing.valid_to ? (existing.valid_to instanceof Date ? existing.valid_to.toISOString().slice(0, 10) : String(existing.valid_to)) : null);
        const defaultExecutorIds = Array.isArray(body.defaultExecutorIds)
            ? body.defaultExecutorIds.map((value) => normalizeText(value)).filter(Boolean)
            : (Array.isArray(existing.default_executor_ids)
                ? existing.default_executor_ids.map((value) => normalizeText(value)).filter(Boolean)
                : []);
        const result = await dbQuery(`update maintenance_plans
           set name = $2,
               tenant_id = $3,
               direction_id = $4,
               maintenance_item_ids = $5::text[],
               system_type = $6,
               frequency = $7,
               day_of_month = $8,
               lead_days = $9,
               workday_rule = $10,
               valid_from = $11::date,
               valid_to = $12::date,
               status = $13,
               is_active = $14,
               arrival_from_day = $15,
               arrival_to_day = $16,
               period_offset = $17,
               update_mode = $18,
               send_email = $19,
               notify_executor = $20,
               notify_manager = $21,
               default_executor_ids = $22::text[],
               contact_person = $23,
               contact_phone = $24,
               description = $25,
               updated_at = now()
           where id = $1::uuid
           returning *`, [
            planId,
            body.name !== undefined ? normalizeText(body.name) : normalizeText(existing.name),
            body.tenantId !== undefined ? (normalizeText(body.tenantId) || null) : (normalizeText(existing.tenant_id) || null),
            body.directionId !== undefined ? (normalizeText(body.directionId) || null) : (normalizeText(existing.direction_id) || null),
            maintenanceItemIds,
            body.systemType !== undefined ? normalizeText(body.systemType) : normalizeText(existing.system_type),
            body.frequency !== undefined ? normalizeText(body.frequency) : normalizeText(existing.frequency),
            dayOfMonth,
            leadDays,
            body.workdayRule !== undefined ? normalizeText(body.workdayRule) : normalizeText(existing.workday_rule),
            validFrom,
            validTo,
            newStatus,
            newStatus === 'active',
            arrivalFromDay,
            arrivalToDay,
            periodOffset,
            updateMode,
            body.sendEmail !== undefined ? body.sendEmail === true : existing.send_email === true,
            body.notifyExecutor !== undefined ? body.notifyExecutor !== false : existing.notify_executor !== false,
            body.notifyManager !== undefined ? body.notifyManager !== false : existing.notify_manager !== false,
            defaultExecutorIds,
            body.contactPerson !== undefined ? normalizeText(body.contactPerson) : normalizeText(existing.contact_person),
            body.contactPhone !== undefined ? normalizeText(body.contactPhone) : normalizeText(existing.contact_phone),
            body.description !== undefined ? normalizeText(body.description) : normalizeText(existing.description),
        ]);
        const eventType = newStatus !== currentStatus ? 'maintenance_plan_status_changed' : 'maintenance_plan_updated';
        const title = newStatus !== currentStatus
            ? `План ТО: ${currentStatus} → ${newStatus}`
            : 'План ТО обновлён';
        const adminManagerIds = await getAdminManagerIds();
        void pushInAppNotification({
            recipientIds: adminManagerIds,
            eventType,
            title,
            body: normalizeText(result.rows[0]?.name) || `План ${planId}`,
            entityType: 'maintenance_plan',
            entityId: String(planId),
        });
        response.status(200).json(mapMaintenancePlanRow(result.rows[0]));
    }));
    app.delete('/maintenance-plans/:planId', requireAuth, asyncHandler(async (request, response) => {
        await ensureMaintenanceSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!maintenancePlanManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to delete maintenance plans');
        }
        const planId = parseUuidPath(request.params.planId);
        const result = await dbQuery(`update maintenance_plans
           set deleted_at = now(), status = 'archived', is_active = false, updated_at = now()
           where id = $1::uuid and deleted_at is null
           returning id::text as id`, [planId]);
        if (result.rows.length === 0) {
            throw new ApiError(404, 'PLAN_NOT_FOUND', 'Maintenance plan not found');
        }
        const adminManagerIds = await getAdminManagerIds();
        void pushInAppNotification({
            recipientIds: adminManagerIds,
            eventType: 'maintenance_plan_deleted',
            title: 'План ТО удалён',
            body: `План обслуживания ${planId} удалён`,
            entityType: 'maintenance_plan',
            entityId: String(planId),
        });
        response.status(204).send();
    }));
    // ── Single plan card with generated requests ────────────────────────
    app.get('/maintenance-plans/:planId', requireAuth, asyncHandler(async (request, response) => {
        await ensureMaintenanceSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!maintenancePlanManageRoles.has(actorRole) && !projectAdminRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const planId = parseUuidPath(request.params.planId);
        const planResult = await dbQuery(`select mp.*, d.name as direction_name
           from maintenance_plans mp
           left join directions d on d.id::text = mp.direction_id and d.deleted_at is null
           where mp.id = $1::uuid and mp.deleted_at is null
           limit 1`, [planId]);
        if (planResult.rows.length === 0) {
            throw new ApiError(404, 'PLAN_NOT_FOUND', 'Plan not found');
        }
        const plan = {
            ...mapMaintenancePlanRow(planResult.rows[0]),
            directionName: normalizeText(planResult.rows[0].direction_name),
        };
        response.status(200).json(plan);
    }));
    // ── Generated requests for a plan ───────────────────────────────────
    app.get('/maintenance-plans/:planId/requests', requireAuth, asyncHandler(async (request, response) => {
        await ensureMaintenanceSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!maintenancePlanManageRoles.has(actorRole) && !projectAdminRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const planId = parseUuidPath(request.params.planId);
        const result = await dbQuery(`select
           lnk.id as link_id,
           lnk.object_id,
           lnk.period_start,
           lnk.period_end,
           lnk.status as link_status,
           lnk.created_at as link_created_at,
           r.id::text as request_id,
           r.title as request_title,
           r.status as request_status,
           r.priority as request_priority,
           r.due_date_preliminary as request_due_date,
           mi.name as object_name,
           mi.address as object_address
         from ppr_generated_request_link lnk
         left join requests r on r.id = lnk.request_id
         left join maintenance_items mi on mi.id::text = lnk.object_id and mi.deleted_at is null
         where lnk.plan_id = $1::uuid
         order by lnk.period_start desc, lnk.created_at desc
         limit 500`, [planId]);
        const items = result.rows.map((row) => ({
            linkId: normalizeText(row.link_id),
            objectId: normalizeText(row.object_id),
            objectName: normalizeText(row.object_name),
            objectAddress: normalizeText(row.object_address),
            periodStart: row.period_start ? String(row.period_start).slice(0, 10) : '',
            periodEnd: row.period_end ? String(row.period_end).slice(0, 10) : '',
            linkStatus: normalizeText(row.link_status),
            requestId: normalizeText(row.request_id),
            requestTitle: normalizeText(row.request_title),
            requestStatus: normalizeText(row.request_status),
            requestPriority: normalizeText(row.request_priority),
            requestDueDate: row.request_due_date ? String(row.request_due_date).slice(0, 10) : '',
            createdAt: row.link_created_at ? new Date(row.link_created_at).toISOString() : '',
        }));
        response.status(200).json({ items, total: items.length });
    }));
    // ── Generation logs for a plan ──────────────────────────────────────
    app.get('/maintenance-plans/:planId/logs', requireAuth, asyncHandler(async (request, response) => {
        await ensureMaintenanceSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!maintenancePlanManageRoles.has(actorRole) && !projectAdminRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const planId = parseUuidPath(request.params.planId);
        const result = await dbQuery(`select * from maintenance_generation_runs
           where plan_id = $1::uuid
           order by executed_at desc
           limit 50`, [planId]);
        response.status(200).json({
            items: result.rows.map(mapGenerationRunRow),
            total: result.rows.length,
        });
    }));
    app.post('/maintenance-plans/:planId/confirm', publicLimiter, asyncHandler(async (request, response) => {
        await ensureMaintenanceSchema();
        await ensureNotificationSchema();
        const planId = parseUuidPath(request.params.planId);
        const token = normalizeText(request.query?.token ?? request.body?.token);
        const action = normalizeText(request.query?.action ?? request.body?.action) || 'confirm';
        if (!token) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Token is required');
        }
        if (!['confirm', 'reschedule'].includes(action)) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Action must be confirm or reschedule');
        }
        const tokenCheck = await dbQuery(`SELECT id FROM maintenance_plan_confirmations WHERE plan_id = $1::uuid AND token = $2 LIMIT 1`, [planId, token]);
        if (tokenCheck.rows.length === 0) throw new ApiError(403, 'INVALID_TOKEN', 'Invalid or expired confirmation token');
        const planResult = await dbQuery(`select id::text as id
         from maintenance_plans
         where id = $1::uuid
         limit 1`, [planId]);
        if (planResult.rows.length === 0) {
            throw new ApiError(404, 'PLAN_NOT_FOUND', 'Plan not found');
        }
        await dbQuery(`update maintenance_plan_confirmations set action = $2, responded_by = $4, confirmed_at = now() where plan_id = $1::uuid and token = $3`, [
            planId,
            action,
            token,
            normalizeText(request.authUser?.id) || null,
        ]);
        const adminIds = await getAdminManagerIds();
        void pushInAppNotification({
            recipientIds: adminIds,
            eventType: 'plan_action',
            title: action === 'confirm' ? 'ТО согласовано' : 'Запрошен перенос ТО',
            body: `План ${planId}`,
            entityType: 'maintenance_plan',
            entityId: String(planId),
        });
        response.status(200).json({
            status: action === 'confirm' ? 'confirmed' : 'reschedule_requested',
            message: action === 'confirm'
                ? 'ТО согласовано. Спасибо!'
                : 'Запрос на перенос отправлен. Диспетчер свяжется с вами.',
        });
    }));
    app.get('/maintenance-plans/:planId/confirm', publicLimiter, asyncHandler(async (request, response) => {
        await ensureMaintenanceSchema();
        await ensureNotificationSchema();
        const planId = parseUuidPath(request.params.planId);
        const token = normalizeText(request.query?.token);
        const action = normalizeText(request.query?.action) || 'confirm';
        if (!token) throw new ApiError(422, 'VALIDATION_ERROR', 'Token is required');
        if (!['confirm', 'reschedule'].includes(action)) throw new ApiError(422, 'VALIDATION_ERROR', 'Action must be confirm or reschedule');
        const tokenCheck = await dbQuery(`SELECT id FROM maintenance_plan_confirmations WHERE plan_id = $1::uuid AND token = $2 LIMIT 1`, [planId, token]);
        if (tokenCheck.rows.length === 0) throw new ApiError(403, 'INVALID_TOKEN', 'Invalid or expired confirmation token');
        const planResult = await dbQuery(`select id::text as id from maintenance_plans where id = $1::uuid limit 1`, [planId]);
        if (planResult.rows.length === 0) throw new ApiError(404, 'PLAN_NOT_FOUND', 'Plan not found');
        await dbQuery(`update maintenance_plan_confirmations set action = $2, responded_by = $4, confirmed_at = now() where plan_id = $1::uuid and token = $3`, [
            planId, action, token, normalizeText(request.authUser?.id) || null,
        ]);
        const adminIds = await getAdminManagerIds();
        void pushInAppNotification({
            recipientIds: adminIds,
            eventType: 'plan_action',
            title: action === 'confirm' ? 'ТО согласовано' : 'Запрошен перенос ТО',
            body: `План ${planId}`,
            entityType: 'maintenance_plan',
            entityId: String(planId),
        });
        const message = action === 'confirm' ? 'ТО согласовано. Спасибо!' : 'Запрос на перенос отправлен. Диспетчер свяжется с вами.';
        response.status(200).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Новинжстрой</title></head><body style="font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;"><div style="text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.1);max-width:400px;"><h1 style="color:#16a34a;font-size:24px;margin:0 0 12px;">&#10003;</h1><p style="color:#1e293b;font-size:16px;margin:0;">${message}</p></div></body></html>`);
    }));
    app.get('/calendar/maintenance-plans/:planId.ics', requireAuth, asyncHandler(async (request, response) => {
        await ensureMaintenanceSchema();
        const planId = parseUuidPath(request.params.planId);
        const planResult = await dbQuery(`select
           mp.*,
           coalesce(t.brand_name, t.name, '') as tenant_name
         from maintenance_plans mp
         left join tenants t on t.id::text = mp.tenant_id
         where mp.id = $1::uuid
         limit 1`, [planId]);
        if (planResult.rows.length === 0) {
            throw new ApiError(404, 'PLAN_NOT_FOUND', 'Plan not found');
        }
        const plan = planResult.rows[0];
        const maintenanceItemIds = Array.isArray(plan.maintenance_item_ids)
            ? plan.maintenance_item_ids.map((value) => normalizeText(value)).filter(Boolean)
            : [];
        let directionName = '';
        let directionAddress = '';
        if (maintenanceItemIds.length > 0) {
            const directionResult = await dbQuery(`select
             d.name,
             d.address
           from maintenance_items mi
           join directions d on d.id::text = mi.direction_id
           where mi.id::text = any($1::text[])
             and mi.deleted_at is null
             and d.deleted_at is null
           order by mi.created_at asc
           limit 1`, [maintenanceItemIds]);
            directionName = normalizeText(directionResult.rows[0]?.name);
            directionAddress = normalizeText(directionResult.rows[0]?.address);
        }
        const event = generateIcsEvent({
            uid: planId,
            summary: `ТО - ${directionName || normalizeText(plan.system_type) || 'Плановое обслуживание'}`,
            description: `Плановое ТО (${normalizeText(plan.system_type) || 'без типа системы'})`,
            location: directionAddress,
            dtstart: plan.valid_from ? new Date(plan.valid_from).toISOString() : new Date().toISOString(),
        });
        sendIcsResponse(response, wrapIcsCalendar(event), `to-${planId}.ics`);
    }));
};
