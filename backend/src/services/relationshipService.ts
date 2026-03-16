import { dbQuery } from '../db.js';
import { logger } from '../logger.js';

export interface EntityRelationship {
  id?: string;
  sourceEntityType: string;
  sourceEntityId: string;
  targetEntityType: string;
  targetEntityId: string;
  relationshipType: string;
  relationshipStrength?: number;
  isBidirectional?: boolean;
  metadata?: Record<string, any>;
  createdByUserId?: string;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}

export interface RelationshipType {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  sourceEntityTypes: string[];
  targetEntityTypes: string[];
  isBidirectional: boolean;
  defaultStrength: number;
  icon?: string;
  color?: string;
  isSystem: boolean;
  isActive: boolean;
}

export interface RelationshipInsight {
  entityType: string;
  entityId: string;
  totalRelationships: number;
  incomingRelationships: number;
  outgoingRelationships: number;
  relationshipTypesCount: Record<string, number>;
  mostConnectedEntities: Array<{
    entityType: string;
    entityId: string;
    connectionCount: number;
  }>;
  lastCalculatedAt: Date;
}

export interface RelatedRecord {
  entityType: string;
  entityId: string;
  relationshipType: string;
  depth: number;
  path: string[];
}

/**
 * Create a relationship between two entities
 */
export async function createRelationship(
  relationship: EntityRelationship
): Promise<string> {
  const result = await dbQuery(
    `INSERT INTO entity_relationships (
      source_entity_type,
      source_entity_id,
      target_entity_type,
      target_entity_id,
      relationship_type,
      relationship_strength,
      is_bidirectional,
      metadata,
      created_by_user_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (source_entity_type, source_entity_id, target_entity_type, target_entity_id, relationship_type)
    DO UPDATE SET
      relationship_strength = EXCLUDED.relationship_strength,
      is_bidirectional = EXCLUDED.is_bidirectional,
      metadata = EXCLUDED.metadata,
      updated_at = NOW(),
      deleted_at = NULL
    RETURNING id::text`,
    [
      relationship.sourceEntityType,
      relationship.sourceEntityId,
      relationship.targetEntityType,
      relationship.targetEntityId,
      relationship.relationshipType,
      relationship.relationshipStrength || 50,
      relationship.isBidirectional !== false,
      JSON.stringify(relationship.metadata || {}),
      relationship.createdByUserId || null,
    ]
  );

  const relationshipId = result.rows[0].id;

  // Update insights for both entities
  await updateRelationshipInsights(
    relationship.sourceEntityType,
    relationship.sourceEntityId
  );
  await updateRelationshipInsights(
    relationship.targetEntityType,
    relationship.targetEntityId
  );

  return relationshipId;
}

/**
 * Get relationships for an entity
 */
export async function getEntityRelationships(
  entityType: string,
  entityId: string,
  options?: {
    relationshipType?: string;
    includeDeleted?: boolean;
    direction?: 'outgoing' | 'incoming' | 'both';
  }
): Promise<EntityRelationship[]> {
  const conditions: string[] = [];
  const params: any[] = [entityType, entityId];
  let paramIndex = 3;

  // Direction filter
  if (options?.direction === 'outgoing') {
    conditions.push('source_entity_type = $1 AND source_entity_id = $2');
  } else if (options?.direction === 'incoming') {
    conditions.push('target_entity_type = $1 AND target_entity_id = $2');
  } else {
    conditions.push(
      '((source_entity_type = $1 AND source_entity_id = $2) OR (target_entity_type = $1 AND target_entity_id = $2))'
    );
  }

  // Relationship type filter
  if (options?.relationshipType) {
    conditions.push(`relationship_type = $${paramIndex}`);
    params.push(options.relationshipType);
    paramIndex++;
  }

  // Deleted filter
  if (!options?.includeDeleted) {
    conditions.push('deleted_at IS NULL');
  }

  const whereClause = conditions.join(' AND ');

  const result = await dbQuery(
    `SELECT
      id::text,
      source_entity_type,
      source_entity_id::text,
      target_entity_type,
      target_entity_id::text,
      relationship_type,
      relationship_strength,
      is_bidirectional,
      metadata,
      created_by_user_id::text,
      created_at,
      updated_at,
      deleted_at
    FROM entity_relationships
    WHERE ${whereClause}
    ORDER BY created_at DESC`,
    params
  );

  return result.rows.map((row) => ({
    id: row.id,
    sourceEntityType: row.source_entity_type,
    sourceEntityId: row.source_entity_id,
    targetEntityType: row.target_entity_type,
    targetEntityId: row.target_entity_id,
    relationshipType: row.relationship_type,
    relationshipStrength: row.relationship_strength,
    isBidirectional: row.is_bidirectional,
    metadata: row.metadata,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }));
}

/**
 * Delete a relationship (soft delete)
 */
export async function deleteRelationship(
  relationshipId: string,
  userId?: string
): Promise<boolean> {
  const result = await dbQuery(
    `UPDATE entity_relationships
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING source_entity_type, source_entity_id::text, target_entity_type, target_entity_id::text`,
    [relationshipId]
  );

  if (result.rows.length > 0) {
    const row = result.rows[0];
    // Update insights
    await updateRelationshipInsights(row.source_entity_type, row.source_entity_id);
    await updateRelationshipInsights(row.target_entity_type, row.target_entity_id);
    return true;
  }

  return false;
}

/**
 * Update relationship metadata or strength
 */
export async function updateRelationship(
  relationshipId: string,
  updates: {
    relationshipStrength?: number;
    metadata?: Record<string, any>;
    isBidirectional?: boolean;
  }
): Promise<boolean> {
  const setClauses: string[] = ['updated_at = NOW()'];
  const params: any[] = [];
  let paramIndex = 1;

  if (updates.relationshipStrength !== undefined) {
    setClauses.push(`relationship_strength = $${paramIndex}`);
    params.push(updates.relationshipStrength);
    paramIndex++;
  }

  if (updates.metadata !== undefined) {
    setClauses.push(`metadata = $${paramIndex}`);
    params.push(JSON.stringify(updates.metadata));
    paramIndex++;
  }

  if (updates.isBidirectional !== undefined) {
    setClauses.push(`is_bidirectional = $${paramIndex}`);
    params.push(updates.isBidirectional);
    paramIndex++;
  }

  params.push(relationshipId);

  const result = await dbQuery(
    `UPDATE entity_relationships
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex} AND deleted_at IS NULL
    RETURNING id`,
    params
  );

  return result.rows.length > 0;
}

/**
 * Get relationship types
 */
export async function getRelationshipTypes(
  activeOnly: boolean = true
): Promise<RelationshipType[]> {
  const whereClause = activeOnly ? 'WHERE is_active = true' : '';

  const result = await dbQuery(
    `SELECT
      id::text,
      name,
      display_name,
      description,
      source_entity_types,
      target_entity_types,
      is_bidirectional,
      default_strength,
      icon,
      color,
      is_system,
      is_active
    FROM relationship_types
    ${whereClause}
    ORDER BY display_name`,
    []
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    sourceEntityTypes: row.source_entity_types,
    targetEntityTypes: row.target_entity_types,
    isBidirectional: row.is_bidirectional,
    defaultStrength: row.default_strength,
    icon: row.icon,
    color: row.color,
    isSystem: row.is_system,
    isActive: row.is_active,
  }));
}

/**
 * Get relationship insights for an entity
 */
export async function getRelationshipInsights(
  entityType: string,
  entityId: string
): Promise<RelationshipInsight | null> {
  const result = await dbQuery(
    `SELECT
      entity_type,
      entity_id::text,
      total_relationships,
      incoming_relationships,
      outgoing_relationships,
      relationship_types_count,
      most_connected_entities,
      last_calculated_at
    FROM relationship_insights
    WHERE entity_type = $1 AND entity_id = $2`,
    [entityType, entityId]
  );

  if (result.rows.length === 0) {
    // Calculate insights if not exists
    await updateRelationshipInsights(entityType, entityId);
    return getRelationshipInsights(entityType, entityId);
  }

  const row = result.rows[0];
  return {
    entityType: row.entity_type,
    entityId: row.entity_id,
    totalRelationships: row.total_relationships,
    incomingRelationships: row.incoming_relationships,
    outgoingRelationships: row.outgoing_relationships,
    relationshipTypesCount: row.relationship_types_count,
    mostConnectedEntities: row.most_connected_entities,
    lastCalculatedAt: row.last_calculated_at,
  };
}

/**
 * Update relationship insights for an entity
 */
export async function updateRelationshipInsights(
  entityType: string,
  entityId: string
): Promise<void> {
  try {
    await dbQuery(
      `SELECT update_relationship_insights($1, $2)`,
      [entityType, entityId]
    );
  } catch (error) {
    logger.error('Failed to update relationship insights', { error, entityType, entityId });
  }
}

/**
 * Find related records recursively
 */
export async function findRelatedRecords(
  entityType: string,
  entityId: string,
  maxDepth: number = 2
): Promise<RelatedRecord[]> {
  const result = await dbQuery(
    `SELECT
      entity_type,
      entity_id::text,
      relationship_type,
      depth,
      path
    FROM find_related_records($1, $2, $3)`,
    [entityType, entityId, maxDepth]
  );

  return result.rows.map((row) => ({
    entityType: row.entity_type,
    entityId: row.entity_id,
    relationshipType: row.relationship_type,
    depth: row.depth,
    path: row.path,
  }));
}

/**
 * Get relationship history
 */
export async function getRelationshipHistory(
  relationshipId: string
): Promise<any[]> {
  const result = await dbQuery(
    `SELECT
      id::text,
      relationship_id::text,
      action,
      changed_fields,
      old_values,
      new_values,
      changed_by_user_id::text,
      changed_by_name,
      created_at
    FROM relationship_history
    WHERE relationship_id = $1
    ORDER BY created_at DESC`,
    [relationshipId]
  );

  return result.rows;
}

/**
 * Find potential duplicate relationships
 */
export async function findDuplicateRelationships(
  entityType: string,
  entityId: string
): Promise<Array<{ entityType: string; entityId: string; score: number }>> {
  // Find entities with similar relationship patterns
  const result = await dbQuery(
    `WITH entity_rels AS (
      SELECT
        CASE
          WHEN source_entity_type = $1 AND source_entity_id = $2
          THEN target_entity_type || ':' || target_entity_id::text
          ELSE source_entity_type || ':' || source_entity_id::text
        END as related_entity,
        relationship_type
      FROM entity_relationships
      WHERE deleted_at IS NULL
      AND (
        (source_entity_type = $1 AND source_entity_id = $2)
        OR (target_entity_type = $1 AND target_entity_id = $2)
      )
    ),
    similar_entities AS (
      SELECT
        CASE
          WHEN r.source_entity_type = $1 AND r.source_entity_id = $2
          THEN r.target_entity_type
          WHEN r.target_entity_type = $1 AND r.target_entity_id = $2
          THEN r.source_entity_type
          ELSE CASE
            WHEN r.source_entity_type || ':' || r.source_entity_id::text IN (SELECT related_entity FROM entity_rels)
            THEN r.target_entity_type
            ELSE r.source_entity_type
          END
        END as entity_type,
        CASE
          WHEN r.source_entity_type = $1 AND r.source_entity_id = $2
          THEN r.target_entity_id
          WHEN r.target_entity_type = $1 AND r.target_entity_id = $2
          THEN r.source_entity_id
          ELSE CASE
            WHEN r.source_entity_type || ':' || r.source_entity_id::text IN (SELECT related_entity FROM entity_rels)
            THEN r.target_entity_id
            ELSE r.source_entity_id
          END
        END as entity_id,
        COUNT(*) as common_relationships
      FROM entity_relationships r
      WHERE r.deleted_at IS NULL
      AND (
        r.source_entity_type || ':' || r.source_entity_id::text IN (SELECT related_entity FROM entity_rels)
        OR r.target_entity_type || ':' || r.target_entity_id::text IN (SELECT related_entity FROM entity_rels)
      )
      AND NOT (r.source_entity_type = $1 AND r.source_entity_id = $2)
      AND NOT (r.target_entity_type = $1 AND r.target_entity_id = $2)
      GROUP BY entity_type, entity_id
      HAVING COUNT(*) >= 2
    )
    SELECT
      entity_type,
      entity_id::text,
      common_relationships,
      ROUND((common_relationships::numeric / NULLIF((SELECT COUNT(*) FROM entity_rels), 0)) * 100) as similarity_score
    FROM similar_entities
    WHERE entity_type = $1
    ORDER BY similarity_score DESC, common_relationships DESC
    LIMIT 10`,
    [entityType, entityId]
  );

  return result.rows.map((row) => ({
    entityType: row.entity_type,
    entityId: row.entity_id,
    score: parseInt(row.similarity_score || '0', 10),
  }));
}

/**
 * Get relationship graph data for visualization
 */
export async function getRelationshipGraph(
  entityType: string,
  entityId: string,
  maxDepth: number = 2
): Promise<{
  nodes: Array<{ id: string; type: string; label: string }>;
  edges: Array<{
    source: string;
    target: string;
    type: string;
    strength: number;
    bidirectional: boolean;
  }>;
}> {
  const relatedRecords = await findRelatedRecords(entityType, entityId, maxDepth);
  const relationships = await getEntityRelationships(entityType, entityId, {
    direction: 'both',
  });

  const nodes = new Map<string, { id: string; type: string; label: string }>();
  const edges: Array<{
    source: string;
    target: string;
    type: string;
    strength: number;
    bidirectional: boolean;
  }> = [];

  // Add root node
  const rootId = `${entityType}:${entityId}`;
  nodes.set(rootId, { id: rootId, type: entityType, label: entityId });

  // Add related nodes
  for (const record of relatedRecords) {
    const nodeId = `${record.entityType}:${record.entityId}`;
    if (!nodes.has(nodeId)) {
      nodes.set(nodeId, {
        id: nodeId,
        type: record.entityType,
        label: record.entityId,
      });
    }
  }

  // Add edges
  for (const rel of relationships) {
    const sourceId = `${rel.sourceEntityType}:${rel.sourceEntityId}`;
    const targetId = `${rel.targetEntityType}:${rel.targetEntityId}`;

    edges.push({
      source: sourceId,
      target: targetId,
      type: rel.relationshipType,
      strength: rel.relationshipStrength || 50,
      bidirectional: rel.isBidirectional || false,
    });
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
  };
}
