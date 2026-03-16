import { moduleRegistry } from './services/moduleRegistry.js';
import { projectsModule } from './modules/projectsModule.js';
import { installationsModule } from './modules/installationsModule.js';
import { serviceRequestsModule } from './modules/serviceRequestsModule.js';
import { tenantsModule } from './modules/tenantsModule.js';
import { logger } from './logger.js';

/**
 * Initialize the module system
 * Registers core modules and initializes enabled modules
 */
export async function initializeModuleSystem(): Promise<void> {
    try {
        logger.info('Initializing module system');

        // Register core modules
        moduleRegistry.registerModule(projectsModule);
        moduleRegistry.registerModule(installationsModule);
        moduleRegistry.registerModule(serviceRequestsModule);
        moduleRegistry.registerModule(tenantsModule);

        // Initialize all enabled modules
        await moduleRegistry.initializeModules();

        logger.info('Module system initialized');
    } catch (error) {
        logger.warn('Module system initialization failed - continuing without modules', { error });
    }
}
