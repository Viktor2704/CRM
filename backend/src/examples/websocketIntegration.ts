// Example: Integrating WebSocket notifications in backend services

import { realtimeNotificationService } from '../services/realtimeNotifications.js';
import { websocketServer } from '../services/websocketServer.js';

// Example 1: Sending notification when a ticket is assigned
export async function assignTicket(ticketId: number, assigneeId: number, assignedBy: string) {
    // Your existing ticket assignment logic
    // ...

    // Send real-time notification
    await realtimeNotificationService.sendNotification({
        userId: assigneeId,
        type: 'ticket_assignment',
        title: 'New Ticket Assigned',
        message: `${assignedBy} assigned you ticket #${ticketId}`,
        data: { ticketId },
        priority: 'high',
    });

    // Broadcast activity feed
    await realtimeNotificationService.broadcastActivityFeed({
        id: Date.now(),
        userId: assigneeId,
        actorId: 1, // ID of user who assigned
        actorName: assignedBy,
        action: 'assigned',
        resourceType: 'ticket',
        resourceId: ticketId,
        createdAt: new Date().toISOString(),
    });
}

// Example 2: Notifying users when a comment is added
export async function addComment(
    resourceType: string,
    resourceId: number,
    authorId: number,
    authorName: string,
    content: string
) {
    // Your existing comment creation logic
    const commentId = 123; // Newly created comment ID

    // Send real-time notification
    await realtimeNotificationService.notifyNewComment({
        commentId,
        resourceType,
        resourceId,
        authorId,
        authorName,
        content,
        createdAt: new Date().toISOString(),
    });
}

// Example 3: Broadcasting resource updates
export async function updateProject(projectId: number, updates: any, editorId: number, editorName: string) {
    // Your existing project update logic
    // ...

    // Check if other users are viewing this project
    const room = `project:${projectId}`;

    // Warn about concurrent editing
    await realtimeNotificationService.notifyConcurrentEdit(
        'project',
        projectId,
        editorId,
        editorName
    );

    // Notify about the update
    await realtimeNotificationService.notifyResourceUpdate('project', projectId, {
        updates,
        updatedBy: editorName,
        timestamp: new Date().toISOString(),
    });
}

// Example 4: Sending notifications when a task is completed
export async function completeTask(taskId: number, completedBy: string, assigneeId: number) {
    // Your existing task completion logic
    // ...

    await realtimeNotificationService.sendNotification({
        userId: assigneeId,
        type: 'task_completed',
        title: 'Task Completed',
        message: `${completedBy} marked your task as completed`,
        data: { taskId },
        priority: 'normal',
    });
}

// Example 5: Notifying users when mentioned in a comment
export async function processMentions(
    content: string,
    mentionedBy: string,
    resourceType: string,
    resourceId: number
) {
    // Extract user mentions from content (e.g., @username)
    const mentionRegex = /@(\w+)/g;
    const mentions = content.match(mentionRegex);

    if (mentions) {
        for (const mention of mentions) {
            const username = mention.slice(1);
            // Look up user ID by username
            const userId = await getUserIdByUsername(username);

            if (userId) {
                await realtimeNotificationService.notifyMention(
                    userId,
                    mentionedBy,
                    resourceType,
                    resourceId
                );
            }
        }
    }
}

// Example 6: Broadcasting system maintenance message
export async function notifySystemMaintenance(message: string, scheduledTime: Date) {
    await realtimeNotificationService.broadcastSystemMessage(
        `System maintenance scheduled for ${scheduledTime.toLocaleString()}: ${message}`,
        'urgent'
    );
}

// Example 7: Checking if user is online before sending notification
export async function sendUrgentNotification(userId: number, message: string) {
    const isOnline = await realtimeNotificationService.isUserOnline(userId);

    if (isOnline) {
        // User is online, send real-time notification
        await realtimeNotificationService.sendNotification({
            userId,
            type: 'urgent',
            title: 'Urgent Notification',
            message,
            priority: 'urgent',
        });
    } else {
        // User is offline, send email or SMS
        await sendEmailNotification(userId, message);
    }
}

// Example 8: Broadcasting to a specific room
export async function notifyProjectTeam(projectId: number, message: string) {
    const room = `project:${projectId}`;
    websocketServer.sendToRoom(room, 'team-message', {
        message,
        timestamp: new Date().toISOString(),
    });
}

// Example 9: Sending bulk notifications
export async function notifyMultipleUsers(userIds: number[], notification: any) {
    const notifications = userIds.map(userId => ({
        ...notification,
        userId,
    }));

    await realtimeNotificationService.sendBulkNotifications(notifications);
}

// Example 10: Integration with existing notification service
export async function enhanceExistingNotification(userId: number, notificationData: any) {
    // Your existing notification logic
    // ...

    // Add real-time notification
    await realtimeNotificationService.sendNotification({
        userId,
        type: notificationData.type,
        title: notificationData.title,
        message: notificationData.message,
        data: notificationData.data,
        priority: notificationData.priority || 'normal',
    });
}

// Example 11: Activity logging with real-time broadcast
export async function logActivity(
    actorId: number,
    actorName: string,
    action: string,
    resourceType: string,
    resourceId: number,
    resourceName?: string
) {
    // Save to database
    // ...

    // Broadcast to interested users
    await realtimeNotificationService.broadcastActivityFeed({
        id: Date.now(),
        userId: actorId,
        actorId,
        actorName,
        action,
        resourceType,
        resourceId,
        resourceName,
        createdAt: new Date().toISOString(),
    });
}

// Example 12: Workflow state change notifications
export async function notifyWorkflowStateChange(
    workflowId: number,
    oldState: string,
    newState: string,
    changedBy: string,
    affectedUsers: number[]
) {
    for (const userId of affectedUsers) {
        await realtimeNotificationService.sendNotification({
            userId,
            type: 'workflow_state_change',
            title: 'Workflow Updated',
            message: `${changedBy} changed workflow state from ${oldState} to ${newState}`,
            data: { workflowId, oldState, newState },
            priority: 'normal',
        });
    }
}

// Helper function (example)
async function getUserIdByUsername(username: string): Promise<number | null> {
    // Implement your user lookup logic
    return null;
}

async function sendEmailNotification(userId: number, message: string): Promise<void> {
    // Implement your email notification logic
}

// Example 13: Express route integration
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/tickets/:id/assign', requireAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    const { assigneeId } = req.body;
    const assignedBy = req.authUser!.id;

    // Assign ticket
    await assignTicket(ticketId, assigneeId, `User ${assignedBy}`);

    res.json({ success: true });
});

router.post('/comments', requireAuth, async (req, res) => {
    const { resourceType, resourceId, content } = req.body;
    const authorId = parseInt(req.authUser!.id, 10);
    const authorName = 'Current User'; // Get from user object

    // Add comment
    await addComment(resourceType, resourceId, authorId, authorName, content);

    // Process mentions
    await processMentions(content, authorName, resourceType, resourceId);

    res.json({ success: true });
});

export default router;
