import { dbQuery } from '../db.js';
let ensureMaintenanceItemSchemaPromise = null;
export const ensureMaintenanceItemSchema = async () => {
    if (ensureMaintenanceItemSchemaPromise) {
        return ensureMaintenanceItemSchemaPromise;
    }
    ensureMaintenanceItemSchemaPromise = (async () => {
        await dbQuery(`create table if not exists maintenance_items(
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
       )`);
        await dbQuery(`alter table maintenance_items
         add column if not exists deleted_at timestamptz`);
        await dbQuery(`alter table maintenance_items
         add column if not exists position_number text not null default ''`);
        await dbQuery(`alter table maintenance_items
         add column if not exists legal_entity text not null default ''`);
        await dbQuery(`alter table maintenance_items
         add column if not exists contract_number text not null default ''`);
        await dbQuery(`create index if not exists idx_maintenance_items_direction
         on maintenance_items(direction_id)
         where deleted_at is null`);
        await dbQuery(`create table if not exists checkins(
         id uuid primary key default gen_random_uuid(),
         item_id uuid not null,
         direction_id text not null default '',
         user_id text not null default '',
         user_name text not null default '',
         token text not null default '',
         latitude double precision,
         longitude double precision,
         checked_in_at timestamptz not null default now()
       )`);
        await dbQuery(`create index if not exists idx_checkins_item
         on checkins(item_id, checked_in_at desc)`);
        await dbQuery(`create index if not exists idx_checkins_user
         on checkins(user_id, checked_in_at desc)`);
    })().catch((error) => {
        ensureMaintenanceItemSchemaPromise = null;
        throw error;
    });
    return ensureMaintenanceItemSchemaPromise;
};
