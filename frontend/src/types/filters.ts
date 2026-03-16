// Advanced filtering types
export enum FilterOperator {
  EQUALS = 'equals',
  NOT_EQUALS = 'not_equals',
  CONTAINS = 'contains',
  NOT_CONTAINS = 'not_contains',
  STARTS_WITH = 'starts_with',
  ENDS_WITH = 'ends_with',
  GREATER_THAN = 'greater_than',
  GREATER_THAN_OR_EQUAL = 'greater_than_or_equal',
  LESS_THAN = 'less_than',
  LESS_THAN_OR_EQUAL = 'less_than_or_equal',
  IN = 'in',
  NOT_IN = 'not_in',
  IS_EMPTY = 'is_empty',
  IS_NOT_EMPTY = 'is_not_empty',
  DATE_RANGE = 'date_range',
  DATE_BEFORE = 'date_before',
  DATE_AFTER = 'date_after',
}

export enum LogicalOperator {
  AND = 'and',
  OR = 'or',
}

export enum FieldType {
  TEXT = 'text',
  NUMBER = 'number',
  DATE = 'date',
  SELECT = 'select',
  MULTI_SELECT = 'multi_select',
  BOOLEAN = 'boolean',
  USER = 'user',
}

export interface FilterCondition {
  id: string;
  field: string;
  operator: FilterOperator;
  value: string | string[] | number | boolean | null;
  fieldType: FieldType;
}

export interface FilterGroup {
  id: string;
  operator: LogicalOperator;
  conditions: FilterCondition[];
  groups: FilterGroup[];
}

export interface FilterPreset {
  id: string;
  name: string;
  description?: string;
  filterGroup: FilterGroup;
  isShared: boolean;
  isSystem: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupByConfig {
  field: string;
  order?: 'asc' | 'desc';
}

export interface ViewConfig {
  id: string;
  name: string;
  type: 'table' | 'kanban' | 'list';
  filterGroup?: FilterGroup;
  groupBy?: GroupByConfig;
  sortBy?: { field: string; order: 'asc' | 'desc' }[];
  columns?: string[];
}

export interface BulkOperation {
  action: 'update' | 'delete' | 'export' | 'assign';
  selectedIds: string[];
  data?: Record<string, unknown>;
}

export interface KanbanColumn {
  id: string;
  title: string;
  value: string;
  items: unknown[];
  color?: string;
}
