import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { ApiError } from '../errors.js';
import {
  executeReport,
  listReportDefinitions,
  getReportDefinition,
  createReportDefinition,
  updateReportDefinition,
  deleteReportDefinition,
  listScheduledReports,
  createScheduledReport,
  updateScheduledReport,
  deleteScheduledReport,
  exportReportToCsv,
  exportReportToExcel,
  recordReportExecution,
  type ReportEntity,
  type ReportConfig,
} from '../services/reportingService.js';

export const createReportsRouter = (params: {
  requireAuth: any;
  internalGlobalRoles: ReadonlySet<string>;
}) => {
  const router = Router();
  const { requireAuth, internalGlobalRoles } = params;

  // List report definitions
  router.get(
    '/definitions',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const entityType = req.query.entityType as ReportEntity | undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
      const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : undefined;

      const result = await listReportDefinitions({ entityType, limit, offset });
      res.json(result);
    })
  );

  // Get report definition by ID
  router.get(
    '/definitions/:id',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const definition = await getReportDefinition(req.params.id);
      if (!definition) {
        throw new ApiError(404, 'NOT_FOUND', 'Report definition not found');
      }
      res.json(definition);
    })
  );

  // Create report definition
  router.post(
    '/definitions',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { name, description, entityType, config } = req.body;

      if (!name || !entityType || !config) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Missing required fields');
      }

      if (!['projects', 'installations', 'service_requests'].includes(entityType)) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid entity type');
      }

      const definition = await createReportDefinition({
        name,
        description,
        entityType,
        config,
        createdBy: req.authUser?.id || req.user?.id,
      });

      res.status(201).json(definition);
    })
  );

  // Update report definition
  router.patch(
    '/definitions/:id',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { name, description, config } = req.body;

      const definition = await updateReportDefinition(req.params.id, {
        name,
        description,
        config,
      });

      if (!definition) {
        throw new ApiError(404, 'NOT_FOUND', 'Report definition not found or is predefined');
      }

      res.json(definition);
    })
  );

  // Delete report definition
  router.delete(
    '/definitions/:id',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const deleted = await deleteReportDefinition(req.params.id);
      if (!deleted) {
        throw new ApiError(404, 'NOT_FOUND', 'Report definition not found or is predefined');
      }
      res.status(204).send();
    })
  );

  // Execute report
  router.post(
    '/execute',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { entityType, config, format } = req.body;

      if (!entityType || !config) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Missing required fields');
      }

      if (!['projects', 'installations', 'service_requests'].includes(entityType)) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid entity type');
      }

      const startTime = Date.now();
      const data = await executeReport(entityType, config);
      const executionTime = Date.now() - startTime;

      // Record execution
      await recordReportExecution({
        executedBy: req.authUser?.id || req.user?.id,
        status: 'success',
        rowCount: data.length,
        executionTimeMs: executionTime,
      });

      // Handle export formats
      if (format === 'csv') {
        const csv = exportReportToCsv(data);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="report_${Date.now()}.csv"`);
        return res.send('\uFEFF' + csv); // Add BOM for Excel compatibility
      }

      if (format === 'excel' || format === 'xlsx') {
        const filename = `report_${Date.now()}`;
        return await exportReportToExcel(res, filename, data);
      }

      // Default JSON response
      res.json({ data, rowCount: data.length, executionTime });
    })
  );

  // Execute report by definition ID
  router.post(
    '/definitions/:id/execute',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const definition = await getReportDefinition(req.params.id);
      if (!definition) {
        throw new ApiError(404, 'NOT_FOUND', 'Report definition not found');
      }

      const format = req.query.format as string | undefined;

      const startTime = Date.now();
      const data = await executeReport(definition.entityType, definition.config);
      const executionTime = Date.now() - startTime;

      // Record execution
      await recordReportExecution({
        reportDefinitionId: definition.id,
        executedBy: req.authUser?.id || req.user?.id,
        status: 'success',
        rowCount: data.length,
        executionTimeMs: executionTime,
      });

      // Handle export formats
      if (format === 'csv') {
        const csv = exportReportToCsv(data);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${definition.name}_${Date.now()}.csv"`);
        return res.send('\uFEFF' + csv);
      }

      if (format === 'excel' || format === 'xlsx') {
        const filename = `${definition.name}_${Date.now()}`;
        return await exportReportToExcel(res, filename, data);
      }

      // Default JSON response
      res.json({ data, rowCount: data.length, executionTime });
    })
  );

  // List scheduled reports
  router.get(
    '/scheduled',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
      const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : undefined;

      const result = await listScheduledReports({ limit, offset });
      res.json(result);
    })
  );

  // Create scheduled report
  router.post(
    '/scheduled',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { reportDefinitionId, name, schedule, deliveryMethod, deliveryConfig, recipientIds } = req.body;

      if (!reportDefinitionId || !name || !schedule || !deliveryMethod || !recipientIds) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Missing required fields');
      }

      if (!['daily', 'weekly', 'monthly'].includes(schedule)) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid schedule');
      }

      if (!['email', 'telegram', 'both'].includes(deliveryMethod)) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid delivery method');
      }

      if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Recipients must be a non-empty array');
      }

      const scheduledReport = await createScheduledReport({
        reportDefinitionId,
        name,
        schedule,
        deliveryMethod,
        deliveryConfig: deliveryConfig || {},
        recipientIds,
        createdBy: req.authUser?.id || req.user?.id,
      });

      res.status(201).json(scheduledReport);
    })
  );

  // Update scheduled report
  router.patch(
    '/scheduled/:id',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { name, schedule, deliveryMethod, deliveryConfig, recipientIds, isActive } = req.body;

      const scheduledReport = await updateScheduledReport(req.params.id, {
        name,
        schedule,
        deliveryMethod,
        deliveryConfig,
        recipientIds,
        isActive,
      });

      if (!scheduledReport) {
        throw new ApiError(404, 'NOT_FOUND', 'Scheduled report not found');
      }

      res.json(scheduledReport);
    })
  );

  // Delete scheduled report
  router.delete(
    '/scheduled/:id',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const deleted = await deleteScheduledReport(req.params.id);
      if (!deleted) {
        throw new ApiError(404, 'NOT_FOUND', 'Scheduled report not found');
      }
      res.status(204).send();
    })
  );

  return router;
};
