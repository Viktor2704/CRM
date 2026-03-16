import { appendCalendarRequestScopeCondition, appendMaintenancePlanScopeCondition } from '../helpers/calendarAccess.js';
import { appendDirectionScopeCondition } from '../helpers/directionAccess.js';
import { appendProjectScopeCondition } from '../helpers/projectHelpers.js';

export const registerMockCalendarRoutes = (params) => {
    const {
        app,
        requireAuth,
        randomUUID,
        getLocalMockBodyObject,
        normalizeText,
        generateIcsEvent,
        wrapIcsCalendar,
        sendIcsResponse,
        localMockDirections,
    } = params;
    const localMockCalendarEvents = [
        {
            id: randomUUID(),
            userId: 'local-admin-1',
            title: 'Планерка по объекту',
            description: 'Сверка статусов на неделю',
            eventDate: new Date().toISOString().slice(0, 10),
            color: 'green',
        },
    ];
    const isDateWithinRange = (value, from, to) => {
        if (!value) {
            return false;
        }
        if (from && value < from) {
            return false;
        }
        if (to && value > to) {
            return false;
        }
        return true;
    };
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
    app.get('/calendar/events', requireAuth, (request, response) => {
        const from = normalizeText(request.query?.from);
        const to = normalizeText(request.query?.to);
        const actorUserId = normalizeText(request.authUser?.id);
        const customEvents = localMockCalendarEvents
            .filter((item) => item.userId === actorUserId)
            .filter((item) => isDateWithinRange(item.eventDate, from, to))
            .map((item) => ({
                id: `ce-${item.id}`,
                type: 'custom',
                title: item.title,
                date: item.eventDate,
                meta: { description: item.description },
                entityId: item.id,
                entityType: 'calendar_event',
                color: item.color || 'green',
            }));
        response.status(200).json({ events: customEvents });
    });
    app.post('/calendar/events', requireAuth, (request, response) => {
        const actorUserId = normalizeText(request.authUser?.id);
        const body = getLocalMockBodyObject(request.body);
        const title = normalizeText(body.title);
        const description = normalizeText(body.description);
        const eventDate = normalizeText(body.eventDate);
        const color = normalizeText(body.color) || 'green';
        if (!title) {
            response.status(400).json({ code: 'VALIDATION_ERROR', message: 'title обязателен' });
            return;
        }
        if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
            response.status(400).json({ code: 'VALIDATION_ERROR', message: 'eventDate обязателен (YYYY-MM-DD)' });
            return;
        }
        const item = {
            id: randomUUID(),
            userId: actorUserId,
            title,
            description,
            eventDate,
            color,
        };
        localMockCalendarEvents.push(item);
        response.status(201).json({
            id: item.id,
            title: item.title,
            description: item.description,
            event_date: item.eventDate,
            color: item.color,
        });
    });
    app.delete('/calendar/events/:eventId', requireAuth, (request, response) => {
        const actorUserId = normalizeText(request.authUser?.id);
        const eventId = normalizeText(request.params.eventId);
        const index = localMockCalendarEvents.findIndex((item) => item.id === eventId && item.userId === actorUserId);
        if (index >= 0) {
            localMockCalendarEvents.splice(index, 1);
        }
        response.status(204).send();
    });
};

export const registerCalendarRoutes = (params) => {
    const {
        app,
        requireAuth,
        asyncHandler,
        ensureCalendarSchema,
        ensureProjectSchema,
        ensureDirectionSchema,
        ensureMaintenanceSchema,
        ensureMaintenanceItemSchema,
        ApiError,
        dbQuery,
        normalizeText,
        isUuidValue,
        parseUuidPath,
        randomUUID,
        generateIcsEvent,
        wrapIcsCalendar,
        sendIcsResponse,
    } = params;
    app.get('/calendar/projects/:projectId.ics', requireAuth, asyncHandler(async (request, response) => {
    await ensureProjectSchema();
    const projectId = parseUuidPath(request.params.projectId);
    const actorUserId = normalizeText(request.authUser?.id);
    const actorRole = normalizeText(request.authUser?.role).toLowerCase();
    const conditions = [
        `r.id = $1::uuid`,
        `coalesce(r.is_project, false) = true`,
        `r.deleted_at is null`,
    ];
    const values: unknown[] = [projectId];
    await appendProjectScopeCondition({
        actorUserId,
        actorRole,
        conditions,
        values,
        queryFn: dbQuery,
    });
    const result = await dbQuery(`select r.*
     from requests r
     where ${conditions.join(' and ')}
     limit 1`, values);
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
    const actorUserId = normalizeText(request.authUser?.id);
    const actorRole = normalizeText(request.authUser?.role).toLowerCase();
    const conditions = [
        `r.id = $1::uuid`,
        `r.type = 'installation'`,
        `coalesce(r.is_project, false) = false`,
        `r.deleted_at is null`,
    ];
    const values: unknown[] = [installationId];
    await appendProjectScopeCondition({
        actorUserId,
        actorRole,
        conditions,
        values,
        queryFn: dbQuery,
    });
    const result = await dbQuery(`select r.*
     from requests r
     where ${conditions.join(' and ')}
     limit 1`, values);
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
    const actorUserId = normalizeText(request.authUser?.id);
    const actorRole = normalizeText(request.authUser?.role).toLowerCase();
    const directionConditions = [
        `d.id = $1::uuid`,
        `d.deleted_at is null`,
    ];
    const directionValues: unknown[] = [directionId];
    await appendDirectionScopeCondition({
        actorUserId,
        actorRole,
        conditions: directionConditions,
        values: directionValues,
        queryFn: dbQuery,
        tableAlias: 'd',
        directionIdColumn: 'id',
    });
    const directionResult = await dbQuery(`select
       name,
       address
     from directions d
     where ${directionConditions.join(' and ')}
     limit 1`, directionValues);
    if (directionResult.rows.length === 0) {
        throw new ApiError(404, 'NOT_FOUND', 'Direction not found');
    }
    const direction = directionResult.rows[0];
    const planConditions = [
        `mi.direction_id::text = $1::text`,
        `mi.deleted_at is null`,
        `mp.is_active = true`,
    ];
    const planValues: unknown[] = [directionId];
    appendMaintenancePlanScopeCondition({
        actorUserId,
        actorRole,
        conditions: planConditions,
        values: planValues,
    });
    const plansResult = await dbQuery(`select distinct
       mp.id::text as id,
       mp.valid_from,
       mp.system_type
     from maintenance_plans mp
     join maintenance_items mi on mi.id::text = any(mp.maintenance_item_ids)
     where ${planConditions.join(' and ')}
     order by mp.valid_from asc nulls last`, planValues);
    const events = plansResult.rows.map((plan) => {
        const planStartDate = plan.valid_from ? new Date(plan.valid_from) : null;
        const planDtStart = planStartDate && !Number.isNaN(planStartDate.getTime())
            ? planStartDate.toISOString()
            : new Date().toISOString();
        return generateIcsEvent({
            uid: normalizeText(plan.id) || randomUUID(),
            summary: `ТО - ${normalizeText(direction.name)} (${normalizeText(plan.system_type) || 'system'})`,
            description: '',
            location: normalizeText(direction.address),
            dtstart: planDtStart,
        });
    });
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
    await ensureDirectionSchema();
    const fromRaw = normalizeText(typeof request.query?.from === 'string' ? request.query.from : '');
    const toRaw = normalizeText(typeof request.query?.to === 'string' ? request.query.to : '');
    const fromDate = fromRaw && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : null;
    const toDate = toRaw && /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : null;
    const actorUserId = normalizeText(request.authUser?.id);
    const actorRole = normalizeText(request.authUser?.role).toLowerCase();
    const calEvents: unknown[] = [];
    const fmtDate = (v: unknown): string | null => {
        if (!v) return null;
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        const s = String(v);
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    };
    // Maintenance plan events
    try {
        const mpConditions = [`mp.is_active = true`];
        const mpValues: unknown[] = [];
        if (fromDate) {
            mpValues.push(fromDate);
            mpConditions.push(`(mp.valid_to IS NULL OR mp.valid_to >= $${mpValues.length}::date)`);
        }
        if (toDate) {
            mpValues.push(toDate);
            mpConditions.push(`(mp.valid_from IS NULL OR mp.valid_from <= $${mpValues.length}::date)`);
        }
        appendMaintenancePlanScopeCondition({
            actorUserId,
            actorRole,
            conditions: mpConditions,
            values: mpValues,
        });
        const mpResult = await dbQuery(`
            SELECT mp.id::text, mp.system_type, mp.frequency, mp.day_of_month,
                   mp.valid_from, mp.valid_to, mp.contact_person,
                   d.name as direction_name
            FROM maintenance_plans mp
            LEFT JOIN maintenance_items mi ON mi.id::text = ANY(mp.maintenance_item_ids)
            LEFT JOIN directions d ON d.id = mi.direction_id
            WHERE ${mpConditions.join(' AND ')}
            GROUP BY mp.id, mp.system_type, mp.frequency, mp.day_of_month,
                     mp.valid_from, mp.valid_to, mp.contact_person, d.name
            ORDER BY mp.day_of_month ASC
        `, mpValues);
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
    } catch (err) { /* best effort */ }
    // Service request deadlines
    try {
        const srConditions = [
            `r.deleted_at IS NULL`,
            `r.due_date_preliminary IS NOT NULL`,
            `(r.type IS NULL OR r.type != 'installation')`,
            `coalesce(r.is_project, false) = false`,
        ];
        const srValues: unknown[] = [];
        if (fromDate) {
            srValues.push(fromDate);
            srConditions.push(`r.due_date_preliminary >= $${srValues.length}::date`);
        }
        if (toDate) {
            srValues.push(toDate);
            srConditions.push(`r.due_date_preliminary <= $${srValues.length}::date`);
        }
        await appendCalendarRequestScopeCondition({
            actorUserId,
            actorRole,
            conditions: srConditions,
            values: srValues,
        });
        const srResult = await dbQuery(`
            SELECT id::text, title, status, priority, due_date_preliminary, created_at
            FROM requests r
            WHERE ${srConditions.join(' AND ')}
            ORDER BY due_date_preliminary ASC
            LIMIT 200
        `, srValues);
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
    } catch { /* best effort */ }
    // Service request visit dates
    try {
        const visitConditions = [
            `r.deleted_at IS NULL`,
            `r.visit_date IS NOT NULL`,
            `(r.type IS NULL OR r.type != 'installation')`,
            `coalesce(r.is_project, false) = false`,
        ];
        const visitValues: unknown[] = [];
        if (fromDate) {
            visitValues.push(fromDate);
            visitConditions.push(`r.visit_date >= $${visitValues.length}::date`);
        }
        if (toDate) {
            visitValues.push(toDate);
            visitConditions.push(`r.visit_date <= $${visitValues.length}::date`);
        }
        await appendCalendarRequestScopeCondition({
            actorUserId,
            actorRole,
            conditions: visitConditions,
            values: visitValues,
        });
        const visitResult = await dbQuery(`
            SELECT id::text, title, status, priority, visit_date
            FROM requests r
            WHERE ${visitConditions.join(' AND ')}
            ORDER BY visit_date ASC
            LIMIT 200
        `, visitValues);
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
    } catch { /* best effort */ }
    // Project deadlines and installations
    try {
        const prConditions = [
            `r.deleted_at IS NULL`,
            `(r.due_date_preliminary IS NOT NULL OR r.due_date_admin IS NOT NULL)`,
            `(coalesce(r.is_project, false) = true OR r.type = 'installation')`,
        ];
        const prValues: unknown[] = [];
        if (fromDate) {
            prValues.push(fromDate);
            prConditions.push(`coalesce(r.due_date_admin, r.due_date_preliminary) >= $${prValues.length}::date`);
        }
        if (toDate) {
            prValues.push(toDate);
            prConditions.push(`coalesce(r.due_date_admin, r.due_date_preliminary) <= $${prValues.length}::date`);
        }
        await appendProjectScopeCondition({
            actorUserId,
            actorRole,
            conditions: prConditions,
            values: prValues,
            queryFn: dbQuery,
        });
        const prResult = await dbQuery(`
            SELECT r.id::text, r.title, r.status, r.type, r.is_project, r.due_date_preliminary, r.due_date_admin
            FROM requests r
            WHERE ${prConditions.join(' AND ')}
            ORDER BY coalesce(due_date_admin, due_date_preliminary) ASC
            LIMIT 200
        `, prValues);
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
    } catch { /* best effort */ }
    // Custom user events (calendar_events table if exists)
    try {
        await ensureCalendarSchema();
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
    } catch { /* best effort */ }
    response.status(200).json({ events: calEvents });
    }));
    app.post('/calendar/events', requireAuth, asyncHandler(async (request, response) => {
    const userId = normalizeText(request.authUser?.id);
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const title = normalizeText(body.title);
    const description = normalizeText(body.description ?? '');
    const eventDate = normalizeText(body.eventDate);
    const color = normalizeText(body.color ?? 'green');
    if (!title) throw new ApiError(400, 'VALIDATION_ERROR', 'title обязателен');
    if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw new ApiError(400, 'VALIDATION_ERROR', 'eventDate обязателен (YYYY-MM-DD)');
    await ensureCalendarSchema();
    const result = await dbQuery(`INSERT INTO calendar_events(user_id, title, description, event_date, color) VALUES($1::uuid,$2,$3,$4::date,$5) RETURNING id::text, title, description, event_date, color`, [userId, title, description, eventDate, color]);
    response.status(201).json(result.rows[0]);
    }));
    app.delete('/calendar/events/:eventId', requireAuth, asyncHandler(async (request, response) => {
    const userId = normalizeText(request.authUser?.id);
    const eventId = parseUuidPath(request.params.eventId);
    await ensureCalendarSchema();
    await dbQuery(`UPDATE calendar_events SET deleted_at = now() WHERE id = $1::uuid AND user_id = $2::uuid`, [eventId, userId]);
    response.status(204).send();
    }));
};
