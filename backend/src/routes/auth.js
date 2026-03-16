export const registerMockAuthRoutes = (params) => {
    const { app, authLimiter, asyncHandler, loginSchema, localMockUsersByEmail, ApiError, localMockRefreshTokens, localMockUsers, createLocalMockSession, setRefreshCookie, setCsrfCookie, createOpaqueToken, appConfig, clearCsrfCookie, clearRefreshCookie, } = params;
    app.post('/auth/login', authLimiter, asyncHandler(async (request, response) => {
        const body = loginSchema.parse(request.body);
        const user = localMockUsersByEmail.get(body.email.trim().toLowerCase());
        if (!user) {
            throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
        }
        if (user.status === 'blocked' || user.status === 'deactivated') {
            throw new ApiError(403, 'ACCOUNT_DISABLED', 'Account is disabled');
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
    app.post('/auth/refresh', asyncHandler(async (request, response) => {
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
    app.post('/auth/logout', (request, response) => {
        const refreshToken = request.cookies?.[appConfig.refreshCookieName];
        if (refreshToken && typeof refreshToken === 'string') {
            localMockRefreshTokens.delete(refreshToken);
        }
        clearCsrfCookie(response);
        clearRefreshCookie(response);
        response.status(204).send();
    });
};
export const registerAuthRoutes = (params) => {
    const { app, asyncHandler, bootstrapAdminSchema, bootstrapFirstAdmin, getRequestMeta, setRefreshCookie, setCsrfCookie, createOpaqueToken, authLimiter, loginSchema, loginByPassword, emailLoginConfirmSchema, loginByEmailToken, requireCsrfToken, refreshSession, appConfig, logoutSession, clearCsrfCookie, clearRefreshCookie, passwordResetRequestSchema, requestPasswordReset, passwordResetConfirmSchema, confirmPasswordReset, } = params;
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
