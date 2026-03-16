# Advanced Workflow Automation System

## Overview

The Advanced Workflow Automation System provides a comprehensive solution for automating business processes in the Novinzhstroy platform. It includes a visual workflow builder, pre-built templates, execution monitoring, and advanced features like retry logic, error handling, and performance metrics.

## Features

### 1. Visual Workflow Builder
- Drag-and-drop interface for creating workflows
- Multiple node types: send_email, create_record, update_field, call_api, run_script, condition, delay, branch
- Real-time workflow visualization
- Node configuration with template variables
- Execution order management

### 2. Workflow Templates
Pre-built templates for common scenarios:
- **Approval Workflow**: Multi-level approval with escalation
- **Escalation Workflow**: Automatic escalation for overdue items
- **Notification Workflow**: Send notifications on status changes
- **Data Sync Workflow**: Synchronize data with external systems

### 3. Trigger Conditions
- **on_create**: Triggered when entity is created
- **on_update**: Triggered when entity is updated
- **on_delete**: Triggered when entity is deleted
- **status_change**: Triggered on status changes
- **deadline**: Triggered before deadline
- **scheduled**: Triggered on schedule (cron)

### 4. Action Nodes

#### Send Email
```json
{
  "nodeType": "send_email",
  "configuration": {
    "recipients": ["admin", "manager", "creator"],
    "subject": "{{entity.title}}",
    "body": "Status changed to {{entity.status}}"
  }
}
```

#### Update Field
```json
{
  "nodeType": "update_field",
  "configuration": {
    "field": "priority",
    "value": "urgent"
  }
}
```

#### Call API
```json
{
  "nodeType": "call_api",
  "configuration": {
    "method": "POST",
    "url": "https://api.example.com/webhook",
    "headers": {"Content-Type": "application/json"},
    "body": "{{entity}}"
  }
}
```

#### Run Script
```json
{
  "nodeType": "run_script",
  "configuration": {
    "script": "return context.entity.status === 'approved';"
  }
}
```

#### Condition
```json
{
  "nodeType": "condition",
  "configuration": {
    "field": "status",
    "operator": "equals",
    "value": "approved"
  }
}
```

### 5. Workflow Execution Engine
- Asynchronous execution
- Retry logic with configurable max retries
- Error handling and logging
- Execution history tracking
- Step-by-step execution logs

### 6. Monitoring Dashboard
- Active workflows overview
- Execution statistics (total, successful, failed)
- Performance metrics (avg execution time)
- Failed workflow alerts
- Real-time monitoring

## Database Schema

### Core Tables

#### workflow_rules
Stores workflow definitions with triggers and conditions.

```sql
CREATE TABLE workflow_rules (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    entity_type VARCHAR(100) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL,
    trigger_config JSONB,
    conditions JSONB,
    actions JSONB,
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1,
    is_draft BOOLEAN DEFAULT false,
    published_at TIMESTAMPTZ,
    created_by_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
```

#### workflow_executions
Tracks workflow execution history with retry logic.

```sql
CREATE TABLE workflow_executions (
    id UUID PRIMARY KEY,
    rule_id UUID REFERENCES workflow_rules(id),
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL,
    trigger_data JSONB,
    status VARCHAR(50) DEFAULT 'pending',
    result JSONB,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### workflow_action_nodes
Visual workflow builder nodes with positions and configurations.

```sql
CREATE TABLE workflow_action_nodes (
    id UUID PRIMARY KEY,
    workflow_id UUID REFERENCES workflow_rules(id),
    node_type VARCHAR(50) NOT NULL,
    node_name VARCHAR(255) NOT NULL,
    position_x INTEGER DEFAULT 0,
    position_y INTEGER DEFAULT 0,
    configuration JSONB,
    execution_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### workflow_templates
Pre-built workflow templates for common scenarios.

```sql
CREATE TABLE workflow_templates (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    icon VARCHAR(50),
    template_config JSONB NOT NULL,
    is_public BOOLEAN DEFAULT false,
    usage_count INTEGER DEFAULT 0,
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### workflow_metrics
Aggregated performance metrics by date.

```sql
CREATE TABLE workflow_metrics (
    id UUID PRIMARY KEY,
    workflow_id UUID REFERENCES workflow_rules(id),
    metric_date DATE NOT NULL,
    total_executions INTEGER DEFAULT 0,
    successful_executions INTEGER DEFAULT 0,
    failed_executions INTEGER DEFAULT 0,
    avg_execution_time_ms INTEGER DEFAULT 0,
    total_execution_time_ms BIGINT DEFAULT 0,
    UNIQUE(workflow_id, metric_date)
);
```

#### workflow_alerts
Alerts for failed workflows and performance issues.

```sql
CREATE TABLE workflow_alerts (
    id UUID PRIMARY KEY,
    workflow_id UUID REFERENCES workflow_rules(id),
    execution_id UUID REFERENCES workflow_executions(id),
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    details JSONB,
    is_acknowledged BOOLEAN DEFAULT false,
    acknowledged_by UUID,
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## API Endpoints

### Workflow Templates

#### GET /workflow-templates
List all workflow templates.

**Query Parameters:**
- `category` (optional): Filter by category
- `isPublic` (optional): Filter public templates

**Response:**
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Approval Workflow",
      "description": "Multi-level approval workflow",
      "category": "approval",
      "icon": "check-circle",
      "templateConfig": {},
      "isPublic": true,
      "usageCount": 42,
      "tags": ["approval", "notification"]
    }
  ]
}
```

#### POST /workflow-templates/:templateId/create
Create workflow from template.

**Request Body:**
```json
{
  "workflowName": "My Approval Workflow",
  "entityType": "service_request"
}
```

### Workflow Nodes

#### GET /workflows/:workflowId/nodes
Get all nodes for a workflow.

**Response:**
```json
{
  "items": [
    {
      "id": "uuid",
      "nodeType": "send_email",
      "nodeName": "Send Notification",
      "positionX": 100,
      "positionY": 100,
      "configuration": {},
      "executionOrder": 0
    }
  ]
}
```

#### POST /workflows/:workflowId/nodes
Create a new workflow node.

**Request Body:**
```json
{
  "nodeType": "send_email",
  "nodeName": "Send Notification",
  "positionX": 100,
  "positionY": 100,
  "configuration": {
    "recipients": ["admin"],
    "subject": "Test",
    "body": "Test message"
  },
  "executionOrder": 0
}
```

#### PATCH /workflows/:workflowId/nodes/:nodeId
Update a workflow node.

#### DELETE /workflows/:workflowId/nodes/:nodeId
Delete a workflow node.

### Workflow Metrics

#### GET /workflows/:workflowId/metrics
Get workflow performance metrics.

**Query Parameters:**
- `days` (optional): Number of days to retrieve (default: 30, max: 90)

**Response:**
```json
{
  "items": [
    {
      "date": "2026-03-12",
      "totalExecutions": 150,
      "successfulExecutions": 145,
      "failedExecutions": 5,
      "avgExecutionTimeMs": 1250
    }
  ]
}
```

### Workflow Alerts

#### GET /workflow-alerts
Get workflow alerts.

**Query Parameters:**
- `workflowId` (optional): Filter by workflow
- `isAcknowledged` (optional): Filter by acknowledgment status
- `severity` (optional): Filter by severity (low, medium, high, critical)
- `limit` (optional): Max results (default: 100, max: 500)

**Response:**
```json
{
  "items": [
    {
      "id": "uuid",
      "workflowId": "uuid",
      "workflowName": "My Workflow",
      "executionId": "uuid",
      "alertType": "execution_failed",
      "severity": "high",
      "message": "Workflow execution failed",
      "details": {},
      "isAcknowledged": false,
      "createdAt": "2026-03-12T10:00:00Z"
    }
  ]
}
```

#### POST /workflow-alerts/:alertId/acknowledge
Acknowledge a workflow alert.

### Workflow Execution

#### POST /workflow-executions/:executionId/retry
Retry a failed workflow execution.

#### GET /workflow-executions/:executionId/logs
Get detailed execution logs.

**Response:**
```json
{
  "items": [
    {
      "id": "uuid",
      "nodeId": "uuid",
      "logLevel": "info",
      "message": "Email sent successfully",
      "details": {},
      "createdAt": "2026-03-12T10:00:00Z"
    }
  ]
}
```

## Template Variables

Use template variables in workflow configurations to access entity data:

- `{{entity.id}}` - Entity ID
- `{{entity.title}}` - Entity title
- `{{entity.status}}` - Entity status
- `{{entity.createdById}}` - Creator ID
- `{{entity.*}}` - Any entity field

Example:
```
Subject: Request {{entity.title}} needs approval
Body: Request created by {{entity.creatorName}} on {{entity.createdAt}}
```

## Usage Examples

### Example 1: Create Approval Workflow

```typescript
// 1. Create workflow from template
const response = await api.post('/workflow-templates/template-id/create', {
  workflowName: 'Service Request Approval',
  entityType: 'service_request'
});

const workflowId = response.id;

// 2. Add custom nodes
await api.post(`/workflows/${workflowId}/nodes`, {
  nodeType: 'condition',
  nodeName: 'Check Priority',
  configuration: {
    field: 'priority',
    operator: 'equals',
    value: 'urgent'
  },
  executionOrder: 0
});

await api.post(`/workflows/${workflowId}/nodes`, {
  nodeType: 'send_email',
  nodeName: 'Notify Manager',
  configuration: {
    recipients: ['manager'],
    subject: 'Urgent Request: {{entity.title}}',
    body: 'Priority request requires immediate attention'
  },
  executionOrder: 1
});

// 3. Activate workflow
await api.patch(`/workflow-rules/${workflowId}`, {
  isActive: true
});
```

### Example 2: Monitor Workflow Performance

```typescript
// Get metrics
const metrics = await api.get(`/workflows/${workflowId}/metrics?days=30`);

// Calculate success rate
const totalExecutions = metrics.items.reduce((sum, m) => sum + m.totalExecutions, 0);
const successfulExecutions = metrics.items.reduce((sum, m) => sum + m.successfulExecutions, 0);
const successRate = (successfulExecutions / totalExecutions) * 100;

console.log(`Success rate: ${successRate.toFixed(1)}%`);

// Get unacknowledged alerts
const alerts = await api.get(`/workflow-alerts?workflowId=${workflowId}&isAcknowledged=false`);

console.log(`Active alerts: ${alerts.items.length}`);
```

### Example 3: Handle Failed Executions

```typescript
// Get failed executions
const executions = await api.get(`/workflow-executions?ruleId=${workflowId}&status=failed`);

for (const execution of executions.items) {
  // Get execution logs
  const logs = await api.get(`/workflow-executions/${execution.id}/logs`);

  console.log(`Execution ${execution.id} failed:`);
  logs.items.forEach(log => {
    if (log.logLevel === 'error') {
      console.log(`  - ${log.message}`);
    }
  });

  // Retry if not exceeded max retries
  if (execution.retryCount < execution.maxRetries) {
    await api.post(`/workflow-executions/${execution.id}/retry`, {});
    console.log(`  Retrying execution...`);
  }
}
```

## Best Practices

1. **Start with Templates**: Use pre-built templates as starting points
2. **Test Workflows**: Create draft workflows and test before activating
3. **Monitor Performance**: Regularly check metrics and alerts
4. **Handle Errors**: Configure retry logic and error notifications
5. **Use Conditions**: Add conditions to prevent unnecessary executions
6. **Optimize Execution Order**: Order nodes efficiently to minimize execution time
7. **Document Workflows**: Add clear names and descriptions
8. **Version Control**: Use draft mode for testing changes

## Troubleshooting

### Workflow Not Executing
- Check if workflow is active (`isActive = true`)
- Verify trigger conditions match entity events
- Check workflow priority (higher priority executes first)
- Review execution logs for errors

### High Failure Rate
- Check workflow alerts for common errors
- Review execution logs for failed steps
- Verify API endpoints are accessible
- Check template variable syntax

### Slow Execution
- Review metrics for avg execution time
- Optimize node configurations
- Remove unnecessary delay nodes
- Consider splitting complex workflows

## Migration Guide

To migrate existing workflows to the advanced system:

1. Run database migrations:
```bash
npm run migrate
```

2. Import existing workflow rules (if any)
3. Create nodes from existing actions
4. Test workflows in draft mode
5. Activate workflows

## Files Created

### Backend
- `/backend/sql/024_workflow_rules_base.sql` - Base workflow tables
- `/backend/sql/025_workflow_advanced_engine.sql` - Advanced features
- `/backend/src/services/advancedWorkflowEngine.ts` - Execution engine
- `/backend/src/routes/advancedWorkflow.ts` - API routes
- `/backend/tests/advancedWorkflow.test.ts` - Unit tests

### Frontend
- `/frontend/src/pages/VisualWorkflowBuilder.tsx` - Visual builder component

## Support

For issues or questions:
1. Check execution logs in the monitoring dashboard
2. Review workflow alerts
3. Consult this documentation
4. Contact system administrator
