import { useEffect, useState } from 'react';
import { AlertCircle, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';

type ServiceRequest = {
  id: string;
  title: string;
  priority: string;
  status: string;
  createdAt: string;
};

type Props = {
  onDataUpdate?: (count: number) => void;
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-blue-100 text-blue-700',
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Критический',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};

export default function ServiceRequestsWidget({ onDataUpdate }: Props) {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.getT<{ items: ServiceRequest[] }>('/dashboard/service-requests');
        const items = data?.items || [];
        setRequests(items);
        onDataUpdate?.(items.length);
      } catch {
        setRequests([]);
      } finally {
        setLoading(false);
      }
    };

    void load();
    const interval = setInterval(() => void load(), 30000);
    return () => clearInterval(interval);
  }, [onDataUpdate]);

  const handleRequestClick = (id: string) => {
    navigate(`/service-requests?id=${id}`);
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
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Открытые заявки по приоритету</h3>
        <AlertCircle size={18} className="text-red-600" />
      </div>
      <div className="mt-4 space-y-2">
        {requests.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Нет открытых заявок</p>
        ) : (
          requests.map((request) => (
            <button
              key={request.id}
              type="button"
              onClick={() => handleRequestClick(request.id)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-left transition hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{request.title}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {new Date(request.createdAt).toLocaleDateString('ru-RU')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORITY_COLORS[request.priority] || 'bg-slate-100 text-slate-700'}`}>
                    {PRIORITY_LABELS[request.priority] || request.priority}
                  </span>
                  <ChevronRight size={16} className="text-slate-400" />
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
