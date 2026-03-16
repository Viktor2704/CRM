import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, buildApiUrl } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';

type UnreadCountResponse = { count?: number };

interface NotificationStreamState {
  unreadCount: number;
  notificationRevision: number;
  refreshUnreadCount: () => Promise<void>;
}

const NotificationStreamContext = createContext<NotificationStreamState | null>(null);

async function fetchUnreadCount(): Promise<number> {
  const result = await api.getT<UnreadCountResponse>('/notifications/unread-count');
  return Number(result?.count ?? 0);
}

const showBrowserNotification = (newItemsCount: number) => {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (newItemsCount <= 0) return;
  const body =
    newItemsCount === 1
      ? 'Появилось новое уведомление.'
      : `Появилось ${newItemsCount} новых уведомлений.`;
  const notification = new Notification('Новинжстрой', {
    body,
    tag: 'novinzhstroy-notifications',
  });
  notification.onclick = () => {
    notification.close();
    window.focus();
  };
};

export function NotificationStreamProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationRevision, setNotificationRevision] = useState(0);
  const previousUnreadRef = useRef<number | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  const applyUnreadCount = useCallback((count: number) => {
    const previous = previousUnreadRef.current;
    if (previous !== null && count > previous && document.visibilityState !== 'visible') {
      showBrowserNotification(count - previous);
    }
    previousUnreadRef.current = count;
    setUnreadCount(count);
  }, []);

  const refreshUnreadCount = useCallback(async () => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const nextPromise = fetchUnreadCount()
      .then((count) => {
        applyUnreadCount(count);
      })
      .catch(() => {})
      .finally(() => {
        if (refreshPromiseRef.current === nextPromise) {
          refreshPromiseRef.current = null;
        }
      });

    refreshPromiseRef.current = nextPromise;
    return nextPromise;
  }, [applyUnreadCount]);

  useEffect(() => {
    if (!isAuthenticated) {
      previousUnreadRef.current = null;
      refreshPromiseRef.current = null;
      setUnreadCount(0);
      setNotificationRevision(0);
      return;
    }

    let closed = false;
    let eventSource: EventSource | null = null;

    void refreshUnreadCount();

    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return () => {
        closed = true;
      };
    }

    const handleReady = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { unreadCount?: number };
        if (typeof payload.unreadCount === 'number') {
          applyUnreadCount(payload.unreadCount);
        }
      } catch {
        // Ignore malformed keep-alive payloads.
      }
    };

    const handleChange = () => {
      if (closed) return;
      setNotificationRevision((value) => value + 1);
      void refreshUnreadCount();
    };

    eventSource = new EventSource(buildApiUrl('/notifications/stream'), { withCredentials: true });
    eventSource.addEventListener('ready', handleReady as EventListener);
    eventSource.addEventListener('notification_changed', handleChange as EventListener);

    return () => {
      closed = true;
      eventSource?.removeEventListener('ready', handleReady as EventListener);
      eventSource?.removeEventListener('notification_changed', handleChange as EventListener);
      eventSource?.close();
    };
  }, [applyUnreadCount, isAuthenticated, refreshUnreadCount]);

  const value = useMemo<NotificationStreamState>(
    () => ({
      unreadCount,
      notificationRevision,
      refreshUnreadCount,
    }),
    [notificationRevision, refreshUnreadCount, unreadCount]
  );

  return (
    <NotificationStreamContext.Provider value={value}>
      {children}
    </NotificationStreamContext.Provider>
  );
}

export function useNotificationStream() {
  const context = useContext(NotificationStreamContext);
  if (!context) {
    throw new Error('useNotificationStream must be used inside NotificationStreamProvider');
  }
  return context;
}
