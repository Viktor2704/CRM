/**
 * Tests for Metadata Service
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MetadataService } from '../src/services/metadataService';
import type { EntityType } from '../src/metadata/entityMetadata';

describe('MetadataService', () => {
  let service: MetadataService;

  beforeEach(async () => {
    service = new MetadataService();
    await service.initialize();
  });

  describe('Entity Management', () => {
    it('should create new entity', async () => {
      const entity = await service.createEntity('Product', 'BasePlus', {
        labelSingular: 'Product',
        labelPlural: 'Products',
        color: '#3498db',
      });

      expect(entity.name).toBe('Product');
      expect(entity.type).toBe('BasePlus');
      expect(entity.isCustom).toBe(true);
      expect(entity.fields.name).toBeDefined();
      expect(entity.fields.assignedUser).toBeDefined();
    });

    it('should reject duplicate entity', async () => {
      await service.createEntity('Product', 'BasePlus');

      await expect(
        service.createEntity('Product', 'BasePlus')
      ).rejects.toThrow('already exists');
    });

    it('should get entity by name', async () => {
      await service.createEntity('Product', 'BasePlus');

      const entity = service.getEntity('Product');
      expect(entity).toBeDefined();
      expect(entity?.name).toBe('Product');
    });

    it('should update entity metadata', async () => {
      await service.createEntity('Product', 'BasePlus');

      const updated = await service.updateEntity('Product', {
        labelSingular: 'Item',
        color: '#e74c3c',
      });

      expect(updated.labelSingular).toBe('Item');
      expect(updated.color).toBe('#e74c3c');
    });

    it('should delete custom entity', async () => {
      await service.createEntity('Product', 'BasePlus');
      await service.deleteEntity('Product');

      const entity = service.getEntity('Product');
      expect(entity).toBeUndefined();
    });

    it('should list all entities', async () => {
      await service.createEntity('Product', 'BasePlus');
      await service.createEntity('Category', 'BasePlus');

      const entities = service.getAllEntities();
      expect(entities.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Field Management', () => {
    beforeEach(async () => {
      await service.createEntity('Product', 'BasePlus');
    });

    it('should add field to entity', async () => {
      await service.addField('Product', 'price', {
        name: 'price',
        type: 'currency',
        required: true,
        min: 0,
      });

      const entity = service.getEntity('Product');
      expect(entity?.fields.price).toBeDefined();
      expect(entity?.fields.price.type).toBe('currency');
    });

    it('should reject duplicate field', async () => {
      await service.addField('Product', 'price', {
        name: 'price',
        type: 'currency',
      });

      await expect(
        service.addField('Product', 'price', {
          name: 'price',
          type: 'currency',
        })
      ).rejects.toThrow('already exists');
    });

    it('should update field metadata', async () => {
      await service.addField('Product', 'price', {
        name: 'price',
        type: 'currency',
        required: false,
      });

      await service.updateField('Product', 'price', {
        required: true,
        min: 0,
      });

      const entity = service.getEntity('Product');
      expect(entity?.fields.price.required).toBe(true);
      expect(entity?.fields.price.min).toBe(0);
    });

    it('should remove field from entity', async () => {
      await service.addField('Product', 'price', {
        name: 'price',
        type: 'currency',
      });

      await service.removeField('Product', 'price');

      const entity = service.getEntity('Product');
      expect(entity?.fields.price).toBeUndefined();
    });

    it('should reject removing base field', async () => {
      await expect(
        service.removeField('Product', 'name')
      ).rejects.toThrow('Cannot remove base field');
    });
  });

  describe('Layout Management', () => {
    beforeEach(async () => {
      await service.createEntity('Product', 'BasePlus');
    });

    it('should get default layout', () => {
      const layout = service.getLayout('Product');

      expect(layout).toBeDefined();
      expect(layout?.entityType).toBe('Product');
      expect(layout?.layouts.list).toBeDefined();
      expect(layout?.layouts.detail).toBeDefined();
    });

    it('should update layout', async () => {
      const updated = await service.updateLayout('Product', {
        layouts: {
          list: {
            columns: [
              { name: 'name', sortable: true, link: true },
              { name: 'price', sortable: true },
            ],
          },
        },
      });

      expect(updated.layouts.list?.columns).toHaveLength(2);
    });

    it('should validate layout references valid fields', async () => {
      await expect(
        service.updateLayout('Product', {
          layouts: {
            list: {
              columns: [
                { name: 'invalidField', sortable: true },
              ],
            },
          },
        })
      ).rejects.toThrow('unknown field');
    });
  });

  describe('Relationship Management', () => {
    beforeEach(async () => {
      await service.createEntity('Product', 'BasePlus');
      await service.createEntity('Category', 'BasePlus');
    });

    it('should create relationship', async () => {
      await service.createRelationship({
        name: 'productCategory',
        type: 'belongsTo',
        leftEntity: 'Product',
        rightEntity: 'Category',
        leftLink: 'category',
      });

      const relationship = service.getRelationship('productCategory');
      expect(relationship).toBeDefined();
      expect(relationship?.type).toBe('belongsTo');
    });

    it('should reject invalid relationship', async () => {
      await expect(
        service.createRelationship({
          name: 'invalid',
          type: 'belongsTo',
          leftEntity: 'Product',
          rightEntity: 'NonExistent',
        })
      ).rejects.toThrow('does not exist');
    });

    it('should list all relationships', async () => {
      await service.createRelationship({
        name: 'rel1',
        type: 'belongsTo',
        leftEntity: 'Product',
        rightEntity: 'Category',
      });

      const relationships = service.getAllRelationships();
      expect(relationships.length).toBeGreaterThanOrEqual(1);
    });
  });
});
