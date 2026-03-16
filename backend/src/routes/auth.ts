const buildMockAccountStatusError = (ApiError, user) => {
    if (user.status === 'blocked' || user.status === 'deactivated') {
        return new ApiError(403, 'ACCOUNT_DISABLED', 'Account is disabled');
    }
    if (user.status === 'invited') {
        if (user.mustChangePassword) {
            return new ApiError(403, 'INVITE_PENDING', 'Invitation must be accepted first');
        }
        return new ApiError(403, 'ACCOUNT_PENDING_APPROVAL', 'Account is pending admin approval');
    }
    return null;
};
export const registerMockAuthRoutes = (params) => {
    const {
        app,
        authLimiter,
        asyncHandler,
        loginSchema,
        emailLoginRequestSchema,
        emailLoginConfirmSchema,
        passwordResetRequestSchema,
        passwordResetConfirmSchema,
        requireCsrfToken,
        localMockUsersByEmail,
        ApiError,
        localMockRefreshTokens,
        localMockUsers,
        createLocalMockSession,
        setRefreshCookie,
        setCsrfCookie,
        createOpaqueToken,
        appConfig,
        clearCsrfCookie,
        clearRefreshCookie,
    } = params;
    const localMockPasswords = new Map(localMockUsers.map((user) => [user.id, 'test']));
    const localMockEmailLoginTokens = new Map();
    const localMockPasswordResetTokens = new Map();
    const issueMockToken = (store, user, ttlMs) => {
        for (const [token, state] of store.entries()) {
            if (state.userId === user.id) {
                store.delete(token);
            }
        }
        const token = createOpaqueToken();
        store.set(token, {
            userId: user.id,
            email: user.email,
            expiresAt: Date.now() + ttlMs,
            usedAt: null,
        });
        return token;
    };
    const revokeMockRefreshTokensForUser = (userId) => {
        for (const [token, state] of localMockRefreshTokens.entries()) {
            if (state.userId === userId) {
                localMockRefreshTokens.delete(token);
            }
        }
    };
    app.post('/auth/login', authLimiter, asyncHandler(async (request, response) => {
        const body = loginSchema.parse(request.body);
        const user = localMockUsersByEmail.get(body.email.trim().toLowerCase());
        if (!user) {
            throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
        }
        const statusError = buildMockAccountStatusError(ApiError, user);
        if (statusError) {
            throw statusError;
        }
        if ((localMockPasswords.get(user.id) || 'test') !== body.password) {
            throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
        }
        const session = createLocalMockSession(user);
        setRefreshCookie(response, session.refreshToken);
        setCsrfCookie(response, createOpaqueToken());
        response.status(200).json({
            accessToken: session.accessToken,
            expiresIn: session.expiresIn,
            user: session.user,
        });
    }));
    app.post('/auth/email-login/request', authLimiter, asyncHandler(async (request, response) => {
        if (!appConfig.authEmailLoginEnabled) {
            throw new ApiError(403, 'EMAIL_LOGIN_DISABLED', 'Email login is disabled');
        }
        const body = emailLoginRequestSchema.parse(request.body);
        const user = localMockUsersByEmail.get(body.email.trim().toLowerCase());
        if (!user) {
            response.status(202).json({ status: 'accepted' });
            return;
        }
        const statusError = buildMockAccountStatusError(ApiError, user);
        if (statusError) {
            throw statusError;
        }
        const token = issueMockToken(localMockEmailLoginTokens, user, appConfig.emailLoginTokenTtlMinutes * 60 * 1000);
        if (appConfig.allowDebugTokens) {
            response.status(202).json({ status: 'accepted', debugToken: token });
            return;
        }
        response.status(202).json({ status: 'accepted' });
    }));
    app.post('/auth/email-login/confirm', authLimiter, asyncHandler(async (request, response) => {
        if (!appConfig.authEmailLoginEnabled) {
            throw new ApiError(403, 'EMAIL_LOGIN_DISABLED', 'Email login is disabled');
        }
        const body = emailLoginConfirmSchema.parse(request.body);
        const user = localMockUsersByEmail.get(body.email.trim().toLowerCase());
        if (!user) {
            throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or token');
        }
        const statusError = buildMockAccountStatusError(ApiError, user);
        if (statusError) {
            throw statusError;
        }
        const tokenState = localMockEmailLoginTokens.get(body.token);
        if (!tokenState || tokenState.userId !== user.id || tokenState.usedAt || Number(tokenState.expiresAt ?? 0) <= Date.now()) {
            throw new ApiError(401, 'INVALID_EMAIL_TOKEN', 'Invalid or expired email token');
        }
        tokenState.usedAt = Date.now();
        const session = createLocalMockSession(user);
        setRefreshCookie(response, session.refreshToken);
        setCsrfCookie(response, createOpaqueToken());
        response.status(200).json({
            accessToken: session.accessToken,
            expiresIn: session.expiresIn,
            user: session.user,
        });
    }));
    app.post('/auth/refresh', requireCsrfToken, asyncHandler(async (request, response) => {
        const refreshToken = request.cookies?.[appConfig.refreshCookieName];
        if (!refreshToken || typeof refreshToken !== 'string') {
            throw new ApiError(401, 'UNAUTHORIZED', 'Refresh token is required');
        }
        const tokenState = localMockRefreshTokens.get(refreshToken);
        if (!tokenState || Number(tokenState.expiresAt ?? 0) <= Date.now()) {
            localMockRefreshTokens.delete(refreshToken);
            throw new ApiError(401, 'UNAUTHORIZED', 'Invalid refresh token');
        }
        const user = localMockUsers.find((candidate) => candidate.id === tokenState.userId);
        if (!user) {
            localMockRefreshTokens.delete(refreshToken);
            throw new ApiError(401, 'UNAUTHORIZED', 'Invalid refresh token');
        }
        const statusError = buildMockAccountStatusError(ApiError, user);
        if (statusError) {
            localMockRefreshTokens.delete(refreshToken);
            throw statusError;
        }
        localMockRefreshTokens.delete(refreshToken);
        const session = createLocalMockSession(user);
        setRefreshCookie(response, session.refreshToken);
        setCsrfCookie(response, createOpaqueToken());
        response.status(200).json({
            accessToken: session.accessToken,
            expiresIn: session.expiresIn,
            user: session.user,
        });
    }));
    app.post('/auth/logout', requireCsrfToken, (request, response) => {
        const refreshToken = request.cookies?.[appConfig.refreshCookieName];
        if (refreshToken && typeof refreshToken === 'string') {
            localMockRefreshTokens.delete(refreshToken);
        }
        clearCsrfCookie(response);
        clearRefreshCookie(response);
        response.status(204).send();
    });
    app.post('/auth/password-reset/request', authLimiter, asyncHandler(async (request, response) => {
        const body = passwordResetRequestSchema.parse(request.body);
        const user = localMockUsersByEmail.get(body.email.trim().toLowerCase());
        if (!user) {
            response.status(202).json({ status: 'accepted' });
            return;
        }
        const token = issueMockToken(localMockPasswordResetTokens, user, appConfig.passwordResetTtlHours * 60 * 60 * 1000);
        if (appConfig.allowDebugTokens) {
            response.status(202).json({ status: 'accepted', debugToken: token });
            return;
        }
        response.status(202).json({ status: 'accepted' });
    }));
    app.post('/auth/password-reset/confirm', authLimiter, asyncHandler(async (request, response) => {
        const body = passwordResetConfirmSchema.parse(request.body);
        const tokenState = localMockPasswordResetTokens.get(body.token);
        if (!tokenState) {
            throw new ApiError(422, 'TOKEN_INVALID', 'Reset token is invalid');
        }
        if (tokenState.usedAt) {
            throw new ApiError(422, 'TOKEN_USED', 'Reset token already used');
        }
        if (Number(tokenState.expiresAt ?? 0) <= Date.now()) {
            throw new ApiError(422, 'TOKEN_EXPIRED', 'Reset token expired');
        }
        const user = localMockUsers.find((candidate) => candidate.id === tokenState.userId);
        if (!user) {
            throw new ApiError(422, 'TOKEN_INVALID', 'Reset token is invalid');
        }
        tokenState.usedAt = Date.now();
        user.status = 'active';
        localMockPasswords.set(user.id, body.password);
        revokeMockRefreshTokensForUser(user.id);
        response.status(204).send();
    }));
};
export const registerAuthRoutes = (params) => {
    const {
        app,
        asyncHandler,
        bootstrapAdminSchema,
        bootstrapFirstAdmin,
        getRequestMeta,
        setRefreshCookie,
        setCsrfCookie,
        createOpaqueToken,
        authLimiter,
        loginSchema,
        loginByPassword,
        emailLoginRequestSchema,
        requestEmailLoginToken,
        emailLoginConfirmSchema,
        loginByEmailToken,
        requireCsrfToken,
        refreshSession,
        appConfig,
        logoutSession,
        clearCsrfCookie,
        clearRefreshCookie,
        passwordResetRequestSchema,
        requestPasswordReset,
        passwordResetConfirmSchema,
        confirmPasswordReset,
    } = params;
    app.post('/auth/bootstrap-admin', asyncHandler(async (request, response) => {
        const body = bootstrapAdminSchema.parse(request.body);
        const session = await bootstrapFirstAdmin({
            fullName: body.fullName,
            email: body.email,
            password: body.password,
            meta: getRequestMeta(request),
        });
        setRefreshCookie(response, session.refreshToken);
        setCsrfCookie(response, createOpaqueToken());
        response.status(201).json({
            accessToken: session.accessToken,
            expiresIn: session.expiresIn,
            user: session.user,
        });
    }));
    app.post('/auth/login', authLimiter, asyncHandler(async (request, response) => {
        const body = loginSchema.parse(request.body);
        const session = await loginByPassword({
            email: body.email,
            password: body.password,
            meta: getRequestMeta(request),
        });
        setRefreshCookie(response, session.refreshToken);
        setCsrfCookie(response, createOpaqueToken());
        response.status(200).json({
            accessToken: session.accessToken,
            expiresIn: session.expiresIn,
            user: session.user,
        });
    }));
    app.post('/auth/email-login/request', authLimiter, asyncHandler(async (request, response) => {
        const body = emailLoginRequestSchema.parse(request.body);
        const result = await requestEmailLoginToken({
            email: body.email,
            meta: getRequestMeta(request),
            hideUserNotFound: true,
        });
        if (result.debugToken) {
            response.status(202).json({ status: 'accepted', debugToken: result.debugToken });
            return;
        }
        response.status(202).json({ status: 'accepted' });
    }));
    app.post('/auth/email-login/confirm', authLimiter, asyncHandler(async (request, response) => {
        const body = emailLoginConfirmSchema.parse(request.body);
        const session = await loginByEmailToken({
            email: body.email,
            token: body.token,
            meta: getRequestMeta(request),
        });
        setRefreshCookie(response, session.refreshToken);
        setCsrfCookie(response, createOpaqueToken());
        response.status(200).json({
            accessToken: session.accessToken,
            expiresIn: session.expiresIn,
            user: session.user,
        });
    }));
    app.post('/auth/refresh', requireCsrfToken, asyncHandler(async (request, response) => {
        const session = await refreshSession({
            refreshToken: request.cookies?.[appConfig.refreshCookieName],
            meta: getRequestMeta(request),
        });
        setRefreshCookie(response, session.refreshToken);
        setCsrfCookie(response, createOpaqueToken());
        response.status(200).json({
            accessToken: session.accessToken,
            expiresIn: session.expiresIn,
            user: session.user,
        });
    }));
    app.post('/auth/logout', requireCsrfToken, asyncHandler(async (request, response) => {
        await logoutSession(request.cookies?.[appConfig.refreshCookieName]);
        clearCsrfCookie(response);
        clearRefreshCookie(response);
        response.status(204).send();
    }));
    app.post('/auth/password-reset/request', authLimiter, asyncHandler(async (request, response) => {
        const body = passwordResetRequestSchema.parse(request.body);
        const result = await requestPasswordReset({
            email: body.email,
            meta: getRequestMeta(request),
        });
        if (result.debugToken) {
            response.status(202).json({ status: 'accepted', debugToken: result.debugToken });
            return;
        }
        response.status(202).json({ status: 'accepted' });
    }));
    app.post('/auth/password-reset/confirm', authLimiter, asyncHandler(async (request, response) => {
        const body = passwordResetConfirmSchema.parse(request.body);
        await confirmPasswordReset({
            token: body.token,
            password: body.password,
            meta: getRequestMeta(request),
        });
        response.status(204).send();
    }));
};
