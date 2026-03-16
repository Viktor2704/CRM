export const registerMockTenantRoutes = (params) => {
    const {
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
    } = params;
    app.get('/tenants/export', requireAuth, requireTenantPageAccess, (_request, response) => {
        const csvHeader = 'id,name,brandName,inn,contactName,contactEmail,contactPhone';
        const csvRows = localMockTenants.flatMap((tenant) => {
            const contacts = Array.isArray(tenant.contacts) && tenant.contacts.length > 0 ? tenant.contacts : [{}];
            return contacts.map((contact) => [
                toCsvCell(tenant.id),
                toCsvCell(tenant.name),
                toCsvCell(tenant.brandName),
                toCsvCell(tenant.inn),
                toCsvCell(contact.fullName),
                toCsvCell(contact.email),
                toCsvCell(contact.phone),
            ].join(','));
        });
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', 'attachment; filename=\"tenants.csv\"');
        response.status(200).send(`\uFEFF${[csvHeader, ...csvRows].join('\n')}`);
    });
    app.get('/tenants/export-xlsx', requireAuth, requireTenantPageAccess, async (_request, response) => {
        const { sendXlsxResponse } = await import('../helpers/xlsxHelpers.js');
        const rows = localMockTenants.flatMap((tenant) => {
            const contacts = Array.isArray(tenant.contacts) && tenant.contacts.length > 0 ? tenant.contacts : [{}];
            return contacts.map((contact) => ({
                id: String(tenant.id ?? ''),
                name: String(tenant.name ?? ''),
                brandName: String(tenant.brandName ?? ''),
                inn: String(tenant.inn ?? ''),
                contactName: String(contact.fullName ?? ''),
                contactEmail: String(contact.email ?? ''),
                contactPhone: String(contact.phone ?? ''),
            }));
        });
        await sendXlsxResponse(response, 'tenants', [
            { header: 'ID', key: 'id', width: 38 },
            { header: 'Название', key: 'name', width: 35 },
            { header: 'Бренд', key: 'brandName', width: 30 },
            { header: 'ИНН', key: 'inn', width: 14 },
            { header: 'Контакт', key: 'contactName', width: 25 },
            { header: 'Email', key: 'contactEmail', width: 28 },
            { header: 'Телефон', key: 'contactPhone', width: 18 },
        ], rows);
    });
    app.post('/tenants/import', requireAuth, requireAdminLike, (request, response) => {
        const rows = Array.isArray(request.body?.rows) ? request.body.rows : [];
        const errors = [];
        const validRows = [];
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
            validRows.push({
                id: typeof row.id === 'string' ? row.id : randomUUID(),
                name,
                brandName: typeof row.brandName === 'string' && row.brandName.trim().length > 0 ? row.brandName.trim() : name,
                inn: typeof row.inn === 'string' ? row.inn.trim() : '',
                contacts: normalizeTenantContacts(row.contacts),
            });
        }
        if (errors.length > 0) {
            response.status(422).json({
                imported: 0,
                errors,
                validRows: validRows.length,
            });
            return;
        }
        for (const row of validRows) {
            localMockTenants.push(row);
        }
        response.status(200).json({
            imported: validRows.length,
            created: validRows.length,
            updated: 0,
            errors: [],
        });
    });
    app.post('/tenants/import-xlsx', requireAuth, requireAdminLike, async (request, response) => {
        const contentType = String(request.headers['content-type'] || '');
        if (!contentType.includes('multipart/form-data') && !contentType.includes('application/octet-stream')) {
            throw new Error('Expected multipart/form-data or application/octet-stream');
        }
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
            if (!boundary) {
                throw new Error('Multipart boundary is missing');
            }
            const boundaryBuf = Buffer.from(`--${boundary}`);
            const start = raw.indexOf(boundaryBuf);
            const headerEnd = raw.indexOf(Buffer.from('\r\n\r\n'), start);
            const nextBoundary = raw.indexOf(boundaryBuf, headerEnd + 4);
            xlsxBuffer = raw.slice(headerEnd + 4, nextBoundary - 2);
        }
        else {
            xlsxBuffer = Buffer.concat(chunks);
        }
        const { parseXlsxBuffer, mapTenantXlsxRow } = await import('../helpers/xlsxImportHelpers.js');
        const xlsxRows = await parseXlsxBuffer(xlsxBuffer);
        let created = 0;
        let updated = 0;
        const errors = [];
        for (let index = 0; index < xlsxRows.length; index += 1) {
            const mapped = mapTenantXlsxRow(xlsxRows[index]);
            const name = mapped.name.trim();
            if (!name) {
                errors.push({ row: index + 2, message: 'Пустое название - пропущено' });
                continue;
            }
            const brandName = mapped.brandName.trim() || name;
            const inn = mapped.inn.trim();
            const contacts = normalizeTenantContacts((mapped.contactName || mapped.contactEmail || mapped.contactPhone) ? [{
                id: randomUUID(),
                fullName: mapped.contactName,
                position: '',
                email: mapped.contactEmail,
                phone: mapped.contactPhone,
            }] : []);
            const existingIndex = localMockTenants.findIndex((tenant) => normalizeText(tenant.name).toLowerCase() === name.toLowerCase());
            if (existingIndex >= 0) {
                localMockTenants[existingIndex] = {
                    ...localMockTenants[existingIndex],
                    name,
                    brandName,
                    inn,
                    contacts: contacts.length > 0 ? contacts : localMockTenants[existingIndex].contacts,
                };
                updated += 1;
            }
            else {
                localMockTenants.push({
                    id: randomUUID(),
                    name,
                    brandName,
                    inn,
                    contacts,
                    type: 'tenant',
                });
                created += 1;
            }
        }
        response.status(200).json({ summary: { created, updated, errors } });
    });
    app.post('/tenants/bulk-upsert', requireAuth, requireAdminLike, (request, response) => {
        const rows = Array.isArray(request.body?.rows) ? request.body.rows : [];
        const items = rows.map((row) => ({
            id: randomUUID(),
            name: normalizeText(row?.name) || 'Без названия',
            brandName: normalizeText(row?.brandName) || normalizeText(row?.name) || 'Без названия',
            inn: normalizeText(row?.inn),
            contacts: normalizeTenantContacts(row?.contacts),
        }));
        response.status(200).json({
            items,
            summary: {
                created: items.length,
                updated: 0,
                total: items.length,
            },
        });
    });
    app.get('/tenants', requireAuth, requireTenantPageAccess, (request, response) => {
        const search = normalizeText(request.query?.search).toLowerCase();
        const pageRaw = Number.parseInt(String(request.query?.page ?? '1'), 10);
        const limitRaw = Number.parseInt(String(request.query?.limit ?? '50'), 10);
        const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
        const offset = (page - 1) * limit;
        const filtered = search
            ? localMockTenants.filter((tenant) => {
                const name = normalizeText(tenant.name).toLowerCase();
                const brandName = normalizeText(tenant.brandName).toLowerCase();
                const inn = normalizeText(tenant.inn).toLowerCase();
                return name.includes(search) || brandName.includes(search) || inn.includes(search);
            })
            : [...localMockTenants];
        const items = filtered.slice(offset, offset + limit);
        response.status(200).json({
            items,
            total: filtered.length,
            page,
            limit,
            totalPages: filtered.length > 0 ? Math.ceil(filtered.length / limit) : 0,
        });
    });
    app.get('/tenants/:tenantId/details', requireAuth, requireTenantPageAccess, (request, response) => {
        const tenantId = normalizeText(request.params.tenantId);
        const tenant = localMockTenants.find((item) => item.id === tenantId);
        if (!tenant) {
            response.status(404).json({ code: 'NOT_FOUND', message: 'Tenant not found' });
            return;
        }
        const items = localMockMaintenanceItems
            .filter((item) => normalizeText(item.tenantId) === tenantId)
            .map((item) => ({
                id: item.id,
                name: item.name,
                address: item.address,
                positionNumber: item.positionNumber,
                legalEntity: item.legalEntity,
                contractNumber: item.contractNumber,
                directionName: localMockDirections.find((direction) => direction.id === item.directionId)?.name || '',
            }));
        response.status(200).json({
            tenant,
            items,
            requests: [],
            installations: [],
        });
    });
    app.post('/tenants', requireAuth, requireAdminLike, (request, response) => {
        const body = getLocalMockBodyObject(request.body);
        const tenant = {
            id: randomUUID(),
            name: normalizeText(body.name) || 'Без названия',
            brandName: normalizeText(body.brandName) || normalizeText(body.name) || 'Без названия',
            inn: normalizeText(body.inn),
            contacts: normalizeTenantContacts(body.contacts),
        };
        localMockTenants.push(tenant);
        for (const user of localMockUsers) {
            if (user.role !== 'admin' && user.role !== 'manager') {
                continue;
            }
            localMockNotifications.push({
                id: randomUUID(),
                userId: user.id,
                eventType: 'tenant_created',
                title: `Новый контрагент: ${tenant.name || tenant.id}`,
                body: tenant.inn ? `ИНН: ${tenant.inn}` : '',
                entityType: 'tenant',
                entityId: tenant.id,
                isRead: false,
                createdAt: new Date().toISOString(),
            });
        }
        response.status(201).json(tenant);
    });
    app.patch('/tenants/:tenantId', requireAuth, requireAdminLike, (request, response) => {
        const tenantId = normalizeText(request.params.tenantId);
        const body = getLocalMockBodyObject(request.body);
        const index = localMockTenants.findIndex((tenant) => tenant.id === tenantId);
        if (index < 0) {
            response.status(404).json({ code: 'NOT_FOUND', message: 'Tenant not found' });
            return;
        }
        const name = normalizeText(body.name);
        if (!name) {
            response.status(400).json({ code: 'VALIDATION_ERROR', message: 'name is required' });
            return;
        }
        const brandName = normalizeText(body.brandName) || name;
        const inn = normalizeText(body.inn);
        const type = body.type === 'contractor' ? 'contractor' : 'tenant';
        const contacts = normalizeTenantContacts([{
            id: randomUUID(),
            fullName: normalizeText(body.contactName) || normalizeText(body.fullName),
            position: normalizeText(body.position),
            email: normalizeText(body.email),
            phone: normalizeText(body.phone),
        }]);
        localMockTenants[index] = {
            ...localMockTenants[index],
            name,
            brandName,
            inn,
            type,
            contacts,
        };
        if (type !== 'contractor') {
            for (let itemIndex = 0; itemIndex < localMockMaintenanceItems.length; itemIndex += 1) {
                const item = localMockMaintenanceItems[itemIndex];
                if (normalizeText(item.tenantId)) {
                    continue;
                }
                if (normalizeText(item.legalEntity).toLowerCase() !== name.toLowerCase()) {
                    continue;
                }
                localMockMaintenanceItems[itemIndex] = {
                    ...item,
                    tenantId,
                };
            }
        }
        response.status(200).json(localMockTenants[index]);
    });
    app.delete('/tenants/:tenantId', requireAuth, requireAdminLike, (request, response) => {
        const tenantId = normalizeText(request.params.tenantId);
        const index = localMockTenants.findIndex((tenant) => tenant.id === tenantId);
        if (index >= 0) {
            localMockTenants.splice(index, 1);
        }
        for (const user of localMockUsers) {
            if (user.role !== 'admin' && user.role !== 'manager') {
                continue;
            }
            localMockNotifications.push({
                id: randomUUID(),
                userId: user.id,
                eventType: 'tenant_deleted',
                title: `Контрагент удалён: ${tenantId}`,
                body: '',
                entityType: 'tenant',
                entityId: tenantId,
                isRead: false,
                createdAt: new Date().toISOString(),
            });
        }
        response.status(204).send();
    });
};
export const registerTenantRoutes = (params) => {
    const {
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
    } = params;
    app.get('/tenants', requireAuth, requireTenantPageAccess, asyncHandler(async (request, response) => {
        const search = normalizeText(request.query?.search).toLowerCase();
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
        const conditions = [`deleted_at is null`];
        const values = [];
        if (search) {
            values.push(`%${search}%`);
            const searchRef = `$${values.length}`;
            conditions.push(`(
                lower(coalesce(name, '')) like ${searchRef}
                or lower(coalesce(brand_name, '')) like ${searchRef}
                or lower(coalesce(inn, '')) like ${searchRef}
            )`);
        }
        const whereSql = conditions.join(' and ');
        const countResult = await dbQuery(`select count(*)::int as total
       from tenants
       where ${whereSql}`, values);
        const total = Number(countResult.rows[0]?.total ?? 0);
        const pageValues = [...values, limit, offset];
        const limitRef = `$${pageValues.length - 1}`;
        const offsetRef = `$${pageValues.length}`;
        const result = await dbQuery(`select
       id::text as id,
       name,
       coalesce(brand_name, name) as "brandName",
       coalesce(inn, '') as inn,
       coalesce(contacts, '[]'::jsonb) as contacts,
       coalesce(type, 'tenant') as type
     from tenants
     where ${whereSql}
     order by name asc
     limit ${limitRef}::int
     offset ${offsetRef}::int`, pageValues);
        response.status(200).json({
            items: result.rows.map(mapTenantRow),
            total,
            page,
            limit,
            totalPages: total > 0 ? Math.ceil(total / limit) : 0,
        });
    }));
    app.post('/tenants', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        const body = createTenantSchema.parse(request.body);
        const contactsFromFields = (body.email || body.phone) ? [{
            id: randomUUID(),
            fullName: '',
            position: '',
            email: normalizeText(body.email) || '',
            phone: normalizeText(body.phone) || '',
        }] : undefined;
        const contactsPayload = normalizeTenantContacts(contactsFromFields ?? body.contacts);
        const created = await dbQuery(`insert into tenants(name, brand_name, inn, contacts, type)
     values($1, $2, $3, $4::jsonb, $5)
     returning
       id::text as id,
       name,
       coalesce(brand_name, name) as "brandName",
       coalesce(inn, '') as inn,
       coalesce(contacts, '[]'::jsonb) as contacts,
       coalesce(type, 'tenant') as type`, [
            body.name,
            body.brandName?.trim() || body.name,
            body.inn?.trim() || '',
            JSON.stringify(contactsPayload),
            body.type === 'contractor' ? 'contractor' : 'tenant',
        ]);
        const row = created.rows[0];
        if (!row) {
            throw new ApiError(500, 'TENANT_CREATE_FAILED', 'Failed to create tenant');
        }
        const tenant = mapTenantRow(row);

        // Log activity: tenant created
        const { logEntityCreated } = await import('../services/activityLogService.js');
        const actorUserId = request.authUser?.id;
        const actorName = request.authUser?.fullName || request.authUser?.email || 'Пользователь';
        void logEntityCreated('tenant', tenant.id, tenant.name, actorUserId, actorName).catch(() => {});

        // Автопривязка объектов обслуживания по совпадению юр. лица (только арендаторы)
        if (body.type !== 'contractor') {
            void dbQuery(`
                UPDATE maintenance_items
                SET tenant_id = $1::uuid, updated_at = now()
                WHERE deleted_at IS NULL
                  AND tenant_id IS NULL
                  AND lower(trim(coalesce(legal_entity,''))) = lower(trim($2))
                  AND trim(coalesce(legal_entity,'')) <> ''
            `, [row.id, body.name]).catch(() => {});
        }
        try {
            void sendTenantEventNotification(request, {
                action: 'created',
                tenant,
            }).catch((error) => {
                logger.error('Failed to send tenant created notification', {
                    error: serializeError(error),
                });
            });
        }
        catch (_error) {
        }
        const adminManagerIds = await getAdminManagerIds();
        void pushInAppNotification({
            recipientIds: adminManagerIds,
            eventType: 'tenant_created',
            title: `Новый контрагент: ${tenant.name || tenant.id}`,
            body: tenant.inn ? `ИНН: ${tenant.inn}` : '',
            entityType: 'tenant',
            entityId: tenant.id,
        });
        response.status(201).json(tenant);
    }));
    app.post('/tenants/bulk-upsert', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        const body = bulkUpsertTenantsSchema.parse(request.body);
        const items = [];
        let created = 0;
        let updated = 0;
        for (const row of body.rows) {
            const tenantName = row.name.trim();
            const brandName = row.brandName?.trim() || tenantName;
            const inn = row.inn?.trim() || '';
            const contactsPayload = normalizeTenantContacts(row.contacts);
            let result;
            if (row.id) {
                result = await dbQuery(`update tenants
         set name = $2,
             brand_name = $3,
             inn = $4,
             contacts = $5::jsonb
         where id = $1::uuid
         returning
           id::text as id,
           name,
           coalesce(brand_name, name) as "brandName",
           coalesce(inn, '') as inn,
           coalesce(contacts, '[]'::jsonb) as contacts`, [row.id, tenantName, brandName, inn, JSON.stringify(contactsPayload)]);
                if ((result.rowCount ?? 0) > 0) {
                    updated += 1;
                }
                else {
                    result = await dbQuery(`insert into tenants(id, name, brand_name, inn, contacts)
           values($1::uuid, $2, $3, $4, $5::jsonb)
           returning
             id::text as id,
             name,
             coalesce(brand_name, name) as "brandName",
             coalesce(inn, '') as inn,
             coalesce(contacts, '[]'::jsonb) as contacts`, [row.id, tenantName, brandName, inn, JSON.stringify(contactsPayload)]);
                    created += 1;
                }
            }
            else {
                result = await dbQuery(`insert into tenants(name, brand_name, inn, contacts)
         values($1, $2, $3, $4::jsonb)
         returning
           id::text as id,
           name,
           coalesce(brand_name, name) as "brandName",
           coalesce(inn, '') as inn,
           coalesce(contacts, '[]'::jsonb) as contacts`, [tenantName, brandName, inn, JSON.stringify(contactsPayload)]);
                created += 1;
            }
            const item = result.rows[0];
            if (item) {
                items.push(mapTenantRow(item));
            }
        }
        response.status(200).json({
            items,
            summary: {
                created,
                updated,
                total: items.length,
            },
        });
    }));
    app.get('/tenants/export', requireAuth, requireTenantPageAccess, asyncHandler(async (_request, response) => {
        let tenants;
        if (localMockAuthEnabled) {
            tenants = localMockTenants;
        }
        else {
            const result = await dbQuery(`select
         id::text as id,
         name,
         coalesce(brand_name, name) as "brandName",
         coalesce(inn, '') as inn,
         coalesce(contacts, '[]'::jsonb) as contacts
       from tenants
       where deleted_at is null
       order by name asc`);
            tenants = result.rows.map(mapTenantRow);
        }
        const toCsvCell = (value) => {
            const text = String(value ?? '');
            if (text.includes(',') || text.includes('"') || text.includes('\n')) {
                return `"${text.replace(/"/g, '""')}"`;
            }
            return text;
        };
        const csvHeader = 'id,name,brandName,inn,contactName,contactEmail,contactPhone';
        const csvRows = tenants.flatMap((tenant) => {
            const contacts = Array.isArray(tenant.contacts) && tenant.contacts.length > 0 ? tenant.contacts : [{}];
            return contacts.map((contact) => [
                toCsvCell(tenant.id),
                toCsvCell(tenant.name),
                toCsvCell(tenant.brandName),
                toCsvCell(tenant.inn),
                toCsvCell(contact.fullName),
                toCsvCell(contact.email),
                toCsvCell(contact.phone),
            ].join(','));
        });
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', 'attachment; filename=\"tenants.csv\"');
        response.status(200).send(`\uFEFF${[csvHeader, ...csvRows].join('\n')}`);
    }));
    app.get('/tenants/export-xlsx', requireAuth, requireTenantPageAccess, asyncHandler(async (_request, response) => {
        let tenants;
        if (localMockAuthEnabled) {
            tenants = localMockTenants;
        } else {
            const result = await dbQuery(`select
         id::text as id,
         name,
         coalesce(brand_name, name) as "brandName",
         coalesce(inn, '') as inn,
         coalesce(contacts, '[]'::jsonb) as contacts
       from tenants
       where deleted_at is null
       order by name asc`);
            tenants = result.rows.map(mapTenantRow);
        }
        const { sendXlsxResponse } = await import('../helpers/xlsxHelpers.js');
        const rows = tenants.flatMap((tenant) => {
            const contacts = Array.isArray(tenant.contacts) && tenant.contacts.length > 0 ? tenant.contacts : [{}];
            return contacts.map((contact: any) => ({
                id: String(tenant.id ?? ''),
                name: String(tenant.name ?? ''),
                brandName: String(tenant.brandName ?? ''),
                inn: String(tenant.inn ?? ''),
                contactName: String(contact.fullName ?? ''),
                contactEmail: String(contact.email ?? ''),
                contactPhone: String(contact.phone ?? ''),
            }));
        });
        await sendXlsxResponse(response, 'tenants', [
            { header: 'ID', key: 'id', width: 38 },
            { header: 'Название', key: 'name', width: 35 },
            { header: 'Бренд', key: 'brandName', width: 30 },
            { header: 'ИНН', key: 'inn', width: 14 },
            { header: 'Контакт', key: 'contactName', width: 25 },
            { header: 'Email', key: 'contactEmail', width: 28 },
            { header: 'Телефон', key: 'contactPhone', width: 18 },
        ], rows);
    }));
    app.post('/tenants/import', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        const body = request.body;
        if (!body || !Array.isArray(body.rows)) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'body.rows must be an array of tenant objects');
        }
        const errors = [];
        const validRows = [];
        for (let index = 0; index < body.rows.length; index += 1) {
            const row = body.rows[index] && typeof body.rows[index] === 'object' ? body.rows[index] : {};
            const rowNumber = index + 1;
            const name = typeof row.name === 'string' ? row.name.trim() : '';
            const inn = typeof row.inn === 'string' ? row.inn.trim() : '';
            if (!name) {
                errors.push({
                    row: rowNumber,
                    field: 'name',
                    message: 'Название обязательно',
                });
                continue;
            }
            if (inn) {
                const duplicate = validRows.find((item) => item.inn === inn);
                if (duplicate) {
                    errors.push({
                        row: rowNumber,
                        field: 'inn',
                        message: `Дубль ИНН "${inn}"`,
                    });
                    continue;
                }
            }
            validRows.push({
                id: typeof row.id === 'string' && row.id.trim().length > 0 ? row.id.trim() : undefined,
                name,
                brandName: typeof row.brandName === 'string' && row.brandName.trim().length > 0 ? row.brandName.trim() : name,
                inn,
                contacts: Array.isArray(row.contacts) ? row.contacts : [],
            });
        }
        if (!localMockAuthEnabled && validRows.length > 0) {
            const inns = validRows.filter((row) => row.inn).map((row) => row.inn);
            if (inns.length > 0) {
                const existing = await dbQuery(`select inn
           from tenants
           where inn = any($1::text[])
             and coalesce(trim(inn), '') <> ''`, [inns]);
                const existingInns = new Set(existing.rows
                    .map((row) => String(row.inn ?? '').trim())
                    .filter((value) => value.length > 0));
                for (const inn of existingInns) {
                    const rowIndex = validRows.findIndex((row) => row.inn === inn);
                    if (rowIndex >= 0 && !validRows[rowIndex].id) {
                        errors.push({
                            row: rowIndex + 1,
                            field: 'inn',
                            message: `ИНН "${inn}" уже существует в базе (будет обновлён)`,
                            severity: 'warning',
                        });
                    }
                }
            }
        }
        const criticalErrors = errors.filter((error) => error.severity !== 'warning');
        if (criticalErrors.length > 0) {
            response.status(422).json({
                imported: 0,
                errors,
                validRows: validRows.length,
            });
            return;
        }
        if (localMockAuthEnabled) {
            response.status(200).json({
                imported: validRows.length,
                created: validRows.length,
                updated: 0,
                errors,
            });
            return;
        }
        let created = 0;
        let updated = 0;
        for (const row of validRows) {
            const contactsPayload = normalizeTenantContacts(row.contacts);
            if (row.id) {
                const updateResult = await dbQuery(`update tenants
         set name = $2,
             brand_name = $3,
             inn = $4,
             contacts = $5::jsonb
         where id = $1::uuid
         returning id`, [row.id, row.name, row.brandName, row.inn, JSON.stringify(contactsPayload)]);
                if ((updateResult.rowCount ?? 0) > 0) {
                    updated += 1;
                }
                else {
                    await dbQuery(`insert into tenants(id, name, brand_name, inn, contacts)
           values($1::uuid, $2, $3, $4, $5::jsonb)`, [row.id, row.name, row.brandName, row.inn, JSON.stringify(contactsPayload)]);
                    created += 1;
                }
            }
            else {
                await dbQuery(`insert into tenants(name, brand_name, inn, contacts)
         values($1, $2, $3, $4::jsonb)`, [row.name, row.brandName, row.inn, JSON.stringify(contactsPayload)]);
                created += 1;
            }
        }
        response.status(200).json({
            imported: validRows.length,
            created,
            updated,
            errors,
        });
    }));
    app.patch('/tenants/:tenantId', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        const tenantId = parseUuidPath(request.params.tenantId);
        const body = request.body ?? {};
        const name = normalizeText(body.name);
        if (!name) throw new ApiError(400, 'VALIDATION_ERROR', 'name is required');
        const brandName = normalizeText(body.brandName) || name;
        const inn = normalizeText(body.inn) || '';
        const type = body.type === 'contractor' ? 'contractor' : 'tenant';
        const contacts = [{
            id: randomUUID(),
            fullName: normalizeText(body.contactName) || normalizeText(body.fullName) || '',
            position: normalizeText(body.position) || '',
            email: normalizeText(body.email) || '',
            phone: normalizeText(body.phone) || '',
        }];
        const result = await dbQuery(`
            UPDATE tenants SET
              name=$2, brand_name=$3, inn=$4, type=$5,
              contacts=$6::jsonb,
              updated_at=now()
            WHERE id=$1::uuid AND deleted_at IS NULL
            RETURNING id::text, name, coalesce(brand_name,name) as "brandName",
              coalesce(inn,'') as inn, coalesce(contacts,'[]'::jsonb) as contacts,
              coalesce(type,'tenant') as type`,
            [tenantId, name, brandName, inn, type, JSON.stringify(contacts)]
        );
        if (!result.rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Tenant not found');
        const tenant = mapTenantRow(result.rows[0]);
        // Log activity: tenant updated
        const { logActivity } = await import('../services/activityLogService.js');
        const actorUserId = request.authUser?.id;
        const actorName = request.authUser?.fullName || request.authUser?.email || 'Пользователь';
        void logActivity({
            entityType: 'tenant',
            entityId: tenant.id,
            activityType: 'updated',
            actorUserId,
            actorName,
            severity: 'info',
            title: 'Контрагент обновлён',
            description: `Обновлены данные контрагента "${tenant.name}"`,
            metadata: { name, brandName, inn, type },
        }).catch(() => {});

        // Автопривязка объектов обслуживания по совпа��ению юр. лица (только арендаторы)
        if (type !== 'contractor') {
            void dbQuery(`
                UPDATE maintenance_items
                SET tenant_id = $1::uuid, updated_at = now()
                WHERE deleted_at IS NULL
                  AND tenant_id IS NULL
                  AND lower(trim(coalesce(legal_entity,''))) = lower(trim($2))
                  AND trim(coalesce(legal_entity,'')) <> ''
            `, [tenantId, name]).catch(() => {});
        }
        response.status(200).json(tenant);
    }));

    app.get('/tenants/:tenantId/details', requireAuth, requireTenantPageAccess, asyncHandler(async (request, response) => {
        const tenantId = parseUuidPath(request.params.tenantId);
        const tenantResult = await dbQuery(`
            SELECT id::text, name, coalesce(brand_name, name) as "brandName", coalesce(inn,'') as inn,
                   coalesce(contacts,'[]'::jsonb) as contacts, coalesce(type,'tenant') as type
            FROM tenants WHERE id = $1::uuid AND deleted_at IS NULL`, [tenantId]);
        if (!tenantResult.rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Tenant not found');
        const tenant = mapTenantRow(tenantResult.rows[0]);

        // Objects linked to this tenant via tenant_id
        const itemsResult = await dbQuery(`
            SELECT mi.id::text, mi.name, mi.address, mi.position_number as "positionNumber",
                   mi.legal_entity as "legalEntity", mi.contract_number as "contractNumber",
                   d.name as "directionName"
            FROM maintenance_items mi
            LEFT JOIN directions d ON d.id = mi.direction_id
            WHERE mi.tenant_id = $1::uuid AND mi.deleted_at IS NULL
            ORDER BY mi.name`, [tenantId]);

        // Maintenance requests (ПО ТО) for tenant's objects
        const maintenanceResult = await dbQuery(`
            SELECT r.id::text, r.title, r.status, r.type, r.created_at as "createdAt"
            FROM requests r
            WHERE r.deleted_at IS NULL
              AND r.type = 'maintenance_planned'
              AND EXISTS (
                SELECT 1 FROM maintenance_items mi
                WHERE mi.tenant_id = $1::uuid AND mi.deleted_at IS NULL
                  AND mi.id::text = ANY(r.item_ids)
              )
            ORDER BY r.created_at DESC LIMIT 50`, [tenantId]);

        // Installation/project requests for contractor
        const installationResult = await dbQuery(`
            SELECT r.id::text, r.title, r.status, r.type, r.is_project as "isProject",
                   r.created_at as "createdAt", r.executor_ids as "executorIds"
            FROM requests r
            WHERE r.deleted_at IS NULL
              AND r.type = 'installation'
              AND EXISTS (
                SELECT 1 FROM app_user_bindings ub
                JOIN app_users u ON u.id = ub.user_id
                WHERE ub.counterparty_id = $1::uuid
                  AND u.id::text = ANY(r.executor_ids)
              )
            ORDER BY r.created_at DESC LIMIT 50`, [tenantId]);

        response.status(200).json({
            tenant,
            items: itemsResult.rows,
            requests: maintenanceResult.rows,
            installations: installationResult.rows,
        });
    }));

    app.get('/tenants/:tenantId/360', requireAuth, requireTenantPageAccess, asyncHandler(async (request, response) => {
        const tenantId = parseUuidPath(request.params.tenantId);

        // Batch load all data in parallel for efficiency
        const [tenantResult, directionsResult, projectsResult, installationsResult, serviceRequestsResult, contractsResult, filesResult, activityLogResult] = await Promise.all([
            // Tenant profile
            dbQuery(`
                SELECT id::text, name, coalesce(brand_name, name) as "brandName", coalesce(inn,'') as inn,
                       coalesce(contacts,'[]'::jsonb) as contacts, coalesce(type,'tenant') as type,
                       created_at as "createdAt", updated_at as "updatedAt"
                FROM tenants WHERE id = $1::uuid AND deleted_at IS NULL`, [tenantId]),

            // Related directions
            dbQuery(`
                SELECT d.id::text, d.name, d.address, d.created_at as "createdAt",
                       (SELECT count(*)::int FROM maintenance_items mi
                        WHERE mi.direction_id = d.id AND mi.deleted_at IS NULL) as "itemsCount"
                FROM directions d
                WHERE d.deleted_at IS NULL
                ORDER BY d.name`, []),

            // Related projects (installation type with is_project=true)
            dbQuery(`
                SELECT r.id::text, r.title, r.status, r.created_at as "createdAt",
                       r.executor_ids as "executorIds", r.updated_at as "updatedAt"
                FROM requests r
                WHERE r.deleted_at IS NULL
                  AND r.type = 'installation'
                  AND r.is_project = true
                  AND EXISTS (
                    SELECT 1 FROM app_user_bindings ub
                    JOIN app_users u ON u.id = ub.user_id
                    WHERE ub.counterparty_id = $1::uuid
                      AND u.id::text = ANY(r.executor_ids)
                  )
                ORDER BY r.created_at DESC LIMIT 100`, [tenantId]),

            // Related installations (installation type with is_project=false)
            dbQuery(`
                SELECT r.id::text, r.title, r.status, r.created_at as "createdAt",
                       r.executor_ids as "executorIds", r.updated_at as "updatedAt"
                FROM requests r
                WHERE r.deleted_at IS NULL
                  AND r.type = 'installation'
                  AND (r.is_project = false OR r.is_project IS NULL)
                  AND EXISTS (
                    SELECT 1 FROM app_user_bindings ub
                    JOIN app_users u ON u.id = ub.user_id
                    WHERE ub.counterparty_id = $1::uuid
                      AND u.id::text = ANY(r.executor_ids)
                  )
                ORDER BY r.created_at DESC LIMIT 100`, [tenantId]),

            // Service requests (maintenance_planned for tenant's objects)
            dbQuery(`
                SELECT r.id::text, r.title, r.status, r.type, r.created_at as "createdAt",
                       r.updated_at as "updatedAt", r.item_ids as "itemIds"
                FROM requests r
                WHERE r.deleted_at IS NULL
                  AND r.type = 'maintenance_planned'
                  AND EXISTS (
                    SELECT 1 FROM maintenance_items mi
                    WHERE mi.tenant_id = $1::uuid AND mi.deleted_at IS NULL
                      AND mi.id::text = ANY(r.item_ids)
                  )
                ORDER BY r.created_at DESC LIMIT 100`, [tenantId]),

            // Contracts
            dbQuery(`
                SELECT c.id::text, c.number, c.type, c.status,
                       c.start_date as "startDate", c.end_date as "endDate",
                       c.description, c.created_at as "createdAt"
                FROM contracts c
                WHERE c.deleted_at IS NULL
                  AND (c.tenant_id = $1::uuid OR c.contractor_id = $1::uuid)
                ORDER BY c.created_at DESC`, [tenantId]),

            // Files - uploaded_files doesn't have entity_type/entity_id, return empty for now
            Promise.resolve({ rows: [] }),

            // Activity Log - entity_activity_log doesn't have actor_name, title, description, severity
            dbQuery(`
                SELECT id::text, entity_type as "entityType", entity_id as "entityId",
                       activity_type as "activityType", actor_user_id::text as "actorUserId",
                       metadata, created_at as "createdAt"
                FROM entity_activity_log
                WHERE entity_type = 'tenant' AND entity_id = $1::text
                ORDER BY created_at DESC LIMIT 100`, [tenantId])
        ]);

        if (!tenantResult.rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Tenant not found');

        response.status(200).json({
            tenant: mapTenantRow(tenantResult.rows[0]),
            directions: directionsResult.rows,
            projects: projectsResult.rows,
            installations: installationsResult.rows,
            serviceRequests: serviceRequestsResult.rows,
            contracts: contractsResult.rows,
            files: filesResult.rows,
            activityLog: activityLogResult.rows,
        });
    }));

    app.delete('/tenants/:tenantId', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        const tenantId = parseUuidPath(request.params.tenantId);
        try {
            const deleted = await dbQuery(`delete from tenants
       where id = $1::uuid
       returning id::text as id`, [tenantId]);
            if ((deleted.rowCount ?? 0) === 0) {
                throw new ApiError(404, 'TENANT_NOT_FOUND', 'Tenant not found');
            }
        }
        catch (error) {
            if (error?.code === '23503') {
                throw new ApiError(409, 'TENANT_DELETE_CONFLICT', 'Tenant is used in related records');
            }
            throw error;
        }
        try {
            void sendTenantEventNotification(request, {
                action: 'deleted',
                tenant: {
                    id: tenantId,
                    name: 'Удалённый контрагент',
                },
            }).catch((error) => {
                logger.error('Failed to send tenant deleted notification', {
                    error: serializeError(error),
                });
            });
        }
        catch (_error) {
        }
        const adminManagerIds = await getAdminManagerIds();
        void pushInAppNotification({
            recipientIds: adminManagerIds,
            eventType: 'tenant_deleted',
            title: `Контрагент удалён: ${tenantId}`,
            body: 'Контрагент удалён из системы',
            entityType: 'tenant',
            entityId: tenantId,
        });
        response.status(204).send();
    }));
    app.post('/tenants/import-xlsx', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        const contentType = String(request.headers['content-type'] || '');
        if (!contentType.includes('multipart/form-data') && !contentType.includes('application/octet-stream')) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Ожидается multipart/form-data или application/octet-stream');
        }
        // Collect raw body buffer
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
            request.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            request.on('end', resolve);
            request.on('error', reject);
        });
        let xlsxBuffer: Buffer;
        if (contentType.includes('multipart/form-data')) {
            // Extract file from multipart — find xlsx binary after headers
            const boundary = contentType.split('boundary=')[1]?.trim();
            const raw = Buffer.concat(chunks);
            if (!boundary) throw new ApiError(400, 'VALIDATION_ERROR', 'Не найден boundary');
            const boundaryBuf = Buffer.from(`--${boundary}`);
            const start = raw.indexOf(boundaryBuf);
            const headerEnd = raw.indexOf(Buffer.from('\r\n\r\n'), start);
            const nextBoundary = raw.indexOf(boundaryBuf, headerEnd + 4);
            xlsxBuffer = raw.slice(headerEnd + 4, nextBoundary - 2);
        } else {
            xlsxBuffer = Buffer.concat(chunks);
        }
        const { parseXlsxBuffer, mapTenantXlsxRow } = await import('../helpers/xlsxImportHelpers.js');
        const xlsxRows = await parseXlsxBuffer(xlsxBuffer);
        if (xlsxRows.length === 0) throw new ApiError(422, 'VALIDATION_ERROR', 'Файл пустой или не содержит данных');
        let created = 0;
        let updated = 0;
        const errors: unknown[] = [];
        for (let i = 0; i < xlsxRows.length; i++) {
            const mapped = mapTenantXlsxRow(xlsxRows[i]);
            const name = mapped.name.trim();
            if (!name) { errors.push({ row: i + 2, message: 'Пустое название — пропущено' }); continue; }
            const brandName = mapped.brandName.trim() || name;
            const inn = mapped.inn.trim();
            const contacts = (mapped.contactName || mapped.contactEmail || mapped.contactPhone) ? [{
                id: randomUUID(),
                fullName: mapped.contactName,
                position: '',
                email: mapped.contactEmail,
                phone: mapped.contactPhone,
            }] : [];
            const existing = await dbQuery(`SELECT id FROM tenants WHERE lower(trim(name)) = lower($1) AND deleted_at IS NULL LIMIT 1`, [name]);
            if (existing.rows.length > 0) {
                await dbQuery(`UPDATE tenants SET brand_name=$2, inn=coalesce(nullif($3,''),inn), contacts=CASE WHEN $4::jsonb != '[]'::jsonb THEN $4::jsonb ELSE contacts END, updated_at=now() WHERE id=$1::uuid`,
                    [existing.rows[0].id, brandName, inn, JSON.stringify(contacts)]);
                updated++;
            } else {
                await dbQuery(`INSERT INTO tenants(name, brand_name, inn, contacts) VALUES($1,$2,$3,$4::jsonb)`,
                    [name, brandName, inn, JSON.stringify(contacts)]);
                created++;
            }
        }
        response.status(200).json({ summary: { created, updated, errors } });
    }));
};
