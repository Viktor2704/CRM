import { defineModule } from '../services/moduleRegistry.js';
import { HOOKS, registerHook } from '../services/hookSystem.js';
import { logger } from '../logger.js';
import { dbQuery } from '../db.js';

/**
 * Sample Analytics Plugin Module
 * Demonstrates how to create a custom plugin module
 */
export const analyticsPluginModule = defineModule({
    name: 'plugin.analytics',
    display_name: 'Advanced Analytics',
    description: 'Advanced analytics and reporting capabilities',
    version: '1.0.0',
    author: 'Novinzhstroy Team',
    category: 'business',

    dependencies: [
        {
            module: 'core.projects',
            version: '>=1.0.0',
            optional: false,
        },
        {
            module: 'core.installations',
            version: '>=1.0.0',
            optional: false,
        },
    ],

    permissions: [
        {
            name: 'analytics.view',
            description: 'View analytics dashboards',
            category: 'read',
        },
        {
            name: 'analytics.export',
            description: 'Export analytics data',
            category: 'execute',
        },
        {
            name: 'analytics.configure',
            description: 'Configure analytics settings',
            category: 'admin',
        },
    ],

    hooks: [
        {
            name: HOOKS.PROJECT_CREATED,
            type: 'event',
            handler: 'plugins/analytics/hooks/trackProjectCreation',
            priority: 20,
        },
        {
            name: HOOKS.INSTALLATION_STAGE_CHANGED,
            type: 'event',
            handler: 'plugins/analytics/hooks/trackStageChange',
            priority: 20,
        },
        {
            name: HOOKS.SERVICE_REQUEST_CREATED,
            type: 'event',
            handler: 'plugins/analytics/hooks/trackServiceRequest',
            priority: 20,
        },
    ],

    settings: [
        {
            key: 'enable_real_time_tracking',
            type: 'boolean',
            defaultValue: true,
            description: 'Enable real-time analytics tracking',
        },
        {
            key: 'data_retention_days',
            type: 'number',
            defaultValue: 365,
            description: 'Number of days to retain analytics data',
        },
        {
            key: 'export_format',
            type: 'string',
            defaultValue: 'csv',
            description: 'Default export format (csv, xlsx, json)',
        },
    ],

    routes: [
        {
            method: 'GET',
            path: '/api/analytics/dashboard',
            handler: 'plugins/analytics/routes/getDashboard',
            permissions: ['analytics.view'],
        },
        {
            method: 'GET',
            path: '/api/analytics/export',
            handler: 'plugins/analytics/routes/exportData',
            permissions: ['analytics.export'],
        },
        {
            method: 'POST',
            path: '/api/analytics/track',
            handler: 'plugins/analytics/routes/trackEvent',
            permissions: ['analytics.view'],
        },
    ],

    uiComponents: [
        {
            name: 'analytics_dashboard',
            type: 'page',
            component: '/pages/AnalyticsDashboard',
            permissions: ['analytics.view'],
            order: 100,
        },
        {
            name: 'analytics_widget',
            type: 'widget',
            mountPoint: 'dashboard',
            component: '/components/AnalyticsWidget',
            permissions: ['analytics.view'],
            order: 10,
        },
        {
            name: 'analytics_menu',
            type: 'menu',
            mountPoint: 'main_menu',
            component: '/components/AnalyticsMenuItem',
            permissions: ['analytics.view'],
            order: 50,
        },
    ],

    async onInstall() {
        logger.info('Installing Analytics Plugin');

        // Create analytics tables
        await dbQuery(`
            CREATE TABLE IF NOT EXISTS analytics_events (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                event_type VARCHAR(100) NOT NULL,
                event_data JSONB DEFAULT '{}',
                user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        `);

        await dbQuery(`
            CREATE INDEX IF NOT EXISTS idx_analytics_events_type
            ON analytics_events(event_type)
        `);

        await dbQuery(`
            CREATE INDEX IF NOT EXISTS idx_analytics_events_created
            ON analytics_events(created_at)
        `);

        logger.info('Analytics Plugin installed successfully');
    },

    async onUninstall() {
        logger.info('Uninstalling Analytics Plugin');

        // Clean up analytics tables
        await dbQuery('DROP TABLE IF EXISTS analytics_events CASCADE');

        logger.info('Analytics Plugin uninstalled successfully');
    },

    async onEnable() {
        logger.info('Enabling Analytics Plugin');

        // Register hook handlers
        registerHook(
            'plugin.analytics',
            HOOKS.PROJECT_CREATED,
            async (data) => {
                await dbQuery(
                    `INSERT INTO analytics_events (event_type, event_data, user_id)
                     VALUES ($1, $2, $3)`,
                    ['project_created', JSON.stringify(data), data.userId || null]
                );
                logger.debug('Tracked project creation', { projectId: data.projectId });
            },
            20
        );

        registerHook(
            'plugin.analytics',
            HOOKS.INSTALLATION_STAGE_CHANGED,
            async (data) => {
                await dbQuery(
                    `INSERT INTO analytics_events (event_type, event_data, user_id)
                     VALUES ($1, $2, $3)`,
                    ['installation_stage_changed', JSON.stringify(data), data.userId || null]
                );
                logger.debug('Tracked installation stage change', { installationId: data.installationId });
            },
            20
        );

        registerHook(
            'plugin.analytics',
            HOOKS.SERVICE_REQUEST_CREATED,
            async (data) => {
                await dbQuery(
                    `INSERT INTO analytics_events (event_type, event_data, user_id)
                     VALUES ($1, $2, $3)`,
                    ['service_request_created', JSON.stringify(data), data.userId || null]
                );
                logger.debug('Tracked service request creation', { requestId: data.requestId });
            },
            20
        );

        logger.info('Analytics Plugin enabled successfully');
    },

    async onDisable() {
        logger.info('Disabling Analytics Plugin');
        // Hook handlers are automatically unregistered by the module system
        logger.info('Analytics Plugin disabled successfully');
    },
});
