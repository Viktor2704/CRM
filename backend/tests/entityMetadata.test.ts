/**
 * Tests for Entity Metadata System
 */

import { describe, it, expect } from '@jest/globals';
import {
  validateEntityMetadata,
  mergeWithBaseTemplate,
  BASE_ENTITY_FIELDS,
  BASE_PLUS_ENTITY_FIELDS,
  type EntityMetadata,
  type EntityType,
} from '../src/metadata/entityMetadata';

describe('Entity Metadata', () => {
  describe('validateEntityMetadata', () => {
    it('should validate valid entity metadata', () => {
      const metadata: EntityMetadata = {
        name: 'Product',
        type: 'BasePlus',
        fields: {
          name: {
            name: 'name',
            type: 'varchar',
            required: true,
          },
          price: {
            name: 'price',
            type: 'currency',
          },
        },
      };

      const errors = validateEntityMetadata(metadata);
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid entity name', () => {
      const metadata: EntityMetadata = {
        name: 'product', // Should start with uppercase
        type: 'BasePlus',
        fields: {
          name: {
            name: 'name',
            type: 'varchar',
          },
        },
      };

      const errors = validateEntityMetadata(metadata);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('uppercase');
    });

    it('should reject entity without fields', () => {
      const metadata: EntityMetadata = {
        name: 'Product',
        type: 'BasePlus',
        fields: {},
      };

      const errors = validateEntityMetadata(metadata);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('at least one field');
    });

    it('should reject invalid field name', () => {
      const metadata: EntityMetadata = {
        name: 'Product',
        type: 'BasePlus',
        fields: {
          Price: { // Should start with lowercase
            name: 'Price',
            type: 'currency',
          },
        },
      };

      const errors = validateEntityMetadata(metadata);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('lowercase');
    });

    it('should reject invalid field type', () => {
      const metadata: EntityMetadata = {
        name: 'Product',
        type: 'BasePlus',
        fields: {
          price: {
            name: 'price',
            type: 'invalid' as any,
          },
        },
      };

      const errors = validateEntityMetadata(metadata);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('Invalid field type');
    });

    it('should reject enum field without options', () => {
      const metadata: EntityMetadata = {
        name: 'Product',
        type: 'BasePlus',
        fields: {
          status: {
            name: 'status',
            type: 'enum',
            options: [],
          },
        },
      };

      const errors = validateEntityMetadata(metadata);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('must have options');
    });
  });

  describe('mergeWithBaseTemplate', () => {
    it('should merge with Base template', () => {
      const metadata = mergeWithBaseTemplate(
        {
          name: 'Product',
          fields: {
            price: {
              name: 'price',
              type: 'currency',
            },
          },
        },
        'Base'
      );

      expect(metadata.fields.id).toBeDefined();
      expect(metadata.fields.createdAt).toBeDefined();
      expect(metadata.fields.price).toBeDefined();
      expect(metadata.fields.assignedUser).toBeUndefined();
    });

    it('should merge with BasePlus template', () => {
      const metadata = mergeWithBaseTemplate(
        {
          name: 'Product',
          fields: {
            price: {
              name: 'price',
              type: 'currency',
            },
          },
        },
        'BasePlus'
      );

      expect(metadata.fields.id).toBeDefined();
      expect(metadata.fields.name).toBeDefined();
      expect(metadata.fields.assignedUser).toBeDefined();
      expect(metadata.fields.price).toBeDefined();
      expect(metadata.links?.assignedUser).toBeDefined();
    });

    it('should allow overriding base fields', () => {
      const metadata = mergeWithBaseTemplate(
        {
          name: 'Product',
          fields: {
            name: {
              name: 'name',
              type: 'varchar',
              maxLength: 100, // Override default
            },
          },
        },
        'BasePlus'
      );

      expect(metadata.fields.name.maxLength).toBe(100);
    });
  });
});
