import type { ModuleDefinition } from '../types/module.js';
import { moduleService } from '../services/moduleService.js';
import { hookSystem, HOOKS } from '../services/hookSystem.js';
import { logger } from '../logger.js';
import { dbQuery } from '../db.js';

/**
 * Module Registry
 * Central registry for managing module lifecycle and registration
 */
class ModuleRegistry {
    private registeredModules: Map<string, ModuleDefinition> = new Map();
    private initializedModules: Set<string> = new Set();

    /**
     * Register a module definition
     */
    registerModule(definition: ModuleDefinition): void {
        if (this.registeredModules.has(definition.name)) {
            logger.warn('Module already registered', { module: definition.name });
            return;
        }

        this.registeredModules.set(definition.name, definition);
        logger.info('Module registered', { module: definition.name, version: definition.version });
    }

    /**
     * Initialize all enabled modules
     */
    async initializeModules(): Promise<void> {
        const enabledModules = await moduleService.listModules({ status: 'enabled' });

        for (const module of enabledModules) {
            try {
                await this.initializeModule(module.name);
            } catch (error) {
                logger.error('Failed to initialize module', {
                    module: module.name,
                    error,
                });
            }
        }
    }

    /**
     * Initialize a specific module
     */
    async initializeModule(moduleName: string): Promise<void> {
        if (this.initializedModules.has(moduleName)) {
            logger.debug('Module already initialized', { module: moduleName });
            return;
        }

        const definition = this.registeredModules.get(moduleName);
        if (!definition) {
            logger.warn('Module definition not found', { module: moduleName });
            return;
        }

        // Register hooks
        if (definition.hooks) {
            for (const hook of definition.hooks) {
                // In a real implementation, we would dynamically load the handler
                // For now, we'll just register the hook metadata
                logger.debug('Hook registered', {
                    module: moduleName,
                    hook: hook.name,
                });
            }
        }

        // Call onEnable lifecycle hook
        if (definition.onEnable) {
            await definition.onEnable();
        }

        this.initializedModules.add(moduleName);
        logger.info('Module initialized', { module: moduleName });
    }

    /**
     * Shutdown a module
     */
    async shutdownModule(moduleName: string): Promise<void> {
        if (!this.initializedModules.has(moduleName)) {
            return;
        }

        const definition = this.registeredModules.get(moduleName);
        if (definition?.onDisable) {
            await definition.onDisable();
        }

        // Unregister hooks
        hookSystem.unregisterModuleHooks(moduleName);

        this.initializedModules.delete(moduleName);
        logger.info('Module shutdown', { module: moduleName });
    }

    /**
     * Install a module from definition
     */
    async installModuleFromDefinition(definition: ModuleDefinition): Promise<void> {
        // Check if already installed
        const existing = await moduleService.getModuleByName(definition.name);
        if (existing) {
            throw new Error('Module already installed');
        }

        // Install module
        const module = await moduleService.installModule(
            definition.name,
            definition.display_name,
            definition.version,
            {
                description: definition.description,
                author: definition.author,
                category: definition.category,
            }
        );

        // Add dependencies
        if (definition.dependencies) {
            for (const dep of definition.dependencies) {
                const depModule = await moduleService.getModuleByName(dep.module);
                if (!depModule) {
                    throw new Error(`Dependency module not found: ${dep.module}`);
                }

                await moduleService.addModuleDependency(
                    module.id,
                    depModule.id,
                    dep.version,
                    dep.optional || false
                );
            }
        }

        // Add permissions
        if (definition.permissions) {
            for (const perm of definition.permissions) {
                await dbQuery(
                    `INSERT INTO module_permissions (module_id, permission_name, description, category)
                     VALUES ($1, $2, $3, $4)`,
                    [module.id, perm.name, perm.description || null, perm.category]
                );
            }
        }

        // Add settings
        if (definition.settings) {
            for (const setting of definition.settings) {
                await dbQuery(
                    `INSERT INTO module_settings (module_id, setting_key, setting_value, setting_type, is_encrypted, description, default_value)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        module.id,
                        setting.key,
                        JSON.stringify(setting.defaultValue),
                        setting.type,
                        setting.encrypted || false,
                        setting.description || null,
                        JSON.stringify(setting.defaultValue),
                    ]
                );
            }
        }

        // Add hooks
        if (definition.hooks) {
            for (const hook of definition.hooks) {
                await dbQuery(
                    `INSERT INTO module_hooks (module_id, hook_name, hook_type, priority, handler_path, config)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        module.id,
                        hook.name,
                        hook.type,
                        hook.priority || 10,
                        hook.handler,
                        JSON.stringify(hook.config || {}),
                    ]
                );
            }
        }

        // Add routes
        if (definition.routes) {
            for (const route of definition.routes) {
                await dbQuery(
                    `INSERT INTO module_routes (module_id, method, path, handler_path, middleware, permissions, is_public)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        module.id,
                        route.method,
                        route.path,
                        route.handler,
                        JSON.stringify(route.middleware || []),
                        JSON.stringify(route.permissions || []),
                        route.public || false,
                    ]
                );
            }
        }

        // Add UI components
        if (definition.uiComponents) {
            for (const component of definition.uiComponents) {
                await dbQuery(
                    `INSERT INTO module_ui_components (module_id, component_name, component_type, mount_point, component_path, props, permissions, order_index)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        module.id,
                        component.name,
                        component.type,
                        component.mountPoint || null,
                        component.component,
                        JSON.stringify(component.props || {}),
                        JSON.stringify(component.permissions || []),
                        component.order || 0,
                    ]
                );
            }
        }

        // Call onInstall lifecycle hook
        if (definition.onInstall) {
            await definition.onInstall();
        }

        // Register the module definition
        this.registerModule(definition);

        logger.info('Module installed from definition', {
            module: definition.name,
            version: definition.version,
        });
    }

    /**
     * Get all registered module definitions
     */
    getRegisteredModules(): ModuleDefinition[] {
        return Array.from(this.registeredModules.values());
    }

    /**
     * Get a specific module definition
     */
    getModuleDefinition(moduleName: string): ModuleDefinition | undefined {
        return this.registeredModules.get(moduleName);
    }

    /**
     * Check if a module is initialized
     */
    isModuleInitialized(moduleName: string): boolean {
        return this.initializedModules.has(moduleName);
    }
}

export const moduleRegistry = new ModuleRegistry();

/**
 * Helper function to create a module definition
 */
export function defineModule(definition: ModuleDefinition): ModuleDefinition {
    return definition;
}
