import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import {
  createTeamGoal,
  updateTeamGoal,
  listTeamGoals,
  getTeamGoalById,
  deleteTeamGoal,
  updateGoalProgress,
  recordTeamMetric,
  getTeamMetrics,
  calculateTeamPerformance,
  getTeamDashboardMetrics,
} from '../services/teamService.js';

const router = Router();

// Schemas
const CreateGoalSchema = z.object({
  workspace_id: z.string().uuid().optional(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  goal_type: z.enum(['custom', 'performance', 'quality', 'efficiency']),
  target_value: z.number().optional(),
  unit: z.string().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
});

const UpdateGoalSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  target_value: z.number().optional(),
  current_value: z.number().optional(),
  unit: z.string().optional(),
  end_date: z.string().datetime().optional(),
  status: z.enum(['active', 'completed', 'cancelled', 'overdue']).optional(),
});

const RecordMetricSchema = z.object({
  workspace_id: z.string().uuid().optional(),
  metric_type: z.string(),
  metric_value: z.number(),
  metric_unit: z.string().optional(),
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
  metadata: z.any().optional(),
});

// Team Goals Routes

// POST /team/goals - Create team goal
router.post('/team/goals', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const input = CreateGoalSchema.parse(req.body);

  const goal = await createTeamGoal(
    input.workspace_id,
    input.title,
    input.goal_type,
    userId,
    {
      description: input.description,
      targetValue: input.target_value,
      unit: input.unit,
      startDate: input.start_date ? new Date(input.start_date) : undefined,
      endDate: input.end_date ? new Date(input.end_date) : undefined,
    }
  );

  res.status(201).json({ goal });
}));

// GET /team/goals - List team goals
router.get('/team/goals', requireAuth, asyncHandler(async (req, res) => {
  const { workspace_id, status } = req.query;

  const goals = await listTeamGoals(
    workspace_id as string | undefined,
    status as string | undefined
  );

  res.json({ goals });
}));

// GET /team/goals/:id - Get team goal by ID
router.get('/team/goals/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const goal = await getTeamGoalById(id);

  if (!goal) {
    return res.status(404).json({ error: 'Goal not found' });
  }

  res.json({ goal });
}));

// PUT /team/goals/:id - Update team goal
router.put('/team/goals/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const input = UpdateGoalSchema.parse(req.body);

  const updates: any = {};
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.target_value !== undefined) updates.targetValue = input.target_value;
  if (input.current_value !== undefined) updates.currentValue = input.current_value;
  if (input.unit !== undefined) updates.unit = input.unit;
  if (input.end_date !== undefined) updates.endDate = new Date(input.end_date);
  if (input.status !== undefined) updates.status = input.status;

  const goal = await updateTeamGoal(id, updates);
  res.json({ goal });
}));

// DELETE /team/goals/:id - Delete team goal
router.delete('/team/goals/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await deleteTeamGoal(id);
  res.json({ success: true });
}));

// PUT /team/goals/:id/progress - Update goal progress
router.put('/team/goals/:id/progress', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { current_value } = z.object({ current_value: z.number() }).parse(req.body);

  const goal = await updateGoalProgress(id, current_value);
  res.json({ goal });
}));

// Team Performance Metrics Routes

// POST /team/metrics - Record team metric
router.post('/team/metrics', requireAuth, asyncHandler(async (req, res) => {
  const input = RecordMetricSchema.parse(req.body);

  const metric = await recordTeamMetric(
    input.workspace_id,
    input.metric_type,
    input.metric_value,
    new Date(input.period_start),
    new Date(input.period_end),
    {
      metricUnit: input.metric_unit,
      metadata: input.metadata,
    }
  );

  res.status(201).json({ metric });
}));

// GET /team/metrics - Get team metrics
router.get('/team/metrics', requireAuth, asyncHandler(async (req, res) => {
  const { workspace_id, metric_type, start_date, end_date } = req.query;

  const metrics = await getTeamMetrics(
    workspace_id as string | undefined,
    metric_type as string | undefined,
    start_date ? new Date(start_date as string) : undefined,
    end_date ? new Date(end_date as string) : undefined
  );

  res.json({ metrics });
}));

// GET /team/performance - Calculate team performance
router.get('/team/performance', requireAuth, asyncHandler(async (req, res) => {
  const { workspace_id, period_start, period_end } = req.query;

  if (!period_start || !period_end) {
    return res.status(400).json({ error: 'period_start and period_end are required' });
  }

  const performance = await calculateTeamPerformance(
    workspace_id as string,
    new Date(period_start as string),
    new Date(period_end as string)
  );

  res.json({ performance });
}));

// GET /team/dashboard/:workspaceId - Get team dashboard metrics
router.get('/team/dashboard/:workspaceId', requireAuth, asyncHandler(async (req, res) => {
  const { workspaceId } = req.params;
  const metrics = await getTeamDashboardMetrics(workspaceId);
  res.json(metrics);
}));

export function registerTeamRoutes(app: any) {
  app.use('/api', router);
}
