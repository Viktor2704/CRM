export const registerMockCalendarRoutes = (params) => {
    const { app, requireAuth, normalizeText, generateIcsEvent, wrapIcsCalendar, sendIcsResponse, localMockDirections, } = params;
    app.get('/calendar/projects/:projectId.ics', requireAuth, (request, response) => {
        const event = generateIcsEvent({
            uid: request.params.projectId,
            summary: 'Проект - Mock',
            description: '',
            location: '',
            dtstart: new Date().toISOString(),
            dtend: new Date(Date.now() + 30 * 86400000).toISOString(),
        });
        sendIcsResponse(response, wrapIcsCalendar(event), `project-${request.params.projectId}.ics`);
    });
    app.get('/calendar/installations/:installationId.ics', requireAuth, (request, response) => {
        const event = generateIcsEvent({
            uid: request.params.installationId,
            summary: 'Монтаж - Mock',
            description: '',
            location: '',
            dtstart: new Date().toISOString(),
            dtend: new Date(Date.now() + 14 * 86400000).toISOString(),
        });
        sendIcsResponse(response, wrapIcsCalendar(event), `install-${request.params.installationId}.ics`);
    });
    app.get('/calendar/directions/:directionId.ics', requireAuth, (request, response) => {
        const direction = localMockDirections.find((candidate) => candidate.id === request.params.directionId) ?? localMockDirections[0] ?? null;
        const event = generateIcsEvent({
            uid: request.params.directionId,
            summary: `Направление - ${normalizeText(direction?.name) || 'Северное'}`,
            description: 'Все ТО',
            location: normalizeText(direction?.address),
            dtstart: new Date().toISOString(),
        });
        sendIcsResponse(response, wrapIcsCalendar(event), `direction-${request.params.directionId}.ics`);
    });
    app.get('/calendar/user.ics', requireAuth, (_request, response) => {
        const event = generateIcsEvent({
            uid: 'user-mock-1',
            summary: 'ТО - Северное',
            description: '',
            location: '',
            dtstart: new Date(Date.now() + 86400000).toISOString(),
        });
        sendIcsResponse(response, wrapIcsCalendar(event), 'my-calendar.ics');
    });
};
export const registerCalendarRoutes = (params) => {
    const { app, requireAuth, asyncHandler, ensureProjectSchema, ensureDirectionSchema, ensureMaintenanceSchema, ensureMaintenanceItemSchema, ApiError, dbQuery, normalizeText, isUuidValue, parseUuidPath, randomUUID, generateIcsEvent, wrapIcsCalendar, sendIcsResponse, } = params;
    app.get('/calendar/projects/:projectId.ics', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const projectId = parseUuidPath(request.params.projectId);
        const result = await dbQuery(`select *
     from requests
     where id = $1::uuid
       and coalesce(is_project, false) = true
       and deleted_at is null
     limit 1`, [projectId]);
        if (result.rows.length === 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Project not found');
        }
        const project = result.rows[0];
        const event = generateIcsEvent({
            uid: projectId,
            summary: `Проект: ${normalizeText(project.title)}`,
            description: normalizeText(project.description),
            location: '',
            dtstart: project.created_at ? new Date(project.created_at).toISOString() : new Date().toISOString(),
            dtend: project.due_date_preliminary
                ? new Date(project.due_date_preliminary).toISOString()
                : (project.due_date_admin ? new Date(project.due_date_admin).toISOString() : undefined),
        });
        sendIcsResponse(response, wrapIcsCalendar(event), `project-${projectId}.ics`);
    }));
    app.get('/calendar/installations/:installationId.ics', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const installationId = parseUuidPath(request.params.installationId);
        const result = await dbQuery(`select *
     from requests
     where id = $1::uuid
       and type = 'installation'
       and coalesce(is_project, false) = false
       and deleted_at is null
     limit 1`, [installationId]);
        if (result.rows.length === 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Installation not found');
        }
        const installation = result.rows[0];
        const event = generateIcsEvent({
            uid: installationId,
            summary: `Монтаж: ${normalizeText(installation.title)}`,
            description: normalizeText(installation.description),
            location: '',
            dtstart: installation.created_at ? new Date(installation.created_at).toISOString() : new Date().toISOString(),
            dtend: installation.due_date_preliminary
                ? new Date(installation.due_date_preliminary).toISOString()
                : (installation.due_date_admin ? new Date(installation.due_date_admin).toISOString() : undefined),
        });
        sendIcsResponse(response, wrapIcsCalendar(event), `install-${installationId}.ics`);
    }));
    app.get('/calendar/directions/:directionId.ics', requireAuth, asyncHandler(async (request, response) => {
        await ensureDirectionSchema();
        await ensureMaintenanceSchema();
        await ensureMaintenanceItemSchema();
        const directionId = parseUuidPath(request.params.directionId);
        const directionResult = await dbQuery(`select
       name,
       address
     from directions
     where id = $1::uuid
       and deleted_at is null
     limit 1`, [directionId]);
        if (directionResult.rows.length === 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Direction not found');
        }
        const direction = directionResult.rows[0];
        const plansResult = await dbQuery(`select distinct
       mp.id::text as id,
       mp.valid_from,
       mp.system_type
     from maintenance_plans mp
     join maintenance_items mi on mi.id::text = any(mp.maintenance_item_ids)
     where mi.direction_id::text = $1::text
       and mi.deleted_at is null
       and mp.is_active = true
     order by mp.valid_from asc nulls last`, [directionId]);
        const events = plansResult.rows.map((plan) => generateIcsEvent({
            uid: normalizeText(plan.id) || randomUUID(),
            summary: `ТО - ${normalizeText(direction.name)} (${normalizeText(plan.system_type) || 'system'})`,
            description: '',
            location: normalizeText(direction.address),
            dtstart: plan.valid_from ? new Date(plan.valid_from).toISOString() : new Date().toISOString(),
        }));
        if (events.length === 0) {
            events.push(generateIcsEvent({
                uid: `direction-${directionId}`,
                summary: `Направление - ${normalizeText(direction.name)}`,
                description: 'Календарь ТО',
                location: normalizeText(direction.address),
                dtstart: new Date().toISOString(),
            }));
        }
        sendIcsResponse(response, wrapIcsCalendar(events.join('\r\n')), `direction-${directionId}.ics`);
    }));
    app.get('/calendar/user.ics', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        await ensureMaintenanceSchema();
        const userId = normalizeText(request.authUser?.id);
        if (!isUuidValue(userId)) {
            throw new ApiError(403, 'FORBIDDEN', 'Not allowed');
        }
        const projects = await dbQuery(`select
       id::text as id,
       title,
       description,
       created_at,
       due_date_preliminary,
       due_date_admin
     from requests
     where (created_by_id = $1::text or $1::text = any(coalesce(executor_ids, '{}'::text[])))
       and coalesce(is_project, false) = true
       and deleted_at is null
     order by created_at desc
     limit 100`, [userId]);
        const installations = await dbQuery(`select
       id::text as id,
       title,
       description,
       created_at,
       due_date_preliminary,
       due_date_admin
     from requests
     where (created_by_id = $1::text or $1::text = any(coalesce(executor_ids, '{}'::text[])))
       and type = 'installation'
       and coalesce(is_project, false) = false
       and deleted_at is null
     order by created_at desc
     limit 100`, [userId]);
        const plans = await dbQuery(`select
       id::text as id,
       valid_from,
       system_type
     from maintenance_plans
     where $1::text = any(coalesce(default_executor_ids, '{}'::text[]))
       and is_active = true
     order by valid_from asc
     limit 100`, [userId]);
        const events = [];
        for (const project of projects.rows) {
            events.push(generateIcsEvent({
                uid: `proj-${normalizeText(project.id)}`,
                summary: `Проект: ${normalizeText(project.title)}`,
                description: normalizeText(project.description),
                location: '',
                dtstart: project.created_at ? new Date(project.created_at).toISOString() : new Date().toISOString(),
                dtend: project.due_date_preliminary
                    ? new Date(project.due_date_preliminary).toISOString()
                    : (project.due_date_admin ? new Date(project.due_date_admin).toISOString() : undefined),
            }));
        }
        for (const installation of installations.rows) {
            events.push(generateIcsEvent({
                uid: `inst-${normalizeText(installation.id)}`,
                summary: `Монтаж: ${normalizeText(installation.title)}`,
                description: normalizeText(installation.description),
                location: '',
                dtstart: installation.created_at ? new Date(installation.created_at).toISOString() : new Date().toISOString(),
                dtend: installation.due_date_preliminary
                    ? new Date(installation.due_date_preliminary).toISOString()
                    : (installation.due_date_admin ? new Date(installation.due_date_admin).toISOString() : undefined),
            }));
        }
        for (const plan of plans.rows) {
            events.push(generateIcsEvent({
                uid: `plan-${normalizeText(plan.id)}`,
                summary: `ТО (${normalizeText(plan.system_type) || 'system'})`,
                description: '',
                location: '',
                dtstart: plan.valid_from ? new Date(plan.valid_from).toISOString() : new Date().toISOString(),
            }));
        }
        // Visit dates for service requests assigned to user
        const visits = await dbQuery(`select
       id::text as id,
       title,
       visit_date
     from requests
     where (created_by_id = $1::text or $1::text = any(coalesce(executor_ids, '{}'::text[])))
       and visit_date is not null
       and deleted_at is null
     order by visit_date asc
     limit 100`, [userId]);
        for (const visit of visits.rows) {
            events.push(generateIcsEvent({
                uid: `visit-${normalizeText(visit.id)}`,
                summary: `Выезд: ${normalizeText(visit.title)}`,
                description: '',
                location: '',
                dtstart: new Date(visit.visit_date).toISOString(),
            }));
        }
        sendIcsResponse(response, wrapIcsCalendar(events.join('\r\n')), 'my-calendar.ics');
    }));
    app.get('/calendar/events', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        await ensureMaintenanceSchema();
        const fromRaw = normalizeText(typeof request.query?.from === 'string' ? request.query.from : '');
        const toRaw = normalizeText(typeof request.query?.to === 'string' ? request.query.to : '');
        const fromDate = fromRaw && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : null;
        const toDate = toRaw && /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : null;
        const calEvents = [];
        const fmtDate = (v) => {
            if (!v)
                return null;
            if (v instanceof Date)
                return v.toISOString().slice(0, 10);
            const s = String(v);
            if (/^\d{4}-\d{2}-\d{2}/.test(s))
                return s.slice(0, 10);
            const d = new Date(s);
            return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
        };
        // Maintenance plan events
        try {
            const mpResult = await dbQuery(`
            SELECT mp.id::text, mp.system_type, mp.frequency, mp.day_of_month,
                   mp.valid_from, mp.valid_to, mp.contact_person,
                   d.name as direction_name
            FROM maintenance_plans mp
            LEFT JOIN maintenance_items mi ON mi.id::text = ANY(mp.maintenance_item_ids)
            LEFT JOIN directions d ON d.id = mi.direction_id
            WHERE mp.is_active = true
            ${fromDate ? `AND (mp.valid_to IS NULL OR mp.valid_to >= $1::date)` : ''}
            ${toDate ? `AND (mp.valid_from IS NULL OR mp.valid_from <= $${fromDate ? 2 : 1}::date)` : ''}
            GROUP BY mp.id, mp.system_type, mp.frequency, mp.day_of_month,
                     mp.valid_from, mp.valid_to, mp.contact_person, d.name
            ORDER BY mp.day_of_month ASC
        `, [fromDate, toDate].filter(Boolean));
            for (const row of mpResult.rows) {
                calEvents.push({
                    id: `mp-${row.id}`,
                    type: 'maintenance',
                    title: `ТО: ${normalizeText(row.system_type) || 'Система'} — ${normalizeText(row.direction_name) || 'Направление'}`,
                    date: fmtDate(row.valid_from),
                    endDate: fmtDate(row.valid_to),
                    meta: {
                        systemType: normalizeText(row.system_type),
                        frequency: normalizeText(row.frequency),
                        dayOfMonth: row.day_of_month,
                        contactPerson: normalizeText(row.contact_person),
                        directionName: normalizeText(row.direction_name),
                    },
                    entityId: row.id,
                    entityType: 'maintenance_plan',
                    color: 'blue',
                });
            }
        }
        catch (err) { /* best effort */ }
        // Service request deadlines
        try {
            const srResult = await dbQuery(`
            SELECT id::text, title, status, priority, due_date_preliminary, created_at
            FROM requests
            WHERE deleted_at IS NULL
              AND due_date_preliminary IS NOT NULL
              AND (type IS NULL OR type != 'installation')
              AND coalesce(is_project, false) = false
              ${fromDate ? `AND due_date_preliminary >= $1::date` : ''}
              ${toDate ? `AND due_date_preliminary <= $${fromDate ? 2 : 1}::date` : ''}
            ORDER BY due_date_preliminary ASC
            LIMIT 200
        `, [fromDate, toDate].filter(Boolean));
            for (const row of srResult.rows) {
                calEvents.push({
                    id: `sr-${row.id}`,
                    type: 'service_request',
                    title: normalizeText(row.title) || 'Заявка',
                    date: fmtDate(row.due_date_preliminary),
                    meta: { status: normalizeText(row.status), priority: normalizeText(row.priority) },
                    entityId: row.id,
                    entityType: 'service_request',
                    color: row.priority === 'critical' ? 'red' : row.priority === 'high' ? 'orange' : 'yellow',
                });
            }
        }
        catch { /* best effort */ }
        // Service request visit dates
        try {
            const visitResult = await dbQuery(`
            SELECT id::text, title, status, priority, visit_date
            FROM requests
            WHERE deleted_at IS NULL
              AND visit_date IS NOT NULL
              AND (type IS NULL OR type != 'installation')
              AND coalesce(is_project, false) = false
              ${fromDate ? `AND visit_date >= $1::date` : ''}
              ${toDate ? `AND visit_date <= $${fromDate ? 2 : 1}::date` : ''}
            ORDER BY visit_date ASC
            LIMIT 200
        `, [fromDate, toDate].filter(Boolean));
            for (const row of visitResult.rows) {
                calEvents.push({
                    id: `visit-${row.id}`,
                    type: 'visit',
                    title: `Выезд: ${normalizeText(row.title) || 'Заявка'}`,
                    date: fmtDate(row.visit_date),
                    meta: { status: normalizeText(row.status), priority: normalizeText(row.priority) },
                    entityId: row.id,
                    entityType: 'service_request',
                    color: 'green',
                });
            }
        }
        catch { /* best effort */ }
        // Project deadlines and installations
        try {
            const prResult = await dbQuery(`
            SELECT id::text, title, status, type, is_project, due_date_preliminary, due_date_admin
            FROM requests
            WHERE deleted_at IS NULL
              AND (due_date_preliminary IS NOT NULL OR due_date_admin IS NOT NULL)
              AND (coalesce(is_project, false) = true OR type = 'installation')
              ${fromDate ? `AND coalesce(due_date_admin, due_date_preliminary) >= $1::date` : ''}
              ${toDate ? `AND coalesce(due_date_admin, due_date_preliminary) <= $${fromDate ? 2 : 1}::date` : ''}
            ORDER BY coalesce(due_date_admin, due_date_preliminary) ASC
            LIMIT 200
        `, [fromDate, toDate].filter(Boolean));
            for (const row of prResult.rows) {
                const date = row.due_date_admin || row.due_date_preliminary;
                const isProject = row.is_project === true;
                const isInstallation = !isProject && normalizeText(row.type) === 'installation';
                calEvents.push({
                    id: `${isInstallation ? 'inst' : 'pr'}-${row.id}`,
                    type: isInstallation ? 'installation' : 'project',
                    title: `${isInstallation ? 'Монтаж' : 'Проект'}: ${normalizeText(row.title) || 'Без названия'}`,
                    date: fmtDate(date),
                    meta: { status: normalizeText(row.status) },
                    entityId: row.id,
                    entityType: isInstallation ? 'installation' : 'project',
                    color: isInstallation ? 'orange' : 'purple',
                });
            }
        }
        catch { /* best effort */ }
        // Custom user events (calendar_events table if exists)
        try {
            await dbQuery(`CREATE TABLE IF NOT EXISTS calendar_events (
            id uuid primary key default gen_random_uuid(),
            user_id uuid not null,
            title text not null default '',
            description text not null default '',
            event_date date not null,
            color text not null default 'green',
            created_at timestamptz not null default now(),
            deleted_at timestamptz
        )`);
            const userId = normalizeText(request.authUser?.id);
            const ceResult = await dbQuery(`
            SELECT id::text, title, description, event_date, color
            FROM calendar_events
            WHERE deleted_at IS NULL AND user_id = $1::uuid
              ${fromDate ? `AND event_date >= $2::date` : ''}
              ${toDate ? `AND event_date <= $${fromDate ? 3 : 2}::date` : ''}
            ORDER BY event_date ASC
        `, [userId, fromDate, toDate].filter(Boolean));
            for (const row of ceResult.rows) {
                calEvents.push({
                    id: `ce-${row.id}`,
                    type: 'custom',
                    title: normalizeText(row.title),
                    date: fmtDate(row.event_date),
                    meta: { description: normalizeText(row.description) },
                    entityId: row.id,
                    entityType: 'calendar_event',
                    color: normalizeText(row.color) || 'green',
                });
            }
        }
        catch { /* best effort */ }
        response.status(200).json({ events: calEvents });
    }));
    app.post('/calendar/events', requireAuth, asyncHandler(async (request, response) => {
        const userId = normalizeText(request.authUser?.id);
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const title = normalizeText(body.title);
        const description = normalizeText(body.description ?? '');
        const eventDate = normalizeText(body.eventDate);
        const color = normalizeText(body.color ?? 'green');
        if (!title)
            throw new ApiError(400, 'VALIDATION_ERROR', 'title обязателен');
        if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate))
            throw new ApiError(400, 'VALIDATION_ERROR', 'eventDate обязателен (YYYY-MM-DD)');
        await dbQuery(`CREATE TABLE IF NOT EXISTS calendar_events (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        title text not null default '',
        description text not null default '',
        event_date date not null,
        color text not null default 'green',
        created_at timestamptz not null default now(),
        deleted_at timestamptz
    )`);
        const result = await dbQuery(`INSERT INTO calendar_events(user_id, title, description, event_date, color) VALUES($1::uuid,$2,$3,$4::date,$5) RETURNING id::text, title, description, event_date, color`, [userId, title, description, eventDate, color]);
        response.status(201).json(result.rows[0]);
    }));
    app.delete('/calendar/events/:eventId', requireAuth, asyncHandler(async (request, response) => {
        const userId = normalizeText(request.authUser?.id);
        const eventId = parseUuidPath(request.params.eventId);
        await dbQuery(`UPDATE calendar_events SET deleted_at = now() WHERE id = $1::uuid AND user_id = $2::uuid`, [eventId, userId]);
        response.status(204).send();
    }));
};
