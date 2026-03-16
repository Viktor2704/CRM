import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  createDocumentShare,
  getDocumentShareByToken,
  listDocumentShares,
  revokeDocumentShare,
  createMention,
  listUserMentions,
  markMentionAsRead,
  getUnreadMentionsCount,
  createTeamActivity,
  listTeamActivity,
  startCollaborativeSession,
  listActiveSessions,
  endCollaborativeSession,
} from '../src/services/collaborationService.js';
import { dbQuery } from '../src/db.js';

describe('Collaboration Service', () => {
  let testUserId: string;
  let testEntityId: string;
  let testShareId: string;
  let testMentionId: string;

  before(async () => {
    // Create test user
    const userResult = await dbQuery(
      `INSERT INTO users (id, email, full_name, role, password_hash, status)
       VALUES (gen_random_uuid(), 'test-collab@example.com', 'Test User', 'manager', 'hash', 'active')
       RETURNING id`
    );
    testUserId = userResult.rows[0].id;

    // Create test entity (service request)
    const entityResult = await dbQuery(
      `INSERT INTO service_requests (id, title, type, priority, status, created_by)
       VALUES (gen_random_uuid(), 'Test Request', 'maintenance', 'medium', 'new', $1)
       RETURNING id`,
      [testUserId]
    );
    testEntityId = entityResult.rows[0].id;
  });

  after(async () => {
    // Cleanup
    await dbQuery(`DELETE FROM service_requests WHERE id = $1`, [testEntityId]);
    await dbQuery(`DELETE FROM users WHERE id = $1`, [testUserId]);
  });

  describe('Document Sharing', () => {
    it('should create document share', async () => {
      const share = await createDocumentShare(
        'service_request',
        testEntityId,
        'view',
        'link',
        testUserId,
        {
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          maxViews: 10,
        }
      );

      assert.ok(share.id);
      assert.ok(share.share_token);
      assert.strictEqual(share.entity_type, 'service_request');
      assert.strictEqual(share.share_type, 'view');
      assert.strictEqual(share.visibility, 'link');

      testShareId = share.id;
    });

    it('should get share by token', async () => {
      // Get the actual token first
      const tokenResult = await dbQuery(`SELECT share_token FROM document_shares WHERE id = $1`, [testShareId]);
      const token = tokenResult.rows[0].share_token;

      const share = await getDocumentShareByToken(token);
      assert.ok(share);
      assert.strictEqual(share.id, testShareId);
    });

    it('should list document shares', async () => {
      const shares = await listDocumentShares('service_request', testEntityId);
      assert.ok(shares.length > 0);
      assert.ok(shares.some(s => s.id === testShareId));
    });

    it('should revoke document share', async () => {
      await revokeDocumentShare(testShareId);
      const tokenResult = await dbQuery(`SELECT share_token FROM document_shares WHERE id = $1`, [testShareId]);
      assert.strictEqual(tokenResult.rows.length, 0);
    });
  });

  describe('Mentions', () => {
    it('should create mention', async () => {
      const mention = await createMention(
        'comment',
        testEntityId,
        testUserId,
        testUserId,
        'service_request',
        testEntityId
      );

      assert.ok(mention.id);
      assert.strictEqual(mention.mentioned_user_id, testUserId);
      assert.strictEqual(mention.is_read, false);

      testMentionId = mention.id;
    });

    it('should list user mentions', async () => {
      const mentions = await listUserMentions(testUserId, false);
      assert.ok(mentions.length > 0);
      assert.ok(mentions.some(m => m.id === testMentionId));
    });

    it('should get unread mentions count', async () => {
      const count = await getUnreadMentionsCount(testUserId);
      assert.ok(count > 0);
    });

    it('should mark mention as read', async () => {
      await markMentionAsRead(testMentionId);
      const mentions = await listUserMentions(testUserId, false);
      assert.ok(!mentions.some(m => m.id === testMentionId));
    });
  });

  describe('Team Activity', () => {
    it('should create team activity', async () => {
      const activity = await createTeamActivity(
        'created',
        'service_request',
        testEntityId,
        'Test activity',
        testUserId,
        undefined,
        'Test description',
        { test: true }
      );

      assert.ok(activity.id);
      assert.strictEqual(activity.activity_type, 'created');
      assert.strictEqual(activity.title, 'Test activity');
    });

    it('should list team activity', async () => {
      const activities = await listTeamActivity(undefined, 50);
      assert.ok(activities.length > 0);
    });
  });

  describe('Collaborative Editing', () => {
    let sessionToken: string;

    it('should start collaborative session', async () => {
      const session = await startCollaborativeSession(
        'service_request',
        testEntityId,
        testUserId
      );

      assert.ok(session.id);
      assert.ok(session.session_token);
      assert.strictEqual(session.is_active, true);

      sessionToken = session.session_token;
    });

    it('should list active sessions', async () => {
      const sessions = await listActiveSessions('service_request', testEntityId);
      assert.ok(sessions.length > 0);
      assert.ok(sessions.some(s => s.session_token === sessionToken));
    });

    it('should end collaborative session', async () => {
      await endCollaborativeSession(sessionToken);
      const sessions = await listActiveSessions('service_request', testEntityId);
      assert.ok(!sessions.some(s => s.session_token === sessionToken));
    });
  });
});
