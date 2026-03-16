import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Calendar,
  CheckCircle2,
  ClipboardList,
  FileText,
  FolderKanban,
  PlusSquare,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import Breadcrumbs from '@/components/Breadcrumbs';
import { useToast } from '@/context/ToastContext';
import { SYSTEM_LABELS, type User } from '@/types';
import ServiceRequestsWidget from '@/components/widgets/ServiceRequestsWidget';
import OverdueWidget from '@/components/widgets/OverdueWidget';
import DeadlinesWidget from '@/components/widgets/DeadlinesWidget';
import ActivityWidget from '@/components/widgets/ActivityWidget';
import QuickStatsWidget from '@/components/widgets/QuickStatsWidget';

type AnyRecord = Record<string, unknown>;
type ListResponse<T> = T[] | { items?: T[]; data?: T[]; total?: number };
type UnreadCountResponse = { count?: number };

type DashboardData = {
  projects: AnyRecord[];
  requests: AnyRecord[];
  plans: AnyRecord[];
  users: User[];
  unreadCount: number;
};

type FailedTelegramNotification = {
  id: string;
  userName?: string;
  userEmail?: string;
  eventType: string;
  errorMessage?: string;
  retryCount: number;
  createdAt: string;
};

type FailedTelegramResponse = {
  count: number;
  items: FailedTelegramNotification[];
};

type KpiCard = {
  title: string;
  value: number;
  detail: string;
  icon: LucideIcon;
  iconClass: string;
  onDetailClick?: () => void;
};

type BarItem = {
  label: string;
  value: number;
  colorClass: string;
};

const CLOSED_REQUEST_STATUSES = new Set(['done', 'closed', 'cancelled']);
const DAY_MS = 24 * 60 * 60 * 1000;

const readString = (record: AnyRecord, ...keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
};

const readBool = (record: AnyRecord, ...keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return false;
};

const readStringArray = (record: AnyRecord, ...keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    }
    if (typeof value === 'string' && value.trim()) {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [] as string[];
};

import { normalizeList } from '@/utils/normalize';

const getUnreadCount = async () => {
  const result = await api.getT<UnreadCountResponse>('/notifications/unread-count');
  return Number(result?.count ?? 0);
};

const toStartOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const parseDateValue = (value: string) => {
  if (!value) return null;
  const date =
    /^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{4}-\d{2}-\d{2}\s*$/.test(value)
      ? new Date(`${value.slice(0, 10)}T00:00:00`)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const getDiffDaysFromToday = (value: string) => {
  const targetDate = parseDateValue(value);
  if (!targetDate) return null;
  const today = toStartOfDay(new Date());
  const target = toStartOfDay(targetDate);
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
};

const pluralDays = (days: number) => {
  const n = Math.abs(days);
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} дня`;
  return `${n} дней`;
};

const formatRelativeDate = (value: string) => {
  const diff = getDiffDaysFromToday(value);
  if (diff === null) return '-';
  if (diff === 0) return 'сегодня';
  if (diff > 0) return `через ${pluralDays(diff)}`;
  return `${pluralDays(diff)} назад`;
};

const formatDate = (value: string) => {
  const date = parseDateValue(value);
  if (!date) return '-';
  return date.toLocaleDateString('ru-RU');
};

const formatNumber = (value: number) => value.toLocaleString('ru-RU');

function LoadingSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="h-8 sm:h-9 w-48 sm:w-64 animate-pulse rounded bg-slate-200" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm">
            <div className="h-5 w-24 animate-pulse rounded bg-slate-200" />
            <div className="mt-4 h-9 w-28 animate-pulse rounded bg-slate-200" />
            <div className="mt-3 h-4 w-32 animate-pulse rounded bg-slate-200" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-2">
        <div className="h-56 animate-pulse rounded-xl bg-slate-200" />
        <div className="h-56 animate-pulse rounded-xl bg-slate-200" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-2">
        <div className="h-56 animate-pulse rounded-xl bg-slate-200" />
        <div className="h-56 animate-pulse rounded-xl bg-slate-200" />
      </div>
    </div>
  );
}

function BarStat({ title, items }: { title: string; items: BarItem[] }) {
  const maxValue = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-sm">
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div key={item.label} className="grid grid-cols-[80px_1fr_auto] sm:grid-cols-[120px_1fr_auto] items-center gap-2 sm:gap-3">
            <p className="truncate text-sm text-slate-700 dark:text-slate-300">{item.label}</p>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className={['h-full rounded-full transition-all', item.colorClass].join(' ')}
                style={{ width: `${(item.value / maxValue) * 100}%` }}
              />
            </div>
            <p className="w-8 text-right text-sm font-medium text-slate-700 dark:text-slate-300">{formatNumber(item.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const role = user?.role || '';
  const userId = user?.id || '';
  const actorTenantId = readString((user || {}) as AnyRecord, 'tenantId', 'tenant_id', 'counterpartyId', 'counterparty_id');
  const isAdmin = role === 'admin' || role === 'manager';
  const isStaff = ['admin', 'manager', 'curator', 'dispatcher', 'executor'].includes(role);
  const isExecutor = role === 'executor';
  const isInstaller = role === 'installer';
  const isClient = ['installer', 'client_manager', 'client_user', 'user'].includes(role);
  const canOpenSppzJournal = ['admin', 'manager', 'curator', 'dispatcher', 'executor'].includes(role);

  const [data, setData] = useState<DashboardData>({
    projects: [],
    requests: [],
    plans: [],
    users: [],
    unreadCount: 0,
  });
  const [telegramFailures, setTelegramFailures] = useState<FailedTelegramResponse>({ count: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');

      try {
        const [projectsRaw, requestsRaw, plansRaw, unreadCount, usersRaw] = await Promise.all([
          !isExecutor
            ? api.getT<ListResponse<AnyRecord>>('/projects')
            : Promise.resolve({ items: [] as AnyRecord[] }),
          api.getT<ListResponse<AnyRecord>>('/service-requests'),
          !isClient && !isInstaller && !isExecutor
            ? api.getT<ListResponse<AnyRecord>>('/maintenance-plans').catch(() => ({ items: [] as AnyRecord[] }))
            : Promise.resolve({ items: [] as AnyRecord[] }),
          getUnreadCount().catch(() => 0),
          isAdmin
            ? api.getT<ListResponse<User>>('/users').catch(() => ({ items: [] as User[] }))
            : Promise.resolve({ items: [] as User[] }),
        ]);

        if (cancelled) return;

        setData({
          projects: normalizeList(projectsRaw),
          requests: normalizeList(requestsRaw),
          plans: normalizeList(plansRaw),
          unreadCount,
          users: normalizeList(usersRaw),
        });
      } catch {
        if (!cancelled) {
          setError('Не удалось загрузить данные дашборда.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, isClient, isExecutor, isInstaller]);

  useEffect(() => {
    if (!isAdmin) return;
    void api
      .getT<FailedTelegramResponse>('/admin/telegram/notifications/failed')
      .then(setTelegramFailures)
      .catch(() => {});
  }, [isAdmin]);

  const retryTelegramFailure = async (notificationId: string) => {
    try {
      await api.postT('/admin/telegram/notifications/retry', { ids: [notificationId] });
      toast.success('Повторная отправка поставлена в очередь.');
      const refreshed = await api.getT<FailedTelegramResponse>('/admin/telegram/notifications/failed');
      setTelegramFailures(refreshed);
    } catch {
      toast.error('Не удалось отправить уведомление на повтор.');
    }
  };

  const filteredRequests = useMemo(() => {
    const source = data.requests;
    if (isClient && actorTenantId) {
      return source.filter((request) => readString(request, 'tenantId', 'tenant_id') === actorTenantId);
    }
    if (isExecutor && userId) {
      return source.filter((request) => {
        const executorIds = readStringArray(request, 'executorIds', 'executor_ids');
        const createdById = readString(request, 'createdById', 'created_by_id');
        return executorIds.includes(userId) || createdById === userId;
      });
    }
    return source;
  }, [actorTenantId, data.requests, isClient, isExecutor, userId]);

  const filteredPlans = useMemo(() => {
    const activePlans = data.plans.filter((plan) => readBool(plan, 'isActive', 'is_active'));
    if (isExecutor && userId) {
      return activePlans.filter((plan) => {
        const executorIds = readStringArray(plan, 'defaultExecutorIds', 'default_executor_ids');
        return executorIds.includes(userId);
      });
    }
    return activePlans;
  }, [data.plans, isExecutor, userId]);

  const overdueRequests = useMemo(() => {
    const list = filteredRequests.filter((request) => {
      const status = readString(request, 'status').toLowerCase();
      if (CLOSED_REQUEST_STATUSES.has(status)) return false;
      const dueDate = readString(request, 'dueDatePreliminary', 'due_date_preliminary');
      const diff = getDiffDaysFromToday(dueDate);
      return diff !== null && diff < 0;
    });
    return list
      .sort((left, right) => {
        const leftDue = parseDateValue(readString(left, 'dueDatePreliminary', 'due_date_preliminary'))?.getTime() || 0;
        const rightDue = parseDateValue(readString(right, 'dueDatePreliminary', 'due_date_preliminary'))?.getTime() || 0;
        return leftDue - rightDue;
      })
      .slice(0, 5);
  }, [filteredRequests]);

  const nearestPlans = useMemo(() => {
    return filteredPlans
      .filter((plan) => Boolean(readString(plan, 'validFrom', 'valid_from')))
      .sort((left, right) => {
        const leftDiff = getDiffDaysFromToday(readString(left, 'validFrom', 'valid_from'));
        const rightDiff = getDiffDaysFromToday(readString(right, 'validFrom', 'valid_from'));
        if (leftDiff === null && rightDiff === null) return 0;
        if (leftDiff === null) return 1;
        if (rightDiff === null) return -1;
        const leftNormalized = leftDiff < 0 ? leftDiff + 36500 : leftDiff;
        const rightNormalized = rightDiff < 0 ? rightDiff + 36500 : rightDiff;
        return leftNormalized - rightNormalized;
      })
      .slice(0, 5);
  }, [filteredPlans]);

  const requestsByStatus = useMemo<BarItem[]>(() => {
    const map = new Map<string, number>([
      ['new', 0],
      ['in_progress', 0],
      ['on_site', 0],
      ['done', 0],
      ['closed', 0],
    ]);
    filteredRequests.forEach((request) => {
      const status = readString(request, 'status').toLowerCase();
      if (map.has(status)) {
        map.set(status, (map.get(status) || 0) + 1);
      }
    });
    return [
      { label: 'Новые', value: map.get('new') || 0, colorClass: 'bg-blue-500' },
      { label: 'В работе', value: map.get('in_progress') || 0, colorClass: 'bg-amber-500' },
      { label: 'На объекте', value: map.get('on_site') || 0, colorClass: 'bg-purple-500' },
      { label: 'Выполнены', value: map.get('done') || 0, colorClass: 'bg-green-500' },
      { label: 'Закрыты', value: map.get('closed') || 0, colorClass: 'bg-slate-50 dark:bg-slate-800' },
    ];
  }, [filteredRequests]);

  const requestsByType = useMemo<BarItem[]>(() => {
    const map = new Map<string, number>([
      ['emergency', 0],
      ['operation', 0],
      ['maintenance_planned', 0],
      ['general', 0],
    ]);
    filteredRequests.forEach((request) => {
      const type = readString(request, 'type').toLowerCase();
      if (map.has(type)) {
        map.set(type, (map.get(type) || 0) + 1);
      }
    });
    return [
      { label: 'Аварийные', value: map.get('emergency') || 0, colorClass: 'bg-red-500' },
      { label: 'Эксплуатация', value: map.get('operation') || 0, colorClass: 'bg-amber-500' },
      { label: 'Плановое ТО', value: map.get('maintenance_planned') || 0, colorClass: 'bg-blue-500' },
      { label: 'Общие', value: map.get('general') || 0, colorClass: 'bg-slate-50 dark:bg-slate-800' },
    ];
  }, [filteredRequests]);

  const usersStats = useMemo(() => {
    const stats = { total: data.users.length, active: 0, invited: 0, blocked: 0 };
    data.users.forEach((item) => {
      const status = String(item.status || '').toLowerCase();
      if (status === 'active') stats.active += 1;
      if (status === 'invited') stats.invited += 1;
      if (status === 'blocked') stats.blocked += 1;
    });
    return stats;
  }, [data.users]);

  const showProjects = !isExecutor;
  const showPlans = !isClient && !isInstaller;
  const showOverdue = !isClient || isExecutor;
  const showNearestPlans = !isClient && !isInstaller;

  const kpiCards = useMemo<KpiCard[]>(() => {
    const cards: KpiCard[] = [];

    if (showProjects) {
      cards.push({
        title: 'Проекты',
        value: data.projects.length,
        detail: `${formatNumber(
          data.projects.filter((project) => !CLOSED_REQUEST_STATUSES.has(readString(project, 'status').toLowerCase())).length
        )} в работе`,
        icon: FolderKanban,
        iconClass: 'bg-blue-50 text-blue-700',
      });
    }

    cards.push({
      title: 'Заявки',
      value: filteredRequests.length,
      detail: `${formatNumber(
        filteredRequests.filter((request) => readString(request, 'status').toLowerCase() === 'new').length
      )} новых • ${formatNumber(
        filteredRequests.filter((request) => readString(request, 'priority').toLowerCase() === 'critical').length
      )} критических`,
      icon: ClipboardList,
      iconClass: 'bg-red-50 text-red-700',
    });

    if (showPlans) {
      cards.push({
        title: 'Планы ТО',
        value: data.plans.length,
        detail: `${formatNumber(filteredPlans.length)} активных`,
        icon: Calendar,
        iconClass: 'bg-green-50 text-green-700',
      });
    }

    cards.push({
      title: 'Уведомления',
      value: data.unreadCount,
      detail: 'Посмотреть все →',
      icon: Bell,
      iconClass: 'bg-amber-50 text-amber-700',
      onDetailClick: () => navigate('/notifications'),
    });

    return cards;
  }, [data.projects, data.plans.length, data.unreadCount, filteredPlans.length, filteredRequests, navigate, showPlans, showProjects]);

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <Breadcrumbs items={[{ label: 'Панель' }]} />
      <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">Панель управления</h2>

      {/* Interactive Widgets Grid */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ServiceRequestsWidget />
        <OverdueWidget />
        <DeadlinesWidget />
        <ActivityWidget />
        <QuickStatsWidget />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.title} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-sm">
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{card.title}</p>
                <div className={['rounded-lg p-2', card.iconClass].join(' ')}>
                  <Icon size={18} />
                </div>
              </div>
              <p className="mt-2 sm:mt-3 text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(card.value)}</p>
              {card.onDetailClick ? (
                <button
                  type="button"
                  onClick={card.onDetailClick}
                  className="mt-2 text-xs font-medium text-brand-red transition hover:text-red-700"
                >
                  {card.detail}
                </button>
              ) : (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{card.detail}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-2">
        {showOverdue ? (
          <div
            className={[
              'rounded-xl border p-4 sm:p-6 shadow-sm',
              overdueRequests.length > 0 ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50',
            ].join(' ')}
          >
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Просроченные заявки</h3>
            <div className="mt-4 space-y-3">
              {overdueRequests.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-green-700">
                  <CheckCircle2 size={16} />
                  Нет просроченных заявок
                </div>
              ) : (
                overdueRequests.map((request) => {
                  const title = readString(request, 'title') || `Заявка ${readString(request, 'id')}`;
                  const priority = readString(request, 'priority') || 'medium';
                  const dueDate = readString(request, 'dueDatePreliminary', 'due_date_preliminary');
                  const diff = getDiffDaysFromToday(dueDate);
                  return (
                    <div key={readString(request, 'id')} className="rounded-lg border border-red-200 bg-white dark:bg-slate-900 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-100">{title}</p>
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                          {priority}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-red-700">
                        Просрочено на {pluralDays(diff ?? 0)} ({formatDate(dueDate)})
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : null}

        {showNearestPlans ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-sm">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Ближайшие ТО</h3>
            <div className="mt-4 space-y-3">
              {nearestPlans.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Нет запланированных ТО</p>
              ) : (
                nearestPlans.map((plan) => {
                  const id = readString(plan, 'id');
                  const systemType = readString(plan, 'systemType', 'system_type');
                  const validFrom = readString(plan, 'validFrom', 'valid_from');
                  const contactPerson = readString(plan, 'contactPerson', 'contact_person');
                  return (
                    <div key={id} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-3">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {SYSTEM_LABELS[systemType as keyof typeof SYSTEM_LABELS] || systemType || 'Система не указана'}
                      </p>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                        {formatDate(validFrom)} • {formatRelativeDate(validFrom)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Контакт: {contactPerson || 'не указан'}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-2">
        <BarStat title="Заявки по статусам" items={requestsByStatus} />
        <BarStat title="Заявки по типам" items={requestsByType} />
      </div>

      {isAdmin ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-indigo-50 p-2 text-indigo-700">
              <Users size={16} />
            </div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Пользователи системы</h3>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">Всего</p>
              <p className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(usersStats.total)}</p>
            </div>
            <div className="rounded-lg bg-green-50 p-3">
              <p className="text-xs text-green-700">Активные</p>
              <p className="mt-1 text-xl font-bold text-green-800">{formatNumber(usersStats.active)}</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-xs text-blue-700">Приглашены</p>
              <p className="mt-1 text-xl font-bold text-blue-800">{formatNumber(usersStats.invited)}</p>
            </div>
            <div className="rounded-lg bg-red-50 p-3">
              <p className="text-xs text-red-700">Заблокированы</p>
              <p className="mt-1 text-xl font-bold text-red-800">{formatNumber(usersStats.blocked)}</p>
            </div>
          </div>
        </div>
      ) : null}

      {isAdmin ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Ошибки Telegram</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Сейчас в ошибке: {formatNumber(telegramFailures.count)}</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {telegramFailures.items.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Ошибок нет.</p>
            ) : (
              telegramFailures.items.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.userName || item.userEmail || 'Пользователь не найден'}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {item.eventType} • повторов {item.retryCount} • {new Date(item.createdAt).toLocaleString('ru-RU')}
                      </p>
                      <p className="mt-2 text-sm text-red-600 dark:text-red-400">{item.errorMessage || 'Неизвестная ошибка'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void retryTelegramFailure(item.id)}
                      className="w-full sm:w-auto shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      Повторить
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Быстрые действия</h3>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => navigate('/service-requests?create=true')}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
          >
            <PlusSquare size={16} />
            Создать заявку
          </button>
          {!isClient && !isInstaller ? (
            <button
              type="button"
              onClick={() => navigate('/maintenance-plans')}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 transition hover:bg-slate-50 dark:bg-slate-800"
            >
              Посмотреть план ТО
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => navigate('/notifications')}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 transition hover:bg-slate-50 dark:bg-slate-800"
          >
            Все уведомления
          </button>
          {canOpenSppzJournal ? (
            <button
              type="button"
              onClick={() => navigate('/sppz-journal')}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 transition hover:bg-slate-50 dark:bg-slate-800"
            >
              <FileText size={16} />
              Журнал СППЗ
            </button>
          ) : null}
        </div>
      </div>

      {!isStaff ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-4 text-sm text-slate-600 dark:text-slate-400">
          Для вашей роли отображаются только доступные данные.
        </div>
      ) : null}
    </div>
  );
}
