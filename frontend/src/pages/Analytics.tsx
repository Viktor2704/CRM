import { useState, useEffect } from 'react';
import { LineChart } from '../components/charts/LineChart';
import { BarChart } from '../components/charts/BarChart';
import { PieChart } from '../components/charts/PieChart';
import { Heatmap } from '../components/charts/Heatmap';
import { TrendingUp, TrendingDown, Activity, Users, Clock, Target, AlertTriangle, Lightbulb } from 'lucide-react';
import { api } from '@/api/client';

type TimeRange = 'day' | 'week' | 'month' | 'quarter' | 'year';

type AnalyticsMetrics = {
  responseTime: {
    average: number;
    median: number;
    p95: number;
    trend: number;
  };
  completionRate: {
    rate: number;
    total: number;
    completed: number;
    trend: number;
  };
  customerSatisfaction: {
    score: number;
    total: number;
    trend: number;
  };
  volumeMetrics: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    trend: number;
  };
};

export default function Analytics() {
  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<AnalyticsMetrics | null>(null);
  const [volumeTrend, setVolumeTrend] = useState<any>(null);
  const [statusChart, setStatusChart] = useState<any>(null);
  const [priorityChart, setPriorityChart] = useState<any>(null);
  const [heatmapData, setHeatmapData] = useState<any>(null);
  const [forecast, setForecast] = useState<any[]>([]);
  const [bottlenecks, setBottlenecks] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [kpis, setKpis] = useState<any[]>([]);

  useEffect(() => {
    loadAnalytics();
  }, [timeRange]);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      // Calculate date range
      const end = new Date();
      const start = new Date();
      switch (timeRange) {
        case 'day':
          start.setDate(start.getDate() - 1);
          break;
        case 'week':
          start.setDate(start.getDate() - 7);
          break;
        case 'month':
          start.setMonth(start.getMonth() - 1);
          break;
        case 'quarter':
          start.setMonth(start.getMonth() - 3);
          break;
        case 'year':
          start.setFullYear(start.getFullYear() - 1);
          break;
      }

      const startDate = start.toISOString();
      const endDate = end.toISOString();

      // Load all analytics data in parallel
      const [
        metricsData,
        volumeTrendData,
        statusChartData,
        priorityChartData,
        heatmapDataRes,
        forecastData,
        bottlenecksData,
        recommendationsData,
        kpisData,
      ] = await Promise.all([
        api.get(`/analytics/metrics?range=${timeRange}`) as Promise<any>,
        api.get(`/analytics/trends?metric=volume&range=${timeRange}&granularity=day`) as Promise<any>,
        api.get(`/analytics/charts/status-distribution?startDate=${startDate}&endDate=${endDate}`) as Promise<any>,
        api.get(`/analytics/charts/priority-distribution?startDate=${startDate}&endDate=${endDate}`) as Promise<any>,
        api.get(`/analytics/charts/workload-heatmap?startDate=${startDate}&endDate=${endDate}`) as Promise<any>,
        api.get(`/analytics/forecast/volume?days=30`) as Promise<any>,
        api.get(`/analytics/bottlenecks`) as Promise<any>,
        api.get(`/analytics/recommendations`) as Promise<any>,
        api.get(`/analytics/kpi`) as Promise<any>,
      ]);

      setMetrics(metricsData as any);

      // Format volume trend for line chart
      setVolumeTrend({
        labels: volumeTrendData.map((d: any) => d.date),
        datasets: [{
          label: 'Объём заявок',
          data: volumeTrendData.map((d: any) => d.value),
          borderColor: '#3b82f6',
          backgroundColor: '#3b82f620',
          fill: true,
        }],
      });

      setStatusChart(statusChartData);
      setPriorityChart(priorityChartData);
      setHeatmapData(heatmapDataRes);
      setForecast(forecastData);
      setBottlenecks(bottlenecksData);
      setRecommendations(recommendationsData);
      setKpis(kpisData);

    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTrend = (trend: number) => {
    const isPositive = trend > 0;
    const Icon = isPositive ? TrendingUp : TrendingDown;
    const color = isPositive ? 'text-green-600' : 'text-red-600';

    return (
      <span className={`flex items-center gap-1 ${color}`}>
        <Icon size={16} />
        {Math.abs(trend).toFixed(1)}%
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Загрузка аналитики...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-6">
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900">Панель аналитики</h1>

        <div className="flex flex-wrap gap-1.5 sm:gap-2">
          {(['day', 'week', 'month', 'quarter', 'year'] as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-lg text-sm sm:text-base font-medium transition-colors ${
                timeRange === range
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {range.charAt(0).toUpperCase() + range.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Key Metrics */}
      {metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-6">
          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Clock className="text-blue-600 shrink-0" size={20} />
                <h3 className="text-xs sm:text-sm font-medium text-gray-600">Среднее время ответа</h3>
              </div>
              {formatTrend(metrics.responseTime.trend)}
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900">{metrics.responseTime.average.toFixed(1)}ч</p>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">Медиана: {metrics.responseTime.median.toFixed(1)}ч</p>
          </div>

          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Target className="text-green-600 shrink-0" size={20} />
                <h3 className="text-xs sm:text-sm font-medium text-gray-600">Процент выполнения</h3>
              </div>
              {formatTrend(metrics.completionRate.trend)}
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900">{metrics.completionRate.rate.toFixed(1)}%</p>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">{metrics.completionRate.completed} из {metrics.completionRate.total}</p>
          </div>

          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Users className="text-purple-600 shrink-0" size={20} />
                <h3 className="text-xs sm:text-sm font-medium text-gray-600">Удовлетворённость</h3>
              </div>
              {formatTrend(metrics.customerSatisfaction.trend)}
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900">{metrics.customerSatisfaction.score.toFixed(1)}/5</p>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">{metrics.customerSatisfaction.total} ответов</p>
          </div>

          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Activity className="text-orange-600 shrink-0" size={20} />
                <h3 className="text-xs sm:text-sm font-medium text-gray-600">Объём заявок</h3>
              </div>
              {formatTrend(metrics.volumeMetrics.trend)}
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900">{metrics.volumeMetrics.total}</p>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">Всего заявок</p>
          </div>
        </div>
      )}

      {/* KPI Progress */}
      {kpis.length > 0 && (
        <div className="bg-white rounded-lg shadow p-3 sm:p-6 mb-6">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-4">Прогресс KPI</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {kpis.map((kpi, index) => {
              const progress = (kpi.current / kpi.target) * 100;
              const isOnTrack = progress >= 80;

              return (
                <div key={index} className="border rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">{kpi.name}</h3>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-2xl font-bold text-gray-900">{kpi.current.toFixed(1)}</span>
                    <span className="text-sm text-gray-500">/ {kpi.target.toFixed(1)} {kpi.unit}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${isOnTrack ? 'bg-green-600' : 'bg-orange-600'}`}
                      style={{ width: `${Math.min(progress, 100)}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{progress.toFixed(0)}% от цели</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-6 mb-6">
        {/* Volume Trend */}
        {volumeTrend && (
          <div className="bg-white rounded-lg shadow p-3 sm:p-6 overflow-hidden">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-4">Тренд объёма заявок</h2>
            <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
              <LineChart data={volumeTrend} height={300} />
            </div>
          </div>
        )}

        {/* Status Distribution */}
        {statusChart && (
          <div className="bg-white rounded-lg shadow p-3 sm:p-6 overflow-hidden">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-4">Распределение по статусам</h2>
            <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
              <PieChart data={statusChart} height={300} />
            </div>
          </div>
        )}

        {/* Priority Distribution */}
        {priorityChart && (
          <div className="bg-white rounded-lg shadow p-3 sm:p-6 overflow-hidden">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-4">Распределение по приоритетам</h2>
            <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
              <BarChart data={priorityChart} height={300} />
            </div>
          </div>
        )}

        {/* Workload Heatmap */}
        {heatmapData && (
          <div className="bg-white rounded-lg shadow p-3 sm:p-6 overflow-hidden">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-4">Тепловая карта нагрузки</h2>
            <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
              <Heatmap data={heatmapData} height={300} colorScheme="blue" />
            </div>
          </div>
        )}
      </div>

      {/* Forecast */}
      {forecast.length > 0 && (
        <div className="bg-white rounded-lg shadow p-3 sm:p-6 mb-6 overflow-hidden">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-4">Прогноз на 30 дней</h2>
          <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <LineChart
            data={{
              labels: forecast.map(f => f.date),
              datasets: [
                {
                  label: 'Прогноз',
                  data: forecast.map(f => f.predicted),
                  borderColor: '#3b82f6',
                  backgroundColor: '#3b82f620',
                  fill: true,
                },
                {
                  label: 'Верхняя граница',
                  data: forecast.map(f => f.confidence.upper),
                  borderColor: '#93c5fd',
                  backgroundColor: 'transparent',
                  fill: false,
                },
                {
                  label: 'Нижняя граница',
                  data: forecast.map(f => f.confidence.lower),
                  borderColor: '#93c5fd',
                  backgroundColor: 'transparent',
                  fill: false,
                },
              ],
            }}
            height={300}
          />
          </div>
        </div>
      )}

      {/* Bottlenecks */}
      {bottlenecks.length > 0 && (
        <div className="bg-white rounded-lg shadow p-3 sm:p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="text-orange-600 shrink-0" size={20} />
            <h2 className="text-lg sm:text-xl font-bold text-gray-900">Выявленные узкие места</h2>
          </div>
          <div className="space-y-3 sm:space-y-4">
            {bottlenecks.slice(0, 5).map((bottleneck, index) => (
              <div key={index} className="border-l-4 border-orange-500 bg-orange-50 p-3 sm:p-4 rounded">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between mb-2">
                  <h3 className="font-semibold text-gray-900 text-sm sm:text-base">{bottleneck.area}</h3>
                  <span className={`self-start whitespace-nowrap px-2 py-1 rounded text-xs font-medium ${
                    bottleneck.severity > 80 ? 'bg-red-100 text-red-800' :
                    bottleneck.severity > 60 ? 'bg-orange-100 text-orange-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    Критичность: {bottleneck.severity}%
                  </span>
                </div>
                <p className="text-sm text-gray-700 mb-2">{bottleneck.impact}</p>
                <p className="text-sm text-gray-600 italic">{bottleneck.recommendation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="bg-white rounded-lg shadow p-3 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb className="text-yellow-600 shrink-0" size={20} />
            <h2 className="text-lg sm:text-xl font-bold text-gray-900">Рекомендации по оптимизации</h2>
          </div>
          <div className="space-y-3 sm:space-y-4">
            {recommendations.slice(0, 5).map((rec, index) => (
              <div key={index} className="border rounded-lg p-3 sm:p-4 hover:shadow-md transition-shadow">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between mb-2">
                  <div>
                    <span className="text-xs font-medium text-blue-600 uppercase">{rec.category}</span>
                    <h3 className="font-semibold text-gray-900 mt-1 text-sm sm:text-base">{rec.title}</h3>
                  </div>
                  <span className={`self-start whitespace-nowrap px-2 py-1 rounded text-xs font-medium ${
                    rec.effort === 'low' ? 'bg-green-100 text-green-800' :
                    rec.effort === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {rec.effort === 'low' ? 'Низкая' : rec.effort === 'medium' ? 'Средняя' : 'Высокая'} сложность
                  </span>
                </div>
                <p className="text-sm text-gray-700 mb-2">{rec.description}</p>
                <p className="text-sm text-green-700 font-medium">Ожидаемый эффект: {rec.expectedImpact}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
