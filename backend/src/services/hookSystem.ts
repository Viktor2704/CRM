import { logger } from '../logger.js';
import type { HookHandler, HookContext, HookRegistration } from '../types/module.js';

/**
 * Plugin Hook System
 * Allows modules to register hooks and execute them
 */
class HookSystem {
    private hooks: Map<string, HookRegistration[]> = new Map();

    /**
     * Register a hook handler
     */
    registerHook(
        module: string,
        hookName: string,
        handler: HookHandler,
        priority: number = 10
    ): void {
        if (!this.hooks.has(hookName)) {
            this.hooks.set(hookName, []);
        }

        const registration: HookRegistration = {
            module,
            hookName,
            handler,
            priority,
        };

        const handlers = this.hooks.get(hookName)!;
        handlers.push(registration);

        // Sort by priority (lower number = higher priority)
        handlers.sort((a, b) => a.priority - b.priority);

        logger.debug('Hook registered', { module, hookName, priority });
    }

    /**
     * Unregister all hooks for a module
     */
    unregisterModuleHooks(module: string): void {
        for (const [hookName, handlers] of this.hooks.entries()) {
            const filtered = handlers.filter(h => h.module !== module);
            if (filtered.length === 0) {
                this.hooks.delete(hookName);
            } else {
                this.hooks.set(hookName, filtered);
            }
        }
        logger.debug('Module hooks unregistered', { module });
    }

    /**
     * Execute action hooks (no return value expected)
     */
    async executeAction(
        hookName: string,
        data: any,
        context?: HookContext
    ): Promise<void> {
        const handlers = this.hooks.get(hookName) || [];

        for (const registration of handlers) {
            try {
                await registration.handler(data, context);
            } catch (error) {
                logger.error('Hook execution failed', {
                    hookName,
                    module: registration.module,
                    error,
                });
            }
        }
    }

    /**
     * Execute filter hooks (data is passed through and can be modified)
     */
    async executeFilter<T = any>(
        hookName: string,
        data: T,
        context?: HookContext
    ): Promise<T> {
        const handlers = this.hooks.get(hookName) || [];
        let result = data;

        for (const registration of handlers) {
            try {
                result = await registration.handler(result, context);
            } catch (error) {
                logger.error('Filter hook execution failed', {
                    hookName,
                    module: registration.module,
                    error,
                });
                // Continue with unmodified data on error
            }
        }

        return result;
    }

    /**
     * Execute event hooks (fire and forget, errors are logged but don't stop execution)
     */
    executeEvent(hookName: string, data: any, context?: HookContext): void {
        const handlers = this.hooks.get(hookName) || [];

        // Execute asynchronously without waiting
        setImmediate(async () => {
            for (const registration of handlers) {
                try {
                    await registration.handler(data, context);
                } catch (error) {
                    logger.error('Event hook execution failed', {
                        hookName,
                        module: registration.module,
                        error,
                    });
                }
            }
        });
    }

    /**
     * Check if a hook has any handlers
     */
    hasHook(hookName: string): boolean {
        const handlers = this.hooks.get(hookName);
        return handlers !== undefined && handlers.length > 0;
    }

    /**
     * Get all registered hooks
     */
    getRegisteredHooks(): string[] {
        return Array.from(this.hooks.keys());
    }

    /**
     * Get handlers for a specific hook
     */
    getHookHandlers(hookName: string): HookRegistration[] {
        return this.hooks.get(hookName) || [];
    }

    /**
     * Clear all hooks (useful for testing)
     */
    clearAllHooks(): void {
        this.hooks.clear();
        logger.debug('All hooks cleared');
    }
}

export const hookSystem = new HookSystem();

/**
 * Standard hook names used throughout the application
 */
export const HOOKS = {
    // Module lifecycle
    MODULE_INSTALLED: 'module.installed',
    MODULE_ENABLED: 'module.enabled',
    MODULE_DISABLED: 'module.disabled',
    MODULE_UNINSTALLED: 'module.uninstalled',

    // User hooks
    USER_CREATED: 'user.created',
    USER_UPDATED: 'user.updated',
    USER_DELETED: 'user.deleted',
    USER_LOGIN: 'user.login',
    USER_LOGOUT: 'user.logout',

    // Project hooks
    PROJECT_CREATED: 'project.created',
    PROJECT_UPDATED: 'project.updated',
    PROJECT_DELETED: 'project.deleted',
    PROJECT_STATUS_CHANGED: 'project.status_changed',

    // Installation hooks
    INSTALLATION_CREATED: 'installation.created',
    INSTALLATION_UPDATED: 'installation.updated',
    INSTALLATION_DELETED: 'installation.deleted',
    INSTALLATION_STAGE_CHANGED: 'installation.stage_changed',

    // Service request hooks
    SERVICE_REQUEST_CREATED: 'service_request.created',
    SERVICE_REQUEST_UPDATED: 'service_request.updated',
    SERVICE_REQUEST_DELETED: 'service_request.deleted',
    SERVICE_REQUEST_STATUS_CHANGED: 'service_request.status_changed',
    SERVICE_REQUEST_ASSIGNED: 'service_request.assigned',

    // Tenant hooks
    TENANT_CREATED: 'tenant.created',
    TENANT_UPDATED: 'tenant.updated',
    TENANT_DELETED: 'tenant.deleted',

    // File hooks
    FILE_UPLOADED: 'file.uploaded',
    FILE_DELETED: 'file.deleted',

    // Notification hooks
    NOTIFICATION_CREATED: 'notification.created',
    NOTIFICATION_SENT: 'notification.sent',

    // Email hooks
    EMAIL_BEFORE_SEND: 'email.before_send',
    EMAIL_SENT: 'email.sent',
    EMAIL_FAILED: 'email.failed',

    // API hooks
    API_REQUEST_BEFORE: 'api.request.before',
    API_REQUEST_AFTER: 'api.request.after',
    API_RESPONSE_FILTER: 'api.response.filter',

    // Data hooks
    DATA_BEFORE_CREATE: 'data.before_create',
    DATA_AFTER_CREATE: 'data.after_create',
    DATA_BEFORE_UPDATE: 'data.before_update',
    DATA_AFTER_UPDATE: 'data.after_update',
    DATA_BEFORE_DELETE: 'data.before_delete',
    DATA_AFTER_DELETE: 'data.after_delete',

    // UI hooks
    UI_MENU_ITEMS: 'ui.menu_items',
    UI_DASHBOARD_WIDGETS: 'ui.dashboard_widgets',
    UI_PAGE_ACTIONS: 'ui.page_actions',
} as const;

/**
 * Helper function to register a hook
 */
export function registerHook(
    module: string,
    hookName: string,
    handler: HookHandler,
    priority: number = 10
): void {
    hookSystem.registerHook(module, hookName, handler, priority);
}

/**
 * Helper function to execute an action hook
 */
export async function doAction(
    hookName: string,
    data: any,
    context?: HookContext
): Promise<void> {
    await hookSystem.executeAction(hookName, data, context);
}

/**
 * Helper function to execute a filter hook
 */
export async function applyFilters<T = any>(
    hookName: string,
    data: T,
    context?: HookContext
): Promise<T> {
    return await hookSystem.executeFilter(hookName, data, context);
}

/**
 * Helper function to execute an event hook
 */
export function fireEvent(
    hookName: string,
    data: any,
    context?: HookContext
): void {
    hookSystem.executeEvent(hookName, data, context);
}
