import { dbQuery, withTx } from '../db.js';
import { randomUUID } from 'node:crypto';
import { logger } from '../logger.js';

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  type: 'personal' | 'team' | 'role_based';
  role?: string;
  owner_id: string;
  is_default: boolean;
  is_template: boolean;
  layout: any;
  settings: any;
  created_at: Date;
  updated_at: Date;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  added_at: Date;
  added_by?: string;
}

export interface CreateWorkspaceInput {
  name: string;
  description?: string;
  type: 'personal' | 'team' | 'role_based';
  role?: string;
  owner_id: string;
  is_default?: boolean;
  layout?: any;
  settings?: any;
}

export interface UpdateWorkspaceInput {
  name?: string;
  description?: string;
  layout?: any;
  settings?: any;
  is_default?: boolean;
}

// Create workspace
export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  const id = randomUUID();
  const layout = input.layout || { widgets: [], layout_config: {} };
  const settings = input.settings || {};

  const result = await dbQuery(
    `INSERT INTO workspaces (id, name, description, type, role, owner_id, is_default, layout, settings)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [id, input.name, input.description, input.type, input.role, input.owner_id, input.is_default || false, JSON.stringify(layout), JSON.stringify(settings)]
  );

  // If this is a team workspace, add owner as member
  if (input.type === 'team') {
    await addWorkspaceMember(id, input.owner_id, 'owner', input.owner_id);
  }

  return result.rows[0];
}

// Get workspace by ID
export async function getWorkspaceById(workspaceId: string): Promise<Workspace | null> {
  const result = await dbQuery(
    `SELECT * FROM workspaces WHERE id = $1`,
    [workspaceId]
  );
  return result.rows[0] || null;
}

// List workspaces for user
export async function listUserWorkspaces(userId: string): Promise<Workspace[]> {
  const result = await dbQuery(
    `SELECT DISTINCT w.* FROM workspaces w
     LEFT JOIN workspace_members wm ON w.id = wm.workspace_id
     WHERE w.owner_id = $1
        OR wm.user_id = $1
        OR (w.type = 'role_based' AND w.role IN (
          SELECT role FROM users WHERE id = $1
        ))
     ORDER BY w.is_default DESC, w.updated_at DESC`,
    [userId]
  );
  return result.rows;
}

// List workspace templates
export async function listWorkspaceTemplates(): Promise<Workspace[]> {
  const result = await dbQuery(
    `SELECT * FROM workspaces WHERE is_template = true ORDER BY name`
  );
  return result.rows;
}

// Update workspace
export async function updateWorkspace(workspaceId: string, input: UpdateWorkspaceInput): Promise<Workspace> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(input.name);
  }
  if (input.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(input.description);
  }
  if (input.layout !== undefined) {
    updates.push(`layout = $${paramIndex++}`);
    values.push(JSON.stringify(input.layout));
  }
  if (input.settings !== undefined) {
    updates.push(`settings = $${paramIndex++}`);
    values.push(JSON.stringify(input.settings));
  }
  if (input.is_default !== undefined) {
    updates.push(`is_default = $${paramIndex++}`);
    values.push(input.is_default);
  }

  updates.push(`updated_at = NOW()`);
  values.push(workspaceId);

  const result = await dbQuery(
    `UPDATE workspaces SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  return result.rows[0];
}

// Delete workspace
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await dbQuery(`DELETE FROM workspaces WHERE id = $1`, [workspaceId]);
}

// Clone workspace from template
export async function cloneWorkspaceFromTemplate(templateId: string, userId: string, name?: string): Promise<Workspace> {
  const template = await getWorkspaceById(templateId);
  if (!template || !template.is_template) {
    throw new Error('Template not found');
  }

  return createWorkspace({
    name: name || `${template.name} (Copy)`,
    description: template.description,
    type: 'personal',
    owner_id: userId,
    layout: template.layout,
    settings: template.settings,
  });
}

// Add workspace member
export async function addWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: 'owner' | 'admin' | 'member' | 'viewer',
  addedBy: string
): Promise<WorkspaceMember> {
  const id = randomUUID();
  const result = await dbQuery(
    `INSERT INTO workspace_members (id, workspace_id, user_id, role, added_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = $4
     RETURNING *`,
    [id, workspaceId, userId, role, addedBy]
  );
  return result.rows[0];
}

// Remove workspace member
export async function removeWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
  await dbQuery(
    `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId]
  );
}

// List workspace members
export async function listWorkspaceMembers(workspaceId: string): Promise<any[]> {
  const result = await dbQuery(
    `SELECT wm.*, u.email, u.full_name, u.role as user_role
     FROM workspace_members wm
     JOIN users u ON wm.user_id = u.id
     WHERE wm.workspace_id = $1
     ORDER BY wm.added_at`,
    [workspaceId]
  );
  return result.rows;
}

// Check if user has access to workspace
export async function hasWorkspaceAccess(workspaceId: string, userId: string): Promise<boolean> {
  const result = await dbQuery(
    `SELECT 1 FROM workspaces w
     LEFT JOIN workspace_members wm ON w.id = wm.workspace_id
     WHERE w.id = $1 AND (
       w.owner_id = $2
       OR wm.user_id = $2
       OR (w.type = 'role_based' AND w.role IN (
         SELECT role FROM users WHERE id = $2
       ))
     )`,
    [workspaceId, userId]
  );
  return result.rows.length > 0;
}

// Set default workspace for user
export async function setDefaultWorkspace(workspaceId: string, userId: string): Promise<void> {
  await withTx(async (client) => {
    // Clear existing defaults
    await client.query(
      `UPDATE workspaces SET is_default = false WHERE owner_id = $1`,
      [userId]
    );
    // Set new default
    await client.query(
      `UPDATE workspaces SET is_default = true WHERE id = $1 AND owner_id = $2`,
      [workspaceId, userId]
    );
  });
}

// Get default workspace for user
export async function getDefaultWorkspace(userId: string): Promise<Workspace | null> {
  const result = await dbQuery(
    `SELECT * FROM workspaces WHERE owner_id = $1 AND is_default = true LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}
