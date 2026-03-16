import { dbQuery } from '../db.js';
import { logger } from '../logger.js';
import { normalizeText } from '../helpers/normalize.js';

export type ActivityType =
  | 'status_change'
  | 'comment'
  | 'file_upload'
  | 'file_delete'
  | 'assignment'
  | 'unassignment'
  | 'notification'
  | 'created'
  | 'updated'
  | 'deleted'
  | 'stage_change'
  | 'priority_change'
  | 'deadline_change'
  | 'field_change'
  | 'relation_added'
  | 'relation_removed';

export type ActivitySeverity = 'info' | 'warning' | 'error' | 'success';

export type EntityType =
  | 'tenant'
  | 'project'
  | 'installation'
  | 'service_request'
  | 'direction'
  | 'contract'
  | 'maintenance_item'
  | 'maintenance_plan'
  | 'access_request'
  | 'calendar_event'
  | 'sppz_journal_entry';

export interface ActivityLogEntry {
  id?: string;
  entityType: EntityType;
  entityId: string;
  activityType: ActivityType;
  actorUserId?: string;
  actorName?: string;
  severity?: ActivitySeverity;
  title: string;
  description?: string;
  metadata?: Record<string, any>;
  createdAt?: Date;
}

export interface ActivityLogFilter {
  entityType?: EntityType;
  entityId?: string;
  activityType?: ActivityType;
  actorUserId?: string;
  severity?: ActivitySeverity;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Log an activity event to the unified activity timeline
 */
export async function logActivity(entry: ActivityLogEntry): Promise<string | null> {
  try {
    const result = await dbQuery(
      `insert into entity_activity_log(
        entity_type,
        entity_id,
        activity_type,
        actor_user_id,
        actor_name,
        severity,
        title,
        description,
        metadata,
        created_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning id::text`,
      [
        entry.entityType,
        entry.entityId,
        entry.activityType,
        entry.actorUserId || null,
        normalizeText(entry.actorName) || 'Система',
        entry.severity || 'info',
        entry.title,
        normalizeText(entry.description) || '',
        JSON.stringify(entry.metadata || {}),
        entry.createdAt || new Date(),
      ]
    );

    return result.rows[0]?.id || null;
  } catch (error) {
    logger.error('Failed to log activity', { error, entry });
    return null;
  }
}

/**
 * Log multiple activity events in a batch
 */
export async function logActivitiesBatch(entries: ActivityLogEntry[]): Promise<number> {
  if (entries.length === 0) {
    return 0;
  }

  try {
    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const entry of entries) {
      placeholders.push(
        `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9})`
      );
      values.push(
        entry.entityType,
        entry.entityId,
        entry.activityType,
        entry.actorUserId || null,
        normalizeText(entry.actorName) || 'Система',
        entry.severity || 'info',
        entry.title,
        normalizeText(entry.description) || '',
        JSON.stringify(entry.metadata || {}),
        entry.createdAt || new Date()
      );
      paramIndex += 10;
    }

    const result = await dbQuery(
      `insert into entity_activity_log(
        entity_type,
        entity_id,
        activity_type,
        actor_user_id,
        actor_name,
        severity,
        title,
        description,
        metadata,
        created_at
      ) values ${placeholders.join(', ')}`,
      values
    );

    return result.rowCount || 0;
  } catch (error) {
    logger.error('Failed to log activities batch', { error, count: entries.length });
    return 0;
  }
}

/**
 * Get activity log entries with filtering
 */
export async function getActivityLog(filter: ActivityLogFilter): Promise<ActivityLogEntry[]> {
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

  if (filter.activityType) {
    conditions.push(`activity_type = $${paramIndex}`);
    params.push(filter.activityType);
    paramIndex++;
  }

  if (filter.actorUserId) {
    conditions.push(`actor_user_id = $${paramIndex}`);
    params.push(filter.actorUserId);
    paramIndex++;
  }

  if (filter.severity) {
    conditions.push(`severity = $${paramIndex}`);
    params.push(filter.severity);
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

  const whereClause = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
  const limit = filter.limit || 100;
  const offset = filter.offset || 0;

  const result = await dbQuery(
    `select
      id::text,
      entity_type,
      entity_id,
      activity_type,
      actor_user_id::text,
      actor_name,
      severity,
      title,
      description,
      metadata,
      created_at
    from entity_activity_log
    ${whereClause}
    order by created_at desc
    limit $${paramIndex} offset $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  return result.rows.map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    activityType: row.activity_type,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    severity: row.severity,
    title: row.title,
    description: row.description,
    metadata: row.metadata,
    createdAt: row.created_at,
  }));
}

/**
 * Get activity count for an entity
 */
export async function getActivityCount(entityType: EntityType, entityId: string): Promise<number> {
  const result = await dbQuery(
    `select count(*) as count
    from entity_activity_log
    where entity_type = $1 and entity_id = $2`,
    [entityType, entityId]
  );

  return parseInt(result.rows[0]?.count || '0', 10);
}

/**
 * Helper: Log status change
 */
export async function logStatusChange(
  entityType: EntityType,
  entityId: string,
  oldStatus: string,
  newStatus: string,
  actorUserId?: string,
  actorName?: string
): Promise<string | null> {
  return logActivity({
    entityType,
    entityId,
    activityType: 'status_change',
    actorUserId,
    actorName,
    severity: 'info',
    title: `Статус изменён: ${oldStatus} → ${newStatus}`,
    description: `Статус изменён с "${oldStatus}" на "${newStatus}"`,
    metadata: { oldStatus, newStatus },
  });
}

/**
 * Helper: Log comment
 */
export async function logComment(
  entityType: EntityType,
  entityId: string,
  commentText: string,
  actorUserId?: string,
  actorName?: string,
  visibility?: string
): Promise<string | null> {
  return logActivity({
    entityType,
    entityId,
    activityType: 'comment',
    actorUserId,
    actorName,
    severity: 'info',
    title: 'Добавлен комментарий',
    description: commentText.substring(0, 200),
    metadata: { commentText, visibility },
  });
}

/**
 * Helper: Log file upload
 */
export async function logFileUpload(
  entityType: EntityType,
  entityId: string,
  fileName: string,
  fileSize?: number,
  actorUserId?: string,
  actorName?: string
): Promise<string | null> {
  return logActivity({
    entityType,
    entityId,
    activityType: 'file_upload',
    actorUserId,
    actorName,
    severity: 'success',
    title: `Загружен файл: ${fileName}`,
    description: `Файл "${fileName}" добавлен`,
    metadata: { fileName, fileSize },
  });
}

/**
 * Helper: Log assignment
 */
export async function logAssignment(
  entityType: EntityType,
  entityId: string,
  assignedUserId: string,
  assignedUserName: string,
  actorUserId?: string,
  actorName?: string
): Promise<string | null> {
  return logActivity({
    entityType,
    entityId,
    activityType: 'assignment',
    actorUserId,
    actorName,
    severity: 'info',
    title: `Назначен исполнитель: ${assignedUserName}`,
    description: `Пользователь "${assignedUserName}" назначен исполнителем`,
    metadata: { assignedUserId, assignedUserName },
  });
}

/**
 * Helper: Log entity creation
 */
export async function logEntityCreated(
  entityType: EntityType,
  entityId: string,
  entityTitle: string,
  actorUserId?: string,
  actorName?: string
): Promise<string | null> {
  return logActivity({
    entityType,
    entityId,
    activityType: 'created',
    actorUserId,
    actorName,
    severity: 'success',
    title: `Создано: ${entityTitle}`,
    description: `Создан новый объект "${entityTitle}"`,
    metadata: { entityTitle },
  });
}

/**
 * Helper: Log field change
 */
export async function logFieldChange(
  entityType: EntityType,
  entityId: string,
  fieldName: string,
  oldValue: any,
  newValue: any,
  actorUserId?: string,
  actorName?: string
): Promise<string | null> {
  return logActivity({
    entityType,
    entityId,
    activityType: 'field_change',
    actorUserId,
    actorName,
    severity: 'info',
    title: `Изменено поле: ${fieldName}`,
    description: `Поле "${fieldName}" изменено`,
    metadata: { fieldName, oldValue, newValue },
  });
}

/**
 * Delete activity log entries for an entity (for cleanup/GDPR)
 */
export async function deleteActivityLog(entityType: EntityType, entityId: string): Promise<number> {
  try {
    const result = await dbQuery(
      `delete from entity_activity_log
      where entity_type = $1 and entity_id = $2`,
      [entityType, entityId]
    );

    return result.rowCount || 0;
  } catch (error) {
    logger.error('Failed to delete activity log', { error, entityType, entityId });
    return 0;
  }
}
