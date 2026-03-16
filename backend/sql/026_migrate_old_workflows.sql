-- Migration from old workflow system to new workflow system
-- This migration handles the transition from the old visual workflow editor (023) to the new advanced workflow engine (024-025)

-- Note: The old system tables (workflow_steps, workflow_connections, workflow_variables, workflow_execution_steps)
-- are no longer used. The new system uses:
-- - workflow_action_nodes (replaces workflow_steps)
-- - workflow_node_connections (replaces workflow_connections)
-- - workflow_execution_logs (replaces workflow_execution_steps)

-- If there was any data in the old tables, it would need to be migrated here.
-- However, since this is a new system, we'll just add a comment for future reference.

-- The workflow_templates table had a schema conflict between old and new systems.
-- The new system's workflow_templates table (from 025) is the one being used.
-- It has additional fields: tags, template_config (instead of workflow_config)

-- Drop old tables if they exist (they shouldn't exist if migrations run in order)
-- These tables were defined in 023_visual_workflow_editor.sql which is now disabled

-- Add any missing indexes or constraints for the new system
-- (Most are already defined in 024 and 025)

-- Ensure workflow_rules has all necessary columns from both systems
ALTER TABLE workflow_rules ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE workflow_rules ADD COLUMN IF NOT EXISTS is_draft BOOLEAN DEFAULT false;
ALTER TABLE workflow_rules ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

COMMENT ON TABLE workflow_action_nodes IS 'Visual workflow builder action nodes (replaces old workflow_steps)';
COMMENT ON TABLE workflow_node_connections IS 'Connections between workflow nodes (replaces old workflow_connections)';
COMMENT ON TABLE workflow_execution_logs IS 'Detailed execution logs (replaces old workflow_execution_steps)';

-- Migration complete
-- Old system files have been renamed with .OLD extension
-- New system is now the primary workflow system
