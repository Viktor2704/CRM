import { Router } from 'express';
import type { Request, Response } from 'express';

export const createWorkflowRouter = (params: { requireAuth: any }) => {
  const router = Router();
  const { requireAuth } = params;

  // Mock workflow rules endpoint
  router.get('/workflow-rules', requireAuth, (req: Request, res: Response) => {
    res.json({
      rules: [
        {
          id: '1',
          name: 'Автоназначение критических заявок',
          enabled: true,
          trigger: 'service_request_created',
          conditions: [
            { field: 'priority', operator: 'equals', value: 'critical' }
          ],
          actions: [
            { type: 'assign_to_user', userId: 'admin-user-id' },
            { type: 'send_notification', channel: 'telegram' }
          ],
          createdAt: '2026-01-15T10:00:00Z',
          updatedAt: '2026-03-01T14:30:00Z'
        },
        {
          id: '2',
          name: 'Эскалация просроченных заявок',
          enabled: true,
          trigger: 'service_request_overdue',
          conditions: [
            { field: 'days_overdue', operator: 'greater_than', value: 3 }
          ],
          actions: [
            { type: 'change_priority', value: 'high' },
            { type: 'notify_manager' }
          ],
          createdAt: '2026-02-10T09:00:00Z',
          updatedAt: '2026-02-10T09:00:00Z'
        },
        {
          id: '3',
          name: 'Автозакрытие выполненных заявок',
          enabled: false,
          trigger: 'service_request_status_changed',
          conditions: [
            { field: 'status', operator: 'equals', value: 'done' },
            { field: 'days_in_status', operator: 'greater_than', value: 7 }
          ],
          actions: [
            { type: 'change_status', value: 'closed' }
          ],
          createdAt: '2026-01-20T11:00:00Z',
          updatedAt: '2026-03-05T16:00:00Z'
        }
      ],
      total: 3
    });
  });

  return router;
};
