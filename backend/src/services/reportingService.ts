import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';
import ExcelJS from 'exceljs';
import type { Response } from 'express';

export type ReportEntity = 'projects' | 'installations' | 'service_requests';

export type ReportFilter = {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'contains';
  value: any;
};

export type ReportAggregation = {
  field: string;
  function: 'count' | 'sum' | 'avg' | 'min' | 'max';
};

export type ReportConfig = {
  fields: string[];
  filters?: ReportFilter[];
  groupBy?: string;
  aggregations?: ReportAggregation[];
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
  limit?: number;
};

export type ReportDefinition = {
  id: string;
  name: string;
  description?: string;
  entityType: ReportEntity;
  config: ReportConfig;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  isPredefined: boolean;
};

export type ScheduledReport = {
  id: string;
  reportDefinitionId: string;
  name: string;
  schedule: 'daily' | 'weekly' | 'monthly';
  deliveryMethod: 'email' | 'telegram' | 'both';
  deliveryConfig: Record<string, any>;
  recipientIds: string[];
  isActive: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

const ENTITY_TABLE_MAP: Record<ReportEntity, string> = {
  projects: 'projects',
  installations: 'installations',
  service_requests: 'service_requests',
};

const ENTITY_FIELD_MAP: Record<ReportEntity, Record<string, string>> = {
  projects: {
    id: 'p.id',
    title: 'p.title',
    description: 'p.description',
    status: 'p.status',
    priority: 'p.priority',
    tenantId: 'p.tenant_id',
    executorIds: 'p.executor_ids',
    responsibleIds: 'p.responsible_ids',
    dueDatePreliminary: 'p.due_date_preliminary',
    createdAt: 'p.created_at',
    updatedAt: 'p.updated_at',
  },
  installations: {
    id: 'i.id',
    title: 'i.title',
    description: 'i.description',
    status: 'i.status',
    stage: 'i.installation_stage',
    priority: 'i.priority',
    tenantId: 'i.tenant_id',
    executorIds: 'i.executor_ids',
    responsibleIds: 'i.responsible_ids',
    dueDatePreliminary: 'i.due_date_preliminary',
    createdAt: 'i.created_at',
    updatedAt: 'i.updated_at',
  },
  service_requests: {
    id: 's.id',
    title: 's.title',
    description: 's.description',
    status: 's.status',
    priority: 's.priority',
    maintenanceItemId: 's.maintenance_item_id',
    assignedToId: 's.assigned_to_id',
    createdAt: 's.created_at',
    updatedAt: 's.updated_at',
  },
};

const buildWhereClause = (entityType: ReportEntity, filters: ReportFilter[]): { clause: string; values: any[] } => {
  if (!filters || filters.length === 0) {
    return { clause: '', values: [] };
  }

  const fieldMap = ENTITY_FIELD_MAP[entityType];
  const conditions: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  for (const filter of filters) {
    const dbField = fieldMap[filter.field];
    if (!dbField) continue;

    switch (filter.operator) {
      case 'eq':
        conditions.push(`${dbField} = $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'ne':
        conditions.push(`${dbField} != $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'gt':
        conditions.push(`${dbField} > $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'lt':
        if (filter.value === 'now') {
          conditions.push(`${dbField} < now()`);
        } else {
          conditions.push(`${dbField} < $${paramIndex}`);
          values.push(filter.value);
          paramIndex++;
        }
        break;
      case 'gte':
        conditions.push(`${dbField} >= $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'lte':
        conditions.push(`${dbField} <= $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'in':
        conditions.push(`${dbField} = any($${paramIndex}::text[])`);
        values.push(Array.isArray(filter.value) ? filter.value : [filter.value]);
        paramIndex++;
        break;
      case 'contains':
        conditions.push(`${dbField}::text ilike $${paramIndex} escape '\\'`);
        values.push(`%${String(filter.value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`);
        paramIndex++;
        break;
    }
  }

  return {
    clause: conditions.length > 0 ? `where ${conditions.join(' and ')}` : '',
    values,
  };
};

export const executeReport = async (entityType: ReportEntity, config: ReportConfig): Promise<any[]> => {
  const startTime = Date.now();
  const table = ENTITY_TABLE_MAP[entityType];
  const fieldMap = ENTITY_FIELD_MAP[entityType];
  const alias = table[0];

  // Build SELECT clause
  const selectFields = config.fields
    .map((field) => {
      const dbField = fieldMap[field];
      return dbField ? `${dbField} as "${field}"` : null;
    })
    .filter(Boolean);

  if (selectFields.length === 0) {
    selectFields.push(`${alias}.id as "id"`);
  }

  // Build WHERE clause
  const { clause: whereClause, values } = buildWhereClause(entityType, config.filters || []);

  // Build GROUP BY clause
  let groupByClause = '';
  if (config.groupBy) {
    const groupField = fieldMap[config.groupBy];
    if (groupField) {
      groupByClause = `group by ${groupField}`;
    }
  }

  // Build aggregations
  let aggregationFields = '';
  if (config.aggregations && config.aggregations.length > 0) {
    const aggParts = config.aggregations
      .map((agg) => {
        const aggField = fieldMap[agg.field] || `${alias}.id`;
        return `${agg.function}(${aggField}) as "${agg.function}_${agg.field}"`;
      })
      .join(', ');
    if (aggParts) {
      aggregationFields = ', ' + aggParts;
    }
  }

  // Build ORDER BY clause
  let orderByClause = '';
  if (config.orderBy) {
    const orderField = fieldMap[config.orderBy];
    if (orderField) {
      const direction = config.orderDirection === 'desc' ? 'desc' : 'asc';
      orderByClause = `order by ${orderField} ${direction}`;
    }
  }

  // Build LIMIT clause
  const limitClause = config.limit ? `limit ${Math.min(10000, Math.max(1, config.limit))}` : 'limit 1000';

  const query = `
    select ${selectFields.join(', ')}${aggregationFields}
    from ${table} ${alias}
    ${whereClause}
    ${groupByClause}
    ${orderByClause}
    ${limitClause}
  `;

  logger.info('Executing report query', { entityType, query: query.substring(0, 200) });

  const result = await dbQuery(query, values);
  const executionTime = Date.now() - startTime;

  logger.info('Report executed', { entityType, rowCount: result.rows.length, executionTime });

  return result.rows;
};

export const listReportDefinitions = async (params: { entityType?: ReportEntity; limit?: number; offset?: number } = {}) => {
  let whereClause = '';
  const values: any[] = [];

  if (params.entityType) {
    whereClause = 'where entity_type = $1';
    values.push(params.entityType);
  }

  const limit = Math.max(1, Math.min(200, params.limit || 50));
  const offset = Math.max(0, params.offset || 0);

  const result = await dbQuery(
    `select
      id::text,
      name,
      description,
      entity_type as "entityType",
      config,
      created_by::text as "createdBy",
      created_at as "createdAt",
      updated_at as "updatedAt",
      is_predefined as "isPredefined"
    from report_definitions
    ${whereClause}
    order by is_predefined desc, created_at desc
    limit $${values.length + 1}
    offset $${values.length + 2}`,
    [...values, limit, offset]
  );

  const totalResult = await dbQuery(
    `select count(*)::int as total from report_definitions ${whereClause}`,
    values
  );

  return {
    items: result.rows,
    total: totalResult.rows[0]?.total || 0,
  };
};

export const getReportDefinition = async (id: string): Promise<ReportDefinition | null> => {
  const result = await dbQuery(
    `select
      id::text,
      name,
      description,
      entity_type as "entityType",
      config,
      created_by::text as "createdBy",
      created_at as "createdAt",
      updated_at as "updatedAt",
      is_predefined as "isPredefined"
    from report_definitions
    where id = $1::uuid`,
    [id]
  );

  return result.rows[0] || null;
};

export const createReportDefinition = async (data: {
  name: string;
  description?: string;
  entityType: ReportEntity;
  config: ReportConfig;
  createdBy: string;
}): Promise<ReportDefinition> => {
  const result = await dbQuery(
    `insert into report_definitions (name, description, entity_type, config, created_by)
    values ($1, $2, $3, $4, $5::uuid)
    returning
      id::text,
      name,
      description,
      entity_type as "entityType",
      config,
      created_by::text as "createdBy",
      created_at as "createdAt",
      updated_at as "updatedAt",
      is_predefined as "isPredefined"`,
    [data.name, data.description || null, data.entityType, JSON.stringify(data.config), data.createdBy]
  );

  return result.rows[0];
};

export const updateReportDefinition = async (
  id: string,
  data: {
    name?: string;
    description?: string;
    config?: ReportConfig;
  }
): Promise<ReportDefinition | null> => {
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    updates.push(`name = $${paramIndex}`);
    values.push(data.name);
    paramIndex++;
  }

  if (data.description !== undefined) {
    updates.push(`description = $${paramIndex}`);
    values.push(data.description);
    paramIndex++;
  }

  if (data.config !== undefined) {
    updates.push(`config = $${paramIndex}`);
    values.push(JSON.stringify(data.config));
    paramIndex++;
  }

  if (updates.length === 0) {
    return getReportDefinition(id);
  }

  updates.push(`updated_at = now()`);
  values.push(id);

  const result = await dbQuery(
    `update report_definitions
    set ${updates.join(', ')}
    where id = $${paramIndex}::uuid and is_predefined = false
    returning
      id::text,
      name,
      description,
      entity_type as "entityType",
      config,
      created_by::text as "createdBy",
      created_at as "createdAt",
      updated_at as "updatedAt",
      is_predefined as "isPredefined"`,
    values
  );

  return result.rows[0] || null;
};

export const deleteReportDefinition = async (id: string): Promise<boolean> => {
  const result = await dbQuery(
    `delete from report_definitions where id = $1::uuid and is_predefined = false`,
    [id]
  );

  return (result.rowCount || 0) > 0;
};

// Scheduled Reports

export const listScheduledReports = async (params: { limit?: number; offset?: number } = {}) => {
  const limit = Math.max(1, Math.min(200, params.limit || 50));
  const offset = Math.max(0, params.offset || 0);

  const result = await dbQuery(
    `select
      id::text,
      report_definition_id::text as "reportDefinitionId",
      name,
      schedule,
      delivery_method as "deliveryMethod",
      delivery_config as "deliveryConfig",
      recipient_ids::text[] as "recipientIds",
      is_active as "isActive",
      last_run_at as "lastRunAt",
      next_run_at as "nextRunAt",
      created_by::text as "createdBy",
      created_at as "createdAt",
      updated_at as "updatedAt"
    from scheduled_reports
    order by created_at desc
    limit $1
    offset $2`,
    [limit, offset]
  );

  const totalResult = await dbQuery(`select count(*)::int as total from scheduled_reports`);

  return {
    items: result.rows,
    total: totalResult.rows[0]?.total || 0,
  };
};

export const createScheduledReport = async (data: {
  reportDefinitionId: string;
  name: string;
  schedule: 'daily' | 'weekly' | 'monthly';
  deliveryMethod: 'email' | 'telegram' | 'both';
  deliveryConfig?: Record<string, any>;
  recipientIds: string[];
  createdBy: string;
}): Promise<ScheduledReport> => {
  const nextRunAt = calculateNextRunTime(data.schedule);

  const result = await dbQuery(
    `insert into scheduled_reports (
      report_definition_id, name, schedule, delivery_method, delivery_config,
      recipient_ids, next_run_at, created_by
    )
    values ($1::uuid, $2, $3, $4, $5, $6::uuid[], $7, $8::uuid)
    returning
      id::text,
      report_definition_id::text as "reportDefinitionId",
      name,
      schedule,
      delivery_method as "deliveryMethod",
      delivery_config as "deliveryConfig",
      recipient_ids::text[] as "recipientIds",
      is_active as "isActive",
      last_run_at as "lastRunAt",
      next_run_at as "nextRunAt",
      created_by::text as "createdBy",
      created_at as "createdAt",
      updated_at as "updatedAt"`,
    [
      data.reportDefinitionId,
      data.name,
      data.schedule,
      data.deliveryMethod,
      JSON.stringify(data.deliveryConfig || {}),
      data.recipientIds,
      nextRunAt,
      data.createdBy,
    ]
  );

  return result.rows[0];
};

export const updateScheduledReport = async (
  id: string,
  data: {
    name?: string;
    schedule?: 'daily' | 'weekly' | 'monthly';
    deliveryMethod?: 'email' | 'telegram' | 'both';
    deliveryConfig?: Record<string, any>;
    recipientIds?: string[];
    isActive?: boolean;
  }
): Promise<ScheduledReport | null> => {
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    updates.push(`name = $${paramIndex}`);
    values.push(data.name);
    paramIndex++;
  }

  if (data.schedule !== undefined) {
    updates.push(`schedule = $${paramIndex}`);
    values.push(data.schedule);
    paramIndex++;
    const nextRunAt = calculateNextRunTime(data.schedule);
    updates.push(`next_run_at = $${paramIndex}`);
    values.push(nextRunAt);
    paramIndex++;
  }

  if (data.deliveryMethod !== undefined) {
    updates.push(`delivery_method = $${paramIndex}`);
    values.push(data.deliveryMethod);
    paramIndex++;
  }

  if (data.deliveryConfig !== undefined) {
    updates.push(`delivery_config = $${paramIndex}`);
    values.push(JSON.stringify(data.deliveryConfig));
    paramIndex++;
  }

  if (data.recipientIds !== undefined) {
    updates.push(`recipient_ids = $${paramIndex}::uuid[]`);
    values.push(data.recipientIds);
    paramIndex++;
  }

  if (data.isActive !== undefined) {
    updates.push(`is_active = $${paramIndex}`);
    values.push(data.isActive);
    paramIndex++;
  }

  if (updates.length === 0) {
    return null;
  }

  updates.push(`updated_at = now()`);
  values.push(id);

  const result = await dbQuery(
    `update scheduled_reports
    set ${updates.join(', ')}
    where id = $${paramIndex}::uuid
    returning
      id::text,
      report_definition_id::text as "reportDefinitionId",
      name,
      schedule,
      delivery_method as "deliveryMethod",
      delivery_config as "deliveryConfig",
      recipient_ids::text[] as "recipientIds",
      is_active as "isActive",
      last_run_at as "lastRunAt",
      next_run_at as "nextRunAt",
      created_by::text as "createdBy",
      created_at as "createdAt",
      updated_at as "updatedAt"`,
    values
  );

  return result.rows[0] || null;
};

export const deleteScheduledReport = async (id: string): Promise<boolean> => {
  const result = await dbQuery(`delete from scheduled_reports where id = $1::uuid`, [id]);
  return (result.rowCount || 0) > 0;
};

const calculateNextRunTime = (schedule: 'daily' | 'weekly' | 'monthly'): string => {
  const now = new Date();
  const next = new Date(now);

  switch (schedule) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
      break;
    case 'weekly':
      next.setDate(next.getDate() + (7 - next.getDay() + 1)); // Next Monday
      next.setHours(9, 0, 0, 0);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      next.setDate(1);
      next.setHours(9, 0, 0, 0);
      break;
  }

  return next.toISOString();
};

// Export functions

export const exportReportToCsv = (data: any[]): string => {
  if (data.length === 0) {
    return '';
  }

  const headers = Object.keys(data[0]);
  const rows = data.map((row) => headers.map((header) => {
    const value = row[header];
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  }));

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
};

export const exportReportToExcel = async (response: Response, filename: string, data: any[]): Promise<void> => {
  if (data.length === 0) {
    throw new Error('No data to export');
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Новинжстрой';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Отчет');

  const headers = Object.keys(data[0]);
  sheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: 20,
  }));

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
  headerRow.height = 22;

  // Add data rows
  for (const row of data) {
    sheet.addRow(row);
  }

  // Auto-filter on header
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };

  // Freeze header row
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const safeFilename = filename.replace(/[^a-zA-Z0-9_\-\.а-яА-ЯёЁ]/g, '_');
  response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}.xlsx`);

  await workbook.xlsx.write(response);
  response.end();
};

export const recordReportExecution = async (params: {
  scheduledReportId?: string;
  reportDefinitionId?: string;
  executedBy?: string;
  status: 'success' | 'failed';
  errorMessage?: string;
  rowCount?: number;
  executionTimeMs?: number;
}): Promise<void> => {
  await dbQuery(
    `insert into report_executions (
      scheduled_report_id, report_definition_id, executed_by, status,
      error_message, row_count, execution_time_ms
    )
    values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7)`,
    [
      params.scheduledReportId || null,
      params.reportDefinitionId || null,
      params.executedBy || null,
      params.status,
      params.errorMessage || null,
      params.rowCount || null,
      params.executionTimeMs || null,
    ]
  );
};
