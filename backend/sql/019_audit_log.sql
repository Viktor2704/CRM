-- Audit Log Table
-- Tracks all sensitive operations for security and compliance

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Actor information
  user_id uuid references users(id) on delete set null,
  user_email text,
  user_role text,

  -- Action details
  action text not null, -- e.g., 'user.create', 'user.delete', 'role.change', 'data.export'
  resource_type text not null, -- e.g., 'user', 'tenant', 'project', 'report'
  resource_id text, -- ID of the affected resource

  -- Request context
  ip_address inet,
  user_agent text,
  request_method text,
  request_path text,

  -- Additional context
  details jsonb, -- Flexible field for action-specific details
  status text not null default 'success', -- 'success', 'failure', 'error'
  error_message text
);

-- Indexes for efficient querying
create index if not exists idx_audit_log_created_at on audit_log(created_at desc);
create index if not exists idx_audit_log_user_id on audit_log(user_id) where user_id is not null;
create index if not exists idx_audit_log_action on audit_log(action);
create index if not exists idx_audit_log_resource on audit_log(resource_type, resource_id);
create index if not exists idx_audit_log_status on audit_log(status);

-- Composite index for common queries
create index if not exists idx_audit_log_user_action_time on audit_log(user_id, action, created_at desc) where user_id is not null;

-- Add comment for documentation
comment on table audit_log is 'Audit trail for all sensitive operations in the system';
comment on column audit_log.action is 'Action performed, e.g., user.create, user.delete, role.change, data.export';
comment on column audit_log.resource_type is 'Type of resource affected, e.g., user, tenant, project, report';
comment on column audit_log.details is 'JSON object with action-specific details (e.g., old/new values for updates)';
