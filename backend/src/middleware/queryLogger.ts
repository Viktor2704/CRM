import { logger } from '../logger.js';
import type { Request, Response, NextFunction } from 'express';

interface QueryMetrics {
  query: string;
  duration: number;
  timestamp: number;
  params?: any[];
}

const slowQueryThreshold = 1000; // 1 second
const queryMetrics: QueryMetrics[] = [];
const maxMetricsSize = 100;

// Wrap database query function to log slow queries
export function createQueryLogger(originalQueryFn: Function) {
  return async function loggedQuery(text: string, values: any[] = []) {
    const startTime = Date.now();

    try {
      const result = await originalQueryFn(text, values);
      const duration = Date.now() - startTime;

      // Log slow queries
      if (duration > slowQueryThreshold) {
        logger.warn('Slow query detected', {
          duration,
          query: text.substring(0, 200),
          params: values?.length || 0,
        });
      }

      // Store metrics
      queryMetrics.push({
        query: text.substring(0, 200),
        duration,
        timestamp: Date.now(),
        params: values?.length ? ['<redacted>'] : undefined,
      });

      // Keep only recent metrics
      if (queryMetrics.length > maxMetricsSize) {
        queryMetrics.shift();
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Query failed', {
        duration,
        query: text.substring(0, 200),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}

// Middleware to expose query metrics endpoint
export function queryMetricsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/metrics/queries' && req.method === 'GET') {
    const slowQueries = queryMetrics.filter(q => q.duration > slowQueryThreshold);
    const avgDuration = queryMetrics.length > 0
      ? queryMetrics.reduce((sum, q) => sum + q.duration, 0) / queryMetrics.length
      : 0;

    res.json({
      totalQueries: queryMetrics.length,
      slowQueries: slowQueries.length,
      averageDuration: Math.round(avgDuration),
      slowQueryThreshold,
      recentSlowQueries: slowQueries.slice(-10).map(q => ({
        query: q.query,
        duration: q.duration,
        timestamp: new Date(q.timestamp).toISOString(),
      })),
    });
    return;
  }
  next();
}

export function getQueryMetrics() {
  return {
    total: queryMetrics.length,
    slow: queryMetrics.filter(q => q.duration > slowQueryThreshold).length,
    avgDuration: queryMetrics.length > 0
      ? queryMetrics.reduce((sum, q) => sum + q.duration, 0) / queryMetrics.length
      : 0,
  };
}
