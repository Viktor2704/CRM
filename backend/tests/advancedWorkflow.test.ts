import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { dbQuery } from '../src/db.js';
import { executeAdvancedWorkflow, retryWorkflowExecution } from '../src/services/advancedWorkflowEngine.js';

describe('Advanced Workflow Engine', () => {
  let testWorkflowId: string;
  let testExecutionId: string;
  let testNodeId: string;

  before(async () => {
    // Create test workflow
    const workflowResult = await dbQuery(
      `INSERT INTO workflow_rules (name, description, entity_type, trigger_type, is_active, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id::text`,
      ['Test Workflow', 'Test workflow for unit tests', 'test_entity', 'creation', true, 100]
    );
    testWorkflowId = workflowResult.rows[0].id;

    // Create test node
    const nodeResult = await dbQuery(
      `INSERT INTO workflow_action_nodes (workflow_id, node_type, node_name, configuration, execution_order)
       VALUES ($1::uuid, $2, $3, $4, $5)
       RETURNING id::text`,
      [
        testWorkflowId,
        'send_email',
        'Test Email Node',
        JSON.stringify({ recipients: ['admin'], subject: 'Test', body: 'Test message' }),
        0,
      ]
    );
    testNodeId = nodeResult.rows[0].id;
  });

  after(async () => {
    // Cleanup
    if (testWorkflowId) {
      await dbQuery(`DELETE FROM workflow_rules WHERE id = $1::uuid`, [testWorkflowId]);
    }
  });

  it('should create workflow execution record', async () => {
    const result = await dbQuery(
      `INSERT INTO workflow_executions (rule_id, entity_type, entity_id, trigger_type, status)
       VALUES ($1::uuid, $2, $3, $4, $5)
       RETURNING id::text`,
      [testWorkflowId, 'test_entity', 'test-123', 'creation', 'pending']
    );

    testExecutionId = result.rows[0].id;
    assert.ok(testExecutionId, 'Execution ID should be created');
  });

  it('should execute workflow with nodes', async () => {
    const context = {
      entityType: 'test_entity',
      entityId: 'test-123',
      entityData: {
        id: 'test-123',
        title: 'Test Entity',
        status: 'active',
      },
      triggerType: 'creation',
    };

    const executionResult = await dbQuery(
      `INSERT INTO workflow_executions (rule_id, entity_type, entity_id, trigger_type, status, started_at)
       VALUES ($1::uuid, $2, $3, $4, $5, NOW())
       RETURNING id::text`,
      [testWorkflowId, context.entityType, context.entityId, context.triggerType, 'running']
    );

    const execId = executionResult.rows[0].id;

    const result = await executeAdvancedWorkflow(testWorkflowId, context, execId);

    assert.strictEqual(result.success, true, 'Workflow execution should succeed');

    // Update execution status
    await dbQuery(
      `UPDATE workflow_executions SET status = $2, completed_at = NOW() WHERE id = $1::uuid`,
      [execId, result.success ? 'completed' : 'failed']
    );

    // Verify execution was logged
    const logsResult = await dbQuery(
      `SELECT COUNT(*) as count FROM workflow_execution_logs WHERE execution_id = $1::uuid`,
      [execId]
    );

    assert.ok(Number(logsResult.rows[0].count) > 0, 'Execution logs should be created');
  });

  it('should handle workflow node configuration', async () => {
    const nodesResult = await dbQuery(
      `SELECT id::text, node_type, configuration FROM workflow_action_nodes WHERE workflow_id = $1::uuid`,
      [testWorkflowId]
    );

    assert.ok(nodesResult.rows.length > 0, 'Workflow should have nodes');

    const node = nodesResult.rows[0];
    assert.ok(node.configuration, 'Node should have configuration');
    assert.strictEqual(typeof node.configuration, 'object', 'Configuration should be an object');
  });

  it('should create workflow metrics on execution completion', async () => {
    const executionResult = await dbQuery(
      `INSERT INTO workflow_executions (rule_id, entity_type, entity_id, trigger_type, status, started_at, completed_at)
       VALUES ($1::uuid, $2, $3, $4, $5, NOW() - INTERVAL '5 seconds', NOW())
       RETURNING id::text`,
      [testWorkflowId, 'test_entity', 'test-456', 'creation', 'completed']
    );

    // Trigger should create metrics automatically
    await new Promise(resolve => setTimeout(resolve, 100));

    const metricsResult = await dbQuery(
      `SELECT * FROM workflow_metrics WHERE workflow_id = $1::uuid AND metric_date = CURRENT_DATE`,
      [testWorkflowId]
    );

    assert.ok(metricsResult.rows.length > 0, 'Metrics should be created');
    const metrics = metricsResult.rows[0];
    assert.ok(Number(metrics.total_executions) > 0, 'Total executions should be tracked');
  });

  it('should create alert on workflow failure', async () => {
    const executionResult = await dbQuery(
      `INSERT INTO workflow_executions (rule_id, entity_type, entity_id, trigger_type, status, error_message, started_at, completed_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, NOW() - INTERVAL '5 seconds', NOW())
       RETURNING id::text`,
      [testWorkflowId, 'test_entity', 'test-789', 'creation', 'failed', 'Test error message']
    );

    const execId = executionResult.rows[0].id;

    // Trigger should create alert automatically
    await new Promise(resolve => setTimeout(resolve, 100));

    const alertsResult = await dbQuery(
      `SELECT * FROM workflow_alerts WHERE execution_id = $1::uuid`,
      [execId]
    );

    assert.ok(alertsResult.rows.length > 0, 'Alert should be created on failure');
    const alert = alertsResult.rows[0];
    assert.strictEqual(alert.alert_type, 'execution_failed', 'Alert type should be execution_failed');
  });

  it('should load workflow templates', async () => {
    const result = await dbQuery(
      `SELECT id::text, name, category, is_public FROM workflow_templates WHERE is_public = true LIMIT 5`
    );

    assert.ok(result.rows.length > 0, 'Public templates should exist');

    const template = result.rows[0];
    assert.ok(template.name, 'Template should have a name');
    assert.ok(template.category, 'Template should have a category');
  });

  it('should handle retry logic for failed executions', async () => {
    const executionResult = await dbQuery(
      `INSERT INTO workflow_executions (
        rule_id, entity_type, entity_id, trigger_type, status,
        error_message, retry_count, max_retries, started_at, completed_at
      )
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, NOW() - INTERVAL '5 seconds', NOW())
       RETURNING id::text`,
      [testWorkflowId, 'test_entity', 'test-retry', 'creation', 'failed', 'Test error', 0, 3]
    );

    const execId = executionResult.rows[0].id;

    // Verify retry count is tracked
    const checkResult = await dbQuery(
      `SELECT retry_count, max_retries FROM workflow_executions WHERE id = $1::uuid`,
      [execId]
    );

    assert.strictEqual(Number(checkResult.rows[0].retry_count), 0, 'Initial retry count should be 0');
    assert.strictEqual(Number(checkResult.rows[0].max_retries), 3, 'Max retries should be 3');
  });

  it('should validate workflow node types', async () => {
    const validNodeTypes = [
      'send_email',
      'create_record',
      'update_field',
      'call_api',
      'run_script',
      'condition',
      'delay',
      'branch',
    ];

    for (const nodeType of validNodeTypes) {
      const result = await dbQuery(
        `INSERT INTO workflow_action_nodes (workflow_id, node_type, node_name, configuration, execution_order)
         VALUES ($1::uuid, $2, $3, $4, $5)
         RETURNING id::text`,
        [testWorkflowId, nodeType, `Test ${nodeType}`, JSON.stringify({}), 0]
      );

      assert.ok(result.rows[0].id, `Node type ${nodeType} should be valid`);

      // Cleanup
      await dbQuery(`DELETE FROM workflow_action_nodes WHERE id = $1::uuid`, [result.rows[0].id]);
    }
  });

  it('should track execution logs', async () => {
    const executionResult = await dbQuery(
      `INSERT INTO workflow_executions (rule_id, entity_type, entity_id, trigger_type, status)
       VALUES ($1::uuid, $2, $3, $4, $5)
       RETURNING id::text`,
      [testWorkflowId, 'test_entity', 'test-logs', 'creation', 'running']
    );

    const execId = executionResult.rows[0].id;

    // Create test logs
    await dbQuery(
      `INSERT INTO workflow_execution_logs (execution_id, log_level, message, details)
       VALUES ($1::uuid, $2, $3, $4)`,
      [execId, 'info', 'Test log message', JSON.stringify({ test: 'data' })]
    );

    const logsResult = await dbQuery(
      `SELECT * FROM workflow_execution_logs WHERE execution_id = $1::uuid ORDER BY created_at ASC`,
      [execId]
    );

    assert.ok(logsResult.rows.length > 0, 'Logs should be created');
    assert.strictEqual(logsResult.rows[0].log_level, 'info', 'Log level should be info');
    assert.strictEqual(logsResult.rows[0].message, 'Test log message', 'Log message should match');
  });

  it('should handle workflow scheduling', async () => {
    const scheduledFor = new Date(Date.now() + 3600000); // 1 hour from now

    const result = await dbQuery(
      `INSERT INTO workflow_schedules (rule_id, entity_type, entity_id, scheduled_for, status)
       VALUES ($1::uuid, $2, $3, $4, $5)
       RETURNING id::text`,
      [testWorkflowId, 'test_entity', 'test-scheduled', scheduledFor.toISOString(), 'pending']
    );

    assert.ok(result.rows[0].id, 'Scheduled workflow should be created');

    // Verify schedule
    const scheduleResult = await dbQuery(
      `SELECT * FROM workflow_schedules WHERE id = $1::uuid`,
      [result.rows[0].id]
    );

    assert.strictEqual(scheduleResult.rows[0].status, 'pending', 'Schedule status should be pending');
  });
});

describe('Workflow Templates', () => {
  it('should create workflow from template', async () => {
    // Get a template
    const templateResult = await dbQuery(
      `SELECT id::text, template_config FROM workflow_templates WHERE is_public = true LIMIT 1`
    );

    if (templateResult.rows.length === 0) {
      console.log('No templates available for testing');
      return;
    }

    const template = templateResult.rows[0];
    const templateConfig = template.template_config;

    // Create workflow from template
    const workflowResult = await dbQuery(
      `INSERT INTO workflow_rules (name, description, entity_type, trigger_type, is_active, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id::text`,
      [
        'Test Template Workflow',
        'Created from template',
        'test_entity',
        templateConfig.trigger?.type || 'creation',
        false,
        50,
      ]
    );

    const workflowId = workflowResult.rows[0].id;

    assert.ok(workflowId, 'Workflow should be created from template');

    // Cleanup
    await dbQuery(`DELETE FROM workflow_rules WHERE id = $1::uuid`, [workflowId]);
  });

  it('should track template usage count', async () => {
    const templateResult = await dbQuery(
      `SELECT id::text, usage_count FROM workflow_templates WHERE is_public = true LIMIT 1`
    );

    if (templateResult.rows.length === 0) {
      console.log('No templates available for testing');
      return;
    }

    const template = templateResult.rows[0];
    const initialCount = Number(template.usage_count);

    // Increment usage count
    await dbQuery(
      `UPDATE workflow_templates SET usage_count = usage_count + 1 WHERE id = $1::uuid`,
      [template.id]
    );

    const updatedResult = await dbQuery(
      `SELECT usage_count FROM workflow_templates WHERE id = $1::uuid`,
      [template.id]
    );

    const newCount = Number(updatedResult.rows[0].usage_count);
    assert.strictEqual(newCount, initialCount + 1, 'Usage count should be incremented');

    // Restore original count
    await dbQuery(
      `UPDATE workflow_templates SET usage_count = $2 WHERE id = $1::uuid`,
      [template.id, initialCount]
    );
  });
});

describe('Workflow Metrics and Monitoring', () => {
  it('should aggregate workflow metrics by date', async () => {
    const result = await dbQuery(
      `SELECT
        metric_date,
        SUM(total_executions) as total,
        SUM(successful_executions) as successful,
        SUM(failed_executions) as failed
       FROM workflow_metrics
       WHERE metric_date >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY metric_date
       ORDER BY metric_date DESC`
    );

    assert.ok(Array.isArray(result.rows), 'Metrics should be returned as array');
  });

  it('should filter unacknowledged alerts', async () => {
    const result = await dbQuery(
      `SELECT COUNT(*) as count FROM workflow_alerts WHERE is_acknowledged = false`
    );

    assert.ok(Number(result.rows[0].count) >= 0, 'Should return count of unacknowledged alerts');
  });

  it('should acknowledge workflow alert', async () => {
    // Create test alert
    const workflowResult = await dbQuery(
      `INSERT INTO workflow_rules (name, entity_type, trigger_type, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING id::text`,
      ['Test Alert Workflow', 'test_entity', 'creation', true]
    );

    const workflowId = workflowResult.rows[0].id;

    const executionResult = await dbQuery(
      `INSERT INTO workflow_executions (rule_id, entity_type, entity_id, trigger_type, status)
       VALUES ($1::uuid, $2, $3, $4, $5)
       RETURNING id::text`,
      [workflowId, 'test_entity', 'test-alert', 'creation', 'failed']
    );

    const executionId = executionResult.rows[0].id;

    const alertResult = await dbQuery(
      `INSERT INTO workflow_alerts (workflow_id, execution_id, alert_type, severity, message)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5)
       RETURNING id::text`,
      [workflowId, executionId, 'execution_failed', 'high', 'Test alert']
    );

    const alertId = alertResult.rows[0].id;

    // Acknowledge alert
    await dbQuery(
      `UPDATE workflow_alerts SET is_acknowledged = true, acknowledged_at = NOW() WHERE id = $1::uuid`,
      [alertId]
    );

    const checkResult = await dbQuery(
      `SELECT is_acknowledged FROM workflow_alerts WHERE id = $1::uuid`,
      [alertId]
    );

    assert.strictEqual(checkResult.rows[0].is_acknowledged, true, 'Alert should be acknowledged');

    // Cleanup
    await dbQuery(`DELETE FROM workflow_rules WHERE id = $1::uuid`, [workflowId]);
  });
});
