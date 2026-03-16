import { Router } from 'express';
import { dbQuery } from '../db.js';
import { z } from 'zod';

const router = Router();

// Schemas
const FieldMetadataSchema = z.object({
  entityType: z.string(),
  fieldName: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Invalid field name'),
  fieldType: z.enum(['text', 'number', 'date', 'datetime', 'select', 'multi_select', 'checkbox', 'link', 'email', 'phone', 'url', 'textarea', 'currency']),
  label: z.string().min(1).max(255),
  description: z.string().optional(),
  isRequired: z.boolean().default(false),
  isReadonly: z.boolean().default(false),
  defaultValue: z.any().optional(),
  validationRules: z.record(z.string(), z.any()).optional(),
  fieldOptions: z.record(z.string(), z.any()).optional(),
  displayOrder: z.number().default(0),
  groupName: z.string().optional(),
  helpText: z.string().optional(),
  placeholder: z.string().optional(),
});

// GET /metadata-enhanced/entities - List all entities
router.get('/metadata-enhanced/entities', async (req: any, res: any) => {
  try {
    const result = await dbQuery(`
      SELECT
        id,
        entity_type,
        label,
        plural_label,
        icon,
        description,
        is_custom,
        table_name,
        created_at,
        updated_at
      FROM entity_metadata
      ORDER BY is_custom ASC, label ASC
    `);

    res.json({ entities: result.rows });
  } catch (error) {
    console.error('Error fetching entities:', error);
    res.status(500).json({ error: 'Failed to fetch entities' });
  }
});

// GET /metadata-enhanced/entities/:entityType - Get entity metadata
router.get('/metadata-enhanced/entities/:entityType', async (req: any, res: any) => {
  try {
    const { entityType } = req.params;

    const entityResult = await dbQuery(`
      SELECT * FROM entity_metadata WHERE entity_type = $1
    `, [entityType]);

    if (entityResult.rows.length === 0) {
      return res.status(404).json({ error: 'Entity not found' });
    }

    res.json(entityResult.rows[0]);
  } catch (error) {
    console.error('Error fetching entity:', error);
    res.status(500).json({ error: 'Failed to fetch entity' });
  }
});

// GET /metadata-enhanced/fields - Get fields for entity type
router.get('/metadata-enhanced/fields', async (req, res) => {
  try {
    const { entityType } = req.query;

    if (!entityType) {
      return res.status(400).json({ error: 'entityType is required' });
    }

    const result = await dbQuery(`
      SELECT
        id,
        entity_type,
        field_name,
        field_type,
        label,
        description,
        is_required,
        is_readonly,
        is_custom,
        is_system,
        default_value,
        validation_rules,
        field_options,
        display_order,
        group_name,
        help_text,
        placeholder,
        created_at,
        updated_at
      FROM field_metadata
      WHERE entity_type = $1
      ORDER BY display_order ASC, label ASC
    `, [entityType]);

    // Group fields by group_name
    const fieldsByGroup: Record<string, any[]> = {};
    const ungroupedFields: any[] = [];

    for (const field of result.rows) {
      if (field.group_name) {
        if (!fieldsByGroup[field.group_name]) {
          fieldsByGroup[field.group_name] = [];
        }
        fieldsByGroup[field.group_name].push(field);
      } else {
        ungroupedFields.push(field);
      }
    }

    res.json({
      fields: result.rows,
      fieldsByGroup,
      ungroupedFields,
    });
  } catch (error) {
    console.error('Error fetching fields:', error);
    res.status(500).json({ error: 'Failed to fetch fields' });
  }
});

// POST /metadata-enhanced/fields - Create custom field
router.post('/metadata-enhanced/fields', async (req: any, res: any) => {
  try {
    const userId = req.authUser?.id;
    const isAdmin = req.authUser?.role === 'admin';

    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admins can create custom fields' });
    }

    const data = FieldMetadataSchema.parse(req.body);

    // Check if field already exists
    const existingField = await dbQuery(`
      SELECT id FROM field_metadata
      WHERE entity_type = $1 AND field_name = $2
    `, [data.entityType, data.fieldName]);

    if (existingField.rows.length > 0) {
      return res.status(400).json({ error: 'Field already exists' });
    }

    // Create field metadata
    const result = await dbQuery(`
      INSERT INTO field_metadata (
        entity_type,
        field_name,
        field_type,
        label,
        description,
        is_required,
        is_readonly,
        is_custom,
        default_value,
        validation_rules,
        field_options,
        display_order,
        group_name,
        help_text,
        placeholder
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `, [
      data.entityType,
      data.fieldName,
      data.fieldType,
      data.label,
      data.description || null,
      data.isRequired,
      data.isReadonly,
      data.defaultValue ? JSON.stringify(data.defaultValue) : null,
      data.validationRules ? JSON.stringify(data.validationRules) : null,
      data.fieldOptions ? JSON.stringify(data.fieldOptions) : null,
      data.displayOrder,
      data.groupName || null,
      data.helpText || null,
      data.placeholder || null,
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating field:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.issues });
    }
    res.status(500).json({ error: 'Failed to create field' });
  }
});

// GET /metadata-enhanced/field-types - Get available field types
router.get('/metadata-enhanced/field-types', async (req, res) => {
  try {
    const fieldTypes = [
      {
        type: 'text',
        label: 'Текст',
        icon: 'type',
        description: 'Однострочное текстовое поле',
        supportsValidation: ['minLength', 'maxLength', 'pattern'],
      },
      {
        type: 'textarea',
        label: 'Многострочный текст',
        icon: 'align-left',
        description: 'Многострочное текстовое поле',
        supportsValidation: ['minLength', 'maxLength'],
      },
      {
        type: 'number',
        label: 'Число',
        icon: 'hash',
        description: 'Числовое поле',
        supportsValidation: ['min', 'max'],
      },
      {
        type: 'currency',
        label: 'Валюта',
        icon: 'dollar-sign',
        description: 'Денежное значение',
        supportsValidation: ['min', 'max'],
      },
      {
        type: 'date',
        label: 'Дата',
        icon: 'calendar',
        description: 'Поле даты',
        supportsValidation: ['min', 'max'],
      },
      {
        type: 'datetime',
        label: 'Дата и время',
        icon: 'clock',
        description: 'Поле даты и времени',
        supportsValidation: ['min', 'max'],
      },
      {
        type: 'select',
        label: 'Выбор',
        icon: 'list',
        description: 'Выбор одного значения из списка',
        supportsValidation: [],
        requiresOptions: true,
      },
      {
        type: 'multi_select',
        label: 'Множественный выбор',
        icon: 'check-square',
        description: 'Выбор нескольких значений',
        supportsValidation: [],
        requiresOptions: true,
      },
      {
        type: 'checkbox',
        label: 'Флажок',
        icon: 'check',
        description: 'Логическое значение (да/нет)',
        supportsValidation: [],
      },
      {
        type: 'email',
        label: 'Email',
        icon: 'mail',
        description: 'Адрес электронной почты',
        supportsValidation: ['pattern'],
      },
      {
        type: 'phone',
        label: 'Телефон',
        icon: 'phone',
        description: 'Номер телефона',
        supportsValidation: ['pattern'],
      },
      {
        type: 'url',
        label: 'URL',
        icon: 'link',
        description: 'Веб-адрес',
        supportsValidation: ['pattern'],
      },
      {
        type: 'link',
        label: 'Связь',
        icon: 'link-2',
        description: 'Связь с другой сущностью',
        supportsValidation: [],
        requiresOptions: true,
      },
    ];

    res.json({ fieldTypes });
  } catch (error) {
    console.error('Error fetching field types:', error);
    res.status(500).json({ error: 'Failed to fetch field types' });
  }
});

export default router;
