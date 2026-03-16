import { useState, useEffect } from 'react';
import { Download, Plus, Play, Trash2, Calendar } from 'lucide-react';
import Modal from '@/components/Modal';
import Breadcrumbs from '@/components/Breadcrumbs';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { SkeletonTable } from '@/components/Skeleton';
import ReportBuilder from '@/components/ReportBuilder';

type ReportDefinition = {
  id: string;
  name: string;
  description?: string;
  entityType: 'projects' | 'installations' | 'service_requests';
  config: any;
  isPredefined: boolean;
  createdAt: string;
};

type ScheduledReport = {
  id: string;
  reportDefinitionId: string;
  name: string;
  schedule: 'daily' | 'weekly' | 'monthly';
  deliveryMethod: 'email' | 'telegram' | 'both';
  recipientIds: string[];
  isActive: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  projects: 'Проекты',
  installations: 'Монтажи',
  service_requests: 'Заявки',
};

const SCHEDULE_LABELS: Record<string, string> = {
  daily: 'Ежедневно',
  weekly: 'Еженедельно',
  monthly: 'Ежемесячно',
};

const DELIVERY_METHOD_LABELS: Record<string, string> = {
  email: 'Email',
  telegram: 'Telegram',
  both: 'Email и Telegram',
};

export default function Reports() {
  const [activeTab, setActiveTab] = useState<'definitions' | 'scheduled'>('definitions');
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [scheduledReports, setScheduledReports] = useState<ScheduledReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedDefinition, setSelectedDefinition] = useState<ReportDefinition | null>(null);
  const [executing, setExecuting] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'definitions') {
        const response = await api.get('/reports/definitions') as any;
        setDefinitions(response.items || []);
      } else {
        const response = await api.get('/reports/scheduled') as any;
        setScheduledReports(response.items || []);
      }
    } catch (error) {
      showToast('Ошибка загрузки данных', 'error');
    } finally {
      setLoading(false);
    }
  };

  const executeReport = async (definition: ReportDefinition, format: 'json' | 'csv' | 'excel') => {
    setExecuting(definition.id);
    try {
      if (format === 'json') {
        const response = await api.post(`/reports/definitions/${definition.id}/execute`) as any;
        showToast(`Отчет выполнен: ${response.rowCount} строк`, 'success');
      } else {
        const url = `/reports/definitions/${definition.id}/execute?format=${format}`;
        window.open(url, '_blank');
        showToast('Отчет экспортируется...', 'success');
      }
    } catch (error) {
      showToast('Ошибка выполнения отчета', 'error');
    } finally {
      setExecuting(null);
    }
  };

  const deleteDefinition = async (id: string) => {
    if (!confirm('Удалить определение отчета?')) return;
    try {
      await api.delete(`/reports/definitions/${id}`);
      showToast('Отчет удален', 'success');
      loadData();
    } catch (error) {
      showToast('Ошибка удаления отчета', 'error');
    }
  };

  const deleteScheduledReport = async (id: string) => {
    if (!confirm('Удалить запланированный отчет?')) return;
    try {
      await api.delete(`/reports/scheduled/${id}`);
      showToast('Запланированный отчет удален', 'success');
      loadData();
    } catch (error) {
      showToast('Ошибка удаления', 'error');
    }
  };

  const toggleScheduledReport = async (report: ScheduledReport) => {
    try {
      await api.patch(`/reports/scheduled/${report.id}`, {
        isActive: !report.isActive,
      });
      showToast(report.isActive ? 'Отчет отключен' : 'Отчет включен', 'success');
      loadData();
    } catch (error) {
      showToast('Ошибка обновления', 'error');
    }
  };

  const openScheduleModal = (definition: ReportDefinition) => {
    setSelectedDefinition(definition);
    setShowScheduleModal(true);
  };

  return (
    <div className="p-3 sm:p-6">
      <Breadcrumbs items={[{ label: 'Отчеты' }]} />

      <div className="mb-4 sm:mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-slate-100">Отчеты</h1>
        {activeTab === 'definitions' && (
          <button
            onClick={() => setShowBuilder(true)}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 min-h-[44px] text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Создать отчет
          </button>
        )}
      </div>

      <div className="mb-4 sm:mb-6 flex gap-1 sm:gap-2 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
        <button
          onClick={() => setActiveTab('definitions')}
          className={`whitespace-nowrap px-3 sm:px-4 py-2.5 min-h-[44px] text-sm font-medium ${
            activeTab === 'definitions'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
          }`}
        >
          Определения отчетов
        </button>
        <button
          onClick={() => setActiveTab('scheduled')}
          className={`whitespace-nowrap px-3 sm:px-4 py-2.5 min-h-[44px] text-sm font-medium ${
            activeTab === 'scheduled'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
          }`}
        >
          Запланированные отчеты
        </button>
      </div>

      {loading ? (
        <SkeletonTable />
      ) : activeTab === 'definitions' ? (
        <div className="space-y-4">
          {definitions.map((def) => (
            <div
              key={def.id}
              className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base sm:text-lg font-medium text-slate-900 dark:text-slate-100">{def.name}</h3>
                    {def.isPredefined && (
                      <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        Предустановленный
                      </span>
                    )}
                  </div>
                  {def.description && (
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{def.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 sm:gap-4 text-sm text-slate-500 dark:text-slate-400">
                    <span>Тип: {ENTITY_TYPE_LABELS[def.entityType]}</span>
                    <span>Полей: {def.config.fields?.length || 0}</span>
                    {def.config.filters?.length > 0 && <span>Фильтров: {def.config.filters.length}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    onClick={() => executeReport(def, 'json')}
                    disabled={executing === def.id}
                    className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-2 min-h-[44px] text-sm text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    <Play className="h-4 w-4" />
                    <span className="hidden xs:inline">Выполнить</span>
                  </button>
                  <button
                    onClick={() => executeReport(def, 'csv')}
                    disabled={executing === def.id}
                    className="flex items-center gap-1 rounded-lg bg-slate-600 px-3 py-2 min-h-[44px] text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                    CSV
                  </button>
                  <button
                    onClick={() => executeReport(def, 'excel')}
                    disabled={executing === def.id}
                    className="flex items-center gap-1 rounded-lg bg-slate-600 px-3 py-2 min-h-[44px] text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                    Excel
                  </button>
                  <button
                    onClick={() => openScheduleModal(def)}
                    className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 min-h-[44px] text-sm text-white hover:bg-blue-700"
                  >
                    <Calendar className="h-4 w-4" />
                    <span className="hidden sm:inline">Запланировать</span>
                  </button>
                  {!def.isPredefined && (
                    <button
                      onClick={() => deleteDefinition(def.id)}
                      className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2 min-h-[44px] text-sm text-white hover:bg-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {scheduledReports.map((report) => (
            <div
              key={report.id}
              className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base sm:text-lg font-medium text-slate-900 dark:text-slate-100">{report.name}</h3>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        report.isActive
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {report.isActive ? 'Активен' : 'Отключен'}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 sm:gap-4 text-sm text-slate-500 dark:text-slate-400">
                    <span>Расписание: {SCHEDULE_LABELS[report.schedule]}</span>
                    <span>Доставка: {DELIVERY_METHOD_LABELS[report.deliveryMethod]}</span>
                    <span>Получателей: {report.recipientIds.length}</span>
                  </div>
                  {report.nextRunAt && (
                    <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Следующий запуск: {new Date(report.nextRunAt).toLocaleString('ru-RU')}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleScheduledReport(report)}
                    className={`rounded-lg px-3 py-2 min-h-[44px] text-sm text-white ${
                      report.isActive ? 'bg-orange-600 hover:bg-orange-700' : 'bg-green-600 hover:bg-green-700'
                    }`}
                  >
                    {report.isActive ? 'Отключить' : 'Включить'}
                  </button>
                  <button
                    onClick={() => deleteScheduledReport(report.id)}
                    className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2 min-h-[44px] min-w-[44px] justify-center text-sm text-white hover:bg-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showBuilder && (
        <Modal isOpen={showBuilder} onClose={() => setShowBuilder(false)} title="Создать отчет">
          <ReportBuilder
            onSave={() => {
              setShowBuilder(false);
              loadData();
            }}
            onCancel={() => setShowBuilder(false)}
          />
        </Modal>
      )}

      {showScheduleModal && selectedDefinition && (
        <ScheduleReportModal
          definition={selectedDefinition}
          onClose={() => {
            setShowScheduleModal(false);
            setSelectedDefinition(null);
          }}
          onSave={() => {
            setShowScheduleModal(false);
            setSelectedDefinition(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}

function ScheduleReportModal({
  definition,
  onClose,
  onSave,
}: {
  definition: ReportDefinition;
  onClose: () => void;
  onSave: () => void;
}) {
  const [name, setName] = useState(`${definition.name} - Запланированный`);
  const [schedule, setSchedule] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [deliveryMethod, setDeliveryMethod] = useState<'email' | 'telegram' | 'both'>('email');
  const [recipientEmails, setRecipientEmails] = useState('');
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const handleSave = async () => {
    if (!name.trim()) {
      showToast('Введите название', 'error');
      return;
    }

    setSaving(true);
    try {
      // For now, we'll use a placeholder for recipient IDs
      // In a real implementation, you'd fetch user IDs based on emails
      await api.post('/reports/scheduled', {
        reportDefinitionId: definition.id,
        name: name.trim(),
        schedule,
        deliveryMethod,
        deliveryConfig: { emails: recipientEmails },
        recipientIds: [], // Would be populated with actual user IDs
      });
      showToast('Отчет запланирован', 'success');
      onSave();
    } catch (error) {
      showToast('Ошибка планирования отчета', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Запланировать отчет">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Название</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Расписание</label>
          <select
            value={schedule}
            onChange={(e) => setSchedule(e.target.value as any)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
          >
            <option value="daily">Ежедневно</option>
            <option value="weekly">Еженедельно</option>
            <option value="monthly">Ежемесячно</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Способ доставки</label>
          <select
            value={deliveryMethod}
            onChange={(e) => setDeliveryMethod(e.target.value as any)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
          >
            <option value="email">Email</option>
            <option value="telegram">Telegram</option>
            <option value="both">Email и Telegram</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Email получателей (через запятую)
          </label>
          <textarea
            value={recipientEmails}
            onChange={(e) => setRecipientEmails(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
            placeholder="user1@example.com, user2@example.com"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
