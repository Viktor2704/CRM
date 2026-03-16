import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';

/**
 * Email Tracking Service
 * Handles open tracking, click tracking, delivery confirmation
 */

export interface EmailTrackingPixel {
  trackingId: string;
  emailId: string;
  recipientEmail: string;
}

export interface EmailClickTracking {
  trackingId: string;
  emailId: string;
  originalUrl: string;
  recipientEmail: string;
}

export interface EmailTrackingEvent {
  id: string;
  emailId: string;
  eventType: 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained';
  recipientEmail: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

/**
 * Generate tracking ID
 */
const generateTrackingId = (emailId: string, recipientEmail: string): string => {
  const hash = createHash('sha256');
  hash.update(`${emailId}:${recipientEmail}:${Date.now()}`);
  return hash.digest('hex').substring(0, 32);
};

/**
 * Create email tracking record
 */
export const createEmailTracking = async (params: {
  emailId: string;
  recipientEmail: string;
  subject: string;
  campaignId?: string;
}) => {
  const trackingId = generateTrackingId(params.emailId, params.recipientEmail);

  await dbQuery(
    `insert into email_tracking(
      id,
      email_id,
      recipient_email,
      subject,
      campaign_id,
      created_at
    ) values($1, $2, $3, $4, $5::uuid, now())`,
    [
      trackingId,
      params.emailId,
      params.recipientEmail,
      params.subject,
      params.campaignId || null,
    ]
  );

  return trackingId;
};

/**
 * Generate tracking pixel URL
 */
export const generateTrackingPixelUrl = (trackingId: string, baseUrl: string): string => {
  return `${baseUrl}/api/email-tracking/pixel/${trackingId}.png`;
};

/**
 * Generate click tracking URL
 */
export const generateClickTrackingUrl = (trackingId: string, originalUrl: string, baseUrl: string): string => {
  const encoded = Buffer.from(originalUrl).toString('base64url');
  return `${baseUrl}/api/email-tracking/click/${trackingId}/${encoded}`;
};

/**
 * Wrap links in email HTML with tracking URLs
 */
export const wrapLinksWithTracking = (html: string, trackingId: string, baseUrl: string): string => {
  // Match href attributes in anchor tags
  const linkRegex = /<a\s+([^>]*\s+)?href=["']([^"']+)["']([^>]*)>/gi;

  return html.replace(linkRegex, (match, before = '', url, after = '') => {
    // Skip if already a tracking URL or mailto/tel links
    if (url.includes('/email-tracking/') || url.startsWith('mailto:') || url.startsWith('tel:')) {
      return match;
    }

    const trackingUrl = generateClickTrackingUrl(trackingId, url, baseUrl);
    return `<a ${before}href="${trackingUrl}"${after}>`;
  });
};

/**
 * Insert tracking pixel into email HTML
 */
export const insertTrackingPixel = (html: string, trackingId: string, baseUrl: string): string => {
  const pixelUrl = generateTrackingPixelUrl(trackingId, baseUrl);
  const pixel = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;" />`;

  // Try to insert before closing body tag
  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixel}</body>`);
  }

  // Otherwise append to end
  return html + pixel;
};

/**
 * Record email tracking event
 */
export const recordTrackingEvent = async (params: {
  trackingId: string;
  eventType: 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained';
  metadata?: Record<string, any>;
}) => {
  const eventId = randomUUID();

  // Get email tracking info
  const trackingResult = await dbQuery(
    `select email_id, recipient_email, campaign_id from email_tracking where id = $1`,
    [params.trackingId]
  );

  if (trackingResult.rows.length === 0) {
    logger.warn('Tracking ID not found', { trackingId: params.trackingId });
    return null;
  }

  const tracking = trackingResult.rows[0];

  // Check if this is a duplicate open event (only count first open)
  if (params.eventType === 'opened') {
    const existingOpen = await dbQuery(
      `select id from email_tracking_events
       where tracking_id = $1 and event_type = 'opened'
       limit 1`,
      [params.trackingId]
    );

    if (existingOpen.rows.length > 0) {
      // Update last opened time but don't create new event
      await dbQuery(
        `update email_tracking
         set last_opened_at = now(), open_count = open_count + 1
         where id = $1`,
        [params.trackingId]
      );
      return null;
    }
  }

  // Record event
  await dbQuery(
    `insert into email_tracking_events(
      id,
      tracking_id,
      email_id,
      recipient_email,
      campaign_id,
      event_type,
      metadata,
      created_at
    ) values($1::uuid, $2, $3, $4, $5::uuid, $6, $7::jsonb, now())`,
    [
      eventId,
      params.trackingId,
      tracking.email_id,
      tracking.recipient_email,
      tracking.campaign_id || null,
      params.eventType,
      JSON.stringify(params.metadata || {}),
    ]
  );

  // Update tracking record
  if (params.eventType === 'opened') {
    await dbQuery(
      `update email_tracking
       set opened = true, first_opened_at = now(), last_opened_at = now(), open_count = 1
       where id = $1 and opened = false`,
      [params.trackingId]
    );
  } else if (params.eventType === 'clicked') {
    await dbQuery(
      `update email_tracking
       set clicked = true, first_clicked_at = coalesce(first_clicked_at, now()),
           last_clicked_at = now(), click_count = click_count + 1
       where id = $1`,
      [params.trackingId]
    );
  }

  return eventId;
};

/**
 * Get tracking statistics for an email
 */
export const getEmailTrackingStats = async (emailId: string) => {
  const result = await dbQuery(
    `select
      count(*)::int as total_sent,
      count(*) filter (where opened = true)::int as total_opened,
      count(*) filter (where clicked = true)::int as total_clicked,
      count(distinct recipient_email) filter (where opened = true)::int as unique_opens,
      count(distinct recipient_email) filter (where clicked = true)::int as unique_clicks,
      sum(open_count)::int as total_open_count,
      sum(click_count)::int as total_click_count
    from email_tracking
    where email_id = $1`,
    [emailId]
  );

  const stats = result.rows[0] || {
    total_sent: 0,
    total_opened: 0,
    total_clicked: 0,
    unique_opens: 0,
    unique_clicks: 0,
    total_open_count: 0,
    total_click_count: 0,
  };

  const totalSent = Number(stats.total_sent);
  const openRate = totalSent > 0 ? (Number(stats.total_opened) / totalSent) * 100 : 0;
  const clickRate = totalSent > 0 ? (Number(stats.total_clicked) / totalSent) * 100 : 0;
  const clickToOpenRate = Number(stats.total_opened) > 0
    ? (Number(stats.total_clicked) / Number(stats.total_opened)) * 100
    : 0;

  return {
    totalSent,
    totalOpened: Number(stats.total_opened),
    totalClicked: Number(stats.total_clicked),
    uniqueOpens: Number(stats.unique_opens),
    uniqueClicks: Number(stats.unique_clicks),
    totalOpenCount: Number(stats.total_open_count),
    totalClickCount: Number(stats.total_click_count),
    openRate,
    clickRate,
    clickToOpenRate,
  };
};

/**
 * Get tracking events for an email
 */
export const getEmailTrackingEvents = async (params: {
  emailId?: string;
  campaignId?: string;
  eventType?: string;
  limit?: number;
  offset?: number;
}) => {
  const limit = Math.max(1, Math.min(200, params.limit || 50));
  const offset = Math.max(0, params.offset || 0);

  let whereClause = 'where 1=1';
  const queryParams: any[] = [];
  let paramIndex = 1;

  if (params.emailId) {
    whereClause += ` and email_id = $${paramIndex}`;
    queryParams.push(params.emailId);
    paramIndex++;
  }

  if (params.campaignId) {
    whereClause += ` and campaign_id = $${paramIndex}::uuid`;
    queryParams.push(params.campaignId);
    paramIndex++;
  }

  if (params.eventType) {
    whereClause += ` and event_type = $${paramIndex}`;
    queryParams.push(params.eventType);
    paramIndex++;
  }

  queryParams.push(limit, offset);

  const result = await dbQuery(
    `select
      id,
      tracking_id,
      email_id,
      recipient_email,
      campaign_id,
      event_type,
      metadata,
      created_at
    from email_tracking_events
    ${whereClause}
    order by created_at desc
    limit $${paramIndex}
    offset $${paramIndex + 1}`,
    queryParams
  );

  const totalResult = await dbQuery(
    `select count(*)::int as total from email_tracking_events ${whereClause}`,
    queryParams.slice(0, -2)
  );

  return {
    items: result.rows.map(row => ({
      id: String(row.id),
      trackingId: String(row.tracking_id),
      emailId: String(row.email_id),
      recipientEmail: String(row.recipient_email),
      campaignId: row.campaign_id ? String(row.campaign_id) : null,
      eventType: String(row.event_type),
      metadata: row.metadata || {},
      createdAt: String(row.created_at),
    })),
    total: Number(totalResult.rows[0]?.total || 0),
  };
};

/**
 * Get click tracking details
 */
export const getClickTrackingDetails = async (trackingId: string) => {
  const result = await dbQuery(
    `select
      e.id,
      e.metadata->>'url' as url,
      e.metadata->>'userAgent' as user_agent,
      e.metadata->>'ipAddress' as ip_address,
      e.created_at
    from email_tracking_events e
    where e.tracking_id = $1 and e.event_type = 'clicked'
    order by e.created_at desc`,
    [trackingId]
  );

  return result.rows.map(row => ({
    id: String(row.id),
    url: String(row.url || ''),
    userAgent: String(row.user_agent || ''),
    ipAddress: String(row.ip_address || ''),
    createdAt: String(row.created_at),
  }));
};

/**
 * Get tracking analytics dashboard data
 */
export const getTrackingAnalytics = async (params: {
  campaignId?: string;
  startDate?: Date;
  endDate?: Date;
}) => {
  let whereClause = 'where 1=1';
  const queryParams: any[] = [];
  let paramIndex = 1;

  if (params.campaignId) {
    whereClause += ` and campaign_id = $${paramIndex}::uuid`;
    queryParams.push(params.campaignId);
    paramIndex++;
  }

  if (params.startDate) {
    whereClause += ` and created_at >= $${paramIndex}`;
    queryParams.push(params.startDate);
    paramIndex++;
  }

  if (params.endDate) {
    whereClause += ` and created_at <= $${paramIndex}`;
    queryParams.push(params.endDate);
    paramIndex++;
  }

  const result = await dbQuery(
    `select
      count(*)::int as total_sent,
      count(*) filter (where opened = true)::int as total_opened,
      count(*) filter (where clicked = true)::int as total_clicked,
      avg(extract(epoch from (first_opened_at - created_at)))::int as avg_time_to_open,
      avg(extract(epoch from (first_clicked_at - created_at)))::int as avg_time_to_click
    from email_tracking
    ${whereClause}`,
    queryParams
  );

  const stats = result.rows[0] || {
    total_sent: 0,
    total_opened: 0,
    total_clicked: 0,
    avg_time_to_open: 0,
    avg_time_to_click: 0,
  };

  const totalSent = Number(stats.total_sent);
  const openRate = totalSent > 0 ? (Number(stats.total_opened) / totalSent) * 100 : 0;
  const clickRate = totalSent > 0 ? (Number(stats.total_clicked) / totalSent) * 100 : 0;

  return {
    totalSent,
    totalOpened: Number(stats.total_opened),
    totalClicked: Number(stats.total_clicked),
    openRate,
    clickRate,
    avgTimeToOpen: Number(stats.avg_time_to_open || 0),
    avgTimeToClick: Number(stats.avg_time_to_click || 0),
  };
};
