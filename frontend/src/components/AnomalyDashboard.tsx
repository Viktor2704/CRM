import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock, TrendingUp, XCircle } from 'lucide-react';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';

type Anomaly = {
  id: string;
  anomaly_type: string;
  entity_type: string;
  entity_id: string;
  severity: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
  resolved_at?: string;
};

const SEVERITY_CONFIG = {
  critical: {
    label: 'Критический',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    icon: XCircle,
  },
  high: {
    label: 'Высокий',
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    icon: AlertTriangle,
  },
  medium: {
    label: 'Средний',
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
    icon: Clock,
  },
  low: {
    label: 'Низкий',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    icon: TrendingUp,
  },
};

const ANOMALY_TYPE_LABELS: Record<string, string> = {
  stuck_request: 'Зависшие заявки',
  high_frequency_issue: 'Частые проблемы',
  overdue_pattern: 'Просроченные заявки',
};

export default function AnomalyDashboard() {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const { showToast } = useToast();

  const fetchAnomalies = async () => {
    try {
      const response = await api.get<{ anomalies: Anomaly[] }>('/ai/anomalies?resolved=false');
      if (response?.anomalies) {
        setAnomalies(response.anomalies);
      }
    } catch (error) {
      console.error('Failed to fetch anomalies:', error);
    } finally {
      setLoading(false);
    }
  };

  const runDetection = async () => {
    setDetecting(true);
    try {
      const response = await api.post<{ anomalies: Anomaly[] }>('/ai/detect-anomalies');
      if (response?.anomalies) {
        showToast(
          `Обнаружено аномалий: ${response.anomalies.length}`,
          response.anomalies.length > 0 ? 'info' : 'success'
        );
        await fetchAnomalies();
      }
    } catch (error) {
      showToast('Ошибка при обнаружении аномалий', 'error');
      console.error('Failed to run anomaly detection:', error);
    } finally {
      setDetecting(false);
    }
  };

  const resolveAnomaly = async (anomalyId: string) => {
    try {
      await api.post(`/ai/anomalies/${anomalyId}/resolve`);
      showToast('Аномалия отмечена как решенная', 'success');
      await fetchAnomalies();
    } catch (error) {
      showToast('Ошибка при разрешении аномалии', 'error');
      console.error('Failed to resolve anomaly:', error);
    }
  };

  useEffect(() => {
    fetchAnomalies();
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 rounded bg-slate-200 dark:bg-slate-700"></div>
          <div className="h-20 rounded bg-slate-100 dark:bg-slate-700/50"></div>
        </div>
      </div>
    );
  }

  // Group anomalies by severity
  const groupedBySeverity = anomalies.reduce((acc, anomaly) => {
    const severity = anomaly.severity || 'medium';
    if (!acc[severity]) acc[severity] = [];
    acc[severity].push(anomaly);
    return acc;
  }, {} as Record<string, Anomaly[]>);

  const criticalCount = groupedBySeverity.critical?.length || 0;
  const highCount = groupedBySeverity.high?.length || 0;
  const mediumCount = groupedBySeverity.medium?.length || 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="border-b border-slate-200 p-4 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-orange-600 dark:text-orange-400" size={24} />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Обнаружение аномалий
            </h2>
          </div>
          <button
            onClick={runDetection}
            disabled={detecting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {detecting ? 'Проверка...' : 'Запустить проверку'}
          </button>
        </div>
      </div>

      <div className="p-4">
        {anomalies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle className="mb-3 text-green-600 dark:text-green-400" size={48} />
            <p className="text-lg font-medium text-slate-900 dark:text-slate-100">
              Аномалий не обнаружено
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Все системы работают нормально
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
              {criticalCount > 0 && (
                <div className="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
                  <div className="text-2xl font-bold text-red-700 dark:text-red-300">
                    {criticalCount}
                  </div>
                  <div className="text-xs text-red-600 dark:text-red-400">Критических</div>
                </div>
              )}
              {highCount > 0 && (
                <div className="rounded-lg bg-orange-50 p-3 dark:bg-orange-900/20">
                  <div className="text-2xl font-bold text-orange-700 dark:text-orange-300">
                    {highCount}
                  </div>
                  <div className="text-xs text-orange-600 dark:text-orange-400">
                    Высокий приоритет
                  </div>
                </div>
              )}
              {mediumCount > 0 && (
                <div className="rounded-lg bg-yellow-50 p-3 dark:bg-yellow-900/20">
                  <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">
                    {mediumCount}
                  </div>
                  <div className="text-xs text-yellow-600 dark:text-yellow-400">
                    Средний приоритет
                  </div>
                </div>
              )}
            </div>

            {/* Anomaly list */}
            <div className="space-y-2">
              {anomalies.slice(0, 10).map((anomaly) => {
                const config = SEVERITY_CONFIG[anomaly.severity as keyof typeof SEVERITY_CONFIG] || SEVERITY_CONFIG.medium;
                const Icon = config.icon;

                return (
                  <div
                    key={anomaly.id}
                    className={`rounded-lg border p-3 ${config.bgColor} border-current/20`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1">
                        <Icon size={20} className={config.color} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-sm font-medium ${config.color}`}>
                              {ANOMALY_TYPE_LABELS[anomaly.anomaly_type] || anomaly.anomaly_type}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${config.bgColor} ${config.color}`}>
                              {config.label}
                            </span>
                          </div>
                          <p className="text-sm text-slate-700 dark:text-slate-300">
                            {anomaly.description}
                          </p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {new Date(anomaly.created_at).toLocaleString('ru-RU')}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => resolveAnomaly(anomaly.id)}
                        className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                      >
                        Решено
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {anomalies.length > 10 && (
              <p className="text-center text-sm text-slate-600 dark:text-slate-400">
                Показано 10 из {anomalies.length} аномалий
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
