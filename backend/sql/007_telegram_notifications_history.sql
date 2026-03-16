create table if not exists telegram_notifications(
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete set null,
  telegram_chat_id text not null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  title text,
  body text,
  telegram_message_id text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'read')),
  sent_at timestamptz,
  read_at timestamptz,
  error_message text,
  error_code text,
  retry_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_telegram_notifications_user_unread
  on telegram_notifications(user_id, read_at)
  where read_at is null;

create index if not exists idx_telegram_notifications_status
  on telegram_notifications(status, created_at);

