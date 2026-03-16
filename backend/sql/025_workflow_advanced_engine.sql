-- Advanced Workflow Engine Features
-- Extends base workflow system with visual builder, templates, and monitoring

-- Workflow action nodes (for visual builder)
CREATE TABLE IF NOT EXISTS workflow_action_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflow_rules(id) ON DELETE CASCADE,
    node_type VARCHAR(50) NOT NULL, -- send_email, create_record, update_field, call_api, run_script, delay, branch, condition
    node_name VARCHAR(255) NOT NULL,
    position_x INTEGER NOT NULL DEFAULT 0,
    position_y INTEGER NOT NULL DEFAULT 0,
    configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
    parent_node_id UUID REFERENCES workflow_action_nodes(id) ON DELETE SET NULL,
    execution_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow node connections (visual flow)
CREATE TABLE IF NOT EXISTS workflow_node_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflow_rules(id) ON DELETE CASCADE,
    source_node_id UUID REFERENCES workflow_action_nodes(id) ON DELETE CASCADE,
    target_node_id UUID REFERENCES workflow_action_nodes(id) ON DELETE CASCADE,
    connection_type VARCHAR(50) DEFAULT 'default', -- default, success, error, conditional
    condition_config JSONB,
    label VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow templates (pre-built workflows)
CREATE TABLE IF NOT EXISTS workflow_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100), -- approval, escalation, notification, data_sync
    icon VARCHAR(50),
    template_config JSONB NOT NULL,
    is_public BOOLEAN DEFAULT false,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    usage_count INTEGER DEFAULT 0,
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow execution logs (detailed step tracking)
CREATE TABLE IF NOT EXISTS workflow_execution_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id UUID REFERENCES workflow_executions(id) ON DELETE CASCADE,
    node_id UUID REFERENCES workflow_action_nodes(id) ON DELETE SET NULL,
    log_level VARCHAR(20) NOT NULL, -- info, warning, error, debug
    message TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow metrics (for monitoring dashboard)
CREATE TABLE IF NOT EXISTS workflow_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflow_rules(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    total_executions INTEGER DEFAULT 0,
    successful_executions INTEGER DEFAULT 0,
    failed_executions INTEGER DEFAULT 0,
    avg_execution_time_ms INTEGER DEFAULT 0,
    total_execution_time_ms BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workflow_id, metric_date)
);

-- Workflow alerts (for failed workflows)
CREATE TABLE IF NOT EXISTS workflow_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflow_rules(id) ON DELETE CASCADE,
    execution_id UUID REFERENCES workflow_executions(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL, -- execution_failed, high_failure_rate, slow_execution
    severity VARCHAR(20) NOT NULL, -- low, medium, high, critical
    message TEXT NOT NULL,
    details JSONB,
    is_acknowledged BOOLEAN DEFAULT false,
    acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_workflow_action_nodes_workflow ON workflow_action_nodes(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_action_nodes_type ON workflow_action_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_workflow_node_connections_workflow ON workflow_node_connections(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_node_connections_source ON workflow_node_connections(source_node_id);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_category ON workflow_templates(category);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_public ON workflow_templates(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_workflow_execution_logs_execution ON workflow_execution_logs(execution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_metrics_workflow_date ON workflow_metrics(workflow_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_alerts_workflow ON workflow_alerts(workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_alerts_unacknowledged ON workflow_alerts(is_acknowledged, severity) WHERE is_acknowledged = false;

-- Insert default workflow templates
INSERT INTO workflow_templates (name, description, category, icon, template_config, is_public, tags)
VALUES
    (
        'Approval Workflow',
        'Multi-level approval workflow with escalation',
        'approval',
        'check-circle',
        '{
            "trigger": {"type": "creation"},
            "nodes": [
                {
                    "type": "send_email",
                    "name": "Notify Approver",
                    "config": {
                        "recipients": ["manager"],
                        "subject": "Approval Required: {{entity.title}}",
                        "body": "Please review and approve: {{entity.description}}"
                    }
                },
                {
                    "type": "condition",
                    "name": "Check Approval Status",
                    "config": {
                        "field": "status",
                        "operator": "equals",
                        "value": "approved"
                    }
                },
                {
                    "type": "send_email",
                    "name": "Notify Creator",
                    "config": {
                        "recipients": ["creator"],
                        "subject": "Request Approved",
                        "body": "Your request has been approved"
                    }
                }
            ]
        }'::jsonb,
        true,
        ARRAY['approval', 'notification']
    ),
    (
        'Escalation Workflow',
        'Automatic escalation for overdue items',
        'escalation',
        'alert-triangle',
        '{
            "trigger": {"type": "scheduled", "cron": "0 9 * * *"},
            "nodes": [
                {
                    "type": "condition",
                    "name": "Check Overdue",
                    "config": {
                        "field": "due_date",
                        "operator": "less_than",
                        "value": "NOW()"
                    }
                },
                {
                    "type": "update_field",
                    "name": "Set Priority to Urgent",
                    "config": {
                        "field": "priority",
                        "value": "urgent"
                    }
                },
                {
                    "type": "send_email",
                    "name": "Notify Management",
                    "config": {
                        "recipients": ["admin", "manager"],
                        "subject": "Overdue Item Escalated",
                        "body": "Item {{entity.title}} is overdue and has been escalated"
                    }
                }
            ]
        }'::jsonb,
        true,
        ARRAY['escalation', 'scheduled']
    ),
    (
        'Notification Workflow',
        'Send notifications on status change',
        'notification',
        'bell',
        '{
            "trigger": {"type": "status_change"},
            "nodes": [
                {
                    "type": "send_email",
                    "name": "Notify Stakeholders",
                    "config": {
                        "recipients": ["creator", "executors"],
                        "subject": "Status Updated: {{entity.title}}",
                        "body": "Status changed to {{entity.status}}"
                    }
                }
            ]
        }'::jsonb,
        true,
        ARRAY['notification', 'status']
    ),
    (
        'Data Sync Workflow',
        'Synchronize data with external system',
        'data_sync',
        'refresh-cw',
        '{
            "trigger": {"type": "on_update"},
            "nodes": [
                {
                    "type": "call_api",
                    "name": "Sync to External System",
                    "config": {
                        "method": "POST",
                        "url": "{{config.external_api_url}}",
                        "headers": {"Content-Type": "application/json"},
                        "body": "{{entity}}"
                    }
                },
                {
                    "type": "condition",
                    "name": "Check API Response",
                    "config": {
                        "field": "response.status",
                        "operator": "equals",
                        "value": "success"
                    }
                },
                {
                    "type": "update_field",
                    "name": "Mark as Synced",
                    "config": {
                        "field": "sync_status",
                        "value": "synced"
                    }
                }
            ]
        }'::jsonb,
        true,
        ARRAY['data_sync', 'api']
    )
ON CONFLICT DO NOTHING;

-- Function to update workflow metrics
CREATE OR REPLACE FUNCTION update_workflow_metrics()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' OR NEW.status = 'failed' THEN
        INSERT INTO workflow_metrics (
            workflow_id,
            metric_date,
            total_executions,
            successful_executions,
            failed_executions,
            avg_execution_time_ms,
            total_execution_time_ms
        )
        VALUES (
            NEW.rule_id,
            CURRENT_DATE,
            1,
            CASE WHEN NEW.status = 'completed' THEN 1 ELSE 0 END,
            CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END,
            EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) * 1000,
            EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) * 1000
        )
        ON CONFLICT (workflow_id, metric_date) DO UPDATE SET
            total_executions = workflow_metrics.total_executions + 1,
            successful_executions = workflow_metrics.successful_executions + CASE WHEN NEW.status = 'completed' THEN 1 ELSE 0 END,
            failed_executions = workflow_metrics.failed_executions + CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END,
            total_execution_time_ms = workflow_metrics.total_execution_time_ms + (EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) * 1000)::BIGINT,
            avg_execution_time_ms = (workflow_metrics.total_execution_time_ms + (EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) * 1000)::BIGINT) / (workflow_metrics.total_executions + 1),
            updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update metrics on execution completion
DROP TRIGGER IF EXISTS trigger_update_workflow_metrics ON workflow_executions;
CREATE TRIGGER trigger_update_workflow_metrics
    AFTER UPDATE ON workflow_executions
    FOR EACH ROW
    WHEN (NEW.status IN ('completed', 'failed') AND OLD.status != NEW.status)
    EXECUTE FUNCTION update_workflow_metrics();

-- Function to create workflow alert on failure
CREATE OR REPLACE FUNCTION create_workflow_alert_on_failure()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'failed' AND OLD.status != 'failed' THEN
        INSERT INTO workflow_alerts (
            workflow_id,
            execution_id,
            alert_type,
            severity,
            message,
            details
        )
        VALUES (
            NEW.rule_id,
            NEW.id,
            'execution_failed',
            CASE
                WHEN NEW.retry_count >= NEW.max_retries THEN 'high'
                ELSE 'medium'
            END,
            'Workflow execution failed: ' || COALESCE(NEW.error_message, 'Unknown error'),
            jsonb_build_object(
                'entity_type', NEW.entity_type,
                'entity_id', NEW.entity_id,
                'retry_count', NEW.retry_count,
                'max_retries', NEW.max_retries
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create alert on workflow failure
DROP TRIGGER IF EXISTS trigger_create_workflow_alert ON workflow_executions;
CREATE TRIGGER trigger_create_workflow_alert
    AFTER UPDATE ON workflow_executions
    FOR EACH ROW
    WHEN (NEW.status = 'failed')
    EXECUTE FUNCTION create_workflow_alert_on_failure();

COMMENT ON TABLE workflow_action_nodes IS 'Visual workflow builder action nodes';
COMMENT ON TABLE workflow_node_connections IS 'Connections between workflow nodes for visual flow';
COMMENT ON TABLE workflow_templates IS 'Pre-built workflow templates for common scenarios';
COMMENT ON TABLE workflow_execution_logs IS 'Detailed execution logs for debugging';
COMMENT ON TABLE workflow_metrics IS 'Aggregated workflow performance metrics';
COMMENT ON TABLE workflow_alerts IS 'Alerts for failed workflows and performance issues';
