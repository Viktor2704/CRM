import { dbQuery } from '../db.js';
import { logger } from '../logger.js';

export type ForecastData = {
  date: string;
  predicted: number;
  confidence: {
    lower: number;
    upper: number;
  };
};

export type ResourcePrediction = {
  resourceType: string;
  currentUtilization: number;
  predictedUtilization: number;
  recommendation: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
};

export type BottleneckAnalysis = {
  area: string;
  severity: number;
  impact: string;
  affectedRequests: number;
  recommendation: string;
};

export type OptimizationRecommendation = {
  category: string;
  title: string;
  description: string;
  expectedImpact: string;
  effort: 'low' | 'medium' | 'high';
  priority: number;
};

// Simple linear regression for forecasting
const linearRegression = (data: Array<{ x: number; y: number }>): { slope: number; intercept: number } => {
  const n = data.length;
  if (n === 0) return { slope: 0, intercept: 0 };

  const sumX = data.reduce((sum, point) => sum + point.x, 0);
  const sumY = data.reduce((sum, point) => sum + point.y, 0);
  const sumXY = data.reduce((sum, point) => sum + point.x * point.y, 0);
  const sumXX = data.reduce((sum, point) => sum + point.x * point.x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
};

const calculateStandardDeviation = (values: number[]): number => {
  const n = values.length;
  if (n === 0) return 0;

  const mean = values.reduce((sum, val) => sum + val, 0) / n;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
  return Math.sqrt(variance);
};

export const forecastServiceRequestVolume = async (params: {
  daysToForecast: number;
  tenantId?: string;
}): Promise<ForecastData[]> => {
  const tenantFilter = params.tenantId ? `AND tenant_id = $1::uuid` : '';
  const values = params.tenantId ? [params.tenantId] : [];

  // Get historical data for the last 90 days
  const query = `
    SELECT
      DATE(created_at) as date,
      COUNT(*)::int as count
    FROM service_requests
    WHERE created_at >= NOW() - INTERVAL '90 days'
      ${tenantFilter}
      AND deleted_at IS NULL
    GROUP BY DATE(created_at)
    ORDER BY date
  `;

  const result = await dbQuery(query, values);

  if (result.rows.length < 7) {
    // Not enough data for forecasting
    return [];
  }

  // Prepare data for regression
  const historicalData = result.rows.map((row, index) => ({
    x: index,
    y: parseInt(row.count, 10),
  }));

  const { slope, intercept } = linearRegression(historicalData);
  const stdDev = calculateStandardDeviation(historicalData.map((d) => d.y));

  // Generate forecast
  const forecast: ForecastData[] = [];
  const lastIndex = historicalData.length - 1;
  const today = new Date();

  for (let i = 1; i <= params.daysToForecast; i++) {
    const x = lastIndex + i;
    const predicted = Math.max(0, Math.round(slope * x + intercept));
    const confidenceMargin = 1.96 * stdDev; // 95% confidence interval

    const forecastDate = new Date(today);
    forecastDate.setDate(forecastDate.getDate() + i);

    forecast.push({
      date: forecastDate.toISOString().split('T')[0],
      predicted,
      confidence: {
        lower: Math.max(0, Math.round(predicted - confidenceMargin)),
        upper: Math.round(predicted + confidenceMargin),
      },
    });
  }

  return forecast;
};

export const predictResourceNeeds = async (params: {
  tenantId?: string;
}): Promise<ResourcePrediction[]> => {
  const tenantFilter = params.tenantId ? `AND tenant_id = $1::uuid` : '';
  const values = params.tenantId ? [params.tenantId] : [];

  // Analyze current workload and predict resource needs
  const query = `
    WITH current_workload AS (
      SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('done', 'closed', 'cancelled')) as open_requests,
        COUNT(*) FILTER (WHERE status IN ('done', 'closed') AND updated_at >= NOW() - INTERVAL '30 days') as completed_last_month,
        (SELECT COUNT(DISTINCT e) FROM service_requests sr2, unnest(sr2.executor_ids) AS e WHERE sr2.deleted_at IS NULL) as active_assignees
      FROM service_requests
      WHERE deleted_at IS NULL
        ${tenantFilter}
    ),
    avg_completion_time AS (
      SELECT
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600) as avg_hours
      FROM service_requests
      WHERE status IN ('done', 'closed')
        AND created_at >= NOW() - INTERVAL '30 days'
        ${tenantFilter}
        AND deleted_at IS NULL
    ),
    total_users AS (
      SELECT COUNT(*)::int as total
      FROM app_users
      WHERE status = 'active'
    )
    SELECT
      cw.open_requests,
      cw.completed_last_month,
      cw.active_assignees,
      act.avg_hours,
      tu.total as total_users
    FROM current_workload cw, avg_completion_time act, total_users tu
  `;

  const result = await dbQuery(query, values);
  const data = result.rows[0];

  if (!data) {
    return [];
  }

  const openRequests = parseInt(data.open_requests || '0', 10);
  const completedLastMonth = parseInt(data.completed_last_month || '0', 10);
  const activeAssignees = parseInt(data.active_assignees || '0', 10);
  const avgCompletionHours = parseFloat(data.avg_hours || '24');
  const totalUsers = parseInt(data.total_users || '0', 10);

  const predictions: ResourcePrediction[] = [];

  // Staff utilization prediction
  const requestsPerAssignee = activeAssignees > 0 ? openRequests / activeAssignees : 0;
  const optimalRequestsPerAssignee = 5; // Configurable threshold
  const staffUtilization = (requestsPerAssignee / optimalRequestsPerAssignee) * 100;
  const predictedStaffUtilization = staffUtilization * 1.1; // Assume 10% growth

  let staffPriority: 'low' | 'medium' | 'high' | 'critical' = 'low';
  let staffRecommendation = 'Current staffing levels are adequate.';

  if (predictedStaffUtilization > 150) {
    staffPriority = 'critical';
    staffRecommendation = `Critical: Staff is severely overloaded. Consider hiring ${Math.ceil(activeAssignees * 0.5)} additional team members immediately.`;
  } else if (predictedStaffUtilization > 120) {
    staffPriority = 'high';
    staffRecommendation = `High: Staff utilization is high. Consider hiring ${Math.ceil(activeAssignees * 0.3)} additional team members.`;
  } else if (predictedStaffUtilization > 90) {
    staffPriority = 'medium';
    staffRecommendation = 'Medium: Monitor workload closely. Consider temporary contractors if volume increases.';
  }

  predictions.push({
    resourceType: 'Staff',
    currentUtilization: Math.round(staffUtilization),
    predictedUtilization: Math.round(predictedStaffUtilization),
    recommendation: staffRecommendation,
    priority: staffPriority,
  });

  // Response time capacity prediction
  const targetResponseTime = 24; // hours
  const responseTimeCapacity = (targetResponseTime / avgCompletionHours) * 100;
  const predictedResponseCapacity = responseTimeCapacity * 0.9; // Assume degradation

  let responsePriority: 'low' | 'medium' | 'high' | 'critical' = 'low';
  let responseRecommendation = 'Response times are within target.';

  if (predictedResponseCapacity < 50) {
    responsePriority = 'critical';
    responseRecommendation = 'Critical: Response times are far exceeding targets. Immediate process optimization needed.';
  } else if (predictedResponseCapacity < 70) {
    responsePriority = 'high';
    responseRecommendation = 'High: Response times are approaching critical levels. Review and optimize workflows.';
  } else if (predictedResponseCapacity < 90) {
    responsePriority = 'medium';
    responseRecommendation = 'Medium: Response times are acceptable but monitor closely.';
  }

  predictions.push({
    resourceType: 'Response Time Capacity',
    currentUtilization: Math.round(100 - responseTimeCapacity),
    predictedUtilization: Math.round(100 - predictedResponseCapacity),
    recommendation: responseRecommendation,
    priority: responsePriority,
  });

  return predictions;
};

export const identifyBottlenecks = async (params: {
  tenantId?: string;
}): Promise<BottleneckAnalysis[]> => {
  const tenantFilter = params.tenantId ? `AND tenant_id = $1::uuid` : '';
  const values = params.tenantId ? [params.tenantId] : [];

  const bottlenecks: BottleneckAnalysis[] = [];

  // Identify status bottlenecks
  const statusQuery = `
    SELECT
      status,
      COUNT(*)::int as count,
      AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400)::numeric(10,2) as avg_days_in_status
    FROM service_requests
    WHERE status NOT IN ('done', 'closed', 'cancelled')
      ${tenantFilter}
      AND deleted_at IS NULL
    GROUP BY status
    HAVING COUNT(*) > 5 AND AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400) > 7
    ORDER BY avg_days_in_status DESC
  `;

  const statusResult = await dbQuery(statusQuery, values);

  statusResult.rows.forEach((row) => {
    const status = row.status;
    const count = parseInt(row.count, 10);
    const avgDays = parseFloat(row.avg_days_in_status || '0');

    const severity = Math.min(100, Math.round((avgDays / 30) * 100));

    bottlenecks.push({
      area: `Status: ${status}`,
      severity,
      impact: `${count} requests stuck in ${status} status for average of ${avgDays.toFixed(1)} days`,
      affectedRequests: count,
      recommendation: `Review and expedite requests in ${status} status. Consider workflow automation or additional resources.`,
    });
  });

  // Identify priority bottlenecks
  const priorityQuery = `
    SELECT
      priority,
      COUNT(*)::int as count,
      AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400)::numeric(10,2) as avg_days_open
    FROM service_requests
    WHERE status NOT IN ('done', 'closed', 'cancelled')
      AND priority IN ('critical', 'high')
      ${tenantFilter}
      AND deleted_at IS NULL
    GROUP BY priority
    HAVING AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400) > 3
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        ELSE 3
      END
  `;

  const priorityResult = await dbQuery(priorityQuery, values);

  priorityResult.rows.forEach((row) => {
    const priority = row.priority;
    const count = parseInt(row.count, 10);
    const avgDays = parseFloat(row.avg_days_open || '0');

    const severity = priority === 'critical' ? 90 : 70;

    bottlenecks.push({
      area: `Priority: ${priority}`,
      severity,
      impact: `${count} ${priority} priority requests open for average of ${avgDays.toFixed(1)} days`,
      affectedRequests: count,
      recommendation: `Escalate ${priority} priority requests immediately. Assign dedicated resources to clear backlog.`,
    });
  });

  // Identify unassigned requests bottleneck
  const unassignedQuery = `
    SELECT
      COUNT(*)::int as count,
      AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400)::numeric(10,2) as avg_days_unassigned
    FROM service_requests
    WHERE (executor_ids IS NULL OR array_length(executor_ids, 1) IS NULL)
      AND status NOT IN ('done', 'closed', 'cancelled')
      ${tenantFilter}
      AND deleted_at IS NULL
    HAVING COUNT(*) > 3
  `;

  const unassignedResult = await dbQuery(unassignedQuery, values);

  if (unassignedResult.rows.length > 0) {
    const count = parseInt(unassignedResult.rows[0].count || '0', 10);
    const avgDays = parseFloat(unassignedResult.rows[0].avg_days_unassigned || '0');

    if (count > 0) {
      const severity = Math.min(100, Math.round((count / 10) * 100));

      bottlenecks.push({
        area: 'Unassigned Requests',
        severity,
        impact: `${count} requests unassigned for average of ${avgDays.toFixed(1)} days`,
        affectedRequests: count,
        recommendation: 'Implement automatic assignment rules or review assignment process to reduce unassigned request backlog.',
      });
    }
  }

  return bottlenecks.sort((a, b) => b.severity - a.severity);
};

export const generateOptimizationRecommendations = async (params: {
  tenantId?: string;
}): Promise<OptimizationRecommendation[]> => {
  const recommendations: OptimizationRecommendation[] = [];

  // Get bottlenecks and resource predictions
  const [bottlenecks, resourcePredictions] = await Promise.all([
    identifyBottlenecks(params),
    predictResourceNeeds(params),
  ]);

  // Generate recommendations based on bottlenecks
  if (bottlenecks.length > 0) {
    const topBottleneck = bottlenecks[0];

    if (topBottleneck.area.includes('Unassigned')) {
      recommendations.push({
        category: 'Workflow Automation',
        title: 'Implement Automatic Request Assignment',
        description: 'Set up rules to automatically assign incoming requests based on workload, expertise, and availability.',
        expectedImpact: `Reduce unassigned request backlog by ${topBottleneck.affectedRequests} requests`,
        effort: 'medium',
        priority: 90,
      });
    }

    if (topBottleneck.area.includes('Status')) {
      recommendations.push({
        category: 'Process Optimization',
        title: 'Streamline Status Workflow',
        description: 'Review and optimize the workflow for requests stuck in specific statuses. Consider removing unnecessary steps.',
        expectedImpact: `Reduce average time in status by 30-50%`,
        effort: 'high',
        priority: 85,
      });
    }

    if (topBottleneck.area.includes('Priority')) {
      recommendations.push({
        category: 'Resource Allocation',
        title: 'Dedicated High-Priority Team',
        description: 'Create a dedicated team or rotation to handle critical and high-priority requests exclusively.',
        expectedImpact: `Reduce high-priority request resolution time by 40%`,
        effort: 'medium',
        priority: 95,
      });
    }
  }

  // Generate recommendations based on resource predictions
  resourcePredictions.forEach((prediction) => {
    if (prediction.priority === 'critical' || prediction.priority === 'high') {
      if (prediction.resourceType === 'Staff') {
        recommendations.push({
          category: 'Staffing',
          title: 'Increase Team Capacity',
          description: prediction.recommendation,
          expectedImpact: 'Reduce staff utilization to optimal levels (80-90%)',
          effort: 'high',
          priority: prediction.priority === 'critical' ? 100 : 80,
        });
      }

      if (prediction.resourceType === 'Response Time Capacity') {
        recommendations.push({
          category: 'Performance',
          title: 'Optimize Response Time',
          description: 'Implement process improvements and automation to reduce average response time.',
          expectedImpact: 'Reduce average response time by 25-40%',
          effort: 'medium',
          priority: 75,
        });
      }
    }
  });

  // General optimization recommendations
  recommendations.push({
    category: 'Analytics',
    title: 'Implement Real-Time Monitoring',
    description: 'Set up real-time dashboards and alerts for key metrics to identify issues proactively.',
    expectedImpact: 'Reduce incident response time by 50%',
    effort: 'low',
    priority: 70,
  });

  recommendations.push({
    category: 'Customer Experience',
    title: 'Self-Service Portal Enhancement',
    description: 'Expand knowledge base and self-service options to reduce incoming request volume.',
    expectedImpact: 'Reduce request volume by 15-20%',
    effort: 'medium',
    priority: 65,
  });

  recommendations.push({
    category: 'Automation',
    title: 'AI-Powered Request Categorization',
    description: 'Use AI to automatically categorize and prioritize incoming requests for faster routing.',
    expectedImpact: 'Reduce manual categorization time by 80%',
    effort: 'medium',
    priority: 60,
  });

  return recommendations.sort((a, b) => b.priority - a.priority);
};

export const calculateTrendVelocity = async (params: {
  metric: 'volume' | 'response_time' | 'completion_rate';
  tenantId?: string;
}): Promise<{ velocity: number; direction: 'increasing' | 'decreasing' | 'stable' }> => {
  const tenantFilter = params.tenantId ? `AND tenant_id = $1::uuid` : '';
  const values = params.tenantId ? [params.tenantId] : [];

  let query: string;

  switch (params.metric) {
    case 'volume':
      query = `
        SELECT
          DATE(created_at) as date,
          COUNT(*)::int as value
        FROM service_requests
        WHERE created_at >= NOW() - INTERVAL '30 days'
          ${tenantFilter}
          AND deleted_at IS NULL
        GROUP BY DATE(created_at)
        ORDER BY date
      `;
      break;

    case 'response_time':
      query = `
        SELECT
          DATE(created_at) as date,
          AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600)::numeric(10,2) as value
        FROM service_requests
        WHERE status IN ('done', 'closed')
          AND created_at >= NOW() - INTERVAL '30 days'
          ${tenantFilter}
          AND deleted_at IS NULL
        GROUP BY DATE(created_at)
        ORDER BY date
      `;
      break;

    case 'completion_rate':
      query = `
        SELECT
          DATE(created_at) as date,
          (COUNT(*) FILTER (WHERE status IN ('done', 'closed'))::float / NULLIF(COUNT(*), 0) * 100)::numeric(10,2) as value
        FROM service_requests
        WHERE created_at >= NOW() - INTERVAL '30 days'
          ${tenantFilter}
          AND deleted_at IS NULL
        GROUP BY DATE(created_at)
        ORDER BY date
      `;
      break;
  }

  const result = await dbQuery(query, values);

  if (result.rows.length < 7) {
    return { velocity: 0, direction: 'stable' };
  }

  const data = result.rows.map((row, index) => ({
    x: index,
    y: parseFloat(row.value || '0'),
  }));

  const { slope } = linearRegression(data);

  let direction: 'increasing' | 'decreasing' | 'stable';
  const threshold = 0.1;

  if (Math.abs(slope) < threshold) {
    direction = 'stable';
  } else if (slope > 0) {
    direction = 'increasing';
  } else {
    direction = 'decreasing';
  }

  return {
    velocity: Math.round(slope * 100) / 100,
    direction,
  };
};
