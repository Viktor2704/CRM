import { asyncHandler } from '../helpers/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { getActivityLog, getActivityCount, logActivity, type ActivityLogFilter } from '../services/activityLogService.js';
import { normalizeText } from '../helpers/normalize.js';
import { ApiError } from '../errors.js';

export const registerActivityLogRoutes = (app: any) => {
  /**
   * GET /activity-log
   * Get activity log entries with filtering
   */
  app.get(
    '/activity-log',
    requireAuth,
    asyncHandler(async (request, response) => {
      const filter: ActivityLogFilter = {
        entityType: normalizeText(request.query.entityType) as any,
        entityId: normalizeText(request.query.entityId),
        activityType: normalizeText(request.query.activityType) as any,
        actorUserId: normalizeText(request.query.actorUserId),
        severity: normalizeText(request.query.severity) as any,
        limit: parseInt(String(request.query.limit || '100'), 10),
        offset: parseInt(String(request.query.offset || '0'), 10),
      };

      if (request.query.fromDate) {
        filter.fromDate = new Date(String(request.query.fromDate));
      }

      if (request.query.toDate) {
        filter.toDate = new Date(String(request.query.toDate));
      }

      const activities = await getActivityLog(filter);

      response.status(200).json({
        items: activities,
        total: activities.length,
        limit: filter.limit,
        offset: filter.offset,
      });
    })
  );

  /**
   * GET /activity-log/:entityType/:entityId
   * Get activity log for a specific entity
   */
  app.get(
    '/activity-log/:entityType/:entityId',
    requireAuth,
    asyncHandler(async (request, response) => {
      const entityType = normalizeText(request.params.entityType) as any;
      const entityId = normalizeText(request.params.entityId);

      if (!entityType || !entityId) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'entityType and entityId are required');
      }

      const limit = parseInt(String(request.query.limit || '100'), 10);
      const offset = parseInt(String(request.query.offset || '0'), 10);

      const activities = await getActivityLog({
        entityType,
        entityId,
        limit,
        offset,
      });

      const total = await getActivityCount(entityType, entityId);

      response.status(200).json({
        items: activities,
        total,
        limit,
        offset,
      });
    })
  );

  /**
   * POST /activity-log
   * Manually log an activity (for testing or manual entries)
   */
  app.post(
    '/activity-log',
    requireAuth,
    asyncHandler(async (request, response) => {
      const actorUserId = request.authUser?.id;
      const actorName = request.authUser?.fullName || request.authUser?.email || 'Пользователь';

      const entry = {
        entityType: normalizeText(request.body.entityType) as any,
        entityId: normalizeText(request.body.entityId),
        activityType: normalizeText(request.body.activityType) as any,
        actorUserId,
        actorName,
        severity: (normalizeText(request.body.severity) || 'info') as 'info' | 'warning' | 'error' | 'success',
        title: normalizeText(request.body.title),
        description: normalizeText(request.body.description),
        metadata: request.body.metadata || {},
      };

      if (!entry.entityType || !entry.entityId || !entry.activityType || !entry.title) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'entityType, entityId, activityType, and title are required');
      }

      const id = await logActivity(entry);

      response.status(201).json({ id, success: true });
    })
  );
};
