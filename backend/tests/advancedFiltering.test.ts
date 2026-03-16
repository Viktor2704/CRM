import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AdvancedFilteringService, FilterOperator, LogicalOperator } from '../src/services/advancedFiltering.js';
import type { FilterGroup } from '../src/types/filters.js';

describe('AdvancedFilteringService', () => {
  describe('buildWhereClause', () => {
    it('should build simple equals condition', () => {
      const filterGroup: FilterGroup = {
        id: '1',
        operator: LogicalOperator.AND,
        conditions: [
          {
            id: 'c1',
            field: 'status',
            operator: FilterOperator.EQUALS,
            value: 'active',
            fieldType: 'text' as any,
          },
        ],
        groups: [],
      };

      const result = AdvancedFilteringService.buildWhereClause(filterGroup);
      assert.strictEqual(result.sql, 'status = $1');
      assert.deepStrictEqual(result.params, ['active']);
    });

    it('should build AND conditions', () => {
      const filterGroup: FilterGroup = {
        id: '1',
        operator: LogicalOperator.AND,
        conditions: [
          {
            id: 'c1',
            field: 'status',
            operator: FilterOperator.EQUALS,
            value: 'active',
            fieldType: 'text' as any,
          },
          {
            id: 'c2',
            field: 'priority',
            operator: FilterOperator.EQUALS,
            value: 'high',
            fieldType: 'text' as any,
          },
        ],
        groups: [],
      };

      const result = AdvancedFilteringService.buildWhereClause(filterGroup);
      assert.strictEqual(result.sql, 'status = $1 AND priority = $2');
      assert.deepStrictEqual(result.params, ['active', 'high']);
    });

    it('should build OR conditions', () => {
      const filterGroup: FilterGroup = {
        id: '1',
        operator: LogicalOperator.OR,
        conditions: [
          {
            id: 'c1',
            field: 'status',
            operator: FilterOperator.EQUALS,
            value: 'active',
            fieldType: 'text' as any,
          },
          {
            id: 'c2',
            field: 'status',
            operator: FilterOperator.EQUALS,
            value: 'pending',
            fieldType: 'text' as any,
          },
        ],
        groups: [],
      };

      const result = AdvancedFilteringService.buildWhereClause(filterGroup);
      assert.strictEqual(result.sql, 'status = $1 OR status = $2');
      assert.deepStrictEqual(result.params, ['active', 'pending']);
    });

    it('should build CONTAINS condition', () => {
      const filterGroup: FilterGroup = {
        id: '1',
        operator: LogicalOperator.AND,
        conditions: [
          {
            id: 'c1',
            field: 'title',
            operator: FilterOperator.CONTAINS,
            value: 'test',
            fieldType: 'text' as any,
          },
        ],
        groups: [],
      };

      const result = AdvancedFilteringService.buildWhereClause(filterGroup);
      assert.strictEqual(result.sql, 'title ILIKE $1');
      assert.deepStrictEqual(result.params, ['%test%']);
    });

    it('should build IN condition', () => {
      const filterGroup: FilterGroup = {
        id: '1',
        operator: LogicalOperator.AND,
        conditions: [
          {
            id: 'c1',
            field: 'status',
            operator: FilterOperator.IN,
            value: ['active', 'pending', 'done'],
            fieldType: 'text' as any,
          },
        ],
        groups: [],
      };

      const result = AdvancedFilteringService.buildWhereClause(filterGroup);
      assert.strictEqual(result.sql, 'status IN ($1, $2, $3)');
      assert.deepStrictEqual(result.params, ['active', 'pending', 'done']);
    });

    it('should build IS_EMPTY condition', () => {
      const filterGroup: FilterGroup = {
        id: '1',
        operator: LogicalOperator.AND,
        conditions: [
          {
            id: 'c1',
            field: 'description',
            operator: FilterOperator.IS_EMPTY,
            value: null,
            fieldType: 'text' as any,
          },
        ],
        groups: [],
      };

      const result = AdvancedFilteringService.buildWhereClause(filterGroup);
      assert.strictEqual(result.sql, "(description IS NULL OR description = '')");
      assert.deepStrictEqual(result.params, []);
    });

    it('should build nested groups', () => {
      const filterGroup: FilterGroup = {
        id: '1',
        operator: LogicalOperator.AND,
        conditions: [
          {
            id: 'c1',
            field: 'type',
            operator: FilterOperator.EQUALS,
            value: 'task',
            fieldType: 'text' as any,
          },
        ],
        groups: [
          {
            id: '2',
            operator: LogicalOperator.OR,
            conditions: [
              {
                id: 'c2',
                field: 'status',
                operator: FilterOperator.EQUALS,
                value: 'active',
                fieldType: 'text' as any,
              },
              {
                id: 'c3',
                field: 'status',
                operator: FilterOperator.EQUALS,
                value: 'pending',
                fieldType: 'text' as any,
              },
            ],
            groups: [],
          },
        ],
      };

      const result = AdvancedFilteringService.buildWhereClause(filterGroup);
      assert.strictEqual(result.sql, 'type = $1 AND (status = $2 OR status = $3)');
      assert.deepStrictEqual(result.params, ['task', 'active', 'pending']);
    });

    it('should build DATE_RANGE condition', () => {
      const filterGroup: FilterGroup = {
        id: '1',
        operator: LogicalOperator.AND,
        conditions: [
          {
            id: 'c1',
            field: 'created_at',
            operator: FilterOperator.DATE_RANGE,
            value: ['2024-01-01', '2024-12-31'],
            fieldType: 'date' as any,
          },
        ],
        groups: [],
      };

      const result = AdvancedFilteringService.buildWhereClause(filterGroup);
      assert.strictEqual(result.sql, 'created_at BETWEEN $1 AND $2');
      assert.deepStrictEqual(result.params, ['2024-01-01', '2024-12-31']);
    });

    it('should handle table alias', () => {
      const filterGroup: FilterGroup = {
        id: '1',
        operator: LogicalOperator.AND,
        conditions: [
          {
            id: 'c1',
            field: 'status',
            operator: FilterOperator.EQUALS,
            value: 'active',
            fieldType: 'text' as any,
          },
        ],
        groups: [],
      };

      const result = AdvancedFilteringService.buildWhereClause(filterGroup, 'sr');
      assert.strictEqual(result.sql, 'sr.status = $1');
      assert.deepStrictEqual(result.params, ['active']);
    });
  });

  describe('validateFilterGroup', () => {
    it('should validate valid filter group', () => {
      const filterGroup: FilterGroup = {
        id: '1',
        operator: LogicalOperator.AND,
        conditions: [
          {
            id: 'c1',
            field: 'status',
            operator: FilterOperator.EQUALS,
            value: 'active',
            fieldType: 'text' as any,
          },
        ],
        groups: [],
      };

      const result = AdvancedFilteringService.validateFilterGroup(filterGroup);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should detect missing id', () => {
      const filterGroup: FilterGroup = {
        id: '',
        operator: LogicalOperator.AND,
        conditions: [],
        groups: [],
      };

      const result = AdvancedFilteringService.validateFilterGroup(filterGroup);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('id')));
    });

    it('should detect invalid operator', () => {
      const filterGroup: FilterGroup = {
        id: '1',
        operator: 'INVALID' as any,
        conditions: [],
        groups: [],
      };

      const result = AdvancedFilteringService.validateFilterGroup(filterGroup);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('operator')));
    });
  });

  describe('applyFilters', () => {
    it('should apply filters to base query', () => {
      const baseQuery = 'SELECT * FROM service_requests';
      const filterGroup: FilterGroup = {
        id: '1',
        operator: LogicalOperator.AND,
        conditions: [
          {
            id: 'c1',
            field: 'status',
            operator: FilterOperator.EQUALS,
            value: 'active',
            fieldType: 'text' as any,
          },
        ],
        groups: [],
      };

      const result = AdvancedFilteringService.applyFilters(baseQuery, filterGroup);
      assert.strictEqual(result.query, 'SELECT * FROM service_requests WHERE status = $1');
      assert.deepStrictEqual(result.params, ['active']);
    });

    it('should append to existing WHERE clause', () => {
      const baseQuery = 'SELECT * FROM service_requests WHERE deleted_at IS NULL';
      const filterGroup: FilterGroup = {
        id: '1',
        operator: LogicalOperator.AND,
        conditions: [
          {
            id: 'c1',
            field: 'status',
            operator: FilterOperator.EQUALS,
            value: 'active',
            fieldType: 'text' as any,
          },
        ],
        groups: [],
      };

      const result = AdvancedFilteringService.applyFilters(baseQuery, filterGroup);
      assert.strictEqual(
        result.query,
        'SELECT * FROM service_requests WHERE deleted_at IS NULL AND (status = $1)'
      );
      assert.deepStrictEqual(result.params, ['active']);
    });

    it('should return original query if no filters', () => {
      const baseQuery = 'SELECT * FROM service_requests';
      const result = AdvancedFilteringService.applyFilters(baseQuery, undefined);
      assert.strictEqual(result.query, baseQuery);
      assert.deepStrictEqual(result.params, []);
    });
  });
});
