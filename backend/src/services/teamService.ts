import { dbQuery } from '../db.js';
import { randomUUID } from 'node:crypto';

export interface TeamGoal {
  id: string;
  workspace_id?: string;
  title: string;
  description?: string;
  goal_type: 'custom' | 'performance' | 'quality' | 'efficiency';
  target_value?: number;
  current_value: number;
  unit?: string;
  start_date?: Date;
  end_date?: Date;
  status: 'active' | 'completed' | 'cancelled' | 'overdue';
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface TeamPerformanceMetric {
  id: string;
  workspace_id?: string;
  metric_type: string;
  metric_value: number;
  metric_unit?: string;
  period_start: Date;
  period_end: Date;
  metadata: any;
  calculated_at: Date;
}

// Team Goals
export async function createTeamGoal(
  workspaceId: string | undefined,
  title: string,
  goalType: 'custom' | 'performance' | 'quality' | 'efficiency',
  createdBy: string,
  options?: {
    description?: string;
    targetValue?: number;
    unit?: string;
    startDate?: Date;
    endDate?: Date;
  }
): Promise<TeamGoal> {
  const id = randomUUID();
  const result = await dbQuery(
    `INSERT INTO team_goals (id, workspace_id, title, description, goal_type, target_value, unit, start_date, end_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [id, workspaceId, title, options?.description, goalType, options?.targetValue, options?.unit, options?.startDate, options?.endDate, createdBy]
  );
  return result.rows[0];
}

export async function updateTeamGoal(
  goalId: string,
  updates: {
    title?: string;
    description?: string;
    targetValue?: number;
    currentValue?: number;
    unit?: string;
    endDate?: Date;
    status?: 'active' | 'completed' | 'cancelled' | 'overdue';
  }
): Promise<TeamGoal> {
  const updateFields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.title !== undefined) {
    updateFields.push(`title = $${paramIndex++}`);
    values.push(updates.title);
  }
  if (updates.description !== undefined) {
    updateFields.push(`description = $${paramIndex++}`);
    values.push(updates.description);
  }
  if (updates.targetValue !== undefined) {
    updateFields.push(`target_value = $${paramIndex++}`);
    values.push(updates.targetValue);
  }
  if (updates.currentValue !== undefined) {
    updateFields.push(`current_value = $${paramIndex++}`);
    values.push(updates.currentValue);
  }
  if (updates.unit !== undefined) {
    updateFields.push(`unit = $${paramIndex++}`);
    values.push(updates.unit);
  }
  if (updates.endDate !== undefined) {
    updateFields.push(`end_date = $${paramIndex++}`);
    values.push(updates.endDate);
  }
  if (updates.status !== undefined) {
    updateFields.push(`status = $${paramIndex++}`);
    values.push(updates.status);
  }

  updateFields.push(`updated_at = NOW()`);
  values.push(goalId);

  const result = await dbQuery(
    `UPDATE team_goals SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
  return result.rows[0];
}

export async function listTeamGoals(workspaceId?: string, status?: string): Promise<TeamGoal[]> {
  let query = `SELECT * FROM team_goals WHERE 1=1`;
  const params: any[] = [];

  if (workspaceId) {
    params.push(workspaceId);
    query += ` AND workspace_id = $${params.length}`;
  }

  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }

  query += ` ORDER BY end_date ASC, created_at DESC`;

  const result = await dbQuery(query, params);
  return result.rows;
}

export async function getTeamGoalById(goalId: string): Promise<TeamGoal | null> {
  const result = await dbQuery(`SELECT * FROM team_goals WHERE id = $1`, [goalId]);
  return result.rows[0] || null;
}

export async function deleteTeamGoal(goalId: string): Promise<void> {
  await dbQuery(`DELETE FROM team_goals WHERE id = $1`, [goalId]);
}

export async function updateGoalProgress(goalId: string, currentValue: number): Promise<TeamGoal> {
  const result = await dbQuery(
    `UPDATE team_goals SET current_value = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [currentValue, goalId]
  );
  return result.rows[0];
}

// Team Performance Metrics
export async function recordTeamMetric(
  workspaceId: string | undefined,
  metricType: string,
  metricValue: number,
  periodStart: Date,
  periodEnd: Date,
  options?: {
    metricUnit?: string;
    metadata?: any;
  }
): Promise<TeamPerformanceMetric> {
  const id = randomUUID();
  const result = await dbQuery(
    `INSERT INTO team_performance_metrics (id, workspace_id, metric_type, metric_value, metric_unit, period_start, period_end, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [id, workspaceId, metricType, metricValue, options?.metricUnit, periodStart, periodEnd, JSON.stringify(options?.metadata || {})]
  );
  return result.rows[0];
}

export async function getTeamMetrics(
  workspaceId: string | undefined,
  metricType?: string,
  startDate?: Date,
  endDate?: Date
): Promise<TeamPerformanceMetric[]> {
  let query = `SELECT * FROM team_performance_metrics WHERE 1=1`;
  const params: any[] = [];

  if (workspaceId) {
    params.push(workspaceId);
    query += ` AND workspace_id = $${params.length}`;
  }

  if (metricType) {
    params.push(metricType);
    query += ` AND metric_type = $${params.length}`;
  }

  if (startDate) {
    params.push(startDate);
    query += ` AND period_start >= $${params.length}`;
  }

  if (endDate) {
    params.push(endDate);
    query += ` AND period_end <= $${params.length}`;
  }

  query += ` ORDER BY period_start DESC`;

  const result = await dbQuery(query, params);
  return result.rows;
}

export async function calculateTeamPerformance(workspaceId: string, periodStart: Date, periodEnd: Date): Promise<any> {
  // Calculate various team performance metrics
  const metrics: any = {};

  // Average response time
  const responseTimeResult = await dbQuery(
    `SELECT AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))) as avg_response_time
     FROM service_requests
     WHERE created_at >= $1 AND created_at <= $2
       AND first_response_at IS NOT NULL`,
    [periodStart, periodEnd]
  );
  metrics.avg_response_time = responseTimeResult.rows[0]?.avg_response_time || 0;

  // Completion rate
  const completionResult = await dbQuery(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('done', 'closed')) as completed,
       COUNT(*) as total
     FROM service_requests
     WHERE created_at >= $1 AND created_at <= $2`,
    [periodStart, periodEnd]
  );
  const completionData = completionResult.rows[0];
  metrics.completion_rate = completionData.total > 0 ? (completionData.completed / completionData.total) * 100 : 0;

  // Average resolution time
  const resolutionResult = await dbQuery(
    `SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_resolution_time
     FROM service_requests
     WHERE created_at >= $1 AND created_at <= $2
       AND status IN ('done', 'closed')`,
    [periodStart, periodEnd]
  );
  metrics.avg_resolution_time = resolutionResult.rows[0]?.avg_resolution_time || 0;

  // Total requests handled
  const totalResult = await dbQuery(
    `SELECT COUNT(*) as total_requests
     FROM service_requests
     WHERE created_at >= $1 AND created_at <= $2`,
    [periodStart, periodEnd]
  );
  metrics.total_requests = parseInt(totalResult.rows[0]?.total_requests || 0);

  return metrics;
}

// Dashboard metrics for team workspace
export async function getTeamDashboardMetrics(workspaceId: string): Promise<any> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Get active goals
  const activeGoals = await listTeamGoals(workspaceId, 'active');

  // Get recent metrics
  const recentMetrics = await getTeamMetrics(workspaceId, undefined, weekAgo);

  // Calculate current performance
  const currentPerformance = await calculateTeamPerformance(workspaceId, weekAgo, now);

  return {
    active_goals: activeGoals,
    recent_metrics: recentMetrics,
    current_performance: currentPerformance,
  };
}
