import { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, TrendingDown } from 'lucide-react';
import { api } from '@/api/client';

type Stats = {
  totalProjects: number;
  activeProjects: number;
  totalRequests: number;
  openRequests: number;
  totalInstallations: number;
  completedInstallations: number;
  totalUsers: number;
  activeUsers: number;
};

type Props = {
  onDataUpdate?: (stats: Stats) => void;
};

export default function QuickStatsWidget({ onDataUpdate }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.getT<Stats>('/dashboard/quick-stats');
        setStats(data);
        onDataUpdate?.(data);
      } catch {
        setStats(null);
      } finally {
        setLoading(false);
      }
    };

    void load();
    const interval = setInterval(() => void load(), 60000);
    return () => clearInterval(interval);
  }, [onDataUpdate]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <div className="h-5 w-48 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <p className="text-sm text-slate-500 dark:text-slate-400">Не удалось загрузить статистику</p>
      </div>
    );
  }

  const projectsRate = stats.totalProjects > 0 ? (stats.activeProjects / stats.totalProjects) * 100 : 0;
  const requestsRate = stats.totalRequests > 0 ? (stats.openRequests / stats.totalRequests) * 100 : 0;
  const installationsRate = stats.totalInstallations > 0 ? (stats.completedInstallations / stats.totalInstallations) * 100 : 0;
  const usersRate = stats.totalUsers > 0 ? (stats.activeUsers / stats.totalUsers) * 100 : 0;

  const statItems = [
    {
      label: 'Проекты',
      value: stats.totalProjects,
      subValue: stats.activeProjects,
      subLabel: 'активных',
      rate: projectsRate,
      color: 'blue',
    },
    {
      label: 'Заявки',
      value: stats.totalRequests,
      subValue: stats.openRequests,
      subLabel: 'открытых',
      rate: requestsRate,
      color: 'red',
    },
    {
      label: 'Установки',
      value: stats.totalInstallations,
      subValue: stats.completedInstallations,
      subLabel: 'завершено',
      rate: installationsRate,
      color: 'green',
    },
    {
      label: 'Пользователи',
      value: stats.totalUsers,
      subValue: stats.activeUsers,
      subLabel: 'активных',
      rate: usersRate,
      color: 'purple',
    },
  ];

  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    red: 'bg-red-50 text-red-700',
    green: 'bg-green-50 text-green-700',
    purple: 'bg-purple-50 text-purple-700',
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Быстрая статистика</h3>
        <BarChart3 size={18} className="text-slate-600" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {statItems.map((item) => (
          <div key={item.label} className={`rounded-lg p-3 ${colorClasses[item.color]}`}>
            <p className="text-xs font-medium">{item.label}</p>
            <p className="mt-1 text-2xl font-bold">{item.value}</p>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-xs">
                {item.subValue} {item.subLabel}
              </p>
              <div className="flex items-center gap-1">
                {item.rate >= 50 ? (
                  <TrendingUp size={12} />
                ) : (
                  <TrendingDown size={12} />
                )}
                <span className="text-xs font-semibold">{item.rate.toFixed(0)}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
