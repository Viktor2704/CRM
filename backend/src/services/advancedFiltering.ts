import type { Request, Response, NextFunction } from 'express';
import {
  FilterOperator,
  LogicalOperator,
  type FilterCondition,
  type FilterGroup,
} from '../types/filters.js';

interface QueryCondition {
  sql: string;
  params: unknown[];
}

export class AdvancedFilteringService {
  /**
   * Convert filter group to SQL WHERE clause
   */
  static buildWhereClause(
    filterGroup: FilterGroup,
    tableAlias: string = '',
    paramOffset: number = 1
  ): QueryCondition {
    const prefix = tableAlias ? `${tableAlias}.` : '';
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = paramOffset;

    // Process conditions
    for (const condition of filterGroup.conditions) {
      const result = this.buildConditionSql(condition, prefix, paramIndex);
      if (result) {
        conditions.push(result.sql);
        params.push(...result.params);
        paramIndex += result.params.length;
      }
    }

    // Process nested groups
    for (const group of filterGroup.groups || []) {
      const result = this.buildWhereClause(group, tableAlias, paramIndex);
      if (result.sql) {
        conditions.push(`(${result.sql})`);
        params.push(...result.params);
        paramIndex += result.params.length;
      }
    }

    if (conditions.length === 0) {
      return { sql: '', params: [] };
    }

    const operator = filterGroup.operator === LogicalOperator.AND ? ' AND ' : ' OR ';
    const sql = conditions.join(operator);

    return { sql, params };
  }

  /**
   * Build SQL for a single condition
   */
  private static buildConditionSql(
    condition: FilterCondition,
    prefix: string,
    paramIndex: number
  ): QueryCondition | null {
    const field = `${prefix}${this.sanitizeFieldName(condition.field)}`;
    const placeholder = `$${paramIndex}`;

    switch (condition.operator) {
      case FilterOperator.EQUALS:
        return {
          sql: `${field} = ${placeholder}`,
          params: [condition.value],
        };

      case FilterOperator.NOT_EQUALS:
        return {
          sql: `${field} != ${placeholder}`,
          params: [condition.value],
        };

      case FilterOperator.CONTAINS:
        return {
          sql: `${field} ILIKE ${placeholder} escape '\\'`,
          params: [`%${String(condition.value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`],
        };

      case FilterOperator.NOT_CONTAINS:
        return {
          sql: `${field} NOT ILIKE ${placeholder} escape '\\'`,
          params: [`%${String(condition.value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`],
        };

      case FilterOperator.STARTS_WITH:
        return {
          sql: `${field} ILIKE ${placeholder} escape '\\'`,
          params: [`${String(condition.value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`],
        };

      case FilterOperator.ENDS_WITH:
        return {
          sql: `${field} ILIKE ${placeholder} escape '\\'`,
          params: [`%${String(condition.value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}`],
        };

      case FilterOperator.GREATER_THAN:
        return {
          sql: `${field} > ${placeholder}`,
          params: [condition.value],
        };

      case FilterOperator.GREATER_THAN_OR_EQUAL:
        return {
          sql: `${field} >= ${placeholder}`,
          params: [condition.value],
        };

      case FilterOperator.LESS_THAN:
        return {
          sql: `${field} < ${placeholder}`,
          params: [condition.value],
        };

      case FilterOperator.LESS_THAN_OR_EQUAL:
        return {
          sql: `${field} <= ${placeholder}`,
          params: [condition.value],
        };

      case FilterOperator.IN:
        if (Array.isArray(condition.value) && condition.value.length > 0) {
          const placeholders = condition.value.map((_, i) => `$${paramIndex + i}`).join(', ');
          return {
            sql: `${field} IN (${placeholders})`,
            params: condition.value,
          };
        }
        return null;

      case FilterOperator.NOT_IN:
        if (Array.isArray(condition.value) && condition.value.length > 0) {
          const placeholders = condition.value.map((_, i) => `$${paramIndex + i}`).join(', ');
          return {
            sql: `${field} NOT IN (${placeholders})`,
            params: condition.value,
          };
        }
        return null;

      case FilterOperator.IS_EMPTY:
        return {
          sql: `(${field} IS NULL OR ${field} = '')`,
          params: [],
        };

      case FilterOperator.IS_NOT_EMPTY:
        return {
          sql: `(${field} IS NOT NULL AND ${field} != '')`,
          params: [],
        };

      case FilterOperator.DATE_RANGE:
        if (Array.isArray(condition.value) && condition.value.length === 2) {
          return {
            sql: `${field} BETWEEN $${paramIndex} AND $${paramIndex + 1}`,
            params: condition.value,
          };
        }
        return null;

      case FilterOperator.DATE_BEFORE:
        return {
          sql: `${field} < ${placeholder}`,
          params: [condition.value],
        };

      case FilterOperator.DATE_AFTER:
        return {
          sql: `${field} > ${placeholder}`,
          params: [condition.value],
        };

      default:
        return null;
    }
  }

  /**
   * Sanitize field name to prevent SQL injection
   */
  private static sanitizeFieldName(field: string): string {
    // Only allow alphanumeric characters and underscores
    return field.replace(/[^a-zA-Z0-9_]/g, '');
  }

  /**
   * Build GROUP BY clause
   */
  static buildGroupByClause(groupField: string, tableAlias: string = ''): string {
    const prefix = tableAlias ? `${tableAlias}.` : '';
    const sanitizedField = this.sanitizeFieldName(groupField);
    return `${prefix}${sanitizedField}`;
  }

  /**
   * Build ORDER BY clause
   */
  static buildOrderByClause(
    sortBy: { field: string; order: 'asc' | 'desc' }[],
    tableAlias: string = ''
  ): string {
    const prefix = tableAlias ? `${tableAlias}.` : '';
    return sortBy
      .map((sort) => {
        const sanitizedField = this.sanitizeFieldName(sort.field);
        const order = sort.order.toUpperCase();
        return `${prefix}${sanitizedField} ${order}`;
      })
      .join(', ');
  }

  /**
   * Apply filters to a query
   */
  static applyFilters(
    baseQuery: string,
    filterGroup: FilterGroup | undefined,
    tableAlias: string = ''
  ): { query: string; params: unknown[] } {
    if (!filterGroup || (filterGroup.conditions.length === 0 && (!filterGroup.groups || filterGroup.groups.length === 0))) {
      return { query: baseQuery, params: [] };
    }

    const whereClause = this.buildWhereClause(filterGroup, tableAlias);

    if (!whereClause.sql) {
      return { query: baseQuery, params: [] };
    }

    const query = baseQuery.includes('WHERE')
      ? `${baseQuery} AND (${whereClause.sql})`
      : `${baseQuery} WHERE ${whereClause.sql}`;

    return { query, params: whereClause.params };
  }

  /**
   * Validate filter group structure
   */
  static validateFilterGroup(filterGroup: FilterGroup): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!filterGroup.id) {
      errors.push('Filter group must have an id');
    }

    if (!Object.values(LogicalOperator).includes(filterGroup.operator)) {
      errors.push(`Invalid logical operator: ${filterGroup.operator}`);
    }

    for (const condition of filterGroup.conditions) {
      if (!condition.id) {
        errors.push('Filter condition must have an id');
      }
      if (!condition.field) {
        errors.push('Filter condition must have a field');
      }
      if (!Object.values(FilterOperator).includes(condition.operator)) {
        errors.push(`Invalid filter operator: ${condition.operator}`);
      }
    }

    if (filterGroup.groups) {
      for (const group of filterGroup.groups) {
        const result = this.validateFilterGroup(group);
        errors.push(...result.errors);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Create a default filter group
   */
  static createDefaultFilterGroup(): FilterGroup {
    return {
      id: this.generateId(),
      operator: LogicalOperator.AND,
      conditions: [],
      groups: [],
    };
  }

  /**
   * Generate a unique ID
   */
  private static generateId(): string {
    return Math.random().toString(36).substring(2, 11);
  }
}

// Export types for use in other modules
export type { FilterCondition, FilterGroup, QueryCondition };
export { FilterOperator, LogicalOperator };
