import {
  recordTrackingEvent,
  getEmailTrackingStats,
  getEmailTrackingEvents,
  getClickTrackingDetails,
  getTrackingAnalytics,
} from '../services/emailTracking.js';

export const registerEmailTrackingRoutes = (params: any) => {
  const { app, requireAuth, requireAdminLike, asyncHandler } = params;

  // Tracking pixel endpoint (public)
  app.get('/api/email-tracking/pixel/:trackingId.png', asyncHandler(async (request: any, response: any) => {
    const { trackingId } = request.params;

    // Record open event
    await recordTrackingEvent({
      trackingId,
      eventType: 'opened',
      metadata: {
        userAgent: request.headers['user-agent'],
        ipAddress: request.ip,
      },
    });

    // Return 1x1 transparent pixel
    const pixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );

    response.set({
      'Content-Type': 'image/png',
      'Content-Length': pixel.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    });
    response.status(200).send(pixel);
  }));

  // Click tracking endpoint (public)
  app.get('/api/email-tracking/click/:trackingId/:encodedUrl', asyncHandler(async (request: any, response: any) => {
    const { trackingId, encodedUrl } = request.params;

    try {
      const originalUrl = Buffer.from(encodedUrl, 'base64url').toString('utf-8');

      // Record click event
      await recordTrackingEvent({
        trackingId,
        eventType: 'clicked',
        metadata: {
          url: originalUrl,
          userAgent: request.headers['user-agent'],
          ipAddress: request.ip,
        },
      });

      // Redirect to original URL
      response.redirect(302, originalUrl);
    } catch (error) {
      response.status(400).json({ error: 'Invalid tracking URL' });
    }
  }));

  // Get email tracking stats
  app.get('/admin/email-tracking/stats/:emailId', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { emailId } = request.params;
    const stats = await getEmailTrackingStats(emailId);
    response.status(200).json(stats);
  }));

  // Get email tracking events
  app.get('/admin/email-tracking/events', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { emailId, campaignId, eventType, limit, offset } = request.query;
    const events = await getEmailTrackingEvents({
      emailId: emailId ? String(emailId) : undefined,
      campaignId: campaignId ? String(campaignId) : undefined,
      eventType: eventType ? String(eventType) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    response.status(200).json(events);
  }));

  // Get click tracking details
  app.get('/admin/email-tracking/clicks/:trackingId', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { trackingId } = request.params;
    const clicks = await getClickTrackingDetails(trackingId);
    response.status(200).json(clicks);
  }));

  // Get tracking analytics
  app.get('/admin/email-tracking/analytics', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { campaignId, startDate, endDate } = request.query;
    const analytics = await getTrackingAnalytics({
      campaignId: campaignId ? String(campaignId) : undefined,
      startDate: startDate ? new Date(String(startDate)) : undefined,
      endDate: endDate ? new Date(String(endDate)) : undefined,
    });
    response.status(200).json(analytics);
  }));
};
