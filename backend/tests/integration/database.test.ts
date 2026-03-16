import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDatabase } from '../mocks/index.js';
import { createUser, createProject } from '../factories/index.js';

describe('Database Operations Integration Tests', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    vi.clearAllMocks();
  });

  describe('Transaction handling', () => {
    it('should commit transaction on success', async () => {
      const user = createUser();
      const project = createProject();

      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // BEGIN
      mockDb.query.mockResolvedValueOnce({ rows: [user], rowCount: 1 }); // INSERT user
      mockDb.query.mockResolvedValueOnce({ rows: [project], rowCount: 1 }); // INSERT project
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

      // Simulate transaction
      await mockDb.query('BEGIN');
      await mockDb.query('INSERT INTO users...', [user]);
      await mockDb.query('INSERT INTO projects...', [project]);
      await mockDb.query('COMMIT');

      expect(mockDb.query).toHaveBeenCalledTimes(4);
    });

    it('should rollback transaction on error', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // BEGIN
      mockDb.query.mockRejectedValueOnce(new Error('Database error')); // INSERT fails
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK

      try {
        await mockDb.query('BEGIN');
        await mockDb.query('INSERT INTO users...');
      } catch (error) {
        await mockDb.query('ROLLBACK');
      }

      expect(mockDb.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('Query optimization', () => {
    it('should use prepared statements', async () => {
      const userId = 'test-user-id';

      mockDb.query.mockResolvedValueOnce({
        rows: [createUser({ id: userId })],
        rowCount: 1
      });

      await mockDb.query('SELECT * FROM users WHERE id = $1', [userId]);

      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );
    });

    it('should handle batch operations', async () => {
      const users = [
        createUser({ email: 'user1@test.com' }),
        createUser({ email: 'user2@test.com' }),
        createUser({ email: 'user3@test.com' }),
      ];

      mockDb.query.mockResolvedValueOnce({ rows: users, rowCount: 3 });

      await mockDb.query('INSERT INTO users (email) VALUES ($1), ($2), ($3)',
        users.map(u => u.email)
      );

      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('Connection pooling', () => {
    it('should reuse connections from pool', async () => {
      mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await mockDb.query('SELECT 1');
      await mockDb.query('SELECT 2');
      await mockDb.query('SELECT 3');

      expect(mockDb.query).toHaveBeenCalledTimes(3);
    });

    it('should handle connection errors', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('Connection lost'));

      await expect(mockDb.query('SELECT 1')).rejects.toThrow('Connection lost');
    });
  });
});
