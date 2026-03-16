import { Server as HttpServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../security.js';
import { getUserById } from './userService.js';
import { logger } from '../logger.js';
import { appConfig } from '../config.js';

interface AuthenticatedSocket extends Socket {
    userId?: number;
    userRole?: string;
}

interface SocketUser {
    userId: number;
    socketId: string;
    role: string;
    connectedAt: Date;
}

interface TypingIndicator {
    userId: number;
    userName: string;
    resourceType: string;
    resourceId: number;
}

interface PresenceData {
    userId: number;
    status: 'online' | 'offline' | 'away';
    lastSeen: Date;
}

class WebSocketServer {
    private io: Server | null = null;
    private connectedUsers: Map<string, SocketUser> = new Map();
    private userSockets: Map<number, Set<string>> = new Map();
    private typingUsers: Map<string, TypingIndicator> = new Map();

    initialize(httpServer: HttpServer): void {
        this.io = new Server(httpServer, {
            cors: {
                origin: appConfig.corsOrigins,
                credentials: true,
            },
            pingTimeout: 60000,
            pingInterval: 25000,
        });

        this.io.use(this.authenticateSocket.bind(this));
        this.io.on('connection', this.handleConnection.bind(this));

        logger.info('WebSocket server initialized');
    }

    private async authenticateSocket(socket: AuthenticatedSocket, next: (err?: Error) => void): Promise<void> {
        try {
            const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

            if (!token) {
                return next(new Error('Authentication token required'));
            }

            const payload = verifyAccessToken(token) as any;

            if (!payload || typeof payload !== 'object' || !('sub' in payload)) {
                return next(new Error('Invalid token payload'));
            }

            const userId = typeof payload.sub === 'number' ? payload.sub : parseInt(String(payload.sub), 10);
            if (isNaN(userId)) {
                return next(new Error('Invalid user ID in token'));
            }

            const user = await getUserById(userId);
            if (!user || user.status !== 'active') {
                return next(new Error('Invalid user or inactive account'));
            }

            socket.userId = userId;
            socket.userRole = user.role;
            next();
        } catch (error) {
            logger.warn('WebSocket authentication failed', { error });
            next(new Error('Authentication failed'));
        }
    }

    private handleConnection(socket: AuthenticatedSocket): void {
        const userId = socket.userId!;
        const socketId = socket.id;

        this.connectedUsers.set(socketId, {
            userId,
            socketId,
            role: socket.userRole!,
            connectedAt: new Date(),
        });

        if (!this.userSockets.has(userId)) {
            this.userSockets.set(userId, new Set());
        }
        this.userSockets.get(userId)!.add(socketId);

        logger.info('WebSocket client connected', { userId, socketId });

        socket.emit('connected', { userId, socketId });

        this.broadcastPresence(userId, 'online');

        socket.on('join-room', (room: string) => this.handleJoinRoom(socket, room));
        socket.on('leave-room', (room: string) => this.handleLeaveRoom(socket, room));
        socket.on('typing-start', (data) => this.handleTypingStart(socket, data));
        socket.on('typing-stop', (data) => this.handleTypingStop(socket, data));
        socket.on('cursor-move', (data) => this.handleCursorMove(socket, data));
        socket.on('disconnect', () => this.handleDisconnect(socket));
    }

    private handleJoinRoom(socket: AuthenticatedSocket, room: string): void {
        socket.join(room);
        logger.debug('User joined room', { userId: socket.userId, room });
        socket.to(room).emit('user-joined', { userId: socket.userId, room });
    }

    private handleLeaveRoom(socket: AuthenticatedSocket, room: string): void {
        socket.leave(room);
        logger.debug('User left room', { userId: socket.userId, room });
        socket.to(room).emit('user-left', { userId: socket.userId, room });
    }

    private handleTypingStart(socket: AuthenticatedSocket, data: { resourceType: string; resourceId: number; userName: string }): void {
        const key = `${data.resourceType}:${data.resourceId}`;
        const room = `${data.resourceType}:${data.resourceId}`;

        this.typingUsers.set(`${socket.userId}:${key}`, {
            userId: socket.userId!,
            userName: data.userName,
            resourceType: data.resourceType,
            resourceId: data.resourceId,
        });

        socket.to(room).emit('typing-start', {
            userId: socket.userId,
            userName: data.userName,
            resourceType: data.resourceType,
            resourceId: data.resourceId,
        });
    }

    private handleTypingStop(socket: AuthenticatedSocket, data: { resourceType: string; resourceId: number }): void {
        const key = `${data.resourceType}:${data.resourceId}`;
        const room = `${data.resourceType}:${data.resourceId}`;

        this.typingUsers.delete(`${socket.userId}:${key}`);

        socket.to(room).emit('typing-stop', {
            userId: socket.userId,
            resourceType: data.resourceType,
            resourceId: data.resourceId,
        });
    }

    private handleCursorMove(socket: AuthenticatedSocket, data: { resourceType: string; resourceId: number; position: any; userName: string }): void {
        const room = `${data.resourceType}:${data.resourceId}`;

        socket.to(room).emit('cursor-move', {
            userId: socket.userId,
            userName: data.userName,
            position: data.position,
            resourceType: data.resourceType,
            resourceId: data.resourceId,
        });
    }

    private handleDisconnect(socket: AuthenticatedSocket): void {
        const userId = socket.userId!;
        const socketId = socket.id;

        this.connectedUsers.delete(socketId);

        const userSocketSet = this.userSockets.get(userId);
        if (userSocketSet) {
            userSocketSet.delete(socketId);
            if (userSocketSet.size === 0) {
                this.userSockets.delete(userId);
                this.broadcastPresence(userId, 'offline');
            }
        }

        const typingKeys = Array.from(this.typingUsers.keys()).filter(key => key.startsWith(`${userId}:`));
        typingKeys.forEach(key => this.typingUsers.delete(key));

        logger.info('WebSocket client disconnected', { userId, socketId });
    }

    private broadcastPresence(userId: number, status: 'online' | 'offline'): void {
        if (this.io) {
            this.io.emit('presence-change', {
                userId,
                status,
                timestamp: new Date().toISOString(),
            });
        }
    }

    sendToUser(userId: number, event: string, data: any): void {
        const socketIds = this.userSockets.get(userId);
        if (socketIds && this.io) {
            socketIds.forEach(socketId => {
                this.io!.to(socketId).emit(event, data);
            });
        }
    }

    sendToRoom(room: string, event: string, data: any): void {
        if (this.io) {
            this.io.to(room).emit(event, data);
        }
    }

    broadcast(event: string, data: any): void {
        if (this.io) {
            this.io.emit(event, data);
        }
    }

    isUserOnline(userId: number): boolean {
        return this.userSockets.has(userId);
    }

    getOnlineUsers(): number[] {
        return Array.from(this.userSockets.keys());
    }

    getConnectedSocketsCount(): number {
        return this.connectedUsers.size;
    }

    getUserSocketCount(userId: number): number {
        return this.userSockets.get(userId)?.size || 0;
    }

    getTypingUsers(resourceType: string, resourceId: number): TypingIndicator[] {
        const key = `${resourceType}:${resourceId}`;
        return Array.from(this.typingUsers.entries())
            .filter(([k]) => k.endsWith(`:${key}`))
            .map(([, v]) => v);
    }

    async close(): Promise<void> {
        if (this.io) {
            try {
                // Disconnect all clients first
                this.io.disconnectSockets();
                logger.info('WebSocket server: all sockets disconnected');

                // Close server with timeout
                await Promise.race([
                    new Promise<void>((resolve) => {
                        this.io!.close(() => {
                            logger.info('WebSocket server closed');
                            resolve();
                        });
                    }),
                    new Promise<void>((resolve) => {
                        setTimeout(() => {
                            logger.info('WebSocket server close timeout, continuing');
                            resolve();
                        }, 1000);
                    })
                ]);
            } catch (error) {
                logger.error('Error closing WebSocket server', { error });
            }
        }
    }
}

export const websocketServer = new WebSocketServer();
