import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { api } from '@/api/client';

type ScheduleItem = {
  id: string;
  directionId: string | null;
  maintenanceItemId: string | null;
  objectKey: string;
  section: string;
  checkType: string;
  checkTypeLabel: string;
  periodDays: number;
  sourceEntryId: string;
  entryDate: string;
  nextCheckDate: string;
  urgency: 'ok' | 'warning' | 'overdue';
  daysUntil: number;
  createdAt: string;
  updatedAt: string;
};

const SECTION_LABELS: Record<string, string> = {
  aps: 'АПС',
  soue: 'СОУЭ',
  aupt: 'АУПТ',
  vpv: 'ВПВ',
  pdv: 'ПДВ',
  fire_extinguishers: 'Огнетушители',
  pl: 'Пож. лестницы',
  hose_reroll: 'Перекатка рукавов',
  booster_pumps: 'Насосы-повысители',
  custom: 'Прочее',
};

const URGENCY_STYLES: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  ok: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-200 dark:border-emerald-800',
    dot: 'bg-emerald-500',
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-800',
    dot: 'bg-amber-500',
  },
  overdue: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200 dark:border-red-800',
    dot: 'bg-red-500',
  },
};

const formatDate = (value: string) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'n/a';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
};

const UrgencyIcon = ({ urgency }: { urgency: string }) => {
  if (urgency === 'overdue') return <AlertTriangle size={14} className="text-red-500" />;
  if (urgency === 'warning') return <Clock size={14} className="text-amber-500" />;
  return <CheckCircle2 size={14} className="text-emerald-500" />;
};

type Props = {
  directionId?: string;
  className?: string;
};

export default function SppzCheckCalendar({ directionId, className }: Props) {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterUrgency, setFilterUrgency] = useState<'all' | 'warning' | 'overdue'>('all');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const params = directionId ? `?directionId=${directionId}` : '';
        const raw = await api.getT<ScheduleItem[]>(`/sppz-journal/schedule${params}`);
        if (!cancelled) {
          setItems(Array.isArray(raw) ? raw : []);
        }
      } catch {
        if (!cancelled) setError('Не удалось загрузить график проверок.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [directionId]);

  const filtered = useMemo(() => {
    if (filterUrgency === 'all') return items;
    if (filterUrgency === 'overdue') return items.filter((i) => i.urgency === 'overdue');
    return items.filter((i) => i.urgency === 'warning' || i.urgency === 'overdue');
  }, [items, filterUrgency]);

  const stats = useMemo(() => {
    const ok = items.filter((i) => i.urgency === 'ok').length;
    const warning = items.filter((i) => i.urgency === 'warning').length;
    const overdue = items.filter((i) => i.urgency === 'overdue').length;
    return { ok, warning, overdue, total: items.length };
  }, [items]);

  if (loading) {
    return (
      <div className={`rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 ${className ?? ''}`}>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <CalendarClock size={16} />
          <span>Загрузка графика проверок...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20 ${className ?? ''}`}>
        <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={`rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 ${className ?? ''}`}>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <CalendarClock size={16} />
          <span>Нет запланированных проверок. График формируется автоматически после подписания записей журнала.</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 ${className ?? ''}`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <CalendarClock size={18} className="text-slate-600 dark:text-slate-300" />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            График проверок СППЗ
          </h3>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            В норме: {stats.ok}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            Скоро: {stats.warning}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            Просрочено: {stats.overdue}
          </span>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-slate-200 px-4 py-2 dark:border-slate-700">
        {([
          ['all', `Все (${stats.total})`],
          ['warning', `Внимание (${stats.warning + stats.overdue})`],
          ['overdue', `Просрочено (${stats.overdue})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilterUrgency(key)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              filterUrgency === key
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Items */}
      <div className="max-h-[400px] overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-slate-400">Нет записей для выбранного фильтра.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((item) => {
              const style = URGENCY_STYLES[item.urgency] ?? URGENCY_STYLES.ok;
              return (
                <div
                  key={item.id}
                  className={`flex items-start gap-3 px-4 py-3 ${style.bg} transition hover:brightness-95`}
                >
                  <div className="mt-0.5 flex-shrink-0">
                    <UrgencyIcon urgency={item.urgency} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-xs font-semibold ${style.text}`}>
                        {SECTION_LABELS[item.section] || item.section}
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {item.checkTypeLabel || item.checkType}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                      {item.objectKey || 'Объект не указан'}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-slate-500 dark:text-slate-400">
                      <span>Следующая: {formatDate(item.nextCheckDate)}</span>
                      {item.entryDate && (
                        <span>Последняя: {formatDate(item.entryDate)}</span>
                      )}
                      <span>
                        {item.daysUntil > 0
                          ? `Через ${item.daysUntil} дн.`
                          : item.daysUntil === 0
                            ? 'Сегодня'
                            : `Просрочено на ${Math.abs(item.daysUntil)} дн.`}
                      </span>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${style.text} ${style.border} border`}
                    >
                      {item.periodDays} дн.
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
