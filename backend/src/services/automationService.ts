import { EventEmitter } from 'node:events';
import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';
import { normalizeText, isUuidValue } from '../helpers/normalize.js';
import { pushInAppNotification, getAdminManagerIds } from './notificationService.js';

// Event emitter for entity changes
class AutomationEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }
}

export const automationEvents = new AutomationEventEmitter();

// Entity change event types
export const AUTOMATION_EVENTS = {
  SERVICE_REQUEST_CREATED: 'service_request:created',
  SERVICE_REQUEST_UPDATED: 'service_request:updated',
  SERVICE_REQUEST_STATUS_CHANGED: 'service_request:status_changed',
  SERVICE_REQUEST_OVERDUE: 'service_request:overdue',
  INSTALLATION_CREATED: 'installation:created',
  INSTALLATION_UPDATED: 'installation:updated',
  INSTALLATION_STATUS_CHANGED: 'installation:status_changed',
  INSTALLATION_DEADLINE_CHECK: 'installation:deadline_check',
  PROJECT_CREATED: 'project:created',
  PROJECT_UPDATED: 'project:updated',
  PROJECT_STATUS_CHANGED: 'project:status_changed',
};

// Emit entity change event
export const emitEntityEvent = (eventType: string, payload: any) => {
  try {
    automationEvents.emit(eventType, payload);
    logger.debug('Automation event emitted', { eventType, entityId: payload?.entityId });
  } catch (error) {
    logger.error('Failed to emit automation event', {
      eventType,
      error: serializeError(error),
    });
  }
};

// Rule evaluation engine
interface AutomationRule {
  id: string;
  name: string;
  description: string;
  entity_type: string;
  trigger_event: string;
  conditions: any[];
  actions: any[];
  is_active: boolean;
  priority: number;
}

interface EvaluationContext {
  entity: any;
  entityType: string;
  entityId: string;
  triggerEvent: string;
  metadata?: any;
}

// Condition operators
const evaluateCondition = (condition: any, context: EvaluationContext): boolean => {
  const { field, operator, value } = condition;
  const entityValue = context.entity?.[field];

  switch (operator) {
    case 'equals':
      return entityValue === value;
    case 'not_equals':
      return entityValue !== value;
    case 'in':
      return Array.isArray(value) && value.includes(entityValue);
    case 'not_in':
      return Array.isArray(value) && !value.includes(entityValue);
    case 'greater_than':
      return Number(entityValue) > Number(value);
    case 'less_than':
      return Number(entityValue) < Number(value);
    case 'greater_than_or_equal':
      return Number(entityValue) >= Number(value);
    case 'less_than_or_equal':
      return Number(entityValue) <= Number(value);
    case 'contains':
      return String(entityValue).includes(String(value));
    case 'not_contains':
      return !String(entityValue).includes(String(value));
    case 'is_null':
      return entityValue === null || entityValue === undefined;
    case 'is_not_null':
      return entityValue !== null && entityValue !== undefined;
    default:
      logger.warn('Unknown condition operator', { operator, field });
      return false;
  }
};

// Evaluate all conditions for a rule
const evaluateRuleConditions = (rule: AutomationRule, context: EvaluationContext): boolean => {
  if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) {
    return true; // No conditions means always match
  }

  // All conditions must be true (AND logic)
  return rule.conditions.every(condition => evaluateCondition(condition, context));
};

// Load active rules for entity type and trigger event
export const loadAutomationRules = async (entityType: string, triggerEvent: string): Promise<AutomationRule[]> => {
  try {
    const result = await dbQuery(
      `SELECT
        id::text,
        name,
        description,
        entity_type,
        trigger_event,
        conditions,
        actions,
        is_active,
        priority
      FROM automation_rules
      WHERE entity_type = $1
        AND trigger_event = $2
        AND is_active = true
        AND deleted_at IS NULL
      ORDER BY priority DESC, created_at ASC`,
      [entityType, triggerEvent]
    );

    return result.rows.map(row => ({
      id: normalizeText(row.id),
      name: normalizeText(row.name),
      description: normalizeText(row.description),
      entity_type: normalizeText(row.entity_type),
      trigger_event: normalizeText(row.trigger_event),
      conditions: row.conditions || [],
      actions: row.actions || [],
      is_active: row.is_active,
      priority: row.priority || 0,
    }));
  } catch (error) {
    logger.error('Failed to load automation rules', {
      entityType,
      triggerEvent,
      error: serializeError(error),
    });
    return [];
  }
};

// Action executor
interface ActionResult {
  action: any;
  status: 'success' | 'failed';
  result?: any;
  error?: string;
}

const executeAction = async (action: any, context: EvaluationContext): Promise<ActionResult> => {
  const { type, params } = action;

  try {
    switch (type) {
      case 'send_notification':
        await executeSendNotificationAction(params, context);
        return { action, status: 'success', result: 'Notification sent' };

      case 'update_field':
        await executeUpdateFieldAction(params, context);
        return { action, status: 'success', result: `Field ${params.field} updated` };

      case 'log_activity':
        await executeLogActivityAction(params, context);
        return { action, status: 'success', result: 'Activity logged' };

      case 'send_email':
        await executeSendEmailAction(params, context);
        return { action, status: 'success', result: 'Email queued' };

      default:
        logger.warn('Unknown action type', { type, entityId: context.entityId });
        return { action, status: 'failed', error: `Unknown action type: ${type}` };
    }
  } catch (error) {
    logger.error('Action execution failed', {
      actionType: type,
      entityId: context.entityId,
      error: serializeError(error),
    });
    return { action, status: 'failed', error: String(error) };
  }
};

// Action implementations
const executeSendNotificationAction = async (params: any, context: EvaluationContext) => {
  const { recipients, template } = params;
  const recipientIds: string[] = [];

  // Resolve recipient types
  if (Array.isArray(recipients)) {
    for (const recipient of recipients) {
      if (recipient === 'admin' || recipient === 'manager') {
        const adminManagerIds = await getAdminManagerIds();
        recipientIds.push(...adminManagerIds);
      } else if (recipient === 'executor' && context.entity?.executor_ids) {
        recipientIds.push(...context.entity.executor_ids);
      } else if (recipient === 'creator' && context.entity?.created_by_id) {
        recipientIds.push(context.entity.created_by_id);
      } else if (isUuidValue(recipient)) {
        recipientIds.push(recipient);
      }
    }
  }

  if (recipientIds.length === 0) {
    return;
  }

  // Build notification content based on template
  const { title, body } = buildNotificationContent(template, context);

  await pushInAppNotification({
    recipientIds: Array.from(new Set(recipientIds)),
    eventType: 'automation_triggered',
    title,
    body,
    entityType: context.entityType,
    entityId: context.entityId,
  });
};

const executeUpdateFieldAction = async (params: any, context: EvaluationContext) => {
  const { field, value } = params;

  if (!field || value === undefined) {
    throw new Error('Invalid update_field params');
  }

  // Update the entity field based on entity type
  if (context.entityType === 'service_request') {
    await dbQuery(
      `UPDATE requests SET ${field} = $1, updated_at = now() WHERE id = $2::uuid`,
      [value, context.entityId]
    );
  } else if (context.entityType === 'installation') {
    await dbQuery(
      `UPDATE requests SET ${field} = $1, updated_at = now() WHERE id = $2::uuid AND type = 'installation'`,
      [value, context.entityId]
    );
  }
};

const executeLogActivityAction = async (params: any, context: EvaluationContext) => {
  const { activity_type, title, description } = params;

  await dbQuery(
    `INSERT INTO entity_activity_log (
      entity_type,
      entity_id,
      activity_type,
      actor_user_id,
      actor_name,
      severity,
      title,
      description,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      context.entityType,
      context.entityId,
      activity_type || 'automation',
      null, // System action
      'Automation System',
      'info',
      title || 'Automation action executed',
      description || '',
      JSON.stringify(context.metadata || {}),
    ]
  );
};

const executeSendEmailAction = async (params: any, context: EvaluationContext) => {
  // Placeholder for email sending logic
  // This would integrate with emailQueueService
  logger.info('Email action triggered', {
    params,
    entityId: context.entityId,
  });
};

// Build notification content from template
const buildNotificationContent = (template: string, context: EvaluationContext): { title: string; body: string } => {
  const entity = context.entity;

  switch (template) {
    case 'service_request_overdue':
      return {
        title: `Просроченная заявка: ${entity?.title || entity?.id}`,
        body: `Сервисная заявка просрочена и требует внимания. Статус: ${entity?.status}`,
      };

    case 'installation_deadline_reminder_7d':
      return {
        title: `Напоминание: срок монтажа через 7 дней`,
        body: `Проект "${entity?.title || entity?.id}" должен быть завершен через 7 дней. Срок: ${entity?.due_date_admin || entity?.due_date_preliminary}`,
      };

    case 'installation_deadline_reminder_3d':
      return {
        title: `Срочно: срок монтажа через 3 дня`,
        body: `Проект "${entity?.title || entity?.id}" должен быть завершен через 3 дня. Срок: ${entity?.due_date_admin || entity?.due_date_preliminary}`,
      };

    case 'installation_deadline_reminder_1d':
      return {
        title: `Критично: срок монтажа завтра`,
        body: `Проект "${entity?.title || entity?.id}" должен быть завершен завтра! Срок: ${entity?.due_date_admin || entity?.due_date_preliminary}`,
      };

    default:
      return {
        title: 'Уведомление автоматизации',
        body: `Событие: ${context.triggerEvent}`,
      };
  }
};

// Execute automation rules for an entity event
export const executeAutomationRules = async (context: EvaluationContext): Promise<void> => {
  try {
    const rules = await loadAutomationRules(context.entityType, context.triggerEvent);

    if (rules.length === 0) {
      return;
    }

    logger.info('Evaluating automation rules', {
      entityType: context.entityType,
      entityId: context.entityId,
      triggerEvent: context.triggerEvent,
      ruleCount: rules.length,
    });

    for (const rule of rules) {
      const conditionsMet = evaluateRuleConditions(rule, context);

      if (!conditionsMet) {
        logger.debug('Rule conditions not met', {
          ruleId: rule.id,
          ruleName: rule.name,
          entityId: context.entityId,
        });
        continue;
      }

      logger.info('Rule conditions met, executing actions', {
        ruleId: rule.id,
        ruleName: rule.name,
        entityId: context.entityId,
        actionCount: rule.actions.length,
      });

      // Execute all actions for this rule
      const actionResults: ActionResult[] = [];
      for (const action of rule.actions) {
        const result = await executeAction(action, context);
        actionResults.push(result);
      }

      // Log to audit trail
      const successCount = actionResults.filter(r => r.status === 'success').length;
      const executionStatus = successCount === actionResults.length ? 'success'
        : successCount > 0 ? 'partial'
        : 'failed';

      await dbQuery(
        `INSERT INTO automation_audit_log (
          rule_id,
          rule_name,
          entity_type,
          entity_id,
          trigger_event,
          conditions_met,
          actions_executed,
          execution_status,
          error_message,
          metadata
        ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          rule.id,
          rule.name,
          context.entityType,
          context.entityId,
          context.triggerEvent,
          true,
          JSON.stringify(actionResults),
          executionStatus,
          actionResults.find(r => r.status === 'failed')?.error || null,
          JSON.stringify(context.metadata || {}),
        ]
      );
    }
  } catch (error) {
    logger.error('Failed to execute automation rules', {
      entityType: context.entityType,
      entityId: context.entityId,
      triggerEvent: context.triggerEvent,
      error: serializeError(error),
    });
  }
};

// Register event listeners for automation
export const initializeAutomationListeners = () => {
  // Service request events
  automationEvents.on(AUTOMATION_EVENTS.SERVICE_REQUEST_CREATED, async (payload) => {
    await executeAutomationRules({
      entity: payload.entity,
      entityType: 'service_request',
      entityId: payload.entityId,
      triggerEvent: 'created',
      metadata: payload.metadata,
    });
  });

  automationEvents.on(AUTOMATION_EVENTS.SERVICE_REQUEST_STATUS_CHANGED, async (payload) => {
    await executeAutomationRules({
      entity: payload.entity,
      entityType: 'service_request',
      entityId: payload.entityId,
      triggerEvent: 'status_changed',
      metadata: payload.metadata,
    });
  });

  automationEvents.on(AUTOMATION_EVENTS.SERVICE_REQUEST_OVERDUE, async (payload) => {
    await executeAutomationRules({
      entity: payload.entity,
      entityType: 'service_request',
      entityId: payload.entityId,
      triggerEvent: 'check_overdue',
      metadata: payload.metadata,
    });
  });

  // Installation events
  automationEvents.on(AUTOMATION_EVENTS.INSTALLATION_CREATED, async (payload) => {
    await executeAutomationRules({
      entity: payload.entity,
      entityType: 'installation',
      entityId: payload.entityId,
      triggerEvent: 'created',
      metadata: payload.metadata,
    });
  });

  automationEvents.on(AUTOMATION_EVENTS.INSTALLATION_STATUS_CHANGED, async (payload) => {
    await executeAutomationRules({
      entity: payload.entity,
      entityType: 'installation',
      entityId: payload.entityId,
      triggerEvent: 'status_changed',
      metadata: payload.metadata,
    });
  });

  automationEvents.on(AUTOMATION_EVENTS.INSTALLATION_DEADLINE_CHECK, async (payload) => {
    await executeAutomationRules({
      entity: payload.entity,
      entityType: 'installation',
      entityId: payload.entityId,
      triggerEvent: 'check_deadline',
      metadata: payload.metadata,
    });
  });

  logger.info('Automation event listeners initialized');
};

// Scheduler functions for periodic checks
export const checkServiceRequestOverdue = async () => {
  try {
    const result = await dbQuery(
      `SELECT
        id::text,
        title,
        description,
        status,
        priority,
        created_by_id::text,
        executor_ids,
        visit_date,
        is_overdue,
        created_at,
        updated_at
      FROM requests
      WHERE type <> 'installation'
        AND is_project = false
        AND deleted_at IS NULL
        AND status NOT IN ('done', 'closed', 'cancelled')
        AND is_overdue = true
      LIMIT 50`
    );

    for (const row of result.rows) {
      emitEntityEvent(AUTOMATION_EVENTS.SERVICE_REQUEST_OVERDUE, {
        entityId: row.id,
        entity: {
          id: row.id,
          title: row.title,
          description: row.description,
          status: row.status,
          priority: row.priority,
          created_by_id: row.created_by_id,
          executor_ids: row.executor_ids || [],
          visit_date: row.visit_date,
          is_overdue: row.is_overdue,
        },
        metadata: {
          checked_at: new Date().toISOString(),
        },
      });
    }

    logger.info('Service request overdue check completed', { count: result.rows.length });
  } catch (error) {
    logger.error('Failed to check service request overdue', {
      error: serializeError(error),
    });
  }
};

export const checkInstallationDeadlines = async () => {
  try {
    const today = new Date();
    const result = await dbQuery(
      `SELECT
        id::text,
        title,
        description,
        status,
        priority,
        created_by_id::text,
        executor_ids,
        due_date_admin,
        due_date_preliminary,
        created_at,
        updated_at
      FROM requests
      WHERE type = 'installation'
        AND is_project = true
        AND deleted_at IS NULL
        AND status NOT IN ('done', 'closed', 'cancelled')
        AND (due_date_admin IS NOT NULL OR due_date_preliminary IS NOT NULL)
      LIMIT 100`
    );

    for (const row of result.rows) {
      const deadline = row.due_date_admin || row.due_date_preliminary;
      if (!deadline) continue;

      const deadlineDate = new Date(deadline);
      const daysUntil = Math.ceil((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      // Check for 7, 3, or 1 day reminders
      if ([7, 3, 1].includes(daysUntil)) {
        emitEntityEvent(AUTOMATION_EVENTS.INSTALLATION_DEADLINE_CHECK, {
          entityId: row.id,
          entity: {
            id: row.id,
            title: row.title,
            description: row.description,
            status: row.status,
            priority: row.priority,
            created_by_id: row.created_by_id,
            executor_ids: row.executor_ids || [],
            due_date_admin: row.due_date_admin,
            due_date_preliminary: row.due_date_preliminary,
            days_until_deadline: daysUntil,
          },
          metadata: {
            checked_at: new Date().toISOString(),
            days_until_deadline: daysUntil,
          },
        });
      }
    }

    logger.info('Installation deadline check completed', { count: result.rows.length });
  } catch (error) {
    logger.error('Failed to check installation deadlines', {
      error: serializeError(error),
    });
  }
};

// Start automation schedulers
export const startAutomationSchedulers = () => {
  // Check service request overdue every 30 minutes
  setInterval(async () => {
    await checkServiceRequestOverdue();
  }, 30 * 60 * 1000);

  // Check installation deadlines every hour
  setInterval(async () => {
    await checkInstallationDeadlines();
  }, 60 * 60 * 1000);

  // Run initial checks after 1 minute
  setTimeout(async () => {
    await checkServiceRequestOverdue();
    await checkInstallationDeadlines();
  }, 60 * 1000);

  logger.info('Automation schedulers started');
};
