import { dbQuery } from '../db.js';
import { randomUUID } from 'node:crypto';
import { createOpaqueToken, hashOpaqueToken } from '../security.js';
import { logger } from '../logger.js';

export interface DocumentShare {
  id: string;
  entity_type: string;
  entity_id: string;
  share_token: string;
  share_type: 'view' | 'edit' | 'comment';
  visibility: 'private' | 'public' | 'link';
  password_hash?: string;
  expires_at?: Date;
  max_views?: number;
  view_count: number;
  created_by: string;
  created_at: Date;
  last_accessed_at?: Date;
  settings: any;
}

export interface Mention {
  id: string;
  entity_type: string;
  entity_id: string;
  mentioned_user_id: string;
  mentioned_by_user_id: string;
  context_type?: string;
  context_id?: string;
  is_read: boolean;
  created_at: Date;
  read_at?: Date;
}

export interface TeamActivity {
  id: string;
  activity_type: string;
  entity_type: string;
  entity_id: string;
  user_id?: string;
  team_id?: string;
  title: string;
  description?: string;
  metadata: any;
  created_at: Date;
}

export interface CollaborativeSession {
  id: string;
  entity_type: string;
  entity_id: string;
  user_id: string;
  session_token: string;
  started_at: Date;
  last_activity_at: Date;
  ended_at?: Date;
  is_active: boolean;
}

// Document Sharing
export async function createDocumentShare(
  entityType: string,
  entityId: string,
  shareType: 'view' | 'edit' | 'comment',
  visibility: 'private' | 'public' | 'link',
  createdBy: string,
  options?: {
    password?: string;
    expiresAt?: Date;
    maxViews?: number;
    settings?: any;
  }
): Promise<DocumentShare> {
  const id = randomUUID();
  const shareToken = createOpaqueToken();
  const passwordHash = options?.password ? await hashOpaqueToken(options.password) : null;

  const result = await dbQuery(
    `INSERT INTO document_shares (id, entity_type, entity_id, share_token, share_type, visibility, password_hash, expires_at, max_views, created_by, settings)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [id, entityType, entityId, shareToken, shareType, visibility, passwordHash, options?.expiresAt, options?.maxViews, createdBy, JSON.stringify(options?.settings || {})]
  );

  return result.rows[0];
}

export async function getDocumentShareByToken(token: string): Promise<DocumentShare | null> {
  const result = await dbQuery(
    `SELECT * FROM document_shares WHERE share_token = $1`,
    [token]
  );
  return result.rows[0] || null;
}

export async function listDocumentShares(entityType: string, entityId: string): Promise<DocumentShare[]> {
  const result = await dbQuery(
    `SELECT * FROM document_shares WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC`,
    [entityType, entityId]
  );
  return result.rows;
}

export async function revokeDocumentShare(shareId: string): Promise<void> {
  await dbQuery(`DELETE FROM document_shares WHERE id = $1`, [shareId]);
}

export async function logShareAccess(
  shareId: string,
  accessedBy?: string,
  accessedByIp?: string,
  accessedByUserAgent?: string,
  action: string = 'view'
): Promise<void> {
  await dbQuery(
    `INSERT INTO document_share_access_log (id, share_id, accessed_by, accessed_by_ip, accessed_by_user_agent, action)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), shareId, accessedBy, accessedByIp, accessedByUserAgent, action]
  );

  // Increment view count
  await dbQuery(
    `UPDATE document_shares SET view_count = view_count + 1, last_accessed_at = NOW() WHERE id = $1`,
    [shareId]
  );
}

export async function getShareAnalytics(shareId: string): Promise<any> {
  const result = await dbQuery(
    `SELECT
       COUNT(*) as total_views,
       COUNT(DISTINCT accessed_by) as unique_users,
       COUNT(DISTINCT accessed_by_ip) as unique_ips,
       MAX(accessed_at) as last_access,
       MIN(accessed_at) as first_access
     FROM document_share_access_log
     WHERE share_id = $1`,
    [shareId]
  );
  return result.rows[0];
}

// Mentions
export async function createMention(
  entityType: string,
  entityId: string,
  mentionedUserId: string,
  mentionedByUserId: string,
  contextType?: string,
  contextId?: string
): Promise<Mention> {
  const id = randomUUID();
  const result = await dbQuery(
    `INSERT INTO mentions (id, entity_type, entity_id, mentioned_user_id, mentioned_by_user_id, context_type, context_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, entityType, entityId, mentionedUserId, mentionedByUserId, contextType, contextId]
  );
  return result.rows[0];
}

export async function listUserMentions(userId: string, isRead?: boolean): Promise<any[]> {
  let query = `
    SELECT m.*,
           u.full_name as mentioned_by_name,
           u.email as mentioned_by_email
    FROM mentions m
    JOIN users u ON m.mentioned_by_user_id = u.id
    WHERE m.mentioned_user_id = $1
  `;
  const params: any[] = [userId];

  if (isRead !== undefined) {
    query += ` AND m.is_read = $2`;
    params.push(isRead);
  }

  query += ` ORDER BY m.created_at DESC LIMIT 100`;

  const result = await dbQuery(query, params);
  return result.rows;
}

export async function markMentionAsRead(mentionId: string): Promise<void> {
  await dbQuery(
    `UPDATE mentions SET is_read = true, read_at = NOW() WHERE id = $1`,
    [mentionId]
  );
}

export async function markAllMentionsAsRead(userId: string): Promise<void> {
  await dbQuery(
    `UPDATE mentions SET is_read = true, read_at = NOW() WHERE mentioned_user_id = $1 AND is_read = false`,
    [userId]
  );
}

export async function getUnreadMentionsCount(userId: string): Promise<number> {
  const result = await dbQuery(
    `SELECT COUNT(*) as count FROM mentions WHERE mentioned_user_id = $1 AND is_read = false`,
    [userId]
  );
  return parseInt(result.rows[0].count);
}

// Team Activity Feed
export async function createTeamActivity(
  activityType: string,
  entityType: string,
  entityId: string,
  title: string,
  userId?: string,
  teamId?: string,
  description?: string,
  metadata?: any
): Promise<TeamActivity> {
  const id = randomUUID();
  const result = await dbQuery(
    `INSERT INTO team_activity_feed (id, activity_type, entity_type, entity_id, user_id, team_id, title, description, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [id, activityType, entityType, entityId, userId, teamId, title, description, JSON.stringify(metadata || {})]
  );
  return result.rows[0];
}

export async function listTeamActivity(teamId?: string, limit: number = 50): Promise<any[]> {
  let query = `
    SELECT taf.*,
           u.full_name as user_name,
           u.email as user_email
    FROM team_activity_feed taf
    LEFT JOIN users u ON taf.user_id = u.id
  `;
  const params: any[] = [];

  if (teamId) {
    query += ` WHERE taf.team_id = $1`;
    params.push(teamId);
  }

  query += ` ORDER BY taf.created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await dbQuery(query, params);
  return result.rows;
}

export async function listUserActivity(userId: string, limit: number = 50): Promise<any[]> {
  const result = await dbQuery(
    `SELECT taf.*,
            u.full_name as user_name,
            u.email as user_email
     FROM team_activity_feed taf
     LEFT JOIN users u ON taf.user_id = u.id
     WHERE taf.user_id = $1
     ORDER BY taf.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

// Collaborative Editing Sessions
export async function startCollaborativeSession(
  entityType: string,
  entityId: string,
  userId: string
): Promise<CollaborativeSession> {
  const id = randomUUID();
  const sessionToken = createOpaqueToken();

  // End any existing active sessions for this user on this entity
  await dbQuery(
    `UPDATE collaborative_editing_sessions
     SET is_active = false, ended_at = NOW()
     WHERE entity_type = $1 AND entity_id = $2 AND user_id = $3 AND is_active = true`,
    [entityType, entityId, userId]
  );

  const result = await dbQuery(
    `INSERT INTO collaborative_editing_sessions (id, entity_type, entity_id, user_id, session_token)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [id, entityType, entityId, userId, sessionToken]
  );
  return result.rows[0];
}

export async function updateSessionActivity(sessionToken: string): Promise<void> {
  await dbQuery(
    `UPDATE collaborative_editing_sessions SET last_activity_at = NOW() WHERE session_token = $1`,
    [sessionToken]
  );
}

export async function endCollaborativeSession(sessionToken: string): Promise<void> {
  await dbQuery(
    `UPDATE collaborative_editing_sessions SET is_active = false, ended_at = NOW() WHERE session_token = $1`,
    [sessionToken]
  );
}

export async function listActiveSessions(entityType: string, entityId: string): Promise<any[]> {
  const result = await dbQuery(
    `SELECT ces.*,
            u.full_name as user_name,
            u.email as user_email
     FROM collaborative_editing_sessions ces
     JOIN users u ON ces.user_id = u.id
     WHERE ces.entity_type = $1 AND ces.entity_id = $2 AND ces.is_active = true
     ORDER BY ces.last_activity_at DESC`,
    [entityType, entityId]
  );
  return result.rows;
}

// Clean up stale sessions (older than 5 minutes)
export async function cleanupStaleSessions(): Promise<void> {
  await dbQuery(
    `UPDATE collaborative_editing_sessions
     SET is_active = false, ended_at = NOW()
     WHERE is_active = true AND last_activity_at < NOW() - INTERVAL '5 minutes'`
  );
}
