import {
  createCampaign,
  updateCampaign,
  getCampaignById,
  listCampaigns,
  addCampaignRecipients,
  startCampaign,
  processCampaignBatch,
  createSegment,
  getCampaignAnalytics,
  handleUnsubscribe,
} from '../services/emailCampaigns.js';

export const registerEmailCampaignsRoutes = (params: any) => {
  const { app, requireAuth, requireAdminLike, asyncHandler } = params;

  // Create campaign
  app.post('/admin/email-campaigns', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const campaignId = await createCampaign({
      ...request.body,
      createdBy: request.user.id,
    });
    response.status(201).json({ id: campaignId });
  }));

  // Update campaign
  app.patch('/admin/email-campaigns/:id', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;
    await updateCampaign(id, request.body);
    response.status(200).json({ success: true });
  }));

  // Get campaign by ID
  app.get('/admin/email-campaigns/:id', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;
    const campaign = await getCampaignById(id);
    if (!campaign) {
      response.status(404).json({ error: 'Campaign not found' });
      return;
    }
    response.status(200).json(campaign);
  }));

  // List campaigns
  app.get('/admin/email-campaigns', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { status, limit, offset } = request.query;
    const campaigns = await listCampaigns({
      status: status ? String(status).split(',') : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    response.status(200).json(campaigns);
  }));

  // Add recipients to campaign
  app.post('/admin/email-campaigns/:id/recipients', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;
    const { recipients } = request.body;
    const added = await addCampaignRecipients(id, recipients);
    response.status(200).json({ added });
  }));

  // Start campaign
  app.post('/admin/email-campaigns/:id/start', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;
    await startCampaign(id);
    response.status(200).json({ success: true });
  }));

  // Pause campaign
  app.post('/admin/email-campaigns/:id/pause', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;
    await updateCampaign(id, { status: 'paused' });
    response.status(200).json({ success: true });
  }));

  // Resume campaign
  app.post('/admin/email-campaigns/:id/resume', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;
    await updateCampaign(id, { status: 'sending' });
    await startCampaign(id);
    response.status(200).json({ success: true });
  }));

  // Cancel campaign
  app.post('/admin/email-campaigns/:id/cancel', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;
    await updateCampaign(id, { status: 'cancelled' });
    response.status(200).json({ success: true });
  }));

  // Get campaign analytics
  app.get('/admin/email-campaigns/:id/analytics', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;
    const analytics = await getCampaignAnalytics(id);
    if (!analytics) {
      response.status(404).json({ error: 'Campaign not found' });
      return;
    }
    response.status(200).json(analytics);
  }));

  // Create segment
  app.post('/admin/email-campaigns/segments', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const segmentId = await createSegment({
      ...request.body,
      createdBy: request.user.id,
    });
    response.status(201).json({ id: segmentId });
  }));

  // Unsubscribe endpoint (public)
  app.get('/unsubscribe/:trackingId', asyncHandler(async (request: any, response: any) => {
    const { trackingId } = request.params;
    await handleUnsubscribe(trackingId);
    response.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Отписка от рассылки</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
          h1 { color: #333; }
          p { color: #666; line-height: 1.6; }
        </style>
      </head>
      <body>
        <h1>✓ Вы успешно отписались</h1>
        <p>Вы больше не будете получать письма из этой рассылки.</p>
        <p>Если это произошло по ошибке, свяжитесь с нами.</p>
      </body>
      </html>
    `);
  }));
};
