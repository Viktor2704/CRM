import { Router } from 'express';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { requireAuth, requireAdminLike } from '../middleware/auth.js';
import {
  getCustomFieldDefinitions,
  getCustomFieldDefinitionById,
  createCustomFieldDefinition,
  updateCustomFieldDefinition,
  deleteCustomFieldDefinition,
  getCustomFieldValues,
  setCustomFieldValues,
  type CustomFieldInput,
} from '../services/customFieldsService.js';
import { ApiError } from '../errors.js';

const router = Router();

// Get all custom field definitions for an entity type
router.get(
  '/definitions',
  requireAuth,
  asyncHandler(async (request, response) => {
    const entityType = String(request.query?.entityType || 'tenant');
    const definitions = await getCustomFieldDefinitions(entityType);
    response.status(200).json(definitions);
  })
);

// Get a single custom field definition by ID
router.get(
  '/definitions/:id',
  requireAuth,
  requireAdminLike,
  asyncHandler(async (request, response) => {
    const { id } = request.params;
    const definition = await getCustomFieldDefinitionById(id);
    if (!definition) {
      throw new ApiError(404, 'NOT_FOUND', 'Custom field definition not found');
    }
    response.status(200).json(definition);
  })
);

// Create a new custom field definition
router.post(
  '/definitions',
  requireAuth,
  requireAdminLike,
  asyncHandler(async (request, response) => {
    const body = request.body as { entityType?: string } & CustomFieldInput;
    const entityType = body.entityType || 'tenant';
    const definition = await createCustomFieldDefinition(entityType, body);
    response.status(201).json(definition);
  })
);

// Update a custom field definition
router.patch(
  '/definitions/:id',
  requireAuth,
  requireAdminLike,
  asyncHandler(async (request, response) => {
    const { id } = request.params;
    const body = request.body as Partial<CustomFieldInput>;
    const definition = await updateCustomFieldDefinition(id, body);
    response.status(200).json(definition);
  })
);

// Delete a custom field definition
router.delete(
  '/definitions/:id',
  requireAuth,
  requireAdminLike,
  asyncHandler(async (request, response) => {
    const { id } = request.params;
    await deleteCustomFieldDefinition(id);
    response.status(204).send();
  })
);

// Allowed entity types for custom fields
const ALLOWED_CUSTOM_FIELD_ENTITY_TYPES = new Set(['tenant', 'project', 'service_request', 'access_request', 'installation']);

// Get custom field values for an entity
router.get(
  '/values/:entityType/:entityId',
  requireAuth,
  asyncHandler(async (request: any, response) => {
    const { entityType, entityId } = request.params;

    if (!ALLOWED_CUSTOM_FIELD_ENTITY_TYPES.has(entityType)) {
      throw new ApiError(400, 'INVALID_ENTITY_TYPE', 'Invalid entity type for custom fields');
    }

    // Validate entityId is a UUID to prevent injection
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entityId)) {
      throw new ApiError(400, 'INVALID_ID', 'Invalid entity ID format');
    }

    const values = await getCustomFieldValues(entityType, entityId);
    response.status(200).json(values);
  })
);

// Set custom field values for an entity
router.put(
  '/values/:entityType/:entityId',
  requireAuth,
  requireAdminLike,
  asyncHandler(async (request: any, response) => {
    const { entityType, entityId } = request.params;

    if (!ALLOWED_CUSTOM_FIELD_ENTITY_TYPES.has(entityType)) {
      throw new ApiError(400, 'INVALID_ENTITY_TYPE', 'Invalid entity type for custom fields');
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entityId)) {
      throw new ApiError(400, 'INVALID_ID', 'Invalid entity ID format');
    }

    const values = request.body as Record<string, string | null>;
    await setCustomFieldValues(entityType, entityId, values);
    response.status(204).send();
  })
);

export function registerCustomFieldRoutes(app: any) {
  app.use('/custom-fields', router);
}
