# Workspace and Collaboration Features

This document describes the workspace and collaboration features implemented in the novinzhstroy system.

## Overview

The system now includes comprehensive workspace and collaboration features inspired by Frappe patterns:

- **Customizable Workspaces**: Role-based and personal workspaces with drag-and-drop builder
- **Collaboration Tools**: @mentions, document sharing, collaborative editing indicators
- **Team Features**: Team workspaces, activity feeds, goals, and performance metrics

## Features

### 1. Workspaces

#### Types of Workspaces
- **Personal**: Individual user workspaces
- **Team**: Shared workspaces for teams with member management
- **Role-based**: Template workspaces for specific roles (dispatcher, executor, manager)

#### Workspace Builder
- Drag-and-drop widget placement
- Configurable widget types:
  - Stat cards
  - Charts
  - Lists
  - Calendar
  - Activity feed
  - Kanban boards
  - Tables
- Save and restore layouts
- Clone from templates

#### API Endpoints

```typescript
// List workspaces
GET /api/workspaces

// Get workspace templates
GET /api/workspaces/templates

// Get default workspace
GET /api/workspaces/default

// Create workspace
POST /api/workspaces
{
  "name": "My Workspace",
  "description": "Description",
  "type": "personal",
  "layout": {...},
  "settings": {...}
}

// Clone from template
POST /api/workspaces/clone
{
  "template_id": "uuid",
  "name": "New Workspace"
}

// Update workspace
PUT /api/workspaces/:id
{
  "name": "Updated Name",
  "layout": {...}
}

// Delete workspace
DELETE /api/workspaces/:id

// Set as default
POST /api/workspaces/:id/set-default

// Manage members (team workspaces)
GET /api/workspaces/:id/members
POST /api/workspaces/:id/members
DELETE /api/workspaces/:id/members/:userId
```

### 2. Document Sharing

Share documents with granular permissions and tracking.

#### Features
- Share types: view, edit, comment
- Visibility: private, public, link
- Optional password protection
- Expiration dates
- View limits
- Access analytics

#### API Endpoints

```typescript
// Create share
POST /api/shares
{
  "entity_type": "service_request",
  "entity_id": "uuid",
  "share_type": "view",
  "visibility": "link",
  "password": "optional",
  "expires_at": "2026-12-31T23:59:59Z",
  "max_views": 10
}

// Get share by token
GET /api/shares/:token

// List shares for entity
GET /api/shares/entity/:entityType/:entityId

// Revoke share
DELETE /api/shares/:id

// Get analytics
GET /api/shares/:id/analytics
```

### 3. @Mentions

Mention users in comments and messages with notifications.

#### Features
- Autocomplete user suggestions
- Real-time mention detection
- Unread mention tracking
- Context linking

#### API Endpoints

```typescript
// Create mention
POST /api/mentions
{
  "entity_type": "comment",
  "entity_id": "uuid",
  "mentioned_user_id": "uuid",
  "context_type": "service_request",
  "context_id": "uuid"
}

// List user mentions
GET /api/mentions?is_read=false

// Get unread count
GET /api/mentions/unread-count

// Mark as read
PUT /api/mentions/:id/read

// Mark all as read
PUT /api/mentions/read-all
```

### 4. Team Activity Feed

Track and display team activities in real-time.

#### Activity Types
- created
- updated
- commented
- assigned
- completed
- deleted
- shared
- mentioned

#### API Endpoints

```typescript
// Create activity
POST /api/activity
{
  "activity_type": "created",
  "entity_type": "service_request",
  "entity_id": "uuid",
  "team_id": "uuid",
  "title": "Activity title",
  "description": "Description",
  "metadata": {...}
}

// List team activity
GET /api/activity?team_id=uuid&limit=50

// List user activity
GET /api/activity/user/:userId?limit=50
```

### 5. Collaborative Editing

Show who is currently editing documents.

#### Features
- Real-time session tracking
- Active user indicators
- Automatic session cleanup (5 minutes inactivity)

#### API Endpoints

```typescript
// Start session
POST /api/collaborative-sessions
{
  "entity_type": "service_request",
  "entity_id": "uuid"
}

// Update activity
PUT /api/collaborative-sessions/:token/activity

// End session
DELETE /api/collaborative-sessions/:token

// List active sessions
GET /api/collaborative-sessions/:entityType/:entityId
```

### 6. Team Goals and Metrics

Track team goals and performance metrics.

#### Goal Types
- custom
- performance
- quality
- efficiency

#### API Endpoints

```typescript
// Create goal
POST /api/team/goals
{
  "workspace_id": "uuid",
  "title": "Goal title",
  "goal_type": "performance",
  "target_value": 100,
  "unit": "requests",
  "end_date": "2026-12-31"
}

// List goals
GET /api/team/goals?workspace_id=uuid&status=active

// Update goal
PUT /api/team/goals/:id

// Update progress
PUT /api/team/goals/:id/progress
{
  "current_value": 75
}

// Delete goal
DELETE /api/team/goals/:id

// Record metric
POST /api/team/metrics
{
  "workspace_id": "uuid",
  "metric_type": "avg_response_time",
  "metric_value": 3600,
  "metric_unit": "seconds",
  "period_start": "2026-03-01",
  "period_end": "2026-03-07"
}

// Get metrics
GET /api/team/metrics?workspace_id=uuid&metric_type=avg_response_time

// Get performance
GET /api/team/performance?workspace_id=uuid&period_start=...&period_end=...

// Get dashboard metrics
GET /api/team/dashboard/:workspaceId
```

## Frontend Components

### WorkspaceBuilder
Drag-and-drop workspace builder component.

```tsx
import WorkspaceBuilder from '@/components/WorkspaceBuilder';

<WorkspaceBuilder
  workspaceId={workspace.id}
  initialLayout={workspace.layout}
  onSave={handleSave}
/>
```

### MentionInput
Text input with @mention support.

```tsx
import MentionInput from '@/components/MentionInput';

<MentionInput
  value={comment}
  onChange={setComment}
  onMention={handleMention}
  placeholder="Add a comment..."
/>
```

### TeamActivityFeed
Display team activity feed.

```tsx
import TeamActivityFeed from '@/components/TeamActivityFeed';

<TeamActivityFeed
  teamId={workspace.id}
  limit={50}
/>
```

### CollaborativeEditingIndicator
Show active editors.

```tsx
import CollaborativeEditingIndicator from '@/components/CollaborativeEditingIndicator';

<CollaborativeEditingIndicator
  entityType="service_request"
  entityId={request.id}
/>
```

## Database Schema

### Tables Created

- `workspaces` - User and team workspaces
- `workspace_members` - Team workspace members
- `document_shares` - Shared documents with permissions
- `document_share_access_log` - Share access tracking
- `mentions` - User mentions
- `team_activity_feed` - Team activity log
- `collaborative_editing_sessions` - Active editing sessions
- `team_goals` - Team goals and objectives
- `team_performance_metrics` - Performance metrics

## Migration

Run the migration to create the necessary tables:

```bash
cd backend
npm run migrate
```

The migration file is located at:
`backend/migrations/20260312_add_workspace_collaboration.sql`

## Testing

Run the test suite:

```bash
cd backend
npm test
```

Test files:
- `tests/workspaceService.test.ts`
- `tests/collaborationService.test.ts`

## Usage Examples

### Creating a Personal Workspace

```typescript
const workspace = await axios.post('/api/workspaces', {
  name: 'My Dashboard',
  description: 'Personal workspace',
  type: 'personal',
  layout: {
    widgets: [
      {
        id: 'my-tasks',
        type: 'list',
        title: 'My Tasks',
        position: { x: 0, y: 0, w: 6, h: 4 }
      }
    ]
  }
});
```

### Sharing a Document

```typescript
const share = await axios.post('/api/shares', {
  entity_type: 'service_request',
  entity_id: requestId,
  share_type: 'view',
  visibility: 'link',
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
});

// Share URL: /shared/${share.share_token}
```

### Mentioning a User

```typescript
// In comment text: "Hey @Иван Петров, please review this"
await axios.post('/api/mentions', {
  entity_type: 'comment',
  entity_id: commentId,
  mentioned_user_id: userId,
  context_type: 'service_request',
  context_id: requestId
});
```

### Tracking Team Activity

```typescript
await axios.post('/api/activity', {
  activity_type: 'completed',
  entity_type: 'service_request',
  entity_id: requestId,
  team_id: workspaceId,
  title: 'Service request completed',
  description: 'Request #123 was completed successfully'
});
```

## Best Practices

1. **Workspace Organization**: Use role-based templates for consistent team experiences
2. **Document Sharing**: Always set expiration dates for sensitive documents
3. **Mentions**: Use mentions sparingly to avoid notification fatigue
4. **Activity Feed**: Log significant events only to keep the feed relevant
5. **Collaborative Editing**: Sessions auto-cleanup after 5 minutes of inactivity
6. **Team Goals**: Set realistic, measurable goals with clear deadlines
7. **Performance Metrics**: Record metrics regularly for accurate trend analysis

## Security Considerations

- Workspace access is controlled by ownership and membership
- Document shares can be password-protected
- Share access is logged for audit purposes
- Collaborative sessions are user-specific
- Team metrics are workspace-scoped

## Future Enhancements

- Real-time collaboration using WebSockets
- Advanced workspace templates with conditional widgets
- Team chat integration
- Collaborative document editing
- Advanced analytics and reporting
- Mobile app support
- Integration with external tools (Slack, Teams, etc.)
