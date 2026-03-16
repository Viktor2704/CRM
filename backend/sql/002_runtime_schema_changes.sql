-- PostgreSQL migration: move legacy runtime DDL into explicit versioned SQL.
-- Safe to run repeatedly on databases already mutated by the old ensure*Schema bootstrap.

-- ============================================================
-- Requests, projects, service requests, installations
-- ============================================================

alter table requests add column if not exists is_project boolean not null default false;
alter table requests add column if not exists title text;
alter table requests add column if not exists description text not null default '';
alter table requests add column if not exists tenant_id text;
alter table requests add column if not exists direction_id text;
alter table requests add column if not exists system_type text;
alter table requests add column if not exists priority text;
alter table requests add column if not exists created_by_id text;
alter table requests add column if not exists executor_ids text[] not null default '{}'::text[];
alter table requests add column if not exists due_date_preliminary date;
alter table requests add column if not exists due_date_admin date;
alter table requests add column if not exists files jsonb not null default '[]'::jsonb;
alter table requests add column if not exists deleted_at timestamptz;
alter table requests add column if not exists curator_id text;
alter table requests add column if not exists resolution jsonb;
alter table requests add column if not exists maintenance_data jsonb;
alter table requests add column if not exists operation_data jsonb;
alter table requests add column if not exists general_data jsonb;
alter table requests add column if not exists bulk_id text;
alter table requests add column if not exists item_ids text[] not null default '{}'::text[];
alter table requests add column if not exists system_types text[] not null default '{}'::text[];
alter table requests add column if not exists visit_date date;
alter table requests add column if not exists is_overdue boolean not null default false;
alter table requests add column if not exists paused_from_stage text;
alter table requests add column if not exists cancel_reason text;
alter table requests add column if not exists cancel_comment text;
alter table requests add column if not exists pause_reason text;

create index if not exists idx_requests_projects_scope
  on requests(type, is_project, status, created_at desc);
create index if not exists idx_requests_projects_live
  on requests(type, is_project, deleted_at, created_at desc);
create index if not exists idx_requests_projects_tenant
  on requests(tenant_id)
  where type = 'installation' and is_project = true;
create index if not exists idx_requests_projects_direction
  on requests(direction_id)
  where type = 'installation' and is_project = true;
create index if not exists idx_requests_projects_due
  on requests(due_date_preliminary)
  where type = 'installation' and is_project = true;
create index if not exists idx_requests_projects_due_admin
  on requests(due_date_admin)
  where type = 'installation' and is_project = true;
create index if not exists idx_requests_projects_executor_ids
  on requests using gin(executor_ids);
create index if not exists idx_requests_projects_search
  on requests using gin(to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '')))
  where type = 'installation' and is_project = true;
create index if not exists idx_requests_service_type
  on requests(type)
  where type <> 'installation';
create index if not exists idx_requests_service_status
  on requests(status)
  where type <> 'installation';
create index if not exists idx_requests_installations_status
  on requests(status, created_at desc)
  where type = 'installation' and is_project = false and deleted_at is null;

create table if not exists project_events(
  id uuid primary key,
  project_id uuid not null references requests(id) on delete cascade,
  event_type text not null,
  severity text not null default 'info',
  actor_user_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_project_events_project_created
  on project_events(project_id, created_at desc);

create table if not exists project_tz_revisions(
  id uuid primary key,
  project_id uuid not null references requests(id) on delete cascade,
  revision_no integer not null,
  old_value text not null default '',
  new_value text not null default '',
  reason text not null default '',
  changed_by uuid,
  changed_at timestamptz not null default now(),
  event_type text not null default 'manual_edit',
  metadata jsonb not null default '{}'::jsonb,
  unique(project_id, revision_no)
);
create index if not exists idx_project_tz_revisions_project_changed
  on project_tz_revisions(project_id, changed_at desc);

create table if not exists project_chat_messages(
  id uuid primary key,
  project_id uuid not null references requests(id) on delete cascade,
  author_id uuid,
  visibility text not null default 'client-visible',
  text text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index if not exists idx_project_chat_messages_project_created
  on project_chat_messages(project_id, created_at desc);
create index if not exists idx_project_chat_messages_visibility
  on project_chat_messages(project_id, visibility, created_at desc);
alter table project_chat_messages add column if not exists is_pinned boolean not null default false;

create table if not exists installation_stage_deadlines (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references requests(id) on delete cascade,
  stage text not null,
  due_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(installation_id, stage)
);
create index if not exists idx_inst_stage_deadlines_inst
  on installation_stage_deadlines(installation_id);
create index if not exists idx_inst_stage_deadlines_due
  on installation_stage_deadlines(due_date);

create table if not exists installation_procurement_items (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references requests(id) on delete cascade,
  name text not null default '',
  quantity integer not null default 1,
  unit text not null default 'шт',
  comment text not null default '',
  link text not null default '',
  status text not null default 'needed',
  responsible_user_id uuid,
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_inst_procurement_items_inst
  on installation_procurement_items(installation_id);
create index if not exists idx_inst_procurement_items_status
  on installation_procurement_items(installation_id, status);

-- ============================================================
-- Directions, contracts, maintenance items
-- ============================================================

alter table directions add column if not exists name text not null default '';
alter table directions add column if not exists address text not null default '';
alter table directions add column if not exists tenant_id text;
alter table directions add column if not exists description text not null default '';
alter table directions add column if not exists created_by_id text;
alter table directions add column if not exists created_at timestamptz not null default now();
alter table directions add column if not exists updated_at timestamptz not null default now();
alter table directions add column if not exists deleted_at timestamptz;
create index if not exists idx_directions_tenant
  on directions(tenant_id)
  where deleted_at is null;
create index if not exists idx_directions_name
  on directions using gin(to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(address, '')))
  where deleted_at is null;

alter table contracts add column if not exists type text not null default 'MAINTENANCE';
alter table contracts add column if not exists start_date date;
alter table contracts add column if not exists end_date date;
alter table contracts add column if not exists status text not null default 'DRAFT';
alter table contracts add column if not exists description text;
alter table contracts add column if not exists created_at timestamptz not null default now();
alter table contracts add column if not exists updated_at timestamptz not null default now();
alter table contracts add column if not exists deleted_at timestamptz;

alter table maintenance_items add column if not exists deleted_at timestamptz;
alter table maintenance_items add column if not exists position_number text not null default '';
alter table maintenance_items add column if not exists legal_entity text not null default '';
alter table maintenance_items add column if not exists contract_number text not null default '';
alter table maintenance_items add column if not exists tenant_id uuid;
create index if not exists idx_maintenance_items_direction
  on maintenance_items(direction_id)
  where deleted_at is null;
create index if not exists idx_maintenance_items_tenant
  on maintenance_items(tenant_id)
  where deleted_at is null;

create table if not exists checkins(
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  direction_id text not null default '',
  user_id text not null default '',
  user_name text not null default '',
  token text not null default '',
  latitude double precision,
  longitude double precision,
  checked_in_at timestamptz not null default now()
);
create index if not exists idx_checkins_item
  on checkins(item_id, checked_in_at desc);
create index if not exists idx_checkins_user
  on checkins(user_id, checked_in_at desc);

-- ============================================================
-- Maintenance planning
-- ============================================================

create table if not exists maintenance_plans(
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  maintenance_item_ids text[] not null default '{}'::text[],
  system_type text not null default '',
  frequency text not null default 'monthly',
  day_of_month int not null default 1,
  lead_days int not null default 5,
  workday_rule text not null default 'PREVIOUS_WORKDAY',
  valid_from date not null default current_date,
  valid_to date,
  is_active boolean not null default true,
  default_executor_ids text[] not null default '{}'::text[],
  last_generated timestamptz,
  created_by_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists maintenance_plan_confirmations(
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  action text not null default 'confirm',
  token text not null default '',
  responded_by text,
  confirmed_at timestamptz not null default now(),
  unique(plan_id, token)
);

alter table maintenance_plans add column if not exists contact_person text not null default '';
alter table maintenance_plans add column if not exists contact_phone text not null default '';
alter table maintenance_plans add column if not exists confirmation_sent_at timestamptz;
alter table maintenance_plans add column if not exists escalation_48h_sent boolean not null default false;
alter table maintenance_plans add column if not exists escalation_72h_sent boolean not null default false;
alter table maintenance_plans add column if not exists visit_reminder_sent boolean not null default false;
alter table maintenance_plans add column if not exists report_reminder_sent boolean not null default false;
alter table maintenance_plans add column if not exists name text not null default '';
alter table maintenance_plans add column if not exists direction_id text;
alter table maintenance_plans add column if not exists status text not null default 'active';
alter table maintenance_plans add column if not exists arrival_from_day int not null default 1;
alter table maintenance_plans add column if not exists arrival_to_day int not null default 28;
alter table maintenance_plans add column if not exists period_offset int not null default 1;
alter table maintenance_plans add column if not exists update_mode text not null default 'skip';
alter table maintenance_plans add column if not exists send_email boolean not null default false;
alter table maintenance_plans add column if not exists notify_executor boolean not null default true;
alter table maintenance_plans add column if not exists notify_manager boolean not null default true;
alter table maintenance_plans add column if not exists deleted_at timestamptz;
alter table maintenance_plans add column if not exists description text not null default '';

create table if not exists ppr_generated_request_link(
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  object_id text not null,
  period_start date not null,
  period_end date not null,
  request_id uuid not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create unique index if not exists uq_ppr_link_plan_obj_period
  on ppr_generated_request_link(plan_id, object_id, period_start, period_end)
  where status = 'active';

create table if not exists maintenance_generation_runs(
  id uuid primary key default gen_random_uuid(),
  executed_by_id text,
  period_month int not null,
  period_year int not null,
  period_start date not null,
  period_end date not null,
  mode text not null default 'execute',
  total_created int not null default 0,
  total_skipped int not null default 0,
  total_errors int not null default 0,
  coverage jsonb not null default '{}'::jsonb,
  details jsonb not null default '[]'::jsonb,
  executed_at timestamptz not null default now()
);
alter table maintenance_generation_runs add column if not exists plan_id uuid;
alter table maintenance_generation_runs add column if not exists total_updated int not null default 0;

-- ============================================================
-- Notifications, telegram, uploaded files, feedback
-- ============================================================

create table if not exists app_notifications(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  event_type text not null,
  title text not null default '',
  body text not null default '',
  entity_type text not null default '',
  entity_id text not null default '',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_app_notifications_user
  on app_notifications(user_id, is_read, created_at desc);

alter table app_users add column if not exists telegram_chat_id text;

create table if not exists telegram_link_tokens(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  token text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz
);
create index if not exists idx_telegram_link_tokens_token
  on telegram_link_tokens(token)
  where used_at is null;

create table if not exists uploaded_files (
  id uuid primary key,
  storage_key text not null unique,
  file_name text not null default '',
  mime_type text not null default '',
  size_bytes integer not null default 0,
  uploaded_by_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists uploaded_files_uploaded_by_idx
  on uploaded_files(uploaded_by_id, created_at desc);

create table if not exists ai_feedback(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  endpoint text not null,
  entity_id text,
  rating text not null check(rating in ('positive', 'negative')),
  source text,
  provider text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_feedback_endpoint
  on ai_feedback(endpoint, created_at desc);
create index if not exists idx_ai_feedback_user
  on ai_feedback(user_id, created_at desc);

create table if not exists app_notification_dedupe (
  dedupe_key text primary key,
  last_seen_at timestamptz not null default now()
);
create index if not exists idx_app_notification_dedupe_last_seen_at
  on app_notification_dedupe(last_seen_at);

create table if not exists app_notification_digest_queue (
  id bigserial primary key,
  recipient_email text not null,
  recipient_name text not null default 'клиент',
  recipient_client_id text,
  recipient_user_id text,
  scope text not null default 'ticket',
  ticket_id text not null default '-',
  ticket_title text not null default 'Без названия',
  event_type text not null,
  ticket_url text not null default '-',
  support_signature text,
  company text not null default 'ЮЭТКА',
  support_name text not null default 'Служба поддержки',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table app_notification_digest_queue add column if not exists recipient_client_id text;
alter table app_notification_digest_queue add column if not exists recipient_user_id text;
alter table app_notification_digest_queue add column if not exists scope text not null default 'ticket';
create index if not exists idx_app_notification_digest_queue_pending
  on app_notification_digest_queue(sent_at, created_at);

create table if not exists app_notification_event_log (
  id bigserial primary key,
  scope text not null default 'ticket',
  project_id uuid,
  ticket_id text not null default '-',
  event_type text,
  severity text,
  recipient_email text,
  recipient_name text,
  actor_user_id uuid,
  actor_role text,
  request_id text,
  ip text,
  delivery text not null,
  sent boolean not null default false,
  reason text,
  dedupe_key text,
  payload jsonb not null default '{}'::jsonb,
  error jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_app_notification_event_log_project_created
  on app_notification_event_log(project_id, created_at desc);
create index if not exists idx_app_notification_event_log_recipient_created
  on app_notification_event_log(recipient_email, created_at desc);

create table if not exists app_notification_runtime_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Misc feature tables
-- ============================================================

create table if not exists access_requests (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  object_name text not null default '',
  direction_id uuid,
  file_id text,
  file_name text,
  file_url text,
  expires_at date not null,
  status text not null default 'active',
  created_by_id uuid,
  notified_24h boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default '',
  description text not null default '',
  event_date date not null,
  color text not null default 'green',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists sppz_journal_entries (
  id text primary key,
  direction_id uuid,
  maintenance_item_id uuid,
  contractor_id uuid,
  object_key text,
  event_datetime text not null,
  entry_timestamp text not null,
  status text not null default 'draft',
  section text,
  record_type text,
  signature_mode text,
  correction_of_id text,
  entry_data jsonb not null default '{}'::jsonb,
  executor_signed_at text,
  executor_signed_by uuid,
  customer_signed_at text,
  customer_signed_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists sppz_journal_customer_sign_tokens (
  id text primary key,
  token text not null unique,
  contractor_id uuid not null,
  contractor_name text not null default '',
  contractor_email text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_sent_at timestamptz,
  last_sent_entry_id text,
  last_used_at timestamptz,
  last_used_ip text,
  revoked_at timestamptz
);

create table if not exists sppz_journal_audit_log (
  id bigserial primary key,
  entry_id text,
  action text not null,
  actor_id uuid,
  actor_role text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists sppz_journal_license_checks (
  id text primary key,
  checked_at timestamptz not null default now(),
  checked_by uuid,
  source text not null default 'manual',
  license_number text,
  contractor_inn text,
  contractor_name text,
  result_status text not null default 'unknown',
  message text,
  response_payload jsonb not null default '{}'::jsonb
);

create index if not exists sppz_journal_entries_direction_idx
  on sppz_journal_entries(direction_id);
create index if not exists sppz_journal_entries_status_idx
  on sppz_journal_entries(status);
create index if not exists sppz_journal_entries_event_idx
  on sppz_journal_entries(event_datetime desc);
create index if not exists sppz_journal_entries_contractor_idx
  on sppz_journal_entries(contractor_id, status);
create index if not exists sppz_journal_sign_tokens_contractor_idx
  on sppz_journal_customer_sign_tokens(contractor_id, expires_at desc);
create index if not exists sppz_journal_audit_entry_idx
  on sppz_journal_audit_log(entry_id, created_at desc);
create index if not exists sppz_journal_license_checks_time_idx
  on sppz_journal_license_checks(checked_at desc);
