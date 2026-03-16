import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';

type NotificationPreference = {
  userId: string;
  telegramEnabled: boolean;
  emailEnabled: boolean;
  browserEnabled: boolean;
  eventTypes: string[];
  quietHoursStart?: string;
  quietHoursEnd?: string;
  updatedAt: string;
};

const EVENT_TYPES = [
  { value: 'installation.created', label: 'Создание монтажа' },
  { value: 'installation.updated', label: 'Обновление монтажа' },
  { value: 'installation.deadline', label: 'Дедлайн монтажа' },
  { value: 'service_request.created', label: 'Создание заявки' },
  { value: 'service_request.updated', label: 'Обновление заявки' },
  { value: 'contract.signed', label: 'Подписание договора' },
  { value: 'payment.received', label: 'Получение платежа' },
  { value: 'task.assigned', label: 'Назначение задачи' },
  { value: 'comment.added', label: 'Новый комментарий' },
];

export default function NotificationPreferences() {
  const toast = useToast();
  const [preferences, setPreferences] = useState<NotificationPreference | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadPreferences = async () => {
    setLoading(true);
    try {
      const result = await api.getT<NotificationPreference>('/notifications/preferences');
      setPreferences(result);
    } catch {
      toast.error('Не удалось загрузить настройки уведомлений.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPreferences();
  }, []);

  const handleSave = async () => {
    if (!preferences) return;

    setSaving(true);
    try {
      await api.patchT('/notifications/preferences', preferences);
      toast.success('Настройки сохранены.');
    } catch {
      toast.error('Не удалось сохранить настройки.');
    } finally {
      setSaving(false);
    }
  };

  const toggleEventType = (eventType: string) => {
    if (!preferences) return;
    const eventTypes = preferences.eventTypes.includes(eventType)
      ? preferences.eventTypes.filter((t) => t !== eventType)
      : [...preferences.eventTypes, eventType];
    setPreferences({ ...preferences, eventTypes });
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm text-slate-500 dark:text-slate-400">Загрузка...</p>
      </div>
    );
  }

  if (!preferences) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm text-slate-500 dark:text-slate-400">Не удалось загрузить настройки.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
          Каналы уведомлений
        </h3>
        <div className="space-y-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={preferences.telegramEnabled}
              onChange={(e) =>
                setPreferences({ ...preferences, telegramEnabled: e.target.checked })
              }
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-2 focus:ring-sky-500/20"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">Telegram уведомления</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={preferences.emailEnabled}
              onChange={(e) =>
                setPreferences({ ...preferences, emailEnabled: e.target.checked })
              }
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-2 focus:ring-sky-500/20"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">Email уведомления</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={preferences.browserEnabled}
              onChange={(e) =>
                setPreferences({ ...preferences, browserEnabled: e.target.checked })
              }
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-2 focus:ring-sky-500/20"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">
              Браузерные уведомления
            </span>
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
          Типы событий
        </h3>
        <div className="space-y-2">
          {EVENT_TYPES.map((eventType) => (
            <label key={eventType.value} className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={preferences.eventTypes.includes(eventType.value)}
                onChange={() => toggleEventType(eventType.value)}
                className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-2 focus:ring-sky-500/20"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">{eventType.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
          Тихие часы
        </h3>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          В это время уведомления не будут отправляться
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Начало
            </label>
            <input
              type="time"
              value={preferences.quietHoursStart || ''}
              onChange={(e) =>
                setPreferences({ ...preferences, quietHoursStart: e.target.value })
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Конец
            </label>
            <input
              type="time"
              value={preferences.quietHoursEnd || ''}
              onChange={(e) =>
                setPreferences({ ...preferences, quietHoursEnd: e.target.value })
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
        >
          <Save size={16} />
          {saving ? 'Сохранение...' : 'Сохранить настройки'}
        </button>
      </div>
    </div>
  );
}
