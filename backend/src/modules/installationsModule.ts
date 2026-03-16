import { defineModule } from '../services/moduleRegistry.js';
import { HOOKS } from '../services/hookSystem.js';
import { logger } from '../logger.js';

/**
 * Core Installations Module
 * Manages installation tracking and lifecycle
 */
export const installationsModule = defineModule({
    name: 'core.installations',
    display_name: 'Installations',
    description: 'Installation tracking, stage management, and procurement',
    version: '1.0.0',
    author: 'Novinzhstroy',
    category: 'core',

    permissions: [
        {
            name: 'installations.read',
            description: 'View installations',
            category: 'read',
        },
        {
            name: 'installations.write',
            description: 'Create and edit installations',
            category: 'write',
        },
        {
            name: 'installations.delete',
            description: 'Delete installations',
            category: 'admin',
        },
        {
            name: 'installations.procurement',
            description: 'Manage procurement items',
            category: 'write',
        },
        {
            name: 'installations.stage_edit',
            description: 'Edit installation stages',
            category: 'write',
        },
    ],

    hooks: [
        {
            name: HOOKS.INSTALLATION_CREATED,
            type: 'event',
            handler: 'modules/installations/hooks/onInstallationCreated',
            priority: 10,
        },
        {
            name: HOOKS.INSTALLATION_STAGE_CHANGED,
            type: 'event',
            handler: 'modules/installations/hooks/onStageChanged',
            priority: 10,
        },
    ],

    settings: [
        {
            key: 'default_installation_stage',
            type: 'string',
            defaultValue: 'planning',
            description: 'Default stage for new installations',
        },
        {
            key: 'enable_procurement',
            type: 'boolean',
            defaultValue: true,
            description: 'Enable procurement management',
        },
        {
            key: 'enable_deadlines',
            type: 'boolean',
            defaultValue: true,
            description: 'Enable deadline tracking',
        },
    ],

    uiComponents: [
        {
            name: 'installations_page',
            type: 'page',
            component: '/pages/Installations',
            permissions: ['installations.read'],
        },
        {
            name: 'installation_detail_page',
            type: 'page',
            component: '/pages/InstallationDetail',
            permissions: ['installations.read'],
        },
        {
            name: 'installations_menu',
            type: 'menu',
            mountPoint: 'main_menu',
            component: '/components/InstallationsMenuItem',
            order: 20,
        },
    ],

    async onEnable() {
        logger.info('Installations module enabled');
    },

    async onDisable() {
        logger.info('Installations module disabled');
    },
});
