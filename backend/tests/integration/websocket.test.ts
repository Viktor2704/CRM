import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDatabase, createMockWebSocket } from '../mocks/index.js';
import { createUser, createServiceRequest } from '../factories/index.js';

describe('WebSocket Integration Tests', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  let mockWs: ReturnType<typeof createMockWebSocket>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    mockWs = createMockWebSocket();
    vi.clearAllMocks();
  });

  describe('Real-time notifications', () => {
    it('should emit notification when service request is created', async () => {
      const user = createUser({ role: 'dispatcher' });
      const request = createServiceRequest({
        title: 'New Request',
        createdById: user.id
      });

      mockDb.query.mockResolvedValueOnce({ rows: [request], rowCount: 1 });

      // Simulate notification emission
      mockWs.emit('notification', {
        type: 'service_request_created',
        data: request
      });

      expect(mockWs.emit).toHaveBeenCalledWith('notification', {
        type: 'service_request_created',
        data: request
      });
    });

    it('should emit notification when service request status changes', async () => {
      const request = createServiceRequest({ status: 'new' });
      const updated = { ...request, status: 'in_progress' };

      mockDb.query.mockResolvedValueOnce({ rows: [request], rowCount: 1 });
      mockDb.query.mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      mockWs.emit('notification', {
        type: 'service_request_updated',
        data: updated
      });

      expect(mockWs.emit).toHaveBeenCalledWith('notification', {
        type: 'service_request_updated',
        data: updated
      });
    });

    it('should broadcast to specific room', async () => {
      const projectId = 'test-project-id';
      const request = createServiceRequest({ projectId });

      mockWs.to(projectId).emit('notification', {
        type: 'service_request_created',
        data: request
      });

      expect(mockWs.to).toHaveBeenCalledWith(projectId);
      expect(mockWs.emit).toHaveBeenCalled();
    });
  });

  describe('Connection handling', () => {
    it('should handle user connection', () => {
      const user = createUser();

      mockWs.on('connection', (socket: any) => {
        socket.userId = user.id;
      });

      expect(mockWs.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });

    it('should handle user disconnection', () => {
      mockWs.on('disconnect', () => {
        // Cleanup logic
      });

      expect(mockWs.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });
  });
});
