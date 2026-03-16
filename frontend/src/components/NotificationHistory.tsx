import { useEffect, useMemo, useState, type UIEvent } from 'react';
import { MessageCircle, RotateCcw } from 'lucide-react';
import Modal from '@/components/Modal';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';

type TelegramNotificationItem = {
  id: string;
  eventType: string;
  title: string;
  body: string;
  status: string;
  retryCount: number;
  errorMessage?: string;
  createdAt: string;
  readAt?: string;
};

type TelegramNotificationResponse = {
  items: TelegramNotificationItem[];
  total: number;
  unreadCount: number;
};

const PAGE_SIZE = 20;

export default function NotificationHistory() {
  const toast = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<'unread' | 'sent' | 'failed'>('unread');
  const [items, setItems] = useState<TelegramNotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const canLoadMore = items.length < total;
  const badgeText = useMemo(() => {
    if (unreadCount > 99) return '99+';
    return String(unreadCount);
  }, [unreadCount]);

  const loadNotifications = async (options: { reset?: boolean } = {}) => {
    const offset = options.reset ? 0 : items.length;
    if (options.reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    try {
      const result = await api.getT<TelegramNotificationResponse>(
        `/telegram/notifications?status=${encodeURIComponent(status)}&limit=${PAGE_SIZE}&offset=${offset}`,
      );
      setItems((current) => (options.reset ? result.items : [...current, ...result.items]));
      setTotal(result.total);
      setUnreadCount(result.unreadCount);
    } catch {
      toast.error('Не удалось загрузить историю Telegram.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void api
      .getT<TelegramNotificationResponse>('/telegram/notifications?status=unread&limit=1&offset=0')
      .then((result) => setUnreadCount(result.unreadCount))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadNotifications({ reset: true });
  }, [isOpen, status]);

  const markRead = async (item: TelegramNotificationItem) => {
    if (item.readAt || item.status === 'failed') {
      return;
    }
    try {
      await api.patchT(`/telegram/notifications/${item.id}/read`, {});
      setItems((current) => current.map((candidate) => candidate.id === item.id
        ? { ...candidate, readAt: new Date().toISOString(), status: candidate.status === 'sent' ? 'read' : candidate.status }
        : candidate));
      setUnreadCount((current) => Math.max(0, current - 1));
    } catch {
      toast.error('Не удалось отметить уведомление прочитанным.');
    }
  };

  const markAllRead = async () => {
    try {
      await api.patchT('/telegram/notifications/mark-all-read', {});
      setItems((current) => current.map((candidate) => ({
        ...candidate,
        readAt: candidate.readAt || new Date().toISOString(),
        status: candidate.status === 'sent' ? 'read' : candidate.status,
      })));
      setUnreadCount(0);
    } catch {
      toast.error('Не удалось отметить уведомления прочитанными.');
    }
  };

  const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
    if (loadingMore || !canLoadMore) {
      return;
    }
    const target = event.currentTarget;
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 120) {
      void loadNotifications();
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="relative rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        title="История Telegram"
      >
        <MessageCircle size={20} />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-sky-600 px-1.5 text-[10px] font-bold leading-4 text-white">
            {badgeText}
          </span>
        ) : null}
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="История Telegram">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex w-full rounded-lg border border-slate-200 dark:border-slate-700 sm:w-auto">
              {[
                { key: 'unread', label: 'Непрочитанные' },
                { key: 'sent', label: 'Отправленные' },
                { key: 'failed', label: 'Ошибки' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatus(tab.key as 'unread' | 'sent' | 'failed')}
                  className={[
                    'min-h-[44px] flex-1 px-3 py-2 text-sm font-medium transition sm:min-h-0 sm:flex-none',
                    status === tab.key ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 dark:text-slate-300',
                  ].join(' ')}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-sm font-medium text-brand-red transition hover:text-red-700"
              >
                Отметить всё прочитанным
              </button>
            ) : null}
          </div>

          {loading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400">
              Загрузка...
            </div>
          ) : (
            <div className="max-h-[56vh] space-y-3 overflow-y-auto pr-1" onScroll={handleListScroll}>
              {items.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400">
                  Уведомлений нет.
                </div>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void markRead(item)}
                    className={[
                      'w-full rounded-xl border p-4 text-left transition',
                      item.readAt ? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900' : 'border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title || 'Telegram уведомление'}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{new Date(item.createdAt).toLocaleString('ru-RU')}</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-3 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{item.body || 'Без описания'}</p>
                    {item.errorMessage ? (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">{item.errorMessage}</p>
                    ) : null}
                    {item.retryCount > 0 ? (
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Повторов: {item.retryCount}</p>
                    ) : null}
                  </button>
                ))
              )}
              {loadingMore ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400">
                  Загрузка...
                </div>
              ) : null}
            </div>
          )}

          {canLoadMore && !loadingMore ? (
            <button
              type="button"
              onClick={() => void loadNotifications()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RotateCcw size={14} />
              Показать ещё
            </button>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
