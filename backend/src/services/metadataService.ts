/**
 * Metadata Service
 * Central service for managing all metadata (entities, fields, layouts, relationships)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  EntityMetadata,
  EntityFieldMetadata,
  EntityType,
} from '../metadata/entityMetadata.js';
import {
  validateEntityMetadata,
  mergeWithBaseTemplate,
  BASE_PLUS_ENTITY_FIELDS,
} from '../metadata/entityMetadata.js';
import type { LayoutMetadata } from '../metadata/layoutMetadata.js';
import {
  createDefaultLayoutMetadata,
  validateLayoutMetadata,
  mergeLayoutMetadata,
} from '../metadata/layoutMetadata.js';
import type { RelationshipMetadata } from '../metadata/relationshipMetadata.js';
import {
  validateRelationship,
  createRelationship,
  getJoinTableSql,
} from '../metadata/relationshipMetadata.js';
import {
  validateFieldMetadata,
  createFieldMetadata,
  getFieldDbDefinition,
} from '../metadata/fieldMetadata.js';
import { dbQuery } from '../db.js';
import { logger } from '../logger.js';
import { appConfig } from '../config.js';

const METADATA_DIR = appConfig.metadataDir;

export class MetadataService {
  private entityCache = new Map<string, EntityMetadata>();
  private layoutCache = new Map<string, LayoutMetadata>();
  private relationshipCache = new Map<string, RelationshipMetadata>();
  private initialized = false;

  /**
   * Initialize metadata service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(METADATA_DIR, { recursive: true });
      await this.loadAllMetadata();
      this.initialized = true;
      logger.info('Metadata service initialized');
    } catch (error) {
      logger.error('Failed to initialize metadata service', { error });
      throw error;
    }
  }

  /**
   * Load all metadata from disk
   */
  private async loadAllMetadata(): Promise<void> {
    await Promise.all([
      this.loadEntities(),
      this.loadLayouts(),
      this.loadRelationships(),
    ]);
  }

  private async loadEntities(): Promise<void> {
    const entitiesDir = path.join(METADATA_DIR, 'entities');
    try {
      await fs.mkdir(entitiesDir, { recursive: true });
      const files = await fs.readdir(entitiesDir);

      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(entitiesDir, file), 'utf-8');
          const metadata: EntityMetadata = JSON.parse(content);
          this.entityCache.set(metadata.name, metadata);
        }
      }
    } catch (error) {
      logger.warn('Failed to load entities', { error });
    }
  }

  private async loadLayouts(): Promise<void> {
    const layoutsDir = path.join(METADATA_DIR, 'layouts');
    try {
      await fs.mkdir(layoutsDir, { recursive: true });
      const files = await fs.readdir(layoutsDir);

      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(layoutsDir, file), 'utf-8');
          const metadata: LayoutMetadata = JSON.parse(content);
          this.layoutCache.set(metadata.entityType, metadata);
        }
      }
    } catch (error) {
      logger.warn('Failed to load layouts', { error });
    }
  }

  private async loadRelationships(): Promise<void> {
    const relationshipsDir = path.join(METADATA_DIR, 'relationships');
    try {
      await fs.mkdir(relationshipsDir, { recursive: true });
      const files = await fs.readdir(relationshipsDir);

      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(relationshipsDir, file), 'utf-8');
          const metadata: RelationshipMetadata = JSON.parse(content);
          this.relationshipCache.set(metadata.name, metadata);
        }
      }
    } catch (error) {
      logger.warn('Failed to load relationships', { error });
    }
  }

  /**
   * Get entity metadata
   */
  getEntity(name: string): EntityMetadata | undefined {
    return this.entityCache.get(name);
  }

  /**
   * Get all entities
   */
  getAllEntities(): EntityMetadata[] {
    return Array.from(this.entityCache.values());
  }

  /**
   * Create new entity
   */
  async createEntity(
    name: string,
    type: EntityType,
    options: Partial<EntityMetadata> = {}
  ): Promise<EntityMetadata> {
    if (this.entityCache.has(name)) {
      throw new Error(`Entity '${name}' already exists`);
    }

    const metadata = mergeWithBaseTemplate({ name, ...options }, type);
    metadata.isCustom = true;
    metadata.createdAt = new Date().toISOString();

    const errors = validateEntityMetadata(metadata);
    if (errors.length > 0) {
      throw new Error(`Invalid entity metadata: ${errors.join(', ')}`);
    }

    // Create database table
    await this.createEntityTable(metadata);

    // Save metadata
    await this.saveEntity(metadata);

    // Create default layout
    const layout = createDefaultLayoutMetadata(
      name,
      Object.keys(metadata.fields)
    );
    await this.saveLayout(layout);

    this.entityCache.set(name, metadata);
    this.layoutCache.set(name, layout);

    logger.info('Entity created', { name, type });
    return metadata;
  }

  /**
   * Update entity metadata
   */
  async updateEntity(
    name: string,
    updates: Partial<EntityMetadata>
  ): Promise<EntityMetadata> {
    const existing = this.entityCache.get(name);
    if (!existing) {
      throw new Error(`Entity '${name}' not found`);
    }

    const metadata: EntityMetadata = {
      ...existing,
      ...updates,
      name: existing.name, // Prevent name change
      modifiedAt: new Date().toISOString(),
    };

    const errors = validateEntityMetadata(metadata);
    if (errors.length > 0) {
      throw new Error(`Invalid entity metadata: ${errors.join(', ')}`);
    }

    await this.saveEntity(metadata);
    this.entityCache.set(name, metadata);

    logger.info('Entity updated', { name });
    return metadata;
  }

  /**
   * Delete entity
   */
  async deleteEntity(name: string): Promise<void> {
    const metadata = this.entityCache.get(name);
    if (!metadata) {
      throw new Error(`Entity '${name}' not found`);
    }

    if (!metadata.isCustom) {
      throw new Error(`Cannot delete built-in entity '${name}'`);
    }

    // Drop database table
    await this.dropEntityTable(name);

    // Delete metadata files
    await fs.unlink(path.join(METADATA_DIR, 'entities', `${name}.json`));
    await fs.unlink(path.join(METADATA_DIR, 'layouts', `${name}.json`)).catch(() => {});

    this.entityCache.delete(name);
    this.layoutCache.delete(name);

    logger.info('Entity deleted', { name });
  }

  /**
   * Add field to entity
   */
  async addField(
    entityName: string,
    fieldName: string,
    fieldMetadata: EntityFieldMetadata
  ): Promise<void> {
    const entity = this.entityCache.get(entityName);
    if (!entity) {
      throw new Error(`Entity '${entityName}' not found`);
    }

    if (entity.fields[fieldName]) {
      throw new Error(`Field '${fieldName}' already exists in entity '${entityName}'`);
    }

    const errors = validateFieldMetadata(fieldMetadata);
    if (errors.length > 0) {
      throw new Error(`Invalid field metadata: ${errors.join(', ')}`);
    }

    // Add column to database table
    await this.addTableColumn(entityName, fieldName, fieldMetadata);

    entity.fields[fieldName] = fieldMetadata;
    entity.modifiedAt = new Date().toISOString();

    await this.saveEntity(entity);
    logger.info('Field added', { entityName, fieldName });
  }

  /**
   * Update field metadata
   */
  async updateField(
    entityName: string,
    fieldName: string,
    updates: Partial<EntityFieldMetadata>
  ): Promise<void> {
    const entity = this.entityCache.get(entityName);
    if (!entity) {
      throw new Error(`Entity '${entityName}' not found`);
    }

    if (!entity.fields[fieldName]) {
      throw new Error(`Field '${fieldName}' not found in entity '${entityName}'`);
    }

    const updatedField = { ...entity.fields[fieldName], ...updates };
    const errors = validateFieldMetadata(updatedField);
    if (errors.length > 0) {
      throw new Error(`Invalid field metadata: ${errors.join(', ')}`);
    }

    entity.fields[fieldName] = updatedField;
    entity.modifiedAt = new Date().toISOString();

    await this.saveEntity(entity);
    logger.info('Field updated', { entityName, fieldName });
  }

  /**
   * Remove field from entity
   */
  async removeField(entityName: string, fieldName: string): Promise<void> {
    const entity = this.entityCache.get(entityName);
    if (!entity) {
      throw new Error(`Entity '${entityName}' not found`);
    }

    if (!entity.fields[fieldName]) {
      throw new Error(`Field '${fieldName}' not found in entity '${entityName}'`);
    }

    // Check if field is in base template
    if (BASE_PLUS_ENTITY_FIELDS[fieldName]) {
      throw new Error(`Cannot remove base field '${fieldName}'`);
    }

    // Drop column from database table
    await this.dropTableColumn(entityName, fieldName);

    delete entity.fields[fieldName];
    entity.modifiedAt = new Date().toISOString();

    await this.saveEntity(entity);
    logger.info('Field removed', { entityName, fieldName });
  }

  /**
   * Get layout metadata
   */
  getLayout(entityType: string): LayoutMetadata | undefined {
    return this.layoutCache.get(entityType);
  }

  /**
   * Update layout metadata
   */
  async updateLayout(
    entityType: string,
    updates: Partial<LayoutMetadata>
  ): Promise<LayoutMetadata> {
    const existing = this.layoutCache.get(entityType);
    if (!existing) {
      throw new Error(`Layout for '${entityType}' not found`);
    }

    const entity = this.entityCache.get(entityType);
    if (!entity) {
      throw new Error(`Entity '${entityType}' not found`);
    }

    const metadata = mergeLayoutMetadata(existing, updates);
    const errors = validateLayoutMetadata(metadata, Object.keys(entity.fields));
    if (errors.length > 0) {
      throw new Error(`Invalid layout metadata: ${errors.join(', ')}`);
    }

    await this.saveLayout(metadata);
    this.layoutCache.set(entityType, metadata);

    logger.info('Layout updated', { entityType });
    return metadata;
  }

  /**
   * Create relationship
   */
  async createRelationship(
    relationship: RelationshipMetadata
  ): Promise<void> {
    if (this.relationshipCache.has(relationship.name)) {
      throw new Error(`Relationship '${relationship.name}' already exists`);
    }

    const errors = validateRelationship(
      relationship,
      Array.from(this.entityCache.keys())
    );
    if (errors.length > 0) {
      throw new Error(`Invalid relationship: ${errors.join(', ')}`);
    }

    // Create join table if needed
    const joinTableSql = getJoinTableSql(relationship);
    if (joinTableSql) {
      await dbQuery(joinTableSql);
    }

    await this.saveRelationship(relationship);
    this.relationshipCache.set(relationship.name, relationship);

    logger.info('Relationship created', { name: relationship.name });
  }

  /**
   * Get relationship
   */
  getRelationship(name: string): RelationshipMetadata | undefined {
    return this.relationshipCache.get(name);
  }

  /**
   * Get all relationships
   */
  getAllRelationships(): RelationshipMetadata[] {
    return Array.from(this.relationshipCache.values());
  }

  /**
   * Save entity metadata to disk
   */
  private async saveEntity(metadata: EntityMetadata): Promise<void> {
    const filePath = path.join(METADATA_DIR, 'entities', `${metadata.name}.json`);
    await fs.writeFile(filePath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Save layout metadata to disk
   */
  private async saveLayout(metadata: LayoutMetadata): Promise<void> {
    const filePath = path.join(METADATA_DIR, 'layouts', `${metadata.entityType}.json`);
    await fs.writeFile(filePath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Save relationship metadata to disk
   */
  private async saveRelationship(metadata: RelationshipMetadata): Promise<void> {
    const filePath = path.join(METADATA_DIR, 'relationships', `${metadata.name}.json`);
    await fs.writeFile(filePath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Create database table for entity
   */
  private async createEntityTable(metadata: EntityMetadata): Promise<void> {
    const tableName = this.getTableName(metadata.name);
    const columns: string[] = [];

    for (const [fieldName, field] of Object.entries(metadata.fields)) {
      const dbDef = getFieldDbDefinition(field);
      if (dbDef) {
        const length = dbDef.length ? `(${dbDef.length})` : '';
        const nullable = dbDef.nullable ? '' : ' NOT NULL';
        const defaultVal = dbDef.default !== undefined ? ` DEFAULT ${dbDef.default}` : '';
        columns.push(`${fieldName} ${dbDef.type}${length}${nullable}${defaultVal}`);
      }
    }

    const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (
      ${columns.join(',\n      ')},
      PRIMARY KEY (id)
    )`;

    await dbQuery(sql);

    // Create indexes
    if (metadata.indexes) {
      for (const [indexName, indexDef] of Object.entries(metadata.indexes)) {
        const sanitizedIndexName = indexName.replace(/[^a-zA-Z0-9_]/g, '');
        const sanitizedColumns = indexDef.columns.map((c: string) => c.replace(/[^a-zA-Z0-9_]/g, ''));
        if (!sanitizedIndexName || sanitizedColumns.some((c: string) => !c)) continue;
        const unique = indexDef.unique ? 'UNIQUE' : '';
        const indexSql = `CREATE ${unique} INDEX IF NOT EXISTS idx_${tableName}_${sanitizedIndexName}
          ON ${tableName} (${sanitizedColumns.join(', ')})`;
        await dbQuery(indexSql);
      }
    }
  }

  /**
   * Drop database table
   */
  private async dropEntityTable(entityName: string): Promise<void> {
    const tableName = this.getTableName(entityName);
    await dbQuery(`DROP TABLE IF EXISTS ${tableName}`);
  }

  /**
   * Add column to table
   */
  private async addTableColumn(
    entityName: string,
    fieldName: string,
    field: EntityFieldMetadata
  ): Promise<void> {
    const dbDef = getFieldDbDefinition(field);
    if (!dbDef) return;

    const tableName = this.getTableName(entityName);
    const length = dbDef.length ? `(${dbDef.length})` : '';
    const nullable = dbDef.nullable ? '' : ' NOT NULL';
    const defaultVal = dbDef.default !== undefined ? ` DEFAULT ${dbDef.default}` : '';

    const sanitizedField = fieldName.replace(/[^a-zA-Z0-9_]/g, '');
    if (!sanitizedField) {
      throw new Error('Invalid field name');
    }
    const sql = `ALTER TABLE ${tableName} ADD COLUMN ${sanitizedField} ${dbDef.type}${length}${nullable}${defaultVal}`;
    await dbQuery(sql);
  }

  /**
   * Drop column from table
   */
  private async dropTableColumn(entityName: string, fieldName: string): Promise<void> {
    const tableName = this.getTableName(entityName);
    const sanitizedField = fieldName.replace(/[^a-zA-Z0-9_]/g, '');
    if (!sanitizedField) {
      throw new Error('Invalid field name');
    }
    await dbQuery(`ALTER TABLE ${tableName} DROP COLUMN ${sanitizedField}`);
  }

  /**
   * Get table name for entity
   */
  private getTableName(entityName: string): string {
    const sanitized = entityName.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!sanitized) {
      throw new Error('Invalid entity name');
    }
    return `custom_${sanitized}`;
  }
}

// Singleton instance
export const metadataService = new MetadataService();
