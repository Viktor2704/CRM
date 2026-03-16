-- AI Predictions table for storing predictive analytics data

create table if not exists ai_predictions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  prediction_type text not null,
  prediction_value jsonb not null default '{}'::jsonb,
  confidence_score numeric(3,2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists idx_ai_predictions_entity
  on ai_predictions(entity_type, entity_id, prediction_type);

create index if not exists idx_ai_predictions_type
  on ai_predictions(prediction_type, created_at desc);

create index if not exists idx_ai_predictions_expires
  on ai_predictions(expires_at)
  where expires_at is not null;

-- Add sentiment column to service request comments if table exists
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'service_request_comments') then
    alter table service_request_comments add column if not exists sentiment text;
    alter table service_request_comments add column if not exists sentiment_score numeric(3,2);
    alter table service_request_comments add column if not exists is_urgent boolean not null default false;

    create index if not exists idx_service_request_comments_sentiment
      on service_request_comments(sentiment, is_urgent);
  end if;
end $$;

-- Anomaly detection tracking
create table if not exists ai_anomalies (
  id uuid primary key default gen_random_uuid(),
  anomaly_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  severity text not null default 'medium',
  description text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_anomalies_entity
  on ai_anomalies(entity_type, entity_id, created_at desc);

create index if not exists idx_ai_anomalies_type
  on ai_anomalies(anomaly_type, resolved_at, created_at desc);

create index if not exists idx_ai_anomalies_unresolved
  on ai_anomalies(created_at desc)
  where resolved_at is null;
