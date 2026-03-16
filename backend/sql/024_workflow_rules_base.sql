-- Base workflow tables (if not already created)
-- This ensures the foundation tables exist before visual editor extensions

CREATE TABLE IF NOT EXISTS workflow_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    entity_type VARCHAR(100) NOT NULL, -- access_request, service_request, project, etc.
    trigger_type VARCHAR(50) NOT NULL, -- creation, status_change, deadline, scheduled, on_update, on_delete
    trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
    actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    version INTEGER DEFAULT 1,
    is_draft BOOLEAN DEFAULT false,
    published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS workflow_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID REFERENCES workflow_rules(id) ON DELETE CASCADE,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL,
    trigger_data JSONB,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, running, completed, failed, retrying
    result JSONB,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID REFERENCES workflow_rules(id) ON DELETE CASCADE,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(255),
    scheduled_for TIMESTAMPTZ NOT NULL,
    trigger_data JSONB,
    status VARCHAR(50) DEFAULT 'pending', -- pending, executed, failed, cancelled
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_workflow_rules_entity_trigger ON workflow_rules(entity_type, trigger_type) WHERE is_active = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_rules_active ON workflow_rules(is_active, priority DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_executions_rule ON workflow_executions(rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_entity ON workflow_executions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON workflow_executions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_schedules_pending ON workflow_schedules(scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_workflow_schedules_rule ON workflow_schedules(rule_id);

COMMENT ON TABLE workflow_rules IS 'Workflow automation rules with triggers, conditions, and actions';
COMMENT ON TABLE workflow_executions IS 'Workflow execution history with retry logic';
COMMENT ON TABLE workflow_schedules IS 'Scheduled workflow executions';
