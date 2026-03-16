import { dbQuery } from '../db.js';
let ensureServiceRequestSchemaPromise = null;
export const ensureServiceRequestSchema = async () => {
    if (ensureServiceRequestSchemaPromise) {
        return ensureServiceRequestSchemaPromise;
    }
    ensureServiceRequestSchemaPromise = (async () => {
        await dbQuery(`alter table requests add column if not exists curator_id text`);
        await dbQuery(`alter table requests add column if not exists resolution jsonb`);
        await dbQuery(`alter table requests add column if not exists maintenance_data jsonb`);
        await dbQuery(`alter table requests add column if not exists operation_data jsonb`);
        await dbQuery(`alter table requests add column if not exists general_data jsonb`);
        await dbQuery(`alter table requests add column if not exists bulk_id text`);
        await dbQuery(`alter table requests add column if not exists item_ids text[] not null default '{}'`);
        await dbQuery(`alter table requests add column if not exists system_types text[] not null default '{}'`);
        await dbQuery(`alter table requests add column if not exists visit_date date`);
        await dbQuery(`alter table requests add column if not exists is_overdue boolean not null default false`);
        await dbQuery(`create index if not exists idx_requests_service_type
         on requests(type)
         where type <> 'installation'`);
        await dbQuery(`create index if not exists idx_requests_service_status
         on requests(status)
         where type <> 'installation'`);
    })().catch((error) => {
        ensureServiceRequestSchemaPromise = null;
        throw error;
    });
    return ensureServiceRequestSchemaPromise;
};
