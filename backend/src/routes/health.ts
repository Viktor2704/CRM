export const registerHealthRoutes = (params) => {
    const {
        app,
        appConfig,
        localMockAuthEnabled,
        requireAuth,
        asyncHandler,
        checkDatabaseReady,
        emitAlert,
        metricsRegistry,
    } = params;
    app.get('/health', (_request, response) => {
        response.status(200).json({ status: 'ok', service: appConfig.serviceName });
    });
    app.get('/metrics', (_request, response) => {
        response.setHeader('content-type', metricsRegistry.contentType);
        response.setHeader('cache-control', 'no-store');
        response.status(200).send(metricsRegistry.renderMetrics(appConfig.serviceName));
    });
    if (localMockAuthEnabled) {
        app.get('/ready', requireAuth, (_request, response) => {
            response.status(200).json({
                status: 'ready',
                checks: {
                    database: 'mock',
                },
            });
        });
    }
    app.get('/ready', asyncHandler(async (_request, response) => {
        const databaseReady = await checkDatabaseReady();
        if (!databaseReady) {
            void emitAlert({
                type: 'readiness',
                severity: 'critical',
                message: 'Readiness check failed: database unavailable',
                dedupeKey: 'readiness:db_unavailable',
            });
            response.status(503).json({
                status: 'degraded',
                checks: {
                    database: 'down',
                },
            });
            return;
        }
        response.status(200).json({
            status: 'ready',
            checks: {
                database: 'up',
            },
        });
    }));
};
