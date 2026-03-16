/**
 * Relationship Metadata System
 * Manages relationships between entities
 */

import type { LinkType } from './entityMetadata.js';

// Re-export LinkType for convenience
export type { LinkType };

export interface RelationshipMetadata {
  name: string;
  type: LinkType;
  leftEntity: string;
  rightEntity: string;
  leftLink?: string;
  rightLink?: string;
  relationName?: string;
  conditions?: Record<string, any>;
  additionalColumns?: Record<string, RelationshipColumn>;
  layoutRelationshipsDisabled?: boolean;
}

export interface RelationshipColumn {
  type: 'varchar' | 'int' | 'bool' | 'date' | 'datetime';
  length?: number;
  default?: any;
}

/**
 * Relationship type definitions
 */
export const RELATIONSHIP_TYPE_DEFS: Record<LinkType, {
  label: string;
  description: string;
  requiresJoinTable: boolean;
  bidirectional: boolean;
}> = {
  belongsTo: {
    label: 'Belongs To',
    description: 'Many-to-one relationship',
    requiresJoinTable: false,
    bidirectional: false,
  },
  hasMany: {
    label: 'Has Many',
    description: 'One-to-many relationship',
    requiresJoinTable: false,
    bidirectional: false,
  },
  hasOne: {
    label: 'Has One',
    description: 'One-to-one relationship',
    requiresJoinTable: false,
    bidirectional: false,
  },
  belongsToParent: {
    label: 'Belongs To Parent',
    description: 'Polymorphic many-to-one relationship',
    requiresJoinTable: false,
    bidirectional: false,
  },
  hasChildren: {
    label: 'Has Children',
    description: 'Polymorphic one-to-many relationship',
    requiresJoinTable: false,
    bidirectional: false,
  },
  manyMany: {
    label: 'Many to Many',
    description: 'Many-to-many relationship',
    requiresJoinTable: true,
    bidirectional: true,
  },
};

/**
 * Create relationship metadata
 */
export function createRelationship(
  name: string,
  type: LinkType,
  leftEntity: string,
  rightEntity: string,
  options: {
    leftLink?: string;
    rightLink?: string;
    relationName?: string;
    conditions?: Record<string, any>;
    additionalColumns?: Record<string, RelationshipColumn>;
  } = {}
): RelationshipMetadata {
  const typeDef = RELATIONSHIP_TYPE_DEFS[type];

  return {
    name,
    type,
    leftEntity,
    rightEntity,
    leftLink: options.leftLink || name,
    rightLink: options.rightLink,
    relationName: options.relationName || (typeDef.requiresJoinTable
      ? `${leftEntity}${rightEntity}`
      : undefined),
    conditions: options.conditions,
    additionalColumns: options.additionalColumns,
  };
}

/**
 * Validate relationship metadata
 */
export function validateRelationship(
  relationship: RelationshipMetadata,
  availableEntities: string[]
): string[] {
  const errors: string[] = [];
  const entitySet = new Set(availableEntities);

  if (!relationship.name || !/^[a-z][a-zA-Z0-9]*$/.test(relationship.name)) {
    errors.push('Relationship name must start with lowercase letter');
  }

  if (!entitySet.has(relationship.leftEntity)) {
    errors.push(`Left entity '${relationship.leftEntity}' does not exist`);
  }

  if (!entitySet.has(relationship.rightEntity)) {
    errors.push(`Right entity '${relationship.rightEntity}' does not exist`);
  }

  const typeDef = RELATIONSHIP_TYPE_DEFS[relationship.type];
  if (!typeDef) {
    errors.push(`Invalid relationship type: ${relationship.type}`);
  } else if (typeDef.requiresJoinTable && !relationship.relationName) {
    errors.push('Many-to-many relationships require a relation name');
  }

  return errors;
}

/**
 * Get inverse relationship type
 */
export function getInverseRelationType(type: LinkType): LinkType | null {
  const inverseMap: Record<LinkType, LinkType | null> = {
    belongsTo: 'hasMany',
    hasMany: 'belongsTo',
    hasOne: 'belongsTo',
    belongsToParent: 'hasChildren',
    hasChildren: 'belongsToParent',
    manyMany: 'manyMany',
  };

  return inverseMap[type];
}

/**
 * Generate join table name for many-to-many relationship
 */
export function generateJoinTableName(leftEntity: string, rightEntity: string): string {
  const entities = [leftEntity, rightEntity].sort();
  return `${entities[0]}_${entities[1]}`.toLowerCase();
}

/**
 * Get foreign key column name
 */
export function getForeignKeyColumn(entityName: string): string {
  return `${entityName.charAt(0).toLowerCase()}${entityName.slice(1)}Id`;
}

/**
 * Create bidirectional relationship
 */
export function createBidirectionalRelationship(
  leftEntity: string,
  rightEntity: string,
  type: 'oneToMany' | 'manyToMany',
  leftLinkName: string,
  rightLinkName: string
): RelationshipMetadata[] {
  if (type === 'oneToMany') {
    return [
      createRelationship(leftLinkName, 'hasMany', leftEntity, rightEntity, {
        rightLink: rightLinkName,
      }),
      createRelationship(rightLinkName, 'belongsTo', rightEntity, leftEntity, {
        rightLink: leftLinkName,
      }),
    ];
  } else {
    const relationName = generateJoinTableName(leftEntity, rightEntity);
    return [
      createRelationship(leftLinkName, 'manyMany', leftEntity, rightEntity, {
        rightLink: rightLinkName,
        relationName,
      }),
      createRelationship(rightLinkName, 'manyMany', rightEntity, leftEntity, {
        rightLink: leftLinkName,
        relationName,
      }),
    ];
  }
}

/**
 * Get SQL for creating join table
 */
export function getJoinTableSql(relationship: RelationshipMetadata): string | null {
  if (!RELATIONSHIP_TYPE_DEFS[relationship.type].requiresJoinTable) {
    return null;
  }

  const tableName = relationship.relationName;
  const leftColumn = getForeignKeyColumn(relationship.leftEntity);
  const rightColumn = getForeignKeyColumn(relationship.rightEntity);

  let sql = `CREATE TABLE IF NOT EXISTS ${tableName} (
    id VARCHAR(36) PRIMARY KEY,
    ${leftColumn} VARCHAR(36) NOT NULL,
    ${rightColumn} VARCHAR(36) NOT NULL,
    deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_${leftColumn} (${leftColumn}),
    INDEX idx_${rightColumn} (${rightColumn}),
    UNIQUE KEY unique_relation (${leftColumn}, ${rightColumn})
  )`;

  // Add additional columns
  if (relationship.additionalColumns) {
    for (const [colName, colDef] of Object.entries(relationship.additionalColumns)) {
      const colType = colDef.type.toUpperCase();
      const length = colDef.length ? `(${colDef.length})` : '';
      const defaultVal = colDef.default !== undefined ? ` DEFAULT ${colDef.default}` : '';
      sql = sql.replace(')', `,\n    ${colName} ${colType}${length}${defaultVal}\n  )`);
    }
  }

  return sql;
}
