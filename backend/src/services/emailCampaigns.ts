import { randomUUID } from 'node:crypto';
import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';
import { enqueueEmail } from './mailService.js';
import { createEmailTracking, insertTrackingPixel, wrapLinksWithTracking } from './emailTracking.js';
import { appConfig } from '../config.js';

/**
 * Email Campaigns Service
 * Handles bulk email sending, segmentation, A/B testing, campaign analytics
 */

export interface EmailCampaign {
  id: string;
  name: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  templateId?: string;
  htmlContent: string;
  textContent: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'cancelled';
  segmentId?: string;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  openedCount: number;
  clickedCount: number;
  unsubscribedCount: number;
  bouncedCount: number;
  enableTracking: boolean;
  enableAbTesting: boolean;
  abTestVariants?: AbTestVariant[];
  metadata?: Record<string, any>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AbTestVariant {
  id: string;
  name: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  percentage: number;
  sentCount: number;
  openedCount: number;
  clickedCount: number;
}

export interface CampaignSegment {
  id: string;
  name: string;
  description?: string;
  filters: SegmentFilter[];
  recipientCount: number;
  createdAt: string;
}

export interface SegmentFilter {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'in' | 'not_in';
  value: any;
}

export interface CampaignRecipient {
  id: string;
  campaignId: string;
  email: string;
  name?: string;
  status: 'pending' | 'sent' | 'failed' | 'bounced' | 'unsubscribed';
  variantId?: string;
  sentAt?: string;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Create email campaign
 */
export const createCampaign = async (params: {
  name: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  templateId?: string;
  htmlContent: string;
  textContent: string;
  segmentId?: string;
  scheduledAt?: Date;
  enableTracking?: boolean;
  enableAbTesting?: boolean;
  abTestVariants?: Omit<AbTestVariant, 'id' | 'sentCount' | 'openedCount' | 'clickedCount'>[];
  metadata?: Record<string, any>;
  createdBy: string;
}) => {
  const campaignId = randomUUID();

  await dbQuery(
    `insert into email_campaigns(
      id,
      name,
      subject,
      from_name,
      from_email,
      reply_to,
      template_id,
      html_content,
      text_content,
      status,
      segment_id,
      scheduled_at,
      enable_tracking,
      enable_ab_testing,
      ab_test_variants,
      metadata,
      created_by,
      created_at,
      updated_at
    ) values($1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8, $9, 'draft', $10::uuid, $11, $12, $13, $14::jsonb, $15::jsonb, $16::uuid, now(), now())`,
    [
      campaignId,
      params.name,
      params.subject,
      params.fromName,
      params.fromEmail,
      params.replyTo || null,
      params.templateId || null,
      params.htmlContent,
      params.textContent,
      params.segmentId || null,
      params.scheduledAt || null,
      params.enableTracking !== false,
      params.enableAbTesting || false,
      params.abTestVariants ? JSON.stringify(params.abTestVariants.map((v, i) => ({
        id: randomUUID(),
        ...v,
        sentCount: 0,
        openedCount: 0,
        clickedCount: 0,
      }))) : null,
      JSON.stringify(params.metadata || {}),
      params.createdBy,
    ]
  );

  return campaignId;
};

/**
 * Update campaign
 */
export const updateCampaign = async (campaignId: string, params: Partial<EmailCampaign>) => {
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (params.name !== undefined) {
    updates.push(`name = $${paramIndex}`);
    values.push(params.name);
    paramIndex++;
  }

  if (params.subject !== undefined) {
    updates.push(`subject = $${paramIndex}`);
    values.push(params.subject);
    paramIndex++;
  }

  if (params.htmlContent !== undefined) {
    updates.push(`html_content = $${paramIndex}`);
    values.push(params.htmlContent);
    paramIndex++;
  }

  if (params.textContent !== undefined) {
    updates.push(`text_content = $${paramIndex}`);
    values.push(params.textContent);
    paramIndex++;
  }

  if (params.status !== undefined) {
    updates.push(`status = $${paramIndex}`);
    values.push(params.status);
    paramIndex++;
  }

  if (params.scheduledAt !== undefined) {
    updates.push(`scheduled_at = $${paramIndex}`);
    values.push(params.scheduledAt);
    paramIndex++;
  }

  if (updates.length === 0) {
    return;
  }

  updates.push(`updated_at = now()`);
  values.push(campaignId);

  await dbQuery(
    `update email_campaigns set ${updates.join(', ')} where id = $${paramIndex}::uuid`,
    values
  );
};

/**
 * Get campaign by ID
 */
export const getCampaignById = async (campaignId: string): Promise<EmailCampaign | null> => {
  const result = await dbQuery(
    `select
      c.*,
      (select count(*)::int from email_campaign_recipients where campaign_id = c.id) as total_recipients,
      (select count(*)::int from email_campaign_recipients where campaign_id = c.id and status = 'sent') as sent_count,
      (select count(*)::int from email_campaign_recipients where campaign_id = c.id and status = 'failed') as failed_count,
      (select count(*)::int from email_tracking where campaign_id = c.id and opened = true) as opened_count,
      (select count(*)::int from email_tracking where campaign_id = c.id and clicked = true) as clicked_count,
      (select count(*)::int from email_campaign_recipients where campaign_id = c.id and status = 'unsubscribed') as unsubscribed_count,
      (select count(*)::int from email_campaign_recipients where campaign_id = c.id and status = 'bounced') as bounced_count
    from email_campaigns c
    where c.id = $1::uuid`,
    [campaignId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: String(row.id),
    name: String(row.name),
    subject: String(row.subject),
    fromName: String(row.from_name),
    fromEmail: String(row.from_email),
    replyTo: row.reply_to ? String(row.reply_to) : undefined,
    templateId: row.template_id ? String(row.template_id) : undefined,
    htmlContent: String(row.html_content),
    textContent: String(row.text_content),
    status: String(row.status) as any,
    segmentId: row.segment_id ? String(row.segment_id) : undefined,
    scheduledAt: row.scheduled_at ? String(row.scheduled_at) : undefined,
    startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    totalRecipients: Number(row.total_recipients),
    sentCount: Number(row.sent_count),
    failedCount: Number(row.failed_count),
    openedCount: Number(row.opened_count),
    clickedCount: Number(row.clicked_count),
    unsubscribedCount: Number(row.unsubscribed_count),
    bouncedCount: Number(row.bounced_count),
    enableTracking: Boolean(row.enable_tracking),
    enableAbTesting: Boolean(row.enable_ab_testing),
    abTestVariants: row.ab_test_variants || undefined,
    metadata: row.metadata || {},
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
};

/**
 * List campaigns
 */
export const listCampaigns = async (params: {
  status?: string[];
  limit?: number;
  offset?: number;
}) => {
  const limit = Math.max(1, Math.min(200, params.limit || 50));
  const offset = Math.max(0, params.offset || 0);

  let whereClause = 'where 1=1';
  const queryParams: any[] = [];
  let paramIndex = 1;

  if (params.status && params.status.length > 0) {
    whereClause += ` and c.status = any($${paramIndex}::text[])`;
    queryParams.push(params.status);
    paramIndex++;
  }

  queryParams.push(limit, offset);

  const result = await dbQuery(
    `select
      c.*,
      (select count(*)::int from email_campaign_recipients where campaign_id = c.id) as total_recipients,
      (select count(*)::int from email_campaign_recipients where campaign_id = c.id and status = 'sent') as sent_count
    from email_campaigns c
    ${whereClause}
    order by c.created_at desc
    limit $${paramIndex}
    offset $${paramIndex + 1}`,
    queryParams
  );

  const totalResult = await dbQuery(
    `select count(*)::int as total from email_campaigns c ${whereClause}`,
    queryParams.slice(0, -2)
  );

  return {
    items: result.rows.map(row => ({
      id: String(row.id),
      name: String(row.name),
      subject: String(row.subject),
      status: String(row.status),
      totalRecipients: Number(row.total_recipients),
      sentCount: Number(row.sent_count),
      scheduledAt: row.scheduled_at ? String(row.scheduled_at) : undefined,
      createdAt: String(row.created_at),
    })),
    total: Number(totalResult.rows[0]?.total || 0),
  };
};

/**
 * Add recipients to campaign
 */
export const addCampaignRecipients = async (campaignId: string, recipients: Array<{
  email: string;
  name?: string;
  metadata?: Record<string, any>;
}>) => {
  const values: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  for (const recipient of recipients) {
    const recipientId = randomUUID();
    values.push(`($${paramIndex}::uuid, $${paramIndex + 1}::uuid, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}::jsonb, 'pending')`);
    params.push(recipientId, campaignId, recipient.email, recipient.name || null, JSON.stringify(recipient.metadata || {}));
    paramIndex += 5;
  }

  if (values.length === 0) {
    return 0;
  }

  const result = await dbQuery(
    `insert into email_campaign_recipients(id, campaign_id, email, name, metadata, status)
     values ${values.join(', ')}
     on conflict (campaign_id, email) do nothing`,
    params
  );

  return result.rowCount || 0;
};

/**
 * Start campaign
 */
export const startCampaign = async (campaignId: string) => {
  await dbQuery(
    `update email_campaigns
     set status = 'sending', started_at = now(), updated_at = now()
     where id = $1::uuid and status in ('draft', 'scheduled', 'paused')`,
    [campaignId]
  );

  // Process campaign in background
  processCampaignBatch(campaignId).catch(error => {
    logger.error('Campaign processing failed', { campaignId, error: serializeError(error) });
  });
};

/**
 * Process campaign batch
 */
export const processCampaignBatch = async (campaignId: string, batchSize = 50) => {
  const campaign = await getCampaignById(campaignId);
  if (!campaign || campaign.status !== 'sending') {
    return 0;
  }

  // Get pending recipients
  const recipients = await dbQuery(
    `select id, email, name, variant_id, metadata
     from email_campaign_recipients
     where campaign_id = $1::uuid and status = 'pending'
     order by created_at
     limit $2`,
    [campaignId, batchSize]
  );

  if (recipients.rows.length === 0) {
    // Campaign complete
    await dbQuery(
      `update email_campaigns
       set status = 'sent', completed_at = now(), updated_at = now()
       where id = $1::uuid`,
      [campaignId]
    );
    return 0;
  }

  const baseUrl = appConfig.appUrl || 'http://localhost:3000';

  // Send emails
  for (const recipient of recipients.rows) {
    try {
      // Determine variant for A/B testing
      let subject = campaign.subject;
      let htmlContent = campaign.htmlContent;
      let textContent = campaign.textContent;

      if (campaign.enableAbTesting && campaign.abTestVariants && campaign.abTestVariants.length > 0) {
        // Select variant based on percentage
        const random = Math.random() * 100;
        let cumulative = 0;
        for (const variant of campaign.abTestVariants) {
          cumulative += variant.percentage;
          if (random <= cumulative) {
            subject = variant.subject;
            htmlContent = variant.htmlContent;
            textContent = variant.textContent;
            await dbQuery(
              `update email_campaign_recipients set variant_id = $1 where id = $2::uuid`,
              [variant.id, recipient.id]
            );
            break;
          }
        }
      }

      // Personalize content
      const personalizedHtml = personalizeContent(htmlContent, {
        name: recipient.name || recipient.email,
        email: recipient.email,
        ...recipient.metadata,
      });

      const personalizedText = personalizeContent(textContent, {
        name: recipient.name || recipient.email,
        email: recipient.email,
        ...recipient.metadata,
      });

      // Add tracking
      let finalHtml = personalizedHtml;
      let finalText = personalizedText;

      if (campaign.enableTracking) {
        const trackingId = await createEmailTracking({
          emailId: recipient.id,
          recipientEmail: recipient.email,
          subject,
          campaignId,
        });

        finalHtml = wrapLinksWithTracking(personalizedHtml, trackingId, baseUrl);
        finalHtml = insertTrackingPixel(finalHtml, trackingId, baseUrl);

        // Add unsubscribe link
        const unsubscribeUrl = `${baseUrl}/unsubscribe/${trackingId}`;
        finalHtml = finalHtml.replace('</body>', `<p style="font-size:11px;color:#999;text-align:center;margin-top:40px;"><a href="${unsubscribeUrl}" style="color:#999;">Отписаться от рассылки</a></p></body>`);
        finalText += `\n\nОтписаться от рассылки: ${unsubscribeUrl}`;
      }

      // Queue email
      await enqueueEmail({
        to: recipient.email,
        from: `${campaign.fromName} <${campaign.fromEmail}>`,
        subject,
        text: finalText,
        html: finalHtml,
        metadata: {
          campaignId,
          recipientId: recipient.id,
        },
      });

      // Mark as sent
      await dbQuery(
        `update email_campaign_recipients
         set status = 'sent', sent_at = now()
         where id = $1::uuid`,
        [recipient.id]
      );

    } catch (error) {
      logger.error('Failed to send campaign email', {
        campaignId,
        recipientId: recipient.id,
        error: serializeError(error),
      });

      await dbQuery(
        `update email_campaign_recipients
         set status = 'failed', error = $2
         where id = $1::uuid`,
        [recipient.id, String((error as Error).message)]
      );
    }
  }

  return recipients.rows.length;
};

/**
 * Personalize email content with variables
 */
const personalizeContent = (content: string, variables: Record<string, any>): string => {
  let result = content;

  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    result = result.replace(regex, String(value || ''));
  }

  return result;
};

/**
 * Create campaign segment
 */
export const createSegment = async (params: {
  name: string;
  description?: string;
  filters: SegmentFilter[];
  createdBy: string;
}) => {
  const segmentId = randomUUID();

  await dbQuery(
    `insert into email_campaign_segments(
      id,
      name,
      description,
      filters,
      created_by,
      created_at
    ) values($1::uuid, $2, $3, $4::jsonb, $5::uuid, now())`,
    [
      segmentId,
      params.name,
      params.description || null,
      JSON.stringify(params.filters),
      params.createdBy,
    ]
  );

  return segmentId;
};

/**
 * Get campaign analytics
 */
export const getCampaignAnalytics = async (campaignId: string) => {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) {
    return null;
  }

  const openRate = campaign.totalRecipients > 0
    ? (campaign.openedCount / campaign.totalRecipients) * 100
    : 0;

  const clickRate = campaign.totalRecipients > 0
    ? (campaign.clickedCount / campaign.totalRecipients) * 100
    : 0;

  const clickToOpenRate = campaign.openedCount > 0
    ? (campaign.clickedCount / campaign.openedCount) * 100
    : 0;

  const bounceRate = campaign.totalRecipients > 0
    ? (campaign.bouncedCount / campaign.totalRecipients) * 100
    : 0;

  const unsubscribeRate = campaign.totalRecipients > 0
    ? (campaign.unsubscribedCount / campaign.totalRecipients) * 100
    : 0;

  return {
    ...campaign,
    openRate,
    clickRate,
    clickToOpenRate,
    bounceRate,
    unsubscribeRate,
  };
};

/**
 * Handle unsubscribe
 */
export const handleUnsubscribe = async (trackingId: string) => {
  const result = await dbQuery(
    `update email_campaign_recipients
     set status = 'unsubscribed'
     where id = (select email_id from email_tracking where id = $1)
     returning campaign_id, email`,
    [trackingId]
  );

  if (result.rows.length > 0) {
    const { campaign_id, email } = result.rows[0];
    logger.info('User unsubscribed from campaign', { campaignId: campaign_id, email });
  }
};
