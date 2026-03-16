create table if not exists email_queue(
  id uuid primary key default gen_random_uuid(),
  to_address text not null,
  from_address text,
  subject text not null,
  text_body text,
  html_body text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'bounced')),
  priority text not null default 'normal' check (priority in ('urgent', 'high', 'normal', 'low')),
  attempts int not null default 0,
  last_error text,
  bounce_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  next_retry_at timestamptz
);

create index if not exists idx_email_queue_status
  on email_queue(status);

create index if not exists idx_email_queue_next_retry_at
  on email_queue(next_retry_at);

create index if not exists idx_email_queue_priority_created
  on email_queue(priority, created_at) where status = 'pending';

create index if not exists idx_email_queue_to_address
  on email_queue(to_address) where status = 'bounced';

