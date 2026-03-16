/**
 * Tests for Field Metadata System
 */

import { describe, it, expect } from '@jest/globals';
import {
  validateFieldMetadata,
  createFieldMetadata,
  getFieldTypeDefinition,
  getFieldDbDefinition,
  registerCustomFieldType,
  type EntityFieldMetadata,
  type FieldTypeDefinition,
} from '../src/metadata/fieldMetadata';

describe('Field Metadata', () => {
  describe('validateFieldMetadata', () => {
    it('should validate valid field metadata', () => {
      const field: EntityFieldMetadata = {
        name: 'price',
        type: 'currency',
        required: true,
        min: 0,
      };

      const errors = validateFieldMetadata(field);
      expect(errors).toHaveLength(0);
    });

    it('should reject enum field without options', () => {
      const field: EntityFieldMetadata = {
        name: 'status',
        type: 'enum',
        options: [],
      };

      const errors = validateFieldMetadata(field);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('at least one option');
    });

    it('should reject invalid maxLength', () => {
      const field: EntityFieldMetadata = {
        name: 'name',
        type: 'varchar',
        maxLength: -1,
      };

      const errors = validateFieldMetadata(field);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('greater than 0');
    });

    it('should reject min > max', () => {
      const field: EntityFieldMetadata = {
        name: 'quantity',
        type: 'int',
        min: 100,
        max: 10,
      };

      const errors = validateFieldMetadata(field);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('cannot be greater than max');
    });
  });

  describe('createFieldMetadata', () => {
    it('should create field with default metadata', () => {
      const field = createFieldMetadata('name', 'varchar');

      expect(field.name).toBe('name');
      expect(field.type).toBe('varchar');
      expect(field.maxLength).toBe(255);
    });

    it('should create field with custom params', () => {
      const field = createFieldMetadata('name', 'varchar', {
        maxLength: 100,
        required: true,
      });

      expect(field.maxLength).toBe(100);
      expect(field.required).toBe(true);
    });

    it('should throw error for unknown field type', () => {
      expect(() => {
        createFieldMetadata('test', 'invalid' as any);
      }).toThrow('Unknown field type');
    });
  });

  describe('getFieldTypeDefinition', () => {
    it('should return definition for built-in type', () => {
      const def = getFieldTypeDefinition('varchar');

      expect(def).toBeDefined();
      expect(def?.name).toBe('varchar');
      expect(def?.label).toBe('Text (Short)');
    });

    it('should return undefined for unknown type', () => {
      const def = getFieldTypeDefinition('unknown');
      expect(def).toBeUndefined();
    });
  });

  describe('getFieldDbDefinition', () => {
    it('should return db definition for storable field', () => {
      const field: EntityFieldMetadata = {
        name: 'name',
        type: 'varchar',
        maxLength: 100,
        required: true,
      };

      const dbDef = getFieldDbDefinition(field);

      expect(dbDef).toBeDefined();
      expect(dbDef?.type).toBe('VARCHAR');
      expect(dbDef?.length).toBe(100);
      expect(dbDef?.nullable).toBe(false);
    });

    it('should return null for non-storable field', () => {
      const field: EntityFieldMetadata = {
        name: 'computed',
        type: 'varchar',
        notStorable: true,
      };

      const dbDef = getFieldDbDefinition(field);
      expect(dbDef).toBeNull();
    });

    it('should handle nullable fields', () => {
      const field: EntityFieldMetadata = {
        name: 'description',
        type: 'text',
        required: false,
      };

      const dbDef = getFieldDbDefinition(field);
      expect(dbDef?.nullable).toBe(true);
    });
  });

  describe('registerCustomFieldType', () => {
    it('should register custom field type', () => {
      const customType: FieldTypeDefinition = {
        name: 'rating' as any,
        label: 'Star Rating',
        category: 'custom',
        params: [],
        defaultMetadata: {
          name: '',
          type: 'int' as any,
          min: 0,
          max: 5,
        },
      };

      registerCustomFieldType(customType);

      const def = getFieldTypeDefinition('rating');
      expect(def).toBeDefined();
      expect(def?.label).toBe('Star Rating');
    });

    it('should throw error for duplicate type', () => {
      expect(() => {
        const customType: FieldTypeDefinition = {
          name: 'varchar',
          label: 'Duplicate',
          category: 'custom',
          params: [],
          defaultMetadata: { name: '', type: 'varchar' },
        };
        registerCustomFieldType(customType);
      }).toThrow('already exists');
    });
  });
});
