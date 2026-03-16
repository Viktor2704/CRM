import { dbQuery } from '../db.js';
let ensureAiFeedbackSchemaPromise = null;
export const ensureAiFeedbackSchema = async () => {
    if (ensureAiFeedbackSchemaPromise) {
        return ensureAiFeedbackSchemaPromise;
    }
    ensureAiFeedbackSchemaPromise = (async () => {
        await dbQuery(`create table if not exists ai_feedback(
         id uuid primary key default gen_random_uuid(),
         user_id uuid not null,
         endpoint text not null,
         entity_id text,
         rating text not null check(rating in ('positive', 'negative')),
         source text,
         provider text,
         created_at timestamptz not null default now()
       )`);
        await dbQuery(`create index if not exists idx_ai_feedback_endpoint
         on ai_feedback(endpoint, created_at desc)`);
        await dbQuery(`create index if not exists idx_ai_feedback_user
         on ai_feedback(user_id, created_at desc)`);
    })().catch((error) => {
        ensureAiFeedbackSchemaPromise = null;
        throw error;
    });
    return ensureAiFeedbackSchemaPromise;
};
