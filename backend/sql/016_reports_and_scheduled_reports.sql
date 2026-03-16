-- Reports and Scheduled Reports Schema

-- Report definitions table
create table if not exists report_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  entity_type text not null check (entity_type in ('projects', 'installations', 'service_requests')),
  config jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_predefined boolean not null default false
);

create index if not exists idx_report_definitions_entity_type on report_definitions(entity_type);
create index if not exists idx_report_definitions_created_by on report_definitions(created_by);

-- Scheduled reports table
create table if not exists scheduled_reports (
  id uuid primary key default gen_random_uuid(),
  report_definition_id uuid references report_definitions(id) on delete cascade,
  name text not null,
  schedule text not null check (schedule in ('daily', 'weekly', 'monthly')),
  delivery_method text not null check (delivery_method in ('email', 'telegram', 'both')),
  delivery_config jsonb not null default '{}'::jsonb,
  recipient_ids uuid[] not null default array[]::uuid[],
  is_active boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_scheduled_reports_next_run on scheduled_reports(next_run_at) where is_active = true;
create index if not exists idx_scheduled_reports_report_def on scheduled_reports(report_definition_id);

-- Report execution history
create table if not exists report_executions (
  id uuid primary key default gen_random_uuid(),
  scheduled_report_id uuid references scheduled_reports(id) on delete cascade,
  report_definition_id uuid references report_definitions(id) on delete set null,
  executed_by uuid references app_users(id) on delete set null,
  status text not null check (status in ('success', 'failed')),
  error_message text,
  row_count int,
  execution_time_ms int,
  executed_at timestamptz not null default now()
);

create index if not exists idx_report_executions_scheduled on report_executions(scheduled_report_id);
create index if not exists idx_report_executions_executed_at on report_executions(executed_at desc);

-- Insert predefined reports
insert into report_definitions (name, description, entity_type, config, is_predefined) values
  ('Проекты по статусам', 'Отчет по проектам с группировкой по статусам', 'projects',
   '{"fields": ["title", "status", "priority", "tenantId", "dueDatePreliminary"], "groupBy": "status", "aggregations": [{"field": "id", "function": "count"}]}'::jsonb, true),

  ('Проекты по исполнителям', 'Отчет по проектам с группировкой по исполнителям', 'projects',
   '{"fields": ["title", "status", "executorIds", "dueDatePreliminary"], "groupBy": "executorIds", "aggregations": [{"field": "id", "function": "count"}]}'::jsonb, true),

  ('Монтажи по стадиям', 'Отчет по монтажам с группировкой по стадиям', 'installations',
   '{"fields": ["title", "stage", "priority", "tenantId", "dueDatePreliminary"], "groupBy": "stage", "aggregations": [{"field": "id", "function": "count"}]}'::jsonb, true),

  ('Заявки по приоритетам', 'Отчет по заявкам с группировкой по приоритетам', 'service_requests',
   '{"fields": ["title", "status", "priority", "maintenanceItemId", "createdAt"], "groupBy": "priority", "aggregations": [{"field": "id", "function": "count"}]}'::jsonb, true),

  ('Просроченные задачи', 'Отчет по всем просроченным задачам', 'projects',
   '{"fields": ["title", "status", "priority", "dueDatePreliminary"], "filters": [{"field": "dueDatePreliminary", "operator": "lt", "value": "now"}], "aggregations": [{"field": "id", "function": "count"}]}'::jsonb, true)
on conflict do nothing;
