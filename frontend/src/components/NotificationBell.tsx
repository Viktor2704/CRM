import { useMemo } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNotificationStream } from '@/context/NotificationStreamContext';

export default function NotificationBell() {
  const navigate = useNavigate();
  const { unreadCount } = useNotificationStream();

  const badgeText = useMemo(() => {
    if (unreadCount > 99) return '99+';
    return String(unreadCount);
  }, [unreadCount]);

  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
          void Notification.requestPermission().catch(() => {});
        }
        navigate('/notifications');
      }}
      className="relative rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      title="Уведомления"
    >
      <Bell size={20} />
      {unreadCount > 0 ? (
        <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] animate-bounce items-center justify-center rounded-full bg-brand-red px-1.5 text-[10px] font-bold leading-4 text-white [animation-duration:1s] [animation-iteration-count:3]">
          {badgeText}
        </span>
      ) : null}
    </button>
  );
}
