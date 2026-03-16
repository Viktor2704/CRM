import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  createWorkspace,
  getWorkspaceById,
  listUserWorkspaces,
  updateWorkspace,
  deleteWorkspace,
  addWorkspaceMember,
  listWorkspaceMembers,
  hasWorkspaceAccess,
} from '../src/services/workspaceService.js';
import { dbQuery } from '../src/db.js';

describe('Workspace Service', () => {
  let testUserId: string;
  let testWorkspaceId: string;

  before(async () => {
    // Create test user
    const userResult = await dbQuery(
      `INSERT INTO users (id, email, full_name, role, password_hash, status)
       VALUES (gen_random_uuid(), 'test-workspace@example.com', 'Test User', 'manager', 'hash', 'active')
       RETURNING id`
    );
    testUserId = userResult.rows[0].id;
  });

  after(async () => {
    // Cleanup
    await dbQuery(`DELETE FROM users WHERE id = $1`, [testUserId]);
  });

  it('should create a workspace', async () => {
    const workspace = await createWorkspace({
      name: 'Test Workspace',
      description: 'Test description',
      type: 'personal',
      owner_id: testUserId,
    });

    assert.ok(workspace.id);
    assert.strictEqual(workspace.name, 'Test Workspace');
    assert.strictEqual(workspace.type, 'personal');
    assert.strictEqual(workspace.owner_id, testUserId);

    testWorkspaceId = workspace.id;
  });

  it('should get workspace by id', async () => {
    const workspace = await getWorkspaceById(testWorkspaceId);
    assert.ok(workspace);
    assert.strictEqual(workspace.id, testWorkspaceId);
    assert.strictEqual(workspace.name, 'Test Workspace');
  });

  it('should list user workspaces', async () => {
    const workspaces = await listUserWorkspaces(testUserId);
    assert.ok(workspaces.length > 0);
    assert.ok(workspaces.some(w => w.id === testWorkspaceId));
  });

  it('should update workspace', async () => {
    const updated = await updateWorkspace(testWorkspaceId, {
      name: 'Updated Workspace',
      description: 'Updated description',
    });

    assert.strictEqual(updated.name, 'Updated Workspace');
    assert.strictEqual(updated.description, 'Updated description');
  });

  it('should check workspace access', async () => {
    const hasAccess = await hasWorkspaceAccess(testWorkspaceId, testUserId);
    assert.strictEqual(hasAccess, true);
  });

  it('should add workspace member', async () => {
    // Create another test user
    const memberResult = await dbQuery(
      `INSERT INTO users (id, email, full_name, role, password_hash, status)
       VALUES (gen_random_uuid(), 'test-member@example.com', 'Test Member', 'executor', 'hash', 'active')
       RETURNING id`
    );
    const memberId = memberResult.rows[0].id;

    // Update workspace to team type
    await updateWorkspace(testWorkspaceId, { name: 'Team Workspace' });
    await dbQuery(`UPDATE workspaces SET type = 'team' WHERE id = $1`, [testWorkspaceId]);

    const member = await addWorkspaceMember(testWorkspaceId, memberId, 'member', testUserId);
    assert.ok(member.id);
    assert.strictEqual(member.user_id, memberId);
    assert.strictEqual(member.role, 'member');

    // Check member has access
    const hasAccess = await hasWorkspaceAccess(testWorkspaceId, memberId);
    assert.strictEqual(hasAccess, true);

    // List members
    const members = await listWorkspaceMembers(testWorkspaceId);
    assert.ok(members.length >= 1);

    // Cleanup
    await dbQuery(`DELETE FROM users WHERE id = $1`, [memberId]);
  });

  it('should delete workspace', async () => {
    await deleteWorkspace(testWorkspaceId);
    const workspace = await getWorkspaceById(testWorkspaceId);
    assert.strictEqual(workspace, null);
  });
});
