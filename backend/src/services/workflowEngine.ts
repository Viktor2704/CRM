import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';
import { isUuidValue, normalizeText } from '../helpers/normalize.js';
import { pushInAppNotification, getAdminManagerIds } from './notificationService.js';
import { canSendEmails, sendSystemEventNotice } from './mailService.js';
import { pushTelegramNotification } from './telegramNotifier.js';

export interface WorkflowNode {
  id: string;
  nodeType: string;
  nodeName: string;
  configuration: Record<string, any>;
  executionOrder: number;
}

export interface WorkflowExecution {
  id: string;
  ruleId: string;
  entityType: string;
  entityId: string;
  triggerType: string;
  status: string;
  retryCount: number;
  maxRetries: number;
}

export interface WorkflowContext {
  entityType: string;
  entityId: string;
  entityData: Record<string, any>;
  triggerType: string;
  triggerData?: Record<string, any>;
  variables?: Record<string, any>;
}

// Template variable replacement
const replaceTemplateVariables = (template: string, context: WorkflowContext): string => {
  let result = template;

  // Replace entity variables
  Object.keys(context.entityData).forEach(key => {
    const regex = new RegExp(`{{entity\\.${key}}}`, 'g');
    result = result.replace(regex, String(context.entityData[key] || ''));
  });

  // Replace context variables
  if (context.variables) {
    Object.keys(context.variables).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(regex, String(context.variables![key] || ''));
    });
  }

  return result;
};

// Log workflow execution step
const logWorkflowStep = async (
  executionId: string,
  nodeId: string | null,
  level: string,
  message: string,
  details?: Record<string, any>
): Promise<void> => {
  try {
    await dbQuery(
      `INSERT INTO workflow_execution_logs (execution_id, node_id, log_level, message, details)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
      [executionId, nodeId, level, message, JSON.stringify(details || {})]
    );
  } catch (error) {
    logger.error('Failed to log workflow step', { error: serializeError(error) });
  }
};

// Resolve recipients for notifications
const resolveRecipients = async (
  recipients: string[],
  entityData: Record<string, any>
): Promise<string[]> => {
  const resolvedIds: string[] = [];

  for (const recipient of recipients) {
    if (recipient === 'admin' || recipient === 'manager') {
      const adminIds = await getAdminManagerIds();
      resolvedIds.push(...adminIds);
    } else if (recipient === 'creator' && isUuidValue(entityData.createdById)) {
      resolvedIds.push(entityData.createdById);
    } else if (recipient === 'executors' && Array.isArray(entityData.executorIds)) {
      resolvedIds.push(...entityData.executorIds.filter(isUuidValue));
    } else if (isUuidValue(recipient)) {
      resolvedIds.push(recipient);
    }
  }

  return Array.from(new Set(resolvedIds));
};

// Execute send_email node
const executeSendEmailNode = async (
  node: WorkflowNode,
  context: WorkflowContext,
  executionId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const { recipients = ['admin'], subject, body } = node.configuration;
    const recipientIds = await resolveRecipients(recipients, context.entityData);

    if (recipientIds.length === 0) {
      await logWorkflowStep(executionId, node.id, 'warning', 'No recipients found for email');
      return { success: true };
    }

    const processedSubject = replaceTemplateVariables(subject || 'Workflow Notification', context);
    const processedBody = replaceTemplateVariables(body || '', context);

    // Send in-app notification
    await pushInAppNotification({
      recipientIds,
      eventType: `workflow_${context.triggerType}`,
      title: processedSubject,
      body: processedBody,
      entityType: context.entityType,
      entityId: context.entityId,
    });

    // Send email if enabled
    if (canSendEmails()) {
      const emailsResult = await dbQuery(
        `SELECT email, full_name FROM users WHERE id = ANY($1::uuid[]) AND status = 'active' AND email IS NOT NULL`,
        [recipientIds]
      );

      for (const row of emailsResult.rows) {
        await sendSystemEventNotice({
          to: String(row.email),
          subject: processedSubject,
          body: processedBody,
        }).catch(error => {
          logger.error('Email send failed in workflow', { error: serializeError(error) });
        });
      }
    }

    await logWorkflowStep(executionId, node.id, 'info', `Email sent to ${recipientIds.length} recipients`);
    return { success: true };
  } catch (error) {
    const errorMsg = String(error);
    await logWorkflowStep(executionId, node.id, 'error', `Email send failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
};

// Allowed fields per entity type (whitelist to prevent SQL injection)
const ALLOWED_UPDATE_FIELDS: Record<string, Set<string>> = {
  access_request: new Set(['status', 'priority', 'assigned_to', 'notes', 'resolution']),
  service_request: new Set(['status', 'priority', 'assigned_to', 'notes', 'resolution', 'category']),
  project: new Set(['status', 'stage', 'priority', 'assigned_to', 'notes', 'deadline']),
  installation: new Set(['status', 'stage', 'priority', 'assigned_to', 'notes', 'deadline']),
};

// Validate that a field name is a safe SQL identifier
const isSafeFieldName = (field: string): boolean =>
  /^[a-z][a-z0-9_]{0,62}$/.test(field);

// Execute update_field node
const executeUpdateFieldNode = async (
  node: WorkflowNode,
  context: WorkflowContext,
  executionId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const { field, value } = node.configuration;

    if (!field) {
      throw new Error('Field name is required');
    }

    // Validate field name against whitelist to prevent SQL injection
    if (!isSafeFieldName(field)) {
      throw new Error(`Invalid field name format: ${field}`);
    }

    const allowedFields = ALLOWED_UPDATE_FIELDS[context.entityType];
    if (!allowedFields || !allowedFields.has(field)) {
      throw new Error(`Field "${field}" is not allowed for entity type "${context.entityType}"`);
    }

    const processedValue = typeof value === 'string'
      ? replaceTemplateVariables(value, context)
      : value;

    // Determine table name from entity type
    const tableMap: Record<string, string> = {
      access_request: 'access_requests',
      service_request: 'service_requests',
      project: 'requests',
      installation: 'requests',
    };

    const tableName = tableMap[context.entityType];
    if (!tableName) {
      throw new Error(`Unknown entity type: ${context.entityType}`);
    }

    // Field name is safe — validated against whitelist and regex above
    await dbQuery(
      `UPDATE ${tableName} SET ${field} = $1, updated_at = NOW() WHERE id = $2::uuid`,
      [processedValue, context.entityId]
    );

    await logWorkflowStep(executionId, node.id, 'info', `Updated field ${field} to ${processedValue}`);
    return { success: true };
  } catch (error) {
    const errorMsg = String(error);
    await logWorkflowStep(executionId, node.id, 'error', `Field update failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
};

// Execute call_api node
const executeCallApiNode = async (
  node: WorkflowNode,
  context: WorkflowContext,
  executionId: string
): Promise<{ success: boolean; error?: string; data?: any }> => {
  try {
    const { method = 'GET', url, headers = {}, body } = node.configuration;

    if (!url) {
      throw new Error('API URL is required');
    }

    const processedUrl = replaceTemplateVariables(url, context);

    // Validate URL to prevent SSRF attacks
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(processedUrl);
    } catch {
      throw new Error(`Invalid API URL: ${processedUrl}`);
    }

    // Only allow HTTPS (and HTTP for localhost in dev)
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
    }

    // Block requests to internal/private networks
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', 'metadata.google.internal', '169.254.169.254'];
    if (blockedHosts.includes(parsedUrl.hostname) || parsedUrl.hostname.startsWith('10.') || parsedUrl.hostname.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(parsedUrl.hostname)) {
      throw new Error('API calls to internal/private network addresses are not allowed');
    }
    const processedBody = body ? replaceTemplateVariables(JSON.stringify(body), context) : undefined;

    const response = await fetch(processedUrl, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: processedBody,
    });

    const responseData = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(`API call failed with status ${response.status}`);
    }

    await logWorkflowStep(executionId, node.id, 'info', `API call successful: ${method} ${processedUrl}`, {
      status: response.status,
      response: responseData,
    });

    return { success: true, data: responseData };
  } catch (error) {
    const errorMsg = String(error);
    await logWorkflowStep(executionId, node.id, 'error', `API call failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
};

// Execute run_script node
const executeRunScriptNode = async (
  node: WorkflowNode,
  context: WorkflowContext,
  executionId: string
): Promise<{ success: boolean; error?: string; result?: any }> => {
  try {
    const { script } = node.configuration;

    if (!script) {
      throw new Error('Script is required');
    }

    // Script execution is disabled for security reasons (RCE risk via new Function).
    // To re-enable, use a sandboxed runtime like isolated-vm.
    throw new Error('Script execution is disabled for security. Use isolated-vm or remove run_script nodes.');

    await logWorkflowStep(executionId, node.id, 'info', 'Script executed successfully', { result });
    return { success: true, result };
  } catch (error) {
    const errorMsg = String(error);
    await logWorkflowStep(executionId, node.id, 'error', `Script execution failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
};

// Execute create_record node
const executeCreateRecordNode = async (
  node: WorkflowNode,
  context: WorkflowContext,
  executionId: string
): Promise<{ success: boolean; error?: string; recordId?: string }> => {
  try {
    const { entityType, data } = node.configuration;

    if (!entityType || !data) {
      throw new Error('Entity type and data are required');
    }

    // Process data with template variables
    const processedData = JSON.parse(replaceTemplateVariables(JSON.stringify(data), context));

    // This is a simplified implementation - extend based on entity types
    await logWorkflowStep(executionId, node.id, 'info', `Record creation requested for ${entityType}`, {
      data: processedData,
    });

    return { success: true };
  } catch (error) {
    const errorMsg = String(error);
    await logWorkflowStep(executionId, node.id, 'error', `Record creation failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
};

// Execute delay node
const executeDelayNode = async (
  node: WorkflowNode,
  context: WorkflowContext,
  executionId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const { duration = 1000 } = node.configuration;

    await new Promise(resolve => setTimeout(resolve, duration));

    await logWorkflowStep(executionId, node.id, 'info', `Delayed for ${duration}ms`);
    return { success: true };
  } catch (error) {
    const errorMsg = String(error);
    await logWorkflowStep(executionId, node.id, 'error', `Delay failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
};

// Evaluate condition node
const evaluateConditionNode = (
  node: WorkflowNode,
  context: WorkflowContext
): boolean => {
  const { field, operator, value } = node.configuration;
  const fieldValue = context.entityData[field];

  switch (operator) {
    case 'equals':
      return fieldValue === value;
    case 'not_equals':
      return fieldValue !== value;
    case 'contains':
      return String(fieldValue || '').includes(String(value));
    case 'in':
      return Array.isArray(value) && value.includes(fieldValue);
    case 'not_in':
      return Array.isArray(value) && !value.includes(fieldValue);
    case 'greater_than':
      return Number(fieldValue) > Number(value);
    case 'less_than':
      return Number(fieldValue) < Number(value);
    case 'is_null':
      return fieldValue == null;
    case 'is_not_null':
      return fieldValue != null;
    default:
      return false;
  }
};

// Execute workflow node
const executeWorkflowNode = async (
  node: WorkflowNode,
  context: WorkflowContext,
  executionId: string
): Promise<{ success: boolean; error?: string; shouldContinue: boolean; data?: any }> => {
  const nodeType = normalizeText(node.nodeType);

  switch (nodeType) {
    case 'send_email':
      const emailResult = await executeSendEmailNode(node, context, executionId);
      return { ...emailResult, shouldContinue: true };

    case 'update_field':
      const updateResult = await executeUpdateFieldNode(node, context, executionId);
      return { ...updateResult, shouldContinue: true };

    case 'call_api':
      const apiResult = await executeCallApiNode(node, context, executionId);
      return { ...apiResult, shouldContinue: true };

    case 'run_script':
      const scriptResult = await executeRunScriptNode(node, context, executionId);
      return { ...scriptResult, shouldContinue: true };

    case 'create_record':
      const createResult = await executeCreateRecordNode(node, context, executionId);
      return { ...createResult, shouldContinue: true };

    case 'delay':
      const delayResult = await executeDelayNode(node, context, executionId);
      return { ...delayResult, shouldContinue: true };

    case 'condition':
      const conditionResult = evaluateConditionNode(node, context);
      await logWorkflowStep(executionId, node.id, 'info', `Condition evaluated to ${conditionResult}`);
      return { success: true, shouldContinue: conditionResult };

    case 'branch':
      // Branch nodes allow multiple paths - always continue
      await logWorkflowStep(executionId, node.id, 'info', 'Branch node executed');
      return { success: true, shouldContinue: true };

    default:
      await logWorkflowStep(executionId, node.id, 'warning', `Unknown node type: ${nodeType}`);
      return { success: true, shouldContinue: true };
  }
};

// Execute workflow with nodes
export const executeAdvancedWorkflow = async (
  workflowId: string,
  context: WorkflowContext,
  executionId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    // Load workflow nodes
    const nodesResult = await dbQuery(
      `SELECT id::text, node_type, node_name, configuration, execution_order
       FROM workflow_action_nodes
       WHERE workflow_id = $1::uuid
       ORDER BY execution_order ASC`,
      [workflowId]
    );

    const nodes: WorkflowNode[] = nodesResult.rows.map(row => ({
      id: String(row.id),
      nodeType: String(row.node_type),
      nodeName: String(row.node_name),
      configuration: row.configuration || {},
      executionOrder: Number(row.execution_order || 0),
    }));

    if (nodes.length === 0) {
      await logWorkflowStep(executionId, null, 'warning', 'No nodes found for workflow');
      return { success: true };
    }

    await logWorkflowStep(executionId, null, 'info', `Starting workflow execution with ${nodes.length} nodes`);

    // Execute nodes in order
    for (const node of nodes) {
      const result = await executeWorkflowNode(node, context, executionId);

      if (!result.success) {
        return { success: false, error: result.error };
      }

      if (!result.shouldContinue) {
        await logWorkflowStep(executionId, null, 'info', 'Workflow stopped by condition');
        break;
      }

      // Store result data in context variables for next nodes
      if (result.data) {
        context.variables = { ...context.variables, lastResult: result.data };
      }
    }

    await logWorkflowStep(executionId, null, 'info', 'Workflow execution completed successfully');
    return { success: true };
  } catch (error) {
    const errorMsg = String(error);
    await logWorkflowStep(executionId, null, 'error', `Workflow execution failed: ${errorMsg}`);
    logger.error('Advanced workflow execution failed', {
      workflowId,
      context,
      error: serializeError(error),
    });
    return { success: false, error: errorMsg };
  }
};

// Retry failed workflow execution
export const retryWorkflowExecution = async (executionId: string): Promise<void> => {
  try {
    const result = await dbQuery(
      `SELECT id::text, rule_id::text, entity_type, entity_id, trigger_type, trigger_data, retry_count, max_retries
       FROM workflow_executions
       WHERE id = $1::uuid AND status = 'failed'`,
      [executionId]
    );

    if (result.rows.length === 0) {
      throw new Error('Execution not found or not in failed state');
    }

    const execution = result.rows[0];

    if (execution.retry_count >= execution.max_retries) {
      throw new Error('Maximum retry attempts reached');
    }

    // Update retry count and status
    await dbQuery(
      `UPDATE workflow_executions
       SET status = 'retrying', retry_count = retry_count + 1, started_at = NOW()
       WHERE id = $1::uuid`,
      [executionId]
    );

    // Re-execute workflow
    const context: WorkflowContext = {
      entityType: String(execution.entity_type),
      entityId: String(execution.entity_id),
      entityData: execution.trigger_data || {},
      triggerType: String(execution.trigger_type),
      triggerData: execution.trigger_data || {},
    };

    const workflowResult = await executeAdvancedWorkflow(
      String(execution.rule_id),
      context,
      String(execution.id)
    );

    // Update execution status
    await dbQuery(
      `UPDATE workflow_executions
       SET status = $2, result = $3, error_message = $4, completed_at = NOW()
       WHERE id = $1::uuid`,
      [
        executionId,
        workflowResult.success ? 'completed' : 'failed',
        JSON.stringify(workflowResult),
        workflowResult.error || null,
      ]
    );
  } catch (error) {
    logger.error('Workflow retry failed', { executionId, error: serializeError(error) });
    throw error;
  }
};
