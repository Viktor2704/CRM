import { useEffect, useState } from 'react';
import { Activity, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';

type ActivityItem = {
  id: string;
  eventType: string;
  description: string;
  entityType: string;
  entityId: string;
  userName: string;
  createdAt: string;
};

type Props = {
  onDataUpdate?: (count: number) => void;
};

const EVENT_LABELS: Record<string, string> = {
  created: 'Создано',
  updated: 'Обновлено',
  deleted: 'Удалено',
  status_changed: 'Статус изменен',
  assigned: 'Назначено',
  comment_added: 'Комментарий',
  file_uploaded: 'Файл загружен',
};

export default function ActivityWidget({ onDataUpdate }: Props) {
  const navigate = useNavigate();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.getT<{ items: ActivityItem[] }>('/dashboard/recent-activity');
        const items = data?.items || [];
        setActivities(items);
        onDataUpdate?.(items.length);
      } catch {
        setActivities([]);
      } finally {
        setLoading(false);
      }
    };

    void load();
    const interval = setInterval(() => void load(), 30000);
    return () => clearInterval(interval);
  }, [onDataUpdate]);

  const handleActivityClick = (activity: ActivityItem) => {
    if (activity.entityType === 'service_request') {
      navigate(`/service-requests?id=${activity.entityId}`);
    } else if (activity.entityType === 'installation') {
      navigate(`/installations/${activity.entityId}`);
    } else if (activity.entityType === 'project') {
      navigate(`/projects?id=${activity.entityId}`);
    }
  };

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'только что';
    if (diffMins < 60) return `${diffMins} мин назад`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} ч назад`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} д назад`;

    return date.toLocaleDateString('ru-RU');
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <div className="h-5 w-48 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Последняя активность</h3>
        <Activity size={18} className="text-purple-600" />
      </div>
      <div className="mt-4 space-y-2">
        {activities.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Нет недавней активности</p>
        ) : (
          activities.map((activity) => (
            <button
              key={activity.id}
              type="button"
              onClick={() => handleActivityClick(activity)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-left transition hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-900 dark:text-slate-100">
                    {EVENT_LABELS[activity.eventType] || activity.eventType}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-slate-600 dark:text-slate-400">{activity.description}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                    {activity.userName} • {formatTimeAgo(activity.createdAt)}
                  </p>
                </div>
                <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
