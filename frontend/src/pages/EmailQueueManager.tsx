import { useEffect, useMemo, useState } from 'react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/auth/AuthContext';

type EmailQueueItem = {
  id: string;
  to: string;
  subject: string;
  status: string;
  priority?: string;
  attempts: number;
  createdAt: string;
  lastError?: string;
  bounceReason?: string;
};

type EmailQueueResponse = {
  items: EmailQueueItem[];
  total: number;
};

export default function EmailQueueManager() {
  const toast = useToast();
  const { user } = useAuth();
  const [statuses, setStatuses] = useState<string[]>(['pending', 'failed', 'bounced']);
  const [items, setItems] = useState<EmailQueueItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const canManage = user?.role === 'admin' || user?.role === 'manager';

  const loadQueue = async () => {
    setLoading(true);
    try {
      const result = await api.getT<EmailQueueResponse>(
        `/admin/email-queue?status=${encodeURIComponent(statuses.join(','))}&limit=100&offset=0`,
      );
      setItems(result.items);
      setSelectedIds((current) => current.filter((id) => result.items.some((item) => item.id === id)));
    } catch {
      toast.error('Не удалось загрузить очередь Email.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canManage) return;
    void loadQueue();
  }, [canManage, statuses.join(',')]);

  const allSelected = useMemo(() => items.length > 0 && items.every((item) => selectedIds.includes(item.id)), [items, selectedIds]);

  const toggleSelection = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : items.map((item) => item.id));
  };

  const runBulkAction = async (path: string, successMessage: string) => {
    if (selectedIds.length === 0) {
      toast.error('Сначала выберите записи.');
      return;
    }
    try {
      await api.postT(path, { ids: selectedIds });
      toast.success(successMessage);
      await loadQueue();
    } catch {
      toast.error('Операция не выполнена.');
    }
  };

  if (!canManage) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">Доступ ограничен.</div>;
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Очередь Email' }]} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Очередь Email</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Отложенные и ошибочные письма.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {['pending', 'failed', 'bounced'].map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatuses((current) => current.includes(status) ? current.filter((item) => item !== status) : [...current, status])}
              className={[
                'rounded-lg border px-3 py-2 text-sm font-medium transition',
                statuses.includes(status) ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900' : 'border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300',
              ].join(' ')}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void runBulkAction('/admin/email-queue/retry', 'Очередь отправлена на повторную обработку.')}
          className="rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
        >
          Повторить выбранные
        </button>
        <button
          type="button"
          onClick={() => void runBulkAction('/admin/email-queue/delete', 'Выбранные записи удалены.')}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Удалить выбранные
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-950">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">Кому</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">Тема</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">Статус</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">Приоритет</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">Попытки</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">Создано</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">Ошибка</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">Загрузка...</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">Записей нет.</td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="align-top">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelection(item.id)} />
                    </td>
                    <td className="px-4 py-3 text-slate-900 dark:text-slate-100">{item.to}</td>
                    <td className="px-4 py-3 text-slate-900 dark:text-slate-100">{item.subject}</td>
                    <td className="px-4 py-3">
                      <span className={[
                        'rounded-full px-2 py-1 text-[11px] font-semibold uppercase',
                        item.status === 'bounced' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      ].join(' ')}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={[
                        'rounded-full px-2 py-1 text-[11px] font-semibold uppercase',
                        item.priority === 'urgent' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200' :
                        item.priority === 'high' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200' :
                        item.priority === 'low' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200' :
                        'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      ].join(' ')}>
                        {item.priority || 'normal'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{item.attempts}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{new Date(item.createdAt).toLocaleString('ru-RU')}</td>
                    <td className="px-4 py-3 text-xs text-red-600 dark:text-red-400">
                      {item.bounceReason || item.lastError || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
