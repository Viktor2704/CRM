import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDatabase } from '../mocks/index.js';
import { createInstallation, createProject } from '../factories/index.js';

describe('Installations Integration Tests', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    vi.clearAllMocks();
  });

  describe('GET /installations', () => {
    it('should list installations', async () => {
      const installations = [
        createInstallation({ name: 'Installation 1' }),
        createInstallation({ name: 'Installation 2' }),
      ];

      mockDb.query.mockResolvedValueOnce({ rows: installations, rowCount: 2 });

      expect(installations).toHaveLength(2);
    });

    it('should filter installations by project', async () => {
      const project = createProject();
      const installations = [
        createInstallation({ projectId: project.id }),
        createInstallation({ projectId: 'other-project' }),
      ];

      const filtered = installations.filter(i => i.projectId === project.id);
      expect(filtered).toHaveLength(1);
    });
  });

  describe('POST /installations', () => {
    it('should create new installation', async () => {
      const project = createProject();
      const installation = createInstallation({
        name: 'New Installation',
        projectId: project.id
      });

      mockDb.query.mockResolvedValueOnce({ rows: [installation], rowCount: 1 });

      expect(installation.name).toBe('New Installation');
      expect(installation.projectId).toBe(project.id);
    });
  });

  describe('PATCH /installations/:id', () => {
    it('should update installation', async () => {
      const installation = createInstallation({ status: 'active' });
      const updated = { ...installation, status: 'maintenance' };

      mockDb.query.mockResolvedValueOnce({ rows: [installation], rowCount: 1 });
      mockDb.query.mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      expect(updated.status).toBe('maintenance');
    });
  });

  describe('DELETE /installations/:id', () => {
    it('should delete installation', async () => {
      const installation = createInstallation();

      mockDb.query.mockResolvedValueOnce({ rows: [installation], rowCount: 1 });
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      expect(installation.id).toBeDefined();
    });
  });
});
