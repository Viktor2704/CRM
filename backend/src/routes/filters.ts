import type { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { dbQuery } from '../db.js';
import { ApiError } from '../errors.js';
import type { FilterPreset, FilterGroup } from '../types/filters.js';
import { AdvancedFilteringService } from '../services/advancedFiltering.js';

const filterPresetSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  filterGroup: z.any(), // Complex validation would be done by service
  isShared: z.boolean().default(false),
});

const bulkOperationSchema = z.object({
  action: z.enum(['update', 'delete', 'export', 'assign']),
  selectedIds: z.array(z.string().uuid()),
  data: z.record(z.string(), z.unknown()).optional(),
});

export function registerFilterRoutes(router: Router) {
  // Get all filter presets for current user
  router.get(
    '/api/filter-presets',
    requireAuth as any,
    asyncHandler(async (req, res) => {
      const userId = req.authUser!.id;
      const entityType = req.query.entityType as string;

      let query = `
        SELECT
          id, name, description, filter_group as "filterGroup",
          is_shared as "isShared", is_system as "isSystem",
          created_by as "createdBy", created_at as "createdAt",
          updated_at as "updatedAt"
        FROM filter_presets
        WHERE (created_by = $1 OR is_shared = true OR is_system = true)
      `;
      const params: unknown[] = [userId];

      if (entityType) {
        query += ` AND entity_type = $2`;
        params.push(entityType);
      }

      query += ` ORDER BY is_system DESC, is_shared DESC, name ASC`;

      const result = await dbQuery(query, params);
      res.json({ items: result.rows });
    })
  );

  // Create filter preset
  router.post(
    '/api/filter-presets',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.authUser!.id;
      const data = filterPresetSchema.parse(req.body);
      const entityType = req.body.entityType || 'service_request';

      // Validate filter group structure
      const validation = AdvancedFilteringService.validateFilterGroup(data.filterGroup);
      if (!validation.valid) {
        throw new ApiError(400, 'INVALID_FILTER', validation.errors.join(', '));
      }

      const result = await dbQuery(
        `
        INSERT INTO filter_presets (
          name, description, filter_group, is_shared, is_system,
          entity_type, created_by, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, false, $5, $6, NOW(), NOW())
        RETURNING
          id, name, description, filter_group as "filterGroup",
          is_shared as "isShared", is_system as "isSystem",
          created_by as "createdBy", created_at as "createdAt",
          updated_at as "updatedAt"
        `,
        [
          data.name,
          data.description || null,
          JSON.stringify(data.filterGroup),
          data.isShared,
          entityType,
          userId,
        ]
      );

      res.status(201).json(result.rows[0]);
    })
  );

  // Update filter preset
  router.put(
    '/api/filter-presets/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.authUser!.id;
      const presetId = req.params.id;
      const data = filterPresetSchema.parse(req.body);

      // Check ownership
      const existing = await dbQuery(
        'SELECT created_by, is_system FROM filter_presets WHERE id = $1',
        [presetId]
      );

      if (existing.rows.length === 0) {
        throw new ApiError(404, 'NOT_FOUND', 'Filter preset not found');
      }

      if (existing.rows[0].is_system) {
        throw new ApiError(403, 'FORBIDDEN', 'Cannot modify system presets');
      }

      if (existing.rows[0].created_by !== userId) {
        throw new ApiError(403, 'FORBIDDEN', 'Cannot modify presets created by others');
      }

      // Validate filter group structure
      const validation = AdvancedFilteringService.validateFilterGroup(data.filterGroup);
      if (!validation.valid) {
        throw new ApiError(400, 'INVALID_FILTER', validation.errors.join(', '));
      }

      const result = await dbQuery(
        `
        UPDATE filter_presets
        SET name = $1, description = $2, filter_group = $3,
            is_shared = $4, updated_at = NOW()
        WHERE id = $5
        RETURNING
          id, name, description, filter_group as "filterGroup",
          is_shared as "isShared", is_system as "isSystem",
          created_by as "createdBy", created_at as "createdAt",
          updated_at as "updatedAt"
        `,
        [
          data.name,
          data.description || null,
          JSON.stringify(data.filterGroup),
          data.isShared,
          presetId,
        ]
      );

      res.json(result.rows[0]);
    })
  );

  // Delete filter preset
  router.delete(
    '/api/filter-presets/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.authUser!.id;
      const presetId = req.params.id;

      // Check ownership
      const existing = await dbQuery(
        'SELECT created_by, is_system FROM filter_presets WHERE id = $1',
        [presetId]
      );

      if (existing.rows.length === 0) {
        throw new ApiError(404, 'NOT_FOUND', 'Filter preset not found');
      }

      if (existing.rows[0].is_system) {
        throw new ApiError(403, 'FORBIDDEN', 'Cannot delete system presets');
      }

      if (existing.rows[0].created_by !== userId) {
        throw new ApiError(403, 'FORBIDDEN', 'Cannot delete presets created by others');
      }

      await dbQuery('DELETE FROM filter_presets WHERE id = $1', [presetId]);
      res.status(204).send();
    })
  );

  // Bulk operations on service requests
  router.post(
    '/api/service-requests/bulk',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.authUser!.id;
      const operation = bulkOperationSchema.parse(req.body);

      if (operation.selectedIds.length === 0) {
        throw new ApiError(400, 'INVALID_REQUEST', 'No items selected');
      }

      if (operation.selectedIds.length > 100) {
        throw new ApiError(400, 'INVALID_REQUEST', 'Cannot process more than 100 items at once');
      }

      switch (operation.action) {
        case 'update':
          if (!operation.data) {
            throw new ApiError(400, 'INVALID_REQUEST', 'Update data is required');
          }
          await handleBulkUpdate(operation.selectedIds, operation.data, userId);
          break;

        case 'delete':
          await handleBulkDelete(operation.selectedIds, userId);
          break;

        case 'assign':
          if (!operation.data?.executorIds) {
            throw new ApiError(400, 'INVALID_REQUEST', 'Executor IDs are required');
          }
          await handleBulkAssign(operation.selectedIds, operation.data.executorIds as string[], userId);
          break;

        case 'export':
          // Export would return CSV/Excel data
          const exportData = await handleBulkExport(operation.selectedIds);
          res.json({ data: exportData });
          return;

        default:
          throw new ApiError(400, 'INVALID_REQUEST', 'Unknown bulk action');
      }

      res.json({ success: true, count: operation.selectedIds.length });
    })
  );
}

async function handleBulkUpdate(ids: string[], data: Record<string, unknown>, userId: string) {
  const allowedFields = ['status', 'priority', 'type', 'systemType'];
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(data)) {
    if (allowedFields.includes(key) && value !== undefined && value !== null && value !== '') {
      updates.push(`${key} = $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }
  }

  if (updates.length === 0) {
    return;
  }

  params.push(ids);
  const query = `
    UPDATE service_requests
    SET ${updates.join(', ')}, updated_at = NOW()
    WHERE id = ANY($${paramIndex})
  `;

  await dbQuery(query, params);
}

async function handleBulkDelete(ids: string[], userId: string) {
  await dbQuery(
    `UPDATE service_requests SET deleted_at = NOW() WHERE id = ANY($1)`,
    [ids]
  );
}

async function handleBulkAssign(ids: string[], executorIds: string[], userId: string) {
  await dbQuery(
    `UPDATE service_requests SET executor_ids = $1, updated_at = NOW() WHERE id = ANY($2)`,
    [executorIds, ids]
  );
}

async function handleBulkExport(ids: string[]) {
  const result = await dbQuery(
    `
    SELECT
      id, title, description, type, status, priority,
      system_type as "systemType", created_at as "createdAt"
    FROM service_requests
    WHERE id = ANY($1)
    ORDER BY created_at DESC
    `,
    [ids]
  );

  return result.rows;
}
