import { deleteEmailQueueItems, listEmailQueue, retryEmailQueueItems, getBounceStatistics } from '../services/emailQueueService.js';

const parseStatusList = (value: unknown) => {
    if (Array.isArray(value)) {
        return value.flatMap((item) => String(item ?? '').split(',')).map((item) => item.trim()).filter(Boolean);
    }
    return String(value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
};

const parseIdList = (value: unknown) => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
};

export const registerEmailQueueRoutes = (params) => {
    const {
        app,
        requireAuth,
        requireAdminLike,
        asyncHandler,
    } = params;

    app.get('/admin/email-queue', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        const limit = Math.max(1, Math.min(200, Number(request.query?.limit ?? 50) || 50));
        const offset = Math.max(0, Number(request.query?.offset ?? 0) || 0);
        const status = parseStatusList(request.query?.status);
        const result = await listEmailQueue({
            statuses: status.length > 0 ? status : ['pending', 'failed'],
            limit,
            offset,
        });
        response.status(200).json(result);
    }));

    app.post('/admin/email-queue/retry', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        const updated = await retryEmailQueueItems(parseIdList(request.body?.ids));
        response.status(200).json({ updated });
    }));

    app.post('/admin/email-queue/delete', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        const deleted = await deleteEmailQueueItems(parseIdList(request.body?.ids));
        response.status(200).json({ deleted });
    }));

    app.get('/admin/email-queue/bounce-stats', requireAuth, requireAdminLike, asyncHandler(async (request, response) => {
        const stats = await getBounceStatistics();
        response.status(200).json(stats);
    }));
};
