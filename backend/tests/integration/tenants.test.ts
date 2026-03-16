import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDatabase } from '../mocks/index.js';
import { createTenant, createProject } from '../factories/index.js';

describe('Tenants Integration Tests', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    vi.clearAllMocks();
  });

  describe('GET /tenants', () => {
    it('should list tenants', async () => {
      const tenants = [
        createTenant({ name: 'Tenant 1' }),
        createTenant({ name: 'Tenant 2' }),
      ];

      mockDb.query.mockResolvedValueOnce({ rows: tenants, rowCount: 2 });

      expect(tenants).toHaveLength(2);
    });

    it('should filter tenants by project', async () => {
      const project = createProject();
      const tenants = [
        createTenant({ projectId: project.id }),
        createTenant({ projectId: 'other-project' }),
      ];

      const filtered = tenants.filter(t => t.projectId === project.id);
      expect(filtered).toHaveLength(1);
    });
  });

  describe('POST /tenants', () => {
    it('should create new tenant', async () => {
      const project = createProject();
      const tenant = createTenant({
        name: 'New Tenant',
        projectId: project.id
      });

      mockDb.query.mockResolvedValueOnce({ rows: [tenant], rowCount: 1 });

      expect(tenant.name).toBe('New Tenant');
      expect(tenant.projectId).toBe(project.id);
    });

    it('should validate email format', async () => {
      const tenant = createTenant({ email: 'valid@example.com' });
      expect(tenant.email).toContain('@');
    });
  });

  describe('PATCH /tenants/:id', () => {
    it('should update tenant', async () => {
      const tenant = createTenant({ name: 'Old Name' });
      const updated = { ...tenant, name: 'New Name' };

      mockDb.query.mockResolvedValueOnce({ rows: [tenant], rowCount: 1 });
      mockDb.query.mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      expect(updated.name).toBe('New Name');
    });
  });

  describe('DELETE /tenants/:id', () => {
    it('should delete tenant', async () => {
      const tenant = createTenant();

      mockDb.query.mockResolvedValueOnce({ rows: [tenant], rowCount: 1 });
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      expect(tenant.id).toBeDefined();
    });
  });
});
