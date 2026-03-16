/**
 * Entity Metadata System
 * Defines the structure and behavior of entities in the system
 */

export interface EntityFieldMetadata {
  name: string;
  type: FieldType;
  label?: string;
  required?: boolean;
  readOnly?: boolean;
  default?: any;
  validation?: FieldValidation;
  display?: FieldDisplay;
  options?: string[] | { value: string; label: string }[];
  min?: number;
  max?: number;
  maxLength?: number;
  pattern?: string;
  view?: string;
  audited?: boolean;
  layoutListDisabled?: boolean;
  layoutDetailDisabled?: boolean;
  layoutMassUpdateDisabled?: boolean;
  notStorable?: boolean;
  duplicateIgnore?: boolean;
  dynamicLogicDisabled?: boolean;
  orderDisabled?: boolean;
  // Conditional field logic
  dependsOn?: string[];
  visibleIf?: ConditionalLogic;
  requiredIf?: ConditionalLogic;
  readOnlyIf?: ConditionalLogic;
}

export interface EntityLinkMetadata {
  name: string;
  type: LinkType;
  entity: string;
  foreign?: string;
  relationName?: string;
  layoutRelationshipsDisabled?: boolean;
}

export interface EntityMetadata {
  name: string;
  type: EntityType;
  labelSingular?: string;
  labelPlural?: string;
  fields: Record<string, EntityFieldMetadata>;
  links?: Record<string, EntityLinkMetadata>;
  collection?: {
    orderBy?: string;
    order?: 'asc' | 'desc';
  };
  indexes?: Record<string, {
    columns: string[];
    unique?: boolean;
  }>;
  color?: string;
  iconClass?: string;
  stream?: boolean;
  disabled?: boolean;
  textFilterFields?: string[];
  fullTextSearch?: boolean;
  countDisabled?: boolean;
  optimisticConcurrencyControl?: boolean;
  kanbanViewMode?: boolean;
  kanbanStatusIgnoreList?: string[];
  // Extension hooks
  hooks?: EntityHooks;
  // Custom entity flag
  isCustom?: boolean;
  createdAt?: string;
  modifiedAt?: string;
}

export type FieldType =
  | 'varchar'
  | 'text'
  | 'int'
  | 'float'
  | 'bool'
  | 'date'
  | 'datetime'
  | 'datetimeOptional'
  | 'enum'
  | 'multiEnum'
  | 'link'
  | 'linkMultiple'
  | 'linkParent'
  | 'jsonArray'
  | 'jsonObject'
  | 'email'
  | 'phone'
  | 'url'
  | 'currency'
  | 'duration'
  | 'file'
  | 'image'
  | 'autoincrement'
  | 'barcode'
  | 'wysiwyg';

export type LinkType =
  | 'belongsTo'
  | 'hasMany'
  | 'hasOne'
  | 'belongsToParent'
  | 'hasChildren'
  | 'manyMany';

export type EntityType =
  | 'Base'
  | 'BasePlus'
  | 'Person'
  | 'Company'
  | 'Event'
  | 'CategoryTree'
  | 'Custom';

export interface FieldValidation {
  type?: 'required' | 'email' | 'phone' | 'url' | 'pattern' | 'range' | 'custom';
  message?: string;
  validator?: string; // Class name for custom validator
  params?: Record<string, any>;
}

export interface FieldDisplay {
  displayAsLabel?: boolean;
  labelType?: 'default' | 'success' | 'danger' | 'warning' | 'info' | 'state';
  style?: Record<string, string>;
}

export interface ConditionalLogic {
  operator: 'and' | 'or';
  conditions: Array<{
    field: string;
    operator: 'equals' | 'notEquals' | 'in' | 'notIn' | 'isEmpty' | 'isNotEmpty' | 'greaterThan' | 'lessThan';
    value?: any;
  }>;
}

export interface EntityHooks {
  beforeCreate?: string[];
  afterCreate?: string[];
  beforeUpdate?: string[];
  afterUpdate?: string[];
  beforeDelete?: string[];
  afterDelete?: string[];
}

/**
 * Base entity templates
 */
export const BASE_ENTITY_FIELDS: Record<string, EntityFieldMetadata> = {
  id: {
    name: 'id',
    type: 'varchar',
    readOnly: true,
    maxLength: 36,
  },
  createdAt: {
    name: 'createdAt',
    type: 'datetime',
    readOnly: true,
  },
  modifiedAt: {
    name: 'modifiedAt',
    type: 'datetime',
    readOnly: true,
  },
  deleted: {
    name: 'deleted',
    type: 'bool',
    readOnly: true,
    layoutListDisabled: true,
    layoutDetailDisabled: true,
  },
};

export const BASE_PLUS_ENTITY_FIELDS: Record<string, EntityFieldMetadata> = {
  ...BASE_ENTITY_FIELDS,
  name: {
    name: 'name',
    type: 'varchar',
    required: true,
    maxLength: 255,
  },
  description: {
    name: 'description',
    type: 'text',
  },
  createdBy: {
    name: 'createdBy',
    type: 'link',
    readOnly: true,
    view: 'views/fields/user',
  },
  modifiedBy: {
    name: 'modifiedBy',
    type: 'link',
    readOnly: true,
    view: 'views/fields/user',
  },
  assignedUser: {
    name: 'assignedUser',
    type: 'link',
    view: 'views/fields/assigned-user',
  },
  teams: {
    name: 'teams',
    type: 'linkMultiple',
    view: 'views/fields/teams',
  },
};

export const BASE_PLUS_ENTITY_LINKS: Record<string, EntityLinkMetadata> = {
  createdBy: {
    name: 'createdBy',
    type: 'belongsTo',
    entity: 'User',
  },
  modifiedBy: {
    name: 'modifiedBy',
    type: 'belongsTo',
    entity: 'User',
  },
  assignedUser: {
    name: 'assignedUser',
    type: 'belongsTo',
    entity: 'User',
  },
  teams: {
    name: 'teams',
    type: 'hasMany',
    entity: 'Team',
    relationName: 'entityTeam',
    layoutRelationshipsDisabled: true,
  },
};

/**
 * Field type definitions with default properties
 */
export const FIELD_TYPE_DEFS: Record<FieldType, Partial<EntityFieldMetadata>> = {
  varchar: { maxLength: 255 },
  text: {},
  int: {},
  float: {},
  bool: { default: false },
  date: {},
  datetime: {},
  datetimeOptional: {},
  enum: { options: [] },
  multiEnum: { options: [] },
  link: {},
  linkMultiple: {},
  linkParent: {},
  jsonArray: { notStorable: true },
  jsonObject: { notStorable: true },
  email: { maxLength: 255 },
  phone: { maxLength: 50 },
  url: { maxLength: 512 },
  currency: {},
  duration: { notStorable: true },
  file: {},
  image: {},
  autoincrement: { readOnly: true },
  barcode: { maxLength: 255 },
  wysiwyg: {},
};

/**
 * Validate entity metadata
 */
export function validateEntityMetadata(metadata: EntityMetadata): string[] {
  const errors: string[] = [];

  if (!metadata.name || !/^[A-Z][a-zA-Z0-9]*$/.test(metadata.name)) {
    errors.push('Entity name must start with uppercase letter and contain only alphanumeric characters');
  }

  if (!metadata.fields || Object.keys(metadata.fields).length === 0) {
    errors.push('Entity must have at least one field');
  }

  // Validate fields
  for (const [fieldName, field] of Object.entries(metadata.fields || {})) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(fieldName)) {
      errors.push(`Field name '${fieldName}' must start with lowercase letter`);
    }

    if (!FIELD_TYPE_DEFS[field.type]) {
      errors.push(`Invalid field type '${field.type}' for field '${fieldName}'`);
    }

    if (field.type === 'enum' && (!field.options || field.options.length === 0)) {
      errors.push(`Enum field '${fieldName}' must have options`);
    }

    if (field.type === 'link' && metadata.links && !metadata.links[fieldName]) {
      errors.push(`Link field '${fieldName}' must have corresponding link definition`);
    }
  }

  // Validate links
  for (const [linkName, link] of Object.entries(metadata.links || {})) {
    if (!link.entity) {
      errors.push(`Link '${linkName}' must specify target entity`);
    }
  }

  return errors;
}

/**
 * Merge entity metadata with base template
 */
export function mergeWithBaseTemplate(
  metadata: Partial<EntityMetadata>,
  type: EntityType
): EntityMetadata {
  const baseFields = type === 'BasePlus' ? BASE_PLUS_ENTITY_FIELDS : BASE_ENTITY_FIELDS;
  const baseLinks = type === 'BasePlus' ? BASE_PLUS_ENTITY_LINKS : {};

  return {
    name: metadata.name || 'Unnamed',
    type,
    fields: { ...baseFields, ...(metadata.fields || {}) },
    links: { ...baseLinks, ...(metadata.links || {}) },
    collection: metadata.collection,
    indexes: metadata.indexes,
    color: metadata.color,
    iconClass: metadata.iconClass,
    stream: metadata.stream,
    disabled: metadata.disabled,
    textFilterFields: metadata.textFilterFields,
    fullTextSearch: metadata.fullTextSearch,
    countDisabled: metadata.countDisabled,
    optimisticConcurrencyControl: metadata.optimisticConcurrencyControl,
    kanbanViewMode: metadata.kanbanViewMode,
    kanbanStatusIgnoreList: metadata.kanbanStatusIgnoreList,
    hooks: metadata.hooks,
    isCustom: metadata.isCustom,
    labelSingular: metadata.labelSingular,
    labelPlural: metadata.labelPlural,
  };
}
