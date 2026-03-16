import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, Clock3, Info, Mail, MessageSquare, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import Breadcrumbs from '@/components/Breadcrumbs';
import { api } from '@/api/client';
import { useNotificationStream } from '@/context/NotificationStreamContext';
import type { AppNotification } from '@/types';

type NotificationsResponse = AppNotification[] | { items?: AppNotification[]; data?: AppNotification[] };

type AiSummaryGroup = {
  label: string;
  count: number;
  ids: string[];
};

const AI_FEATURE_ENABLED = String(import.meta.env.VITE_AI_ENABLED ?? 'true').toLowerCase() !== 'false';

import { normalizeList } from '@/utils/normalize';

const getRelativeTime = (iso: string) => {
  if (!iso) return '';
  const now = Date.now();
  const time = new Date(iso).getTime();
  const diffMs = Math.max(0, now - time);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
};

const getEntityRoute = (entityType: string, entityId: string) => {
  switch (entityType) {
    case 'project':
      return `/projects?focus=${entityId}`;
    case 'installation':
      return `/installations?focus=${entityId}`;
    case 'service_request':
      return `/service-requests?focus=${entityId}`;
    case 'maintenance_plan':
      return `/maintenance-plans?focus=${entityId}`;
    case 'maintenance_item':
    case 'direction':
      return `/directions?focus=${entityId}`;
    case 'tenant':
      return `/tenants?focus=${entityId}`;
    case 'user':
      return `/users?focus=${entityId}`;
    default:
      return '/notifications';
  }
};

const getIconByEventType = (eventType: string) => {
  if (eventType.includes('error') || eventType.includes('failed') || eventType.includes('cancel')) return AlertTriangle;
  if (eventType.includes('done') || eventType.includes('created') || eventType.includes('accepted')) return CheckCircle2;
  if (eventType.includes('reminder') || eventType.includes('waiting')) return Clock3;
  if (eventType.includes('email')) return Mail;
  if (eventType.includes('comment')) return MessageSquare;
  if (eventType.includes('info') || eventType.includes('update')) return Info;
  return Bell;
};

const fetchNotifications = async () => {
  const result = await api.getT<NotificationsResponse>('/notifications');
  return normalizeList<AppNotification>(result);
};

const markRead = async (notificationId: string) => {
  await api.patchT(`/notifications/${notificationId}/read`);
};

const markAllRead = async () => {
  await api.postT('/notifications/read-all');
};

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { notificationRevision } = useNotificationStream();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [processingId, setProcessingId] = useState('');
  const [markingAll, setMarkingAll] = useState(false);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryText, setAiSummaryText] = useState('');
  const [aiSummaryGroups, setAiSummaryGroups] = useState<AiSummaryGroup[]>([]);
  const [activeGroupIds, setActiveGroupIds] = useState<string[]>([]);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.isRead).length, [notifications]);
  const visibleNotifications = useMemo(() => {
    if (activeGroupIds.length === 0) return notifications;
    const ids = new Set(activeGroupIds);
    return notifications.filter((item) => ids.has(item.id));
  }, [activeGroupIds, notifications]);

  const loadNotifications = async () => {
    setError('');
    const items = await fetchNotifications();
    setNotifications(
      [...items].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    );
  };

  useEffect(() => {
    let cancelled = false;
    void loadNotifications()
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить уведомления.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    void loadNotifications().catch(() => {
      setError('Не удалось обновить уведомления.');
    });
  }, [loading, notificationRevision]);

  const onItemClick = async (notification: AppNotification) => {
    const route = getEntityRoute(notification.entityType || '', notification.entityId || '');
    if (!notification.isRead) {
      setProcessingId(notification.id);
      try {
        await markRead(notification.id);
        setNotifications((prev) => prev.map((item) => (item.id === notification.id ? { ...item, isRead: true } : item)));
      } catch {
        setError('Не удалось отметить уведомление прочитанным.');
      } finally {
        setProcessingId('');
      }
    }
    navigate(route);
  };

  const onReadAll = async () => {
    setMarkingAll(true);
    setError('');
    try {
      await markAllRead();
      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
    } catch {
      setError('Не удалось отметить уведомления прочитанными.');
    } finally {
      setMarkingAll(false);
    }
  };

  const onAiSummary = async () => {
    if (!AI_FEATURE_ENABLED) {
      setAiSummaryText('');
      setAiSummaryGroups([]);
      setActiveGroupIds([]);
      return;
    }
    setAiSummaryLoading(true);
    setError('');
    try {
      const result = await api.postT<{ summary?: string | null; groups?: AiSummaryGroup[] }>('/ai/summarize-notifications');
      const summary = String(result?.summary || '').trim();
      const groups = Array.isArray(result?.groups)
        ? result.groups
            .map((group) => ({
              label: String(group?.label || '').trim() || 'Группа уведомлений',
              count: Number(group?.count || 0),
              ids: Array.isArray(group?.ids)
                ? group.ids.map((value) => String(value || '').trim()).filter(Boolean)
                : [],
            }))
            .filter((group) => group.ids.length > 0)
        : [];
      setAiSummaryText(summary);
      setAiSummaryGroups(groups);
      setActiveGroupIds([]);
    } catch {
      setAiSummaryText('');
      setAiSummaryGroups([]);
      setError('Не удалось построить AI-сводку уведомлений.');
    } finally {
      setAiSummaryLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Уведомления' }]} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 sm:text-2xl">Уведомления</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Непрочитанные: {unreadCount}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {AI_FEATURE_ENABLED ? (
            <button
              type="button"
              onClick={() => void onAiSummary()}
              disabled={aiSummaryLoading || notifications.length === 0}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:w-auto"
            >
              <Sparkles size={16} />
              {aiSummaryLoading ? 'AI анализ...' : 'AI сводка'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void onReadAll()}
            disabled={markingAll || notifications.length === 0}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60 sm:w-auto"
          >
            {markingAll ? 'Обновление...' : 'Прочитать все'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {AI_FEATURE_ENABLED && (aiSummaryText || aiSummaryGroups.length > 0) ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-4">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-brand-red" />
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI-сводка уведомлений</p>
          </div>
          {aiSummaryText ? (
            <p className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-300">{aiSummaryText}</p>
          ) : null}
          {aiSummaryGroups.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {aiSummaryGroups.map((group) => {
                const isActive = activeGroupIds.length > 0 && group.ids.every((id) => activeGroupIds.includes(id));
                return (
                  <button
                    key={`${group.label}-${group.ids.join(',')}`}
                    type="button"
                    onClick={() => {
                      setActiveGroupIds((prev) => {
                        const nextIds = Array.from(new Set(group.ids));
                        const allMatch =
                          prev.length === nextIds.length && nextIds.every((id) => prev.includes(id));
                        return allMatch ? [] : nextIds;
                      });
                    }}
                    className={[
                      'inline-flex min-h-[44px] items-center gap-1 rounded-full border px-3 py-2 text-xs font-semibold transition',
                      isActive
                        ? 'border-brand-red bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-300'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
                    ].join(' ')}
                  >
                    <span>{group.label}</span>
                    <span>({group.count || group.ids.length})</span>
                  </button>
                );
              })}
              {activeGroupIds.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setActiveGroupIds([])}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                >
                  Сбросить фильтр
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
          ))}
        </div>
      ) : visibleNotifications.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900 sm:p-12">
          <Bell className="text-slate-300 dark:text-slate-600" size={40} />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {visibleNotifications.length === 0 && notifications.length === 0 ? 'Уведомлений пока нет' : 'Нет уведомлений в этой категории'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleNotifications.map((notification) => {
            const Icon = getIconByEventType(notification.eventType || '');
            return (
              <button
                key={notification.id}
                type="button"
                onClick={() => void onItemClick(notification)}
                className={[
                  'w-full rounded-xl border p-3 text-left shadow-sm transition sm:p-4',
                  notification.isRead
                    ? 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
                    : 'border-red-200 bg-red-50 hover:border-red-300 dark:border-red-900/60 dark:bg-red-950/20 dark:hover:border-red-800',
                ].join(' ')}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-white p-2 text-brand-red shadow-sm dark:bg-slate-800">
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {notification.title || 'Уведомление'}
                      </p>
                      {!notification.isRead ? (
                        <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                          новое
                        </span>
                      ) : null}
                    </div>
                    <p
                      className="mt-1 text-sm text-slate-600 dark:text-slate-400"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(notification.body || '-') }}
                    />
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      {getRelativeTime(notification.createdAt || '')}
                      {processingId === notification.id ? ' • обновление...' : ''}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
