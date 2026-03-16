import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';

export type TimeRange = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

export type AnalyticsMetrics = {
  responseTime: {
    average: number;
    median: number;
    p95: number;
    trend: number;
  };
  completionRate: {
    rate: number;
    total: number;
    completed: number;
    trend: number;
  };
  customerSatisfaction: {
    score: number;
    total: number;
    trend: number;
  };
  volumeMetrics: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    trend: number;
  };
};

export type TrendData = {
  date: string;
  value: number;
  label?: string;
};

export type ComparativeData = {
  current: number;
  previous: number;
  change: number;
  changePercent: number;
};

const getDateRangeFilter = (range: TimeRange, customStart?: string, customEnd?: string): { start: string; end: string; previousStart: string; previousEnd: string } => {
  const now = new Date();
  const end = new Date(now);
  let start = new Date(now);
  let previousEnd = new Date(now);
  let previousStart = new Date(now);

  switch (range) {
    case 'day':
      start.setDate(start.getDate() - 1);
      previousEnd = new Date(start);
      previousStart.setDate(previousStart.getDate() - 2);
      break;
    case 'week':
      start.setDate(start.getDate() - 7);
      previousEnd = new Date(start);
      previousStart.setDate(previousStart.getDate() - 14);
      break;
    case 'month':
      start.setMonth(start.getMonth() - 1);
      previousEnd = new Date(start);
      previousStart.setMonth(previousStart.getMonth() - 2);
      break;
    case 'quarter':
      start.setMonth(start.getMonth() - 3);
      previousEnd = new Date(start);
      previousStart.setMonth(previousStart.getMonth() - 6);
      break;
    case 'year':
      start.setFullYear(start.getFullYear() - 1);
      previousEnd = new Date(start);
      previousStart.setFullYear(previousStart.getFullYear() - 2);
      break;
    case 'custom':
      if (customStart && customEnd) {
        start = new Date(customStart);
        end.setTime(new Date(customEnd).getTime());
        const duration = end.getTime() - start.getTime();
        previousEnd = new Date(start);
        previousStart = new Date(start.getTime() - duration);
      }
      break;
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    previousStart: previousStart.toISOString(),
    previousEnd: previousEnd.toISOString(),
  };
};

export const getAnalyticsMetrics = async (params: {
  range: TimeRange;
  customStart?: string;
  customEnd?: string;
  tenantId?: string;
}): Promise<AnalyticsMetrics> => {
  const { start, end, previousStart, previousEnd } = getDateRangeFilter(params.range, params.customStart, params.customEnd);

  const tenantFilter = params.tenantId ? `AND tenant_id = $3::uuid` : '';
  const tenantValues = params.tenantId ? [params.tenantId] : [];

  // Response Time Metrics
  const responseTimeQuery = `
    WITH current_period AS (
      SELECT
        EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600 as hours
      FROM service_requests
      WHERE status IN ('done', 'closed')
        AND created_at >= $1::timestamptz
        AND created_at <= $2::timestamptz
        ${tenantFilter}
        AND deleted_at IS NULL
    ),
    previous_period AS (
      SELECT
        EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600 as hours
      FROM service_requests
      WHERE status IN ('done', 'closed')
        AND created_at >= $3::timestamptz
        AND created_at <= $4::timestamptz
        ${tenantFilter}
        AND deleted_at IS NULL
    )
    SELECT
      (SELECT AVG(hours) FROM current_period) as current_avg,
      (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hours) FROM current_period) as current_median,
      (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY hours) FROM current_period) as current_p95,
      (SELECT AVG(hours) FROM previous_period) as previous_avg
  `;

  const responseTimeResult = await dbQuery(responseTimeQuery, [start, end, previousStart, previousEnd, ...tenantValues]);
  const responseTimeData = responseTimeResult.rows[0];

  const currentAvg = parseFloat(responseTimeData?.current_avg || '0');
  const previousAvg = parseFloat(responseTimeData?.previous_avg || '0');
  const responseTimeTrend = previousAvg > 0 ? ((currentAvg - previousAvg) / previousAvg) * 100 : 0;

  // Completion Rate Metrics
  const completionQuery = `
    WITH current_period AS (
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status IN ('done', 'closed')) as completed
      FROM service_requests
      WHERE created_at >= $1::timestamptz
        AND created_at <= $2::timestamptz
        ${tenantFilter}
        AND deleted_at IS NULL
    ),
    previous_period AS (
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status IN ('done', 'closed')) as completed
      FROM service_requests
      WHERE created_at >= $3::timestamptz
        AND created_at <= $4::timestamptz
        ${tenantFilter}
        AND deleted_at IS NULL
    )
    SELECT
      (SELECT total FROM current_period) as current_total,
      (SELECT completed FROM current_period) as current_completed,
      (SELECT total FROM previous_period) as previous_total,
      (SELECT completed FROM previous_period) as previous_completed
  `;

  const completionResult = await dbQuery(completionQuery, [start, end, previousStart, previousEnd, ...tenantValues]);
  const completionData = completionResult.rows[0];

  const currentTotal = parseInt(completionData?.current_total || '0', 10);
  const currentCompleted = parseInt(completionData?.current_completed || '0', 10);
  const previousTotal = parseInt(completionData?.previous_total || '0', 10);
  const previousCompleted = parseInt(completionData?.previous_completed || '0', 10);

  const currentRate = currentTotal > 0 ? (currentCompleted / currentTotal) * 100 : 0;
  const previousRate = previousTotal > 0 ? (previousCompleted / previousTotal) * 100 : 0;
  const completionTrend = previousRate > 0 ? ((currentRate - previousRate) / previousRate) * 100 : 0;

  // Customer Satisfaction (based on feedback if available)
  const satisfactionQuery = `
    WITH current_period AS (
      SELECT
        COUNT(*) as total,
        AVG(CASE
          WHEN rating = 'positive' THEN 5
          WHEN rating = 'negative' THEN 1
          ELSE 3
        END) as score
      FROM ai_feedback
      WHERE created_at >= $1::timestamptz
        AND created_at <= $2::timestamptz
    ),
    previous_period AS (
      SELECT
        AVG(CASE
          WHEN rating = 'positive' THEN 5
          WHEN rating = 'negative' THEN 1
          ELSE 3
        END) as score
      FROM ai_feedback
      WHERE created_at >= $3::timestamptz
        AND created_at <= $4::timestamptz
    )
    SELECT
      (SELECT score FROM current_period) as current_score,
      (SELECT total FROM current_period) as current_total,
      (SELECT score FROM previous_period) as previous_score
  `;

  const satisfactionResult = await dbQuery(satisfactionQuery, [start, end, previousStart, previousEnd]);
  const satisfactionData = satisfactionResult.rows[0];

  const currentScore = parseFloat(satisfactionData?.current_score || '3');
  const previousScore = parseFloat(satisfactionData?.previous_score || '3');
  const satisfactionTotal = parseInt(satisfactionData?.current_total || '0', 10);
  const satisfactionTrend = previousScore > 0 ? ((currentScore - previousScore) / previousScore) * 100 : 0;

  // Volume Metrics
  const volumeQuery = `
    WITH current_period AS (
      SELECT
        COUNT(*) as total,
        status,
        priority
      FROM service_requests
      WHERE created_at >= $1::timestamptz
        AND created_at <= $2::timestamptz
        ${tenantFilter}
        AND deleted_at IS NULL
      GROUP BY status, priority
    ),
    previous_period AS (
      SELECT COUNT(*) as total
      FROM service_requests
      WHERE created_at >= $3::timestamptz
        AND created_at <= $4::timestamptz
        ${tenantFilter}
        AND deleted_at IS NULL
    )
    SELECT
      (SELECT SUM(total) FROM current_period) as current_total,
      (SELECT total FROM previous_period) as previous_total,
      COALESCE(json_object_agg(status, status_count) FILTER (WHERE status IS NOT NULL), '{}') as by_status,
      COALESCE(json_object_agg(priority, priority_count) FILTER (WHERE priority IS NOT NULL), '{}') as by_priority
    FROM (
      SELECT
        status,
        priority,
        SUM(total) OVER (PARTITION BY status) as status_count,
        SUM(total) OVER (PARTITION BY priority) as priority_count
      FROM current_period
      WHERE status IS NOT NULL
    ) subq
    GROUP BY current_total, previous_total
  `;

  const volumeResult = await dbQuery(volumeQuery, [start, end, previousStart, previousEnd, ...tenantValues]);
  const volumeData = volumeResult.rows[0];

  const currentVolume = parseInt(volumeData?.current_total || '0', 10);
  const previousVolume = parseInt(volumeData?.previous_total || '0', 10);
  const volumeTrend = previousVolume > 0 ? ((currentVolume - previousVolume) / previousVolume) * 100 : 0;

  return {
    responseTime: {
      average: currentAvg,
      median: parseFloat(responseTimeData?.current_median || '0'),
      p95: parseFloat(responseTimeData?.current_p95 || '0'),
      trend: responseTimeTrend,
    },
    completionRate: {
      rate: currentRate,
      total: currentTotal,
      completed: currentCompleted,
      trend: completionTrend,
    },
    customerSatisfaction: {
      score: currentScore,
      total: satisfactionTotal,
      trend: satisfactionTrend,
    },
    volumeMetrics: {
      total: currentVolume,
      byStatus: volumeData?.by_status || {},
      byPriority: volumeData?.by_priority || {},
      trend: volumeTrend,
    },
  };
};

export const getTrendAnalysis = async (params: {
  metric: 'volume' | 'response_time' | 'completion_rate' | 'satisfaction';
  range: TimeRange;
  granularity: 'hour' | 'day' | 'week' | 'month';
  customStart?: string;
  customEnd?: string;
  tenantId?: string;
}): Promise<TrendData[]> => {
  const { start, end } = getDateRangeFilter(params.range, params.customStart, params.customEnd);

  const tenantFilter = params.tenantId ? `AND tenant_id = $3::uuid` : '';
  const tenantValues = params.tenantId ? [params.tenantId] : [];

  let dateFormat: string;
  let dateTrunc: string;

  switch (params.granularity) {
    case 'hour':
      dateFormat = 'YYYY-MM-DD HH24:00';
      dateTrunc = 'hour';
      break;
    case 'day':
      dateFormat = 'YYYY-MM-DD';
      dateTrunc = 'day';
      break;
    case 'week':
      dateFormat = 'IYYY-IW';
      dateTrunc = 'week';
      break;
    case 'month':
      dateFormat = 'YYYY-MM';
      dateTrunc = 'month';
      break;
  }

  let query: string;

  switch (params.metric) {
    case 'volume':
      query = `
        SELECT
          TO_CHAR(DATE_TRUNC('${dateTrunc}', created_at), '${dateFormat}') as date,
          COUNT(*)::int as value
        FROM service_requests
        WHERE created_at >= $1::timestamptz
          AND created_at <= $2::timestamptz
          ${tenantFilter}
          AND deleted_at IS NULL
        GROUP BY DATE_TRUNC('${dateTrunc}', created_at)
        ORDER BY DATE_TRUNC('${dateTrunc}', created_at)
      `;
      break;

    case 'response_time':
      query = `
        SELECT
          TO_CHAR(DATE_TRUNC('${dateTrunc}', created_at), '${dateFormat}') as date,
          AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600)::numeric(10,2) as value
        FROM service_requests
        WHERE status IN ('done', 'closed')
          AND created_at >= $1::timestamptz
          AND created_at <= $2::timestamptz
          ${tenantFilter}
          AND deleted_at IS NULL
        GROUP BY DATE_TRUNC('${dateTrunc}', created_at)
        ORDER BY DATE_TRUNC('${dateTrunc}', created_at)
      `;
      break;

    case 'completion_rate':
      query = `
        SELECT
          TO_CHAR(DATE_TRUNC('${dateTrunc}', created_at), '${dateFormat}') as date,
          (COUNT(*) FILTER (WHERE status IN ('done', 'closed'))::float / NULLIF(COUNT(*), 0) * 100)::numeric(10,2) as value
        FROM service_requests
        WHERE created_at >= $1::timestamptz
          AND created_at <= $2::timestamptz
          ${tenantFilter}
          AND deleted_at IS NULL
        GROUP BY DATE_TRUNC('${dateTrunc}', created_at)
        ORDER BY DATE_TRUNC('${dateTrunc}', created_at)
      `;
      break;

    case 'satisfaction':
      query = `
        SELECT
          TO_CHAR(DATE_TRUNC('${dateTrunc}', created_at), '${dateFormat}') as date,
          AVG(CASE
            WHEN rating = 'positive' THEN 5
            WHEN rating = 'negative' THEN 1
            ELSE 3
          END)::numeric(10,2) as value
        FROM ai_feedback
        WHERE created_at >= $1::timestamptz
          AND created_at <= $2::timestamptz
        GROUP BY DATE_TRUNC('${dateTrunc}', created_at)
        ORDER BY DATE_TRUNC('${dateTrunc}', created_at)
      `;
      break;
  }

  const result = await dbQuery(query, [start, end, ...tenantValues]);

  return result.rows.map((row) => ({
    date: row.date,
    value: parseFloat(row.value || '0'),
    label: row.date,
  }));
};

export const getComparativeAnalysis = async (params: {
  metric: 'volume' | 'response_time' | 'completion_rate' | 'satisfaction';
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
  tenantId?: string;
}): Promise<ComparativeData> => {
  const tenantFilter = params.tenantId ? `AND tenant_id = $5::uuid` : '';
  const tenantValues = params.tenantId ? [params.tenantId] : [];

  let query: string;

  switch (params.metric) {
    case 'volume':
      query = `
        SELECT
          (SELECT COUNT(*) FROM service_requests
           WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
           ${tenantFilter} AND deleted_at IS NULL) as current,
          (SELECT COUNT(*) FROM service_requests
           WHERE created_at >= $3::timestamptz AND created_at <= $4::timestamptz
           ${tenantFilter} AND deleted_at IS NULL) as previous
      `;
      break;

    case 'response_time':
      query = `
        SELECT
          (SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600)
           FROM service_requests
           WHERE status IN ('done', 'closed')
           AND created_at >= $1::timestamptz AND created_at <= $2::timestamptz
           ${tenantFilter} AND deleted_at IS NULL) as current,
          (SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600)
           FROM service_requests
           WHERE status IN ('done', 'closed')
           AND created_at >= $3::timestamptz AND created_at <= $4::timestamptz
           ${tenantFilter} AND deleted_at IS NULL) as previous
      `;
      break;

    case 'completion_rate':
      query = `
        SELECT
          (SELECT COUNT(*) FILTER (WHERE status IN ('done', 'closed'))::float / NULLIF(COUNT(*), 0) * 100
           FROM service_requests
           WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
           ${tenantFilter} AND deleted_at IS NULL) as current,
          (SELECT COUNT(*) FILTER (WHERE status IN ('done', 'closed'))::float / NULLIF(COUNT(*), 0) * 100
           FROM service_requests
           WHERE created_at >= $3::timestamptz AND created_at <= $4::timestamptz
           ${tenantFilter} AND deleted_at IS NULL) as previous
      `;
      break;

    case 'satisfaction':
      query = `
        SELECT
          (SELECT AVG(CASE
            WHEN rating = 'positive' THEN 5
            WHEN rating = 'negative' THEN 1
            ELSE 3
          END) FROM ai_feedback
           WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz) as current,
          (SELECT AVG(CASE
            WHEN rating = 'positive' THEN 5
            WHEN rating = 'negative' THEN 1
            ELSE 3
          END) FROM ai_feedback
           WHERE created_at >= $3::timestamptz AND created_at <= $4::timestamptz) as previous
      `;
      break;
  }

  const result = await dbQuery(query, [params.currentStart, params.currentEnd, params.previousStart, params.previousEnd, ...tenantValues]);
  const data = result.rows[0];

  const current = parseFloat(data?.current || '0');
  const previous = parseFloat(data?.previous || '0');
  const change = current - previous;
  const changePercent = previous > 0 ? (change / previous) * 100 : 0;

  return {
    current,
    previous,
    change,
    changePercent,
  };
};

export const getKPIProgress = async (params: {
  tenantId?: string;
}): Promise<Array<{ name: string; current: number; target: number; unit: string }>> => {
  // These would typically come from a KPI configuration table
  // For now, we'll calculate based on current metrics and reasonable targets

  const metrics = await getAnalyticsMetrics({ range: 'month', tenantId: params.tenantId });

  return [
    {
      name: 'Response Time',
      current: metrics.responseTime.average,
      target: 24, // 24 hours target
      unit: 'hours',
    },
    {
      name: 'Completion Rate',
      current: metrics.completionRate.rate,
      target: 90, // 90% target
      unit: '%',
    },
    {
      name: 'Customer Satisfaction',
      current: metrics.customerSatisfaction.score,
      target: 4.5, // 4.5/5 target
      unit: '/5',
    },
    {
      name: 'Monthly Volume',
      current: metrics.volumeMetrics.total,
      target: metrics.volumeMetrics.total * 1.1, // 10% growth target
      unit: 'requests',
    },
  ];
};
