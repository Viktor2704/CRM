import { Router } from 'express';
import { websocketServer } from '../services/websocketServer.js';
import { realtimeNotificationService } from '../services/realtimeNotifications.js';
import { requireAuth } from '../middleware/auth.js';
import { z } from 'zod';

const router = Router();

router.get('/status', requireAuth as any, (req: any, res: any) => {
    const userId = req.authUser!.id;
    const isOnline = websocketServer.isUserOnline(userId);
    const socketCount = websocketServer.getUserSocketCount(userId);
    const totalConnections = websocketServer.getConnectedSocketsCount();

    res.json({
        isOnline,
        socketCount,
        totalConnections,
        onlineUsers: websocketServer.getOnlineUsers().length,
    });
});

router.get('/online-users', requireAuth, (req, res) => {
    const onlineUsers = websocketServer.getOnlineUsers();
    res.json({ onlineUsers });
});

router.post('/broadcast', requireAuth as any, async (req: any, res: any) => {
    if (req.authUser!.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const schema = z.object({
        message: z.string().min(1),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error });
    }

    await realtimeNotificationService.broadcastSystemMessage(
        parsed.data.message,
        parsed.data.priority || 'normal'
    );

    res.json({ success: true });
});

router.post('/notify', requireAuth, async (req, res) => {
    const schema = z.object({
        userId: z.number(),
        type: z.string(),
        title: z.string(),
        message: z.string(),
        data: z.any().optional(),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error });
    }

    await realtimeNotificationService.sendNotification(parsed.data);

    res.json({ success: true });
});

router.get('/typing/:resourceType/:resourceId', requireAuth, (req, res) => {
    const { resourceType, resourceId } = req.params;
    const typingUsers = websocketServer.getTypingUsers(resourceType, parseInt(resourceId, 10));

    res.json({ typingUsers });
});

export default router;
