import { checkDatabaseReady } from './db.js';
import { logger, serializeError } from './logger.js';
import { ensureAccessRequestSchema } from './schemas/accessRequestSchema.js';
import { ensureAiFeedbackSchema } from './schemas/aiFeedbackSchema.js';
import { ensureCalendarSchema } from './schemas/calendarSchema.js';
import { ensureContractSchema } from './schemas/contractSchema.js';
import { ensureDirectionSchema } from './schemas/directionSchema.js';
import { ensureInstallationExtendedSchema } from './schemas/installationSchema.js';
import { ensureMaintenanceItemSchema } from './schemas/maintenanceItemSchema.js';
import { ensureMaintenanceSchema } from './schemas/maintenanceSchema.js';
import { ensureNotificationSchema, ensureTelegramSchema } from './schemas/notificationSchema.js';
import { ensureProjectSchema } from './schemas/projectSchema.js';
import { ensureServiceRequestSchema } from './schemas/serviceRequestSchema.js';
import { ensureSppzJournalSchema } from './schemas/sppzJournalSchema.js';
import { ensureTicketClientNotificationSchema } from './schemas/ticketClientNotificationSchema.js';
import { ensureUploadedFileSchema } from './schemas/uploadedFileSchema.js';
import { ensureWorkflowSchema } from './schemas/workflowSchema.js';
import { localMockAuthEnabled } from './helpers/mockData.js';
import { verifyMailTransporter } from './services/mailService.js';
import { refreshEmailQueueMetrics } from './services/emailQueueService.js';
import { startEmailQueueWorker } from './services/emailQueueWorker.js';

let initializeBackendRuntimePromise: Promise<void> | null = null;

// Keep the legacy ensure* hooks in place until request-path call sites are cleaned up.
const runtimeSchemaInitializers = [
    ensureProjectSchema,
    ensureMaintenanceSchema,
    ensureServiceRequestSchema,
    ensureDirectionSchema,
    ensureMaintenanceItemSchema,
    ensureNotificationSchema,
    ensureTelegramSchema,
    ensureAiFeedbackSchema,
    ensureInstallationExtendedSchema,
    ensureAccessRequestSchema,
    ensureCalendarSchema,
    ensureContractSchema,
    ensureSppzJournalSchema,
    ensureTicketClientNotificationSchema,
    ensureUploadedFileSchema,
    ensureWorkflowSchema,
];

export const initializeBackendRuntime = async () => {
    if (initializeBackendRuntimePromise) {
        return initializeBackendRuntimePromise;
    }

    initializeBackendRuntimePromise = (async () => {
        if (localMockAuthEnabled) {
            logger.info('Skipping database runtime bootstrap in local mock auth mode');
            return;
        }

        for (const initializeSchema of runtimeSchemaInitializers) {
            await initializeSchema();
        }

        if (await checkDatabaseReady()) {
            await refreshEmailQueueMetrics();
            await verifyMailTransporter();
            startEmailQueueWorker();
        }

        logger.info('Backend runtime bootstrap completed', {
            total: runtimeSchemaInitializers.length,
        });
    })().catch((error) => {
        initializeBackendRuntimePromise = null;
        logger.error('Backend runtime bootstrap failed', {
            error: serializeError(error),
        });
        throw error;
    });

    return initializeBackendRuntimePromise;
};
