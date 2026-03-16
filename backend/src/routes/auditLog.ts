import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdminLike } from '../middleware/auth.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { queryAuditLogs, getAuditLogStats } from '../services/auditLogService.js';
import { ApiError } from '../errors.js';

const auditLogQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  status: z.enum(['success', 'failure', 'error']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export function registerAuditLogRoutes(router: Router): void {
  // Get audit logs with filters
  router.get(
    '/api/audit-logs',
    requireAuth,
    requireAdminLike,
    asyncHandler(async (request, response) => {
      const query = auditLogQuerySchema.parse(request.query);
      const result = await queryAuditLogs(query);
      response.json(result);
    })
  );

  // Get audit log statistics
  router.get(
    '/api/audit-logs/stats',
    requireAuth,
    requireAdminLike,
    asyncHandler(async (request, response) => {
      const days = request.query.days ? parseInt(request.query.days as string, 10) : 30;
      if (isNaN(days) || days < 1 || days > 365) {
        throw new ApiError(400, 'INVALID_DAYS', 'Days must be between 1 and 365');
      }
      const stats = await getAuditLogStats(days);
      response.json({ stats });
    })
  );
}
