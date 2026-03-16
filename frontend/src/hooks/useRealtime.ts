import { useEffect, useState, useCallback, useRef } from 'react';
import { websocketClient } from '../services/websocketClient';

interface NotificationData {
    id: number;
    userId: number;
    type: string;
    title: string;
    message: string;
    data?: any;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    read: boolean;
    createdAt: string;
}

interface ActivityFeedData {
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

interface TypingUser {
    userId: number;
    userName: string;
}

interface CursorPosition {
    userId: number;
    userName: string;
    position: any;
}

interface UseRealtimeOptions {
    autoConnect?: boolean;
    onNotification?: (notification: NotificationData) => void;
    onActivityUpdate?: (activity: ActivityFeedData) => void;
    onSystemMessage?: (message: any) => void;
}

export function useRealtime(token?: string, options: UseRealtimeOptions = {}) {
    const [isConnected, setIsConnected] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [notifications, setNotifications] = useState<NotificationData[]>([]);
    const [activityFeed, setActivityFeed] = useState<ActivityFeedData[]>([]);
    const hasConnected = useRef(false);

    useEffect(() => {
        if (token && options.autoConnect !== false && !hasConnected.current) {
            websocketClient.connect(token);
            hasConnected.current = true;
        }

        const handleConnect = () => setIsConnected(true);
        const handleDisconnect = () => setIsConnected(false);
        const handleError = (data: any) => console.error('WebSocket error:', data);

        const handleNotification = (notification: NotificationData) => {
            setNotifications(prev => [notification, ...prev]);
            options.onNotification?.(notification);
        };

        const handleNotificationCounter = (data: { unreadCount: number }) => {
            setUnreadCount(data.unreadCount);
        };

        const handleActivityFeed = (activity: ActivityFeedData) => {
            setActivityFeed(prev => [activity, ...prev].slice(0, 50));
            options.onActivityUpdate?.(activity);
        };

        const handleSystemMessage = (message: any) => {
            options.onSystemMessage?.(message);
        };

        websocketClient.on('connect', handleConnect);
        websocketClient.on('disconnect', handleDisconnect);
        websocketClient.on('error', handleError);
        websocketClient.on('notification', handleNotification);
        websocketClient.on('notification-counter', handleNotificationCounter);
        websocketClient.on('activity-feed', handleActivityFeed);
        websocketClient.on('activity-update', handleActivityFeed);
        websocketClient.on('system-message', handleSystemMessage);

        return () => {
            websocketClient.off('connect', handleConnect);
            websocketClient.off('disconnect', handleDisconnect);
            websocketClient.off('error', handleError);
            websocketClient.off('notification', handleNotification);
            websocketClient.off('notification-counter', handleNotificationCounter);
            websocketClient.off('activity-feed', handleActivityFeed);
            websocketClient.off('activity-update', handleActivityFeed);
            websocketClient.off('system-message', handleSystemMessage);
        };
    }, [token, options.autoConnect]);

    const connect = useCallback((authToken: string) => {
        websocketClient.connect(authToken);
    }, []);

    const disconnect = useCallback(() => {
        websocketClient.disconnect();
        setIsConnected(false);
        hasConnected.current = false;
    }, []);

    return {
        isConnected,
        unreadCount,
        notifications,
        activityFeed,
        connect,
        disconnect,
    };
}

export function useRealtimeRoom(resourceType: string, resourceId: number) {
    const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
    const [cursors, setCursors] = useState<Map<number, CursorPosition>>(new Map());
    const [concurrentEditWarning, setConcurrentEditWarning] = useState<any>(null);
    const typingTimeouts = useRef<Map<number, NodeJS.Timeout>>(new Map());

    useEffect(() => {
        const room = `${resourceType}:${resourceId}`;
        websocketClient.joinRoom(room);

        const handleTypingStart = (data: any) => {
            if (data.resourceType === resourceType && data.resourceId === resourceId) {
                setTypingUsers(prev => {
                    const exists = prev.some(u => u.userId === data.userId);
                    if (exists) return prev;
                    return [...prev, { userId: data.userId, userName: data.userName }];
                });

                const existingTimeout = typingTimeouts.current.get(data.userId);
                if (existingTimeout) clearTimeout(existingTimeout);

                const timeout = setTimeout(() => {
                    setTypingUsers(prev => prev.filter(u => u.userId !== data.userId));
                    typingTimeouts.current.delete(data.userId);
                }, 5000);

                typingTimeouts.current.set(data.userId, timeout);
            }
        };

        const handleTypingStop = (data: any) => {
            if (data.resourceType === resourceType && data.resourceId === resourceId) {
                setTypingUsers(prev => prev.filter(u => u.userId !== data.userId));
                const timeout = typingTimeouts.current.get(data.userId);
                if (timeout) {
                    clearTimeout(timeout);
                    typingTimeouts.current.delete(data.userId);
                }
            }
        };

        const handleCursorMove = (data: any) => {
            if (data.resourceType === resourceType && data.resourceId === resourceId) {
                setCursors(prev => {
                    const newCursors = new Map(prev);
                    newCursors.set(data.userId, {
                        userId: data.userId,
                        userName: data.userName,
                        position: data.position,
                    });
                    return newCursors;
                });
            }
        };

        const handleConcurrentEdit = (data: any) => {
            if (data.resourceType === resourceType && data.resourceId === resourceId) {
                setConcurrentEditWarning(data);
                setTimeout(() => setConcurrentEditWarning(null), 5000);
            }
        };

        websocketClient.on('typing-start', handleTypingStart);
        websocketClient.on('typing-stop', handleTypingStop);
        websocketClient.on('cursor-move', handleCursorMove);
        websocketClient.on('concurrent-edit-warning', handleConcurrentEdit);

        return () => {
            websocketClient.leaveRoom(room);
            websocketClient.off('typing-start', handleTypingStart);
            websocketClient.off('typing-stop', handleTypingStop);
            websocketClient.off('cursor-move', handleCursorMove);
            websocketClient.off('concurrent-edit-warning', handleConcurrentEdit);
            typingTimeouts.current.forEach(timeout => clearTimeout(timeout));
            typingTimeouts.current.clear();
        };
    }, [resourceType, resourceId]);

    const startTyping = useCallback((userName: string) => {
        websocketClient.startTyping(resourceType, resourceId, userName);
    }, [resourceType, resourceId]);

    const stopTyping = useCallback(() => {
        websocketClient.stopTyping(resourceType, resourceId);
    }, [resourceType, resourceId]);

    const moveCursor = useCallback((position: any, userName: string) => {
        websocketClient.moveCursor(resourceType, resourceId, position, userName);
    }, [resourceType, resourceId]);

    return {
        typingUsers,
        cursors: Array.from(cursors.values()),
        concurrentEditWarning,
        startTyping,
        stopTyping,
        moveCursor,
    };
}

export function usePresence() {
    const [onlineUsers, setOnlineUsers] = useState<Set<number>>(new Set());

    useEffect(() => {
        const handlePresenceChange = (data: { userId: number; status: string }) => {
            setOnlineUsers(prev => {
                const newSet = new Set(prev);
                if (data.status === 'online') {
                    newSet.add(data.userId);
                } else {
                    newSet.delete(data.userId);
                }
                return newSet;
            });
        };

        websocketClient.on('presence-change', handlePresenceChange);

        return () => {
            websocketClient.off('presence-change', handlePresenceChange);
        };
    }, []);

    const isUserOnline = useCallback((userId: number) => {
        return onlineUsers.has(userId);
    }, [onlineUsers]);

    return {
        onlineUsers: Array.from(onlineUsers),
        isUserOnline,
    };
}

export function useRealtimeComments(resourceType: string, resourceId: number) {
    const [newComments, setNewComments] = useState<any[]>([]);

    useEffect(() => {
        const room = `${resourceType}:${resourceId}`;
        websocketClient.joinRoom(room);

        const handleNewComment = (data: any) => {
            if (data.resourceType === resourceType && data.resourceId === resourceId) {
                setNewComments(prev => [...prev, data]);
            }
        };

        const handleCommentAdded = (data: any) => {
            if (data.resourceType === resourceType && data.resourceId === resourceId) {
                setNewComments(prev => [...prev, data]);
            }
        };

        websocketClient.on('new-comment', handleNewComment);
        websocketClient.on('comment-added', handleCommentAdded);

        return () => {
            websocketClient.leaveRoom(room);
            websocketClient.off('new-comment', handleNewComment);
            websocketClient.off('comment-added', handleCommentAdded);
        };
    }, [resourceType, resourceId]);

    const clearNewComments = useCallback(() => {
        setNewComments([]);
    }, []);

    return {
        newComments,
        clearNewComments,
    };
}
