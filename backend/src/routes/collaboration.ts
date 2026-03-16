import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import {
  createDocumentShare,
  getDocumentShareByToken,
  listDocumentShares,
  revokeDocumentShare,
  logShareAccess,
  getShareAnalytics,
  createMention,
  listUserMentions,
  markMentionAsRead,
  markAllMentionsAsRead,
  getUnreadMentionsCount,
  createTeamActivity,
  listTeamActivity,
  listUserActivity,
  startCollaborativeSession,
  updateSessionActivity,
  endCollaborativeSession,
  listActiveSessions,
} from '../services/collaborationService.js';

const router = Router();

// Schemas
const CreateShareSchema = z.object({
  entity_type: z.string(),
  entity_id: z.string().uuid(),
  share_type: z.enum(['view', 'edit', 'comment']),
  visibility: z.enum(['private', 'public', 'link']),
  password: z.string().optional(),
  expires_at: z.string().datetime().optional(),
  max_views: z.number().int().positive().optional(),
  settings: z.any().optional(),
});

const CreateMentionSchema = z.object({
  entity_type: z.string(),
  entity_id: z.string().uuid(),
  mentioned_user_id: z.string().uuid(),
  context_type: z.string().optional(),
  context_id: z.string().uuid().optional(),
});

const CreateActivitySchema = z.object({
  activity_type: z.string(),
  entity_type: z.string(),
  entity_id: z.string().uuid(),
  team_id: z.string().uuid().optional(),
  title: z.string(),
  description: z.string().optional(),
  metadata: z.any().optional(),
});

const StartSessionSchema = z.object({
  entity_type: z.string(),
  entity_id: z.string().uuid(),
});

// Document Sharing Routes

// POST /shares - Create document share
router.post('/shares', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const input = CreateShareSchema.parse(req.body);

  const share = await createDocumentShare(
    input.entity_type,
    input.entity_id,
    input.share_type,
    input.visibility,
    userId,
    {
      password: input.password,
      expiresAt: input.expires_at ? new Date(input.expires_at) : undefined,
      maxViews: input.max_views,
      settings: input.settings,
    }
  );

  res.status(201).json({ share });
}));

// GET /shares/:token - Get share by token
router.get('/shares/:token', asyncHandler(async (req, res) => {
  const { token } = req.params;
  const share = await getDocumentShareByToken(token);

  if (!share) {
    return res.status(404).json({ error: 'Share not found' });
  }

  // Check expiration
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return res.status(410).json({ error: 'Share has expired' });
  }

  // Check max views
  if (share.max_views && share.view_count >= share.max_views) {
    return res.status(410).json({ error: 'Share view limit reached' });
  }

  // Log access
  const ip = req.ip || req.headers['x-forwarded-for'] as string;
  const userAgent = req.headers['user-agent'];
  await logShareAccess(share.id, req.user?.id, ip, userAgent);

  res.json({ share });
}));

// GET /shares/entity/:entityType/:entityId - List shares for entity
router.get('/shares/entity/:entityType/:entityId', requireAuth, asyncHandler(async (req, res) => {
  const { entityType, entityId } = req.params;
  const shares = await listDocumentShares(entityType, entityId);
  res.json({ shares });
}));

// DELETE /shares/:id - Revoke share
router.delete('/shares/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await revokeDocumentShare(id);
  res.json({ success: true });
}));

// GET /shares/:id/analytics - Get share analytics
router.get('/shares/:id/analytics', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const analytics = await getShareAnalytics(id);
  res.json({ analytics });
}));

// Mentions Routes

// POST /mentions - Create mention
router.post('/mentions', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const input = CreateMentionSchema.parse(req.body);

  const mention = await createMention(
    input.entity_type,
    input.entity_id,
    input.mentioned_user_id,
    userId,
    input.context_type,
    input.context_id
  );

  res.status(201).json({ mention });
}));

// GET /mentions - List user mentions
router.get('/mentions', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const { is_read } = req.query;

  const isRead = is_read === 'true' ? true : is_read === 'false' ? false : undefined;
  const mentions = await listUserMentions(userId, isRead);

  res.json({ mentions });
}));

// GET /mentions/unread-count - Get unread mentions count
router.get('/mentions/unread-count', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const count = await getUnreadMentionsCount(userId);
  res.json({ count });
}));

// PUT /mentions/:id/read - Mark mention as read
router.put('/mentions/:id/read', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await markMentionAsRead(id);
  res.json({ success: true });
}));

// PUT /mentions/read-all - Mark all mentions as read
router.put('/mentions/read-all', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  await markAllMentionsAsRead(userId);
  res.json({ success: true });
}));

// Team Activity Routes

// POST /activity - Create team activity
router.post('/activity', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const input = CreateActivitySchema.parse(req.body);

  const activity = await createTeamActivity(
    input.activity_type,
    input.entity_type,
    input.entity_id,
    input.title,
    userId,
    input.team_id,
    input.description,
    input.metadata
  );

  res.status(201).json({ activity });
}));

// GET /activity - List team activity
router.get('/activity', requireAuth, asyncHandler(async (req, res) => {
  const { team_id, limit } = req.query;

  const activities = await listTeamActivity(
    team_id as string | undefined,
    limit ? parseInt(limit as string) : 50
  );

  res.json({ activities });
}));

// GET /activity/user/:userId - List user activity
router.get('/activity/user/:userId', requireAuth, asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { limit } = req.query;

  const activities = await listUserActivity(
    userId,
    limit ? parseInt(limit as string) : 50
  );

  res.json({ activities });
}));

// Collaborative Editing Routes

// POST /collaborative-sessions - Start collaborative session
router.post('/collaborative-sessions', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const input = StartSessionSchema.parse(req.body);

  const session = await startCollaborativeSession(
    input.entity_type,
    input.entity_id,
    userId
  );

  res.status(201).json({ session });
}));

// PUT /collaborative-sessions/:token/activity - Update session activity
router.put('/collaborative-sessions/:token/activity', requireAuth, asyncHandler(async (req, res) => {
  const { token } = req.params;
  await updateSessionActivity(token);
  res.json({ success: true });
}));

// DELETE /collaborative-sessions/:token - End collaborative session
router.delete('/collaborative-sessions/:token', requireAuth, asyncHandler(async (req, res) => {
  const { token } = req.params;
  await endCollaborativeSession(token);
  res.json({ success: true });
}));

// GET /collaborative-sessions/:entityType/:entityId - List active sessions
router.get('/collaborative-sessions/:entityType/:entityId', requireAuth, asyncHandler(async (req, res) => {
  const { entityType, entityId } = req.params;
  const sessions = await listActiveSessions(entityType, entityId);
  res.json({ sessions });
}));

export function registerCollaborationRoutes(app: any) {
  app.use('/api', router);
}
