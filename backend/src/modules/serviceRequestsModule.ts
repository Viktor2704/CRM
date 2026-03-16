import { defineModule } from '../services/moduleRegistry.js';
import { HOOKS } from '../services/hookSystem.js';
import { logger } from '../logger.js';

/**
 * Core Service Requests Module
 * Manages service requests and tickets
 */
export const serviceRequestsModule = defineModule({
    name: 'core.service_requests',
    display_name: 'Service Requests',
    description: 'Service request and ticket management system',
    version: '1.0.0',
    author: 'Novinzhstroy',
    category: 'core',

    permissions: [
        {
            name: 'service_requests.read',
            description: 'View service requests',
            category: 'read',
        },
        {
            name: 'service_requests.write',
            description: 'Create and edit service requests',
            category: 'write',
        },
        {
            name: 'service_requests.delete',
            description: 'Delete service requests',
            category: 'admin',
        },
        {
            name: 'service_requests.assign',
            description: 'Assign service requests to users',
            category: 'write',
        },
    ],

    hooks: [
        {
            name: HOOKS.SERVICE_REQUEST_CREATED,
            type: 'event',
            handler: 'modules/service_requests/hooks/onServiceRequestCreated',
            priority: 10,
        },
        {
            name: HOOKS.SERVICE_REQUEST_STATUS_CHANGED,
            type: 'event',
            handler: 'modules/service_requests/hooks/onStatusChanged',
            priority: 10,
        },
        {
            name: HOOKS.SERVICE_REQUEST_ASSIGNED,
            type: 'event',
            handler: 'modules/service_requests/hooks/onAssigned',
            priority: 10,
        },
    ],

    settings: [
        {
            key: 'default_priority',
            type: 'string',
            defaultValue: 'medium',
            description: 'Default priority for new service requests',
        },
        {
            key: 'auto_assign',
            type: 'boolean',
            defaultValue: false,
            description: 'Automatically assign service requests',
        },
        {
            key: 'enable_sla',
            type: 'boolean',
            defaultValue: true,
            description: 'Enable SLA tracking',
        },
    ],

    uiComponents: [
        {
            name: 'service_requests_page',
            type: 'page',
            component: '/pages/ServiceRequests',
            permissions: ['service_requests.read'],
        },
        {
            name: 'service_requests_menu',
            type: 'menu',
            mountPoint: 'main_menu',
            component: '/components/ServiceRequestsMenuItem',
            order: 30,
        },
    ],

    async onEnable() {
        logger.info('Service Requests module enabled');
    },

    async onDisable() {
        logger.info('Service Requests module disabled');
    },
});
