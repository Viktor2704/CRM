import { io, Socket } from 'socket.io-client';

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

interface PresenceData {
    userId: number;
    status: 'online' | 'offline' | 'away';
    timestamp: string;
}

interface TypingData {
    userId: number;
    userName: string;
    resourceType: string;
    resourceId: number;
}

interface CursorData {
    userId: number;
    userName: string;
    position: any;
    resourceType: string;
    resourceId: number;
}

type EventCallback = (data: any) => void;

class WebSocketClient {
    private socket: Socket | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 1000;
    private eventHandlers: Map<string, Set<EventCallback>> = new Map();

    connect(token: string): void {
        if (this.socket?.connected) {
            return;
        }

        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

        this.socket = io(apiUrl, {
            auth: { token },
            reconnection: true,
            reconnectionDelay: this.reconnectDelay,
            reconnectionAttempts: this.maxReconnectAttempts,
            transports: ['websocket', 'polling'],
        });

        this.socket.on('connect', () => {
            console.log('WebSocket connected');
            this.reconnectAttempts = 0;
            this.triggerEvent('connect', { connected: true });
        });

        this.socket.on('connected', (data) => {
            console.log('WebSocket authenticated', data);
            this.triggerEvent('authenticated', data);
        });

        this.socket.on('disconnect', (reason) => {
            console.log('WebSocket disconnected', reason);
            this.triggerEvent('disconnect', { reason });
        });

        this.socket.on('connect_error', (error) => {
            console.error('WebSocket connection error', error);
            this.reconnectAttempts++;
            this.triggerEvent('error', { error: error.message });
        });

        this.socket.on('notification', (data: NotificationData) => {
            this.triggerEvent('notification', data);
        });

        this.socket.on('notification-counter', (data: { unreadCount: number }) => {
            this.triggerEvent('notification-counter', data);
        });

        this.socket.on('activity-feed', (data: ActivityFeedData) => {
            this.triggerEvent('activity-feed', data);
        });

        this.socket.on('activity-update', (data: ActivityFeedData) => {
            this.triggerEvent('activity-update', data);
        });

        this.socket.on('new-comment', (data: any) => {
            this.triggerEvent('new-comment', data);
        });

        this.socket.on('comment-added', (data: any) => {
            this.triggerEvent('comment-added', data);
        });

        this.socket.on('resource-updated', (data: any) => {
            this.triggerEvent('resource-updated', data);
        });

        this.socket.on('concurrent-edit-warning', (data: any) => {
            this.triggerEvent('concurrent-edit-warning', data);
        });

        this.socket.on('presence-change', (data: PresenceData) => {
            this.triggerEvent('presence-change', data);
        });

        this.socket.on('typing-start', (data: TypingData) => {
            this.triggerEvent('typing-start', data);
        });

        this.socket.on('typing-stop', (data: TypingData) => {
            this.triggerEvent('typing-stop', data);
        });

        this.socket.on('cursor-move', (data: CursorData) => {
            this.triggerEvent('cursor-move', data);
        });

        this.socket.on('user-joined', (data: any) => {
            this.triggerEvent('user-joined', data);
        });

        this.socket.on('user-left', (data: any) => {
            this.triggerEvent('user-left', data);
        });

        this.socket.on('system-message', (data: any) => {
            this.triggerEvent('system-message', data);
        });
    }

    disconnect(): void {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.eventHandlers.clear();
    }

    joinRoom(room: string): void {
        if (this.socket?.connected) {
            this.socket.emit('join-room', room);
        }
    }

    leaveRoom(room: string): void {
        if (this.socket?.connected) {
            this.socket.emit('leave-room', room);
        }
    }

    startTyping(resourceType: string, resourceId: number, userName: string): void {
        if (this.socket?.connected) {
            this.socket.emit('typing-start', { resourceType, resourceId, userName });
        }
    }

    stopTyping(resourceType: string, resourceId: number): void {
        if (this.socket?.connected) {
            this.socket.emit('typing-stop', { resourceType, resourceId });
        }
    }

    moveCursor(resourceType: string, resourceId: number, position: any, userName: string): void {
        if (this.socket?.connected) {
            this.socket.emit('cursor-move', { resourceType, resourceId, position, userName });
        }
    }

    on(event: string, callback: EventCallback): void {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event)!.add(callback);
    }

    off(event: string, callback?: EventCallback): void {
        if (!callback) {
            this.eventHandlers.delete(event);
        } else {
            const handlers = this.eventHandlers.get(event);
            if (handlers) {
                handlers.delete(callback);
            }
        }
    }

    private triggerEvent(event: string, data: any): void {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event handler for ${event}:`, error);
                }
            });
        }
    }

    isConnected(): boolean {
        return this.socket?.connected || false;
    }

    getSocketId(): string | undefined {
        return this.socket?.id;
    }
}

export const websocketClient = new WebSocketClient();
export default websocketClient;
