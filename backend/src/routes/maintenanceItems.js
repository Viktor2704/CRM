export const registerMockMaintenanceItemRoutes = (params) => {
    const { app, requireAuth, ApiError, randomUUID, normalizeText, maintenanceItemManageRoles, maintenanceItemViewRoles, getLocalMockBodyObject, toCsvCell, localMockUsers, localMockNotifications, localMockMaintenanceItems, } = params;
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
        const items = localMockMaintenanceItems.filter((item) => item.directionId === request.params.directionId);
        response.status(200).json({
            items,
            total: items.length,
        });
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
        if (!maintenanceItemViewRoles.has(actorRole)) {
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
    const { app, requireAuth, asyncHandler, ensureMaintenanceItemSchema, ApiError, dbQuery, normalizeText, parseUuidPath, maintenanceItemManageRoles, maintenanceItemViewRoles, mapMaintenanceItemRow, getAdminManagerIds, pushInAppNotification, } = params;
    app.get('/maintenance-items', requireAuth, asyncHandler(async (request, response) => {
        await ensureMaintenanceItemSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!maintenanceItemViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const directionId = normalizeText(request.query?.direction_id);
        const search = normalizeText(request.query?.search).toLowerCase();
        const conditions = [`mi.deleted_at is null`];
        const values = [];
        const push = (value) => {
            values.push(value);
            return `$${values.length}`;
        };
        if (directionId) {
            const directionRef = push(directionId);
            conditions.push(`mi.direction_id = ${directionRef}::uuid`);
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
        const whereSql = conditions.join(' and ');
        const result = await dbQuery(`select *
       from maintenance_items mi
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
        const conditions = [`mi.direction_id = $1::uuid`, `mi.deleted_at is null`];
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
        const whereSql = conditions.join(' and ');
        const result = await dbQuery(`select *
       from maintenance_items mi
       where ${whereSql}
       order by mi.position_number asc, mi.created_at asc`, values);
        response.status(200).json({
            items: result.rows.map(mapMaintenanceItemRow),
            total: result.rows.length,
        });
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
        if (!maintenanceItemViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const directionId = parseUuidPath(request.params.directionId);
        const result = await dbQuery(`select *
       from maintenance_items
       where direction_id = $1::uuid
         and deleted_at is null
       order by position_number asc, created_at asc`, [directionId]);
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
        if (!maintenanceItemViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const directionId = parseUuidPath(request.params.directionId);
        const result = await dbQuery(`select *
       from maintenance_items
       where direction_id = $1::uuid
         and deleted_at is null
       order by position_number asc, created_at asc`, [directionId]);
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
            aps: item.systems?.aps ? 1 : 0,
            soue: item.systems?.soue ? 1 : 0,
            aupt: item.systems?.aupt ? 1 : 0,
            vpv: item.systems?.vpv ? 1 : 0,
            fireExtinguishers: item.systems?.fireExtinguishers ? 1 : 0,
            exitSigns: item.systems?.exitSigns ? 1 : 0,
            gas: item.systems?.gas ? 1 : 0,
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
        const result = await dbQuery(`select *
       from maintenance_items
       where id = $1::uuid
         and direction_id = $2::uuid
         and deleted_at is null
       limit 1`, [itemId, directionId]);
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
         and direction_id = $2::uuid
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
         and direction_id = $2::uuid
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
