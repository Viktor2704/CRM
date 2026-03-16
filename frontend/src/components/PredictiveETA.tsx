import { useEffect, useState } from 'react';
import { Clock, TrendingUp } from 'lucide-react';
import { api } from '@/api/client';

type CompletionTimePrediction = {
  estimatedDays: number;
  confidence: number;
  factors: {
    historicalAverage?: number;
    executorPerformance?: number;
    priorityImpact?: number;
    similarRequests?: number;
  };
};

type PredictiveETAProps = {
  requestId: string;
  requestType: string;
  priority: string;
  executorIds: string[];
  systemType?: string;
  createdAt?: string;
};

export default function PredictiveETA({
  requestId,
  requestType,
  priority,
  executorIds,
  systemType,
  createdAt,
}: PredictiveETAProps) {
  const [prediction, setPrediction] = useState<CompletionTimePrediction | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchPrediction = async () => {
      if (!requestId || !requestType) return;

      setLoading(true);
      try {
        const response = await api.post<{ prediction: CompletionTimePrediction }>('/api/ai/predict-completion-time', {
          requestId,
          requestType,
          priority,
          executorIds,
          systemType,
        });

        if (response?.prediction) {
          setPrediction(response.prediction);
        }
      } catch (error) {
        console.error('Failed to fetch completion time prediction:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPrediction();
  }, [requestId, requestType, priority, executorIds, systemType]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
        <Clock size={16} className="text-slate-400 animate-pulse" />
        <span className="text-sm text-slate-600 dark:text-slate-400">Расчет ETA...</span>
      </div>
    );
  }

  if (!prediction) return null;

  const { estimatedDays, confidence, factors } = prediction;

  // Calculate estimated completion date
  const estimatedDate = createdAt
    ? new Date(new Date(createdAt).getTime() + estimatedDays * 24 * 60 * 60 * 1000)
    : new Date(Date.now() + estimatedDays * 24 * 60 * 60 * 1000);

  const confidencePercent = Math.round(confidence * 100);
  const confidenceColor =
    confidence >= 0.8
      ? 'text-green-600 dark:text-green-400'
      : confidence >= 0.6
      ? 'text-yellow-600 dark:text-yellow-400'
      : 'text-slate-600 dark:text-slate-400';

  const confidenceLabel =
    confidence >= 0.8 ? 'Высокая' : confidence >= 0.6 ? 'Средняя' : 'Низкая';

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-900/20">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={16} className="text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
              Прогноз завершения
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                {estimatedDays}
              </span>
              <span className="text-sm text-blue-600 dark:text-blue-400">
                {estimatedDays === 1
                  ? 'день'
                  : estimatedDays < 5
                  ? 'дня'
                  : 'дней'}
              </span>
            </div>

            <div className="text-xs text-blue-600 dark:text-blue-400">
              Ожидаемая дата: {estimatedDate.toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
            Точность
          </div>
          <div className={`text-sm font-medium ${confidenceColor}`}>
            {confidenceLabel}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {confidencePercent}%
          </div>
        </div>
      </div>

      {/* Factors breakdown */}
      {Object.keys(factors).length > 0 && (
        <details className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-800">
          <summary className="text-xs text-blue-600 dark:text-blue-400 cursor-pointer hover:text-blue-700 dark:hover:text-blue-300">
            Факторы расчета
          </summary>
          <div className="mt-2 space-y-1">
            {factors.historicalAverage !== undefined && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-400">
                  Среднее по истории:
                </span>
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {factors.historicalAverage.toFixed(1)} дн.
                </span>
              </div>
            )}
            {factors.executorPerformance !== undefined && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-400">
                  Производительность исполнителя:
                </span>
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {factors.executorPerformance.toFixed(1)} дн.
                </span>
              </div>
            )}
            {factors.priorityImpact !== undefined && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-400">
                  Коэффициент приоритета:
                </span>
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {factors.priorityImpact.toFixed(1)}x
                </span>
              </div>
            )}
            {factors.similarRequests !== undefined && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-400">
                  Похожих заявок:
                </span>
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {factors.similarRequests}
                </span>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
