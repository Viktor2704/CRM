import { dbQuery } from '../db.js';
let ensureProjectSchemaPromise = null;
export const ensureProjectSchema = async () => {
    if (ensureProjectSchemaPromise) {
        return ensureProjectSchemaPromise;
    }
    ensureProjectSchemaPromise = (async () => {
        await dbQuery(`alter table requests add column if not exists is_project boolean not null default false`);
        await dbQuery(`alter table requests add column if not exists title text`);
        await dbQuery(`alter table requests add column if not exists description text not null default ''`);
        await dbQuery(`alter table requests add column if not exists tenant_id text`);
        await dbQuery(`alter table requests add column if not exists direction_id text`);
        await dbQuery(`alter table requests add column if not exists system_type text`);
        await dbQuery(`alter table requests add column if not exists priority text`);
        await dbQuery(`alter table requests add column if not exists status text not null default 'new'`);
        await dbQuery(`alter table requests add column if not exists created_by_id text`);
        await dbQuery(`alter table requests add column if not exists executor_ids text[] not null default '{}'::text[]`);
        await dbQuery(`alter table requests add column if not exists due_date_preliminary date`);
        await dbQuery(`alter table requests add column if not exists due_date_admin date`);
        await dbQuery(`alter table requests add column if not exists files jsonb not null default '[]'::jsonb`);
        await dbQuery(`alter table requests add column if not exists deleted_at timestamptz`);
        await dbQuery(`alter table requests add column if not exists created_at timestamptz not null default now()`);
        await dbQuery(`alter table requests add column if not exists updated_at timestamptz not null default now()`);
        await dbQuery(`create index if not exists idx_requests_projects_scope on requests(type, is_project, status, created_at desc)`);
        await dbQuery(`create index if not exists idx_requests_projects_live on requests(type, is_project, deleted_at, created_at desc)`);
        await dbQuery(`create index if not exists idx_requests_projects_tenant on requests(tenant_id) where type = 'installation' and is_project = true`);
        await dbQuery(`create index if not exists idx_requests_projects_direction on requests(direction_id) where type = 'installation' and is_project = true`);
        await dbQuery(`create index if not exists idx_requests_projects_due on requests(due_date_preliminary) where type = 'installation' and is_project = true`);
        await dbQuery(`create index if not exists idx_requests_projects_due_admin on requests(due_date_admin) where type = 'installation' and is_project = true`);
        await dbQuery(`create index if not exists idx_requests_projects_executor_ids on requests using gin(executor_ids)`);
        await dbQuery(`create index if not exists idx_requests_projects_search on requests using gin(to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))) where type = 'installation' and is_project = true`);
        await dbQuery(`create table if not exists project_events(
         id uuid primary key,
         project_id uuid not null references requests(id) on delete cascade,
         event_type text not null,
         severity text not null default 'info',
         actor_user_id uuid,
         payload jsonb not null default '{}'::jsonb,
         created_at timestamptz not null default now()
       )`);
        await dbQuery(`create index if not exists idx_project_events_project_created on project_events(project_id, created_at desc)`);
        await dbQuery(`create table if not exists project_tz_revisions(
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
       )`);
        await dbQuery(`create index if not exists idx_project_tz_revisions_project_changed on project_tz_revisions(project_id, changed_at desc)`);
        await dbQuery(`create table if not exists project_chat_messages(
         id uuid primary key,
         project_id uuid not null references requests(id) on delete cascade,
         author_id uuid,
         visibility text not null default 'client-visible',
         text text not null default '',
         attachments jsonb not null default '[]'::jsonb,
         created_at timestamptz not null default now(),
         edited_at timestamptz,
         deleted_at timestamptz
       )`);
        await dbQuery(`create index if not exists idx_project_chat_messages_project_created on project_chat_messages(project_id, created_at desc)`);
        await dbQuery(`create index if not exists idx_project_chat_messages_visibility on project_chat_messages(project_id, visibility, created_at desc)`);
    })().catch((error) => {
        ensureProjectSchemaPromise = null;
        throw error;
    });
    return ensureProjectSchemaPromise;
};
