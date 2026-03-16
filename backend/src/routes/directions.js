export const registerMockDirectionRoutes = (params) => {
    const { app, requireAuth, ApiError, randomUUID, normalizeText, directionManageRoles, directionViewRoles, projectClientRoles, getLocalMockBodyObject, localMockUsers, localMockNotifications, localMockDirections, localMockTenants, } = params;
    app.get('/directions', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!directionViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const search = normalizeText(request.query?.search).toLowerCase();
        const tenantId = normalizeText(request.query?.tenant_id);
        let items = [...localMockDirections];
        if (search) {
            items = items.filter((direction) => normalizeText(direction.name).toLowerCase().includes(search)
                || normalizeText(direction.address).toLowerCase().includes(search));
        }
        if (tenantId) {
            items = items.filter((direction) => normalizeText(direction.tenantId) === tenantId);
        }
        if (projectClientRoles.has(actorRole)) {
            const currentUser = localMockUsers.find((user) => user.id === request.authUser?.id);
            const currentTenantId = normalizeText(currentUser?.bindings?.counterpartyId);
            if (currentTenantId) {
                items = items.filter((direction) => normalizeText(direction.tenantId) === currentTenantId);
            }
            else {
                items = [];
            }
        }
        response.status(200).json({
            items,
            total: items.length,
            page: 1,
            limit: 50,
        });
    });
    app.post('/directions', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!directionManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const body = getLocalMockBodyObject(request.body);
        const tenantId = normalizeText(body.tenantId);
        const matchedTenant = localMockTenants.find((tenant) => tenant.id === tenantId);
        const direction = {
            id: randomUUID(),
            name: normalizeText(body.name) || 'Без названия',
            address: normalizeText(body.address),
            tenantId,
            tenantName: normalizeText(matchedTenant?.brandName || matchedTenant?.name),
            description: normalizeText(body.description),
            createdById: normalizeText(request.authUser?.id),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        localMockDirections.push(direction);
        for (const user of localMockUsers) {
            if (user.role !== 'admin' && user.role !== 'manager') {
                continue;
            }
            localMockNotifications.push({
                id: randomUUID(),
                userId: user.id,
                eventType: 'direction_created',
                title: `Новое направление: ${direction.name || direction.id}`,
                body: direction.address,
                entityType: 'direction',
                entityId: direction.id,
                isRead: false,
                createdAt: new Date().toISOString(),
            });
        }
        response.status(201).json(direction);
    });
    app.get('/directions/:directionId([0-9a-fA-F-]{36})', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!directionViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const direction = localMockDirections.find((item) => item.id === request.params.directionId);
        if (!direction) {
            throw new ApiError(404, 'DIRECTION_NOT_FOUND', 'Direction not found');
        }
        if (projectClientRoles.has(actorRole)) {
            const currentUser = localMockUsers.find((user) => user.id === request.authUser?.id);
            const currentTenantId = normalizeText(currentUser?.bindings?.counterpartyId);
            if (!currentTenantId || normalizeText(direction.tenantId) !== currentTenantId) {
                throw new ApiError(404, 'DIRECTION_NOT_FOUND', 'Direction not found');
            }
        }
        response.status(200).json(direction);
    });
    app.patch('/directions/:directionId([0-9a-fA-F-]{36})', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!directionManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const direction = localMockDirections.find((item) => item.id === request.params.directionId);
        if (!direction) {
            throw new ApiError(404, 'DIRECTION_NOT_FOUND', 'Direction not found');
        }
        const body = getLocalMockBodyObject(request.body);
        if (body.name !== undefined) {
            direction.name = normalizeText(body.name);
        }
        if (body.address !== undefined) {
            direction.address = normalizeText(body.address);
        }
        if (body.tenantId !== undefined) {
            direction.tenantId = normalizeText(body.tenantId);
            const matchedTenant = localMockTenants.find((tenant) => tenant.id === direction.tenantId);
            direction.tenantName = normalizeText(matchedTenant?.brandName || matchedTenant?.name);
        }
        if (body.description !== undefined) {
            direction.description = normalizeText(body.description);
        }
        direction.updatedAt = new Date().toISOString();
        for (const user of localMockUsers) {
            if (user.role !== 'admin' && user.role !== 'manager') {
                continue;
            }
            localMockNotifications.push({
                id: randomUUID(),
                userId: user.id,
                eventType: 'direction_updated',
                title: `Направление "${direction.name || direction.id}" обновлено`,
                body: direction.address,
                entityType: 'direction',
                entityId: direction.id,
                isRead: false,
                createdAt: new Date().toISOString(),
            });
        }
        response.status(200).json(direction);
    });
    app.delete('/directions/:directionId([0-9a-fA-F-]{36})', requireAuth, (request, response) => {
        const actorRole = request.authUser?.role ?? '';
        if (!directionManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const idx = localMockDirections.findIndex((item) => item.id === request.params.directionId);
        if (idx < 0) {
            throw new ApiError(404, 'DIRECTION_NOT_FOUND', 'Direction not found');
        }
        const [removedDirection] = localMockDirections.splice(idx, 1);
        for (const user of localMockUsers) {
            if (user.role !== 'admin' && user.role !== 'manager') {
                continue;
            }
            localMockNotifications.push({
                id: randomUUID(),
                userId: user.id,
                eventType: 'direction_deleted',
                title: `Направление "${normalizeText(removedDirection?.name) || request.params.directionId}" удалено`,
                body: '',
                entityType: 'direction',
                entityId: request.params.directionId,
                isRead: false,
                createdAt: new Date().toISOString(),
            });
        }
        response.status(204).send();
    });
};
export const registerDirectionRoutes = (params) => {
    const { app, requireAuth, asyncHandler, ensureDirectionSchema, ensureMaintenanceItemSchema, ApiError, dbQuery, normalizeText, isUuidValue, parseUuidPath, directionManageRoles, directionViewRoles, projectClientRoles, mapDirectionRow, getAdminManagerIds, pushInAppNotification, parsePositiveInt, } = params;
    app.get('/directions', requireAuth, asyncHandler(async (request, response) => {
        await ensureDirectionSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!directionViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to view directions');
        }
        const search = normalizeText(request.query?.search).toLowerCase();
        const tenantId = normalizeText(request.query?.tenant_id);
        const page = parsePositiveInt(request.query?.page, {
            field: 'page',
            defaultValue: 1,
            min: 1,
        });
        const limit = parsePositiveInt(request.query?.limit, {
            field: 'limit',
            defaultValue: 50,
            min: 1,
            max: 200,
        });
        const offset = (page - 1) * limit;
        const conditions = [`d.deleted_at is null`];
        const values = [];
        const push = (value) => {
            values.push(value);
            return `$${values.length}`;
        };
        if (tenantId) {
            const tenantRef = push(tenantId);
            conditions.push(`d.tenant_id = ${tenantRef}::text`);
        }
        if (search) {
            const searchRef = push(`%${search}%`);
            conditions.push(`(
        lower(coalesce(d.name, '')) like ${searchRef}
        or lower(coalesce(d.address, '')) like ${searchRef}
      )`);
        }
        if (projectClientRoles.has(actorRole)) {
            const actorUserId = normalizeText(request.authUser?.id);
            if (!isUuidValue(actorUserId)) {
                conditions.push('false');
            }
            else {
                const bindingResult = await dbQuery(`select counterparty_id::text as counterparty_id
         from app_user_bindings
         where user_id = $1::uuid
         limit 1`, [actorUserId]);
                const counterpartyId = normalizeText(bindingResult.rows[0]?.counterparty_id);
                if (counterpartyId) {
                    const cpRef = push(counterpartyId);
                    conditions.push(`d.tenant_id = ${cpRef}::text`);
                }
                else {
                    conditions.push('false');
                }
            }
        }
        const whereSql = conditions.join(' and ');
        const countResult = await dbQuery(`select count(*)::int as total
       from directions d
       where ${whereSql}`, values);
        const total = Number(countResult.rows[0]?.total ?? 0);
        const dataValues = [...values, limit, offset];
        const limitRef = `$${dataValues.length - 1}`;
        const offsetRef = `$${dataValues.length}`;
        const dataResult = await dbQuery(`select
       d.*,
       t.brand_name as tenant_name
     from directions d
     left join tenants t on t.id::text = d.tenant_id
     where ${whereSql}
     order by d.created_at desc
     limit ${limitRef}::int
     offset ${offsetRef}::int`, dataValues);
        response.status(200).json({
            items: dataResult.rows.map(mapDirectionRow),
            total,
            page,
            limit,
            totalPages: total > 0 ? Math.ceil(total / limit) : 0,
        });
    }));
    app.post('/directions', requireAuth, asyncHandler(async (request, response) => {
        await ensureDirectionSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!directionManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed to create directions');
        }
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const name = normalizeText(body.name);
        if (!name) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Name is required');
        }
        const result = await dbQuery(`insert into directions(
       name,
       address,
       tenant_id,
       description,
       created_by_id
     )
     values($1, $2, $3, $4, $5)
     returning
       *,
       (select brand_name from tenants where id::text = directions.tenant_id limit 1) as tenant_name`, [
            name,
            normalizeText(body.address),
            normalizeText(body.tenantId) || null,
            normalizeText(body.description),
            normalizeText(request.authUser?.id) || null,
        ]);
        const direction = mapDirectionRow(result.rows[0]);
        const adminManagerIds = await getAdminManagerIds();
        void pushInAppNotification({
            recipientIds: adminManagerIds,
            eventType: 'direction_created',
            title: `Новое направление: ${direction.name || direction.id}`,
            body: direction.address,
            entityType: 'direction',
            entityId: direction.id,
        });
        response.status(201).json(direction);
    }));
    app.get('/directions/:directionId([0-9a-fA-F-]{36})', requireAuth, asyncHandler(async (request, response) => {
        await ensureDirectionSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!directionViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const directionId = parseUuidPath(request.params.directionId);
        const conditions = [`d.id = $1::uuid`, `d.deleted_at is null`];
        const values = [directionId];
        if (projectClientRoles.has(actorRole)) {
            const actorUserId = normalizeText(request.authUser?.id);
            if (!isUuidValue(actorUserId)) {
                conditions.push('false');
            }
            else {
                const bindingResult = await dbQuery(`select counterparty_id::text as counterparty_id
         from app_user_bindings
         where user_id = $1::uuid
         limit 1`, [actorUserId]);
                const counterpartyId = normalizeText(bindingResult.rows[0]?.counterparty_id);
                if (counterpartyId) {
                    values.push(counterpartyId);
                    conditions.push(`d.tenant_id = $${values.length}::text`);
                }
                else {
                    conditions.push('false');
                }
            }
        }
        const result = await dbQuery(`select
       d.*,
       t.brand_name as tenant_name
     from directions d
     left join tenants t on t.id::text = d.tenant_id
     where ${conditions.join(' and ')}
     limit 1`, values);
        if (result.rows.length === 0) {
            throw new ApiError(404, 'DIRECTION_NOT_FOUND', 'Direction not found');
        }
        response.status(200).json(mapDirectionRow(result.rows[0]));
    }));
    app.patch('/directions/:directionId([0-9a-fA-F-]{36})', requireAuth, asyncHandler(async (request, response) => {
        await ensureDirectionSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!directionManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed to edit directions');
        }
        const directionId = parseUuidPath(request.params.directionId);
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const sets = [];
        const values = [directionId];
        const push = (value) => {
            values.push(value);
            return `$${values.length}`;
        };
        if (body.name !== undefined) {
            sets.push(`name = ${push(normalizeText(body.name))}`);
        }
        if (body.address !== undefined) {
            sets.push(`address = ${push(normalizeText(body.address))}`);
        }
        if (body.tenantId !== undefined) {
            sets.push(`tenant_id = ${push(normalizeText(body.tenantId))}`);
        }
        if (body.description !== undefined) {
            sets.push(`description = ${push(normalizeText(body.description))}`);
        }
        if (sets.length === 0) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'No fields to update');
        }
        sets.push(`updated_at = now()`);
        const result = await dbQuery(`update directions
       set ${sets.join(', ')}
       where id = $1::uuid
         and deleted_at is null
       returning
         *,
         (select brand_name from tenants where id::text = directions.tenant_id limit 1) as tenant_name`, values);
        if (result.rows.length === 0) {
            throw new ApiError(404, 'DIRECTION_NOT_FOUND', 'Direction not found');
        }
        const direction = mapDirectionRow(result.rows[0]);
        const adminManagerIds = await getAdminManagerIds();
        void pushInAppNotification({
            recipientIds: adminManagerIds,
            eventType: 'direction_updated',
            title: `Направление "${direction.name || direction.id}" обновлено`,
            body: direction.address,
            entityType: 'direction',
            entityId: direction.id,
        });
        response.status(200).json(direction);
    }));
    app.delete('/directions/:directionId([0-9a-fA-F-]{36})', requireAuth, asyncHandler(async (request, response) => {
        await ensureDirectionSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!directionManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed to delete directions');
        }
        const directionId = parseUuidPath(request.params.directionId);
        const result = await dbQuery(`update directions
       set deleted_at = now()
       where id = $1::uuid
         and deleted_at is null
       returning id::text as id, coalesce(name, '') as name`, [directionId]);
        if (result.rows.length === 0) {
            throw new ApiError(404, 'DIRECTION_NOT_FOUND', 'Direction not found');
        }
        const deletedDirection = result.rows[0];
        const adminManagerIds = await getAdminManagerIds();
        void pushInAppNotification({
            recipientIds: adminManagerIds,
            eventType: 'direction_deleted',
            title: `Направление "${normalizeText(deletedDirection.name) || directionId}" удалено`,
            body: '',
            entityType: 'direction',
            entityId: normalizeText(deletedDirection.id) || directionId,
        });
        response.status(204).send();
    }));
    app.get('/directions/export', requireAuth, asyncHandler(async (request, response) => {
        await ensureDirectionSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!directionViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const result = await dbQuery(`select d.*, t.brand_name as tenant_name
       from directions d
       left join tenants t on t.id::text = d.tenant_id
       where d.deleted_at is null
       order by d.created_at asc`, []);
        const toCsvCell = (value) => {
            const text = String(value ?? '');
            if (text.includes(',') || text.includes('"') || text.includes('\n'))
                return `"${text.replace(/"/g, '""')}"`;
            return text;
        };
        const headers = ['id', 'name', 'address', 'tenant_id', 'tenant_name', 'description', 'created_at'];
        const rows = result.rows.map((row) => headers.map((h) => toCsvCell(row[h])).join(','));
        const csv = [headers.join(','), ...rows].join('\n');
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', 'attachment; filename="directions.csv"');
        response.status(200).send(csv);
    }));
    app.get('/directions/export-xlsx', requireAuth, asyncHandler(async (request, response) => {
        await ensureDirectionSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!directionViewRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const result = await dbQuery(`select d.id, d.name, d.address, d.tenant_id, t.brand_name as tenant_name, d.description, d.created_at
       from directions d
       left join tenants t on t.id::text = d.tenant_id
       where d.deleted_at is null
       order by d.created_at asc`, []);
        const { sendXlsxResponse } = await import('../helpers/xlsxHelpers.js');
        await sendXlsxResponse(response, 'directions', [
            { header: 'ID', key: 'id', width: 38 },
            { header: 'Название', key: 'name', width: 35 },
            { header: 'Адрес', key: 'address', width: 40 },
            { header: 'Контрагент', key: 'tenantName', width: 30 },
            { header: 'Описание', key: 'description', width: 40 },
            { header: 'Создано', key: 'createdAt', width: 14 },
        ], result.rows.map((row) => ({
            id: String(row.id ?? ''),
            name: String(row.name ?? ''),
            address: String(row.address ?? ''),
            tenantName: String(row.tenant_name ?? ''),
            description: String(row.description ?? ''),
            createdAt: row.created_at ? String(row.created_at).slice(0, 10) : '',
        })));
    }));
    app.post('/directions/import', requireAuth, asyncHandler(async (request, response) => {
        await ensureDirectionSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!directionManageRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const rows = Array.isArray(body.rows) ? body.rows : [];
        let created = 0;
        let updated = 0;
        for (const row of rows) {
            const name = String(row.name || '').trim();
            if (!name)
                continue;
            const address = String(row.address || '').trim() || null;
            const tenantId = String(row.tenantId || '').trim() || null;
            const existing = await dbQuery(`select id from directions where lower(name) = lower($1) and deleted_at is null limit 1`, [name]);
            if (existing.rows.length > 0) {
                await dbQuery(`update directions set address = coalesce($2, address), updated_at = now() where id = $1::uuid`, [existing.rows[0].id, address]);
                updated++;
            }
            else {
                await dbQuery(`insert into directions (name, address, tenant_id, created_by_id) values ($1, $2, $3::uuid, $4::uuid)`, [name, address, tenantId, normalizeText(request.authUser?.id) || null]);
                created++;
            }
        }
        response.status(200).json({ summary: { created, updated } });
    }));
    app.post('/directions/:directionId([0-9a-fA-F-]{36})/items/import-xlsx', requireAuth, asyncHandler(async (request, response) => {
        await ensureDirectionSchema();
        await ensureMaintenanceItemSchema();
        const actorRole = request.authUser?.role ?? '';
        if (!directionManageRoles.has(actorRole))
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        const directionId = parseUuidPath(request.params.directionId);
        const dirCheck = await dbQuery(`SELECT id FROM directions WHERE id=$1::uuid AND deleted_at IS NULL LIMIT 1`, [directionId]);
        if (dirCheck.rows.length === 0)
            throw new ApiError(404, 'NOT_FOUND', 'Direction not found');
        const contentType = String(request.headers['content-type'] || '');
        const chunks = [];
        await new Promise((resolve, reject) => {
            request.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            request.on('end', resolve);
            request.on('error', reject);
        });
        let xlsxBuffer;
        if (contentType.includes('multipart/form-data')) {
            const boundary = contentType.split('boundary=')[1]?.trim();
            const raw = Buffer.concat(chunks);
            if (!boundary)
                throw new ApiError(400, 'VALIDATION_ERROR', 'Не найден boundary');
            const boundaryBuf = Buffer.from(`--${boundary}`);
            const start = raw.indexOf(boundaryBuf);
            const headerEnd = raw.indexOf(Buffer.from('\r\n\r\n'), start);
            const nextBoundary = raw.indexOf(boundaryBuf, headerEnd + 4);
            xlsxBuffer = raw.slice(headerEnd + 4, nextBoundary - 2);
        }
        else {
            xlsxBuffer = Buffer.concat(chunks);
        }
        const { parseXlsxBuffer, mapDirectionItemXlsxRow } = await import('../helpers/xlsxImportHelpers.js');
        const xlsxRows = await parseXlsxBuffer(xlsxBuffer);
        if (xlsxRows.length === 0)
            throw new ApiError(422, 'VALIDATION_ERROR', 'Файл пустой');
        let created = 0;
        let updated = 0;
        for (const xlsxRow of xlsxRows) {
            const mapped = mapDirectionItemXlsxRow(xlsxRow);
            const name = mapped.name.trim();
            if (!name)
                continue;
            const existing = await dbQuery(`SELECT id FROM maintenance_items WHERE direction_id=$1::uuid AND lower(trim(name))=lower($2) AND deleted_at IS NULL LIMIT 1`, [directionId, name]);
            if (existing.rows.length > 0) {
                await dbQuery(`UPDATE maintenance_items SET address=coalesce(nullif($2,''),address), legal_entity=coalesce(nullif($3,''),legal_entity), contract_number=coalesce(nullif($4,''),contract_number), updated_at=now() WHERE id=$1::uuid`, [existing.rows[0].id, mapped.address, mapped.legalEntity, mapped.contractNumber]);
                updated++;
            }
            else {
                await dbQuery(`INSERT INTO maintenance_items(direction_id, position_number, name, address, legal_entity, contract_number) VALUES($1::uuid,$2,$3,$4,$5,$6)`, [directionId, mapped.positionNumber, name, mapped.address, mapped.legalEntity, mapped.contractNumber]);
                created++;
            }
        }
        response.status(200).json({ summary: { created, updated } });
    }));
};
