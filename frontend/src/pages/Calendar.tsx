import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Plus, X, Calendar as CalIcon } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';

type CalEventMeta = {
  description?: string;
  frequency?: string;
  contactPerson?: string;
  status?: string;
  priority?: string;
  directionName?: string;
  systemType?: string;
  dayOfMonth?: number;
};

type CalEvent = {
  id: string;
  type: 'maintenance' | 'service_request' | 'visit' | 'project' | 'installation' | 'custom';
  title: string;
  date: string | null;
  endDate?: string | null;
  meta: CalEventMeta;
  entityId: string;
  entityType: string;
  color: string;
};

const COLOR_MAP: Record<string, string> = {
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  green: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
};

const TYPE_LABEL: Record<string, string> = {
  maintenance: 'ТО',
  service_request: 'Дедлайн',
  visit: 'Выезд',
  project: 'Проект',
  installation: 'Монтаж',
  custom: 'Событие',
};

type FilterTab = 'all' | 'requests' | 'installations' | 'projects';

const FILTER_TABS: { key: FilterTab; label: string; types: string[] }[] = [
  { key: 'all', label: 'Все', types: ['service_request', 'visit', 'maintenance', 'custom', 'installation', 'project'] },
  { key: 'requests', label: 'Заявки ТО', types: ['service_request', 'visit', 'maintenance', 'custom'] },
  { key: 'installations', label: 'Монтажи', types: ['installation'] },
  { key: 'projects', label: 'Проекты', types: ['project'] },
];

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

export default function CalendarPage() {
  const toast = useToast();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newColor, setNewColor] = useState('green');
  const [saving, setSaving] = useState(false);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const from = `${year}-${pad2(month + 1)}-01`;
      const lastDay = getDaysInMonth(year, month);
      const to = `${year}-${pad2(month + 1)}-${pad2(lastDay)}`;
      const result = await api.getT<{ events: CalEvent[] }>(`/calendar/events?from=${from}&to=${to}`);
      setEvents(result.events || []);
    } catch {
      toast.error('Не удалось загрузить события.');
    } finally {
      setLoading(false);
    }
  }, [year, month, toast]);

  useEffect(() => { void loadEvents(); }, [loadEvents]);

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  const filteredEvents = useMemo(() => {
    const tab = FILTER_TABS.find(t => t.key === activeTab);
    if (!tab) return events;
    return events.filter(ev => tab.types.includes(ev.type));
  }, [events, activeTab]);

  const eventsByDate = useMemo(() => filteredEvents.reduce<Record<string, CalEvent[]>>((acc, ev) => {
    if (!ev.date) return acc;
    const key = ev.date.slice(0, 10);
    if (!acc[key]) acc[key] = [];
    acc[key].push(ev);
    return acc;
  }, {}), [filteredEvents]);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDow = getFirstDayOfWeek(year, month);
  const todayStr = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  const selectedEvents = selectedDay ? (eventsByDate[selectedDay] ?? []) : [];

  // Stats
  const stats = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const ev of events) {
      byType[ev.type] = (byType[ev.type] || 0) + 1;
    }
    return byType;
  }, [events]);

  const onAddEvent = async () => {
    if (!newTitle.trim() || !newDate) return;
    setSaving(true);
    try {
      await api.postT('/calendar/events', { title: newTitle.trim(), description: newDesc.trim(), eventDate: newDate, color: newColor });
      toast.success('Событие добавлено.');
      setNewTitle(''); setNewDesc(''); setNewDate(''); setNewColor('green');
      setShowAddForm(false);
      void loadEvents();
    } catch {
      toast.error('Не удалось добавить событие.');
    } finally {
      setSaving(false);
    }
  };

  const onDeleteEvent = async (ev: CalEvent) => {
    if (ev.type !== 'custom') return;
    try {
      await api.delT(`/calendar/events/${ev.entityId}`);
      toast.success('Событие удалено.');
      void loadEvents();
    } catch {
      toast.error('Не удалось удалить событие.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Breadcrumbs items={[{ label: 'Календарь' }]} />
        <button
          onClick={() => { setShowAddForm(true); setNewDate(selectedDay ?? todayStr); }}
          className="flex items-center gap-2 rounded-lg bg-brand-red px-4 py-2.5 min-h-[44px] text-sm font-semibold text-white transition hover:bg-red-700"
        >
          <Plus size={16} />
          Добавить
        </button>
      </div>

      {/* Filter tabs + legend */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <div className="flex overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={[
                'whitespace-nowrap px-3 py-2 text-xs font-semibold transition min-h-[44px]',
                activeTab === tab.key
                  ? 'bg-brand-red text-white'
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700',
              ].join(' ')}
            >
              {tab.label}
              {` (${tab.types.reduce((s, t) => s + (stats[t] || 0), 0)})`}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-400" /> ТО</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-400" /> Выезд</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-yellow-400" /> Дедлайн</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-orange-400" /> Монтаж</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-purple-400" /> Проект</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-400" /> Критический</span>
        </div>
        <span className="sm:ml-auto text-xs text-slate-400">Всего: {filteredEvents.length}</span>
      </div>

      {/* Add event form */}
      {showAddForm && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Новое событие</h3>
            <button onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="Название *"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-red dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <input
              type="date"
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-red dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <input
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Описание"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-red dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <div className="flex gap-2">
              <select
                value={newColor}
                onChange={e => setNewColor(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-red dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="green">Зелёный</option>
                <option value="blue">Синий</option>
                <option value="purple">Фиолетовый</option>
                <option value="orange">Оранжевый</option>
                <option value="red">Красный</option>
              </select>
              <button
                onClick={() => void onAddEvent()}
                disabled={!newTitle.trim() || !newDate || saving}
                className="rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]" style={{ overflowX: 'hidden' }}>
        {/* Calendar grid */}
        <div className="min-w-0 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <button onClick={prevMonth} className="rounded-lg p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronLeft size={18} /></button>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {MONTHS[month]} {year}
            </h2>
            <button onClick={nextMonth} className="rounded-lg p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronRight size={18} /></button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 border-b border-slate-100 dark:border-slate-800">
            {WEEKDAYS.map(d => (
              <div key={d} className="py-2 text-center text-xs font-medium text-slate-500 dark:text-slate-400">{d}</div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDow }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[60px] sm:min-h-[110px] border-b border-r border-slate-100 dark:border-slate-800/50" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = toDateStr(year, month, day);
              const dayEvents = eventsByDate[dateStr] ?? [];
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selectedDay;
              return (
                <div
                  key={day}
                  onClick={() => setSelectedDay(isSelected ? null : dateStr)}
                  className={[
                    'min-h-[60px] sm:min-h-[110px] cursor-pointer border-b border-r border-slate-100 p-0.5 sm:p-1.5 transition dark:border-slate-800/50',
                    isSelected ? 'bg-brand-red/5 ring-1 ring-inset ring-brand-red' : 'hover:bg-slate-50 dark:hover:bg-slate-800/30',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className={[
                      'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                      isToday ? 'bg-brand-red text-white' : 'text-slate-700 dark:text-slate-300',
                    ].join(' ')}>
                      {day}
                    </div>
                    {dayEvents.length > 0 && (
                      <span className="text-[9px] font-medium text-slate-400">{dayEvents.length}</span>
                    )}
                  </div>
                  {/* Mobile: colored dots only */}
                  <div className="flex flex-wrap gap-0.5 sm:hidden">
                    {dayEvents.slice(0, 4).map(ev => (
                      <span key={ev.id} className={`inline-block h-1.5 w-1.5 rounded-full ${ev.color === 'blue' ? 'bg-blue-400' : ev.color === 'red' ? 'bg-red-400' : ev.color === 'orange' ? 'bg-orange-400' : ev.color === 'yellow' ? 'bg-yellow-400' : ev.color === 'purple' ? 'bg-purple-400' : 'bg-green-400'}`} />
                    ))}
                    {dayEvents.length > 4 && <span className="text-[8px] text-slate-400">+{dayEvents.length - 4}</span>}
                  </div>
                  {/* Desktop: full event chips */}
                  <div className="hidden sm:block space-y-0.5">
                    {dayEvents.slice(0, 3).map(ev => (
                      <div
                        key={ev.id}
                        className={`flex items-start gap-1 rounded px-1 py-0.5 text-[10px] font-medium leading-tight ${COLOR_MAP[ev.color] ?? COLOR_MAP.green}`}
                        title={ev.title}
                      >
                        <span className="mt-px shrink-0 text-[8px] font-bold uppercase opacity-60">{TYPE_LABEL[ev.type]?.slice(0,2)}</span>
                        <span className="line-clamp-1 break-words">{ev.title}</span>
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="px-1 text-[10px] font-medium text-slate-400">+{dayEvents.length - 3}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {loading && (
            <div className="py-3 text-center text-sm text-slate-400">Загрузка...</div>
          )}
        </div>

        {/* Day detail panel */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {selectedDay ? `${new Date(selectedDay + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })}` : 'Выберите день'}
            </h3>
          </div>
          <div className="p-3 max-h-[600px] overflow-y-auto">
            {!selectedDay && (
              <div className="flex flex-col items-center gap-2 py-8 text-slate-400">
                <CalIcon size={32} className="opacity-30" />
                <p className="text-sm">Нажмите на день в календаре</p>
              </div>
            )}
            {selectedDay && selectedEvents.length === 0 && (
              <div className="py-6 text-center text-sm text-slate-400">Нет событий</div>
            )}
            <div className="space-y-2">
              {selectedEvents.map(ev => (
                <div key={ev.id} className={`rounded-lg p-3 ${COLOR_MAP[ev.color] ?? COLOR_MAP.green}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[10px] font-semibold uppercase opacity-70">{TYPE_LABEL[ev.type] ?? ev.type}</span>
                        {ev.meta.status && <span className="text-[10px] opacity-60">· {ev.meta.status}</span>}
                        {ev.meta.priority && <span className="text-[10px] opacity-60">· {ev.meta.priority}</span>}
                      </div>
                      <p className="text-sm font-medium leading-snug">{ev.title}</p>
                      {ev.meta.description && (
                        <p className="mt-0.5 text-xs opacity-80">{String(ev.meta.description)}</p>
                      )}
                      {ev.meta.directionName && (
                        <p className="mt-0.5 text-xs opacity-70">{String(ev.meta.directionName)}</p>
                      )}
                      {ev.meta.frequency && (
                        <p className="mt-0.5 text-xs opacity-70">Частота: {String(ev.meta.frequency)}</p>
                      )}
                      {ev.meta.contactPerson && (
                        <p className="mt-0.5 text-xs opacity-70">Контакт: {String(ev.meta.contactPerson)}</p>
                      )}
                    </div>
                    {ev.type === 'custom' && (
                      <button
                        onClick={() => void onDeleteEvent(ev)}
                        className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
