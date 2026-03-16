import { dbQuery } from '../db.js';
import { ApiError } from '../errors.js';

export type CustomFieldType = 'text' | 'number' | 'select' | 'date';

export interface CustomFieldDefinition {
  id: string;
  entityType: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: CustomFieldType;
  fieldOptions: string[];
  isRequired: boolean;
  displayOrder: number;
  visibleToRoles: string[];
  editableByRoles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomFieldValue {
  id: string;
  entityType: string;
  entityId: string;
  fieldKey: string;
  fieldValue: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomFieldInput {
  fieldKey: string;
  fieldLabel: string;
  fieldType: CustomFieldType;
  fieldOptions?: string[];
  isRequired?: boolean;
  displayOrder?: number;
  visibleToRoles?: string[];
  editableByRoles?: string[];
}

const VALID_FIELD_TYPES: CustomFieldType[] = ['text', 'number', 'select', 'date'];

/**
 * Validates field type
 */
export function validateFieldType(fieldType: string): CustomFieldType {
  if (!VALID_FIELD_TYPES.includes(fieldType as CustomFieldType)) {
    throw new ApiError(400, 'INVALID_FIELD_TYPE', `Field type must be one of: ${VALID_FIELD_TYPES.join(', ')}`);
  }
  return fieldType as CustomFieldType;
}

/**
 * Validates field key format (alphanumeric + underscore)
 */
export function validateFieldKey(fieldKey: string): string {
  const normalized = fieldKey.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    throw new ApiError(400, 'INVALID_FIELD_KEY', 'Field key must contain only lowercase letters, numbers, and underscores');
  }
  if (normalized.length < 2 || normalized.length > 50) {
    throw new ApiError(400, 'INVALID_FIELD_KEY', 'Field key must be between 2 and 50 characters');
  }
  return normalized;
}

/**
 * Validates field value based on field type
 */
export function validateFieldValue(value: string | null, fieldType: CustomFieldType, fieldOptions?: string[]): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }

  switch (fieldType) {
    case 'number':
      if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
        throw new ApiError(400, 'INVALID_FIELD_VALUE', 'Number field must contain a valid number');
      }
      return trimmed;

    case 'date':
      // Validate ISO date format (YYYY-MM-DD)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        throw new ApiError(400, 'INVALID_FIELD_VALUE', 'Date field must be in YYYY-MM-DD format');
      }
      const date = new Date(trimmed);
      if (isNaN(date.getTime())) {
        throw new ApiError(400, 'INVALID_FIELD_VALUE', 'Invalid date value');
      }
      return trimmed;

    case 'select':
      if (fieldOptions && fieldOptions.length > 0) {
        if (!fieldOptions.includes(trimmed)) {
          throw new ApiError(400, 'INVALID_FIELD_VALUE', `Value must be one of: ${fieldOptions.join(', ')}`);
        }
      }
      return trimmed;

    case 'text':
    default:
      if (trimmed.length > 1000) {
        throw new ApiError(400, 'INVALID_FIELD_VALUE', 'Text field value too long (max 1000 characters)');
      }
      return trimmed;
  }
}

/**
 * Serializes custom field definition from database row
 */
export function serializeCustomFieldDefinition(row: any): CustomFieldDefinition {
  return {
    id: String(row.id),
    entityType: String(row.entity_type || 'tenant'),
    fieldKey: String(row.field_key || ''),
    fieldLabel: String(row.field_label || ''),
    fieldType: String(row.field_type || 'text') as CustomFieldType,
    fieldOptions: Array.isArray(row.field_options) ? row.field_options : [],
    isRequired: Boolean(row.is_required),
    displayOrder: Number(row.display_order || 0),
    visibleToRoles: Array.isArray(row.visible_to_roles) ? row.visible_to_roles : [],
    editableByRoles: Array.isArray(row.editable_by_roles) ? row.editable_by_roles : [],
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}

/**
 * Serializes custom field value from database row
 */
export function serializeCustomFieldValue(row: any): CustomFieldValue {
  return {
    id: String(row.id),
    entityType: String(row.entity_type || 'tenant'),
    entityId: String(row.entity_id),
    fieldKey: String(row.field_key || ''),
    fieldValue: row.field_value !== null && row.field_value !== undefined ? String(row.field_value) : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}

/**
 * Get all custom field definitions for an entity type
 */
export async function getCustomFieldDefinitions(entityType: string = 'tenant'): Promise<CustomFieldDefinition[]> {
  const result = await dbQuery(
    `SELECT id::text, entity_type, field_key, field_label, field_type,
            field_options, is_required, display_order,
            coalesce(visible_to_roles, '[]'::jsonb) as visible_to_roles,
            coalesce(editable_by_roles, '[]'::jsonb) as editable_by_roles,
            created_at, updated_at
     FROM custom_field_definitions
     WHERE entity_type = $1 AND deleted_at IS NULL
     ORDER BY display_order ASC, created_at ASC`,
    [entityType]
  );

  return result.rows.map(serializeCustomFieldDefinition);
}

/**
 * Get custom field definition by ID
 */
export async function getCustomFieldDefinitionById(id: string): Promise<CustomFieldDefinition | null> {
  const result = await dbQuery(
    `SELECT id::text, entity_type, field_key, field_label, field_type,
            field_options, is_required, display_order,
            coalesce(visible_to_roles, '[]'::jsonb) as visible_to_roles,
            coalesce(editable_by_roles, '[]'::jsonb) as editable_by_roles,
            created_at, updated_at
     FROM custom_field_definitions
     WHERE id = $1::uuid AND deleted_at IS NULL`,
    [id]
  );

  return result.rows[0] ? serializeCustomFieldDefinition(result.rows[0]) : null;
}

/**
 * Create a new custom field definition
 */
export async function createCustomFieldDefinition(
  entityType: string,
  input: CustomFieldInput
): Promise<CustomFieldDefinition> {
  const fieldKey = validateFieldKey(input.fieldKey);
  const fieldType = validateFieldType(input.fieldType);
  const fieldLabel = input.fieldLabel.trim();

  if (!fieldLabel || fieldLabel.length < 1 || fieldLabel.length > 100) {
    throw new ApiError(400, 'INVALID_FIELD_LABEL', 'Field label must be between 1 and 100 characters');
  }

  const fieldOptions = Array.isArray(input.fieldOptions) ? input.fieldOptions.filter(opt => opt.trim()) : [];
  const isRequired = Boolean(input.isRequired);
  const displayOrder = Number(input.displayOrder) || 0;
  const visibleToRoles = Array.isArray(input.visibleToRoles) ? input.visibleToRoles : [];
  const editableByRoles = Array.isArray(input.editableByRoles) ? input.editableByRoles : [];

  // Check for duplicate field key
  const existing = await dbQuery(
    `SELECT id FROM custom_field_definitions
     WHERE entity_type = $1 AND field_key = $2 AND deleted_at IS NULL`,
    [entityType, fieldKey]
  );

  if (existing.rows.length > 0) {
    throw new ApiError(409, 'DUPLICATE_FIELD_KEY', 'A field with this key already exists');
  }

  const result = await dbQuery(
    `INSERT INTO custom_field_definitions
     (entity_type, field_key, field_label, field_type, field_options, is_required, display_order, visible_to_roles, editable_by_roles)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9::jsonb)
     RETURNING id::text, entity_type, field_key, field_label, field_type,
               field_options, is_required, display_order,
               coalesce(visible_to_roles, '[]'::jsonb) as visible_to_roles,
               coalesce(editable_by_roles, '[]'::jsonb) as editable_by_roles,
               created_at, updated_at`,
    [entityType, fieldKey, fieldLabel, fieldType, JSON.stringify(fieldOptions), isRequired, displayOrder, JSON.stringify(visibleToRoles), JSON.stringify(editableByRoles)]
  );

  if (!result.rows[0]) {
    throw new ApiError(500, 'CREATE_FAILED', 'Failed to create custom field definition');
  }

  return serializeCustomFieldDefinition(result.rows[0]);
}

/**
 * Update a custom field definition
 */
export async function updateCustomFieldDefinition(
  id: string,
  input: Partial<CustomFieldInput>
): Promise<CustomFieldDefinition> {
  const updates: string[] = [];
  const values: any[] = [id];
  let paramIndex = 2;

  if (input.fieldLabel !== undefined) {
    const fieldLabel = input.fieldLabel.trim();
    if (!fieldLabel || fieldLabel.length < 1 || fieldLabel.length > 100) {
      throw new ApiError(400, 'INVALID_FIELD_LABEL', 'Field label must be between 1 and 100 characters');
    }
    updates.push(`field_label = $${paramIndex}`);
    values.push(fieldLabel);
    paramIndex++;
  }

  if (input.fieldType !== undefined) {
    const fieldType = validateFieldType(input.fieldType);
    updates.push(`field_type = $${paramIndex}`);
    values.push(fieldType);
    paramIndex++;
  }

  if (input.fieldOptions !== undefined) {
    const fieldOptions = Array.isArray(input.fieldOptions) ? input.fieldOptions.filter(opt => opt.trim()) : [];
    updates.push(`field_options = $${paramIndex}::jsonb`);
    values.push(JSON.stringify(fieldOptions));
    paramIndex++;
  }

  if (input.isRequired !== undefined) {
    updates.push(`is_required = $${paramIndex}`);
    values.push(Boolean(input.isRequired));
    paramIndex++;
  }

  if (input.displayOrder !== undefined) {
    updates.push(`display_order = $${paramIndex}`);
    values.push(Number(input.displayOrder));
    paramIndex++;
  }

  if (input.visibleToRoles !== undefined) {
    updates.push(`visible_to_roles = $${paramIndex}::jsonb`);
    values.push(JSON.stringify(input.visibleToRoles));
    paramIndex++;
  }

  if (input.editableByRoles !== undefined) {
    updates.push(`editable_by_roles = $${paramIndex}::jsonb`);
    values.push(JSON.stringify(input.editableByRoles));
    paramIndex++;
  }

  if (updates.length === 0) {
    throw new ApiError(400, 'NO_UPDATES', 'No fields to update');
  }

  updates.push('updated_at = now()');

  const result = await dbQuery(
    `UPDATE custom_field_definitions
     SET ${updates.join(', ')}
     WHERE id = $1::uuid AND deleted_at IS NULL
     RETURNING id::text, entity_type, field_key, field_label, field_type,
               field_options, is_required, display_order,
               coalesce(visible_to_roles, '[]'::jsonb) as visible_to_roles,
               coalesce(editable_by_roles, '[]'::jsonb) as editable_by_roles,
               created_at, updated_at`,
    values
  );

  if (!result.rows[0]) {
    throw new ApiError(404, 'NOT_FOUND', 'Custom field definition not found');
  }

  return serializeCustomFieldDefinition(result.rows[0]);
}

/**
 * Delete a custom field definition (soft delete)
 */
export async function deleteCustomFieldDefinition(id: string): Promise<void> {
  const result = await dbQuery(
    `UPDATE custom_field_definitions
     SET deleted_at = now()
     WHERE id = $1::uuid AND deleted_at IS NULL
     RETURNING id`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'NOT_FOUND', 'Custom field definition not found');
  }

  // Also delete all values for this field
  await dbQuery(
    `DELETE FROM custom_field_values
     WHERE field_key = (SELECT field_key FROM custom_field_definitions WHERE id = $1::uuid)`,
    [id]
  );
}

/**
 * Get custom field values for an entity
 */
export async function getCustomFieldValues(entityType: string, entityId: string): Promise<Record<string, string | null>> {
  const result = await dbQuery(
    `SELECT field_key, field_value
     FROM custom_field_values
     WHERE entity_type = $1 AND entity_id = $2::uuid`,
    [entityType, entityId]
  );

  const values: Record<string, string | null> = {};
  for (const row of result.rows) {
    values[row.field_key] = row.field_value;
  }

  return values;
}

/**
 * Set custom field values for an entity
 */
export async function setCustomFieldValues(
  entityType: string,
  entityId: string,
  values: Record<string, string | null>,
  userRole?: string
): Promise<void> {
  // Get field definitions for validation
  const definitions = await getCustomFieldDefinitions(entityType);
  const definitionMap = new Map(definitions.map(def => [def.fieldKey, def]));

  for (const [fieldKey, fieldValue] of Object.entries(values)) {
    const definition = definitionMap.get(fieldKey);
    if (!definition) {
      continue; // Skip unknown fields
    }

    // Check if user has permission to edit this field
    if (userRole && !canUserEditField(definition, userRole)) {
      continue; // Skip fields user cannot edit
    }

    // Validate value
    const validatedValue = validateFieldValue(fieldValue, definition.fieldType, definition.fieldOptions);

    // Check required constraint
    if (definition.isRequired && !validatedValue) {
      throw new ApiError(400, 'REQUIRED_FIELD', `Field "${definition.fieldLabel}" is required`);
    }

    // Upsert value
    if (validatedValue !== null) {
      await dbQuery(
        `INSERT INTO custom_field_values (entity_type, entity_id, field_key, field_value)
         VALUES ($1, $2::uuid, $3, $4)
         ON CONFLICT (entity_type, entity_id, field_key)
         DO UPDATE SET field_value = $4, updated_at = now()`,
        [entityType, entityId, fieldKey, validatedValue]
      );
    } else {
      // Delete if value is null/empty
      await dbQuery(
        `DELETE FROM custom_field_values
         WHERE entity_type = $1 AND entity_id = $2::uuid AND field_key = $3`,
        [entityType, entityId, fieldKey]
      );
    }
  }
}

/**
 * Get custom field definitions filtered by user role visibility
 */
export async function getCustomFieldDefinitionsByRole(
  entityType: string,
  userRole: string
): Promise<CustomFieldDefinition[]> {
  const allDefinitions = await getCustomFieldDefinitions(entityType);
  return allDefinitions.filter(def => canUserViewField(def, userRole));
}

/**
 * Get custom field values with definitions filtered by user role
 */
export async function getCustomFieldsWithValuesByRole(
  entityType: string,
  entityId: string,
  userRole: string
): Promise<Array<CustomFieldDefinition & { value: string | null }>> {
  const definitions = await getCustomFieldDefinitionsByRole(entityType, userRole);
  const values = await getCustomFieldValues(entityType, entityId);

  return definitions.map(def => ({
    ...def,
    value: values[def.fieldKey] ?? null,
  }));
}

/**
 * Check if user can view a custom field based on role
 */
export function canUserViewField(definition: CustomFieldDefinition, userRole: string): boolean {
  if (!definition.visibleToRoles || definition.visibleToRoles.length === 0) {
    return true; // No restrictions, all roles can view
  }
  return definition.visibleToRoles.includes(userRole);
}

/**
 * Check if user can edit a custom field based on role
 */
export function canUserEditField(definition: CustomFieldDefinition, userRole: string): boolean {
  if (!definition.editableByRoles || definition.editableByRoles.length === 0) {
    return true; // No restrictions, all roles can edit
  }
  return definition.editableByRoles.includes(userRole);
}
