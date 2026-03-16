import { dbQuery } from '../db.js';
import { logger } from '../logger.js';
import type { Module, ModuleDependency, ModuleEvent } from '../types/module.js';

export class ModuleService {
    // List all modules
    async listModules(filters?: {
        status?: string;
        category?: string;
        is_core?: boolean;
    }): Promise<Module[]> {
        let query = 'SELECT * FROM modules WHERE 1=1';
        const params: any[] = [];
        let paramIndex = 1;

        if (filters?.status) {
            query += ` AND status = $${paramIndex++}`;
            params.push(filters.status);
        }

        if (filters?.category) {
            query += ` AND category = $${paramIndex++}`;
            params.push(filters.category);
        }

        if (filters?.is_core !== undefined) {
            query += ` AND is_core = $${paramIndex++}`;
            params.push(filters.is_core);
        }

        query += ' ORDER BY is_core DESC, display_name ASC';

        const result = await dbQuery(query, params);
        return result.rows;
    }

    // Get module by ID
    async getModuleById(id: string): Promise<Module | null> {
        const result = await dbQuery('SELECT * FROM modules WHERE id = $1', [id]);
        return result.rows[0] || null;
    }

    // Get module by name
    async getModuleByName(name: string): Promise<Module | null> {
        const result = await dbQuery('SELECT * FROM modules WHERE name = $1', [name]);
        return result.rows[0] || null;
    }

    // Install module
    async installModule(
        name: string,
        displayName: string,
        version: string,
        options: {
            description?: string;
            author?: string;
            category?: 'core' | 'business' | 'integration' | 'utility';
            config?: Record<string, any>;
            metadata?: Record<string, any>;
        } = {}
    ): Promise<Module> {
        const result = await dbQuery(
            `INSERT INTO modules (name, display_name, description, version, author, category, status, config, metadata, installed_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'disabled', $7, $8, now())
             RETURNING *`,
            [
                name,
                displayName,
                options.description || null,
                version,
                options.author || null,
                options.category || 'business',
                JSON.stringify(options.config || {}),
                JSON.stringify(options.metadata || {}),
            ]
        );

        const module = result.rows[0];

        await this.logModuleEvent(module.id, 'installed', {
            version,
            category: options.category,
        });

        logger.info('Module installed', { module: name, version });
        return module;
    }

    // Enable module
    async enableModule(moduleId: string, userId?: string): Promise<Module> {
        // Check dependencies
        const dependencies = await this.getModuleDependencies(moduleId);
        for (const dep of dependencies) {
            if (!dep.is_optional) {
                const depModule = await this.getModuleById(dep.depends_on_module_id);
                if (!depModule || depModule.status !== 'enabled') {
                    throw new Error(`Dependency module not enabled: ${depModule?.name || dep.depends_on_module_id}`);
                }
            }
        }

        const result = await dbQuery(
            `UPDATE modules SET status = 'enabled', enabled_at = now(), updated_at = now()
             WHERE id = $1 AND status = 'disabled'
             RETURNING *`,
            [moduleId]
        );

        if (result.rows.length === 0) {
            throw new Error('Module not found or already enabled');
        }

        const module = result.rows[0];

        await this.logModuleEvent(moduleId, 'enabled', {}, userId);

        logger.info('Module enabled', { module: module.name });
        return module;
    }

    // Disable module
    async disableModule(moduleId: string, userId?: string): Promise<Module> {
        const module = await this.getModuleById(moduleId);
        if (!module) {
            throw new Error('Module not found');
        }

        if (module.is_core) {
            throw new Error('Cannot disable core module');
        }

        // Check if other modules depend on this
        const dependents = await dbQuery(
            'SELECT m.* FROM modules m JOIN module_dependencies md ON m.id = md.module_id WHERE md.depends_on_module_id = $1 AND m.status = $2',
            [moduleId, 'enabled']
        );

        if (dependents.rows.length > 0) {
            const dependentNames = dependents.rows.map((m: any) => m.name).join(', ');
            throw new Error(`Cannot disable module: other modules depend on it (${dependentNames})`);
        }

        const result = await dbQuery(
            `UPDATE modules SET status = 'disabled', disabled_at = now(), updated_at = now()
             WHERE id = $1 AND status = 'enabled'
             RETURNING *`,
            [moduleId]
        );

        if (result.rows.length === 0) {
            throw new Error('Module not found or already disabled');
        }

        await this.logModuleEvent(moduleId, 'disabled', {}, userId);

        logger.info('Module disabled', { module: module.name });
        return result.rows[0];
    }

    // Uninstall module
    async uninstallModule(moduleId: string, userId?: string): Promise<void> {
        const module = await this.getModuleById(moduleId);
        if (!module) {
            throw new Error('Module not found');
        }

        if (module.is_core) {
            throw new Error('Cannot uninstall core module');
        }

        if (module.status === 'enabled') {
            throw new Error('Cannot uninstall enabled module. Disable it first.');
        }

        // Check dependencies
        const dependents = await dbQuery(
            'SELECT m.* FROM modules m JOIN module_dependencies md ON m.id = md.module_id WHERE md.depends_on_module_id = $1',
            [moduleId]
        );

        if (dependents.rows.length > 0) {
            const dependentNames = dependents.rows.map((m: any) => m.name).join(', ');
            throw new Error(`Cannot uninstall module: other modules depend on it (${dependentNames})`);
        }

        await this.logModuleEvent(moduleId, 'uninstalled', { name: module.name }, userId);

        await dbQuery('DELETE FROM modules WHERE id = $1', [moduleId]);

        logger.info('Module uninstalled', { module: module.name });
    }

    // Get module dependencies
    async getModuleDependencies(moduleId: string): Promise<ModuleDependency[]> {
        const result = await dbQuery(
            'SELECT * FROM module_dependencies WHERE module_id = $1',
            [moduleId]
        );
        return result.rows;
    }

    // Add module dependency
    async addModuleDependency(
        moduleId: string,
        dependsOnModuleId: string,
        versionConstraint?: string,
        isOptional: boolean = false
    ): Promise<ModuleDependency> {
        const result = await dbQuery(
            `INSERT INTO module_dependencies (module_id, depends_on_module_id, version_constraint, is_optional)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [moduleId, dependsOnModuleId, versionConstraint || null, isOptional]
        );
        return result.rows[0];
    }

    // Update module configuration
    async updateModuleConfig(moduleId: string, config: Record<string, any>): Promise<Module> {
        const result = await dbQuery(
            `UPDATE modules SET config = $1, updated_at = now()
             WHERE id = $2
             RETURNING *`,
            [JSON.stringify(config), moduleId]
        );

        if (result.rows.length === 0) {
            throw new Error('Module not found');
        }

        return result.rows[0];
    }

    // Get module settings
    async getModuleSettings(moduleId: string): Promise<any[]> {
        const result = await dbQuery(
            'SELECT * FROM module_settings WHERE module_id = $1 ORDER BY setting_key',
            [moduleId]
        );
        return result.rows;
    }

    // Update module setting
    async updateModuleSetting(
        moduleId: string,
        settingKey: string,
        settingValue: any
    ): Promise<any> {
        const result = await dbQuery(
            `INSERT INTO module_settings (module_id, setting_key, setting_value, updated_at)
             VALUES ($1, $2, $3, now())
             ON CONFLICT (module_id, setting_key)
             DO UPDATE SET setting_value = $3, updated_at = now()
             RETURNING *`,
            [moduleId, settingKey, JSON.stringify(settingValue)]
        );
        return result.rows[0];
    }

    // Get module permissions
    async getModulePermissions(moduleId: string): Promise<any[]> {
        const result = await dbQuery(
            'SELECT * FROM module_permissions WHERE module_id = $1 ORDER BY permission_name',
            [moduleId]
        );
        return result.rows;
    }

    // Get all enabled modules with their permissions
    async getEnabledModulesWithPermissions(): Promise<any[]> {
        const result = await dbQuery(
            `SELECT m.*,
                    COALESCE(json_agg(mp.*) FILTER (WHERE mp.id IS NOT NULL), '[]') as permissions
             FROM modules m
             LEFT JOIN module_permissions mp ON m.id = mp.module_id
             WHERE m.status = 'enabled'
             GROUP BY m.id
             ORDER BY m.is_core DESC, m.display_name ASC`
        );
        return result.rows;
    }

    // Log module event
    async logModuleEvent(
        moduleId: string,
        eventType: 'installed' | 'enabled' | 'disabled' | 'uninstalled' | 'updated' | 'error',
        eventData: Record<string, any> = {},
        userId?: string
    ): Promise<ModuleEvent> {
        const result = await dbQuery(
            `INSERT INTO module_events (module_id, event_type, event_data, user_id)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [moduleId, eventType, JSON.stringify(eventData), userId || null]
        );
        return result.rows[0];
    }

    // Get module events
    async getModuleEvents(moduleId: string, limit: number = 50): Promise<ModuleEvent[]> {
        const result = await dbQuery(
            `SELECT * FROM module_events
             WHERE module_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [moduleId, limit]
        );
        return result.rows;
    }
}

export const moduleService = new ModuleService();
