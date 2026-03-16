import { Router } from 'express';
import { dbQuery } from '../db.js';
import { z } from 'zod';

const router = Router();

// Schemas
const FilterSchema = z.object({
  fieldName: z.string(),
  operator: z.enum(['equals', 'not_equals', 'contains', 'in', 'not_in', 'greater_than', 'less_than', 'is_null', 'is_not_null', 'starts_with', 'ends_with']),
  value: z.any().optional(),
  position: z.number().default(0),
});

const FilterGroupSchema = z.object({
  logicOperator: z.enum(['AND', 'OR']).default('AND'),
  filters: z.array(FilterSchema),
  childGroups: z.array(z.lazy(() => FilterGroupSchema)).optional(),
  position: z.number().default(0),
});

const ColumnConfigSchema = z.object({
  fieldName: z.string(),
  label: z.string().optional(),
  width: z.number().optional(),
  isVisible: z.boolean().default(true),
  position: z.number().default(0),
});

const SavedViewSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  entityType: z.string(),
  visibility: z.enum(['private', 'public', 'shared']).default('private'),
  isDefault: z.boolean().default(false),
  isPinned: z.boolean().default(false),
  sortField: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
  filterGroups: z.array(FilterGroupSchema).optional(),
  columns: z.array(ColumnConfigSchema).optional(),
});

// GET /saved-views - List all views for entity type
router.get('/saved-views', async (req, res) => {
  try {
    const { entityType } = req.query;
    const userId = req.user?.id;

    if (!entityType) {
      return res.status(400).json({ error: 'entityType is required' });
    }

    // Get views (system, user's own, public, and shared with user)
    const result = await dbQuery(`
      SELECT DISTINCT
        sv.id,
        sv.name,
        sv.description,
        sv.entity_type,
        sv.visibility,
        sv.created_by_user_id,
        sv.is_default,
        sv.is_pinned,
        sv.is_system,
        sv.sort_field,
        sv.sort_direction,
        sv.created_at,
        sv.updated_at,
        u.name as created_by_name,
        CASE
          WHEN sv.created_by_user_id = $2 THEN true
          WHEN vs.can_edit = true THEN true
          ELSE false
        END as can_edit
      FROM saved_views sv
      LEFT JOIN users u ON sv.created_by_user_id = u.id
      LEFT JOIN view_shares vs ON sv.id = vs.view_id AND vs.shared_with_user_id = $2
      WHERE sv.entity_type = $1
        AND (
          sv.is_system = true
          OR sv.created_by_user_id = $2
          OR sv.visibility = 'public'
          OR vs.shared_with_user_id = $2
        )
      ORDER BY sv.is_system DESC, sv.is_pinned DESC, sv.is_default DESC, sv.name ASC
    `, [entityType, userId]);

    res.json({ views: result.rows });
  } catch (error) {
    console.error('Error fetching saved views:', error);
    res.status(500).json({ error: 'Failed to fetch saved views' });
  }
});

// GET /saved-views/:id - Get view with filters and columns
router.get('/saved-views/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    // Get view
    const viewResult = await dbQuery(`
      SELECT sv.*, u.name as created_by_name
      FROM saved_views sv
      LEFT JOIN users u ON sv.created_by_user_id = u.id
      WHERE sv.id = $1
        AND (
          sv.is_system = true
          OR sv.created_by_user_id = $2
          OR sv.visibility = 'public'
          OR EXISTS (
            SELECT 1 FROM view_shares vs
            WHERE vs.view_id = sv.id AND vs.shared_with_user_id = $2
          )
        )
    `, [id, userId]);

    if (viewResult.rows.length === 0) {
      return res.status(404).json({ error: 'View not found' });
    }

    const view = viewResult.rows[0];

    // Get filter groups and filters
    const filterGroupsResult = await dbQuery(`
      SELECT
        fg.id,
        fg.parent_group_id,
        fg.logic_operator,
        fg.position,
        json_agg(
          json_build_object(
            'id', f.id,
            'fieldName', f.field_name,
            'operator', f.operator,
            'value', f.value,
            'position', f.position
          ) ORDER BY f.position
        ) FILTER (WHERE f.id IS NOT NULL) as filters
      FROM view_filter_groups fg
      LEFT JOIN view_filters f ON fg.id = f.filter_group_id
      WHERE fg.view_id = $1
      GROUP BY fg.id, fg.parent_group_id, fg.logic_operator, fg.position
      ORDER BY fg.position
    `, [id]);

    // Get columns
    const columnsResult = await dbQuery(`
      SELECT
        id,
        field_name,
        label,
        width,
        is_visible,
        position
      FROM view_columns
      WHERE view_id = $1
      ORDER BY position
    `, [id]);

    res.json({
      ...view,
      filterGroups: filterGroupsResult.rows,
      columns: columnsResult.rows,
    });
  } catch (error) {
    console.error('Error fetching saved view:', error);
    res.status(500).json({ error: 'Failed to fetch saved view' });
  }
});

// POST /saved-views - Create new view
router.post('/saved-views', async (req, res) => {
  try {
    const userId = req.user?.id;
    const data = SavedViewSchema.parse(req.body);

    // Start transaction
    await dbQuery('BEGIN');

    try {
      // Create view
      const viewResult = await dbQuery(`
        INSERT INTO saved_views (
          name, description, entity_type, visibility,
          created_by_user_id, is_default, is_pinned,
          sort_field, sort_direction
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [
        data.name,
        data.description || null,
        data.entityType,
        data.visibility,
        userId,
        data.isDefault,
        data.isPinned,
        data.sortField || null,
        data.sortDirection || null,
      ]);

      const viewId = viewResult.rows[0].id;

      // Create filter groups and filters
      if (data.filterGroups && data.filterGroups.length > 0) {
        for (const group of data.filterGroups) {
          const groupResult = await dbQuery(`
            INSERT INTO view_filter_groups (view_id, logic_operator, position)
            VALUES ($1, $2, $3)
            RETURNING id
          `, [viewId, group.logicOperator, group.position]);

          const groupId = groupResult.rows[0].id;

          // Create filters
          for (const filter of group.filters) {
            await dbQuery(`
              INSERT INTO view_filters (
                filter_group_id, field_name, operator, value, position
              )
              VALUES ($1, $2, $3, $4, $5)
            `, [
              groupId,
              filter.fieldName,
              filter.operator,
              filter.value ? JSON.stringify(filter.value) : null,
              filter.position,
            ]);
          }
        }
      }

      // Create columns
      if (data.columns && data.columns.length > 0) {
        for (const column of data.columns) {
          await dbQuery(`
            INSERT INTO view_columns (
              view_id, field_name, label, width, is_visible, position
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            viewId,
            column.fieldName,
            column.label || null,
            column.width || null,
            column.isVisible,
            column.position,
          ]);
        }
      }

      await dbQuery('COMMIT');

      res.status(201).json({ id: viewId, ...viewResult.rows[0] });
    } catch (error) {
      await dbQuery('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error creating saved view:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.issues });
    }
    res.status(500).json({ error: 'Failed to create saved view' });
  }
});

// PATCH /saved-views/:id - Update view
router.patch('/saved-views/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const data = SavedViewSchema.partial().parse(req.body);

    // Check ownership or edit permission
    const checkResult = await dbQuery(`
      SELECT sv.id
      FROM saved_views sv
      LEFT JOIN view_shares vs ON sv.id = vs.view_id AND vs.shared_with_user_id = $2
      WHERE sv.id = $1
        AND (sv.created_by_user_id = $2 OR vs.can_edit = true)
    `, [id, userId]);

    if (checkResult.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await dbQuery('BEGIN');

    try {
      // Update view
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (data.name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(data.name);
      }
      if (data.description !== undefined) {
        updates.push(`description = $${paramIndex++}`);
        values.push(data.description);
      }
      if (data.visibility !== undefined) {
        updates.push(`visibility = $${paramIndex++}`);
        values.push(data.visibility);
      }
      if (data.isDefault !== undefined) {
        updates.push(`is_default = $${paramIndex++}`);
        values.push(data.isDefault);
      }
      if (data.isPinned !== undefined) {
        updates.push(`is_pinned = $${paramIndex++}`);
        values.push(data.isPinned);
      }
      if (data.sortField !== undefined) {
        updates.push(`sort_field = $${paramIndex++}`);
        values.push(data.sortField);
      }
      if (data.sortDirection !== undefined) {
        updates.push(`sort_direction = $${paramIndex++}`);
        values.push(data.sortDirection);
      }

      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        values.push(id);
        await dbQuery(`
          UPDATE saved_views
          SET ${updates.join(', ')}
          WHERE id = $${paramIndex}
        `, values);
      }

      // Update filter groups if provided
      if (data.filterGroups !== undefined) {
        // Delete existing filter groups (cascade deletes filters)
        await dbQuery('DELETE FROM view_filter_groups WHERE view_id = $1', [id]);

        // Create new filter groups
        for (const group of data.filterGroups) {
          const groupResult = await dbQuery(`
            INSERT INTO view_filter_groups (view_id, logic_operator, position)
            VALUES ($1, $2, $3)
            RETURNING id
          `, [id, group.logicOperator, group.position]);

          const groupId = groupResult.rows[0].id;

          for (const filter of group.filters) {
            await dbQuery(`
              INSERT INTO view_filters (
                filter_group_id, field_name, operator, value, position
              )
              VALUES ($1, $2, $3, $4, $5)
            `, [
              groupId,
              filter.fieldName,
              filter.operator,
              filter.value ? JSON.stringify(filter.value) : null,
              filter.position,
            ]);
          }
        }
      }

      // Update columns if provided
      if (data.columns !== undefined) {
        await dbQuery('DELETE FROM view_columns WHERE view_id = $1', [id]);

        for (const column of data.columns) {
          await dbQuery(`
            INSERT INTO view_columns (
              view_id, field_name, label, width, is_visible, position
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            id,
            column.fieldName,
            column.label || null,
            column.width || null,
            column.isVisible,
            column.position,
          ]);
        }
      }

      await dbQuery('COMMIT');

      res.json({ success: true });
    } catch (error) {
      await dbQuery('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error updating saved view:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.issues });
    }
    res.status(500).json({ error: 'Failed to update saved view' });
  }
});

// DELETE /saved-views/:id - Delete view
router.delete('/saved-views/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    // Check ownership (only owner can delete)
    const result = await dbQuery(`
      DELETE FROM saved_views
      WHERE id = $1 AND created_by_user_id = $2 AND is_system = false
      RETURNING id
    `, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied or view not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting saved view:', error);
    res.status(500).json({ error: 'Failed to delete saved view' });
  }
});

// POST /saved-views/:id/share - Share view with user
router.post('/saved-views/:id/share', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const { sharedWithUserId, canEdit } = req.body;

    // Check ownership
    const checkResult = await dbQuery(`
      SELECT id FROM saved_views
      WHERE id = $1 AND created_by_user_id = $2
    `, [id, userId]);

    if (checkResult.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Share view
    await dbQuery(`
      INSERT INTO view_shares (view_id, shared_with_user_id, can_edit)
      VALUES ($1, $2, $3)
      ON CONFLICT (view_id, shared_with_user_id)
      DO UPDATE SET can_edit = $3
    `, [id, sharedWithUserId, canEdit || false]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error sharing view:', error);
    res.status(500).json({ error: 'Failed to share view' });
  }
});

// DELETE /saved-views/:id/share/:userId - Unshare view
router.delete('/saved-views/:id/share/:sharedUserId', async (req, res) => {
  try {
    const { id, sharedUserId } = req.params;
    const userId = req.user?.id;

    // Check ownership
    const checkResult = await dbQuery(`
      SELECT id FROM saved_views
      WHERE id = $1 AND created_by_user_id = $2
    `, [id, userId]);

    if (checkResult.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await dbQuery(`
      DELETE FROM view_shares
      WHERE view_id = $1 AND shared_with_user_id = $2
    `, [id, sharedUserId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error unsharing view:', error);
    res.status(500).json({ error: 'Failed to unshare view' });
  }
});

export default router;
