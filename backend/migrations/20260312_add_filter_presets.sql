-- Migration: Add filter presets and view configurations
-- Created: 2026-03-12

-- Create filter_presets table
CREATE TABLE IF NOT EXISTS filter_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  filter_group JSONB NOT NULL,
  entity_type VARCHAR(50) NOT NULL DEFAULT 'service_request',
  is_shared BOOLEAN NOT NULL DEFAULT false,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_filter_presets_created_by ON filter_presets(created_by);
CREATE INDEX idx_filter_presets_entity_type ON filter_presets(entity_type);
CREATE INDEX idx_filter_presets_is_shared ON filter_presets(is_shared);
CREATE INDEX idx_filter_presets_is_system ON filter_presets(is_system);

-- Create view_configs table
CREATE TABLE IF NOT EXISTS view_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL DEFAULT 'service_request',
  view_type VARCHAR(20) NOT NULL DEFAULT 'table',
  filter_group JSONB,
  group_by_field VARCHAR(50),
  group_by_order VARCHAR(4),
  sort_config JSONB,
  columns JSONB,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT view_type_check CHECK (view_type IN ('table', 'kanban', 'list'))
);

CREATE INDEX idx_view_configs_created_by ON view_configs(created_by);
CREATE INDEX idx_view_configs_entity_type ON view_configs(entity_type);
CREATE INDEX idx_view_configs_is_default ON view_configs(is_default);

-- Insert system filter presets for service requests
INSERT INTO filter_presets (name, description, filter_group, entity_type, is_shared, is_system, created_at, updated_at)
VALUES
  (
    'Активные заявки',
    'Все активные заявки в работе',
    '{"id":"sys1","operator":"and","conditions":[{"id":"c1","field":"status","operator":"in","value":["new","triage","assigned","in_progress","on_site","review"],"fieldType":"select"}],"groups":[]}',
    'service_request',
    true,
    true,
    NOW(),
    NOW()
  ),
  (
    'Критические заявки',
    'Заявки с критическим приоритетом',
    '{"id":"sys2","operator":"and","conditions":[{"id":"c1","field":"priority","operator":"equals","value":"critical","fieldType":"select"}],"groups":[]}',
    'service_request',
    true,
    true,
    NOW(),
    NOW()
  ),
  (
    'Аварийные заявки',
    'Все аварийные заявки',
    '{"id":"sys3","operator":"and","conditions":[{"id":"c1","field":"type","operator":"equals","value":"emergency","fieldType":"select"}],"groups":[]}',
    'service_request',
    true,
    true,
    NOW(),
    NOW()
  ),
  (
    'Мои заявки',
    'Заявки, назначенные на меня',
    '{"id":"sys4","operator":"and","conditions":[{"id":"c1","field":"executor_ids","operator":"contains","value":"{{currentUserId}}","fieldType":"user"}],"groups":[]}',
    'service_request',
    true,
    true,
    NOW(),
    NOW()
  ),
  (
    'Просроченные заявки',
    'Заявки с истекшим сроком',
    '{"id":"sys5","operator":"and","conditions":[{"id":"c1","field":"due_date","operator":"date_before","value":"{{today}}","fieldType":"date"},{"id":"c2","field":"status","operator":"not_in","value":["done","closed","cancelled"],"fieldType":"select"}],"groups":[]}',
    'service_request',
    true,
    true,
    NOW(),
    NOW()
  );

-- Insert system view configs
INSERT INTO view_configs (name, entity_type, view_type, group_by_field, is_default, is_shared, created_at, updated_at)
VALUES
  (
    'Канбан по статусу',
    'service_request',
    'kanban',
    'status',
    false,
    true,
    NOW(),
    NOW()
  ),
  (
    'Канбан по приоритету',
    'service_request',
    'kanban',
    'priority',
    false,
    true,
    NOW(),
    NOW()
  ),
  (
    'Таблица (по умолчанию)',
    'service_request',
    'table',
    NULL,
    true,
    true,
    NOW(),
    NOW()
  );

COMMENT ON TABLE filter_presets IS 'Saved filter presets for advanced filtering';
COMMENT ON TABLE view_configs IS 'View configurations for different entity types';
