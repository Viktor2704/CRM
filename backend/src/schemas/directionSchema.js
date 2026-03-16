import { dbQuery } from '../db.js';
let ensureDirectionSchemaPromise = null;
export const ensureDirectionSchema = async () => {
    if (ensureDirectionSchemaPromise) {
        return ensureDirectionSchemaPromise;
    }
    ensureDirectionSchemaPromise = (async () => {
        await dbQuery(`create table if not exists directions(
         id uuid primary key default gen_random_uuid(),
         name text not null default '',
         address text not null default '',
         tenant_id text,
         description text not null default '',
         created_by_id text,
         created_at timestamptz not null default now(),
         updated_at timestamptz not null default now(),
         deleted_at timestamptz
       )`);
        await dbQuery(`alter table directions
         add column if not exists name text not null default ''`);
        await dbQuery(`alter table directions
         add column if not exists address text not null default ''`);
        await dbQuery(`alter table directions
         add column if not exists tenant_id text`);
        await dbQuery(`alter table directions
         add column if not exists description text not null default ''`);
        await dbQuery(`alter table directions
         add column if not exists created_by_id text`);
        await dbQuery(`alter table directions
         add column if not exists created_at timestamptz not null default now()`);
        await dbQuery(`alter table directions
         add column if not exists updated_at timestamptz not null default now()`);
        await dbQuery(`alter table directions
         add column if not exists deleted_at timestamptz`);
        await dbQuery(`create index if not exists idx_directions_tenant
         on directions(tenant_id)
         where deleted_at is null`);
        await dbQuery(`create index if not exists idx_directions_name
         on directions using gin(to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(address, '')))
         where deleted_at is null`);
    })().catch((error) => {
        ensureDirectionSchemaPromise = null;
        throw error;
    });
    return ensureDirectionSchemaPromise;
};
