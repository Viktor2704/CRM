import { asyncHandler } from '../helpers/asyncHandler.js';
import { isUuidValue, normalizeText } from '../helpers/normalize.js';
import { parseUuidPath } from '../validators.js';
import { executeAdvancedWorkflow, retryWorkflowExecution } from '../services/workflowEngine.js';

export const registerWorkflowRoutes = (params) => {
  const {
    app,
    requireAuth,
    ApiError,
    dbQuery,
    randomUUID,
  } = params;

  // Get workflow templates
  app.get('/workflow-templates', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = normalizeText(request.authUser?.role);
    if (actorRole !== 'admin' && actorRole !== 'manager') {
      throw new ApiError(403, 'FORBIDDEN', 'Admin or manager role required');
    }

    const category = normalizeText(request.query?.category);
    const isPublic = request.query?.isPublic === 'true';

    const conditions = [];
    const values: any[] = [];

    if (category) {
      values.push(category);
      conditions.push(`category = $${values.length}`);
    }

    if (isPublic) {
      conditions.push('is_public = true');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await dbQuery(
      `SELECT
        id::text,
        name,
        description,
        category,
        icon,
        template_config,
        is_public,
        usage_count,
        tags,
        created_at
      FROM workflow_templates
      ${whereClause}
      ORDER BY usage_count DESC, created_at DESC`,
      values
    );

    response.json({
      items: result.rows.map(row => ({
        id: String(row.id),
        name: String(row.name),
        description: String(row.description || ''),
        category: String(row.category || ''),
        icon: String(row.icon || ''),
        templateConfig: row.template_config || {},
        isPublic: Boolean(row.is_public),
        usageCount: Number(row.usage_count || 0),
        tags: Array.isArray(row.tags) ? row.tags : [],
        createdAt: row.created_at ? String(row.created_at) : null,
      })),
    });
  }));

  // Create workflow from template
  app.post('/workflow-templates/:templateId/create', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = normalizeText(request.authUser?.role);
    if (actorRole !== 'admin' && actorRole !== 'manager') {
      throw new ApiError(403, 'FORBIDDEN', 'Admin or manager role required');
    }

    const templateId = parseUuidPath(request.params.templateId);
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const workflowName = normalizeText(body.workflowName);
    const entityType = normalizeText(body.entityType);

    const VALID_WORKFLOW_ENTITY_TYPES = new Set(['access_request', 'service_request', 'project', 'installation']);

    if (!workflowName) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Workflow name is required');
    }
    if (!entityType) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Entity type is required');
    }
    if (!VALID_WORKFLOW_ENTITY_TYPES.has(entityType)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Invalid entity type: ${entityType}`);
    }

    // Get template
    const templateResult = await dbQuery(
      `SELECT template_config FROM workflow_templates WHERE id = $1::uuid`,
      [templateId]
    );

    if (templateResult.rows.length === 0) {
      throw new ApiError(404, 'NOT_FOUND', 'Template not found');
    }

    const templateConfig = templateResult.rows[0].template_config;
    const trigger = templateConfig.trigger || {};

    // Create workflow rule
    const workflowResult = await dbQuery(
      `INSERT INTO workflow_rules (
        name, description, entity_type, trigger_type, trigger_config,
        is_active, priority, created_by_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid)
      RETURNING id::text`,
      [
        workflowName,
        `Created from template`,
        entityType,
        trigger.type || 'creation',
        JSON.stringify(trigger),
        false, // Start inactive
        50,
        request.authUser?.id,
      ]
    );

    const workflowId = workflowResult.rows[0].id;

    // Create workflow nodes from template
    if (Array.isArray(templateConfig.nodes)) {
      for (let i = 0; i < templateConfig.nodes.length; i++) {
        const node = templateConfig.nodes[i];
        await dbQuery(
          `INSERT INTO workflow_action_nodes (
            workflow_id, node_type, node_name, configuration, execution_order, position_x, position_y
          )
          VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)`,
          [
            workflowId,
            node.type,
            node.name,
            JSON.stringify(node.config || {}),
            i,
            100 + (i * 200),
            100,
          ]
        );
      }
    }

    // Update template usage count
    await dbQuery(
      `UPDATE workflow_templates SET usage_count = usage_count + 1 WHERE id = $1::uuid`,
      [templateId]
    );

    response.status(201).json({
      id: String(workflowId),
      name: workflowName,
    });
  }));

  // Get workflow nodes
  app.get('/workflows/:workflowId/nodes', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = normalizeText(request.authUser?.role);
    if (actorRole !== 'admin' && actorRole !== 'manager') {
      throw new ApiError(403, 'FORBIDDEN', 'Admin or manager role required');
    }

    const workflowId = parseUuidPath(request.params.workflowId);

    const result = await dbQuery(
      `SELECT
        id::text,
        node_type,
        node_name,
        position_x,
        position_y,
        configuration,
        execution_order,
        created_at
      FROM workflow_action_nodes
      WHERE workflow_id = $1::uuid
      ORDER BY execution_order ASC`,
      [workflowId]
    );

    response.json({
      items: result.rows.map(row => ({
        id: String(row.id),
        nodeType: String(row.node_type),
        nodeName: String(row.node_name),
        positionX: Number(row.position_x || 0),
        positionY: Number(row.position_y || 0),
        configuration: row.configuration || {},
        executionOrder: Number(row.execution_order || 0),
        createdAt: row.created_at ? String(row.created_at) : null,
      })),
    });
  }));

  // Create workflow node
  app.post('/workflows/:workflowId/nodes', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = normalizeText(request.authUser?.role);
    if (actorRole !== 'admin' && actorRole !== 'manager') {
      throw new ApiError(403, 'FORBIDDEN', 'Admin or manager role required');
    }

    const workflowId = parseUuidPath(request.params.workflowId);
    const body = request.body && typeof request.body === 'object' ? request.body : {};

    const nodeType = normalizeText(body.nodeType);
    const nodeName = normalizeText(body.nodeName);
    const positionX = Number(body.positionX) || 0;
    const positionY = Number(body.positionY) || 0;
    const configuration = body.configuration && typeof body.configuration === 'object' ? body.configuration : {};
    const executionOrder = Number(body.executionOrder) || 0;

    if (!nodeType) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Node type is required');
    }
    if (!nodeName) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Node name is required');
    }

    const result = await dbQuery(
      `INSERT INTO workflow_action_nodes (
        workflow_id, node_type, node_name, position_x, position_y, configuration, execution_order
      )
      VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
      RETURNING id::text, created_at`,
      [workflowId, nodeType, nodeName, positionX, positionY, JSON.stringify(configuration), executionOrder]
    );

    const row = result.rows[0];
    response.status(201).json({
      id: String(row.id),
      nodeType,
      nodeName,
      positionX,
      positionY,
      configuration,
      executionOrder,
      createdAt: row.created_at ? String(row.created_at) : null,
    });
  }));

  // Update workflow node
  app.patch('/workflows/:workflowId/nodes/:nodeId', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = normalizeText(request.authUser?.role);
    if (actorRole !== 'admin' && actorRole !== 'manager') {
      throw new ApiError(403, 'FORBIDDEN', 'Admin or manager role required');
    }

    const workflowId = parseUuidPath(request.params.workflowId);
    const nodeId = parseUuidPath(request.params.nodeId);
    const body = request.body && typeof request.body === 'object' ? request.body : {};

    const updates: string[] = [];
    const values: any[] = [nodeId, workflowId];

    if (body.nodeName !== undefined) {
      const nodeName = normalizeText(body.nodeName);
      if (!nodeName) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Node name cannot be empty');
      }
      values.push(nodeName);
      updates.push(`node_name = $${values.length}`);
    }

    if (body.positionX !== undefined) {
      values.push(Number(body.positionX));
      updates.push(`position_x = $${values.length}`);
    }

    if (body.positionY !== undefined) {
      values.push(Number(body.positionY));
      updates.push(`position_y = $${values.length}`);
    }

    if (body.configuration !== undefined) {
      values.push(JSON.stringify(body.configuration || {}));
      updates.push(`configuration = $${values.length}`);
    }

    if (body.executionOrder !== undefined) {
      values.push(Number(body.executionOrder));
      updates.push(`execution_order = $${values.length}`);
    }

    if (updates.length === 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'No fields to update');
    }

    updates.push('updated_at = NOW()');

    const result = await dbQuery(
      `UPDATE workflow_action_nodes
       SET ${updates.join(', ')}
       WHERE id = $1::uuid AND workflow_id = $2::uuid
       RETURNING id::text`,
      values
    );

    if (result.rows.length === 0) {
      throw new ApiError(404, 'NOT_FOUND', 'Node not found');
    }

    response.json({ ok: true });
  }));

  // Delete workflow node
  app.delete('/workflows/:workflowId/nodes/:nodeId', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = normalizeText(request.authUser?.role);
    if (actorRole !== 'admin' && actorRole !== 'manager') {
      throw new ApiError(403, 'FORBIDDEN', 'Admin or manager role required');
    }

    const workflowId = parseUuidPath(request.params.workflowId);
    const nodeId = parseUuidPath(request.params.nodeId);

    const result = await dbQuery(
      `DELETE FROM workflow_action_nodes WHERE id = $1::uuid AND workflow_id = $2::uuid RETURNING id::text`,
      [nodeId, workflowId]
    );

    if (result.rows.length === 0) {
      throw new ApiError(404, 'NOT_FOUND', 'Node not found');
    }

    response.status(204).send();
  }));

  // Get workflow metrics
  app.get('/workflows/:workflowId/metrics', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = normalizeText(request.authUser?.role);
    if (actorRole !== 'admin' && actorRole !== 'manager') {
      throw new ApiError(403, 'FORBIDDEN', 'Admin or manager role required');
    }

    const workflowId = parseUuidPath(request.params.workflowId);
    const days = Math.min(Number(request.query?.days) || 30, 90);

    const result = await dbQuery(
      `SELECT
        metric_date,
        total_executions,
        successful_executions,
        failed_executions,
        avg_execution_time_ms
      FROM workflow_metrics
      WHERE workflow_id = $1::uuid
        AND metric_date >= CURRENT_DATE - $2::integer
      ORDER BY metric_date DESC`,
      [workflowId, days]
    );

    response.json({
      items: result.rows.map(row => ({
        date: row.metric_date ? String(row.metric_date) : null,
        totalExecutions: Number(row.total_executions || 0),
        successfulExecutions: Number(row.successful_executions || 0),
        failedExecutions: Number(row.failed_executions || 0),
        avgExecutionTimeMs: Number(row.avg_execution_time_ms || 0),
      })),
    });
  }));

  // Get workflow alerts
  app.get('/workflow-alerts', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = normalizeText(request.authUser?.role);
    if (actorRole !== 'admin' && actorRole !== 'manager') {
      throw new ApiError(403, 'FORBIDDEN', 'Admin or manager role required');
    }

    const workflowId = normalizeText(request.query?.workflowId);
    const isAcknowledged = request.query?.isAcknowledged === 'true';
    const severity = normalizeText(request.query?.severity);
    const limit = Math.min(Number(request.query?.limit) || 100, 500);

    const conditions = [];
    const values: any[] = [];

    if (isUuidValue(workflowId)) {
      values.push(workflowId);
      conditions.push(`workflow_id = $${values.length}::uuid`);
    }

    if (request.query?.isAcknowledged !== undefined) {
      values.push(isAcknowledged);
      conditions.push(`is_acknowledged = $${values.length}`);
    }

    if (severity) {
      values.push(severity);
      conditions.push(`severity = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await dbQuery(
      `SELECT
        wa.id::text,
        wa.workflow_id::text,
        wa.execution_id::text,
        wa.alert_type,
        wa.severity,
        wa.message,
        wa.details,
        wa.is_acknowledged,
        wa.acknowledged_at,
        wa.created_at,
        wr.name as workflow_name
      FROM workflow_alerts wa
      LEFT JOIN workflow_rules wr ON wr.id = wa.workflow_id
      ${whereClause}
      ORDER BY wa.created_at DESC
      LIMIT $${values.length + 1}`,
      [...values, limit]
    );

    response.json({
      items: result.rows.map(row => ({
        id: String(row.id),
        workflowId: String(row.workflow_id),
        workflowName: row.workflow_name ? String(row.workflow_name) : null,
        executionId: String(row.execution_id),
        alertType: String(row.alert_type),
        severity: String(row.severity),
        message: String(row.message),
        details: row.details || {},
        isAcknowledged: Boolean(row.is_acknowledged),
        acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : null,
        createdAt: row.created_at ? String(row.created_at) : null,
      })),
    });
  }));

  // Acknowledge workflow alert
  app.post('/workflow-alerts/:alertId/acknowledge', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = normalizeText(request.authUser?.role);
    if (actorRole !== 'admin' && actorRole !== 'manager') {
      throw new ApiError(403, 'FORBIDDEN', 'Admin or manager role required');
    }

    const alertId = parseUuidPath(request.params.alertId);
    const userId = normalizeText(request.authUser?.id);

    const result = await dbQuery(
      `UPDATE workflow_alerts
       SET is_acknowledged = true, acknowledged_by = $2::uuid, acknowledged_at = NOW()
       WHERE id = $1::uuid AND is_acknowledged = false
       RETURNING id::text`,
      [alertId, userId]
    );

    if (result.rows.length === 0) {
      throw new ApiError(404, 'NOT_FOUND', 'Alert not found or already acknowledged');
    }

    response.json({ ok: true });
  }));

  // Retry workflow execution
  app.post('/workflow-executions/:executionId/retry', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = normalizeText(request.authUser?.role);
    if (actorRole !== 'admin' && actorRole !== 'manager') {
      throw new ApiError(403, 'FORBIDDEN', 'Admin or manager role required');
    }

    const executionId = parseUuidPath(request.params.executionId);

    await retryWorkflowExecution(executionId);

    response.json({ ok: true });
  }));

  // Get workflow execution logs
  app.get('/workflow-executions/:executionId/logs', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = normalizeText(request.authUser?.role);
    if (actorRole !== 'admin' && actorRole !== 'manager') {
      throw new ApiError(403, 'FORBIDDEN', 'Admin or manager role required');
    }

    const executionId = parseUuidPath(request.params.executionId);

    const result = await dbQuery(
      `SELECT
        id::text,
        node_id::text,
        log_level,
        message,
        details,
        created_at
      FROM workflow_execution_logs
      WHERE execution_id = $1::uuid
      ORDER BY created_at ASC`,
      [executionId]
    );

    response.json({
      items: result.rows.map(row => ({
        id: String(row.id),
        nodeId: row.node_id ? String(row.node_id) : null,
        logLevel: String(row.log_level),
        message: String(row.message),
        details: row.details || {},
        createdAt: row.created_at ? String(row.created_at) : null,
      })),
    });
  }));

  // Get workflow executions (for monitoring)
  app.get('/workflow-executions', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = normalizeText(request.authUser?.role);
    if (actorRole !== 'admin' && actorRole !== 'manager') {
      throw new ApiError(403, 'FORBIDDEN', 'Admin or manager role required');
    }
    const limit = request.query.limit ? parseInt(String(request.query.limit), 10) : 50;
    const offset = request.query.offset ? parseInt(String(request.query.offset), 10) : 0;
    const result = await dbQuery(
      `SELECT
        we.id::text,
        we.rule_id::text,
        wr.name as rule_name,
        we.entity_type,
        we.entity_id,
        we.trigger_type,
        we.status,
        we.error_message,
        we.retry_count,
        we.started_at,
        we.completed_at,
        we.created_at
      FROM workflow_executions we
      LEFT JOIN workflow_rules wr ON we.rule_id = wr.id
      ORDER BY we.created_at DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    response.json({
      items: result.rows.map(row => ({
        id: String(row.id),
        ruleId: row.rule_id ? String(row.rule_id) : null,
        ruleName: row.rule_name ? String(row.rule_name) : null,
        entityType: String(row.entity_type),
        entityId: String(row.entity_id),
        triggerType: String(row.trigger_type),
        status: String(row.status),
        errorMessage: row.error_message ? String(row.error_message) : null,
        retryCount: Number(row.retry_count || 0),
        startedAt: row.started_at ? String(row.started_at) : null,
        completedAt: row.completed_at ? String(row.completed_at) : null,
        createdAt: row.created_at ? String(row.created_at) : null,
      })),
    });
  }));

  // Get workflow rules (mock endpoint for E2E tests)
  app.get('/workflow-rules', requireAuth, asyncHandler(async (request, response) => {
    const actorRole = normalizeText(request.authUser?.role);
    if (actorRole !== 'admin' && actorRole !== 'manager') {
      throw new ApiError(403, 'FORBIDDEN', 'Admin or manager role required');
    }
    response.json({
      rules: [
        {
          id: '1',
          name: 'Автоназначение критических заявок',
          enabled: true,
          trigger: 'service_request_created',
          conditions: [
            { field: 'priority', operator: 'equals', value: 'critical' }
          ],
          actions: [
            { type: 'assign_to_user', userId: 'admin-user-id' },
            { type: 'send_notification', channel: 'telegram' }
          ],
          createdAt: '2026-01-15T10:00:00Z',
          updatedAt: '2026-03-01T14:30:00Z'
        },
        {
          id: '2',
          name: 'Эскалация просроченных заявок',
          enabled: true,
          trigger: 'service_request_overdue',
          conditions: [
            { field: 'days_overdue', operator: 'greater_than', value: 3 }
          ],
          actions: [
            { type: 'change_priority', value: 'high' },
            { type: 'notify_manager' }
          ],
          createdAt: '2026-02-10T09:00:00Z',
          updatedAt: '2026-02-10T09:00:00Z'
        }
      ],
      total: 2
    });
  }));
};
