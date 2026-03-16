-- PostgreSQL migration: auth, users, tokens, bindings, audit.
-- Business tables are created first, then auth/RBAC on top.
-- pgcrypto extension is required for gen_random_uuid().

create extension if not exists pgcrypto;

-- ============================================================
-- Business tables (created IF NOT EXISTS so migration is safe)
-- ============================================================

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  brand_name text not null default '',
  inn text not null default '',
  contacts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  type text not null default '',
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists directions (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  address text not null default '',
  tenant_id text,
  description text not null default '',
  created_by_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists contracts (
  id uuid primary key default gen_random_uuid(),
  number text not null default '',
  type text not null default 'MAINTENANCE',
  direction_id uuid,
  tenant_id uuid,
  start_date date,
  end_date date,
  status text not null default 'DRAFT',
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists maintenance_items (
  id uuid primary key default gen_random_uuid(),
  direction_id text not null,
  position_number text not null default '',
  name text not null default '',
  address text not null default '',
  legal_entity text not null default '',
  contract_number text not null default '',
  systems jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ============================================================
-- Auth, RBAC, tokens, audit
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_user_role') then
    create type app_user_role as enum (
      'admin',
      'manager',
      'dispatcher',
      'curator',
      'executor',
      'client_manager',
      'client_user',
      'user'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'app_user_status') then
    create type app_user_status as enum (
      'active',
      'invited',
      'blocked',
      'deactivated'
    );
  end if;
end $$;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text not null,
  phone text,
  role app_user_role not null,
  status app_user_status not null default 'invited',
  password_hash text not null,
  must_change_password boolean not null default false,
  failed_login_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_users_role on app_users(role);
create index if not exists idx_app_users_status on app_users(status);

create table if not exists app_user_bindings (
  user_id uuid primary key references app_users(id) on delete cascade,
  counterparty_id uuid references tenants(id),
  is_global boolean not null default false
);

create table if not exists app_user_direction_bindings (
  user_id uuid not null references app_users(id) on delete cascade,
  direction_id uuid not null references directions(id),
  primary key (user_id, direction_id)
);

create table if not exists app_user_contract_bindings (
  user_id uuid not null references app_users(id) on delete cascade,
  contract_id uuid not null references contracts(id),
  primary key (user_id, contract_id)
);

create table if not exists app_user_object_bindings (
  user_id uuid not null references app_users(id) on delete cascade,
  object_id uuid not null references maintenance_items(id),
  primary key (user_id, object_id)
);

create table if not exists app_user_project_bindings (
  user_id uuid not null references app_users(id) on delete cascade,
  project_id uuid not null references requests(id),
  primary key (user_id, project_id)
);

create table if not exists auth_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null,
  jti uuid not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by_jti uuid,
  ip inet,
  user_agent text
);

create index if not exists idx_auth_refresh_tokens_user_id on auth_refresh_tokens(user_id);
create index if not exists idx_auth_refresh_tokens_expires_at on auth_refresh_tokens(expires_at);

create table if not exists auth_invite_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  created_by_user_id uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists idx_auth_invite_tokens_user_id on auth_invite_tokens(user_id);
create index if not exists idx_auth_invite_tokens_expires_at on auth_invite_tokens(expires_at);

create table if not exists auth_password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists idx_auth_password_reset_tokens_user_id on auth_password_reset_tokens(user_id);

create table if not exists auth_email_login_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists idx_auth_email_login_tokens_user_id on auth_email_login_tokens(user_id);
create index if not exists idx_auth_email_login_tokens_expires_at on auth_email_login_tokens(expires_at);

create table if not exists auth_login_events (
  id bigserial primary key,
  user_id uuid references app_users(id),
  email text,
  success boolean not null,
  ip inet,
  user_agent text,
  reason_code text,
  created_at timestamptz not null default now()
);

create index if not exists idx_auth_login_events_created_at on auth_login_events(created_at);
create index if not exists idx_auth_login_events_user_id on auth_login_events(user_id);

create table if not exists app_audit_log (
  id bigserial primary key,
  actor_user_id uuid references app_users(id),
  target_user_id uuid references app_users(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_state jsonb,
  after_state jsonb,
  result text not null default 'success',
  error_code text,
  request_id text,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_audit_log_created_at on app_audit_log(created_at);
create index if not exists idx_app_audit_log_target_user_id on app_audit_log(target_user_id);
create index if not exists idx_app_audit_log_action on app_audit_log(action);

create table if not exists app_bootstrap_state (
  singleton boolean primary key default true check (singleton = true),
  first_admin_user_id uuid unique references app_users(id),
  completed_at timestamptz
);

insert into app_bootstrap_state(singleton)
values (true)
on conflict (singleton) do nothing;

-- Updated_at helper.
create or replace function trg_set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_app_users_set_updated_at on app_users;
create trigger trg_app_users_set_updated_at
before update on app_users
for each row
execute function trg_set_updated_at();

-- Validate user bindings at DB layer (server-side guarantee).
create or replace function trg_validate_user_bindings()
returns trigger as $$
declare
  v_user_id uuid;
  v_role app_user_role;
  v_counterparty_id uuid;
  v_has_foreign_contract boolean;
  v_has_foreign_object boolean;
  v_has_non_installation_project boolean;
begin
  v_user_id := coalesce(new.user_id, old.user_id);
  if v_user_id is null then
    return coalesce(new, old);
  end if;

  select role into v_role from app_users where id = v_user_id;
  if v_role is null then
    return coalesce(new, old);
  end if;

  select counterparty_id into v_counterparty_id from app_user_bindings where user_id = v_user_id;

  if v_role in ('client_manager', 'client_user', 'user') then
    if v_counterparty_id is null then
      raise exception using
        message = 'Client must have counterparty_id',
        errcode = 'P0001',
        detail = 'COUNTERPARTY_ID_REQUIRED';
    end if;

    select exists (
      select 1
      from app_user_contract_bindings ucb
      join contracts c on c.id = ucb.contract_id
      where ucb.user_id = v_user_id
        and c.tenant_id is distinct from v_counterparty_id
        and c.contractor_id is distinct from v_counterparty_id
    ) into v_has_foreign_contract;

    if v_has_foreign_contract then
      raise exception using
        message = 'contract_id outside counterparty scope',
        errcode = 'P0001',
        detail = 'COUNTERPARTY_SCOPE_VIOLATION';
    end if;

    select exists (
      select 1
      from app_user_object_bindings uob
      join maintenance_items mi on mi.id = uob.object_id
      left join contracts c on c.number = mi.contract_number
      where uob.user_id = v_user_id
        and (
          c.id is null
          or (
            c.tenant_id is distinct from v_counterparty_id
            and c.contractor_id is distinct from v_counterparty_id
          )
        )
    ) into v_has_foreign_object;

    if v_has_foreign_object then
      raise exception using
        message = 'object_id outside counterparty scope',
        errcode = 'P0001',
        detail = 'COUNTERPARTY_SCOPE_VIOLATION';
    end if;
  end if;

  select exists (
      select 1
      from app_user_project_bindings upb
      join requests r on r.id = upb.project_id
      where upb.user_id = v_user_id
      and r.type <> 'installation'
  ) into v_has_non_installation_project;

  if v_has_non_installation_project then
    raise exception using
      message = 'project_id must reference installation request',
      errcode = 'P0001',
      detail = 'PROJECT_ID_UNKNOWN';
  end if;

  return coalesce(new, old);
end;
$$ language plpgsql;

drop trigger if exists trg_validate_user_bindings_on_bindings on app_user_bindings;
create trigger trg_validate_user_bindings_on_bindings
after insert or update on app_user_bindings
for each row execute function trg_validate_user_bindings();

drop trigger if exists trg_validate_user_bindings_on_direction on app_user_direction_bindings;
create trigger trg_validate_user_bindings_on_direction
after insert or update or delete on app_user_direction_bindings
for each row execute function trg_validate_user_bindings();

drop trigger if exists trg_validate_user_bindings_on_contract on app_user_contract_bindings;
create trigger trg_validate_user_bindings_on_contract
after insert or update or delete on app_user_contract_bindings
for each row execute function trg_validate_user_bindings();

drop trigger if exists trg_validate_user_bindings_on_object on app_user_object_bindings;
create trigger trg_validate_user_bindings_on_object
after insert or update or delete on app_user_object_bindings
for each row execute function trg_validate_user_bindings();

drop trigger if exists trg_validate_user_bindings_on_project on app_user_project_bindings;
create trigger trg_validate_user_bindings_on_project
after insert or update or delete on app_user_project_bindings
for each row execute function trg_validate_user_bindings();

-- One-time bootstrap check helper.
create or replace function can_bootstrap_first_admin()
returns boolean as $$
declare
  v_has_any_user boolean;
  v_completed boolean;
begin
  select exists(select 1 from app_users) into v_has_any_user;
  select completed_at is not null into v_completed
  from app_bootstrap_state
  where singleton = true;

  return (not v_has_any_user) and (not coalesce(v_completed, false));
end;
$$ language plpgsql stable;
