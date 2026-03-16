import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Search, Send, Wrench, FolderKanban, ClipboardList, ChevronLeft } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import Breadcrumbs from '@/components/Breadcrumbs';
import { api } from '@/api/client';
import { type Direction, type User } from '@/types';
import { usePermissions } from '@/hooks/usePermissions';
import { getInstallationStage, INSTALLATION_STAGE_LABELS } from '@/pages/installation/meta';

type ChatEntity = {
  id: string;
  title?: string;
  type: 'service-request' | 'installation' | 'project';
  status?: string;
  priority?: string;
  directionId?: string;
  messageCount?: number;
};

type ChatMessage = {
  id: string;
  userId?: string;
  authorName?: string;
  text: string;
  createdAt: string;
  isSystem?: boolean;
};

type ListResponse<T> = T[] | { items?: T[]; data?: T[] };

const normalizeList = <T,>(v: ListResponse<T>): T[] => {
  if (Array.isArray(v)) return v;
  if (Array.isArray((v as any).items)) return (v as any).items;
  if (Array.isArray((v as any).data)) return (v as any).data;
  if (Array.isArray((v as any).requests)) return (v as any).requests;
  return [];
};

const TYPE_LABELS: Record<string, string> = {
  'service-request': 'Заявка',
  installation: 'Монтаж',
  project: 'Проект',
};

const TYPE_ICON: Record<string, typeof ClipboardList> = {
  'service-request': ClipboardList,
  installation: Wrench,
  project: FolderKanban,
};

const TYPE_COLOR: Record<string, string> = {
  'service-request': 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  installation: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  project: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
};

const STATUS_LABELS: Record<string, string> = {
  new: 'Новая', assigned: 'Назначена', in_progress: 'В работе', done: 'Выполнена',
  closed: 'Закрыта', cancelled: 'Отменена', awaiting_assignment: 'Ожидает',
  procurement: 'Закупка', pnr: 'ПНР', acceptance: 'Сдача', completed: 'Завершена',
  paused: 'На паузе', tz_preparation: 'ТЗ', design: 'Проектирование',
  internal_review: 'Проверка', client_approval: 'Согласование',
};

const getEntityStatusLabel = (entity: Pick<ChatEntity, 'type' | 'status'>) => {
  if (!entity.status) return '';
  if (entity.type === 'installation') {
    return INSTALLATION_STAGE_LABELS[entity.status] || entity.status;
  }
  return STATUS_LABELS[entity.status] || entity.status;
};

const PRIORITY_DOT: Record<string, string> = {
  critical: 'bg-red-500', high: 'bg-orange-400', medium: 'bg-yellow-400', low: 'bg-slate-300',
};

const TYPE_FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'service-request', label: 'Заявки' },
  { key: 'installation', label: 'Монтажи' },
  { key: 'project', label: 'Проекты' },
];

export default function ServiceChatsPage() {
  const { canManage, role } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id') || '';
  const selectedType = searchParams.get('type') || '';

  const [entities, setEntities] = useState<ChatEntity[]>([]);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [messageSending, setMessageSending] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const directionNameById = useMemo(() => {
    const map: Record<string, string> = {};
    directions.forEach((d) => { map[d.id] = d.name || d.id; });
    return map;
  }, [directions]);

  const userNameById = useMemo(() => {
    const map: Record<string, string> = {};
    users.forEach((u) => { map[u.id] = u.fullName || u.email || u.id; });
    return map;
  }, [users]);
  const isClientRole = ['installer', 'client_manager', 'client_user', 'user'].includes(role);

  useEffect(() => {
    void (async () => {
      try {
        const [srRaw, instRaw, projRaw, dRaw, uRaw] = await Promise.all([
          api.getT<any>('/service-requests').catch(() => []),
          api.getT<any>('/installations').catch(() => []),
          api.getT<any>('/projects').catch(() => []),
          api.getT<ListResponse<Direction>>('/directions').catch(() => []),
          canManage ? api.getT<ListResponse<User>>('/users').catch(() => []) : Promise.resolve([]),
        ]);

        const srList = normalizeList(srRaw).map((r: any) => ({
          id: r.id, title: r.title || 'Без названия', type: 'service-request' as const,
          status: r.status, priority: r.priority, directionId: r.directionId,
          messageCount: r.commentCount ?? r.comment_count ?? 0,
        }));

        const instList = normalizeList(instRaw).map((r: any) => ({
          id: r.id, title: r.title || 'Без названия', type: 'installation' as const,
          status: getInstallationStage(r), priority: r.priority,
          directionId: r.directionId,
          messageCount: r.chatMessagesCount ?? r.counters?.chatMessages ?? 0,
        }));

        const projList = normalizeList(projRaw).map((r: any) => ({
          id: r.id, title: r.title || 'Без названия', type: 'project' as const,
          status: r.stage || r.status, priority: r.priority, directionId: r.directionId,
          messageCount: r.chatMessagesCount ?? r.counters?.chatMessages ?? 0,
        }));

        setEntities([...srList, ...instList, ...projList]);
        setDirections(normalizeList(dRaw));
        setUsers(normalizeList(uRaw));
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [canManage]);

  const selected = useMemo(
    () => entities.find((e) => e.id === selectedId && e.type === selectedType) ?? null,
    [entities, selectedId, selectedType],
  );

  const loadMessages = async (entity: ChatEntity) => {
    setMessagesLoading(true);
    try {
      if (entity.type === 'service-request') {
        const result = await api.getT<any>(`/service-requests/${entity.id}/comments`);
        const list = Array.isArray(result) ? result : Array.isArray(result?.comments) ? result.comments : [];
        setMessages(list.map((c: any) => ({
          id: c.id, userId: c.userId, authorName: c.authorName, text: c.text, createdAt: c.createdAt,
        })));
      } else {
        const prefix = entity.type === 'installation' ? 'installations' : 'projects';
        const result = await api.getT<any>(`/${prefix}/${entity.id}/chat/messages`);
        const list = normalizeList(result);
        setMessages(list.map((c: any) => ({
          id: c.id, userId: c.userId, authorName: '', text: c.text, createdAt: c.createdAt, isSystem: c.isSystem,
        })));
      }
    } catch {
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  };

  const sendMessage = async () => {
    const text = messageText.trim();
    if (!text || !selected) return;
    setMessageSending(true);
    try {
      if (selected.type === 'service-request') {
        await api.postT(`/service-requests/${selected.id}/comments`, { text });
      } else {
        const prefix = selected.type === 'installation' ? 'installations' : 'projects';
        await api.postT(`/${prefix}/${selected.id}/chat/messages`, {
          text,
          visibility: isClientRole ? 'client-visible' : 'internal',
        });
      }
      setMessageText('');
      await loadMessages(selected);
    } catch { /* ignore */ }
    setMessageSending(false);
  };

  const selectEntity = (entity: ChatEntity) => {
    const params = new URLSearchParams(searchParams);
    params.set('id', entity.id);
    params.set('type', entity.type);
    setSearchParams(params, { replace: true });
  };

  useEffect(() => {
    if (selected) {
      setMessages([]);
      setMessageText('');
      void loadMessages(selected);
    }
  }, [selectedId, selectedType]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Filter: only with messages + search + type
  const filtered = useMemo(() => {
    let list = entities.filter((e) => (e.messageCount ?? 0) > 0);
    if (typeFilter !== 'all') list = list.filter((e) => e.type === typeFilter);
    const term = search.trim().toLowerCase();
    if (term) list = list.filter((e) => (e.title || '').toLowerCase().includes(term) || e.id.toLowerCase().includes(term));
    return list;
  }, [entities, typeFilter, search]);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-3 pt-3 sm:px-6 sm:pt-6">
        <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Чаты' }]} />
      </div>

      <div className="flex min-h-0 flex-1 gap-0">
        {/* Left panel - hidden on mobile when chat is selected */}
        <div className={`flex w-full flex-col border-r border-slate-200 dark:border-slate-800 md:w-80 lg:w-96 md:shrink-0 ${selected ? 'hidden md:flex' : 'flex'}`}>
          {/* Type filter */}
          <div className="shrink-0 flex gap-1 px-3 pt-3 pb-1">
            {TYPE_FILTERS.map((f) => (
              <button key={f.key} type="button" onClick={() => setTypeFilter(f.key)}
                className={[
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition',
                  typeFilter === f.key
                    ? 'bg-red-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700',
                ].join(' ')}>
                {f.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="shrink-0 border-b border-slate-100 p-3 dark:border-slate-800">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-sm text-slate-900 outline-none transition focus:border-red-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-sm text-slate-400">Загрузка...</div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-400">Нет чатов</div>
            ) : (
              filtered.map((e) => {
                const isActive = e.id === selectedId && e.type === selectedType;
                const Icon = TYPE_ICON[e.type] || MessageSquare;
                return (
                  <button key={`${e.type}-${e.id}`} type="button" onClick={() => selectEntity(e)}
                    className={[
                      'flex w-full items-start gap-3 border-b border-slate-50 px-4 py-3.5 text-left transition dark:border-slate-800/50 min-h-[52px]',
                      isActive ? 'bg-red-50 dark:bg-red-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40',
                    ].join(' ')}>
                    <div className="mt-0.5 shrink-0">
                      <Icon size={14} className="text-slate-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center gap-2">
                        <span className={['truncate text-sm font-medium', isActive ? 'text-red-700 dark:text-red-300' : 'text-slate-900 dark:text-slate-100'].join(' ')}>
                          {e.title || 'Без названия'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={['inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold', TYPE_COLOR[e.type] || ''].join(' ')}>
                          {TYPE_LABELS[e.type]}
                        </span>
                        {e.status ? (
                          <span className="text-[10px] text-slate-400">{getEntityStatusLabel(e)}</span>
                        ) : null}
                        {e.directionId && directionNameById[e.directionId] ? (
                          <span className="truncate text-[10px] text-slate-400">{directionNameById[e.directionId]}</span>
                        ) : null}
                      </div>
                      {(e.messageCount ?? 0) > 0 && (
                        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
                          <MessageSquare size={9} />
                          <span>{e.messageCount}</span>
                        </div>
                      )}
                    </div>
                    <div className={['mt-1.5 h-2 w-2 shrink-0 rounded-full', PRIORITY_DOT[e.priority || ''] || 'bg-slate-200'].join(' ')} />
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right panel -- chat */}
        <div className={`flex min-w-0 flex-1 flex-col bg-slate-50 dark:bg-slate-900/50 ${!selected ? 'hidden md:flex' : 'flex'}`}>
          {!selected ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <MessageSquare size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                <p className="text-sm text-slate-400">Выберите чат</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-3 sm:px-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-2 sm:gap-3">
                  <button type="button" onClick={() => { const params = new URLSearchParams(searchParams); params.delete('id'); params.delete('type'); setSearchParams(params, { replace: true }); }}
                    className="flex md:hidden shrink-0 items-center justify-center rounded-lg p-1.5 min-h-[44px] min-w-[44px] text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                    <ChevronLeft size={20} />
                  </button>
                  {(() => { const Icon = TYPE_ICON[selected.type] || MessageSquare; return <Icon size={16} className="shrink-0 text-slate-400" />; })()}
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {selected.title || 'Без названия'}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className={['inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold', TYPE_COLOR[selected.type] || ''].join(' ')}>
                        {TYPE_LABELS[selected.type]}
                      </span>
                      {selected.status ? <span>{getEntityStatusLabel(selected)}</span> : null}
                      {selected.directionId && directionNameById[selected.directionId] ? (
                        <span>{directionNameById[selected.directionId]}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
                {messagesLoading ? (
                  <p className="text-center text-sm text-slate-400">Загрузка...</p>
                ) : messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-sm text-slate-400">Сообщений пока нет</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((m) => (
                      <div key={m.id} className="max-w-[90%] sm:max-w-[75%]">
                        <div className={['rounded-xl px-4 py-2.5 shadow-sm', m.isSystem ? 'bg-slate-100 dark:bg-slate-800/50' : 'bg-white dark:bg-slate-800'].join(' ')}>
                          <div className="mb-1 flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                              {m.authorName || userNameById[m.userId || ''] || (m.userId ? 'Участник' : 'Система')}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {m.createdAt ? new Date(m.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                            </span>
                            {m.isSystem ? <span className="text-[9px] text-slate-400 italic">система</span> : null}
                          </div>
                          <p className="text-sm text-slate-800 dark:text-slate-200">{m.text}</p>
                        </div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-2 sm:px-5 sm:py-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex gap-2">
                  <input type="text" value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
                    placeholder="Написать сообщение..."
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-red-400 focus:bg-white focus:ring-2 focus:ring-red-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 min-h-[44px]" />
                  <button type="button" onClick={() => void sendMessage()}
                    disabled={messageSending || !messageText.trim()}
                    className="inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 min-h-[44px] min-w-[44px] text-white transition hover:bg-red-700 disabled:opacity-50">
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
