import { defineModule } from '../services/moduleRegistry.js';
import { HOOKS } from '../services/hookSystem.js';
import { logger } from '../logger.js';

/**
 * Core Projects Module
 * Manages project functionality
 */
export const projectsModule = defineModule({
    name: 'core.projects',
    display_name: 'Projects',
    description: 'Project management and tracking',
    version: '1.0.0',
    author: 'Novinzhstroy',
    category: 'core',

    permissions: [
        {
            name: 'projects.read',
            description: 'View projects',
            category: 'read',
        },
        {
            name: 'projects.write',
            description: 'Create and edit projects',
            category: 'write',
        },
        {
            name: 'projects.delete',
            description: 'Delete projects',
            category: 'admin',
        },
    ],

    hooks: [
        {
            name: HOOKS.PROJECT_CREATED,
            type: 'event',
            handler: 'modules/projects/hooks/onProjectCreated',
            priority: 10,
        },
        {
            name: HOOKS.PROJECT_UPDATED,
            type: 'event',
            handler: 'modules/projects/hooks/onProjectUpdated',
            priority: 10,
        },
    ],

    settings: [
        {
            key: 'default_project_status',
            type: 'string',
            defaultValue: 'planning',
            description: 'Default status for new projects',
        },
        {
            key: 'enable_project_templates',
            type: 'boolean',
            defaultValue: true,
            description: 'Enable project templates',
        },
    ],

    uiComponents: [
        {
            name: 'projects_page',
            type: 'page',
            component: '/pages/Projects',
            permissions: ['projects.read'],
        },
        {
            name: 'projects_menu',
            type: 'menu',
            mountPoint: 'main_menu',
            component: '/components/ProjectsMenuItem',
            order: 10,
        },
    ],

    async onEnable() {
        logger.info('Projects module enabled');
    },

    async onDisable() {
        logger.info('Projects module disabled');
    },
});
