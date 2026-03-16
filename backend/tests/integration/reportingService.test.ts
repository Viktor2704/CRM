import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  executeReport,
  listReportDefinitions,
  getReportDefinition,
  createReportDefinition,
  updateReportDefinition,
  deleteReportDefinition,
  exportReportToCsv,
  type ReportConfig,
  type ReportEntity,
} from '../../src/services/reportingService.js';

// Mock the database module
vi.mock('../../src/db.js', () => ({
  dbQuery: vi.fn(),
}));

// Mock the logger module
vi.mock('../../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  serializeError: vi.fn((err) => err),
}));

import { dbQuery } from '../../src/db.js';

describe('ReportingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeReport', () => {
    it('should execute a basic report with selected fields', async () => {
      const mockData = [
        { id: '1', title: 'Project 1', status: 'active' },
        { id: '2', title: 'Project 2', status: 'completed' },
      ];

      vi.mocked(dbQuery).mockResolvedValueOnce({ rows: mockData } as any);

      const config: ReportConfig = {
        fields: ['id', 'title', 'status'],
      };

      const result = await executeReport('projects', config);

      expect(result).toEqual(mockData);
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('select'),
        expect.any(Array)
      );
    });

    it('should apply filters to the report', async () => {
      const mockData = [{ id: '1', title: 'Active Project', status: 'active' }];

      vi.mocked(dbQuery).mockResolvedValueOnce({ rows: mockData } as any);

      const config: ReportConfig = {
        fields: ['id', 'title', 'status'],
        filters: [
          { field: 'status', operator: 'eq', value: 'active' },
        ],
      };

      const result = await executeReport('projects', config);

      expect(result).toEqual(mockData);
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('where'),
        expect.arrayContaining(['active'])
      );
    });

    it('should group by field with aggregations', async () => {
      const mockData = [
        { status: 'active', count_id: 5 },
        { status: 'completed', count_id: 10 },
      ];

      vi.mocked(dbQuery).mockResolvedValueOnce({ rows: mockData } as any);

      const config: ReportConfig = {
        fields: ['status'],
        groupBy: 'status',
        aggregations: [{ field: 'id', function: 'count' }],
      };

      const result = await executeReport('projects', config);

      expect(result).toEqual(mockData);
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('group by'),
        expect.any(Array)
      );
    });

    it('should apply ordering', async () => {
      const mockData = [
        { id: '1', title: 'A Project', createdAt: '2024-01-01' },
        { id: '2', title: 'B Project', createdAt: '2024-01-02' },
      ];

      vi.mocked(dbQuery).mockResolvedValueOnce({ rows: mockData } as any);

      const config: ReportConfig = {
        fields: ['id', 'title', 'createdAt'],
        orderBy: 'createdAt',
        orderDirection: 'desc',
      };

      const result = await executeReport('projects', config);

      expect(result).toEqual(mockData);
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('order by'),
        expect.any(Array)
      );
    });

    it('should apply limit', async () => {
      const mockData = Array.from({ length: 100 }, (_, i) => ({
        id: String(i + 1),
        title: `Project ${i + 1}`,
      }));

      vi.mocked(dbQuery).mockResolvedValueOnce({ rows: mockData } as any);

      const config: ReportConfig = {
        fields: ['id', 'title'],
        limit: 100,
      };

      const result = await executeReport('projects', config);

      expect(result).toEqual(mockData);
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('limit 100'),
        expect.any(Array)
      );
    });

    it('should handle installations entity', async () => {
      const mockData = [
        { id: '1', title: 'Installation 1', stage: 'planning' },
      ];

      vi.mocked(dbQuery).mockResolvedValueOnce({ rows: mockData } as any);

      const config: ReportConfig = {
        fields: ['id', 'title', 'stage'],
      };

      const result = await executeReport('installations', config);

      expect(result).toEqual(mockData);
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('from installations'),
        expect.any(Array)
      );
    });

    it('should handle service_requests entity', async () => {
      const mockData = [
        { id: '1', title: 'Request 1', priority: 'high' },
      ];

      vi.mocked(dbQuery).mockResolvedValueOnce({ rows: mockData } as any);

      const config: ReportConfig = {
        fields: ['id', 'title', 'priority'],
      };

      const result = await executeReport('service_requests', config);

      expect(result).toEqual(mockData);
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('from service_requests'),
        expect.any(Array)
      );
    });
  });

  describe('listReportDefinitions', () => {
    it('should list all report definitions', async () => {
      const mockDefinitions = [
        {
          id: '1',
          name: 'Projects by Status',
          entityType: 'projects',
          config: { fields: ['status'] },
          isPredefined: true,
        },
      ];

      vi.mocked(dbQuery)
        .mockResolvedValueOnce({ rows: mockDefinitions } as any)
        .mockResolvedValueOnce({ rows: [{ total: 1 }] } as any);

      const result = await listReportDefinitions();

      expect(result.items).toEqual(mockDefinitions);
      expect(result.total).toBe(1);
    });

    it('should filter by entity type', async () => {
      const mockDefinitions = [
        {
          id: '1',
          name: 'Projects Report',
          entityType: 'projects',
          config: {},
          isPredefined: false,
        },
      ];

      vi.mocked(dbQuery)
        .mockResolvedValueOnce({ rows: mockDefinitions } as any)
        .mockResolvedValueOnce({ rows: [{ total: 1 }] } as any);

      const result = await listReportDefinitions({ entityType: 'projects' });

      expect(result.items).toEqual(mockDefinitions);
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('where entity_type = $1'),
        expect.arrayContaining(['projects', expect.any(Number), expect.any(Number)])
      );
    });

    it('should apply pagination', async () => {
      vi.mocked(dbQuery)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [{ total: 0 }] } as any);

      await listReportDefinitions({ limit: 10, offset: 20 });

      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('limit'),
        expect.arrayContaining([10, 20])
      );
    });
  });

  describe('getReportDefinition', () => {
    it('should get a report definition by id', async () => {
      const mockDefinition = {
        id: '123',
        name: 'Test Report',
        entityType: 'projects',
        config: { fields: ['id'] },
        isPredefined: false,
      };

      vi.mocked(dbQuery).mockResolvedValueOnce({ rows: [mockDefinition] } as any);

      const result = await getReportDefinition('123');

      expect(result).toEqual(mockDefinition);
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('where id = $1::uuid'),
        ['123']
      );
    });

    it('should return null if not found', async () => {
      vi.mocked(dbQuery).mockResolvedValueOnce({ rows: [] } as any);

      const result = await getReportDefinition('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('createReportDefinition', () => {
    it('should create a new report definition', async () => {
      const newDefinition = {
        name: 'New Report',
        description: 'Test description',
        entityType: 'projects' as ReportEntity,
        config: { fields: ['id', 'title'] },
        createdBy: 'user-123',
      };

      const mockResult = {
        id: 'new-id',
        ...newDefinition,
        isPredefined: false,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      };

      vi.mocked(dbQuery).mockResolvedValueOnce({ rows: [mockResult] } as any);

      const result = await createReportDefinition(newDefinition);

      expect(result).toEqual(mockResult);
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('insert into report_definitions'),
        expect.arrayContaining([
          newDefinition.name,
          newDefinition.description,
          newDefinition.entityType,
          expect.any(String), // JSON stringified config
          newDefinition.createdBy,
        ])
      );
    });
  });

  describe('updateReportDefinition', () => {
    it('should update a report definition', async () => {
      const updates = {
        name: 'Updated Name',
        description: 'Updated description',
      };

      const mockResult = {
        id: '123',
        ...updates,
        entityType: 'projects',
        config: {},
        isPredefined: false,
      };

      vi.mocked(dbQuery).mockResolvedValueOnce({ rows: [mockResult] } as any);

      const result = await updateReportDefinition('123', updates);

      expect(result).toEqual(mockResult);
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('update report_definitions'),
        expect.arrayContaining(['Updated Name', 'Updated description', '123'])
      );
    });

    it('should not update predefined reports', async () => {
      vi.mocked(dbQuery).mockResolvedValueOnce({ rows: [] } as any);

      const result = await updateReportDefinition('123', { name: 'New Name' });

      expect(result).toBeNull();
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_predefined = false'),
        expect.any(Array)
      );
    });
  });

  describe('deleteReportDefinition', () => {
    it('should delete a report definition', async () => {
      vi.mocked(dbQuery).mockResolvedValueOnce({ rowCount: 1 } as any);

      const result = await deleteReportDefinition('123');

      expect(result).toBe(true);
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('delete from report_definitions'),
        ['123']
      );
    });

    it('should not delete predefined reports', async () => {
      vi.mocked(dbQuery).mockResolvedValueOnce({ rowCount: 0 } as any);

      const result = await deleteReportDefinition('predefined-id');

      expect(result).toBe(false);
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_predefined = false'),
        expect.any(Array)
      );
    });
  });

  describe('exportReportToCsv', () => {
    it('should export data to CSV format', () => {
      const data = [
        { id: '1', name: 'Test 1', status: 'active' },
        { id: '2', name: 'Test 2', status: 'completed' },
      ];

      const csv = exportReportToCsv(data);

      expect(csv).toContain('id,name,status');
      expect(csv).toContain('1,Test 1,active');
      expect(csv).toContain('2,Test 2,completed');
    });

    it('should handle empty data', () => {
      const csv = exportReportToCsv([]);
      expect(csv).toBe('');
    });

    it('should escape special characters', () => {
      const data = [
        { id: '1', name: 'Test, with comma', description: 'Has "quotes"' },
      ];

      const csv = exportReportToCsv(data);

      expect(csv).toContain('"Test, with comma"');
      expect(csv).toContain('"Has ""quotes"""');
    });

    it('should handle null and undefined values', () => {
      const data = [
        { id: '1', name: null, description: undefined },
      ];

      const csv = exportReportToCsv(data);

      expect(csv).toContain('1,,');
    });
  });
});
