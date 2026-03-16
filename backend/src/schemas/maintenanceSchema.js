import { dbQuery } from '../db.js';
let ensureMaintenanceSchemaPromise = null;
export const ensureMaintenanceSchema = async () => {
    if (ensureMaintenanceSchemaPromise) {
        return ensureMaintenanceSchemaPromise;
    }
    ensureMaintenanceSchemaPromise = (async () => {
        await dbQuery(`create table if not exists maintenance_plans(
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
       )`);
        await dbQuery(`create table if not exists maintenance_plan_confirmations(
         id uuid primary key default gen_random_uuid(),
         plan_id uuid not null,
         action text not null default 'confirm',
         token text not null default '',
         responded_by text,
         confirmed_at timestamptz not null default now(),
         unique(plan_id, token)
       )`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists contact_person text not null default ''`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists contact_phone text not null default ''`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists confirmation_sent_at timestamptz`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists escalation_48h_sent boolean not null default false`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists escalation_72h_sent boolean not null default false`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists visit_reminder_sent boolean not null default false`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists report_reminder_sent boolean not null default false`);
        // ── New PPR fields ──────────────────────────────────────────────
        await dbQuery(`alter table maintenance_plans
       add column if not exists name text not null default ''`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists direction_id text`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists status text not null default 'active'`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists arrival_from_day int not null default 1`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists arrival_to_day int not null default 28`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists period_offset int not null default 1`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists update_mode text not null default 'skip'`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists send_email boolean not null default false`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists notify_executor boolean not null default true`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists notify_manager boolean not null default true`);
        await dbQuery(`alter table maintenance_plans
       add column if not exists deleted_at timestamptz`);
        // ── Anti-duplicate link table ───────────────────────────────────
        await dbQuery(`create table if not exists ppr_generated_request_link(
         id uuid primary key default gen_random_uuid(),
         plan_id uuid not null,
         object_id text not null,
         period_start date not null,
         period_end date not null,
         request_id uuid not null,
         status text not null default 'active',
         created_at timestamptz not null default now()
       )`);
        await dbQuery(`create unique index if not exists uq_ppr_link_plan_obj_period
       on ppr_generated_request_link(plan_id, object_id, period_start, period_end)
       where status = 'active'`);
        await dbQuery(`create table if not exists maintenance_generation_runs(
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
       )`);
        await dbQuery(`alter table maintenance_generation_runs
       add column if not exists plan_id uuid`);
        await dbQuery(`alter table maintenance_generation_runs
       add column if not exists total_updated int not null default 0`);
        // ── Description field ─────────────────────────────────────────
        await dbQuery(`alter table maintenance_plans
       add column if not exists description text not null default ''`);
    })().catch((error) => {
        ensureMaintenanceSchemaPromise = null;
        throw error;
    });
    return ensureMaintenanceSchemaPromise;
};
