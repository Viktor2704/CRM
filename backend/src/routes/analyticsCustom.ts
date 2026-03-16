export const registerAnalyticsRoutes = (params: any) => {
    const { app, requireAuth, asyncHandler, dbQuery, ApiError } = params;

    const ANALYTICS_ROLES = new Set(['admin', 'manager', 'dispatcher', 'curator']);

    const requireAnalyticsAccess = (request: any, _response: any, next: any) => {
        const role = request.authUser?.role;
        if (!ANALYTICS_ROLES.has(role ?? '')) {
            throw new ApiError(403, 'FORBIDDEN', 'Analytics access is restricted to admin, manager, dispatcher, and curator roles');
        }
        next();
    };

    const buildDateFilter = (period: string | undefined, column: string): { clause: string; params: any[] } => {
        if (!period) return { clause: '', params: [] };
        let interval = '';
        switch (period) {
            case 'this_month':
                return { clause: ` AND ${column} >= date_trunc('month', now())`, params: [] };
            case 'this_quarter':
                return { clause: ` AND ${column} >= date_trunc('quarter', now())`, params: [] };
            case 'this_year':
                return { clause: ` AND ${column} >= date_trunc('year', now())`, params: [] };
            default:
                return { clause: '', params: [] };
        }
    };

    app.get('/analytics/operational', requireAuth, requireAnalyticsAccess, asyncHandler(async (request: any, response: any) => {
        const period = request.query.period as string | undefined;
        const dateFilter = buildDateFilter(period, 'created_at');

        const [byStatus, byPriority, byType, byMonth, avgResolution] = await Promise.all([
            dbQuery(`SELECT status, count(*)::int as count FROM requests WHERE deleted_at IS NULL${dateFilter.clause} GROUP BY status`),
            dbQuery(`SELECT priority, count(*)::int as count FROM requests WHERE deleted_at IS NULL${dateFilter.clause} GROUP BY priority`),
            dbQuery(`SELECT type, count(*)::int as count FROM requests WHERE deleted_at IS NULL${dateFilter.clause} GROUP BY type`),
            dbQuery(`SELECT date_trunc('month', created_at)::date as month, count(*)::int as count FROM requests WHERE deleted_at IS NULL AND created_at >= now() - interval '6 months'${dateFilter.clause} GROUP BY 1 ORDER BY 1`),
            dbQuery(`SELECT avg(EXTRACT(epoch FROM (updated_at - created_at))/3600)::int as avg_hours FROM requests WHERE status IN ('done','closed') AND deleted_at IS NULL${dateFilter.clause}`),
        ]);

        response.status(200).json({
            byStatus: byStatus.rows,
            byPriority: byPriority.rows,
            byType: byType.rows,
            byMonth: byMonth.rows,
            avgResolutionHours: avgResolution.rows[0]?.avg_hours ?? 0,
        });
    }));

    app.get('/analytics/financial', requireAuth, requireAnalyticsAccess, asyncHandler(async (request: any, response: any) => {
        const period = request.query.period as string | undefined;
        const dateFilter = buildDateFilter(period, 'created_at');

        const [byStatus, byType, expiringSoon, topTenants] = await Promise.all([
            dbQuery(`SELECT status, count(*)::int as count FROM contracts WHERE deleted_at IS NULL${dateFilter.clause} GROUP BY status`),
            dbQuery(`SELECT type, count(*)::int as count FROM contracts WHERE deleted_at IS NULL${dateFilter.clause} GROUP BY type`),
            dbQuery(`SELECT count(*)::int as expiring_soon FROM contracts WHERE deleted_at IS NULL AND status = 'ACTIVE' AND end_date <= now() + interval '30 days' AND end_date >= now()`),
            dbQuery(`SELECT t.name as tenant_name, count(c.id)::int as contract_count FROM contracts c LEFT JOIN tenants t ON t.id::text = c.tenant_id::text WHERE c.deleted_at IS NULL AND c.status = 'ACTIVE' GROUP BY t.name ORDER BY contract_count DESC LIMIT 10`),
        ]);

        response.status(200).json({
            byStatus: byStatus.rows,
            byType: byType.rows,
            expiringSoon: expiringSoon.rows[0]?.expiring_soon ?? 0,
            topTenants: topTenants.rows,
        });
    }));

    app.get('/analytics/client', requireAuth, requireAnalyticsAccess, asyncHandler(async (request: any, response: any) => {
        const period = request.query.period as string | undefined;
        const dateFilter = buildDateFilter(period, 'r.created_at');

        const [topTenants, clientActions] = await Promise.all([
            dbQuery(`SELECT t.name as tenant_name, count(r.id)::int as request_count FROM tenants t LEFT JOIN directions d ON d.tenant_id::text = t.id::text LEFT JOIN requests r ON r.direction_id::text = d.id::text AND r.deleted_at IS NULL WHERE t.deleted_at IS NULL GROUP BY t.name ORDER BY request_count DESC LIMIT 10`),
            dbQuery(`SELECT client_action, count(*)::int as count FROM requests WHERE client_action IS NOT NULL AND deleted_at IS NULL${buildDateFilter(period, 'created_at').clause} GROUP BY client_action`),
        ]);

        response.status(200).json({
            topTenants: topTenants.rows,
            clientActions: clientActions.rows,
        });
    }));

    app.get('/analytics/production', requireAuth, requireAnalyticsAccess, asyncHandler(async (request: any, response: any) => {
        const period = request.query.period as string | undefined;
        const dateFilter = buildDateFilter(period, 'created_at');

        const [plansByStatus, generationStats, sppzByStatus] = await Promise.all([
            dbQuery(`SELECT status, count(*)::int as count FROM maintenance_plans WHERE deleted_at IS NULL${dateFilter.clause} GROUP BY status`),
            dbQuery(`SELECT count(*)::int as total_runs, sum(total_created)::int as total_created, sum(total_skipped)::int as total_skipped FROM maintenance_generation_runs`),
            dbQuery(`SELECT status, count(*)::int as count FROM sppz_journal_entries WHERE deleted_at IS NULL${dateFilter.clause} GROUP BY status`),
        ]);

        response.status(200).json({
            plansByStatus: plansByStatus.rows,
            generationStats: {
                totalRuns: generationStats.rows[0]?.total_runs ?? 0,
                totalCreated: generationStats.rows[0]?.total_created ?? 0,
                totalSkipped: generationStats.rows[0]?.total_skipped ?? 0,
            },
            sppzByStatus: sppzByStatus.rows,
        });
    }));
};
