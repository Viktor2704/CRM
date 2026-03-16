import { asyncHandler } from '../helpers/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import {
  createRelationship,
  getEntityRelationships,
  deleteRelationship,
  updateRelationship,
  getRelationshipTypes,
  getRelationshipInsights,
  findRelatedRecords,
  getRelationshipHistory,
  findDuplicateRelationships,
  getRelationshipGraph,
} from '../services/relationshipService.js';

export const registerRelationshipRoutes = (app: any) => {
  /**
   * POST /relationships
   * Create a new relationship between entities
   */
  app.post(
    '/relationships',
    requireAuth,
    asyncHandler(async (request, response) => {
      const {
        sourceEntityType,
        sourceEntityId,
        targetEntityType,
        targetEntityId,
        relationshipType,
        relationshipStrength,
        isBidirectional,
        metadata,
      } = request.body;

      if (!sourceEntityType || !sourceEntityId || !targetEntityType || !targetEntityId || !relationshipType) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Missing required fields');
      }

      const relationshipId = await createRelationship({
        sourceEntityType,
        sourceEntityId,
        targetEntityType,
        targetEntityId,
        relationshipType,
        relationshipStrength,
        isBidirectional,
        metadata,
        createdByUserId: request.authUser?.id,
      });

      response.status(201).json({ id: relationshipId, success: true });
    })
  );

  /**
   * GET /relationships/:entityType/:entityId
   * Get all relationships for an entity
   */
  app.get(
    '/relationships/:entityType/:entityId',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { entityType, entityId } = request.params;
      const { relationshipType, includeDeleted, direction } = request.query;

      const relationships = await getEntityRelationships(entityType, entityId, {
        relationshipType: relationshipType as string,
        includeDeleted: includeDeleted === 'true',
        direction: direction as 'outgoing' | 'incoming' | 'both',
      });

      response.status(200).json({ relationships });
    })
  );

  /**
   * DELETE /relationships/:id
   * Delete a relationship (soft delete)
   */
  app.delete(
    '/relationships/:id',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { id } = request.params;
      const success = await deleteRelationship(id, request.authUser?.id);

      if (!success) {
        throw new ApiError(404, 'NOT_FOUND', 'Relationship not found');
      }

      response.status(200).json({ success: true });
    })
  );

  /**
   * PATCH /relationships/:id
   * Update a relationship
   */
  app.patch(
    '/relationships/:id',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { id } = request.params;
      const { relationshipStrength, metadata, isBidirectional } = request.body;

      const success = await updateRelationship(id, {
        relationshipStrength,
        metadata,
        isBidirectional,
      });

      if (!success) {
        throw new ApiError(404, 'NOT_FOUND', 'Relationship not found');
      }

      response.status(200).json({ success: true });
    })
  );

  /**
   * GET /relationship-types
   * Get all relationship types
   */
  app.get(
    '/relationship-types',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { activeOnly } = request.query;
      const types = await getRelationshipTypes(activeOnly !== 'false');

      response.status(200).json({ types });
    })
  );

  /**
   * GET /relationships/:entityType/:entityId/insights
   * Get relationship insights for an entity
   */
  app.get(
    '/relationships/:entityType/:entityId/insights',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { entityType, entityId } = request.params;
      const insights = await getRelationshipInsights(entityType, entityId);

      response.status(200).json({ insights });
    })
  );

  /**
   * GET /relationships/:entityType/:entityId/related
   * Find related records recursively
   */
  app.get(
    '/relationships/:entityType/:entityId/related',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { entityType, entityId } = request.params;
      const maxDepth = parseInt(request.query.maxDepth as string) || 2;

      const relatedRecords = await findRelatedRecords(entityType, entityId, maxDepth);

      response.status(200).json({ relatedRecords });
    })
  );

  /**
   * GET /relationships/:id/history
   * Get relationship history
   */
  app.get(
    '/relationships/:id/history',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { id } = request.params;
      const history = await getRelationshipHistory(id);

      response.status(200).json({ history });
    })
  );

  /**
   * GET /relationships/:entityType/:entityId/duplicates
   * Find potential duplicate entities based on relationships
   */
  app.get(
    '/relationships/:entityType/:entityId/duplicates',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { entityType, entityId } = request.params;
      const duplicates = await findDuplicateRelationships(entityType, entityId);

      response.status(200).json({ duplicates });
    })
  );

  /**
   * GET /relationships/:entityType/:entityId/graph
   * Get relationship graph data for visualization
   */
  app.get(
    '/relationships/:entityType/:entityId/graph',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { entityType, entityId } = request.params;
      const maxDepth = parseInt(request.query.maxDepth as string) || 2;

      const graph = await getRelationshipGraph(entityType, entityId, maxDepth);

      response.status(200).json({ graph });
    })
  );
};
