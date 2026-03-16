export const registerMockContractRoutes = (params) => {
    const { app, requireAuth, ApiError, randomUUID, getLocalMockBodyObject } = params;
    const mockContracts = [];
    app.get('/contracts', requireAuth, (_request, response) => {
        response.status(200).json(mockContracts);
    });
    app.post('/contracts', requireAuth, (request, response) => {
        const body = getLocalMockBodyObject(request.body);
        const contract = { id: randomUUID(), ...body, createdAt: new Date().toISOString() };
        mockContracts.push(contract);
        response.status(201).json(contract);
    });
    app.patch('/contracts/:contractId', requireAuth, (request, response) => {
        const body = getLocalMockBodyObject(request.body);
        const idx = mockContracts.findIndex((c) => c.id === request.params.contractId);
        if (idx === -1)
            throw new ApiError(404, 'NOT_FOUND', 'Contract not found');
        mockContracts[idx] = { ...mockContracts[idx], ...body };
        response.status(200).json(mockContracts[idx]);
    });
    app.delete('/contracts/:contractId', requireAuth, (request, response) => {
        const idx = mockContracts.findIndex((c) => c.id === request.params.contractId);
        if (idx === -1)
            throw new ApiError(404, 'NOT_FOUND', 'Contract not found');
        mockContracts.splice(idx, 1);
        response.status(200).json({ ok: true });
    });
    app.get('/contracts/export', requireAuth, (_request, response) => {
        const toCsvCell = (value) => {
            const text = String(value ?? '');
            if (text.includes(',') || text.includes('"') || text.includes('\n')) {
                return `"${text.replace(/"/g, '""')}"`;
            }
            return text;
        };
        const csvRows = mockContracts.map((c) => [
            toCsvCell(c.id), toCsvCell(c.number), toCsvCell(c.type),
            toCsvCell(c.status), toCsvCell(c.startDate), toCsvCell(c.endDate),
        ].join(','));
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', 'attachment; filename="contracts.csv"');
        response.status(200).send(`\uFEFFid,number,type,status,startDate,endDate\n${csvRows.join('\n')}`);
    });
};
export const registerContractRoutes = (params) => {
    const { app, requireAuth, requireAdminLike, asyncHandler, dbQuery, ApiError, parseUuidPath, normalizeText, toCsvCell, } = params;
    const ensureContractSchema = async () => {
        await dbQuery(`CREATE TABLE IF NOT EXISTS contracts (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            number text NOT NULL,
            type text NOT NULL DEFAULT 'MAINTENANCE',
            direction_id uuid,
            tenant_id uuid,
            start_date date,
            end_date date,
            status text NOT NULL DEFAULT 'DRAFT',
            description text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            deleted_at timestamptz
        )`);
        await dbQuery(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'MAINTENANCE'`);
        await dbQuery(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS start_date date`);
        await dbQuery(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS end_date date`);
        await dbQuery(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'DRAFT'`);
        await dbQuery(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS description text`);
        await dbQuery(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`);
        await dbQuery(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`);
        await dbQuery(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS deleted_at timestamptz`);
    };
    const mapContractRow = (row) => ({
        id: row.id,
        number: row.number,
        type: row.type,
        directionId: row.direction_id ?? null,
        tenantId: row.tenant_id ?? null,
        startDate: row.start_date ? String(row.start_date).slice(0, 10) : null,
        endDate: row.end_date ? String(row.end_date).slice(0, 10) : null,
        status: row.status,
        description: row.description ?? '',
        createdAt: row.created_at,
    });
    app.get('/contracts/export', requireAuth, requireAdminLike, asyncHandler(async (_request, response) => {
        await ensureContractSchema();
        const result = await dbQuery(`SELECT id, number, type, status, start_date, end_date, tenant_id, description FROM contracts WHERE deleted_at IS NULL ORDER BY created_at DESC`);
        const csvRows = result.rows.map((row) => [
            toCsvCell(row.id),
            toCsvCell(row.number),
            toCsvCell(row.type),
            toCsvCell(row.status),
            toCsvCell(row.start_date ? String(row.start_date).slice(0, 10) : ''),
            toCsvCell(row.end_date ? String(row.end_date).slice(0, 10) : ''),
            toCsvCell(row.tenant_id),
            toCsvCell(row.description),
        ].join(','));
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', 'attachment; filename="contracts.csv"');
        response.status(200).send(`\uFEFFid,number,type,status,startDate,endDate,tenantId,description\n${csvRows.join('\n')}`);
    }));
    app.get('/contracts/export-xlsx', requireAuth, requireAdminLike, asyncHandler(async (_request, response) => {
        await ensureContractSchema();
        const result = await dbQuery(`SELECT id, number, type, status, start_date, end_date, tenant_id, description FROM contracts WHERE deleted_at IS NULL ORDER BY created_at DESC`);
        const { sendXlsxResponse } = await import('../helpers/xlsxHelpers.js');
        await sendXlsxResponse(response, 'contracts', [
            { header: 'ID', key: 'id', width: 38 },
            { header: 'Номер', key: 'number', width: 20 },
            { header: 'Тип', key: 'type', width: 16 },
            { header: 'Статус', key: 'status', width: 16 },
            { header: 'Дата начала', key: 'startDate', width: 14 },
            { header: 'Дата окончания', key: 'endDate', width: 14 },
            { header: 'Контрагент', key: 'tenantId', width: 38 },
            { header: 'Описание', key: 'description', width: 40 },
        ], result.rows.map((row) => ({
            id: String(row.id ?? ''),
            number: String(row.number ?? ''),
            type: String(row.type ?? ''),
            status: String(row.status ?? ''),
            startDate: row.start_date ? String(row.start_date).slice(0, 10) : '',
            endDate: row.end_date ? String(row.end_date).slice(0, 10) : '',
            tenantId: String(row.tenant_id ?? ''),
            description: String(row.description ?? ''),
        })));
    }));
    app.get('/contracts', requireAuth, asyncHandler(async (request, response) => {
        await ensureContractSchema();
        const search = normalizeText(typeof request.query?.search === 'string' ? request.query.search : '');
        const status = normalizeText(typeof request.query?.status === 'string' ? request.query.status : '');
        const sqlParams = [];
        let sql = `SELECT id, number, type, direction_id, tenant_id, start_date, end_date, status, description, created_at FROM contracts WHERE deleted_at IS NULL`;
        if (status) {
            sqlParams.push(status);
            sql += ` AND status = $${sqlParams.length}`;
        }
        if (search) {
            sqlParams.push(`%${search}%`);
            sql += ` AND (number ILIKE $${sqlParams.length} OR description ILIKE $${sqlParams.length})`;
        }
        sql += ` ORDER BY created_at DESC`;
        const result = await dbQuery(sql, sqlParams);
        response.status(200).json(result.rows.map(mapContractRow));
    }));
    app.post('/contracts', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        await ensureContractSchema();
        const body = request.body ?? {};
        const number = normalizeText(body.number);
        if (!number)
            throw new ApiError(422, 'VALIDATION_ERROR', 'number is required');
        const type = normalizeText(body.type) || 'MAINTENANCE';
        const status = normalizeText(body.status) || 'DRAFT';
        const directionId = isUuidValue(body.directionId) ? body.directionId : null;
        const tenantId = isUuidValue(body.tenantId) ? body.tenantId : null;
        const startDate = body.startDate ? String(body.startDate).slice(0, 10) : null;
        const endDate = body.endDate ? String(body.endDate).slice(0, 10) : null;
        const description = normalizeText(body.description);
        const result = await dbQuery(`INSERT INTO contracts(number, type, direction_id, tenant_id, start_date, end_date, status, description)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING id, number, type, direction_id, tenant_id, start_date, end_date, status, description, created_at`, [number, type, directionId, tenantId, startDate, endDate, status, description]);
        const row = result.rows[0];
        if (!row)
            throw new ApiError(500, 'CONTRACT_CREATE_FAILED', 'Failed to create contract');
        response.status(201).json(mapContractRow(row));
    }));
    app.patch('/contracts/:contractId', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        await ensureContractSchema();
        const contractId = parseUuidPath(request.params.contractId, 'contractId');
        const body = request.body ?? {};
        const fields = [];
        const sqlParams = [contractId];
        if (body.number !== undefined) {
            sqlParams.push(normalizeText(body.number));
            fields.push(`number = $${sqlParams.length}`);
        }
        if (body.type !== undefined) {
            sqlParams.push(normalizeText(body.type));
            fields.push(`type = $${sqlParams.length}`);
        }
        if (body.status !== undefined) {
            sqlParams.push(normalizeText(body.status));
            fields.push(`status = $${sqlParams.length}`);
        }
        if (body.description !== undefined) {
            sqlParams.push(normalizeText(body.description));
            fields.push(`description = $${sqlParams.length}`);
        }
        if (body.directionId !== undefined) {
            sqlParams.push(isUuidValue(body.directionId) ? body.directionId : null);
            fields.push(`direction_id = $${sqlParams.length}`);
        }
        if (body.tenantId !== undefined) {
            sqlParams.push(isUuidValue(body.tenantId) ? body.tenantId : null);
            fields.push(`tenant_id = $${sqlParams.length}`);
        }
        if (body.startDate !== undefined) {
            sqlParams.push(body.startDate ? String(body.startDate).slice(0, 10) : null);
            fields.push(`start_date = $${sqlParams.length}`);
        }
        if (body.endDate !== undefined) {
            sqlParams.push(body.endDate ? String(body.endDate).slice(0, 10) : null);
            fields.push(`end_date = $${sqlParams.length}`);
        }
        if (fields.length === 0)
            throw new ApiError(422, 'VALIDATION_ERROR', 'No fields to update');
        fields.push(`updated_at = now()`);
        const result = await dbQuery(`UPDATE contracts SET ${fields.join(', ')} WHERE id = $1::uuid AND deleted_at IS NULL
             RETURNING id, number, type, direction_id, tenant_id, start_date, end_date, status, description, created_at`, sqlParams);
        const row = result.rows[0];
        if (!row)
            throw new ApiError(404, 'NOT_FOUND', 'Contract not found');
        response.status(200).json(mapContractRow(row));
    }));
    app.delete('/contracts/:contractId', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        await ensureContractSchema();
        const contractId = parseUuidPath(request.params.contractId, 'contractId');
        const result = await dbQuery(`UPDATE contracts SET deleted_at = now() WHERE id = $1::uuid AND deleted_at IS NULL RETURNING id`, [contractId]);
        if ((result.rowCount ?? 0) === 0)
            throw new ApiError(404, 'NOT_FOUND', 'Contract not found');
        response.status(200).json({ ok: true });
    }));
};
function isUuidValue(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
