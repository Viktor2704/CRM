import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createCustomFieldDefinition,
  getCustomFieldDefinitions,
  getCustomFieldDefinitionsByRole,
  setCustomFieldValues,
  getCustomFieldValues,
  getCustomFieldsWithValuesByRole,
  deleteCustomFieldDefinition,
  updateCustomFieldDefinition,
  canUserViewField,
  canUserEditField,
  validateFieldValue,
  validateFieldKey,
  type CustomFieldDefinition,
} from '../src/services/customFieldsService.js';
import { dbQuery } from '../src/db.js';

describe('Custom Fields Service', () => {
  const testEntityType = 'service_request';
  const testEntityId = '00000000-0000-0000-0000-000000000001';
  let createdFieldIds: string[] = [];

  beforeAll(async () => {
    // Ensure test entity exists in requests table
    await dbQuery(
      `INSERT INTO requests (id, title, type, status, created_by_id)
       VALUES ($1::uuid, 'Test Request', 'emergency', 'new', '00000000-0000-0000-0000-000000000001'::uuid)
       ON CONFLICT (id) DO NOTHING`,
      [testEntityId]
    );
  });

  afterAll(async () => {
    // Clean up test data
    for (const id of createdFieldIds) {
      await dbQuery('DELETE FROM custom_field_definitions WHERE id = $1::uuid', [id]);
    }
    await dbQuery('DELETE FROM custom_field_values WHERE entity_id = $1::uuid', [testEntityId]);
    await dbQuery('DELETE FROM requests WHERE id = $1::uuid', [testEntityId]);
  });

  beforeEach(() => {
    createdFieldIds = [];
  });

  describe('Field Definition Management', () => {
    it('should create a custom field definition for service_request', async () => {
      const field = await createCustomFieldDefinition(testEntityType, {
        fieldKey: 'test_field_1',
        fieldLabel: 'Test Field 1',
        fieldType: 'text',
        isRequired: false,
        displayOrder: 0,
      });

      createdFieldIds.push(field.id);

      expect(field).toBeDefined();
      expect(field.entityType).toBe(testEntityType);
      expect(field.fieldKey).toBe('test_field_1');
      expect(field.fieldLabel).toBe('Test Field 1');
      expect(field.fieldType).toBe('text');
    });

    it('should create a select field with options', async () => {
      const field = await createCustomFieldDefinition(testEntityType, {
        fieldKey: 'priority_level',
        fieldLabel: 'Priority Level',
        fieldType: 'select',
        fieldOptions: ['Low', 'Medium', 'High', 'Critical'],
        isRequired: true,
        displayOrder: 1,
      });

      createdFieldIds.push(field.id);

      expect(field.fieldOptions).toEqual(['Low', 'Medium', 'High', 'Critical']);
      expect(field.isRequired).toBe(true);
    });

    it('should create a field with role-based visibility', async () => {
      const field = await createCustomFieldDefinition(testEntityType, {
        fieldKey: 'internal_notes',
        fieldLabel: 'Internal Notes',
        fieldType: 'text',
        visibleToRoles: ['admin', 'manager', 'dispatcher'],
        editableByRoles: ['admin', 'manager'],
        displayOrder: 2,
      });

      createdFieldIds.push(field.id);

      expect(field.visibleToRoles).toEqual(['admin', 'manager', 'dispatcher']);
      expect(field.editableByRoles).toEqual(['admin', 'manager']);
    });

    it('should get all field definitions for entity type', async () => {
      const field1 = await createCustomFieldDefinition(testEntityType, {
        fieldKey: 'field_a',
        fieldLabel: 'Field A',
        fieldType: 'text',
        displayOrder: 0,
      });
      const field2 = await createCustomFieldDefinition(testEntityType, {
        fieldKey: 'field_b',
        fieldLabel: 'Field B',
        fieldType: 'number',
        displayOrder: 1,
      });

      createdFieldIds.push(field1.id, field2.id);

      const definitions = await getCustomFieldDefinitions(testEntityType);
      const testFields = definitions.filter(d => ['field_a', 'field_b'].includes(d.fieldKey));

      expect(testFields.length).toBeGreaterThanOrEqual(2);
      expect(testFields[0].displayOrder).toBeLessThanOrEqual(testFields[1].displayOrder);
    });

    it('should update a field definition', async () => {
      const field = await createCustomFieldDefinition(testEntityType, {
        fieldKey: 'update_test',
        fieldLabel: 'Original Label',
        fieldType: 'text',
      });

      createdFieldIds.push(field.id);

      const updated = await updateCustomFieldDefinition(field.id, {
        fieldLabel: 'Updated Label',
        isRequired: true,
      });

      expect(updated.fieldLabel).toBe('Updated Label');
      expect(updated.isRequired).toBe(true);
      expect(updated.fieldKey).toBe('update_test'); // Should not change
    });

    it('should delete a field definition', async () => {
      const field = await createCustomFieldDefinition(testEntityType, {
        fieldKey: 'delete_test',
        fieldLabel: 'Delete Test',
        fieldType: 'text',
      });

      await deleteCustomFieldDefinition(field.id);

      const definitions = await getCustomFieldDefinitions(testEntityType);
      const deleted = definitions.find(d => d.id === field.id);

      expect(deleted).toBeUndefined();
    });
  });

  describe('Field Value Management', () => {
    let textFieldId: string;
    let numberFieldId: string;
    let selectFieldId: string;
    let dateFieldId: string;

    beforeEach(async () => {
      const textField = await createCustomFieldDefinition(testEntityType, {
        fieldKey: 'description_field',
        fieldLabel: 'Description',
        fieldType: 'text',
      });
      const numberField = await createCustomFieldDefinition(testEntityType, {
        fieldKey: 'cost_estimate',
        fieldLabel: 'Cost Estimate',
        fieldType: 'number',
      });
      const selectField = await createCustomFieldDefinition(testEntityType, {
        fieldKey: 'urgency',
        fieldLabel: 'Urgency',
        fieldType: 'select',
        fieldOptions: ['Low', 'Medium', 'High'],
      });
      const dateField = await createCustomFieldDefinition(testEntityType, {
        fieldKey: 'deadline',
        fieldLabel: 'Deadline',
        fieldType: 'date',
      });

      textFieldId = textField.id;
      numberFieldId = numberField.id;
      selectFieldId = selectField.id;
      dateFieldId = dateField.id;

      createdFieldIds.push(textFieldId, numberFieldId, selectFieldId, dateFieldId);
    });

    it('should set and get custom field values', async () => {
      await setCustomFieldValues(testEntityType, testEntityId, {
        description_field: 'Test description',
        cost_estimate: '1500.50',
        urgency: 'High',
        deadline: '2026-12-31',
      });

      const values = await getCustomFieldValues(testEntityType, testEntityId);

      expect(values.description_field).toBe('Test description');
      expect(values.cost_estimate).toBe('1500.50');
      expect(values.urgency).toBe('High');
      expect(values.deadline).toBe('2026-12-31');
    });

    it('should validate number field values', async () => {
      await expect(
        setCustomFieldValues(testEntityType, testEntityId, {
          cost_estimate: 'not-a-number',
        })
      ).rejects.toThrow();
    });

    it('should validate date field values', async () => {
      await expect(
        setCustomFieldValues(testEntityType, testEntityId, {
          deadline: 'invalid-date',
        })
      ).rejects.toThrow();
    });

    it('should validate select field options', async () => {
      await expect(
        setCustomFieldValues(testEntityType, testEntityId, {
          urgency: 'InvalidOption',
        })
      ).rejects.toThrow();
    });

    it('should enforce required fields', async () => {
      const requiredField = await createCustomFieldDefinition(testEntityType, {
        fieldKey: 'required_field',
        fieldLabel: 'Required Field',
        fieldType: 'text',
        isRequired: true,
      });

      createdFieldIds.push(requiredField.id);

      await expect(
        setCustomFieldValues(testEntityType, testEntityId, {
          required_field: '',
        })
      ).rejects.toThrow('required');
    });
  });

  describe('Role-Based Access Control', () => {
    let adminOnlyFieldId: string;
    let publicFieldId: string;

    beforeEach(async () => {
      const adminField = await createCustomFieldDefinition(testEntityType, {
        fieldKey: 'admin_only',
        fieldLabel: 'Admin Only Field',
        fieldType: 'text',
        visibleToRoles: ['admin', 'manager'],
        editableByRoles: ['admin'],
      });

      const publicField = await createCustomFieldDefinition(testEntityType, {
        fieldKey: 'public_field',
        fieldLabel: 'Public Field',
        fieldType: 'text',
        visibleToRoles: [],
        editableByRoles: [],
      });

      adminOnlyFieldId = adminField.id;
      publicFieldId = publicField.id;

      createdFieldIds.push(adminOnlyFieldId, publicFieldId);

      await setCustomFieldValues(testEntityType, testEntityId, {
        admin_only: 'Secret data',
        public_field: 'Public data',
      });
    });

    it('should filter fields by user role visibility', async () => {
      const adminFields = await getCustomFieldDefinitionsByRole(testEntityType, 'admin');
      const executorFields = await getCustomFieldDefinitionsByRole(testEntityType, 'executor');

      const adminHasAdminField = adminFields.some(f => f.fieldKey === 'admin_only');
      const executorHasAdminField = executorFields.some(f => f.fieldKey === 'admin_only');

      expect(adminHasAdminField).toBe(true);
      expect(executorHasAdminField).toBe(false);
    });

    it('should return fields with values filtered by role', async () => {
      const adminFieldsWithValues = await getCustomFieldsWithValuesByRole(
        testEntityType,
        testEntityId,
        'admin'
      );
      const executorFieldsWithValues = await getCustomFieldsWithValuesByRole(
        testEntityType,
        testEntityId,
        'executor'
      );

      const adminSeesAdminField = adminFieldsWithValues.some(f => f.fieldKey === 'admin_only');
      const executorSeesAdminField = executorFieldsWithValues.some(f => f.fieldKey === 'admin_only');

      expect(adminSeesAdminField).toBe(true);
      expect(executorSeesAdminField).toBe(false);
    });

    it('should prevent non-admin from editing admin-only fields', async () => {
      await setCustomFieldValues(
        testEntityType,
        testEntityId,
        {
          admin_only: 'Executor trying to edit',
          public_field: 'Executor can edit this',
        },
        'executor'
      );

      const values = await getCustomFieldValues(testEntityType, testEntityId);

      // Admin field should not be changed by executor
      expect(values.admin_only).toBe('Secret data');
      // Public field should be updated
      expect(values.public_field).toBe('Executor can edit this');
    });

    it('should check user view permissions', async () => {
      const definitions = await getCustomFieldDefinitions(testEntityType);
      const adminField = definitions.find(d => d.fieldKey === 'admin_only');
      const publicField = definitions.find(d => d.fieldKey === 'public_field');

      expect(canUserViewField(adminField!, 'admin')).toBe(true);
      expect(canUserViewField(adminField!, 'executor')).toBe(false);
      expect(canUserViewField(publicField!, 'executor')).toBe(true);
    });

    it('should check user edit permissions', async () => {
      const definitions = await getCustomFieldDefinitions(testEntityType);
      const adminField = definitions.find(d => d.fieldKey === 'admin_only');

      expect(canUserEditField(adminField!, 'admin')).toBe(true);
      expect(canUserEditField(adminField!, 'manager')).toBe(false);
      expect(canUserEditField(adminField!, 'executor')).toBe(false);
    });
  });

  describe('Field Validation', () => {
    it('should validate field keys', () => {
      expect(validateFieldKey('valid_key_123')).toBe('valid_key_123');
      expect(validateFieldKey('UPPERCASE')).toBe('uppercase');
      expect(() => validateFieldKey('invalid-key')).toThrow();
      expect(() => validateFieldKey('invalid key')).toThrow();
      expect(() => validateFieldKey('a')).toThrow(); // Too short
    });

    it('should validate text field values', () => {
      expect(validateFieldValue('Hello', 'text')).toBe('Hello');
      expect(validateFieldValue('  trimmed  ', 'text')).toBe('trimmed');
      expect(validateFieldValue('', 'text')).toBe(null);
      expect(validateFieldValue(null, 'text')).toBe(null);
    });

    it('should validate number field values', () => {
      expect(validateFieldValue('123', 'number')).toBe('123');
      expect(validateFieldValue('123.45', 'number')).toBe('123.45');
      expect(validateFieldValue('-99.9', 'number')).toBe('-99.9');
      expect(() => validateFieldValue('abc', 'number')).toThrow();
    });

    it('should validate date field values', () => {
      expect(validateFieldValue('2026-03-12', 'date')).toBe('2026-03-12');
      expect(() => validateFieldValue('2026-13-01', 'date')).toThrow(); // Invalid month
      expect(() => validateFieldValue('12/03/2026', 'date')).toThrow(); // Wrong format
    });

    it('should validate select field values', () => {
      const options = ['Option1', 'Option2', 'Option3'];
      expect(validateFieldValue('Option1', 'select', options)).toBe('Option1');
      expect(() => validateFieldValue('InvalidOption', 'select', options)).toThrow();
    });
  });
});
