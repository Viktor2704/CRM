import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../helpers/asyncHandler.js';
import {
  predictCompletionTime,
  analyzeSentiment,
  detectAnomalies,
  alertAdminsAboutAnomalies,
  getPrediction,
  getAnomalies,
  resolveAnomaly,
} from '../services/aiPredictiveService.js';
import { logger, serializeError } from '../logger.js';

const predictCompletionTimeSchema = z.object({
  requestId: z.string().uuid(),
  requestType: z.string(),
  priority: z.string(),
  executorIds: z.array(z.string()),
  systemType: z.string().optional(),
});

const analyzeSentimentSchema = z.object({
  commentId: z.string().uuid(),
  commentText: z.string().min(1),
});

const resolveAnomalySchema = z.object({
  anomalyId: z.string().uuid(),
});

export const registerAiPredictionRoutes = (params: {
  app: any;
  requireAuth: any;
  ApiError: any;
  internalGlobalRoles: Set<string>;
}) => {
  const { app, requireAuth, ApiError, internalGlobalRoles } = params;

  // Predict completion time for a service request
  app.post(
    '/ai/predict-completion-time',
    requireAuth,
    asyncHandler(async (req, res) => {
      const parsed = predictCompletionTimeSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid request data');
      }

      const { requestId, requestType, priority, executorIds, systemType } = parsed.data;

      const prediction = await predictCompletionTime(
        requestId,
        requestType,
        priority,
        executorIds,
        systemType
      );

      res.json({
        success: true,
        prediction,
      });
    })
  );

  // Analyze sentiment of a comment
  app.post(
    '/ai/analyze-sentiment',
    requireAuth,
    asyncHandler(async (req, res) => {
      const parsed = analyzeSentimentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid request data');
      }

      const { commentId, commentText } = parsed.data;

      const analysis = await analyzeSentiment(commentId, commentText);

      res.json({
        success: true,
        analysis,
      });
    })
  );

  // Get prediction for an entity
  app.get(
    '/ai/predictions/:entityType/:entityId/:predictionType',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { entityType, entityId, predictionType } = req.params;

      if (!entityType || !entityId || !predictionType) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Missing required parameters');
      }

      const prediction = await getPrediction(entityType, entityId, predictionType as any);

      res.json({
        success: true,
        prediction,
      });
    })
  );

  // Run anomaly detection (admin only)
  app.post(
    '/ai/detect-anomalies',
    requireAuth,
    asyncHandler(async (req, res) => {
      const actor = (req as any).authUser;
      if (!actor || !internalGlobalRoles.has(actor.role)) {
        throw new ApiError(403, 'FORBIDDEN', 'Admin access required');
      }

      const anomalies = await detectAnomalies();

      // Alert admins if anomalies found
      if (anomalies.length > 0) {
        void alertAdminsAboutAnomalies(anomalies);
      }

      res.json({
        success: true,
        anomalies,
      });
    })
  );

  // Get anomalies
  app.get(
    '/ai/anomalies',
    requireAuth,
    asyncHandler(async (req, res) => {
      const actor = (req as any).authUser;
      if (!actor || !internalGlobalRoles.has(actor.role)) {
        throw new ApiError(403, 'FORBIDDEN', 'Admin access required');
      }

      const { entityType, resolved } = req.query;
      const resolvedBool = resolved === 'true' ? true : resolved === 'false' ? false : undefined;

      const anomalies = await getAnomalies(
        entityType as string | undefined,
        resolvedBool
      );

      res.json({
        success: true,
        anomalies,
      });
    })
  );

  // Resolve anomaly
  app.post(
    '/ai/anomalies/:anomalyId/resolve',
    requireAuth,
    asyncHandler(async (req, res) => {
      const actor = (req as any).authUser;
      if (!actor || !internalGlobalRoles.has(actor.role)) {
        throw new ApiError(403, 'FORBIDDEN', 'Admin access required');
      }

      const parsed = resolveAnomalySchema.safeParse({ anomalyId: req.params.anomalyId });
      if (!parsed.success) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid anomaly ID');
      }

      await resolveAnomaly(parsed.data.anomalyId, actor.id);

      res.json({
        success: true,
      });
    })
  );
};

export const registerMockAiPredictionRoutes = (params: {
  app: any;
  requireAuth: any;
  ApiError: any;
}) => {
  const { app, requireAuth, ApiError } = params;

  // Mock endpoints for development
  app.post('/ai/predict-completion-time', requireAuth, (req, res) => {
    res.json({
      success: true,
      prediction: {
        estimatedDays: 5,
        confidence: 0.75,
        factors: {
          historicalAverage: 4.5,
          priorityImpact: 1.0,
          executorPerformance: 4.2,
        },
      },
    });
  });

  app.post('/ai/analyze-sentiment', requireAuth, (req, res) => {
    res.json({
      success: true,
      analysis: {
        sentiment: 'neutral',
        score: 0.5,
        isUrgent: false,
      },
    });
  });

  app.get('/ai/predictions/:entityType/:entityId/:predictionType', requireAuth, (req, res) => {
    res.json({
      success: true,
      prediction: null,
    });
  });

  app.post('/ai/detect-anomalies', requireAuth, (req, res) => {
    res.json({
      success: true,
      anomalies: [],
    });
  });

  app.get('/ai/anomalies', requireAuth, (req, res) => {
    res.json({
      success: true,
      anomalies: [],
    });
  });

  app.post('/ai/anomalies/:anomalyId/resolve', requireAuth, (req, res) => {
    res.json({
      success: true,
    });
  });
};
