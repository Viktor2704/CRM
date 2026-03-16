import { Request } from 'express';
import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';

export interface AuditLogEntry {
  userId?: string;
  userEmail?: string;
  userRole?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestMethod?: string;
  requestPath?: string;
  details?: Record<string, any>;
  status?: 'success' | 'failure' | 'error';
  errorMessage?: string;
}

export interface AuditLogQuery {
  userId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

/**
 * Log an audit entry for a sensitive operation
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    await dbQuery(
      `insert into audit_log (
        user_id, user_email, user_role, action, resource_type, resource_id,
        ip_address, user_agent, request_method, request_path,
        details, status, error_message
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        entry.userId || null,
        entry.userEmail || null,
        entry.userRole || null,
        entry.action,
        entry.resourceType,
        entry.resourceId || null,
        entry.ipAddress || null,
        entry.userAgent || null,
        entry.requestMethod || null,
        entry.requestPath || null,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.status || 'success',
        entry.errorMessage || null,
      ]
    );
  } catch (error) {
    // Log error but don't throw - audit logging should not break the main operation
    logger.error('Failed to write audit log', {
      entry,
      error: serializeError(error),
    });
  }
}

/**
 * Helper to extract request metadata for audit logging
 */
export function extractRequestMetadata(request: Request): Pick<AuditLogEntry, 'ipAddress' | 'userAgent' | 'requestMethod' | 'requestPath'> {
  return {
    ipAddress: (request.ip || request.socket.remoteAddress || '').replace(/^::ffff:/, ''),
    userAgent: request.get('user-agent') || undefined,
    requestMethod: request.method,
    requestPath: request.path,
  };
}

/**
 * Helper to create audit log entry from authenticated request
 */
export function createAuditEntry(
  request: Request,
  action: string,
  resourceType: string,
  resourceId?: string,
  details?: Record<string, any>
): AuditLogEntry {
  const authUser = (request as any).authUser;

  return {
    userId: authUser?.id,
    userRole: authUser?.role,
    action,
    resourceType,
    resourceId,
    ...extractRequestMetadata(request),
    details,
  };
}

/**
 * Query audit logs with filters
 */
export async function queryAuditLogs(query: AuditLogQuery) {
  const conditions: string[] = ['1=1'];
  const values: any[] = [];
  let paramIndex = 1;

  if (query.userId) {
    conditions.push(`user_id = $${paramIndex++}`);
    values.push(query.userId);
  }

  if (query.action) {
    conditions.push(`action = $${paramIndex++}`);
    values.push(query.action);
  }

  if (query.resourceType) {
    conditions.push(`resource_type = $${paramIndex++}`);
    values.push(query.resourceType);
  }

  if (query.resourceId) {
    conditions.push(`resource_id = $${paramIndex++}`);
    values.push(query.resourceId);
  }

  if (query.status) {
    conditions.push(`status = $${paramIndex++}`);
    values.push(query.status);
  }

  if (query.startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(query.startDate);
  }

  if (query.endDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    values.push(query.endDate);
  }

  const limit = Math.min(query.limit || 100, 1000);
  const offset = query.offset || 0;

  const result = await dbQuery(
    `select
      id, created_at, user_id, user_email, user_role,
      action, resource_type, resource_id,
      ip_address, user_agent, request_method, request_path,
      details, status, error_message
    from audit_log
    where ${conditions.join(' and ')}
    order by created_at desc
    limit $${paramIndex++} offset $${paramIndex++}`,
    [...values, limit, offset]
  );

  const countResult = await dbQuery(
    `select count(*) as total
    from audit_log
    where ${conditions.join(' and ')}`,
    values
  );

  return {
    logs: result.rows,
    total: parseInt(countResult.rows[0]?.total || '0', 10),
    limit,
    offset,
  };
}

/**
 * Get audit log statistics
 */
export async function getAuditLogStats(days: number = 30) {
  const result = await dbQuery(
    `select
      action,
      resource_type,
      status,
      count(*) as count
    from audit_log
    where created_at >= now() - interval '1 day' * $1
    group by action, resource_type, status
    order by count desc`,
    [days]
  );

  return result.rows;
}
