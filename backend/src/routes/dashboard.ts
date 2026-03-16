import { withCache, CacheKeys } from '../services/cacheService.js';

const CLOSED_REQUEST_STATUSES = `('done', 'closed', 'cancelled')`;
const OPEN_REQUEST_STATUS_CONDITION = `coalesce(status, '') not in ${CLOSED_REQUEST_STATUSES}`;
const COMPLETED_REQUEST_STATUS_CONDITION = `coalesce(status, '') in ${CLOSED_REQUEST_STATUSES}`;
const SERVICE_REQUEST_SCOPE = `type <> 'installation'`;
const INSTALLATION_SCOPE = `type = 'installation' and coalesce(is_project, false) = false`;
const PROJECT_SCOPE = `type = 'installation' and coalesce(is_project, false) = true`;

const parseCount = (value: unknown) => {
  const parsed = parseInt(String(value ?? '0'), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const registerDashboardRoutes = (params: any) => {
  const { app, requireAuth, asyncHandler, dbQuery } = params;

  // Get overdue service requests
  app.get(
    '/dashboard/overdue',
    requireAuth,
    asyncHandler(async (request: any, response: any) => {
      const today = new Date().toISOString().split('T')[0];

      const requestsQuery = `
        SELECT
          id::text as id,
          title,
          due_date_preliminary as due_date,
          'service_request' as type
        FROM requests
        WHERE ${OPEN_REQUEST_STATUS_CONDITION}
          AND due_date_preliminary IS NOT NULL
          AND due_date_preliminary < $1
          AND ${SERVICE_REQUEST_SCOPE}
          AND deleted_at IS NULL
        ORDER BY due_date_preliminary ASC
        LIMIT 10
      `;

      const result = await dbQuery(requestsQuery, [today]);

      const items = result.rows.map((row: any) => {
        const dueDate = new Date(row.due_date);
        const todayDate = new Date(today);
        const daysOverdue = Math.floor((todayDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

        return {
          id: row.id,
          title: row.title || `Заявка ${row.id}`,
          type: row.type,
          dueDate: row.due_date,
          daysOverdue,
        };
      });

      response.json({ items });
    })
  );

  // Get upcoming deadlines (next 7 days)
  app.get(
    '/dashboard/upcoming-deadlines',
    requireAuth,
    asyncHandler(async (request: any, response: any) => {
      const today = new Date().toISOString().split('T')[0];
      const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const query = `
        SELECT
          id::text as id,
          title,
          due_date_preliminary as due_date,
          'service_request' as type
        FROM requests
        WHERE ${OPEN_REQUEST_STATUS_CONDITION}
          AND due_date_preliminary IS NOT NULL
          AND due_date_preliminary >= $1
          AND due_date_preliminary <= $2
          AND ${SERVICE_REQUEST_SCOPE}
          AND deleted_at IS NULL
        ORDER BY due_date_preliminary ASC
        LIMIT 10
      `;

      const result = await dbQuery(query, [today, sevenDaysLater]);

      const items = result.rows.map((row: any) => {
        const dueDate = new Date(row.due_date);
        const todayDate = new Date(today);
        const daysUntil = Math.floor((dueDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));

        return {
          id: row.id,
          title: row.title || `Заявка ${row.id}`,
          type: row.type,
          dueDate: row.due_date,
          daysUntil,
        };
      });

      response.json({ items });
    })
  );

  // Get recent activity
  app.get(
    '/dashboard/recent-activity',
    requireAuth,
    asyncHandler(async (request: any, response: any) => {
      const query = `
        SELECT
          id::text as id,
          activity_type,
          coalesce(title, '') as title,
          coalesce(description, '') as description,
          entity_type,
          entity_id::text as entity_id,
          coalesce(actor_name, 'Система') as actor_name,
          created_at
        FROM entity_activity_log
        ORDER BY created_at DESC NULLS LAST
        LIMIT 10
      `;

      const result = await dbQuery(query, []);

      const items = result.rows.map((row: any) => ({
        id: row.id,
        eventType: row.activity_type || 'updated',
        description: row.title || row.description || 'Изменение',
        entityType: row.entity_type || '',
        entityId: row.entity_id || '',
        userName: row.actor_name || 'Система',
        createdAt: row.created_at,
      }));

      response.json({ items });
    })
  );

  // Get quick stats
  app.get(
    '/dashboard/quick-stats',
    requireAuth,
    asyncHandler(async (request: any, response: any) => {
      const userId = request.authUser?.id || 'anonymous';

      // Cache dashboard stats for 2 minutes
      const stats = await withCache(
        CacheKeys.dashboardStats(userId),
        120,
        async () => {
          const [projectsResult, requestsResult, installationsResult, usersResult] = await Promise.all([
            dbQuery(
              `SELECT
                 COUNT(*) as total,
                 COUNT(*) FILTER (WHERE ${OPEN_REQUEST_STATUS_CONDITION}) as active
               FROM requests
               WHERE ${PROJECT_SCOPE}
                 AND deleted_at IS NULL`,
              []
            ),
            dbQuery(
              `SELECT
                 COUNT(*) as total,
                 COUNT(*) FILTER (WHERE ${OPEN_REQUEST_STATUS_CONDITION}) as open
               FROM requests
               WHERE ${SERVICE_REQUEST_SCOPE}
                 AND deleted_at IS NULL`,
              []
            ),
            dbQuery(
              `SELECT
                 COUNT(*) as total,
                 COUNT(*) FILTER (WHERE ${COMPLETED_REQUEST_STATUS_CONDITION}) as completed
               FROM requests
               WHERE ${INSTALLATION_SCOPE}
                 AND deleted_at IS NULL`,
              []
            ),
            dbQuery(
              `SELECT
                 COUNT(*) as total,
                 COUNT(*) FILTER (WHERE status = 'active') as active
               FROM app_users`,
              []
            ),
          ]);

          return {
            totalProjects: parseCount(projectsResult.rows[0]?.total),
            activeProjects: parseCount(projectsResult.rows[0]?.active),
            totalRequests: parseCount(requestsResult.rows[0]?.total),
            openRequests: parseCount(requestsResult.rows[0]?.open),
            totalInstallations: parseCount(installationsResult.rows[0]?.total),
            completedInstallations: parseCount(installationsResult.rows[0]?.completed),
            totalUsers: parseCount(usersResult.rows[0]?.total),
            activeUsers: parseCount(usersResult.rows[0]?.active),
          };
        }
      );

      response.json(stats);
    })
  );

  // Get open service requests by priority
  app.get(
    '/dashboard/service-requests',
    requireAuth,
    asyncHandler(async (request: any, response: any) => {
      const query = `
        SELECT
          id::text as id,
          title,
          priority,
          status,
          created_at
        FROM requests
        WHERE ${OPEN_REQUEST_STATUS_CONDITION}
          AND ${SERVICE_REQUEST_SCOPE}
          AND deleted_at IS NULL
        ORDER BY
          CASE priority
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 4
            ELSE 5
          END,
          created_at DESC
        LIMIT 10
      `;

      const result = await dbQuery(query, []);

      const items = result.rows.map((row: any) => ({
        id: row.id,
        title: row.title || `Заявка ${row.id}`,
        priority: row.priority || 'medium',
        status: row.status || 'new',
        createdAt: row.created_at,
      }));

      response.json({ items });
    })
  );
};
