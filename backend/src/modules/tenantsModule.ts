import { defineModule } from '../services/moduleRegistry.js';
import { HOOKS } from '../services/hookSystem.js';
import { logger } from '../logger.js';

/**
 * Core Tenants Module
 * Manages multi-tenant functionality
 */
export const tenantsModule = defineModule({
    name: 'core.tenants',
    display_name: 'Tenants',
    description: 'Multi-tenant management and organization',
    version: '1.0.0',
    author: 'Novinzhstroy',
    category: 'core',

    permissions: [
        {
            name: 'tenants.read',
            description: 'View tenants',
            category: 'read',
        },
        {
            name: 'tenants.write',
            description: 'Create and edit tenants',
            category: 'write',
        },
        {
            name: 'tenants.delete',
            description: 'Delete tenants',
            category: 'admin',
        },
    ],

    hooks: [
        {
            name: HOOKS.TENANT_CREATED,
            type: 'event',
            handler: 'modules/tenants/hooks/onTenantCreated',
            priority: 10,
        },
        {
            name: HOOKS.TENANT_UPDATED,
            type: 'event',
            handler: 'modules/tenants/hooks/onTenantUpdated',
            priority: 10,
        },
    ],

    settings: [
        {
            key: 'enable_tenant_isolation',
            type: 'boolean',
            defaultValue: true,
            description: 'Enable strict tenant data isolation',
        },
        {
            key: 'default_tenant_status',
            type: 'string',
            defaultValue: 'active',
            description: 'Default status for new tenants',
        },
    ],

    uiComponents: [
        {
            name: 'tenants_page',
            type: 'page',
            component: '/pages/Tenants',
            permissions: ['tenants.read'],
        },
        {
            name: 'tenant_360_page',
            type: 'page',
            component: '/pages/Tenant360',
            permissions: ['tenants.read'],
        },
        {
            name: 'tenants_menu',
            type: 'menu',
            mountPoint: 'main_menu',
            component: '/components/TenantsMenuItem',
            order: 40,
        },
    ],

    async onEnable() {
        logger.info('Tenants module enabled');
    },

    async onDisable() {
        logger.info('Tenants module disabled');
    },
});
