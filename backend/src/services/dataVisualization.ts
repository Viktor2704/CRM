import { dbQuery } from '../db.js';
import { logger } from '../logger.js';

export type ChartType = 'line' | 'bar' | 'pie' | 'heatmap' | 'area' | 'scatter';

export type ChartData = {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string;
    fill?: boolean;
  }>;
};

export type HeatmapData = {
  x: string[];
  y: string[];
  values: number[][];
};

export type DrillDownData = {
  level: string;
  data: any[];
  metadata: {
    totalRecords: number;
    aggregations?: Record<string, number>;
  };
};

const CHART_COLORS = {
  primary: '#3b82f6',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#06b6d4',
  purple: '#8b5cf6',
  pink: '#ec4899',
  gray: '#6b7280',
};

const STATUS_COLORS: Record<string, string> = {
  new: CHART_COLORS.info,
  in_progress: CHART_COLORS.warning,
  pending: CHART_COLORS.gray,
  done: CHART_COLORS.success,
  closed: CHART_COLORS.primary,
  cancelled: CHART_COLORS.danger,
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: CHART_COLORS.danger,
  high: CHART_COLORS.warning,
  medium: CHART_COLORS.info,
  low: CHART_COLORS.gray,
};

export const generateStatusDistributionChart = async (params: {
  entityType: 'service_requests' | 'projects' | 'installations';
  startDate?: string;
  endDate?: string;
  tenantId?: string;
}): Promise<ChartData> => {
  const table = params.entityType;
  const tenantFilter = params.tenantId ? `AND tenant_id = $3::uuid` : '';
  const dateFilter = params.startDate && params.endDate
    ? `AND created_at >= $1::timestamptz AND created_at <= $2::timestamptz`
    : '';

  const values: any[] = [];
  if (params.startDate && params.endDate) {
    values.push(params.startDate, params.endDate);
  }
  if (params.tenantId) {
    values.push(params.tenantId);
  }

  const query = `
    SELECT
      status,
      COUNT(*)::int as count
    FROM ${table}
    WHERE deleted_at IS NULL
      ${dateFilter}
      ${tenantFilter}
    GROUP BY status
    ORDER BY count DESC
  `;

  const result = await dbQuery(query, values);

  const labels = result.rows.map((row) => row.status || 'unknown');
  const data = result.rows.map((row) => parseInt(row.count, 10));
  const backgroundColor = labels.map((status) => STATUS_COLORS[status] || CHART_COLORS.gray);

  return {
    labels,
    datasets: [
      {
        label: 'Count by Status',
        data,
        backgroundColor,
      },
    ],
  };
};

export const generatePriorityDistributionChart = async (params: {
  entityType: 'service_requests' | 'projects' | 'installations';
  startDate?: string;
  endDate?: string;
  tenantId?: string;
}): Promise<ChartData> => {
  const table = params.entityType;
  const tenantFilter = params.tenantId ? `AND tenant_id = $3::uuid` : '';
  const dateFilter = params.startDate && params.endDate
    ? `AND created_at >= $1::timestamptz AND created_at <= $2::timestamptz`
    : '';

  const values: any[] = [];
  if (params.startDate && params.endDate) {
    values.push(params.startDate, params.endDate);
  }
  if (params.tenantId) {
    values.push(params.tenantId);
  }

  const query = `
    SELECT
      priority,
      COUNT(*)::int as count
    FROM ${table}
    WHERE deleted_at IS NULL
      ${dateFilter}
      ${tenantFilter}
    GROUP BY priority
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END
  `;

  const result = await dbQuery(query, values);

  const labels = result.rows.map((row) => row.priority || 'unknown');
  const data = result.rows.map((row) => parseInt(row.count, 10));
  const backgroundColor = labels.map((priority) => PRIORITY_COLORS[priority] || CHART_COLORS.gray);

  return {
    labels,
    datasets: [
      {
        label: 'Count by Priority',
        data,
        backgroundColor,
      },
    ],
  };
};

export const generateVolumeOverTimeChart = async (params: {
  entityType: 'service_requests' | 'projects' | 'installations';
  granularity: 'day' | 'week' | 'month';
  startDate: string;
  endDate: string;
  tenantId?: string;
  groupBy?: 'status' | 'priority';
}): Promise<ChartData> => {
  const table = params.entityType;
  const tenantFilter = params.tenantId ? `AND tenant_id = $3::uuid` : '';

  let dateTrunc: string;
  let dateFormat: string;

  switch (params.granularity) {
    case 'day':
      dateTrunc = 'day';
      dateFormat = 'YYYY-MM-DD';
      break;
    case 'week':
      dateTrunc = 'week';
      dateFormat = 'IYYY-IW';
      break;
    case 'month':
      dateTrunc = 'month';
      dateFormat = 'YYYY-MM';
      break;
  }

  const values: any[] = [params.startDate, params.endDate];
  if (params.tenantId) {
    values.push(params.tenantId);
  }

  let query: string;

  if (params.groupBy) {
    query = `
      SELECT
        TO_CHAR(DATE_TRUNC('${dateTrunc}', created_at), '${dateFormat}') as date,
        ${params.groupBy},
        COUNT(*)::int as count
      FROM ${table}
      WHERE created_at >= $1::timestamptz
        AND created_at <= $2::timestamptz
        ${tenantFilter}
        AND deleted_at IS NULL
      GROUP BY DATE_TRUNC('${dateTrunc}', created_at), ${params.groupBy}
      ORDER BY DATE_TRUNC('${dateTrunc}', created_at), ${params.groupBy}
    `;
  } else {
    query = `
      SELECT
        TO_CHAR(DATE_TRUNC('${dateTrunc}', created_at), '${dateFormat}') as date,
        COUNT(*)::int as count
      FROM ${table}
      WHERE created_at >= $1::timestamptz
        AND created_at <= $2::timestamptz
        ${tenantFilter}
        AND deleted_at IS NULL
      GROUP BY DATE_TRUNC('${dateTrunc}', created_at)
      ORDER BY DATE_TRUNC('${dateTrunc}', created_at)
    `;
  }

  const result = await dbQuery(query, values);

  if (!params.groupBy) {
    const labels = result.rows.map((row) => row.date);
    const data = result.rows.map((row) => parseInt(row.count, 10));

    return {
      labels,
      datasets: [
        {
          label: 'Volume',
          data,
          borderColor: CHART_COLORS.primary,
          backgroundColor: CHART_COLORS.primary + '20',
          fill: true,
        },
      ],
    };
  }

  // Group by status or priority
  const groupedData: Record<string, Record<string, number>> = {};
  const allDates = new Set<string>();
  const allGroups = new Set<string>();

  result.rows.forEach((row) => {
    const date = row.date;
    const group = row[params.groupBy!] || 'unknown';
    const count = parseInt(row.count, 10);

    allDates.add(date);
    allGroups.add(group);

    if (!groupedData[group]) {
      groupedData[group] = {};
    }
    groupedData[group][date] = count;
  });

  const labels = Array.from(allDates).sort();
  const datasets = Array.from(allGroups).map((group) => {
    const data = labels.map((date) => groupedData[group][date] || 0);
    const colorMap = params.groupBy === 'status' ? STATUS_COLORS : PRIORITY_COLORS;

    return {
      label: group,
      data,
      borderColor: colorMap[group] || CHART_COLORS.gray,
      backgroundColor: (colorMap[group] || CHART_COLORS.gray) + '20',
      fill: false,
    };
  });

  return { labels, datasets };
};

export const generateResponseTimeHeatmap = async (params: {
  startDate: string;
  endDate: string;
  tenantId?: string;
}): Promise<HeatmapData> => {
  const tenantFilter = params.tenantId ? `AND tenant_id = $3::uuid` : '';
  const values: any[] = [params.startDate, params.endDate];
  if (params.tenantId) {
    values.push(params.tenantId);
  }

  const query = `
    SELECT
      EXTRACT(DOW FROM created_at)::int as day_of_week,
      EXTRACT(HOUR FROM created_at)::int as hour_of_day,
      AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600)::numeric(10,2) as avg_response_time
    FROM service_requests
    WHERE status IN ('done', 'closed')
      AND created_at >= $1::timestamptz
      AND created_at <= $2::timestamptz
      ${tenantFilter}
      AND deleted_at IS NULL
    GROUP BY day_of_week, hour_of_day
    ORDER BY day_of_week, hour_of_day
  `;

  const result = await dbQuery(query, values);

  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);

  // Initialize matrix with zeros
  const values_matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

  result.rows.forEach((row) => {
    const day = parseInt(row.day_of_week, 10);
    const hour = parseInt(row.hour_of_day, 10);
    const avgTime = parseFloat(row.avg_response_time || '0');
    values_matrix[day][hour] = avgTime;
  });

  return {
    x: hours,
    y: daysOfWeek,
    values: values_matrix,
  };
};

export const generateWorkloadHeatmap = async (params: {
  startDate: string;
  endDate: string;
  tenantId?: string;
}): Promise<HeatmapData> => {
  const tenantFilter = params.tenantId ? `AND tenant_id = $3::uuid` : '';
  const values: any[] = [params.startDate, params.endDate];
  if (params.tenantId) {
    values.push(params.tenantId);
  }

  const query = `
    SELECT
      EXTRACT(DOW FROM created_at)::int as day_of_week,
      EXTRACT(HOUR FROM created_at)::int as hour_of_day,
      COUNT(*)::int as request_count
    FROM service_requests
    WHERE created_at >= $1::timestamptz
      AND created_at <= $2::timestamptz
      ${tenantFilter}
      AND deleted_at IS NULL
    GROUP BY day_of_week, hour_of_day
    ORDER BY day_of_week, hour_of_day
  `;

  const result = await dbQuery(query, values);

  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);

  // Initialize matrix with zeros
  const values_matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

  result.rows.forEach((row) => {
    const day = parseInt(row.day_of_week, 10);
    const hour = parseInt(row.hour_of_day, 10);
    const count = parseInt(row.request_count, 10);
    values_matrix[day][hour] = count;
  });

  return {
    x: hours,
    y: daysOfWeek,
    values: values_matrix,
  };
};

export const drillDownByStatus = async (params: {
  entityType: 'service_requests' | 'projects' | 'installations';
  status: string;
  startDate?: string;
  endDate?: string;
  tenantId?: string;
  limit?: number;
  offset?: number;
}): Promise<DrillDownData> => {
  const table = params.entityType;
  const tenantFilter = params.tenantId ? `AND tenant_id = $${params.startDate && params.endDate ? 4 : 2}::uuid` : '';
  const dateFilter = params.startDate && params.endDate
    ? `AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz`
    : '';

  const values: any[] = [params.status];
  if (params.startDate && params.endDate) {
    values.push(params.startDate, params.endDate);
  }
  if (params.tenantId) {
    values.push(params.tenantId);
  }

  const limit = Math.min(params.limit || 50, 200);
  const offset = params.offset || 0;

  const query = `
    SELECT
      id::text,
      title,
      status,
      priority,
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM ${table}
    WHERE status = $1
      ${dateFilter}
      ${tenantFilter}
      AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const countQuery = `
    SELECT COUNT(*)::int as total
    FROM ${table}
    WHERE status = $1
      ${dateFilter}
      ${tenantFilter}
      AND deleted_at IS NULL
  `;

  const [dataResult, countResult] = await Promise.all([
    dbQuery(query, values),
    dbQuery(countQuery, values),
  ]);

  return {
    level: 'status',
    data: dataResult.rows,
    metadata: {
      totalRecords: countResult.rows[0]?.total || 0,
    },
  };
};

export const drillDownByPriority = async (params: {
  entityType: 'service_requests' | 'projects' | 'installations';
  priority: string;
  startDate?: string;
  endDate?: string;
  tenantId?: string;
  limit?: number;
  offset?: number;
}): Promise<DrillDownData> => {
  const table = params.entityType;
  const tenantFilter = params.tenantId ? `AND tenant_id = $${params.startDate && params.endDate ? 4 : 2}::uuid` : '';
  const dateFilter = params.startDate && params.endDate
    ? `AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz`
    : '';

  const values: any[] = [params.priority];
  if (params.startDate && params.endDate) {
    values.push(params.startDate, params.endDate);
  }
  if (params.tenantId) {
    values.push(params.tenantId);
  }

  const limit = Math.min(params.limit || 50, 200);
  const offset = params.offset || 0;

  const query = `
    SELECT
      id::text,
      title,
      status,
      priority,
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM ${table}
    WHERE priority = $1
      ${dateFilter}
      ${tenantFilter}
      AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const countQuery = `
    SELECT COUNT(*)::int as total
    FROM ${table}
    WHERE priority = $1
      ${dateFilter}
      ${tenantFilter}
      AND deleted_at IS NULL
  `;

  const [dataResult, countResult] = await Promise.all([
    dbQuery(query, values),
    dbQuery(countQuery, values),
  ]);

  return {
    level: 'priority',
    data: dataResult.rows,
    metadata: {
      totalRecords: countResult.rows[0]?.total || 0,
    },
  };
};

export const generateTopPerformersChart = async (params: {
  metric: 'completion_count' | 'avg_response_time' | 'satisfaction_score';
  startDate: string;
  endDate: string;
  limit?: number;
}): Promise<ChartData> => {
  const limit = Math.min(params.limit || 10, 50);

  let query: string;

  switch (params.metric) {
    case 'completion_count':
      query = `
        SELECT
          u.name as performer,
          COUNT(*)::int as value
        FROM service_requests sr
        JOIN users u ON u.id = sr.assigned_to_id
        WHERE sr.status IN ('done', 'closed')
          AND sr.created_at >= $1::timestamptz
          AND sr.created_at <= $2::timestamptz
          AND sr.deleted_at IS NULL
          AND u.deleted_at IS NULL
        GROUP BY u.id, u.name
        ORDER BY value DESC
        LIMIT ${limit}
      `;
      break;

    case 'avg_response_time':
      query = `
        SELECT
          u.name as performer,
          AVG(EXTRACT(EPOCH FROM (sr.updated_at - sr.created_at)) / 3600)::numeric(10,2) as value
        FROM service_requests sr
        JOIN users u ON u.id = sr.assigned_to_id
        WHERE sr.status IN ('done', 'closed')
          AND sr.created_at >= $1::timestamptz
          AND sr.created_at <= $2::timestamptz
          AND sr.deleted_at IS NULL
          AND u.deleted_at IS NULL
        GROUP BY u.id, u.name
        HAVING COUNT(*) >= 3
        ORDER BY value ASC
        LIMIT ${limit}
      `;
      break;

    case 'satisfaction_score':
      query = `
        SELECT
          u.name as performer,
          AVG(CASE
            WHEN af.sentiment = 'positive' THEN 5
            WHEN af.sentiment = 'neutral' THEN 3
            WHEN af.sentiment = 'negative' THEN 1
            ELSE 3
          END)::numeric(10,2) as value
        FROM ai_feedback af
        JOIN service_requests sr ON sr.id::text = af.entity_id
        JOIN users u ON u.id = sr.assigned_to_id
        WHERE af.entity_type = 'service_request'
          AND af.created_at >= $1::timestamptz
          AND af.created_at <= $2::timestamptz
          AND af.deleted_at IS NULL
          AND sr.deleted_at IS NULL
          AND u.deleted_at IS NULL
        GROUP BY u.id, u.name
        HAVING COUNT(*) >= 3
        ORDER BY value DESC
        LIMIT ${limit}
      `;
      break;
  }

  const result = await dbQuery(query, [params.startDate, params.endDate]);

  const labels = result.rows.map((row) => row.performer || 'Unknown');
  const data = result.rows.map((row) => parseFloat(row.value || '0'));

  return {
    labels,
    datasets: [
      {
        label: params.metric.replace(/_/g, ' '),
        data,
        backgroundColor: CHART_COLORS.primary,
      },
    ],
  };
};
