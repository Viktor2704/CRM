import { dbQuery } from '../db.js';
let ensureNotificationSchemaPromise = null;
let ensureTelegramSchemaPromise = null;
export const ensureNotificationSchema = async () => {
    if (ensureNotificationSchemaPromise) {
        return ensureNotificationSchemaPromise;
    }
    ensureNotificationSchemaPromise = (async () => {
        await dbQuery(`create table if not exists app_notifications(
         id uuid primary key default gen_random_uuid(),
         user_id uuid not null,
         event_type text not null,
         title text not null default '',
         body text not null default '',
         entity_type text not null default '',
         entity_id text not null default '',
         is_read boolean not null default false,
         created_at timestamptz not null default now()
       )`);
        await dbQuery(`create index if not exists idx_app_notifications_user
         on app_notifications(user_id, is_read, created_at desc)`);
    })().catch((error) => {
        ensureNotificationSchemaPromise = null;
        throw error;
    });
    return ensureNotificationSchemaPromise;
};
export const ensureTelegramSchema = async () => {
    if (ensureTelegramSchemaPromise) {
        return ensureTelegramSchemaPromise;
    }
    ensureTelegramSchemaPromise = (async () => {
        await dbQuery(`alter table app_users
       add column if not exists telegram_chat_id text`);
        await dbQuery(`create table if not exists telegram_link_tokens(
         id uuid primary key default gen_random_uuid(),
         user_id uuid not null references app_users(id),
         token text not null unique,
         created_at timestamptz not null default now(),
         expires_at timestamptz not null default now() + interval '10 minutes',
         used_at timestamptz
       )`);
        await dbQuery(`create index if not exists idx_telegram_link_tokens_token
         on telegram_link_tokens(token)
         where used_at is null`);
    })().catch((error) => {
        ensureTelegramSchemaPromise = null;
        throw error;
    });
    return ensureTelegramSchemaPromise;
};
