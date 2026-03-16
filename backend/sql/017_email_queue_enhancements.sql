-- Add priority and bounce tracking to email_queue
alter table email_queue
  add column if not exists priority text not null default 'normal' check (priority in ('urgent', 'high', 'normal', 'low'));

alter table email_queue
  add column if not exists bounce_reason text;

-- Update status constraint to include 'bounced'
alter table email_queue
  drop constraint if exists email_queue_status_check;

alter table email_queue
  add constraint email_queue_status_check check (status in ('pending', 'sent', 'failed', 'bounced'));

-- Add indexes for priority-based queue processing
create index if not exists idx_email_queue_priority_created
  on email_queue(priority, created_at) where status = 'pending';

create index if not exists idx_email_queue_to_address
  on email_queue(to_address) where status = 'bounced';
