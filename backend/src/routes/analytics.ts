import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { ApiError } from '../errors.js';
import {
  getAnalyticsMetrics,
  getTrendAnalysis,
  getComparativeAnalysis,
  getKPIProgress,
  type TimeRange,
} from '../services/analyticsService.js';
import {
  generateStatusDistributionChart,
  generatePriorityDistributionChart,
  generateVolumeOverTimeChart,
  generateResponseTimeHeatmap,
  generateWorkloadHeatmap,
  drillDownByStatus,
  drillDownByPriority,
  generateTopPerformersChart,
} from '../services/dataVisualization.js';
import {
  forecastServiceRequestVolume,
  predictResourceNeeds,
  identifyBottlenecks,
  generateOptimizationRecommendations,
  calculateTrendVelocity,
} from '../services/predictiveAnalytics.js';

export const createAnalyticsRouter = (params: { requireAuth: any }) => {
  const router = Router();
  const { requireAuth } = params;

  const requireAnalyticsRole = (req: any, res: any, next: any) => {
    const role = req.authUser?.role;
    if (role !== 'admin' && role !== 'manager') {
      res.status(403).json({ code: 'FORBIDDEN', message: 'Admin or manager role required', status: 403 });
      return;
    }
    next();
  };

  // Get analytics metrics
  router.get(
    '/metrics',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const range = (req.query.range as TimeRange) || 'month';
      const customStart = req.query.customStart as string | undefined;
      const customEnd = req.query.customEnd as string | undefined;
      const tenantId = req.query.tenantId as string | undefined;

      const metrics = await getAnalyticsMetrics({
        range,
        customStart,
        customEnd,
        tenantId,
      });

      res.json(metrics);
    })
  );

  // Get trend analysis
  router.get(
    '/trends',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const metric = req.query.metric as 'volume' | 'response_time' | 'completion_rate' | 'satisfaction';
      const range = (req.query.range as TimeRange) || 'month';
      const granularity = (req.query.granularity as 'hour' | 'day' | 'week' | 'month') || 'day';
      const customStart = req.query.customStart as string | undefined;
      const customEnd = req.query.customEnd as string | undefined;
      const tenantId = req.query.tenantId as string | undefined;

      if (!metric) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Metric parameter is required');
      }

      const trends = await getTrendAnalysis({
        metric,
        range,
        granularity,
        customStart,
        customEnd,
        tenantId,
      });

      res.json(trends);
    })
  );

  // Get comparative analysis
  router.get(
    '/comparative',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const metric = req.query.metric as 'volume' | 'response_time' | 'completion_rate' | 'satisfaction';
      const currentStart = req.query.currentStart as string;
      const currentEnd = req.query.currentEnd as string;
      const previousStart = req.query.previousStart as string;
      const previousEnd = req.query.previousEnd as string;
      const tenantId = req.query.tenantId as string | undefined;

      if (!metric || !currentStart || !currentEnd || !previousStart || !previousEnd) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Missing required parameters');
      }

      const comparison = await getComparativeAnalysis({
        metric,
        currentStart,
        currentEnd,
        previousStart,
        previousEnd,
        tenantId,
      });

      res.json(comparison);
    })
  );

  // Get KPI progress
  router.get(
    '/kpi',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const tenantId = req.query.tenantId as string | undefined;

      const kpis = await getKPIProgress({ tenantId });

      res.json(kpis);
    })
  );

  // Get status distribution chart
  router.get(
    '/charts/status-distribution',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const entityType = (req.query.entityType as 'service_requests' | 'projects' | 'installations') || 'service_requests';
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const tenantId = req.query.tenantId as string | undefined;

      const chart = await generateStatusDistributionChart({
        entityType,
        startDate,
        endDate,
        tenantId,
      });

      res.json(chart);
    })
  );

  // Get priority distribution chart
  router.get(
    '/charts/priority-distribution',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const entityType = (req.query.entityType as 'service_requests' | 'projects' | 'installations') || 'service_requests';
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const tenantId = req.query.tenantId as string | undefined;

      const chart = await generatePriorityDistributionChart({
        entityType,
        startDate,
        endDate,
        tenantId,
      });

      res.json(chart);
    })
  );

  // Get volume over time chart
  router.get(
    '/charts/volume-over-time',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const entityType = (req.query.entityType as 'service_requests' | 'projects' | 'installations') || 'service_requests';
      const granularity = (req.query.granularity as 'day' | 'week' | 'month') || 'day';
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const tenantId = req.query.tenantId as string | undefined;
      const groupBy = req.query.groupBy as 'status' | 'priority' | undefined;

      if (!startDate || !endDate) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Start date and end date are required');
      }

      const chart = await generateVolumeOverTimeChart({
        entityType,
        granularity,
        startDate,
        endDate,
        tenantId,
        groupBy,
      });

      res.json(chart);
    })
  );

  // Get response time heatmap
  router.get(
    '/charts/response-time-heatmap',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const tenantId = req.query.tenantId as string | undefined;

      if (!startDate || !endDate) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Start date and end date are required');
      }

      const heatmap = await generateResponseTimeHeatmap({
        startDate,
        endDate,
        tenantId,
      });

      res.json(heatmap);
    })
  );

  // Get workload heatmap
  router.get(
    '/charts/workload-heatmap',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const tenantId = req.query.tenantId as string | undefined;

      if (!startDate || !endDate) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Start date and end date are required');
      }

      const heatmap = await generateWorkloadHeatmap({
        startDate,
        endDate,
        tenantId,
      });

      res.json(heatmap);
    })
  );

  // Get top performers chart
  router.get(
    '/charts/top-performers',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const metric = req.query.metric as 'completion_count' | 'avg_response_time' | 'satisfaction_score';
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;

      if (!metric || !startDate || !endDate) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Metric, start date, and end date are required');
      }

      const chart = await generateTopPerformersChart({
        metric,
        startDate,
        endDate,
        limit,
      });

      res.json(chart);
    })
  );

  // Drill down by status
  router.get(
    '/drilldown/status/:status',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const status = req.params.status;
      const entityType = (req.query.entityType as 'service_requests' | 'projects' | 'installations') || 'service_requests';
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const tenantId = req.query.tenantId as string | undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
      const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : undefined;

      const data = await drillDownByStatus({
        entityType,
        status,
        startDate,
        endDate,
        tenantId,
        limit,
        offset,
      });

      res.json(data);
    })
  );

  // Drill down by priority
  router.get(
    '/drilldown/priority/:priority',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const priority = req.params.priority;
      const entityType = (req.query.entityType as 'service_requests' | 'projects' | 'installations') || 'service_requests';
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const tenantId = req.query.tenantId as string | undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
      const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : undefined;

      const data = await drillDownByPriority({
        entityType,
        priority,
        startDate,
        endDate,
        tenantId,
        limit,
        offset,
      });

      res.json(data);
    })
  );

  // Forecast service request volume
  router.get(
    '/forecast/volume',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const daysToForecast = req.query.days ? parseInt(String(req.query.days), 10) : 30;
      const tenantId = req.query.tenantId as string | undefined;

      if (daysToForecast < 1 || daysToForecast > 90) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Days to forecast must be between 1 and 90');
      }

      const forecast = await forecastServiceRequestVolume({
        daysToForecast,
        tenantId,
      });

      res.json(forecast);
    })
  );

  // Predict resource needs
  router.get(
    '/predict/resources',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const tenantId = req.query.tenantId as string | undefined;

      const predictions = await predictResourceNeeds({ tenantId });

      res.json(predictions);
    })
  );

  // Identify bottlenecks
  router.get(
    '/bottlenecks',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const tenantId = req.query.tenantId as string | undefined;

      const bottlenecks = await identifyBottlenecks({ tenantId });

      res.json(bottlenecks);
    })
  );

  // Get optimization recommendations
  router.get(
    '/recommendations',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const tenantId = req.query.tenantId as string | undefined;

      const recommendations = await generateOptimizationRecommendations({ tenantId });

      res.json(recommendations);
    })
  );

  // Calculate trend velocity
  router.get(
    '/velocity',
    requireAuth,
    requireAnalyticsRole,
    asyncHandler(async (req: Request, res: Response) => {
      const metric = req.query.metric as 'volume' | 'response_time' | 'completion_rate';
      const tenantId = req.query.tenantId as string | undefined;

      if (!metric) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Metric parameter is required');
      }

      const velocity = await calculateTrendVelocity({ metric, tenantId });

      res.json(velocity);
    })
  );

  return router;
};
