export const registerMockUsersRoutes = (params) => {
    const { app, requireAuth, requireUserPageAccess, localMockUsers, toLocalMockApiUser, getLocalMockBodyObject, localMockStaffRoles, localMockClientRoles, requireAdminLike, normalizeText, ApiError, randomUUID, localMockUsersByEmail, } = params;
    app.get('/users/me', requireAuth, (request, response) => {
        const user = localMockUsers.find((candidate) => candidate.id === request.authUser.id);
        if (!user) {
            response.status(404).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
            return;
        }
        response.status(200).json(toLocalMockApiUser(user));
    });
    app.patch('/users/me', requireAuth, (request, response) => {
        const user = localMockUsers.find((candidate) => candidate.id === request.authUser.id);
        if (!user) {
            response.status(404).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
            return;
        }
        const body = getLocalMockBodyObject(request.body);
        if (typeof body.fullName === 'string') {
            user.fullName = body.fullName.trim();
        }
        if (body.phone !== undefined) {
            user.phone = typeof body.phone === 'string' ? body.phone.trim() : null;
        }
        response.status(200).json(toLocalMockApiUser(user));
    });
    app.get('/users', requireAuth, requireUserPageAccess, (request, response) => {
        const tab = typeof request.query?.tab === 'string' ? request.query.tab : undefined;
        let filtered = [...localMockUsers];
        if (tab === 'employees') {
            filtered = filtered.filter((user) => localMockStaffRoles.has(user.role) && user.status === 'active');
        }
        else if (tab === 'clients') {
            filtered = filtered.filter((user) => localMockClientRoles.has(user.role) && user.status === 'active');
        }
        else if (tab === 'invitations') {
            filtered = filtered.filter((user) => user.status === 'invited');
        }
        else if (tab === 'deactivated') {
            filtered = filtered.filter((user) => user.status === 'blocked' || user.status === 'deactivated');
        }
        const items = filtered.map(toLocalMockApiUser);
        response.status(200).json({
            users: items,
            items,
            total: items.length,
            page: 1,
            pageSize: 20,
        });
    });
    app.post('/users/email-login-token', requireAuth, requireAdminLike, (_request, response) => {
        response.status(202).json({ status: 'accepted' });
    });
    app.post('/users', requireAuth, requireAdminLike, (request, response) => {
        const body = getLocalMockBodyObject(request.body);
        const role = normalizeText(body.role);
        if (request.authUser?.role === 'manager' && role === 'admin') {
            throw new ApiError(403, 'FORBIDDEN', 'Manager cannot create admin users');
        }
        const nextUser = {
            id: randomUUID(),
            fullName: normalizeText(body.fullName) || 'Local User',
            email: normalizeText(body.email) || `${randomUUID()}@example.local`,
            phone: normalizeText(body.phone) || null,
            role: role || 'executor',
            status: normalizeText(body.status) || 'invited',
            bindings: body.bindings && typeof body.bindings === 'object' ? body.bindings : {},
            createdAt: new Date().toISOString(),
        };
        localMockUsers.push(nextUser);
        localMockUsersByEmail.set(nextUser.email.toLowerCase(), nextUser);
        response.status(201).json(toLocalMockApiUser(nextUser));
    });
    app.patch('/users/:userId', requireAuth, requireAdminLike, (request, response) => {
        const userId = normalizeText(request.params.userId);
        const body = getLocalMockBodyObject(request.body);
        const user = localMockUsers.find((candidate) => candidate.id === userId);
        if (!user) {
            throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
        }
        const requestedRole = normalizeText(body.role);
        if (request.authUser?.role === 'manager' && (user.role === 'admin' || requestedRole === 'admin')) {
            throw new ApiError(403, 'FORBIDDEN', 'Manager cannot manage admin users');
        }
        if (typeof body.fullName === 'string') {
            user.fullName = body.fullName.trim();
        }
        if (typeof body.phone === 'string' || body.phone === null) {
            user.phone = typeof body.phone === 'string' ? body.phone.trim() : null;
        }
        if (requestedRole) {
            user.role = requestedRole;
        }
        if (typeof body.status === 'string' && body.status.trim().length > 0) {
            user.status = body.status.trim();
        }
        if (body.bindings && typeof body.bindings === 'object') {
            user.bindings = body.bindings;
        }
        response.status(200).json(toLocalMockApiUser(user));
    });
    app.delete('/users/:userId', requireAuth, requireAdminLike, (request, response) => {
        const userId = normalizeText(request.params.userId);
        if (request.authUser?.id === userId) {
            throw new ApiError(403, 'SELF_DELETE_FORBIDDEN', 'Cannot delete your own account');
        }
        const user = localMockUsers.find((candidate) => candidate.id === userId);
        if (!user) {
            throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
        }
        if (request.authUser?.role === 'manager' && user.role === 'admin') {
            throw new ApiError(403, 'FORBIDDEN', 'Manager cannot delete admin users');
        }
        const index = localMockUsers.findIndex((candidate) => candidate.id === userId);
        if (index >= 0) {
            localMockUsers.splice(index, 1);
        }
        localMockUsersByEmail.delete(user.email.toLowerCase());
        response.status(204).send();
    });
    app.post('/users/invitations', requireAuth, requireAdminLike, (_request, response) => {
        response.status(202).json({ status: 'accepted' });
    });
};
export const registerMockUserAuditRoutes = (params) => {
    const { app, requireAuth, } = params;
    app.get('/audit/users', requireAuth, (_request, response) => {
        response.status(200).json({
            events: [],
            items: [],
            total: 0,
            page: 1,
            pageSize: 20,
        });
    });
};
export const registerUsersRoutes = (params) => {
    const { app, requireAuth, asyncHandler, ApiError, getUserById, requireCsrfToken, updateUser, getRequestMeta, requireUserPageAccess, listUsersQuerySchema, listUsers, requireAdminLike, emailLoginRequestSchema, requestEmailLoginToken, createUserSchema, hashPassword, createOpaqueToken, createUser, buildInitialBindings, updateUserSchema, parseUuidPath, deleteUser, sendInviteSchema, sendInvite, acceptInviteSchema, publicLimiter, acceptInvite, auditQuerySchema, listUserAudit, resolveStreamAuthUser, subscribeUserAuditEvent, toCsvCell, dbQuery, } = params;
    app.get('/users/export', requireAuth, requireAdminLike, asyncHandler(async (_request, response) => {
        const result = await dbQuery(`SELECT id, full_name, email, role, status, created_at FROM app_users ORDER BY created_at DESC`);
        const csvRows = result.rows.map((row) => [
            toCsvCell(row.id),
            toCsvCell(row.full_name),
            toCsvCell(row.email),
            toCsvCell(row.role),
            toCsvCell(row.status),
            toCsvCell(row.created_at ? String(row.created_at).slice(0, 10) : ''),
        ].join(','));
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
        response.status(200).send(`\uFEFFid,fullName,email,role,status,createdAt\n${csvRows.join('\n')}`);
    }));
    app.get('/users/export-xlsx', requireAuth, requireAdminLike, asyncHandler(async (_request, response) => {
        const result = await dbQuery(`SELECT id, full_name, email, role, status, created_at FROM app_users ORDER BY created_at DESC`);
        const { sendXlsxResponse } = await import('../helpers/xlsxHelpers.js');
        await sendXlsxResponse(response, 'users', [
            { header: 'ID', key: 'id', width: 38 },
            { header: 'Имя', key: 'fullName', width: 30 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Роль', key: 'role', width: 18 },
            { header: 'Статус', key: 'status', width: 14 },
            { header: 'Создан', key: 'createdAt', width: 14 },
        ], result.rows.map((row) => ({
            id: String(row.id ?? ''),
            fullName: String(row.full_name ?? ''),
            email: String(row.email ?? ''),
            role: String(row.role ?? ''),
            status: String(row.status ?? ''),
            createdAt: row.created_at ? String(row.created_at).slice(0, 10) : '',
        })));
    }));
    app.get('/users/me', requireAuth, asyncHandler(async (request, response) => {
        const user = await getUserById(request.authUser.id);
        if (!user) {
            throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
        }
        response.status(200).json(user);
    }));
    app.patch('/users/me', requireAuth, requireCsrfToken, asyncHandler(async (request, response) => {
        const body = request.body;
        const user = await updateUser(request.authUser.id, request.authUser.id, {
            fullName: body?.fullName,
            phone: body?.phone,
        }, getRequestMeta(request));
        response.status(200).json(user);
    }));
    app.get('/users', requireAuth, requireUserPageAccess, asyncHandler(async (request, response) => {
        const query = listUsersQuerySchema.parse(request.query);
        const page = await listUsers({
            tab: query.tab,
            q: query.q,
            role: query.role,
            status: query.status,
            sort: query.sort,
            order: query.order,
            page: query.page ?? 1,
            pageSize: query.pageSize ?? 20,
            actorRole: request.authUser?.role,
            actorUserId: request.authUser?.id,
        });
        response.status(200).json(page);
    }));
    app.post('/users/email-login-token', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        if (request.authUser.role !== 'admin') {
            throw new ApiError(403, 'FORBIDDEN', 'Only admin can send login token');
        }
        const body = emailLoginRequestSchema.parse(request.body);
        const result = await requestEmailLoginToken({
            email: body.email,
            actorUserId: request.authUser.id,
            meta: getRequestMeta(request),
            hideUserNotFound: false,
        });
        if (result.debugToken) {
            response.status(202).json({ status: 'accepted', debugToken: result.debugToken });
            return;
        }
        response.status(202).json({ status: 'accepted' });
    }));
    app.post('/users', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        const body = createUserSchema.parse(request.body);
        if (request.authUser.role === 'manager' && body.role === 'admin') {
            throw new ApiError(403, 'FORBIDDEN', 'Manager cannot create admin users');
        }
        const tempPasswordHash = await hashPassword(createOpaqueToken());
        const user = await createUser(request.authUser.id, {
            fullName: body.fullName,
            email: body.email,
            phone: body.phone ?? null,
            role: body.role,
            status: body.status,
            passwordHash: tempPasswordHash,
            mustChangePassword: true,
            bindings: buildInitialBindings(body.bindings),
        }, getRequestMeta(request));
        response.status(201).json(user);
    }));
    app.patch('/users/:userId', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        const userId = parseUuidPath(request.params.userId);
        const body = updateUserSchema.parse(request.body);
        const existing = await getUserById(userId);
        if (!existing) {
            throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
        }
        if (request.authUser.role === 'manager') {
            if (existing.role === 'admin' || body.role === 'admin') {
                throw new ApiError(403, 'FORBIDDEN', 'Manager cannot manage admin users');
            }
        }
        const user = await updateUser(request.authUser.id, userId, {
            fullName: body.fullName,
            phone: body.phone,
            role: body.role,
            status: body.status,
            bindings: body.bindings ? buildInitialBindings(body.bindings) : undefined,
        }, getRequestMeta(request));
        response.status(200).json(user);
    }));
    app.delete('/users/:userId', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        const userId = parseUuidPath(request.params.userId);
        if (request.authUser.id === userId) {
            throw new ApiError(403, 'SELF_DELETE_FORBIDDEN', 'Cannot delete your own account');
        }
        const existing = await getUserById(userId);
        if (!existing) {
            throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
        }
        if (request.authUser.role === 'manager' && existing.role === 'admin') {
            throw new ApiError(403, 'FORBIDDEN', 'Manager cannot delete admin users');
        }
        await deleteUser(request.authUser.id, userId, getRequestMeta(request));
        response.status(204).send();
    }));
    app.post('/users/invitations', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        const body = sendInviteSchema.parse(request.body);
        const targetUser = await getUserById(body.userId);
        if (!targetUser) {
            throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
        }
        if (request.authUser.role === 'manager' && targetUser.role === 'admin') {
            throw new ApiError(403, 'FORBIDDEN', 'Manager cannot send invites to admin users');
        }
        const result = await sendInvite({
            actorUserId: request.authUser.id,
            userId: body.userId,
            expiresInHours: body.expiresInHours,
            meta: getRequestMeta(request),
        });
        if (result.debugToken) {
            response.status(202).json({ status: 'accepted', debugToken: result.debugToken });
            return;
        }
        response.status(202).json({ status: 'accepted' });
    }));
    app.post('/users/invitations/accept', publicLimiter, asyncHandler(async (request, response) => {
        const body = acceptInviteSchema.parse(request.body);
        await acceptInvite({
            token: body.token,
            password: body.password,
            meta: getRequestMeta(request),
        });
        response.status(204).send();
    }));
    app.get('/audit/users', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        const query = auditQuerySchema.parse(request.query);
        const result = await listUserAudit({
            userId: query.userId,
            action: query.action,
            page: query.page ?? 1,
            pageSize: query.pageSize ?? 20,
        });
        response.status(200).json(result);
    }));
    app.get('/audit/users/stream', asyncHandler(async (request, response) => {
        request.authUser = resolveStreamAuthUser(request);
        response.status(200);
        response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache, no-transform');
        response.setHeader('Connection', 'keep-alive');
        response.setHeader('X-Accel-Buffering', 'no');
        if (typeof response.flushHeaders === 'function') {
            response.flushHeaders();
        }
        const pushEvent = (eventName, payload) => {
            if (response.writableEnded) {
                return;
            }
            response.write(`event: ${eventName}\n`);
            response.write(`data: ${JSON.stringify(payload)}\n\n`);
        };
        pushEvent('ready', { ok: true, timestamp: new Date().toISOString() });
        const unsubscribe = subscribeUserAuditEvent((payload) => {
            pushEvent('user_audit', payload);
        });
        const heartbeat = setInterval(() => {
            if (response.writableEnded) {
                return;
            }
            response.write(': ping\n\n');
        }, 25000);
        request.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
        });
    }));
};
