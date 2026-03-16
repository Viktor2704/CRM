import {
  calculateDeliverabilityScore,
  getDeliverabilityStats,
  getDkimConfig,
  validateDkimConfig,
  generateSpfRecord,
  validateSpfRecord,
  generateDmarcRecord,
  getDmarcReports,
} from '../services/emailDeliverability.js';

export const registerEmailDeliverabilityRoutes = (params: any) => {
  const { app, requireAuth, requireAdminLike, asyncHandler } = params;

  // Get deliverability score
  app.get('/admin/email-deliverability/score', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const score = await calculateDeliverabilityScore();
    response.status(200).json(score);
  }));

  // Get deliverability statistics
  app.get('/admin/email-deliverability/stats', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const stats = await getDeliverabilityStats();
    response.status(200).json(stats);
  }));

  // Get DKIM configuration
  app.get('/admin/email-deliverability/dkim', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const config = getDkimConfig();
    if (!config) {
      response.status(200).json({ configured: false });
      return;
    }

    const validation = validateDkimConfig(config);
    response.status(200).json({
      configured: true,
      domainName: config.domainName,
      keySelector: config.keySelector,
      valid: validation.valid,
      errors: validation.errors,
    });
  }));

  // Generate SPF record
  app.post('/admin/email-deliverability/spf/generate', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { domain, ipAddresses } = request.body;
    const record = generateSpfRecord(domain, ipAddresses || []);
    const validation = validateSpfRecord(record);
    response.status(200).json({ record, valid: validation.valid, errors: validation.errors });
  }));

  // Validate SPF record
  app.post('/admin/email-deliverability/spf/validate', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { record } = request.body;
    const validation = validateSpfRecord(record);
    response.status(200).json(validation);
  }));

  // Generate DMARC record
  app.post('/admin/email-deliverability/dmarc/generate', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const record = generateDmarcRecord(request.body);
    response.status(200).json({ record });
  }));

  // Get DMARC reports
  app.get('/admin/email-deliverability/dmarc/reports', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { domain, startDate, endDate, limit, offset } = request.query;
    const reports = await getDmarcReports({
      domain: domain ? String(domain) : undefined,
      startDate: startDate ? new Date(String(startDate)) : undefined,
      endDate: endDate ? new Date(String(endDate)) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    response.status(200).json(reports);
  }));
};
