import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import {
  createWorkspace,
  getWorkspaceById,
  listUserWorkspaces,
  listWorkspaceTemplates,
  updateWorkspace,
  deleteWorkspace,
  cloneWorkspaceFromTemplate,
  addWorkspaceMember,
  removeWorkspaceMember,
  listWorkspaceMembers,
  hasWorkspaceAccess,
  setDefaultWorkspace,
  getDefaultWorkspace,
} from '../services/workspaceService.js';

const router = Router();

// Schemas
const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  type: z.enum(['personal', 'team', 'role_based']),
  role: z.string().optional(),
  is_default: z.boolean().optional(),
  layout: z.any().optional(),
  settings: z.any().optional(),
});

const UpdateWorkspaceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  layout: z.any().optional(),
  settings: z.any().optional(),
  is_default: z.boolean().optional(),
});

const AddMemberSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
});

const CloneWorkspaceSchema = z.object({
  template_id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
});

// GET /workspaces - List user workspaces
router.get('/workspaces', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const workspaces = await listUserWorkspaces(userId);
  res.json({ workspaces });
}));

// GET /workspaces/templates - List workspace templates
router.get('/workspaces/templates', requireAuth, asyncHandler(async (req, res) => {
  const templates = await listWorkspaceTemplates();
  res.json({ templates });
}));

// GET /workspaces/default - Get default workspace
router.get('/workspaces/default', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const workspace = await getDefaultWorkspace(userId);
  res.json({ workspace });
}));

// POST /workspaces - Create workspace
router.post('/workspaces', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const input = CreateWorkspaceSchema.parse(req.body);

  const workspace = await createWorkspace({
    ...input,
    owner_id: userId,
  });

  res.status(201).json({ workspace });
}));

// POST /workspaces/clone - Clone workspace from template
router.post('/workspaces/clone', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const { template_id, name } = CloneWorkspaceSchema.parse(req.body);

  const workspace = await cloneWorkspaceFromTemplate(template_id, userId, name);
  res.status(201).json({ workspace });
}));

// GET /workspaces/:id - Get workspace by ID
router.get('/workspaces/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.id;

  const hasAccess = await hasWorkspaceAccess(id, userId);
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const workspace = await getWorkspaceById(id);
  if (!workspace) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  res.json({ workspace });
}));

// PUT /workspaces/:id - Update workspace
router.put('/workspaces/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.id;

  const hasAccess = await hasWorkspaceAccess(id, userId);
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const input = UpdateWorkspaceSchema.parse(req.body);
  const workspace = await updateWorkspace(id, input);

  res.json({ workspace });
}));

// DELETE /workspaces/:id - Delete workspace
router.delete('/workspaces/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.id;

  const workspace = await getWorkspaceById(id);
  if (!workspace) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  if (workspace.owner_id !== userId) {
    return res.status(403).json({ error: 'Only workspace owner can delete' });
  }

  await deleteWorkspace(id);
  res.json({ success: true });
}));

// POST /workspaces/:id/set-default - Set as default workspace
router.post('/workspaces/:id/set-default', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.id;

  const workspace = await getWorkspaceById(id);
  if (!workspace) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  if (workspace.owner_id !== userId) {
    return res.status(403).json({ error: 'Only workspace owner can set default' });
  }

  await setDefaultWorkspace(id, userId);
  res.json({ success: true });
}));

// GET /workspaces/:id/members - List workspace members
router.get('/workspaces/:id/members', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.id;

  const hasAccess = await hasWorkspaceAccess(id, userId);
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const members = await listWorkspaceMembers(id);
  res.json({ members });
}));

// POST /workspaces/:id/members - Add workspace member
router.post('/workspaces/:id/members', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.id;

  const workspace = await getWorkspaceById(id);
  if (!workspace) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  if (workspace.type !== 'team') {
    return res.status(400).json({ error: 'Only team workspaces can have members' });
  }

  if (workspace.owner_id !== userId) {
    return res.status(403).json({ error: 'Only workspace owner can add members' });
  }

  const { user_id, role } = AddMemberSchema.parse(req.body);
  const member = await addWorkspaceMember(id, user_id, role, userId);

  res.status(201).json({ member });
}));

// DELETE /workspaces/:id/members/:userId - Remove workspace member
router.delete('/workspaces/:id/members/:userId', requireAuth, asyncHandler(async (req, res) => {
  const { id, userId: memberUserId } = req.params;
  const userId = req.user!.id;

  const workspace = await getWorkspaceById(id);
  if (!workspace) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  if (workspace.owner_id !== userId) {
    return res.status(403).json({ error: 'Only workspace owner can remove members' });
  }

  await removeWorkspaceMember(id, memberUserId);
  res.json({ success: true });
}));

export function registerWorkspaceRoutes(app: any) {
  app.use('/api', router);
}
