import { useState, useEffect } from 'react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/api/client';

type EmailTemplate = {
  id: string;
  name: string;
  description: string;
  variables: string[];
};

type BounceStats = {
  summary: {
    total_bounced: number;
    bounced_last_7_days: number;
    bounced_last_30_days: number;
    unique_bounced_addresses: number;
  };
  topBounced: Array<{
    email: string;
    bounceCount: number;
    lastBounceAt: string;
    lastBounceReason: string;
  }>;
};

const templates: EmailTemplate[] = [
  {
    id: 'loginToken',
    name: 'Код входа',
    description: 'Отправляется пользователю при входе в систему',
    variables: ['token', 'expiresInMinutes'],
  },
  {
    id: 'serviceRequest',
    name: 'Заявка на обслуживание',
    description: 'Уведомление о новой заявке для клиента или исполнителя',
    variables: ['toName', 'directionName', 'description', 'requests', 'recipientRole', 'contactName', 'contactPhone'],
  },
  {
    id: 'invite',
    name: 'Приглашение',
    description: 'Приглашение нового пользователя в систему',
    variables: ['token', 'expiresInHours', 'inviteUrl'],
  },
  {
    id: 'maintenancePlan',
    name: 'Плановое ТО',
    description: 'Уведомление о запланированном техническом обслуживании',
    variables: ['toName', 'planDate', 'directionName', 'items', 'recipientRole'],
  },
];

export default function EmailTemplates() {
  const { user } = useAuth();
  const toast = useToast();
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [previewData, setPreviewData] = useState<Record<string, any>>({});
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);
  const [bounceStats, setBounceStats] = useState<BounceStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const canManage = user?.role === 'admin' || user?.role === 'manager';

  useEffect(() => {
    if (!canManage) return;

    const loadBounceStats = async () => {
      setLoadingStats(true);
      try {
        const stats = await api.getT<BounceStats>('/admin/email-queue/bounce-stats');
        setBounceStats(stats);
      } catch {
        toast.error('Не удалось загрузить статистику отказов');
      } finally {
        setLoadingStats(false);
      }
    };

    void loadBounceStats();
  }, [canManage]);

  const handlePreview = async () => {
    if (!selectedTemplate) return;

    try {
      // In a real implementation, this would call an API endpoint to render the template
      toast.info('Предпросмотр шаблонов будет доступен после интеграции с бэкендом');
      setShowPreview(true);
      setPreviewHtml('<p style="color: #64748B;">Предпросмотр будет доступен после полной интеграции React Email</p>');
    } catch {
      toast.error('Не удалось загрузить предпросмотр');
    }
  };

  const getDefaultPreviewData = (template: EmailTemplate): Record<string, any> => {
    const defaults: Record<string, any> = {
      loginToken: {
        token: '123456',
        expiresInMinutes: 15,
      },
      serviceRequest: {
        toName: 'Иван Петров',
        directionName: 'ЖК Новинки',
        directionAddress: 'ул. Примерная, д. 1',
        description: 'Проверка системы пожарной сигнализации',
        requests: [
          { id: '1', title: 'Подъезд 1', priority: 'high', status: 'new' },
          { id: '2', title: 'Подъезд 2', priority: 'normal', status: 'new' },
        ],
        recipientRole: 'executor',
        contactName: 'Мария Иванова',
        contactPhone: '+7 (495) 123-45-67',
        scheduledDate: '15 марта 2026',
      },
      invite: {
        token: 'abc123def456',
        expiresInHours: 48,
        inviteUrl: 'https://novinzhstroy.ru/invite-accept?token=abc123def456',
      },
      maintenancePlan: {
        toName: 'Сергей Сидоров',
        planDate: '20 марта 2026',
        directionName: 'ЖК Солнечный',
        items: [
          { name: 'Корпус А', address: 'ул. Солнечная, д. 10', systems: { aps: true, soue: true } },
        ],
        recipientRole: 'client',
      },
    };

    return defaults[template.id] || {};
  };

  if (!canManage) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">Доступ ограничен.</div>;
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Email шаблоны' }]} />

      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Email шаблоны</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Управление шаблонами электронных писем на базе React Email
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Templates List */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Доступные шаблоны</h3>
          {templates.map((template) => (
            <div
              key={template.id}
              onClick={() => {
                setSelectedTemplate(template);
                setPreviewData(getDefaultPreviewData(template));
                setShowPreview(false);
              }}
              className={[
                'cursor-pointer rounded-xl border p-4 transition',
                selectedTemplate?.id === template.id
                  ? 'border-brand-red bg-red-50 dark:bg-red-950/20'
                  : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700',
              ].join(' ')}
            >
              <h4 className="font-semibold text-slate-900 dark:text-slate-100">{template.name}</h4>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{template.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {template.variables.slice(0, 3).map((variable) => (
                  <span
                    key={variable}
                    className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {variable}
                  </span>
                ))}
                {template.variables.length > 3 && (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    +{template.variables.length - 3}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Preview Panel */}
        <div className="space-y-4">
          {selectedTemplate ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Предпросмотр: {selectedTemplate.name}
                </h3>
                <button
                  type="button"
                  onClick={handlePreview}
                  className="rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
                >
                  Обновить предпросмотр
                </button>
              </div>

              {/* Variables */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h4 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">Переменные шаблона</h4>
                <div className="space-y-2">
                  {selectedTemplate.variables.map((variable) => (
                    <div key={variable} className="flex items-center gap-2">
                      <code className="flex-1 rounded bg-slate-100 px-2 py-1 text-sm font-mono text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {variable}
                      </code>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {typeof previewData[variable] === 'object' ? 'Object' : typeof previewData[variable]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview */}
              {showPreview && (
                <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <div className="border-b border-slate-200 p-4 dark:border-slate-800">
                    <h4 className="font-semibold text-slate-900 dark:text-slate-100">HTML предпросмотр</h4>
                  </div>
                  <div
                    className="p-4"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              )}

              {/* Info */}
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  <strong>React Email интеграция:</strong> Шаблоны используют React Email компоненты для создания
                  адаптивных и красивых писем. Изменения в шаблонах требуют обновления кода.
                </p>
              </div>
            </>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
              <p className="text-slate-500 dark:text-slate-400">Выберите шаблон для предпросмотра</p>
            </div>
          )}
        </div>
      </div>

      {/* Bounce Statistics */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Статистика отказов (Bounces)</h3>
        {loadingStats ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Загрузка...</p>
        ) : bounceStats ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {bounceStats.summary.total_bounced}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">Всего отказов</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {bounceStats.summary.bounced_last_7_days}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">За 7 дней</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {bounceStats.summary.bounced_last_30_days}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">За 30 дней</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {bounceStats.summary.unique_bounced_addresses}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">Уникальных адресов</div>
              </div>
            </div>

            {bounceStats.topBounced.length > 0 && (
              <div className="mt-6">
                <h4 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">
                  Топ адресов с отказами
                </h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                    <thead className="bg-slate-50 dark:bg-slate-950">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">Email</th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">Отказов</th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">Последний отказ</th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">Причина</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {bounceStats.topBounced.map((item) => (
                        <tr key={item.email}>
                          <td className="px-4 py-3 text-slate-900 dark:text-slate-100">{item.email}</td>
                          <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{item.bounceCount}</td>
                          <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                            {new Date(item.lastBounceAt).toLocaleString('ru-RU')}
                          </td>
                          <td className="px-4 py-3 text-xs text-red-600 dark:text-red-400">
                            {item.lastBounceReason || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">—</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Всего отказов</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">—</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">За 7 дней</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">—</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">За 30 дней</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">—</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Уникальных адресов</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
