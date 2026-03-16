/**
 * Metadata API Routes
 * Admin endpoints for managing entities, fields, layouts, and relationships
 */

import { Router } from 'express';
import { z } from 'zod';
import { metadataService } from '../services/metadataService.js';
import { pluginManager } from '../services/pluginSystem.js';
import { requireAdminLike } from '../middleware/auth.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import type { EntityType, FieldType } from '../metadata/entityMetadata.js';
import type { LinkType } from '../metadata/relationshipMetadata.js';
import { getAllFieldTypeDefinitions } from '../metadata/fieldMetadata.js';

const createEntitySchema = z.object({
  name: z.string().regex(/^[A-Z][a-zA-Z0-9]*$/),
  type: z.enum(['Base', 'BasePlus', 'Person', 'Company', 'Event', 'CategoryTree', 'Custom']),
  labelSingular: z.string().optional(),
  labelPlural: z.string().optional(),
  color: z.string().optional(),
  iconClass: z.string().optional(),
  stream: z.boolean().optional(),
  textFilterFields: z.array(z.string()).optional(),
});

const updateEntitySchema = z.object({
  labelSingular: z.string().optional(),
  labelPlural: z.string().optional(),
  color: z.string().optional(),
  iconClass: z.string().optional(),
  stream: z.boolean().optional(),
  disabled: z.boolean().optional(),
  textFilterFields: z.array(z.string()).optional(),
});

const createFieldSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  type: z.string(),
  label: z.string().optional(),
  required: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  default: z.any().optional(),
  maxLength: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.any()).optional(),
  pattern: z.string().optional(),
});

const updateFieldSchema = z.object({
  label: z.string().optional(),
  required: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  default: z.any().optional(),
  maxLength: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.any()).optional(),
});

const createRelationshipSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  type: z.enum(['belongsTo', 'hasMany', 'hasOne', 'belongsToParent', 'hasChildren', 'manyMany']),
  leftEntity: z.string(),
  rightEntity: z.string(),
  leftLink: z.string().optional(),
  rightLink: z.string().optional(),
  relationName: z.string().optional(),
});

export function registerMetadataRoutes(app: Router): void {
  const router = Router();

  // Initialize metadata service
  router.use(asyncHandler(async (req, res, next) => {
    await metadataService.initialize();
    next();
  }));

  // Get all entities
  router.get('/entities', requireAdminLike, asyncHandler(async (req, res) => {
    const entities = metadataService.getAllEntities();
    res.json({ entities });
  }));

  // Get entity by name
  router.get('/entities/:name', requireAdminLike, asyncHandler(async (req, res) => {
    const entity = metadataService.getEntity(req.params.name);
    if (!entity) {
      return res.status(404).json({ error: 'Entity not found' });
    }
    res.json({ entity });
  }));

  // Create entity
  router.post('/entities', requireAdminLike, asyncHandler(async (req, res) => {
    const data = createEntitySchema.parse(req.body);
    const entity = await metadataService.createEntity(
      data.name,
      data.type as EntityType,
      {
        labelSingular: data.labelSingular,
        labelPlural: data.labelPlural,
        color: data.color,
        iconClass: data.iconClass,
        stream: data.stream,
        textFilterFields: data.textFilterFields,
      }
    );
    res.status(201).json({ entity });
  }));

  // Update entity
  router.put('/entities/:name', requireAdminLike, asyncHandler(async (req, res) => {
    const data = updateEntitySchema.parse(req.body);
    const entity = await metadataService.updateEntity(req.params.name, data);
    res.json({ entity });
  }));

  // Delete entity
  router.delete('/entities/:name', requireAdminLike, asyncHandler(async (req, res) => {
    await metadataService.deleteEntity(req.params.name);
    res.json({ success: true });
  }));

  // Get entity fields
  router.get('/entities/:name/fields', requireAdminLike, asyncHandler(async (req, res) => {
    const entity = metadataService.getEntity(req.params.name);
    if (!entity) {
      return res.status(404).json({ error: 'Entity not found' });
    }
    res.json({ fields: entity.fields });
  }));

  // Add field to entity
  router.post('/entities/:name/fields', requireAdminLike, asyncHandler(async (req, res) => {
    const data = createFieldSchema.parse(req.body);
    await metadataService.addField(req.params.name, data.name, {
      name: data.name,
      type: data.type as FieldType,
      label: data.label,
      required: data.required,
      readOnly: data.readOnly,
      default: data.default,
      maxLength: data.maxLength,
      min: data.min,
      max: data.max,
      options: data.options,
      pattern: data.pattern,
    });
    res.status(201).json({ success: true });
  }));

  // Update field
  router.put('/entities/:name/fields/:fieldName', requireAdminLike, asyncHandler(async (req, res) => {
    const data = updateFieldSchema.parse(req.body);
    await metadataService.updateField(req.params.name, req.params.fieldName, data);
    res.json({ success: true });
  }));

  // Delete field
  router.delete('/entities/:name/fields/:fieldName', requireAdminLike, asyncHandler(async (req, res) => {
    await metadataService.removeField(req.params.name, req.params.fieldName);
    res.json({ success: true });
  }));

  // Get entity layout
  router.get('/entities/:name/layout', requireAdminLike, asyncHandler(async (req, res) => {
    const layout = metadataService.getLayout(req.params.name);
    if (!layout) {
      return res.status(404).json({ error: 'Layout not found' });
    }
    res.json({ layout });
  }));

  // Update entity layout
  router.put('/entities/:name/layout', requireAdminLike, asyncHandler(async (req, res) => {
    const layout = await metadataService.updateLayout(req.params.name, req.body);
    res.json({ layout });
  }));

  // Get all relationships
  router.get('/relationships', requireAdminLike, asyncHandler(async (req, res) => {
    const relationships = metadataService.getAllRelationships();
    res.json({ relationships });
  }));

  // Create relationship
  router.post('/relationships', requireAdminLike, asyncHandler(async (req, res) => {
    const data = createRelationshipSchema.parse(req.body);
    await metadataService.createRelationship({
      name: data.name,
      type: data.type as LinkType,
      leftEntity: data.leftEntity,
      rightEntity: data.rightEntity,
      leftLink: data.leftLink,
      rightLink: data.rightLink,
      relationName: data.relationName,
    });
    res.status(201).json({ success: true });
  }));

  // Get field type definitions
  router.get('/field-types', requireAdminLike, asyncHandler(async (req, res) => {
    const fieldTypes = getAllFieldTypeDefinitions();
    res.json({ fieldTypes });
  }));

  // Get plugins
  router.get('/plugins', requireAdminLike, asyncHandler(async (req, res) => {
    const plugins = pluginManager.getAllPlugins().map(p => ({
      name: p.name,
      version: p.version,
      description: p.description,
      author: p.author,
      enabled: pluginManager.isPluginEnabled(p.name),
    }));
    res.json({ plugins });
  }));

  // Enable plugin
  router.post('/plugins/:name/enable', requireAdminLike, asyncHandler(async (req, res) => {
    await pluginManager.enablePlugin(req.params.name);
    res.json({ success: true });
  }));

  // Disable plugin
  router.post('/plugins/:name/disable', requireAdminLike, asyncHandler(async (req, res) => {
    await pluginManager.disablePlugin(req.params.name);
    res.json({ success: true });
  }));

  app.use('/metadata', router);
}
