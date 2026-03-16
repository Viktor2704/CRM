import { useEffect, useState } from 'react';
import { Calendar, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';

type DeadlineItem = {
  id: string;
  title: string;
  type: 'service_request' | 'installation' | 'maintenance_plan';
  dueDate: string;
  daysUntil: number;
};

type Props = {
  onDataUpdate?: (count: number) => void;
};

export default function DeadlinesWidget({ onDataUpdate }: Props) {
  const navigate = useNavigate();
  const [items, setItems] = useState<DeadlineItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.getT<{ items: DeadlineItem[] }>('/dashboard/upcoming-deadlines');
        const deadlines = data?.items || [];
        setItems(deadlines);
        onDataUpdate?.(deadlines.length);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    };

    void load();
    const interval = setInterval(() => void load(), 60000);
    return () => clearInterval(interval);
  }, [onDataUpdate]);

  const handleItemClick = (item: DeadlineItem) => {
    if (item.type === 'service_request') {
      navigate(`/service-requests?id=${item.id}`);
    } else if (item.type === 'installation') {
      navigate(`/installations/${item.id}`);
    } else {
      navigate('/maintenance-plans');
    }
  };

  const pluralDays = (days: number) => {
    const n = Math.abs(days);
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n} день`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} дня`;
    return `${n} дней`;
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <div className="h-5 w-48 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Ближайшие дедлайны (7 дней)</h3>
        <Calendar size={18} className="text-blue-600" />
      </div>
      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Нет предстоящих дедлайнов</p>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleItemClick(item)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-left transition hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {item.daysUntil === 0 ? 'Сегодня' : `Через ${pluralDays(item.daysUntil)}`} • {new Date(item.dueDate).toLocaleDateString('ru-RU')}
                  </p>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
