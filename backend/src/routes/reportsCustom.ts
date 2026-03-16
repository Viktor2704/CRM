import { sendXlsxResponse } from '../helpers/xlsxHelpers.js';

export const registerReportRoutes = (params) => {
    const { app, requireAuth, asyncHandler, dbQuery, ApiError } = params;

    const ALLOWED_ROLES = new Set(['admin', 'manager', 'dispatcher', 'curator']);

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    const parseUuidParam = (value) => {
        if (!value || !UUID_REGEX.test(value)) {
            throw new ApiError(400, 'INVALID_ID', 'Invalid ID format — expected UUID');
        }
        return value;
    };

    const requireReportAccess = (request, _response, next) => {
        const role = request.authUser?.role;
        if (!role || !ALLOWED_ROLES.has(role)) {
            throw new ApiError(403, 'FORBIDDEN', 'Access denied');
        }
        next();
    };

    const parseDateRange = (query) => {
        const dateFrom = query.dateFrom || '2020-01-01';
        const dateTo = query.dateTo || '2099-12-31';
        return { dateFrom, dateTo };
    };

    // ── Service Requests Report ──────────────────────────────────────

    const fetchServiceRequests = async (dateFrom, dateTo) => {
        const sql = `
            SELECT r.id, r.title, r.status, r.priority, r.type,
                   r.created_at, r.updated_at,
                   (SELECT string_agg(u.full_name, ', ') FROM app_users u WHERE u.id::text = ANY(r.executor_ids)) as executor_names
            FROM requests r
            WHERE r.deleted_at IS NULL
              AND r.created_at >= $1 AND r.created_at <= $2
            ORDER BY r.created_at DESC
        `;
        const result = await dbQuery(sql, [dateFrom, dateTo]);
        return result.rows;
    };

    app.get('/reports/service-requests', requireAuth, requireReportAccess, asyncHandler(async (request, response) => {
        const { dateFrom, dateTo } = parseDateRange(request.query);
        const rows = await fetchServiceRequests(dateFrom, dateTo);
        response.json({ items: rows, total: rows.length });
    }));

    app.get('/reports/service-requests/export-xlsx', requireAuth, requireReportAccess, asyncHandler(async (request, response) => {
        const { dateFrom, dateTo } = parseDateRange(request.query);
        const rows = await fetchServiceRequests(dateFrom, dateTo);
        await sendXlsxResponse(response, 'service_requests_report', [
            { header: 'ID', key: 'id', width: 38 },
            { header: 'Заголовок', key: 'title', width: 40 },
            { header: 'Статус', key: 'status', width: 16 },
            { header: 'Приоритет', key: 'priority', width: 14 },
            { header: 'Тип', key: 'type', width: 16 },
            { header: 'Создана', key: 'created_at', width: 20 },
            { header: 'Обновлена', key: 'updated_at', width: 20 },
            { header: 'Исполнители', key: 'executor_names', width: 30 },
        ], rows.map((r) => ({
            id: String(r.id ?? ''),
            title: String(r.title ?? ''),
            status: String(r.status ?? ''),
            priority: String(r.priority ?? ''),
            type: String(r.type ?? ''),
            created_at: String(r.created_at ?? ''),
            updated_at: String(r.updated_at ?? ''),
            executor_names: String(r.executor_names ?? ''),
        })));
    }));

    // ── Financial Report ─────────────────────────────────────────────

    const fetchFinancial = async (dateFrom) => {
        const sql = `
            SELECT
              c.id, c.number, c.type, c.status, c.start_date, c.end_date,
              t.name as tenant_name,
              (SELECT count(*) FROM requests r WHERE r.direction_id::text = c.direction_id::text AND r.deleted_at IS NULL) as request_count
            FROM contracts c
            LEFT JOIN tenants t ON t.id::text = c.tenant_id::text
            WHERE c.deleted_at IS NULL
              AND c.start_date >= $1
            ORDER BY c.start_date DESC
        `;
        const result = await dbQuery(sql, [dateFrom]);
        return result.rows;
    };

    app.get('/reports/financial', requireAuth, requireReportAccess, asyncHandler(async (request, response) => {
        const { dateFrom } = parseDateRange(request.query);
        const rows = await fetchFinancial(dateFrom);
        response.json({ items: rows, total: rows.length });
    }));

    app.get('/reports/financial/export-xlsx', requireAuth, requireReportAccess, asyncHandler(async (request, response) => {
        const { dateFrom } = parseDateRange(request.query);
        const rows = await fetchFinancial(dateFrom);
        await sendXlsxResponse(response, 'financial_report', [
            { header: 'ID', key: 'id', width: 38 },
            { header: 'Номер', key: 'number', width: 20 },
            { header: 'Тип', key: 'type', width: 16 },
            { header: 'Статус', key: 'status', width: 16 },
            { header: 'Дата начала', key: 'start_date', width: 14 },
            { header: 'Дата окончания', key: 'end_date', width: 14 },
            { header: 'Контрагент', key: 'tenant_name', width: 30 },
            { header: 'Кол-во заявок', key: 'request_count', width: 14 },
        ], rows.map((r) => ({
            id: String(r.id ?? ''),
            number: String(r.number ?? ''),
            type: String(r.type ?? ''),
            status: String(r.status ?? ''),
            start_date: String(r.start_date ?? ''),
            end_date: String(r.end_date ?? ''),
            tenant_name: String(r.tenant_name ?? ''),
            request_count: String(r.request_count ?? '0'),
        })));
    }));

    // ── Executor Performance Report ──────────────────────────────────

    const fetchExecutors = async (dateFrom, dateTo) => {
        const sql = `
            SELECT u.id, u.full_name, u.email, u.role,
              (SELECT count(*) FROM requests r WHERE u.id::text = ANY(r.executor_ids) AND r.deleted_at IS NULL AND r.created_at >= $1 AND r.created_at <= $2) as total_requests,
              (SELECT count(*) FROM requests r WHERE u.id::text = ANY(r.executor_ids) AND r.status IN ('done','closed') AND r.deleted_at IS NULL AND r.created_at >= $1 AND r.created_at <= $2) as completed_requests
            FROM app_users u
            WHERE u.role IN ('executor','installer','manager','curator')
              AND u.status = 'active'
            ORDER BY u.full_name
        `;
        const result = await dbQuery(sql, [dateFrom, dateTo]);
        return result.rows;
    };

    app.get('/reports/executors', requireAuth, requireReportAccess, asyncHandler(async (request, response) => {
        const { dateFrom, dateTo } = parseDateRange(request.query);
        const rows = await fetchExecutors(dateFrom, dateTo);
        response.json({ items: rows, total: rows.length });
    }));

    app.get('/reports/executors/export-xlsx', requireAuth, requireReportAccess, asyncHandler(async (request, response) => {
        const { dateFrom, dateTo } = parseDateRange(request.query);
        const rows = await fetchExecutors(dateFrom, dateTo);
        await sendXlsxResponse(response, 'executors_report', [
            { header: 'ID', key: 'id', width: 38 },
            { header: 'ФИО', key: 'full_name', width: 30 },
            { header: 'Email', key: 'email', width: 28 },
            { header: 'Роль', key: 'role', width: 16 },
            { header: 'Всего заявок', key: 'total_requests', width: 14 },
            { header: 'Выполнено', key: 'completed_requests', width: 14 },
        ], rows.map((r) => ({
            id: String(r.id ?? ''),
            full_name: String(r.full_name ?? ''),
            email: String(r.email ?? ''),
            role: String(r.role ?? ''),
            total_requests: String(r.total_requests ?? '0'),
            completed_requests: String(r.completed_requests ?? '0'),
        })));
    }));

    // ── Scheduled Reports CRUD ────────────────────────────────────────

    const VALID_FREQUENCIES = new Set(['daily', 'weekly', 'monthly']);
    const VALID_REPORT_TYPES = new Set(['service-requests', 'financial', 'executors']);

    app.get('/reports/scheduled', requireAuth, requireReportAccess, asyncHandler(async (_request, response) => {
        const sql = `
            SELECT id, name, report_type, frequency, recipient_email, filters,
                   is_active, last_sent_at, created_at, updated_at
            FROM scheduled_reports
            WHERE deleted_at IS NULL
            ORDER BY created_at DESC
        `;
        const result = await dbQuery(sql);
        response.json({ items: result.rows });
    }));

    app.post('/reports/scheduled', requireAuth, requireReportAccess, asyncHandler(async (request, response) => {
        const { name, reportType, frequency, recipientEmail, filters } = request.body || {};
        if (!name || typeof name !== 'string' || !name.trim()) {
            throw new ApiError(400, 'VALIDATION', 'name is required');
        }
        if (!reportType || !VALID_REPORT_TYPES.has(reportType)) {
            throw new ApiError(400, 'VALIDATION', 'Invalid reportType');
        }
        if (!frequency || !VALID_FREQUENCIES.has(frequency)) {
            throw new ApiError(400, 'VALIDATION', 'Invalid frequency');
        }
        if (!recipientEmail || typeof recipientEmail !== 'string' || !recipientEmail.trim()) {
            throw new ApiError(400, 'VALIDATION', 'recipientEmail is required');
        }
        const sql = `
            INSERT INTO scheduled_reports (name, report_type, frequency, recipient_email, filters, created_by, schedule, delivery_method)
            VALUES ($1, $2, $3, $4, $5, $6, $3, 'email')
            RETURNING id, name, report_type, frequency, recipient_email, filters, is_active, created_at, updated_at
        `;
        const result = await dbQuery(sql, [
            name.trim(),
            reportType,
            frequency,
            recipientEmail.trim(),
            JSON.stringify(filters || {}),
            request.authUser?.id ?? null,
        ]);
        response.status(201).json(result.rows[0]);
    }));

    app.patch('/reports/scheduled/:id', requireAuth, requireReportAccess, asyncHandler(async (request, response) => {
        const id = parseUuidParam(request.params.id);
        const { name, reportType, frequency, recipientEmail, filters, isActive } = request.body || {};

        const sets: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (name !== undefined) {
            sets.push(`name = $${idx++}`);
            values.push(String(name).trim());
        }
        if (reportType !== undefined) {
            if (!VALID_REPORT_TYPES.has(reportType)) {
                throw new ApiError(400, 'VALIDATION', 'Invalid reportType');
            }
            sets.push(`report_type = $${idx++}`);
            values.push(reportType);
        }
        if (frequency !== undefined) {
            if (!VALID_FREQUENCIES.has(frequency)) {
                throw new ApiError(400, 'VALIDATION', 'Invalid frequency');
            }
            sets.push(`frequency = $${idx++}`);
            values.push(frequency);
        }
        if (recipientEmail !== undefined) {
            sets.push(`recipient_email = $${idx++}`);
            values.push(String(recipientEmail).trim());
        }
        if (filters !== undefined) {
            sets.push(`filters = $${idx++}`);
            values.push(JSON.stringify(filters));
        }
        if (isActive !== undefined) {
            sets.push(`is_active = $${idx++}`);
            values.push(Boolean(isActive));
        }

        if (sets.length === 0) {
            throw new ApiError(400, 'VALIDATION', 'No fields to update');
        }

        sets.push(`updated_at = now()`);
        values.push(id);

        const sql = `
            UPDATE scheduled_reports
            SET ${sets.join(', ')}
            WHERE id = $${idx} AND deleted_at IS NULL
            RETURNING id, name, report_type, frequency, recipient_email, filters, is_active, last_sent_at, created_at, updated_at
        `;
        const result = await dbQuery(sql, values);
        if (result.rows.length === 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Scheduled report not found');
        }
        response.json(result.rows[0]);
    }));

    app.delete('/reports/scheduled/:id', requireAuth, requireReportAccess, asyncHandler(async (request, response) => {
        const id = parseUuidParam(request.params.id);
        const sql = `
            UPDATE scheduled_reports
            SET deleted_at = now(), updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            RETURNING id
        `;
        const result = await dbQuery(sql, [id]);
        if (result.rows.length === 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Scheduled report not found');
        }
        response.json({ success: true });
    }));

    // ── Report Templates ─────────────────────────────────────────────

    app.get('/reports/templates', requireAuth, requireReportAccess, asyncHandler(async (_request, response) => {
        const sql = `
            SELECT id, name, report_type, filters, created_at
            FROM report_templates
            WHERE deleted_at IS NULL
            ORDER BY created_at DESC
        `;
        const result = await dbQuery(sql);
        response.json({ items: result.rows });
    }));

    app.post('/reports/templates', requireAuth, requireReportAccess, asyncHandler(async (request, response) => {
        const { name, reportType, filters } = request.body ?? {};
        if (!name || typeof name !== 'string') {
            throw new ApiError(400, 'VALIDATION', 'name is required');
        }
        const sql = `
            INSERT INTO report_templates (name, report_type, filters, created_by)
            VALUES ($1, $2, $3, $4)
            RETURNING id, name, report_type, filters, created_at
        `;
        const result = await dbQuery(sql, [
            name.trim(),
            reportType || 'service-requests',
            JSON.stringify(filters || {}),
            request.authUser?.id ?? null,
        ]);
        response.status(201).json(result.rows[0]);
    }));

    app.delete('/reports/templates/:id', requireAuth, requireReportAccess, asyncHandler(async (request, response) => {
        const id = parseUuidParam(request.params.id);
        const sql = `
            UPDATE report_templates
            SET deleted_at = now()
            WHERE id = $1 AND deleted_at IS NULL
        `;
        await dbQuery(sql, [id]);
        response.json({ ok: true });
    }));
};
