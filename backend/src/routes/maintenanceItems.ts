import { canUseInternalGlobalExport } from '../helpers/accessGates.js';
import { appendDirectionScopeCondition } from '../helpers/directionAccess.js';

export const canExportMaintenanceItems = canUseInternalGlobalExport;

export const registerMockMaintenanceItemRoutes = (params) => {
    const {
        app,
        requireAuth,
        ApiError,
        randomUUID,
        normalizeText,
        maintenanceItemManageRoles,
        maintenanceItemViewRoles,
        internalGlobalRoles,
        getLocalMockBodyObject,
        toCsvCell,
        localMockUsers,
        localMockNotifications,
        localMockMaintenanceItems,
    } = params;
    app.get('/client-managers', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!maintenanceItemManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const managers = localMockUsers.filter((u) => u.role === 'client_manager');
        response.status(200).json({
            items: managers.map((u) => ({
                id: u.id,
                fullName: u.fullName ?? u.full_name ?? '',
            })),
        });
    });
    app.get('/maintenance-items', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!maintenanceItemViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const directionId = normalizeText(request.query?.direction_id);
        const search = normalizeText(request.query?.search).toLowerCase();
        let items = [...localMockMaintenanceItems];
        if (directionId) {
            items = items.filter((item) => item.directionId === directionId);
        }
        if (search) {
            items = items.filter((item) => {
                const name = normalizeText(item.name).toLowerCase();
                const address = normalizeText(item.address).toLowerCase();
                const legalEntity = normalizeText(item.legalEntity).toLowerCase();
                const position = normalizeText(item.positionNumber).toLowerCase();
                return name.includes(search) || address.includes(search) || legalEntity.includes(search) || position.includes(search);
            });
        }
        response.status(200).json({
            items,
            total: items.length,
        });
    });
    app.get('/directions/:directionId/items', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!maintenanceItemViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const items = localMockMaintenanceItems
            .filter((item) => item.directionId === request.params.directionId)
            .map((item) => {
                const managerUser = item.managerId
                    ? localMockUsers.find((u) => u.id === item.managerId && u.role === 'client_manager')
                    : null;
                return {
                    ...item,
                    managerName: managerUser?.fullName ?? managerUser?.full_name ?? null,
                };
            });
        response.status(200).json({
            items,
            total: items.length,
        });
    });
    app.put('/directions/:directionId/items/:itemId/manager', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!maintenanceItemManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const item = localMockMaintenanceItems.find(
            (candidate) => candidate.id === request.params.itemId && candidate.directionId === request.params.directionId
        );
        if (!item) {
            throw new ApiError(404, 'ITEM_NOT_FOUND', 'Maintenance item not found');
        }
        const body = getLocalMockBodyObject(request.body);
        const userId = normalizeText(body.userId);
        if (userId) {
            const user = localMockUsers.find((u) => u.id === userId && u.role === 'client_manager');
            if (!user) {
                throw new ApiError(422, 'VALIDATION_ERROR', 'User not found or is not a client_manager');
            }
            item.managerId = userId;
            item.managerName = user.fullName ?? user.full_name ?? null;
        } else {
            item.managerId = null;
            item.managerName = null;
        }
        response.status(200).json(item);
    });
    app.post('/directions/:directionId/items', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!maintenanceItemManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const body = getLocalMockBodyObject(request.body);
        const item = {
            id: randomUUID(),
            directionId: request.params.directionId,
            positionNumber: normalizeText(body.positionNumber),
            name: normalizeText(body.name) || 'Без названия',
            address: normalizeText(body.address),
            legalEntity: normalizeText(body.legalEntity),
            contractNumber: normalizeText(body.contractNumber),
            systems: body.systems && typeof body.systems === 'object' ? body.systems : {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        localMockMaintenanceItems.push(item);
        for (const user of localMockUsers) {
            if (user.role !== 'admin' && user.role !== 'manager') {
                continue;
            }
            localMockNotifications.push({
                id: randomUUID(),
                userId: user.id,
                eventType: 'item_created',
                title: `Новый объект в "${request.params.directionId}": ${item.name || item.id}`,
                body: item.address,
                entityType: 'maintenance_item',
                entityId: item.id,
                isRead: false,
                createdAt: new Date().toISOString(),
            });
        }
        response.status(201).json(item);
    });
    app.post('/directions/:directionId/items/import', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!maintenanceItemManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const rows = Array.isArray(request.body?.rows) ? request.body.rows : [];
        const errors = [];
        const created = [];
        for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index] && typeof rows[index] === 'object' ? rows[index] : {};
            const name = typeof row.name === 'string' ? row.name.trim() : '';
            if (!name) {
                errors.push({
                    row: index + 1,
                    field: 'name',
                    message: 'Название обязательно',
                });
                continue;
            }
            const item = {
                id: randomUUID(),
                directionId: request.params.directionId,
                positionNumber: normalizeText(row.positionNumber) || String(index + 1),
                name,
                address: normalizeText(row.address),
                legalEntity: normalizeText(row.legalEntity),
                contractNumber: normalizeText(row.contractNumber),
                systems: row.systems && typeof row.systems === 'object'
                    ? row.systems
                    : {
                        aps: false,
                        soue: false,
                        aupt: false,
                        vpv: false,
                        fireExtinguishers: false,
                        exitSigns: false,
                        gas: false,
                    },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            localMockMaintenanceItems.push(item);
            created.push(item);
        }
        if (errors.length > 0 && created.length === 0) {
            response.status(422).json({
                imported: 0,
                errors,
            });
            return;
        }
        response.status(200).json({
            imported: created.length,
            errors,
            items: created,
        });
    });
    app.get('/directions/:directionId/items/export', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!canExportMaintenanceItems(actorRole, internalGlobalRoles)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const items = localMockMaintenanceItems.filter((item) => item.directionId === request.params.directionId);
        const csvHeader = '№,Объект/Локация,Адрес,Юр.лицо,Договор,АПС,СОУЭ,АУПТ,ВПВ,Огнетушители,Табло,Газ';
        const csvRows = items.map((item) => [
            toCsvCell(item.positionNumber),
            toCsvCell(item.name),
            toCsvCell(item.address),
            toCsvCell(item.legalEntity),
            toCsvCell(item.contractNumber),
            item.systems?.aps ? 1 : 0,
            item.systems?.soue ? 1 : 0,
            item.systems?.aupt ? 1 : 0,
            item.systems?.vpv ? 1 : 0,
            item.systems?.fireExtinguishers ? 1 : 0,
            item.systems?.exitSigns ? 1 : 0,
            item.systems?.gas ? 1 : 0,
        ].join(','));
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', `attachment; filename=\"items-${request.params.directionId}.csv\"`);
        response.status(200).send(`\uFEFF${[csvHeader, ...csvRows].join('\n')}`);
    });
    app.get('/directions/:directionId/items/export-xlsx', requireAuth, async (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!canExportMaintenanceItems(actorRole, internalGlobalRoles)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const items = localMockMaintenanceItems.filter((item) => item.directionId === request.params.directionId);
        const { sendXlsxResponse } = await import('../helpers/xlsxHelpers.js');
        await sendXlsxResponse(response, `items-${request.params.directionId}`, [
            { header: '№', key: 'positionNumber', width: 8 },
            { header: 'Объект', key: 'name', width: 32 },
            { header: 'Адрес', key: 'address', width: 36 },
            { header: 'Юр. лицо', key: 'legalEntity', width: 26 },
            { header: 'Договор', key: 'contractNumber', width: 18 },
            { header: 'АПС', key: 'aps', width: 8 },
            { header: 'СОУЭ', key: 'soue', width: 8 },
            { header: 'АУПТ', key: 'aupt', width: 8 },
            { header: 'ВПВ', key: 'vpv', width: 8 },
            { header: 'Огнетушители', key: 'fireExtinguishers', width: 16 },
            { header: 'Табло', key: 'exitSigns', width: 10 },
            { header: 'Газ', key: 'gas', width: 8 },
        ], items.map((item) => ({
            positionNumber: String(item.positionNumber ?? ''),
            name: String(item.name ?? ''),
            address: String(item.address ?? ''),
            legalEntity: String(item.legalEntity ?? ''),
            contractNumber: String(item.contractNumber ?? ''),
            aps: item.systems?.aps ? 'Да' : 'Нет',
            soue: item.systems?.soue ? 'Да' : 'Нет',
            aupt: item.systems?.aupt ? 'Да' : 'Нет',
            vpv: item.systems?.vpv ? 'Да' : 'Нет',
            fireExtinguishers: item.systems?.fireExtinguishers ? 'Да' : 'Нет',
            exitSigns: item.systems?.exitSigns ? 'Да' : 'Нет',
            gas: item.systems?.gas ? 'Да' : 'Нет',
        })));
    });
    app.get('/directions/:directionId/items/:itemId', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!maintenanceItemViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const item = localMockMaintenanceItems.find((candidate) => candidate.id === request.params.itemId
            && candidate.directionId === request.params.directionId);
        if (!item) {
            throw new ApiError(404, 'ITEM_NOT_FOUND', 'Maintenance item not found');
        }
        response.status(200).json(item);
    });
    app.patch('/directions/:directionId/items/:itemId', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!maintenanceItemManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const item = localMockMaintenanceItems.find((candidate) => candidate.id === request.params.itemId
            && candidate.directionId === request.params.directionId);
        if (!item) {
            throw new ApiError(404, 'ITEM_NOT_FOUND', 'Maintenance item not found');
        }
        const body = getLocalMockBodyObject(request.body);
        if (body.positionNumber !== undefined) {
            item.positionNumber = normalizeText(body.positionNumber);
        }
        if (body.name !== undefined) {
            item.name = normalizeText(body.name);
        }
        if (body.address !== undefined) {
            item.address = normalizeText(body.address);
        }
        if (body.legalEntity !== undefined) {
            item.legalEntity = normalizeText(body.legalEntity);
        }
        if (body.contractNumber !== undefined) {
            item.contractNumber = normalizeText(body.contractNumber);
        }
        if (body.systems !== undefined && body.systems && typeof body.systems === 'object') {
            item.systems = body.systems;
        }
        item.updatedAt = new Date().toISOString();
        response.status(200).json(item);
    });
    app.delete('/directions/:directionId/items/:itemId', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!maintenanceItemManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const idx = localMockMaintenanceItems.findIndex((candidate) => candidate.id === request.params.itemId
            && candidate.directionId === request.params.directionId);
        if (idx < 0) {
            throw new ApiError(404, 'ITEM_NOT_FOUND', 'Maintenance item not found');
        }
        const [removedItem] = localMockMaintenanceItems.splice(idx, 1);
        for (const user of localMockUsers) {
            if (user.role !== 'admin' && user.role !== 'manager') {
                continue;
            }
            localMockNotifications.push({
                id: randomUUID(),
                userId: user.id,
                eventType: 'item_deleted',
                title: `Объект удалён: ${normalizeText(removedItem?.name) || request.params.itemId}`,
                body: '',
                entityType: 'maintenance_item',
                entityId: request.params.itemId,
                isRead: false,
                createdAt: new Date().toISOString(),
            });
        }
        response.status(204).send();
    });
};

export const registerMaintenanceItemRoutes = (params) => {
    const {
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
        internalGlobalRoles,
        mapMaintenanceItemRow,
        getAdminManagerIds,
        pushInAppNotification,
    } = params;
    app.get('/client-managers', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = request.authUser?.role ?? '';
    if (!maintenanceItemManageRoles.has(actorRole)) {
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
    }
    const result = await dbQuery(`select u.id, u.full_name
       from app_users u
       where u.role = 'client_manager' and u.status = 'active'
       order by u.full_name asc`, []);
    response.status(200).json({
        items: result.rows.map((row) => ({
            id: String(row.id),
            fullName: String(row.full_name ?? ''),
        })),
    });
    }));
    app.get('/maintenance-items', requireAuth, asyncHandler(async (request, response) => {
    await ensureMaintenanceItemSchema();
    const actorRole = request.authUser?.role ?? '';
    if (!maintenanceItemViewRoles.has(actorRole)) {
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
    }
    const directionId = normalizeText(request.query?.direction_id);
    const search = normalizeText(request.query?.search).toLowerCase();
    const conditions = [`mi.deleted_at is null`, `d.deleted_at is null`];
    const values = [];
    const push = (value) => {
        values.push(value);
        return `$${values.length}`;
    };
    if (directionId) {
        const directionRef = push(directionId);
        conditions.push(`mi.direction_id = ${directionRef}::text`);
    }
    if (search) {
        const searchRef = push(`%${search}%`);
        conditions.push(`(
        lower(coalesce(mi.name, '')) like ${searchRef}
        or lower(coalesce(mi.address, '')) like ${searchRef}
        or lower(coalesce(mi.legal_entity, '')) like ${searchRef}
        or lower(coalesce(mi.position_number, '')) like ${searchRef}
      )`);
    }
    await appendDirectionScopeCondition({
        actorUserId: request.authUser?.id ?? '',
        actorRole,
        conditions,
        values,
        queryFn: dbQuery,
        tableAlias: 'd',
        directionIdColumn: 'id',
    });
    const whereSql = conditions.join(' and ');
    const result = await dbQuery(`select mi.*,
       mgr_bind.user_id as manager_id,
       mgr_user.full_name as manager_name
       from maintenance_items mi
       join directions d on d.id::text = mi.direction_id::text
       left join app_user_object_bindings mgr_bind on mgr_bind.object_id = mi.id
       left join app_users mgr_user on mgr_user.id = mgr_bind.user_id and mgr_user.role = 'client_manager'
       where ${whereSql}
       order by mi.direction_id asc, mi.position_number asc, mi.created_at asc`, values);
    response.status(200).json({
        items: result.rows.map(mapMaintenanceItemRow),
        total: result.rows.length,
    });
    }));
    app.get('/directions/:directionId/items', requireAuth, asyncHandler(async (request, response) => {
    await ensureMaintenanceItemSchema();
    const actorRole = request.authUser?.role ?? '';
    if (!maintenanceItemViewRoles.has(actorRole)) {
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
    }
    const directionId = parseUuidPath(request.params.directionId);
    const search = normalizeText(request.query?.search).toLowerCase();
    const conditions = [`mi.direction_id = $1::uuid`, `mi.deleted_at is null`, `d.deleted_at is null`];
    const values = [directionId];
    const push = (value) => {
        values.push(value);
        return `$${values.length}`;
    };
    if (search) {
        const searchRef = push(`%${search}%`);
        conditions.push(`(
        lower(coalesce(mi.name, '')) like ${searchRef}
        or lower(coalesce(mi.address, '')) like ${searchRef}
        or lower(coalesce(mi.legal_entity, '')) like ${searchRef}
      )`);
    }
    await appendDirectionScopeCondition({
        actorUserId: request.authUser?.id ?? '',
        actorRole,
        conditions,
        values,
        queryFn: dbQuery,
        tableAlias: 'd',
        directionIdColumn: 'id',
    });
    const whereSql = conditions.join(' and ');
    const result = await dbQuery(`select mi.*,
       mgr_bind.user_id as manager_id,
       mgr_user.full_name as manager_name
       from maintenance_items mi
       join directions d on d.id::text = mi.direction_id::text
       left join app_user_object_bindings mgr_bind on mgr_bind.object_id = mi.id
       left join app_users mgr_user on mgr_user.id = mgr_bind.user_id and mgr_user.role = 'client_manager'
       where ${whereSql}
       order by mi.position_number asc, mi.created_at asc`, values);
    response.status(200).json({
        items: result.rows.map(mapMaintenanceItemRow),
        total: result.rows.length,
    });
    }));
    app.put('/directions/:directionId/items/:itemId/manager', requireAuth, asyncHandler(async (request, response) => {
    await ensureMaintenanceItemSchema();
    const actorRole = request.authUser?.role ?? '';
    if (!maintenanceItemManageRoles.has(actorRole)) {
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
    }
    const directionId = parseUuidPath(request.params.directionId);
    const itemId = parseUuidPath(request.params.itemId);
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const itemCheck = await dbQuery(`select id from maintenance_items where id = $1::uuid and direction_id = $2::text and deleted_at is null limit 1`, [itemId, directionId]);
    if (itemCheck.rows.length === 0) {
        throw new ApiError(404, 'ITEM_NOT_FOUND', 'Maintenance item not found');
    }
    await dbQuery(`delete from app_user_object_bindings where object_id = $1::uuid`, [itemId]);
    if (userId) {
        const userCheck = await dbQuery(`select id from app_users where id = $1::uuid and role = 'client_manager' limit 1`, [userId]);
        if (userCheck.rows.length === 0) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'User not found or is not a client_manager');
        }
        await dbQuery(`insert into app_user_object_bindings(user_id, object_id) values($1::uuid, $2::uuid) on conflict(user_id, object_id) do nothing`, [userId, itemId]);
    }
    const updatedResult = await dbQuery(`select mi.*,
       mgr_bind.user_id as manager_id,
       mgr_user.full_name as manager_name
       from maintenance_items mi
       left join app_user_object_bindings mgr_bind on mgr_bind.object_id = mi.id
       left join app_users mgr_user on mgr_user.id = mgr_bind.user_id and mgr_user.role = 'client_manager'
       where mi.id = $1::uuid limit 1`, [itemId]);
    response.status(200).json(mapMaintenanceItemRow(updatedResult.rows[0]));
    }));
    app.post('/directions/:directionId/items', requireAuth, asyncHandler(async (request, response) => {
    await ensureMaintenanceItemSchema();
    const actorRole = request.authUser?.role ?? '';
    if (!maintenanceItemManageRoles.has(actorRole)) {
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
    }
    const directionId = parseUuidPath(request.params.directionId);
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const name = normalizeText(body.name);
    if (!name) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Name is required');
    }
    const systems = body.systems && typeof body.systems === 'object' ? body.systems : {};
    const tenantId = typeof body.tenantId === 'string' && body.tenantId.trim() ? body.tenantId.trim() : null;
    const result = await dbQuery(`insert into maintenance_items(
       direction_id,
       position_number,
       name,
       address,
       legal_entity,
       contract_number,
       systems,
       tenant_id
     )
     values($1, $2, $3, $4, $5, $6, $7::jsonb, $8::uuid)
     returning *`, [
        directionId,
        normalizeText(body.positionNumber),
        name,
        normalizeText(body.address),
        normalizeText(body.legalEntity),
        normalizeText(body.contractNumber),
        JSON.stringify(systems),
        tenantId,
    ]);
    const item = mapMaintenanceItemRow(result.rows[0]);
    const directionNameResult = await dbQuery(`select name
     from directions
     where id::text = $1::text
       and deleted_at is null
     limit 1`, [directionId]);
    const directionName = normalizeText(directionNameResult.rows[0]?.name);
    const adminManagerIds = await getAdminManagerIds();
    void pushInAppNotification({
        recipientIds: adminManagerIds,
        eventType: 'item_created',
        title: `Новый объект в "${directionName || directionId}": ${item.name || item.id}`,
        body: item.address,
        entityType: 'maintenance_item',
        entityId: item.id,
    });
    response.status(201).json(item);
    }));
    app.post('/directions/:directionId/items/import', requireAuth, asyncHandler(async (request, response) => {
    await ensureMaintenanceItemSchema();
    const actorRole = request.authUser?.role ?? '';
    if (!maintenanceItemManageRoles.has(actorRole)) {
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
    }
    const directionId = parseUuidPath(request.params.directionId);
    const rows = Array.isArray(request.body?.rows) ? request.body.rows : [];
    const errors = [];
    const created = [];
    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index] && typeof rows[index] === 'object' ? rows[index] : {};
        const name = typeof row.name === 'string' ? row.name.trim() : '';
        if (!name) {
            errors.push({ row: index + 1, field: 'name', message: 'Название обязательно' });
            continue;
        }
        const systems = row.systems && typeof row.systems === 'object'
            ? row.systems
            : {
                aps: false,
                soue: false,
                aupt: false,
                vpv: false,
                fireExtinguishers: false,
                exitSigns: false,
                gas: false,
            };
        const insertResult = await dbQuery(`insert into maintenance_items(
           direction_id,
           position_number,
           name,
           address,
           legal_entity,
           contract_number,
           systems
         )
         values($1, $2, $3, $4, $5, $6, $7::jsonb)
         returning *`, [
            directionId,
            normalizeText(row.positionNumber) || String(index + 1),
            name,
            normalizeText(row.address),
            normalizeText(row.legalEntity),
            normalizeText(row.contractNumber),
            JSON.stringify(systems),
        ]);
        created.push(mapMaintenanceItemRow(insertResult.rows[0]));
    }
    if (errors.length > 0 && created.length === 0) {
        response.status(422).json({
            imported: 0,
            errors,
        });
        return;
    }
    response.status(200).json({
        imported: created.length,
        errors,
        items: created,
    });
    }));
    app.get('/directions/:directionId/items/export', requireAuth, asyncHandler(async (request, response) => {
    await ensureMaintenanceItemSchema();
    const actorRole = request.authUser?.role ?? '';
    if (!canExportMaintenanceItems(actorRole, internalGlobalRoles)) {
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
    }
    const directionId = parseUuidPath(request.params.directionId);
    const conditions = [`mi.direction_id::text = $1::text`, `mi.deleted_at is null`, `d.deleted_at is null`];
    const values = [directionId];
    await appendDirectionScopeCondition({
        actorUserId: request.authUser?.id ?? '',
        actorRole,
        conditions,
        values,
        queryFn: dbQuery,
        tableAlias: 'd',
        directionIdColumn: 'id',
    });
    const result = await dbQuery(`select mi.*
       from maintenance_items mi
       join directions d on d.id::text = mi.direction_id::text
       where ${conditions.join(' and ')}
       order by mi.position_number asc, mi.created_at asc`, values);
    const items = result.rows.map(mapMaintenanceItemRow);
    const toCsvCell = (value) => {
        const text = String(value ?? '');
        if (text.includes(',') || text.includes('"') || text.includes('\n')) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    };
    const csvHeader = '№,Объект/Локация,Адрес,Юр.лицо,Договор,АПС,СОУЭ,АУПТ,ВПВ,Огнетушители,Табло,Газ';
    const csvRows = items.map((item) => [
        toCsvCell(item.positionNumber),
        toCsvCell(item.name),
        toCsvCell(item.address),
        toCsvCell(item.legalEntity),
        toCsvCell(item.contractNumber),
        item.systems?.aps ? 1 : 0,
        item.systems?.soue ? 1 : 0,
        item.systems?.aupt ? 1 : 0,
        item.systems?.vpv ? 1 : 0,
        item.systems?.fireExtinguishers ? 1 : 0,
        item.systems?.exitSigns ? 1 : 0,
        item.systems?.gas ? 1 : 0,
    ].join(','));
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="items-${directionId}.csv"`);
    response.status(200).send(`\uFEFF${[csvHeader, ...csvRows].join('\n')}`);
    }));
    app.get('/directions/:directionId/items/export-xlsx', requireAuth, asyncHandler(async (request, response) => {
    await ensureMaintenanceItemSchema();
    const actorRole = request.authUser?.role ?? '';
    if (!canExportMaintenanceItems(actorRole, internalGlobalRoles)) {
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
    }
    const directionId = parseUuidPath(request.params.directionId);
    const conditions = [`mi.direction_id::text = $1::text`, `mi.deleted_at is null`, `d.deleted_at is null`];
    const values = [directionId];
    await appendDirectionScopeCondition({
        actorUserId: request.authUser?.id ?? '',
        actorRole,
        conditions,
        values,
        queryFn: dbQuery,
        tableAlias: 'd',
        directionIdColumn: 'id',
    });
    const result = await dbQuery(`select mi.*
       from maintenance_items mi
       join directions d on d.id::text = mi.direction_id::text
       where ${conditions.join(' and ')}
       order by mi.position_number asc, mi.created_at asc`, values);
    const items = result.rows.map(mapMaintenanceItemRow);
    const { sendXlsxResponse } = await import('../helpers/xlsxHelpers.js');
    await sendXlsxResponse(response, `items-${directionId}`, [
        { header: '№', key: 'positionNumber', width: 6 },
        { header: 'Объект/Локация', key: 'name', width: 30 },
        { header: 'Адрес', key: 'address', width: 30 },
        { header: 'Юр.лицо', key: 'legalEntity', width: 25 },
        { header: 'Договор', key: 'contractNumber', width: 18 },
        { header: 'АПС', key: 'aps', width: 6 },
        { header: 'СОУЭ', key: 'soue', width: 6 },
        { header: 'АУПТ', key: 'aupt', width: 6 },
        { header: 'ВПВ', key: 'vpv', width: 6 },
        { header: 'Огнетушители', key: 'fireExtinguishers', width: 14 },
        { header: 'Табло', key: 'exitSigns', width: 7 },
        { header: 'Газ', key: 'gas', width: 6 },
    ], items.map((item) => ({
        positionNumber: String(item.positionNumber ?? ''),
        name: String(item.name ?? ''),
        address: String(item.address ?? ''),
        legalEntity: String(item.legalEntity ?? ''),
        contractNumber: String(item.contractNumber ?? ''),
        aps: item.systems?.aps ? 'Да' : 'Нет',
        soue: item.systems?.soue ? 'Да' : 'Нет',
        aupt: item.systems?.aupt ? 'Да' : 'Нет',
        vpv: item.systems?.vpv ? 'Да' : 'Нет',
        fireExtinguishers: item.systems?.fireExtinguishers ? 'Да' : 'Нет',
        exitSigns: item.systems?.exitSigns ? 'Да' : 'Нет',
        gas: item.systems?.gas ? 'Да' : 'Нет',
    })));
    }));
    app.get('/directions/:directionId/items/:itemId', requireAuth, asyncHandler(async (request, response) => {
    await ensureMaintenanceItemSchema();
    const actorRole = request.authUser?.role ?? '';
    if (!maintenanceItemViewRoles.has(actorRole)) {
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
    }
    const directionId = parseUuidPath(request.params.directionId);
    const itemId = parseUuidPath(request.params.itemId);
    const conditions = [
        `mi.id = $1::uuid`,
        `mi.direction_id = $2::text`,
        `mi.deleted_at is null`,
        `d.deleted_at is null`,
    ];
    const values = [itemId, directionId];
    await appendDirectionScopeCondition({
        actorUserId: request.authUser?.id ?? '',
        actorRole,
        conditions,
        values,
        queryFn: dbQuery,
        tableAlias: 'd',
        directionIdColumn: 'id',
    });
    const result = await dbQuery(`select mi.*
       from maintenance_items mi
       join directions d on d.id::text = mi.direction_id::text
       where ${conditions.join(' and ')}
       limit 1`, values);
    if (result.rows.length === 0) {
        throw new ApiError(404, 'ITEM_NOT_FOUND', 'Maintenance item not found');
    }
    response.status(200).json(mapMaintenanceItemRow(result.rows[0]));
    }));
    app.patch('/directions/:directionId/items/:itemId', requireAuth, asyncHandler(async (request, response) => {
    await ensureMaintenanceItemSchema();
    const actorRole = request.authUser?.role ?? '';
    if (!maintenanceItemManageRoles.has(actorRole)) {
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
    }
    const directionId = parseUuidPath(request.params.directionId);
    const itemId = parseUuidPath(request.params.itemId);
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const sets = [];
    const values = [itemId, directionId];
    const push = (value) => {
        values.push(value);
        return `$${values.length}`;
    };
    if (body.positionNumber !== undefined) {
        sets.push(`position_number = ${push(normalizeText(body.positionNumber))}`);
    }
    if (body.name !== undefined) {
        sets.push(`name = ${push(normalizeText(body.name))}`);
    }
    if (body.address !== undefined) {
        sets.push(`address = ${push(normalizeText(body.address))}`);
    }
    if (body.legalEntity !== undefined) {
        sets.push(`legal_entity = ${push(normalizeText(body.legalEntity))}`);
    }
    if (body.contractNumber !== undefined) {
        sets.push(`contract_number = ${push(normalizeText(body.contractNumber))}`);
    }
    if (body.tenantId !== undefined) {
        sets.push(`tenant_id = ${push(body.tenantId ? body.tenantId : null)}${body.tenantId ? '::uuid' : ''}`);
    }
    if (body.systems !== undefined && typeof body.systems === 'object') {
        sets.push(`systems = ${push(JSON.stringify(body.systems))}::jsonb`);
    }
    if (sets.length === 0) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'No fields to update');
    }
    sets.push(`updated_at = now()`);
    const result = await dbQuery(`update maintenance_items
       set ${sets.join(', ')}
       where id = $1::uuid
         and direction_id = $2::text
         and deleted_at is null
       returning *`, values);
    if (result.rows.length === 0) {
        throw new ApiError(404, 'ITEM_NOT_FOUND', 'Maintenance item not found');
    }
    const adminManagerIds = await getAdminManagerIds();
    void pushInAppNotification({
        recipientIds: adminManagerIds,
        eventType: 'item_updated',
        title: 'Объект обслуживания обновлён',
        body: `Объект ${normalizeText(result.rows[0]?.name) || itemId} отредактирован`,
        entityType: 'maintenance_item',
        entityId: String(itemId),
    });
    response.status(200).json(mapMaintenanceItemRow(result.rows[0]));
    }));
    app.delete('/directions/:directionId/items/:itemId', requireAuth, asyncHandler(async (request, response) => {
    await ensureMaintenanceItemSchema();
    const actorRole = request.authUser?.role ?? '';
    if (!maintenanceItemManageRoles.has(actorRole)) {
        throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
    }
    const directionId = parseUuidPath(request.params.directionId);
    const itemId = parseUuidPath(request.params.itemId);
    const result = await dbQuery(`update maintenance_items
       set deleted_at = now()
       where id = $1::uuid
         and direction_id = $2::text
         and deleted_at is null
       returning id::text as id, coalesce(name, '') as name`, [itemId, directionId]);
    if (result.rows.length === 0) {
        throw new ApiError(404, 'ITEM_NOT_FOUND', 'Maintenance item not found');
    }
    const deletedItem = result.rows[0];
    const adminManagerIds = await getAdminManagerIds();
    void pushInAppNotification({
        recipientIds: adminManagerIds,
        eventType: 'item_deleted',
        title: `Объект удалён: ${normalizeText(deletedItem.name) || itemId}`,
        body: '',
        entityType: 'maintenance_item',
        entityId: normalizeText(deletedItem.id) || itemId,
    });
    response.status(204).send();
    }));
};
