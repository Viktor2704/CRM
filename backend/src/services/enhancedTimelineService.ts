import { dbQuery } from '../db.js';
import { logger } from '../logger.js';
import { normalizeText } from '../helpers/normalize.js';

export interface EnhancedActivityLogEntry {
  id?: string;
  entityType: string;
  entityId: string;
  activityType: string;
  activitySubtype?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  actorUserId?: string;
  actorName?: string;
  severity?: string;
  title: string;
  description?: string;
  metadata?: Record<string, any>;
  isPinned?: boolean;
  tags?: string[];
  createdAt?: Date;
}

export interface TimelineFilter {
  entityType?: string;
  entityId?: string;
  activityTypes?: string[];
  activitySubtypes?: string[];
  severity?: string[];
  tags?: string[];
  isPinned?: boolean;
  searchQuery?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Get unified timeline across all entities with advanced filtering
 */
export async function getUnifiedTimeline(filter: TimelineFilter): Promise<any[]> {
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (filter.entityType) {
    conditions.push(`entity_type = $${paramIndex}`);
    params.push(filter.entityType);
    paramIndex++;
  }

  if (filter.entityId) {
    conditions.push(`entity_id = $${paramIndex}`);
    params.push(filter.entityId);
    paramIndex++;
  }

  if (filter.activityTypes && filter.activityTypes.length > 0) {
    conditions.push(`activity_type = ANY($${paramIndex})`);
    params.push(filter.activityTypes);
    paramIndex++;
  }

  if (filter.activitySubtypes && filter.activitySubtypes.length > 0) {
    conditions.push(`activity_subtype = ANY($${paramIndex})`);
    params.push(filter.activitySubtypes);
    paramIndex++;
  }

  if (filter.severity && filter.severity.length > 0) {
    conditions.push(`severity = ANY($${paramIndex})`);
    params.push(filter.severity);
    paramIndex++;
  }

  if (filter.tags && filter.tags.length > 0) {
    conditions.push(`tags && $${paramIndex}`);
    params.push(filter.tags);
    paramIndex++;
  }

  if (filter.isPinned !== undefined) {
    conditions.push(`is_pinned = $${paramIndex}`);
    params.push(filter.isPinned);
    paramIndex++;
  }

  if (filter.searchQuery) {
    conditions.push(`search_vector @@ plainto_tsquery('russian', $${paramIndex})`);
    params.push(filter.searchQuery);
    paramIndex++;
  }

  if (filter.fromDate) {
    conditions.push(`created_at >= $${paramIndex}`);
    params.push(filter.fromDate);
    paramIndex++;
  }

  if (filter.toDate) {
    conditions.push(`created_at <= $${paramIndex}`);
    params.push(filter.toDate);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit || 100;
  const offset = filter.offset || 0;

  const result = await dbQuery(
    `SELECT
      al.id::text,
      al.entity_type,
      al.entity_id::text,
      al.activity_type,
      al.activity_subtype,
      al.related_entity_type,
      al.related_entity_id::text,
      al.actor_user_id::text,
      al.actor_name,
      al.severity,
      al.title,
      al.description,
      al.metadata,
      al.is_pinned,
      al.tags,
      al.created_at,
      -- Include email data if available
      ae.subject as email_subject,
      ae.from_address as email_from,
      ae.to_addresses as email_to,
      ae.body_preview as email_preview,
      ae.has_attachments as email_has_attachments,
      -- Include attachment count
      (SELECT COUNT(*) FROM activity_attachments aa WHERE aa.activity_id = al.id) as attachment_count
    FROM entity_activity_log al
    LEFT JOIN activity_emails ae ON ae.activity_id = al.id
    ${whereClause}
    ORDER BY al.is_pinned DESC, al.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  return result.rows.map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    activityType: row.activity_type,
    activitySubtype: row.activity_subtype,
    relatedEntityType: row.related_entity_type,
    relatedEntityId: row.related_entity_id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    severity: row.severity,
    title: row.title,
    description: row.description,
    metadata: row.metadata,
    isPinned: row.is_pinned,
    tags: row.tags,
    createdAt: row.created_at,
    email: row.email_subject
      ? {
          subject: row.email_subject,
          from: row.email_from,
          to: row.email_to,
          preview: row.email_preview,
          hasAttachments: row.email_has_attachments,
        }
      : null,
    attachmentCount: parseInt(row.attachment_count || '0', 10),
  }));
}

/**
 * Create enhanced activity log entry
 */
export async function createEnhancedActivity(entry: EnhancedActivityLogEntry): Promise<string | null> {
  try {
    const result = await dbQuery(
      `INSERT INTO entity_activity_log (
        entity_type,
        entity_id,
        activity_type,
        activity_subtype,
        related_entity_type,
        related_entity_id,
        actor_user_id,
        actor_name,
        severity,
        title,
        description,
        metadata,
        is_pinned,
        tags,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id::text`,
      [
        entry.entityType,
        entry.entityId,
        entry.activityType,
        entry.activitySubtype || null,
        entry.relatedEntityType || null,
        entry.relatedEntityId || null,
        entry.actorUserId || null,
        normalizeText(entry.actorName) || 'Система',
        entry.severity || 'info',
        entry.title,
        normalizeText(entry.description) || '',
        JSON.stringify(entry.metadata || {}),
        entry.isPinned || false,
        entry.tags || [],
        entry.createdAt || new Date(),
      ]
    );

    return result.rows[0]?.id || null;
  } catch (error) {
    logger.error('Failed to create enhanced activity', { error, entry });
    return null;
  }
}

/**
 * Pin/unpin activity
 */
export async function toggleActivityPin(activityId: string, isPinned: boolean): Promise<boolean> {
  try {
    const result = await dbQuery(
      `UPDATE entity_activity_log
      SET is_pinned = $1
      WHERE id = $2
      RETURNING id`,
      [isPinned, activityId]
    );

    return result.rows.length > 0;
  } catch (error) {
    logger.error('Failed to toggle activity pin', { error, activityId, isPinned });
    return false;
  }
}

/**
 * Update activity tags
 */
export async function updateActivityTags(activityId: string, tags: string[]): Promise<boolean> {
  try {
    const result = await dbQuery(
      `UPDATE entity_activity_log
      SET tags = $1
      WHERE id = $2
      RETURNING id`,
      [tags, activityId]
    );

    return result.rows.length > 0;
  } catch (error) {
    logger.error('Failed to update activity tags', { error, activityId, tags });
    return false;
  }
}

/**
 * Update activity inline
 */
export async function updateActivityInline(
  activityId: string,
  updates: {
    title?: string;
    description?: string;
    severity?: string;
    metadata?: Record<string, any>;
  }
): Promise<boolean> {
  const setClauses: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (updates.title !== undefined) {
    setClauses.push(`title = $${paramIndex}`);
    params.push(updates.title);
    paramIndex++;
  }

  if (updates.description !== undefined) {
    setClauses.push(`description = $${paramIndex}`);
    params.push(normalizeText(updates.description));
    paramIndex++;
  }

  if (updates.severity !== undefined) {
    setClauses.push(`severity = $${paramIndex}`);
    params.push(updates.severity);
    paramIndex++;
  }

  if (updates.metadata !== undefined) {
    setClauses.push(`metadata = $${paramIndex}`);
    params.push(JSON.stringify(updates.metadata));
    paramIndex++;
  }

  if (setClauses.length === 0) {
    return false;
  }

  params.push(activityId);

  try {
    const result = await dbQuery(
      `UPDATE entity_activity_log
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id`,
      params
    );

    return result.rows.length > 0;
  } catch (error) {
    logger.error('Failed to update activity inline', { error, activityId, updates });
    return false;
  }
}

/**
 * Get activity statistics
 */
export async function getActivityStatistics(
  entityType?: string,
  entityId?: string,
  fromDate?: Date,
  toDate?: Date
): Promise<any> {
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (entityType) {
    conditions.push(`entity_type = $${paramIndex}`);
    params.push(entityType);
    paramIndex++;
  }

  if (entityId) {
    conditions.push(`entity_id = $${paramIndex}`);
    params.push(entityId);
    paramIndex++;
  }

  if (fromDate) {
    conditions.push(`created_at >= $${paramIndex}`);
    params.push(fromDate);
    paramIndex++;
  }

  if (toDate) {
    conditions.push(`created_at <= $${paramIndex}`);
    params.push(toDate);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await dbQuery(
    `SELECT
      COUNT(*) as total_activities,
      COUNT(DISTINCT entity_type) as entity_types_count,
      COUNT(DISTINCT entity_id) as entities_count,
      COUNT(DISTINCT actor_user_id) as actors_count,
      jsonb_object_agg(activity_type, activity_count) as activities_by_type,
      jsonb_object_agg(severity, severity_count) as activities_by_severity
    FROM (
      SELECT
        entity_type,
        entity_id,
        actor_user_id,
        activity_type,
        COUNT(*) as activity_count,
        severity,
        COUNT(*) as severity_count
      FROM entity_activity_log
      ${whereClause}
      GROUP BY entity_type, entity_id, actor_user_id, activity_type, severity
    ) sub`,
    params
  );

  return result.rows[0] || {};
}

/**
 * Get activity templates
 */
export async function getActivityTemplates(activityType?: string): Promise<any[]> {
  const whereClause = activityType ? 'WHERE activity_type = $1 AND is_public = true' : 'WHERE is_public = true';
  const params = activityType ? [activityType] : [];

  const result = await dbQuery(
    `SELECT
      id::text,
      name,
      description,
      activity_type,
      activity_subtype,
      title_template,
      description_template,
      metadata_template,
      severity
    FROM activity_templates
    ${whereClause}
    ORDER BY name`,
    params
  );

  return result.rows;
}

/**
 * Create activity from template
 */
export async function createActivityFromTemplate(
  templateId: string,
  entityType: string,
  entityId: string,
  variables: Record<string, any>,
  actorUserId?: string,
  actorName?: string
): Promise<string | null> {
  // Get template
  const templateResult = await dbQuery(
    `SELECT * FROM activity_templates WHERE id = $1`,
    [templateId]
  );

  if (templateResult.rows.length === 0) {
    return null;
  }

  const template = templateResult.rows[0];

  // Replace variables in templates
  let title = template.title_template;
  let description = template.description_template || '';
  let metadata = template.metadata_template || {};

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    title = title.replace(new RegExp(placeholder, 'g'), String(value));
    description = description.replace(new RegExp(placeholder, 'g'), String(value));
  }

  // Create activity
  return createEnhancedActivity({
    entityType,
    entityId,
    activityType: template.activity_type,
    activitySubtype: template.activity_subtype,
    actorUserId,
    actorName,
    severity: template.severity,
    title,
    description,
    metadata: { ...metadata, ...variables },
  });
}

/**
 * Add attachment to activity
 */
export async function addActivityAttachment(
  activityId: string,
  fileId: string
): Promise<boolean> {
  try {
    await dbQuery(
      `INSERT INTO activity_attachments (activity_id, file_id)
      VALUES ($1, $2)
      ON CONFLICT (activity_id, file_id) DO NOTHING`,
      [activityId, fileId]
    );
    return true;
  } catch (error) {
    logger.error('Failed to add activity attachment', { error, activityId, fileId });
    return false;
  }
}

/**
 * Get activity attachments
 */
export async function getActivityAttachments(activityId: string): Promise<any[]> {
  const result = await dbQuery(
    `SELECT
      aa.id::text,
      aa.activity_id::text,
      aa.file_id::text,
      aa.created_at,
      uf.filename,
      uf.mime_type,
      uf.size_bytes
    FROM activity_attachments aa
    JOIN uploaded_files uf ON uf.id = aa.file_id
    WHERE aa.activity_id = $1
    ORDER BY aa.created_at DESC`,
    [activityId]
  );

  return result.rows;
}
