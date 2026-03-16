-- Email Advanced Features: DMARC, Tracking, Campaigns, Template Builder

-- DMARC Reports Table
create table if not exists dmarc_reports(
  id uuid primary key default gen_random_uuid(),
  report_id text not null,
  domain text not null,
  reporter_org_name text not null,
  date_range_begin timestamptz not null,
  date_range_end timestamptz not null,
  source_ip text not null,
  count int not null default 0,
  disposition text not null,
  dkim_result text not null,
  spf_result text not null,
  raw_xml text,
  created_at timestamptz not null default now()
);

create index if not exists idx_dmarc_reports_domain on dmarc_reports(domain);
create index if not exists idx_dmarc_reports_date_range on dmarc_reports(date_range_begin, date_range_end);

-- Email Tracking Table
create table if not exists email_tracking(
  id text primary key,
  email_id text not null,
  recipient_email text not null,
  subject text not null,
  campaign_id uuid,
  opened boolean not null default false,
  clicked boolean not null default false,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  first_clicked_at timestamptz,
  last_clicked_at timestamptz,
  open_count int not null default 0,
  click_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_tracking_email_id on email_tracking(email_id);
create index if not exists idx_email_tracking_campaign_id on email_tracking(campaign_id);
create index if not exists idx_email_tracking_recipient on email_tracking(recipient_email);

-- Email Tracking Events Table
create table if not exists email_tracking_events(
  id uuid primary key default gen_random_uuid(),
  tracking_id text not null references email_tracking(id) on delete cascade,
  email_id text not null,
  recipient_email text not null,
  campaign_id uuid,
  event_type text not null check (event_type in ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_tracking_events_tracking_id on email_tracking_events(tracking_id);
create index if not exists idx_email_tracking_events_campaign_id on email_tracking_events(campaign_id);
create index if not exists idx_email_tracking_events_type on email_tracking_events(event_type);
create index if not exists idx_email_tracking_events_created_at on email_tracking_events(created_at);

-- Email Campaigns Table
create table if not exists email_campaigns(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  from_name text not null,
  from_email text not null,
  reply_to text,
  template_id uuid,
  html_content text not null,
  text_content text not null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled')),
  segment_id uuid,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  enable_tracking boolean not null default true,
  enable_ab_testing boolean not null default false,
  ab_test_variants jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_campaigns_status on email_campaigns(status);
create index if not exists idx_email_campaigns_created_by on email_campaigns(created_by);
create index if not exists idx_email_campaigns_scheduled_at on email_campaigns(scheduled_at);

-- Email Campaign Recipients Table
create table if not exists email_campaign_recipients(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references email_campaigns(id) on delete cascade,
  email text not null,
  name text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'bounced', 'unsubscribed')),
  variant_id text,
  sent_at timestamptz,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_email_campaign_recipients_unique on email_campaign_recipients(campaign_id, email);
create index if not exists idx_email_campaign_recipients_campaign_id on email_campaign_recipients(campaign_id);
create index if not exists idx_email_campaign_recipients_status on email_campaign_recipients(status);

-- Email Campaign Segments Table
create table if not exists email_campaign_segments(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  filters jsonb not null default '[]'::jsonb,
  created_by uuid not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_campaign_segments_created_by on email_campaign_segments(created_by);

-- Email Templates Table (enhanced)
create table if not exists email_templates(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  subject text not null,
  category text,
  design jsonb not null default '{}'::jsonb,
  html_content text not null,
  text_content text not null,
  thumbnail_url text,
  is_public boolean not null default false,
  version int not null default 1,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_templates_category on email_templates(category);
create index if not exists idx_email_templates_status on email_templates(status);
create index if not exists idx_email_templates_created_by on email_templates(created_by);

-- Email Template Versions Table
create table if not exists email_template_versions(
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references email_templates(id) on delete cascade,
  version int not null,
  design jsonb not null default '{}'::jsonb,
  html_content text not null,
  text_content text not null,
  change_description text,
  created_by uuid not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_email_template_versions_unique on email_template_versions(template_id, version);
create index if not exists idx_email_template_versions_template_id on email_template_versions(template_id);
