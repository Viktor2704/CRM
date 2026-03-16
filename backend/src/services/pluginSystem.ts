/**
 * Plugin System
 * Extensibility layer for custom entity types, field types, and hooks
 */

import type { EntityMetadata, EntityType, EntityHooks } from '../metadata/entityMetadata.js';
import type { FieldTypeDefinition } from '../metadata/fieldMetadata.js';
import { registerCustomFieldType } from '../metadata/fieldMetadata.js';
import { logger } from '../logger.js';

export interface Plugin {
  name: string;
  version: string;
  description?: string;
  author?: string;
  dependencies?: string[];

  // Lifecycle hooks
  onInstall?: () => Promise<void>;
  onUninstall?: () => Promise<void>;
  onEnable?: () => Promise<void>;
  onDisable?: () => Promise<void>;

  // Extension points
  entityTypes?: CustomEntityType[];
  fieldTypes?: FieldTypeDefinition[];
  hooks?: HookRegistration[];
  routes?: RouteRegistration[];
}

export interface CustomEntityType {
  name: string;
  baseType: EntityType;
  template: Partial<EntityMetadata>;
}

export interface HookRegistration {
  entityType: string;
  event: keyof EntityHooks;
  handler: HookHandler;
  priority?: number;
}

export type HookHandler = (context: HookContext) => Promise<void>;

export interface HookContext {
  entityType: string;
  event: string;
  data: any;
  oldData?: any;
  userId?: string;
  metadata?: Record<string, any>;
}

export interface RouteRegistration {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  handler: (req: any, res: any) => Promise<void>;
  middleware?: any[];
}

/**
 * Plugin Manager
 */
export class PluginManager {
  private plugins = new Map<string, Plugin>();
  private enabledPlugins = new Set<string>();
  private hooks = new Map<string, HookRegistration[]>();

  /**
   * Register a plugin
   */
  async registerPlugin(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin '${plugin.name}' is already registered`);
    }

    // Check dependencies
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(`Plugin '${plugin.name}' requires '${dep}' which is not installed`);
        }
      }
    }

    this.plugins.set(plugin.name, plugin);

    // Register custom field types
    if (plugin.fieldTypes) {
      for (const fieldType of plugin.fieldTypes) {
        try {
          registerCustomFieldType(fieldType);
          logger.info('Custom field type registered', {
            plugin: plugin.name,
            fieldType: fieldType.name
          });
        } catch (error) {
          logger.error('Failed to register field type', {
            plugin: plugin.name,
            fieldType: fieldType.name,
            error
          });
        }
      }
    }

    // Register hooks
    if (plugin.hooks) {
      for (const hook of plugin.hooks) {
        this.registerHook(hook);
      }
    }

    // Run install hook
    if (plugin.onInstall) {
      await plugin.onInstall();
    }

    logger.info('Plugin registered', { name: plugin.name, version: plugin.version });
  }

  /**
   * Unregister a plugin
   */
  async unregisterPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin '${name}' is not registered`);
    }

    // Disable if enabled
    if (this.enabledPlugins.has(name)) {
      await this.disablePlugin(name);
    }

    // Run uninstall hook
    if (plugin.onUninstall) {
      await plugin.onUninstall();
    }

    // Remove hooks
    if (plugin.hooks) {
      for (const hook of plugin.hooks) {
        this.unregisterHook(hook);
      }
    }

    this.plugins.delete(name);
    logger.info('Plugin unregistered', { name });
  }

  /**
   * Enable a plugin
   */
  async enablePlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin '${name}' is not registered`);
    }

    if (this.enabledPlugins.has(name)) {
      return;
    }

    if (plugin.onEnable) {
      await plugin.onEnable();
    }

    this.enabledPlugins.add(name);
    logger.info('Plugin enabled', { name });
  }

  /**
   * Disable a plugin
   */
  async disablePlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin '${name}' is not registered`);
    }

    if (!this.enabledPlugins.has(name)) {
      return;
    }

    if (plugin.onDisable) {
      await plugin.onDisable();
    }

    this.enabledPlugins.delete(name);
    logger.info('Plugin disabled', { name });
  }

  /**
   * Get plugin
   */
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all plugins
   */
  getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Check if plugin is enabled
   */
  isPluginEnabled(name: string): boolean {
    return this.enabledPlugins.has(name);
  }

  /**
   * Register a hook
   */
  private registerHook(hook: HookRegistration): void {
    const key = `${hook.entityType}:${hook.event}`;
    const hooks = this.hooks.get(key) || [];
    hooks.push(hook);
    hooks.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    this.hooks.set(key, hooks);
  }

  /**
   * Unregister a hook
   */
  private unregisterHook(hook: HookRegistration): void {
    const key = `${hook.entityType}:${hook.event}`;
    const hooks = this.hooks.get(key) || [];
    const filtered = hooks.filter(h => h.handler !== hook.handler);
    if (filtered.length > 0) {
      this.hooks.set(key, filtered);
    } else {
      this.hooks.delete(key);
    }
  }

  /**
   * Execute hooks for an event
   */
  async executeHooks(
    entityType: string,
    event: keyof EntityHooks,
    context: Omit<HookContext, 'entityType' | 'event'>
  ): Promise<void> {
    const key = `${entityType}:${event}`;
    const hooks = this.hooks.get(key) || [];

    const fullContext: HookContext = {
      entityType,
      event,
      ...context,
    };

    for (const hook of hooks) {
      try {
        await hook.handler(fullContext);
      } catch (error) {
        logger.error('Hook execution failed', {
          entityType,
          event,
          error,
        });
        // Continue executing other hooks
      }
    }
  }

  /**
   * Get hooks for entity and event
   */
  getHooks(entityType: string, event: keyof EntityHooks): HookRegistration[] {
    const key = `${entityType}:${event}`;
    return this.hooks.get(key) || [];
  }
}

// Singleton instance
export const pluginManager = new PluginManager();

/**
 * Example plugin: Custom Rating Field
 */
export const ratingFieldPlugin: Plugin = {
  name: 'rating-field',
  version: '1.0.0',
  description: 'Adds a star rating field type',

  fieldTypes: [
    {
      name: 'rating' as any,
      label: 'Star Rating',
      category: 'custom',
      dbType: 'INT',
      params: [
        {
          name: 'maxStars',
          type: 'number',
          label: 'Maximum Stars',
          default: 5,
        },
      ],
      defaultMetadata: {
        name: '',
        type: 'int' as any,
        min: 0,
        max: 5,
      },
    },
  ],
};

/**
 * Example plugin: Audit Trail
 */
export const auditTrailPlugin: Plugin = {
  name: 'audit-trail',
  version: '1.0.0',
  description: 'Logs all entity changes',

  hooks: [
    {
      entityType: '*', // All entities
      event: 'afterCreate',
      handler: async (context) => {
        logger.info('Entity created', {
          entityType: context.entityType,
          data: context.data,
          userId: context.userId,
        });
        // Could save to audit log table
      },
    },
    {
      entityType: '*',
      event: 'afterUpdate',
      handler: async (context) => {
        logger.info('Entity updated', {
          entityType: context.entityType,
          data: context.data,
          oldData: context.oldData,
          userId: context.userId,
        });
      },
    },
    {
      entityType: '*',
      event: 'afterDelete',
      handler: async (context) => {
        logger.info('Entity deleted', {
          entityType: context.entityType,
          data: context.data,
          userId: context.userId,
        });
      },
    },
  ],
};

/**
 * Example plugin: Custom Product Entity
 */
export const productEntityPlugin: Plugin = {
  name: 'product-entity',
  version: '1.0.0',
  description: 'Adds a Product entity type',

  entityTypes: [
    {
      name: 'Product',
      baseType: 'BasePlus',
      template: {
        fields: {
          sku: {
            name: 'sku',
            type: 'varchar',
            required: true,
            maxLength: 50,
            label: 'SKU',
          },
          price: {
            name: 'price',
            type: 'currency',
            required: true,
            label: 'Price',
          },
          stock: {
            name: 'stock',
            type: 'int',
            default: 0,
            label: 'Stock Quantity',
          },
          category: {
            name: 'category',
            type: 'enum',
            options: ['Electronics', 'Clothing', 'Food', 'Other'],
            label: 'Category',
          },
        },
        color: '#3498db',
        iconClass: 'fa-box',
      },
    },
  ],
};
