/**
 * Field Metadata System
 * Manages field definitions and custom field types
 */

import type { EntityFieldMetadata, FieldType, FieldValidation } from './entityMetadata.js';

export interface FieldTypeDefinition {
  name: FieldType;
  label: string;
  category: 'basic' | 'advanced' | 'relationship' | 'custom';
  params: FieldParam[];
  defaultMetadata: Partial<EntityFieldMetadata>;
  validationRules?: FieldValidation[];
  dbType?: string;
  dbLength?: number;
  requiresIndex?: boolean;
}

export interface FieldParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  label: string;
  required?: boolean;
  default?: any;
  options?: Array<{ value: any; label: string }>;
  description?: string;
}

/**
 * Built-in field type definitions
 */
export const FIELD_TYPE_DEFINITIONS: Record<string, FieldTypeDefinition> = {
  varchar: {
    name: 'varchar',
    label: 'Text (Short)',
    category: 'basic',
    dbType: 'VARCHAR',
    dbLength: 255,
    params: [
      {
        name: 'maxLength',
        type: 'number',
        label: 'Max Length',
        default: 255,
      },
      {
        name: 'pattern',
        type: 'string',
        label: 'Pattern (Regex)',
      },
    ],
    defaultMetadata: {
      type: 'varchar',
      maxLength: 255,
    },
  },
  text: {
    name: 'text',
    label: 'Text (Long)',
    category: 'basic',
    dbType: 'TEXT',
    params: [],
    defaultMetadata: {
      type: 'text',
    },
  },
  int: {
    name: 'int',
    label: 'Integer',
    category: 'basic',
    dbType: 'INT',
    params: [
      {
        name: 'min',
        type: 'number',
        label: 'Minimum Value',
      },
      {
        name: 'max',
        type: 'number',
        label: 'Maximum Value',
      },
    ],
    defaultMetadata: {
      type: 'int',
    },
  },
  float: {
    name: 'float',
    label: 'Decimal',
    category: 'basic',
    dbType: 'DECIMAL',
    params: [
      {
        name: 'min',
        type: 'number',
        label: 'Minimum Value',
      },
      {
        name: 'max',
        type: 'number',
        label: 'Maximum Value',
      },
    ],
    defaultMetadata: {
      type: 'float',
    },
  },
  bool: {
    name: 'bool',
    label: 'Boolean',
    category: 'basic',
    dbType: 'BOOLEAN',
    params: [
      {
        name: 'default',
        type: 'boolean',
        label: 'Default Value',
        default: false,
      },
    ],
    defaultMetadata: {
      type: 'bool',
      default: false,
    },
  },
  date: {
    name: 'date',
    label: 'Date',
    category: 'basic',
    dbType: 'DATE',
    params: [],
    defaultMetadata: {
      type: 'date',
    },
  },
  datetime: {
    name: 'datetime',
    label: 'Date & Time',
    category: 'basic',
    dbType: 'TIMESTAMP',
    params: [],
    defaultMetadata: {
      type: 'datetime',
    },
  },
  enum: {
    name: 'enum',
    label: 'Dropdown',
    category: 'basic',
    dbType: 'VARCHAR',
    dbLength: 100,
    params: [
      {
        name: 'options',
        type: 'array',
        label: 'Options',
        required: true,
        description: 'List of available options',
      },
      {
        name: 'default',
        type: 'string',
        label: 'Default Value',
      },
      {
        name: 'displayAsLabel',
        type: 'boolean',
        label: 'Display as Label',
        default: false,
      },
    ],
    defaultMetadata: {
      type: 'enum',
      options: [],
    },
  },
  multiEnum: {
    name: 'multiEnum',
    label: 'Multi-Select',
    category: 'basic',
    dbType: 'JSON',
    params: [
      {
        name: 'options',
        type: 'array',
        label: 'Options',
        required: true,
      },
    ],
    defaultMetadata: {
      type: 'multiEnum',
      options: [],
    },
  },
  email: {
    name: 'email',
    label: 'Email',
    category: 'basic',
    dbType: 'VARCHAR',
    dbLength: 255,
    params: [],
    defaultMetadata: {
      type: 'email',
      maxLength: 255,
    },
    validationRules: [
      {
        type: 'email',
        message: 'Invalid email format',
      },
    ],
  },
  phone: {
    name: 'phone',
    label: 'Phone',
    category: 'basic',
    dbType: 'VARCHAR',
    dbLength: 50,
    params: [],
    defaultMetadata: {
      type: 'phone',
      maxLength: 50,
    },
  },
  url: {
    name: 'url',
    label: 'URL',
    category: 'basic',
    dbType: 'VARCHAR',
    dbLength: 512,
    params: [],
    defaultMetadata: {
      type: 'url',
      maxLength: 512,
    },
    validationRules: [
      {
        type: 'url',
        message: 'Invalid URL format',
      },
    ],
  },
  link: {
    name: 'link',
    label: 'Link (Relation)',
    category: 'relationship',
    dbType: 'VARCHAR',
    dbLength: 36,
    requiresIndex: true,
    params: [
      {
        name: 'entity',
        type: 'string',
        label: 'Target Entity',
        required: true,
      },
    ],
    defaultMetadata: {
      type: 'link',
    },
  },
  linkMultiple: {
    name: 'linkMultiple',
    label: 'Link Multiple',
    category: 'relationship',
    params: [
      {
        name: 'entity',
        type: 'string',
        label: 'Target Entity',
        required: true,
      },
    ],
    defaultMetadata: {
      type: 'linkMultiple',
      notStorable: true,
    },
  },
  jsonArray: {
    name: 'jsonArray',
    label: 'JSON Array',
    category: 'advanced',
    dbType: 'JSON',
    params: [],
    defaultMetadata: {
      type: 'jsonArray',
      notStorable: true,
    },
  },
  jsonObject: {
    name: 'jsonObject',
    label: 'JSON Object',
    category: 'advanced',
    dbType: 'JSON',
    params: [],
    defaultMetadata: {
      type: 'jsonObject',
      notStorable: true,
    },
  },
  wysiwyg: {
    name: 'wysiwyg',
    label: 'Rich Text',
    category: 'advanced',
    dbType: 'TEXT',
    params: [],
    defaultMetadata: {
      type: 'wysiwyg',
    },
  },
  currency: {
    name: 'currency',
    label: 'Currency',
    category: 'advanced',
    dbType: 'DECIMAL',
    params: [
      {
        name: 'min',
        type: 'number',
        label: 'Minimum Value',
      },
      {
        name: 'max',
        type: 'number',
        label: 'Maximum Value',
      },
    ],
    defaultMetadata: {
      type: 'currency',
    },
  },
  file: {
    name: 'file',
    label: 'File',
    category: 'advanced',
    dbType: 'VARCHAR',
    dbLength: 36,
    params: [],
    defaultMetadata: {
      type: 'file',
    },
  },
  image: {
    name: 'image',
    label: 'Image',
    category: 'advanced',
    dbType: 'VARCHAR',
    dbLength: 36,
    params: [],
    defaultMetadata: {
      type: 'image',
    },
  },
  autoincrement: {
    name: 'autoincrement',
    label: 'Auto Number',
    category: 'advanced',
    dbType: 'INT',
    params: [],
    defaultMetadata: {
      type: 'autoincrement',
      readOnly: true,
    },
  },
  barcode: {
    name: 'barcode',
    label: 'Barcode',
    category: 'advanced',
    dbType: 'VARCHAR',
    dbLength: 255,
    params: [],
    defaultMetadata: {
      type: 'barcode',
      maxLength: 255,
    },
  },
  duration: {
    name: 'duration',
    label: 'Duration',
    category: 'advanced',
    params: [
      {
        name: 'start',
        type: 'string',
        label: 'Start Field',
        required: true,
      },
      {
        name: 'end',
        type: 'string',
        label: 'End Field',
        required: true,
      },
    ],
    defaultMetadata: {
      type: 'duration',
      notStorable: true,
    },
  },
  datetimeOptional: {
    name: 'datetimeOptional',
    label: 'Date & Time (Optional)',
    category: 'advanced',
    dbType: 'TIMESTAMP',
    params: [],
    defaultMetadata: {
      type: 'datetimeOptional',
    },
  },
  linkParent: {
    name: 'linkParent',
    label: 'Link Parent',
    category: 'relationship',
    dbType: 'VARCHAR',
    dbLength: 36,
    params: [
      {
        name: 'entityList',
        type: 'array',
        label: 'Allowed Entities',
        required: true,
      },
    ],
    defaultMetadata: {
      type: 'linkParent',
    },
  },
};

/**
 * Custom field type registry
 */
const customFieldTypes = new Map<string, FieldTypeDefinition>();

/**
 * Register a custom field type
 */
export function registerCustomFieldType(definition: FieldTypeDefinition): void {
  if (FIELD_TYPE_DEFINITIONS[definition.name]) {
    throw new Error(`Field type '${definition.name}' already exists`);
  }
  customFieldTypes.set(definition.name, definition);
}

/**
 * Get field type definition
 */
export function getFieldTypeDefinition(type: string): FieldTypeDefinition | undefined {
  return FIELD_TYPE_DEFINITIONS[type] || customFieldTypes.get(type);
}

/**
 * Get all field type definitions
 */
export function getAllFieldTypeDefinitions(): FieldTypeDefinition[] {
  return [
    ...Object.values(FIELD_TYPE_DEFINITIONS),
    ...Array.from(customFieldTypes.values()),
  ];
}

/**
 * Get field types by category
 */
export function getFieldTypesByCategory(category: string): FieldTypeDefinition[] {
  return getAllFieldTypeDefinitions().filter(def => def.category === category);
}

/**
 * Validate field metadata against field type definition
 */
export function validateFieldMetadata(
  field: EntityFieldMetadata,
  definition?: FieldTypeDefinition
): string[] {
  const errors: string[] = [];
  const def = definition || getFieldTypeDefinition(field.type);

  if (!def) {
    errors.push(`Unknown field type: ${field.type}`);
    return errors;
  }

  // Validate required params
  for (const param of def.params) {
    if (param.required && !(param.name in field)) {
      errors.push(`Required parameter '${param.name}' is missing`);
    }
  }

  // Type-specific validation
  if (field.type === 'enum' || field.type === 'multiEnum') {
    if (!field.options || field.options.length === 0) {
      errors.push('Enum fields must have at least one option');
    }
  }

  if (field.type === 'link' || field.type === 'linkMultiple') {
    // Link validation would check if target entity exists
  }

  if (field.maxLength && field.maxLength < 1) {
    errors.push('maxLength must be greater than 0');
  }

  if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
    errors.push('min value cannot be greater than max value');
  }

  return errors;
}

/**
 * Create field metadata from field type
 */
export function createFieldMetadata(
  name: string,
  type: FieldType,
  params: Record<string, any> = {}
): EntityFieldMetadata {
  const definition = getFieldTypeDefinition(type);
  if (!definition) {
    throw new Error(`Unknown field type: ${type}`);
  }

  return {
    name,
    type,
    ...definition.defaultMetadata,
    ...params,
  };
}

/**
 * Get database column definition for field
 */
export function getFieldDbDefinition(field: EntityFieldMetadata): {
  type: string;
  length?: number;
  nullable: boolean;
  default?: any;
} | null {
  if (field.notStorable) {
    return null;
  }

  const definition = getFieldTypeDefinition(field.type);
  if (!definition || !definition.dbType) {
    return null;
  }

  return {
    type: definition.dbType,
    length: field.maxLength || definition.dbLength,
    nullable: !field.required,
    default: field.default,
  };
}
