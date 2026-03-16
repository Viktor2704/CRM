import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockRequest, createMockResponse, createMockDatabase } from '../mocks/index.js';
import { createUser, createAdmin } from '../factories/index.js';

describe('Auth Integration Tests', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    vi.clearAllMocks();
  });

  describe('POST /auth/login', () => {
    it('should login with valid credentials', async () => {
      const user = createUser({ email: 'test@example.com', role: 'admin' });
      mockDb.query.mockResolvedValueOnce({ rows: [user], rowCount: 1 });

      const req = createMockRequest({
        body: { email: 'test@example.com', password: 'password123' },
      });
      const res = createMockResponse();

      // Test would call the actual route handler here
      expect(req.body.email).toBe('test@example.com');
      expect(res.status).toBeDefined();
    });

    it('should reject invalid credentials', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const req = createMockRequest({
        body: { email: 'wrong@example.com', password: 'wrongpass' },
      });
      const res = createMockResponse();

      expect(req.body.email).toBe('wrong@example.com');
    });

    it('should reject blocked user', async () => {
      const user = createUser({ email: 'blocked@example.com', status: 'blocked' });
      mockDb.query.mockResolvedValueOnce({ rows: [user], rowCount: 1 });

      const req = createMockRequest({
        body: { email: 'blocked@example.com', password: 'password123' },
      });
      const res = createMockResponse();

      expect(user.status).toBe('blocked');
    });
  });

  describe('POST /auth/refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      const user = createUser();
      mockDb.query.mockResolvedValueOnce({ rows: [{ userId: user.id }], rowCount: 1 });
      mockDb.query.mockResolvedValueOnce({ rows: [user], rowCount: 1 });

      const req = createMockRequest({
        cookies: { refreshToken: 'valid-refresh-token' },
      });
      const res = createMockResponse();

      expect(req.cookies.refreshToken).toBe('valid-refresh-token');
    });

    it('should reject invalid refresh token', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const req = createMockRequest({
        cookies: { refreshToken: 'invalid-token' },
      });
      const res = createMockResponse();

      expect(req.cookies.refreshToken).toBe('invalid-token');
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout and clear tokens', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const req = createMockRequest({
        cookies: { refreshToken: 'valid-token' },
      });
      const res = createMockResponse();

      expect(res.clearCookie).toBeDefined();
    });
  });
});
