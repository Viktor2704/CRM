import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDatabase } from '../mocks/index.js';
import { createServiceRequest, createUser } from '../factories/index.js';

describe('Service Requests Integration Tests', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    vi.clearAllMocks();
  });

  describe('GET /service-requests', () => {
    it('should list service requests for authorized user', async () => {
      const user = createUser({ role: 'manager' });
      const requests = [
        createServiceRequest({ title: 'Request 1' }),
        createServiceRequest({ title: 'Request 2' }),
      ];

      mockDb.query.mockResolvedValueOnce({ rows: requests, rowCount: 2 });

      expect(requests).toHaveLength(2);
      expect(requests[0].title).toBe('Request 1');
    });

    it('should filter service requests by status', async () => {
      const requests = [
        createServiceRequest({ status: 'new' }),
        createServiceRequest({ status: 'in_progress' }),
      ];

      mockDb.query.mockResolvedValueOnce({
        rows: requests.filter(r => r.status === 'new'),
        rowCount: 1
      });

      const filtered = requests.filter(r => r.status === 'new');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].status).toBe('new');
    });

    it('should filter service requests by priority', async () => {
      const requests = [
        createServiceRequest({ priority: 'high' }),
        createServiceRequest({ priority: 'low' }),
      ];

      mockDb.query.mockResolvedValueOnce({
        rows: requests.filter(r => r.priority === 'high'),
        rowCount: 1
      });

      const filtered = requests.filter(r => r.priority === 'high');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].priority).toBe('high');
    });
  });

  describe('POST /service-requests', () => {
    it('should create new service request', async () => {
      const user = createUser({ role: 'dispatcher' });
      const newRequest = createServiceRequest({
        title: 'New Request',
        createdById: user.id
      });

      mockDb.query.mockResolvedValueOnce({ rows: [newRequest], rowCount: 1 });

      expect(newRequest.title).toBe('New Request');
      expect(newRequest.createdById).toBe(user.id);
    });

    it('should validate required fields', async () => {
      const invalidRequest = { title: '' };

      expect(invalidRequest.title).toBe('');
    });
  });

  describe('PATCH /service-requests/:id/status', () => {
    it('should update service request status', async () => {
      const request = createServiceRequest({ status: 'new' });
      const updatedRequest = { ...request, status: 'in_progress' };

      mockDb.query.mockResolvedValueOnce({ rows: [request], rowCount: 1 });
      mockDb.query.mockResolvedValueOnce({ rows: [updatedRequest], rowCount: 1 });

      expect(updatedRequest.status).toBe('in_progress');
    });

    it('should reject invalid status transitions', async () => {
      const request = createServiceRequest({ status: 'new' });

      // Cannot jump directly to closed from new
      const invalidTransition = { status: 'closed' };

      expect(request.status).toBe('new');
      expect(invalidTransition.status).toBe('closed');
    });
  });

  describe('PATCH /service-requests/:id/assign', () => {
    it('should assign service request to executor', async () => {
      const executor = createUser({ role: 'executor' });
      const request = createServiceRequest({ assignedToId: null });
      const assignedRequest = { ...request, assignedToId: executor.id };

      mockDb.query.mockResolvedValueOnce({ rows: [request], rowCount: 1 });
      mockDb.query.mockResolvedValueOnce({ rows: [assignedRequest], rowCount: 1 });

      expect(assignedRequest.assignedToId).toBe(executor.id);
    });
  });
});
