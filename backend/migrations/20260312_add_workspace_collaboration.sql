-- Migration: Add workspace and collaboration features
-- Created: 2026-03-12

-- Create workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(50) NOT NULL DEFAULT 'personal', -- personal, team, role_based
  role VARCHAR(50), -- for role_based workspaces
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_template BOOLEAN NOT NULL DEFAULT false,
  layout JSONB NOT NULL DEFAULT '{"widgets": [], "layout_config": {}}',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT workspace_type_check CHECK (type IN ('personal', 'team', 'role_based'))
);

CREATE INDEX idx_workspaces_owner_id ON workspaces(owner_id);
CREATE INDEX idx_workspaces_type ON workspaces(type);
CREATE INDEX idx_workspaces_role ON workspaces(role);
CREATE INDEX idx_workspaces_is_default ON workspaces(is_default);
CREATE INDEX idx_workspaces_is_template ON workspaces(is_template);

-- Create workspace_members table (for team workspaces)
CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member', -- owner, admin, member, viewer
  added_at TIMESTAMP NOT NULL DEFAULT NOW(),
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(workspace_id, user_id),
  CONSTRAINT workspace_member_role_check CHECK (role IN ('owner', 'admin', 'member', 'viewer'))
);

CREATE INDEX idx_workspace_members_workspace_id ON workspace_members(workspace_id);
CREATE INDEX idx_workspace_members_user_id ON workspace_members(user_id);

-- Create document_shares table
CREATE TABLE IF NOT EXISTS document_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(100) NOT NULL, -- service_request, project, installation, etc.
  entity_id UUID NOT NULL,
  share_token VARCHAR(255) UNIQUE NOT NULL,
  share_type VARCHAR(50) NOT NULL DEFAULT 'view', -- view, edit, comment
  visibility VARCHAR(50) NOT NULL DEFAULT 'private', -- private, public, link
  password_hash VARCHAR(255),
  expires_at TIMESTAMP,
  max_views INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMP,
  settings JSONB DEFAULT '{}',
  CONSTRAINT share_type_check CHECK (share_type IN ('view', 'edit', 'comment')),
  CONSTRAINT visibility_check CHECK (visibility IN ('private', 'public', 'link'))
);

CREATE INDEX idx_document_shares_entity ON document_shares(entity_type, entity_id);
CREATE INDEX idx_document_shares_token ON document_shares(share_token);
CREATE INDEX idx_document_shares_created_by ON document_shares(created_by);
CREATE INDEX idx_document_shares_expires_at ON document_shares(expires_at);

-- Create document_share_access_log table
CREATE TABLE IF NOT EXISTS document_share_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES document_shares(id) ON DELETE CASCADE,
  accessed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  accessed_by_ip VARCHAR(45),
  accessed_by_user_agent TEXT,
  accessed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  action VARCHAR(50) NOT NULL DEFAULT 'view' -- view, edit, download
);

CREATE INDEX idx_document_share_access_log_share_id ON document_share_access_log(share_id);
CREATE INDEX idx_document_share_access_log_accessed_at ON document_share_access_log(accessed_at);

-- Create mentions table
CREATE TABLE IF NOT EXISTS mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(100) NOT NULL, -- comment, chat_message, note, etc.
  entity_id UUID NOT NULL,
  mentioned_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mentioned_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context_type VARCHAR(100), -- service_request, project, installation, etc.
  context_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  read_at TIMESTAMP
);

CREATE INDEX idx_mentions_mentioned_user_id ON mentions(mentioned_user_id);
CREATE INDEX idx_mentions_entity ON mentions(entity_type, entity_id);
CREATE INDEX idx_mentions_context ON mentions(context_type, context_id);
CREATE INDEX idx_mentions_is_read ON mentions(is_read);

-- Create team_activity_feed table
CREATE TABLE IF NOT EXISTS team_activity_feed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type VARCHAR(100) NOT NULL, -- created, updated, commented, assigned, completed, etc.
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  team_id UUID, -- can reference workspace_id for team workspaces
  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_team_activity_feed_user_id ON team_activity_feed(user_id);
CREATE INDEX idx_team_activity_feed_team_id ON team_activity_feed(team_id);
CREATE INDEX idx_team_activity_feed_entity ON team_activity_feed(entity_type, entity_id);
CREATE INDEX idx_team_activity_feed_created_at ON team_activity_feed(created_at DESC);
CREATE INDEX idx_team_activity_feed_activity_type ON team_activity_feed(activity_type);

-- Create collaborative_editing_sessions table
CREATE TABLE IF NOT EXISTS collaborative_editing_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token VARCHAR(255) UNIQUE NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(entity_type, entity_id, user_id, is_active)
);

CREATE INDEX idx_collaborative_editing_sessions_entity ON collaborative_editing_sessions(entity_type, entity_id);
CREATE INDEX idx_collaborative_editing_sessions_user_id ON collaborative_editing_sessions(user_id);
CREATE INDEX idx_collaborative_editing_sessions_is_active ON collaborative_editing_sessions(is_active);

-- Create team_goals table
CREATE TABLE IF NOT EXISTS team_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  goal_type VARCHAR(50) NOT NULL DEFAULT 'custom', -- custom, performance, quality, efficiency
  target_value NUMERIC,
  current_value NUMERIC DEFAULT 0,
  unit VARCHAR(50),
  start_date DATE,
  end_date DATE,
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, completed, cancelled, overdue
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT goal_type_check CHECK (goal_type IN ('custom', 'performance', 'quality', 'efficiency')),
  CONSTRAINT goal_status_check CHECK (status IN ('active', 'completed', 'cancelled', 'overdue'))
);

CREATE INDEX idx_team_goals_workspace_id ON team_goals(workspace_id);
CREATE INDEX idx_team_goals_status ON team_goals(status);
CREATE INDEX idx_team_goals_end_date ON team_goals(end_date);

-- Create team_performance_metrics table
CREATE TABLE IF NOT EXISTS team_performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  metric_type VARCHAR(100) NOT NULL, -- avg_response_time, completion_rate, satisfaction_score, etc.
  metric_value NUMERIC NOT NULL,
  metric_unit VARCHAR(50),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  metadata JSONB DEFAULT '{}',
  calculated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_team_performance_metrics_workspace_id ON team_performance_metrics(workspace_id);
CREATE INDEX idx_team_performance_metrics_type ON team_performance_metrics(metric_type);
CREATE INDEX idx_team_performance_metrics_period ON team_performance_metrics(period_start, period_end);

-- Insert default workspace templates
INSERT INTO workspaces (name, description, type, is_template, layout, settings)
VALUES
  (
    'Диспетчер - Панель управления',
    'Шаблон рабочего пространства для диспетчеров',
    'role_based',
    true,
    '{"widgets": [
      {"id": "active-requests", "type": "stat-card", "title": "Активные заявки", "position": {"x": 0, "y": 0, "w": 3, "h": 2}},
      {"id": "urgent-requests", "type": "stat-card", "title": "Срочные заявки", "position": {"x": 3, "y": 0, "w": 3, "h": 2}},
      {"id": "team-workload", "type": "chart", "title": "Загрузка команды", "position": {"x": 6, "y": 0, "w": 6, "h": 4}},
      {"id": "recent-requests", "type": "list", "title": "Последние заявки", "position": {"x": 0, "y": 2, "w": 6, "h": 6}}
    ], "layout_config": {"cols": 12, "rowHeight": 60}}',
    '{"theme": "default", "refresh_interval": 30000}'
  ),
  (
    'Исполнитель - Мои задачи',
    'Шаблон рабочего пространства для исполнителей',
    'role_based',
    true,
    '{"widgets": [
      {"id": "my-tasks", "type": "list", "title": "Мои задачи", "position": {"x": 0, "y": 0, "w": 6, "h": 8}},
      {"id": "today-schedule", "type": "calendar", "title": "Расписание на сегодня", "position": {"x": 6, "y": 0, "w": 6, "h": 4}},
      {"id": "performance", "type": "chart", "title": "Моя производительность", "position": {"x": 6, "y": 4, "w": 6, "h": 4}}
    ], "layout_config": {"cols": 12, "rowHeight": 60}}',
    '{"theme": "default", "refresh_interval": 60000}'
  ),
  (
    'Менеджер - Аналитика',
    'Шаблон рабочего пространства для менеджеров',
    'role_based',
    true,
    '{"widgets": [
      {"id": "kpi-overview", "type": "stat-grid", "title": "Ключевые показатели", "position": {"x": 0, "y": 0, "w": 12, "h": 2}},
      {"id": "team-performance", "type": "chart", "title": "Производительность команды", "position": {"x": 0, "y": 2, "w": 6, "h": 4}},
      {"id": "project-status", "type": "chart", "title": "Статус проектов", "position": {"x": 6, "y": 2, "w": 6, "h": 4}},
      {"id": "activity-feed", "type": "feed", "title": "Активность команды", "position": {"x": 0, "y": 6, "w": 12, "h": 4}}
    ], "layout_config": {"cols": 12, "rowHeight": 60}}',
    '{"theme": "default", "refresh_interval": 120000}'
  );

COMMENT ON TABLE workspaces IS 'User and team workspaces with customizable layouts';
COMMENT ON TABLE workspace_members IS 'Members of team workspaces';
COMMENT ON TABLE document_shares IS 'Shared documents with permissions and expiration';
COMMENT ON TABLE document_share_access_log IS 'Access log for shared documents';
COMMENT ON TABLE mentions IS 'User mentions in comments and messages';
COMMENT ON TABLE team_activity_feed IS 'Team activity feed for collaboration';
COMMENT ON TABLE collaborative_editing_sessions IS 'Active collaborative editing sessions';
COMMENT ON TABLE team_goals IS 'Team goals and objectives';
COMMENT ON TABLE team_performance_metrics IS 'Team performance metrics over time';
