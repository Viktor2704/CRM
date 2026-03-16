import { asyncHandler } from '../helpers/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import {
  getUnifiedTimeline,
  createEnhancedActivity,
  toggleActivityPin,
  updateActivityTags,
  updateActivityInline,
  getActivityStatistics,
  getActivityTemplates,
  createActivityFromTemplate,
  addActivityAttachment,
  getActivityAttachments,
} from '../services/enhancedTimelineService.js';

export const registerEnhancedTimelineRoutes = (app: any) => {
  /**
   * GET /timeline
   * Get unified timeline with advanced filtering
   */
  app.get(
    '/timeline',
    requireAuth,
    asyncHandler(async (request, response) => {
      const filter: any = {
        entityType: request.query.entityType as string,
        entityId: request.query.entityId as string,
        activityTypes: request.query.activityTypes
          ? (request.query.activityTypes as string).split(',')
          : undefined,
        activitySubtypes: request.query.activitySubtypes
          ? (request.query.activitySubtypes as string).split(',')
          : undefined,
        severity: request.query.severity
          ? (request.query.severity as string).split(',')
          : undefined,
        tags: request.query.tags ? (request.query.tags as string).split(',') : undefined,
        isPinned: request.query.isPinned === 'true' ? true : undefined,
        searchQuery: request.query.searchQuery as string,
        limit: parseInt(request.query.limit as string) || 100,
        offset: parseInt(request.query.offset as string) || 0,
      };

      if (request.query.fromDate) {
        filter.fromDate = new Date(request.query.fromDate as string);
      }

      if (request.query.toDate) {
        filter.toDate = new Date(request.query.toDate as string);
      }

      const activities = await getUnifiedTimeline(filter);

      response.status(200).json({
        activities,
        total: activities.length,
        limit: filter.limit,
        offset: filter.offset,
      });
    })
  );

  /**
   * POST /timeline
   * Create enhanced activity entry
   */
  app.post(
    '/timeline',
    requireAuth,
    asyncHandler(async (request, response) => {
      const {
        entityType,
        entityId,
        activityType,
        activitySubtype,
        relatedEntityType,
        relatedEntityId,
        severity,
        title,
        description,
        metadata,
        isPinned,
        tags,
      } = request.body;

      if (!entityType || !entityId || !activityType || !title) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Missing required fields');
      }

      const activityId = await createEnhancedActivity({
        entityType,
        entityId,
        activityType,
        activitySubtype,
        relatedEntityType,
        relatedEntityId,
        actorUserId: request.authUser?.id,
        actorName: request.authUser?.fullName || request.authUser?.email || 'Пользователь',
        severity,
        title,
        description,
        metadata,
        isPinned,
        tags,
      });

      response.status(201).json({ id: activityId, success: true });
    })
  );

  /**
   * PATCH /timeline/:id/pin
   * Pin/unpin activity
   */
  app.patch(
    '/timeline/:id/pin',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { id } = request.params;
      const { isPinned } = request.body;

      if (isPinned === undefined) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'isPinned is required');
      }

      const success = await toggleActivityPin(id, isPinned);

      if (!success) {
        throw new ApiError(404, 'NOT_FOUND', 'Activity not found');
      }

      response.status(200).json({ success: true });
    })
  );

  /**
   * PATCH /timeline/:id/tags
   * Update activity tags
   */
  app.patch(
    '/timeline/:id/tags',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { id } = request.params;
      const { tags } = request.body;

      if (!Array.isArray(tags)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'tags must be an array');
      }

      const success = await updateActivityTags(id, tags);

      if (!success) {
        throw new ApiError(404, 'NOT_FOUND', 'Activity not found');
      }

      response.status(200).json({ success: true });
    })
  );

  /**
   * PATCH /timeline/:id
   * Update activity inline
   */
  app.patch(
    '/timeline/:id',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { id } = request.params;
      const { title, description, severity, metadata } = request.body;

      const success = await updateActivityInline(id, {
        title,
        description,
        severity,
        metadata,
      });

      if (!success) {
        throw new ApiError(404, 'NOT_FOUND', 'Activity not found');
      }

      response.status(200).json({ success: true });
    })
  );

  /**
   * GET /timeline/statistics
   * Get activity statistics
   */
  app.get(
    '/timeline/statistics',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { entityType, entityId, fromDate, toDate } = request.query;

      const statistics = await getActivityStatistics(
        entityType as string,
        entityId as string,
        fromDate ? new Date(fromDate as string) : undefined,
        toDate ? new Date(toDate as string) : undefined
      );

      response.status(200).json({ statistics });
    })
  );

  /**
   * GET /timeline/templates
   * Get activity templates
   */
  app.get(
    '/timeline/templates',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { activityType } = request.query;
      const templates = await getActivityTemplates(activityType as string);

      response.status(200).json({ templates });
    })
  );

  /**
   * POST /timeline/from-template
   * Create activity from template
   */
  app.post(
    '/timeline/from-template',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { templateId, entityType, entityId, variables } = request.body;

      if (!templateId || !entityType || !entityId || !variables) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Missing required fields');
      }

      const activityId = await createActivityFromTemplate(
        templateId,
        entityType,
        entityId,
        variables,
        request.authUser?.id,
        request.authUser?.fullName || request.authUser?.email || 'Пользователь'
      );

      if (!activityId) {
        throw new ApiError(404, 'NOT_FOUND', 'Template not found');
      }

      response.status(201).json({ id: activityId, success: true });
    })
  );

  /**
   * POST /timeline/:id/attachments
   * Add attachment to activity
   */
  app.post(
    '/timeline/:id/attachments',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { id } = request.params;
      const { fileId } = request.body;

      if (!fileId) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'fileId is required');
      }

      const success = await addActivityAttachment(id, fileId);

      if (!success) {
        throw new ApiError(400, 'OPERATION_FAILED', 'Failed to add attachment');
      }

      response.status(201).json({ success: true });
    })
  );

  /**
   * GET /timeline/:id/attachments
   * Get activity attachments
   */
  app.get(
    '/timeline/:id/attachments',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { id } = request.params;
      const attachments = await getActivityAttachments(id);

      response.status(200).json({ attachments });
    })
  );
};
