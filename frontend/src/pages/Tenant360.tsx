import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Building2, FileText, FolderOpen, Briefcase, Wrench, ClipboardList, Activity, Mail, Phone, Calendar } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import type { Tenant } from '@/types';

type Tenant360Data = {
  tenant: Tenant & { createdAt?: string; updatedAt?: string; contacts?: Array<{ id: string; fullName?: string; email?: string; phone?: string; position?: string }> };
  directions: Array<{ id: string; name: string; address?: string; createdAt?: string; itemsCount?: number }>;
  projects: Array<{ id: string; title?: string; status: string; createdAt?: string; updatedAt?: string }>;
  installations: Array<{ id: string; title?: string; status: string; createdAt?: string; updatedAt?: string }>;
  serviceRequests: Array<{ id: string; title?: string; status: string; type: string; createdAt?: string; updatedAt?: string }>;
  contracts: Array<{ id: string; number: string; type: string; status: string; startDate?: string; endDate?: string; description?: string; createdAt?: string }>;
  files: Array<{ id: string; filename: string; mimeType?: string; sizeBytes?: number; uploadedAt?: string; entityType?: string; entityId?: string }>;
  activityLog?: Array<{ id: string; activityType: string; actorName?: string; title?: string; description?: string; createdAt?: string; severity?: string }>;
};

const STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  done: 'Выполнена',
  closed: 'Закрыта',
  cancelled: 'Отменена',
  active: 'Активен',
  draft: 'Черновик',
  expired: 'Истёк',
  terminated: 'Расторгнут',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  in_progress: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  done: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  closed: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  active: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  expired: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  terminated: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  lease: 'Аренда',
  maintenance: 'Обслуживание',
  supply: 'Поставка',
  service: 'Услуги',
};

export default function Tenant360Page() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [data, setData] = useState<Tenant360Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'directions' | 'projects' | 'installations' | 'service' | 'contracts' | 'files' | 'activity'>('overview');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const loadData = async () => {
      try {
        const result = await api.getT<Tenant360Data>(`/tenants/${id}/360`);
        if (!cancelled) setData(result);
      } catch (error) {
        if (!cancelled) {
          toast.error('Не удалось загрузить данные контрагента');
          navigate('/tenants');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadData();
    return () => { cancelled = true; };
  }, [id, navigate, toast]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Контрагенты', to: '/tenants' }, { label: 'Загрузка...' }]} />
        <div className="flex items-center justify-center py-12">
          <div className="text-sm text-slate-500">Загрузка...</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { tenant, directions, projects, installations, serviceRequests, contracts, files, activityLog } = data;

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('ru');
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Контрагенты', to: '/tenants' }, { label: tenant.name }]} />

      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 sm:gap-4">
            <div className="hidden sm:flex h-16 w-16 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/30">
              <Building2 size={32} className="text-red-600 dark:text-red-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 break-words">{tenant.name}</h1>
              {tenant.brandName && tenant.brandName !== tenant.name && (
                <p className="text-sm text-slate-500 dark:text-slate-400">{tenant.brandName}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                {tenant.inn && (
                  <span className="text-slate-600 dark:text-slate-400">ИНН: <span className="font-medium text-slate-900 dark:text-slate-100">{tenant.inn}</span></span>
                )}
                {tenant.type && (
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${tenant.type === 'contractor' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'}`}>
                    {tenant.type === 'contractor' ? 'Заказчик' : 'Арендатор'}
                  </span>
                )}
              </div>
              {tenant.contacts && tenant.contacts.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-4 text-sm">
                  {tenant.contacts[0].email && (
                    <a href={`mailto:${tenant.contacts[0].email}`} className="flex items-center gap-1.5 text-red-600 hover:underline dark:text-red-400">
                      <Mail size={14} />{tenant.contacts[0].email}
                    </a>
                  )}
                  {tenant.contacts[0].phone && (
                    <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                      <Phone size={14} />{tenant.contacts[0].phone}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 sm:gap-3">
            <FolderOpen size={18} className="shrink-0 text-blue-600 dark:text-blue-400" />
            <div>
              <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">{directions.length}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Направлений</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 sm:gap-3">
            <Briefcase size={18} className="shrink-0 text-purple-600 dark:text-purple-400" />
            <div>
              <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">{projects.length}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Проектов</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 sm:gap-3">
            <Wrench size={18} className="shrink-0 text-orange-600 dark:text-orange-400" />
            <div>
              <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">{installations.length}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Монтажей</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 sm:gap-3">
            <ClipboardList size={18} className="shrink-0 text-green-600 dark:text-green-400" />
            <div>
              <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">{serviceRequests.length}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Заявок ПО ТО</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <nav className="-mb-px flex gap-3 sm:gap-6 overflow-x-auto pb-px">
          {[
            { key: 'overview', label: 'Обзор', icon: Activity },
            { key: 'directions', label: `Направления (${directions.length})`, icon: FolderOpen },
            { key: 'projects', label: `Проекты (${projects.length})`, icon: Briefcase },
            { key: 'installations', label: `Монтажи (${installations.length})`, icon: Wrench },
            { key: 'service', label: `Заявки ПО ТО (${serviceRequests.length})`, icon: ClipboardList },
            { key: 'contracts', label: `Договоры (${contracts.length})`, icon: FileText },
            { key: 'files', label: `Файлы (${files.length})`, icon: FileText },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as typeof activeTab)}
              className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition ${
                activeTab === key
                  ? 'border-red-600 text-red-600 dark:border-red-400 dark:text-red-400'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">Последняя активность</h3>
              {activityLog && activityLog.length > 0 ? (
                <div className="space-y-2">
                  {activityLog.slice(0, 10).map((log) => (
                    <div key={log.id} className="flex items-start gap-2 sm:gap-3 rounded-lg border border-slate-200 p-2.5 sm:p-3 dark:border-slate-800">
                      <Calendar size={16} className="mt-0.5 shrink-0 text-slate-400" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{log.title || log.activityType}</p>
                        {log.description && <p className="text-xs text-slate-500 dark:text-slate-400">{log.description}</p>}
                        <p className="mt-1 text-xs text-slate-400">{log.actorName} · {formatDate(log.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Нет записей активности</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'directions' && (
          <div>
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Направления</h3>
            {directions.length > 0 ? (
              <div className="space-y-2">
                {directions.map((dir) => (
                  <div key={dir.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-slate-200 p-3 sm:p-4 dark:border-slate-800">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-slate-100 break-words">{dir.name}</p>
                      {dir.address && <p className="text-sm text-slate-500 dark:text-slate-400 break-words">{dir.address}</p>}
                      {dir.itemsCount !== undefined && (
                        <p className="mt-1 text-xs text-slate-400">Объектов: {dir.itemsCount}</p>
                      )}
                    </div>
                    <span className="text-xs text-slate-400 shrink-0">{formatDate(dir.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Нет направлений</p>
            )}
          </div>
        )}

        {activeTab === 'projects' && (
          <div>
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Проекты</h3>
            {projects.length > 0 ? (
              <div className="space-y-2">
                {projects.map((proj) => (
                  <div key={proj.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-slate-200 p-3 sm:p-4 dark:border-slate-800">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-slate-100 break-words">{proj.title || 'Без названия'}</p>
                      <p className="text-xs text-slate-400">{formatDate(proj.createdAt)}</p>
                    </div>
                    <span className={`self-start shrink-0 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[proj.status] || 'bg-slate-100 text-slate-700'}`}>
                      {STATUS_LABELS[proj.status] || proj.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Нет проектов</p>
            )}
          </div>
        )}

        {activeTab === 'installations' && (
          <div>
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Монтажи</h3>
            {installations.length > 0 ? (
              <div className="space-y-2">
                {installations.map((inst) => (
                  <div key={inst.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-slate-200 p-3 sm:p-4 dark:border-slate-800">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-slate-100 break-words">{inst.title || 'Без названия'}</p>
                      <p className="text-xs text-slate-400">{formatDate(inst.createdAt)}</p>
                    </div>
                    <span className={`self-start shrink-0 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[inst.status] || 'bg-slate-100 text-slate-700'}`}>
                      {STATUS_LABELS[inst.status] || inst.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Нет монтажей</p>
            )}
          </div>
        )}

        {activeTab === 'service' && (
          <div>
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Заявки ПО ТО</h3>
            {serviceRequests.length > 0 ? (
              <div className="space-y-2">
                {serviceRequests.map((req) => (
                  <div key={req.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-slate-200 p-3 sm:p-4 dark:border-slate-800">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-slate-100 break-words">{req.title || 'Без названия'}</p>
                      <p className="text-xs text-slate-400">{formatDate(req.createdAt)}</p>
                    </div>
                    <span className={`self-start shrink-0 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[req.status] || 'bg-slate-100 text-slate-700'}`}>
                      {STATUS_LABELS[req.status] || req.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Нет заявок</p>
            )}
          </div>
        )}

        {activeTab === 'contracts' && (
          <div>
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Договоры</h3>
            {contracts.length > 0 ? (
              <div className="space-y-2">
                {contracts.map((contract) => (
                  <div key={contract.id} className="rounded-lg border border-slate-200 p-3 sm:p-4 dark:border-slate-800">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium text-slate-900 dark:text-slate-100">№ {contract.number}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400">{CONTRACT_TYPE_LABELS[contract.type] || contract.type}</p>
                        {contract.description && <p className="mt-1 text-xs text-slate-500">{contract.description}</p>}
                        <p className="mt-2 text-xs text-slate-400">
                          {formatDate(contract.startDate)} — {formatDate(contract.endDate)}
                        </p>
                      </div>
                      <span className={`self-start shrink-0 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[contract.status] || 'bg-slate-100 text-slate-700'}`}>
                        {STATUS_LABELS[contract.status] || contract.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Нет договоров</p>
            )}
          </div>
        )}

        {activeTab === 'files' && (
          <div>
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Файлы</h3>
            {files.length > 0 ? (
              <div className="space-y-2">
                {files.map((file) => (
                  <div key={file.id} className="flex items-center rounded-lg border border-slate-200 p-3 sm:p-4 dark:border-slate-800">
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText size={20} className="shrink-0 text-slate-400" />
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 dark:text-slate-100 break-all">{file.filename}</p>
                        <p className="text-xs text-slate-400">
                          {formatFileSize(file.sizeBytes)} · {formatDate(file.uploadedAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Нет файлов</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
