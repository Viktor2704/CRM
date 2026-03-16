import { websocketServer } from './websocketServer.js';
import { logger } from '../logger.js';
import { dbQuery } from '../db.js';

export interface RealtimeNotification {
    id?: number;
    userId: number;
    type: string;
    title: string;
    message: string;
    data?: any;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    read?: boolean;
    createdAt?: string;
}

export interface ActivityFeedItem {
    id: number;
    userId: number;
    actorId: number;
    actorName: string;
    action: string;
    resourceType: string;
    resourceId: number;
    resourceName?: string;
    metadata?: any;
    createdAt: string;
}

export interface CommentNotification {
    commentId: number;
    resourceType: string;
    resourceId: number;
    authorId: number;
    authorName: string;
    content: string;
    createdAt: string;
}

class RealtimeNotificationService {
    async sendNotification(notification: RealtimeNotification): Promise<void> {
        try {
            const result = await dbQuery(
                `INSERT INTO notifications (user_id, type, title, message, data, priority, read, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, false, NOW())
                 RETURNING id, created_at`,
                [
                    notification.userId,
                    notification.type,
                    notification.title,
                    notification.message,
                    notification.data ? JSON.stringify(notification.data) : null,
                    notification.priority || 'normal',
                ]
            );

            const savedNotification = {
                ...notification,
                id: result.rows[0].id,
                createdAt: result.rows[0].created_at,
                read: false,
            };

            websocketServer.sendToUser(notification.userId, 'notification', savedNotification);

            await this.updateNotificationCounter(notification.userId);

            logger.debug('Real-time notification sent', {
                userId: notification.userId,
                type: notification.type,
                notificationId: savedNotification.id,
            });
        } catch (error) {
            logger.error('Failed to send real-time notification', { error, notification });
        }
    }

    async sendBulkNotifications(notifications: RealtimeNotification[]): Promise<void> {
        for (const notification of notifications) {
            await this.sendNotification(notification);
        }
    }

    async updateNotificationCounter(userId: number): Promise<void> {
        try {
            const result = await dbQuery(
                `SELECT COUNT(*) as unread_count FROM notifications WHERE user_id = $1 AND read = false`,
                [userId]
            );

            const unreadCount = parseInt(result.rows[0].unread_count, 10);

            websocketServer.sendToUser(userId, 'notification-counter', { unreadCount });
        } catch (error) {
            logger.error('Failed to update notification counter', { error, userId });
        }
    }

    async broadcastActivityFeed(activity: ActivityFeedItem): Promise<void> {
        try {
            const interestedUsers = await this.getInterestedUsers(activity.resourceType, activity.resourceId);

            for (const userId of interestedUsers) {
                if (userId !== activity.actorId) {
                    websocketServer.sendToUser(userId, 'activity-feed', activity);
                }
            }

            const room = `${activity.resourceType}:${activity.resourceId}`;
            websocketServer.sendToRoom(room, 'activity-update', activity);

            logger.debug('Activity feed broadcast', {
                resourceType: activity.resourceType,
                resourceId: activity.resourceId,
                action: activity.action,
            });
        } catch (error) {
            logger.error('Failed to broadcast activity feed', { error, activity });
        }
    }

    async notifyNewComment(comment: CommentNotification): Promise<void> {
        try {
            const interestedUsers = await this.getInterestedUsers(comment.resourceType, comment.resourceId);

            for (const userId of interestedUsers) {
                if (userId !== comment.authorId) {
                    websocketServer.sendToUser(userId, 'new-comment', comment);

                    await this.sendNotification({
                        userId,
                        type: 'comment',
                        title: 'New Comment',
                        message: `${comment.authorName} commented on ${comment.resourceType}`,
                        data: {
                            commentId: comment.commentId,
                            resourceType: comment.resourceType,
                            resourceId: comment.resourceId,
                        },
                        priority: 'normal',
                    });
                }
            }

            const room = `${comment.resourceType}:${comment.resourceId}`;
            websocketServer.sendToRoom(room, 'comment-added', comment);

            logger.debug('New comment notification sent', {
                resourceType: comment.resourceType,
                resourceId: comment.resourceId,
                commentId: comment.commentId,
            });
        } catch (error) {
            logger.error('Failed to notify new comment', { error, comment });
        }
    }

    async notifyResourceUpdate(resourceType: string, resourceId: number, updateData: any): Promise<void> {
        try {
            const room = `${resourceType}:${resourceId}`;
            websocketServer.sendToRoom(room, 'resource-updated', {
                resourceType,
                resourceId,
                updateData,
                timestamp: new Date().toISOString(),
            });

            logger.debug('Resource update notification sent', { resourceType, resourceId });
        } catch (error) {
            logger.error('Failed to notify resource update', { error, resourceType, resourceId });
        }
    }

    async notifyConcurrentEdit(resourceType: string, resourceId: number, editorId: number, editorName: string): Promise<void> {
        try {
            const room = `${resourceType}:${resourceId}`;
            websocketServer.sendToRoom(room, 'concurrent-edit-warning', {
                resourceType,
                resourceId,
                editorId,
                editorName,
                timestamp: new Date().toISOString(),
            });

            logger.debug('Concurrent edit warning sent', { resourceType, resourceId, editorId });
        } catch (error) {
            logger.error('Failed to notify concurrent edit', { error, resourceType, resourceId });
        }
    }

    async broadcastSystemMessage(message: string, priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal'): Promise<void> {
        try {
            websocketServer.broadcast('system-message', {
                message,
                priority,
                timestamp: new Date().toISOString(),
            });

            logger.info('System message broadcast', { message, priority });
        } catch (error) {
            logger.error('Failed to broadcast system message', { error, message });
        }
    }

    async notifyTaskAssignment(userId: number, taskId: number, taskTitle: string, assignedBy: string): Promise<void> {
        try {
            await this.sendNotification({
                userId,
                type: 'task_assignment',
                title: 'New Task Assigned',
                message: `${assignedBy} assigned you a task: ${taskTitle}`,
                data: { taskId },
                priority: 'high',
            });

            logger.debug('Task assignment notification sent', { userId, taskId });
        } catch (error) {
            logger.error('Failed to notify task assignment', { error, userId, taskId });
        }
    }

    async notifyMention(userId: number, mentionedBy: string, resourceType: string, resourceId: number): Promise<void> {
        try {
            await this.sendNotification({
                userId,
                type: 'mention',
                title: 'You were mentioned',
                message: `${mentionedBy} mentioned you in a ${resourceType}`,
                data: { resourceType, resourceId },
                priority: 'high',
            });

            logger.debug('Mention notification sent', { userId, resourceType, resourceId });
        } catch (error) {
            logger.error('Failed to notify mention', { error, userId });
        }
    }

    async getOnlineUsers(): Promise<number[]> {
        return websocketServer.getOnlineUsers();
    }

    async isUserOnline(userId: number): Promise<boolean> {
        return websocketServer.isUserOnline(userId);
    }

    private async getInterestedUsers(resourceType: string, resourceId: number): Promise<number[]> {
        try {
            let query = '';
            let params: any[] = [resourceId];

            switch (resourceType) {
                case 'project':
                    query = `SELECT DISTINCT user_id FROM project_members WHERE project_id = $1`;
                    break;
                case 'ticket':
                case 'service_request':
                    query = `SELECT DISTINCT assignee_id as user_id FROM service_requests WHERE id = $1 AND assignee_id IS NOT NULL
                             UNION
                             SELECT DISTINCT created_by as user_id FROM service_requests WHERE id = $1`;
                    break;
                case 'contract':
                    query = `SELECT DISTINCT responsible_user_id as user_id FROM contracts WHERE id = $1 AND responsible_user_id IS NOT NULL`;
                    break;
                default:
                    return [];
            }

            const result = await dbQuery(query, params);
            return result.rows.map(row => row.user_id).filter(id => id !== null);
        } catch (error) {
            logger.error('Failed to get interested users', { error, resourceType, resourceId });
            return [];
        }
    }
}

export const realtimeNotificationService = new RealtimeNotificationService();
