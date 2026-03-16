/**
 * Tests for Plugin System
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { PluginManager, type Plugin } from '../src/services/pluginSystem';

describe('Plugin System', () => {
  let pluginManager: PluginManager;

  beforeEach(() => {
    pluginManager = new PluginManager();
  });

  describe('Plugin Registration', () => {
    it('should register plugin', async () => {
      const plugin: Plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'Test plugin',
      };

      await pluginManager.registerPlugin(plugin);

      const registered = pluginManager.getPlugin('test-plugin');
      expect(registered).toBeDefined();
      expect(registered?.name).toBe('test-plugin');
    });

    it('should reject duplicate plugin', async () => {
      const plugin: Plugin = {
        name: 'test-plugin',
        version: '1.0.0',
      };

      await pluginManager.registerPlugin(plugin);

      await expect(
        pluginManager.registerPlugin(plugin)
      ).rejects.toThrow('already registered');
    });

    it('should check dependencies', async () => {
      const plugin: Plugin = {
        name: 'dependent-plugin',
        version: '1.0.0',
        dependencies: ['missing-plugin'],
      };

      await expect(
        pluginManager.registerPlugin(plugin)
      ).rejects.toThrow('requires');
    });

    it('should call onInstall hook', async () => {
      let installed = false;

      const plugin: Plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        onInstall: async () => {
          installed = true;
        },
      };

      await pluginManager.registerPlugin(plugin);
      expect(installed).toBe(true);
    });
  });

  describe('Plugin Lifecycle', () => {
    beforeEach(async () => {
      const plugin: Plugin = {
        name: 'test-plugin',
        version: '1.0.0',
      };
      await pluginManager.registerPlugin(plugin);
    });

    it('should enable plugin', async () => {
      await pluginManager.enablePlugin('test-plugin');
      expect(pluginManager.isPluginEnabled('test-plugin')).toBe(true);
    });

    it('should disable plugin', async () => {
      await pluginManager.enablePlugin('test-plugin');
      await pluginManager.disablePlugin('test-plugin');
      expect(pluginManager.isPluginEnabled('test-plugin')).toBe(false);
    });

    it('should call lifecycle hooks', async () => {
      let enabled = false;
      let disabled = false;

      const plugin: Plugin = {
        name: 'lifecycle-plugin',
        version: '1.0.0',
        onEnable: async () => {
          enabled = true;
        },
        onDisable: async () => {
          disabled = true;
        },
      };

      await pluginManager.registerPlugin(plugin);
      await pluginManager.enablePlugin('lifecycle-plugin');
      expect(enabled).toBe(true);

      await pluginManager.disablePlugin('lifecycle-plugin');
      expect(disabled).toBe(true);
    });
  });

  describe('Hook System', () => {
    it('should execute hooks', async () => {
      let hookExecuted = false;

      const plugin: Plugin = {
        name: 'hook-plugin',
        version: '1.0.0',
        hooks: [
          {
            entityType: 'Product',
            event: 'afterCreate',
            handler: async (context) => {
              hookExecuted = true;
              expect(context.entityType).toBe('Product');
              expect(context.event).toBe('afterCreate');
            },
          },
        ],
      };

      await pluginManager.registerPlugin(plugin);

      await pluginManager.executeHooks('Product', 'afterCreate', {
        data: { name: 'Test Product' },
      });

      expect(hookExecuted).toBe(true);
    });

    it('should execute hooks in priority order', async () => {
      const executionOrder: number[] = [];

      const plugin: Plugin = {
        name: 'priority-plugin',
        version: '1.0.0',
        hooks: [
          {
            entityType: 'Product',
            event: 'afterCreate',
            priority: 10,
            handler: async () => {
              executionOrder.push(10);
            },
          },
          {
            entityType: 'Product',
            event: 'afterCreate',
            priority: 20,
            handler: async () => {
              executionOrder.push(20);
            },
          },
          {
            entityType: 'Product',
            event: 'afterCreate',
            priority: 5,
            handler: async () => {
              executionOrder.push(5);
            },
          },
        ],
      };

      await pluginManager.registerPlugin(plugin);

      await pluginManager.executeHooks('Product', 'afterCreate', {
        data: {},
      });

      expect(executionOrder).toEqual([20, 10, 5]);
    });

    it('should continue on hook error', async () => {
      let secondHookExecuted = false;

      const plugin: Plugin = {
        name: 'error-plugin',
        version: '1.0.0',
        hooks: [
          {
            entityType: 'Product',
            event: 'afterCreate',
            handler: async () => {
              throw new Error('Hook error');
            },
          },
          {
            entityType: 'Product',
            event: 'afterCreate',
            handler: async () => {
              secondHookExecuted = true;
            },
          },
        ],
      };

      await pluginManager.registerPlugin(plugin);

      await pluginManager.executeHooks('Product', 'afterCreate', {
        data: {},
      });

      expect(secondHookExecuted).toBe(true);
    });
  });

  describe('Custom Field Types', () => {
    it('should register custom field type', async () => {
      const plugin: Plugin = {
        name: 'rating-plugin',
        version: '1.0.0',
        fieldTypes: [
          {
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
          },
        ],
      };

      await pluginManager.registerPlugin(plugin);
      // Field type should be registered via registerCustomFieldType
    });
  });

  describe('Plugin Unregistration', () => {
    it('should unregister plugin', async () => {
      const plugin: Plugin = {
        name: 'test-plugin',
        version: '1.0.0',
      };

      await pluginManager.registerPlugin(plugin);
      await pluginManager.unregisterPlugin('test-plugin');

      const registered = pluginManager.getPlugin('test-plugin');
      expect(registered).toBeUndefined();
    });

    it('should call onUninstall hook', async () => {
      let uninstalled = false;

      const plugin: Plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        onUninstall: async () => {
          uninstalled = true;
        },
      };

      await pluginManager.registerPlugin(plugin);
      await pluginManager.unregisterPlugin('test-plugin');

      expect(uninstalled).toBe(true);
    });
  });
});
