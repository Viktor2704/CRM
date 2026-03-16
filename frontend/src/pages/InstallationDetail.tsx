import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@tinymce/tinymce-react';
import DOMPurify from 'dompurify';
import {
  ArrowLeft, Calendar, CheckCircle2, ChevronRight, Clock, FileText,
  MessageSquare, Settings, ShoppingCart, Users, AlertTriangle, Pause,
  History, Edit3, Save, XCircle, X, Send,
} from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { usePermissions } from '@/hooks/usePermissions';
import type { Tenant, User } from '@/types';
import DeadlinesTab from '@/pages/installation/DeadlinesTab';
import ProcurementTab from '@/pages/installation/ProcurementTab';
import FilesTab from '@/pages/installation/FilesTab';
import ChatTab from '@/pages/installation/ChatTab';
import HistoryTab from '@/pages/installation/HistoryTab';
import {
  getInstallationStage,
  getInstallationStageProgressPercent,
  INSTALLATION_CANCEL_REASON_LABELS,
  INSTALLATION_CANCEL_REASONS,
  INSTALLATION_STAGE_BADGE_CLASSES as STAGE_BADGE,
  INSTALLATION_STAGE_FLOW_ORDER as STAGE_ORDER,
  INSTALLATION_STAGE_LABELS as STAGE_LABELS,
  INSTALLATION_STAGE_PROGRESS_CLASSES as STAGE_COLORS,
  INSTALLATION_STAGE_TRANSITIONS,
} from '@/pages/installation/meta';

// ── Types ────────────────────────────────────────────────────────────

type Installation = {
  id: string;
  title?: string;
  description?: string;
  tenantId?: string;
  status?: string;
  priority?: string;
  executorIds?: string[];
  responsibleIds?: string[];
  dueDatePreliminary?: string | null;
  isOverdue?: boolean;
  installationStage?: string;
  stage?: string;
  cancelReason?: string;
  createdAt?: string;
  updatedAt?: string;
  creatorId?: string;
  files?: { id?: string; name?: string; url?: string; type?: string; size?: string }[];
  stageDeadlines?: Record<string, string>;
  procurementSummary?: {
    total?: number;
    needed?: number;
    ordered?: number;
    received?: number;
    allReceived?: boolean;
  };
  pausedFromStage?: string | null;
  overdueStages?: string[];
  counters?: {
    events?: number;
    chatMessages?: number;
    procurementItems?: number;
    files?: number;
  };
};

type StageDeadline = {
  stage: string;
  dueDate: string;
};

type ProcurementItem = {
  id: string;
  installationId: string;
  name: string;
  quantity: number;
  unit: string;
  comment: string;
  link: string;
  status: string;
  responsibleUserId: string | null;
  files?: Array<{ id?: string; name?: string; url?: string; type?: string; size?: string }>;
  createdAt: string;
  updatedAt: string;
};

type ChatMessage = {
  id: string;
  userId?: string;
  text?: string;
  visibility?: string;
  attachments?: { id: string; name: string; url?: string }[];
  isPinned?: boolean;
  createdAt?: string;
  isSystem?: boolean;
};

type EventRow = {
  id: string;
  eventType?: string;
  description?: string;
  userId?: string;
  actorUserId?: string;
  createdAt?: string;
  meta?: Record<string, unknown>;
  payload?: Record<string, unknown>;
};

type ListResponse<T> = T[] | { items?: T[]; data?: T[] };

const normalizeList = <T,>(v: ListResponse<T>): T[] => {
  if (Array.isArray(v)) return v;
  if (Array.isArray((v as { items?: T[] }).items)) return (v as { items: T[] }).items;
  if (Array.isArray((v as { data?: T[] }).data)) return (v as { data: T[] }).data;
  return [];
};

const mapInstallationFiles = (data: Installation) => (data.files || []).map((f, i) => ({
  id: f.id || `file-${i}`,
  name: f.name || 'Файл',
  url: f.url,
  createdAt: undefined as string | undefined,
  userId: undefined as string | undefined,
}));

const mapStageDeadlineRecord = (data: Installation): StageDeadline[] => {
  if (!data.stageDeadlines || typeof data.stageDeadlines !== 'object') return [];
  return Object.entries(data.stageDeadlines)
    .filter(([stage, dueDate]) => Boolean(stage) && Boolean(dueDate))
    .map(([stage, dueDate]) => ({ stage, dueDate }));
};

const getInstallationCounter = (data: Installation | null | undefined, key: 'events' | 'chatMessages' | 'procurementItems' | 'files', fallback = 0) =>
  Number(data?.counters?.[key] ?? fallback ?? 0);

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Критический',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};

const PRIORITY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  low: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300',
};

const TABS = [
  { key: 'overview', label: 'Обзор', icon: Settings },
  { key: 'deadlines', label: 'Сроки', icon: Calendar },
  { key: 'procurement', label: 'Закупка', icon: ShoppingCart },
  { key: 'files', label: 'Файлы', icon: FileText },
  { key: 'chat', label: 'Чат', icon: MessageSquare },
  { key: 'history', label: 'История', icon: History },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function InstallationDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <InstallationDetailInner installationId={id} />;
}

export function InstallationDetailModal({ installationId, onClose }: { installationId: string; onClose: () => void }) {
  const toast = useToast();
  const { canManage } = usePermissions();

  const [tab, setTab] = useState<TabKey>('overview');
  const [loading, setLoading] = useState(true);
  const [inst, setInst] = useState<Installation | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [deadlines, setDeadlines] = useState<StageDeadline[]>([]);
  const [procurement, setProcurement] = useState<ProcurementItem[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [pinnedChatMessages, setPinnedChatMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [files, setFiles] = useState<{ id: string; name: string; url?: string; createdAt?: string; userId?: string }[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [chatSending, setChatSending] = useState(false);

  const tenantNameById = useMemo(() => {
    const m: Record<string, string> = {};
    tenants.forEach((t) => { m[t.id] = t.brandName || t.name || t.id; });
    return m;
  }, [tenants]);

  const userNameById = useMemo(() => {
    const m: Record<string, string> = {};
    users.forEach((u) => { m[u.id] = u.fullName || u.email || u.id; });
    return m;
  }, [users]);

  const _resolveTenantLabel = (tenantId?: string) => {
    if (!tenantId) return '-';
    return tenantNameById[tenantId] || (canManage ? tenantId : 'Компания монтажа');
  };

  const loadInstallation = useCallback(async () => {
    try {
      const data = await api.getT<Installation>(`/installations/${installationId}/extended`);
      setInst(data);
      setFiles(mapInstallationFiles(data));
      const extendedDeadlines = mapStageDeadlineRecord(data);
      if (extendedDeadlines.length > 0) {
        setDeadlines(extendedDeadlines);
      }
    } catch { toast.error('Не удалось загрузить монтаж'); }
  }, [installationId, toast]);

  const loadDeadlines = useCallback(async () => {
    try { const d = await api.getT<ListResponse<StageDeadline>>(`/installations/${installationId}/stage-deadlines`); setDeadlines(normalizeList(d)); } catch {}
  }, [installationId]);
  const loadProcurement = useCallback(async () => {
    try { const d = await api.getT<ListResponse<ProcurementItem>>(`/installations/${installationId}/procurement`); setProcurement(normalizeList(d)); } catch {}
  }, [installationId]);
  const loadChat = useCallback(async () => {
    try {
      const [messagesRaw, pinnedRaw] = await Promise.all([
        api.getT<ListResponse<ChatMessage>>(`/installations/${installationId}/chat/messages`),
        api.getT<ListResponse<ChatMessage>>(`/installations/${installationId}/chat/pinned`).catch(() => ({ items: [] as ChatMessage[] })),
      ]);
      setChatMessages(normalizeList(messagesRaw));
      setPinnedChatMessages(normalizeList(pinnedRaw));
    } catch {}
  }, [installationId]);
  const loadEvents = useCallback(async () => {
    try { const d = await api.getT<ListResponse<EventRow>>(`/installations/${installationId}/events`); setEvents(normalizeList(d)); } catch {}
  }, [installationId]);
  const loadFiles = useCallback(async () => {
    try {
      const data = await api.getT<Installation>(`/installations/${installationId}/extended`);
      setFiles(mapInstallationFiles(data));
    } catch {}
  }, [installationId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      loadInstallation(),
      canManage
        ? api.getT<ListResponse<Tenant>>('/tenants').then((d) => setTenants(normalizeList(d))).catch(() => {})
        : Promise.resolve(),
      canManage
        ? api.getT<ListResponse<User>>('/users').then((d) => setUsers(normalizeList(d))).catch(() => {})
        : Promise.resolve(),
      loadDeadlines(), loadProcurement(), loadChat(), loadEvents(),
    ]).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadInstallation, loadDeadlines, loadProcurement, loadChat, loadEvents, canManage]);

  const sendChat = async () => {
    const trimmed = chatText.trim();
    if (!trimmed) return;
    setChatSending(true);
    try {
      await api.postT(`/installations/${installationId}/chat/messages`, { text: trimmed, visibility: 'internal' });
      setChatText('');
      await loadChat();
    } catch { toast.error('Не удалось отправить'); }
    finally { setChatSending(false); }
  };

  if (!inst && !loading) return null;

  const stage = getInstallationStage(inst);
  const progressPct = getInstallationStageProgressPercent(stage);
  const chatCount = getInstallationCounter(inst, 'chatMessages', chatMessages.length);
  const procurementCount = getInstallationCounter(inst, 'procurementItems', procurement.length);
  const fileCount = getInstallationCounter(inst, 'files', files.length);
  const eventCount = getInstallationCounter(inst, 'events', events.length);

  const MODAL_TABS = [
    { key: 'overview' as TabKey, label: 'Обзор', icon: Settings },
    { key: 'deadlines' as TabKey, label: 'Сроки', icon: Calendar },
    { key: 'procurement' as TabKey, label: 'Закупка', icon: ShoppingCart, count: procurementCount },
    { key: 'files' as TabKey, label: 'Файлы', icon: FileText, count: fileCount },
    { key: 'history' as TabKey, label: 'История', icon: History, count: eventCount },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 w-full h-full sm:h-auto sm:w-[calc(100%-2rem)] sm:max-w-5xl sm:max-h-[96vh] sm:min-h-[80vh] sm:rounded-2xl">

        {/* Progress bar */}
        <div className="h-1 bg-slate-100 dark:bg-slate-800">
          <div className={`h-full transition-all duration-700 ease-out ${STAGE_COLORS[stage] || 'bg-slate-400'}`} style={{ width: `${progressPct}%` }} />
        </div>

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 sm:px-5 py-3 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2.5 min-w-0">
            {loading ? (
              <div className="h-5 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            ) : (
              <>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate max-w-[120px] sm:max-w-[300px]">{inst?.title || 'Монтаж'}</h3>
                <span className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${STAGE_BADGE[stage] || 'bg-slate-100 text-slate-600'}`}>
                  {STAGE_LABELS[stage] || stage}
                </span>
                <span className={`shrink-0 hidden sm:inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_BADGE[inst?.priority || ''] || 'bg-slate-100 text-slate-600'}`}>
                  {PRIORITY_LABELS[inst?.priority || ''] || '-'}
                </span>
                {inst?.isOverdue ? (
                  <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                    <AlertTriangle size={10} /> Просрочено
                  </span>
                ) : null}
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setChatOpen((p) => !p)} title="Чат"
              className={['rounded-xl p-2 min-w-[44px] min-h-[44px] flex items-center justify-center transition', chatOpen ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800'].join(' ')}>
              <MessageSquare size={18} />
              {chatCount > 0 ? <span className="ml-0.5 text-[10px] font-bold">{chatCount}</span> : null}
            </button>
            <button type="button" onClick={onClose}
              className="rounded-xl p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 gap-0.5 border-b border-slate-100 px-3 sm:px-5 dark:border-slate-800 overflow-x-auto">
          {MODAL_TABS.map((t) => {
            const Icon = t.icon;
            const isActive = tab === t.key;
            return (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className={[
                  'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors',
                  isActive ? 'border-red-600 text-red-600 dark:border-red-500 dark:text-red-400' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                ].join(' ')}>
                <Icon size={14} />
                {t.label}
                {t.count ? <span className="ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-slate-100 px-1 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-400">{t.count}</span> : null}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* Main content */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-5">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-7 w-7 animate-spin rounded-full border-4 border-red-600 border-t-transparent" />
              </div>
            ) : inst ? (
              <>
                {tab === 'overview' && (
                  <OverviewTab inst={inst} canManage={canManage} userNameById={userNameById} tenantNameById={tenantNameById} users={users} tenants={tenants} onReload={loadInstallation} toast={toast} />
                )}
                {tab === 'deadlines' && (
                  <DeadlinesTab instId={inst.id} deadlines={deadlines} canManage={canManage} onReload={loadDeadlines} toast={toast} />
                )}
                {tab === 'procurement' && (
                  <ProcurementTab instId={inst.id} items={procurement} canManage={canManage} users={users} userNameById={userNameById} onReload={loadProcurement} toast={toast} />
                )}
                {tab === 'files' && (
                  <FilesTab instId={inst.id} files={files} canManage={canManage} userNameById={userNameById} onReload={loadFiles} toast={toast} />
                )}
                {tab === 'history' && (
                  <HistoryTab events={events} userNameById={userNameById} />
                )}
              </>
            ) : (
              <p className="text-center text-slate-400 py-12">Монтаж не найден</p>
            )}
          </div>

          {/* Chat panel */}
          {chatOpen && (
            <div className="absolute inset-0 z-10 flex flex-col bg-slate-50 dark:bg-slate-900 sm:static sm:inset-auto sm:z-auto sm:w-72 sm:shrink-0 sm:border-l sm:border-slate-100 sm:bg-slate-50/50 sm:dark:border-slate-800 sm:dark:bg-slate-900/50 lg:w-80">
              <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
                <div className="flex items-center gap-1.5">
                  <MessageSquare size={14} className="text-slate-400" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Чат</span>
                  <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-400">{chatCount}</span>
                </div>
                <button type="button" onClick={() => setChatOpen(false)} className="rounded-lg p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600"><X size={14} /></button>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-2">
                {chatMessages.length === 0 && pinnedChatMessages.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <MessageSquare size={24} className="mx-auto mb-1.5 text-slate-300 dark:text-slate-600" />
                      <p className="text-[11px] text-slate-400">Начните диалог</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(pinnedChatMessages.length > 0 ? pinnedChatMessages : chatMessages.filter((item) => item.isPinned)).length > 0 ? (
                      <div className="mb-2 space-y-1 rounded-lg border border-amber-100 bg-amber-50/60 p-2 dark:border-amber-900/30 dark:bg-amber-950/10">
                        {(pinnedChatMessages.length > 0 ? pinnedChatMessages : chatMessages.filter((item) => item.isPinned)).map((pinned) => (
                          <div key={`pinned-${pinned.id}`} className="flex items-start gap-1.5">
                            <span className="mt-0.5 text-[10px] text-amber-500">•</span>
                            <p className="line-clamp-2 text-[11px] text-amber-900 dark:text-amber-300">{pinned.text}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {chatMessages.map((c) => (
                      <div key={c.id} className="rounded-lg bg-white px-3 py-2 shadow-sm dark:bg-slate-800">
                        <div className="mb-0.5 flex items-center gap-1.5">
                          <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">{userNameById[c.userId || ''] || 'Система'}</span>
                          <span className="text-[10px] text-slate-400">{c.createdAt ? new Date(c.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                          {c.isSystem ? <span className="text-[9px] text-slate-400 italic">система</span> : null}
                        </div>
                        <p className="text-xs leading-relaxed text-slate-800 dark:text-slate-200">{c.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {canManage && (
                <div className="shrink-0 border-t border-slate-100 p-2.5 dark:border-slate-800">
                  <div className="flex gap-1.5">
                    <input value={chatText} onChange={(e) => setChatText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChat(); } }}
                      placeholder="Сообщение..."
                      className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-red-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                    <button type="button" onClick={() => void sendChat()} disabled={chatSending || !chatText.trim()}
                      className="rounded-lg bg-red-600 p-1.5 text-white transition hover:bg-red-700 disabled:opacity-50">
                      <Send size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Overview Tab ─────────────────────────────────────────────────────

function OverviewTab({ inst, canManage, userNameById, tenantNameById, users, tenants, onReload, toast }: {
  inst: Installation; canManage: boolean; userNameById: Record<string, string>; tenantNameById: Record<string, string>;
  users: User[]; tenants: Tenant[]; onReload: () => Promise<void>; toast: ReturnType<typeof useToast>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    title: inst.title || '',
    description: inst.description || '',
    tenantId: inst.tenantId || '',
    priority: inst.priority || 'medium',
    executorIds: inst.executorIds || [],
    dueDatePreliminary: (inst.dueDatePreliminary || '').slice(0, 10),
  });
  const [saving, setSaving] = useState(false);
  const [stageChanging, setStageChanging] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [nextStageTarget, setNextStageTarget] = useState('');

  const stage = getInstallationStage(inst);
  const procurementSummary = inst.procurementSummary || {};
  const overdueStages = Array.isArray(inst.overdueStages) ? inst.overdueStages : [];
  const counterRows = [
    { label: 'События', value: getInstallationCounter(inst, 'events') },
    { label: 'Сообщения', value: getInstallationCounter(inst, 'chatMessages') },
    { label: 'Файлы', value: getInstallationCounter(inst, 'files') },
    { label: 'Позиции закупки', value: getInstallationCounter(inst, 'procurementItems') },
  ];

  const resolveTenantLabel = (tenantId?: string) => {
    if (!tenantId) return '-';
    return tenantNameById[tenantId] || (canManage ? tenantId : 'Компания монтажа');
  };

  const resolveUserLabel = (userId?: string) => {
    if (!userId) return '-';
    return userNameById[userId] || (canManage ? userId : 'Сотрудник');
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await api.patchT(`/installations/${inst.id}`, {
        title: form.title,
        description: form.description,
        tenantId: form.tenantId || null,
        priority: form.priority,
        executorIds: form.executorIds,
        dueDatePreliminary: form.dueDatePreliminary || null,
      });
      toast.success('Сохранено');
      setEditing(false);
      await onReload();
    } catch {
      toast.error('Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const changeStage = async (newStage: string, reason?: string) => {
    setStageChanging(true);
    try {
      await api.patchT(`/installations/${inst.id}/installation-stage`, {
        stage: newStage,
        ...(reason ? { reason } : {}),
        ...(newStage === 'cancelled' ? { cancelReason: reason || 'other' } : {}),
        ...(newStage === 'paused' ? { pauseReason: reason || 'Пауза' } : {}),
      });
      toast.success(`Этап изменён: ${STAGE_LABELS[newStage] || newStage}`);
      await onReload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка';
      if (msg.includes('procurement') || msg.includes('PROCUREMENT')) {
        setNextStageTarget(newStage);
        setOverrideOpen(true);
      } else {
        toast.error(msg);
      }
    } finally {
      setStageChanging(false);
    }
  };

  const onOverrideConfirm = async () => {
    setOverrideOpen(false);
    setStageChanging(true);
    try {
      await api.patchT(`/installations/${inst.id}/installation-stage`, {
        stage: nextStageTarget,
        overrideReason: overrideReason,
      });
      toast.success('Этап изменён (override)');
      await onReload();
    } catch {
      toast.error('Не удалось изменить этап');
    } finally {
      setStageChanging(false);
      setOverrideReason('');
    }
  };

  const onCancel = async () => {
    setCancelOpen(false);
    setStageChanging(true);
    try {
      await api.patchT(`/installations/${inst.id}/installation-stage`, {
        stage: 'cancelled',
        cancelReason: cancelReason || 'other',
      });
      toast.success('Монтаж отменён');
      await onReload();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Не удалось отменить');
    } finally {
      setStageChanging(false);
      setCancelReason('');
    }
  };

  const nextStages = INSTALLATION_STAGE_TRANSITIONS[stage] || [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Left: description + details */}
      <div className="lg:col-span-2 space-y-6">
        {/* Description card */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Описание</h3>
            {canManage && !editing ? (
              <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 sm:px-3">
                <Edit3 size={14} /> <span className="hidden xs:inline">Редактировать</span>
              </button>
            ) : null}
          </div>

          {editing ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Название</label>
                <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-red-500 transition focus:border-red-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Описание</label>
                <Editor
                  licenseKey="gpl"
                  tinymceScriptSrc="/tinymce/tinymce.min.js"
                  value={form.description}
                  onEditorChange={(content) => setForm((p) => ({ ...p, description: content }))}
                  init={{
                    height: 200,
                    menubar: false,
                    plugins: 'lists table link autolink',
                    toolbar: 'bold italic underline | bullist numlist | table link | removeformat',
                    content_style: 'body { font-family: Arial, sans-serif; font-size: 14px; }',
                    branding: false,
                    statusbar: false,
                  }}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Контрагент</label>
                  <select value={form.tenantId} onChange={(e) => setForm((p) => ({ ...p, tenantId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-red-500 transition focus:border-red-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                    <option value="">Не выбрано</option>
                    {tenants.map((t) => <option key={t.id} value={t.id}>{t.brandName || t.name || t.id}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Приоритет</label>
                  <select value={form.priority} onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-red-500 transition focus:border-red-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                    {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Исполнители</label>
                <select multiple value={form.executorIds} onChange={(e) => setForm((p) => ({ ...p, executorIds: Array.from(e.target.selectedOptions).map((o) => o.value) }))}
                  className="h-28 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-red-500 transition focus:border-red-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                  {users.map((u) => <option key={u.id} value={u.id}>{u.fullName || u.email || u.id}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Предварительный дедлайн</label>
                <input type="date" value={form.dueDatePreliminary} onChange={(e) => setForm((p) => ({ ...p, dueDatePreliminary: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-red-500 transition focus:border-red-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={saving} onClick={onSave}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60">
                  <Save size={14} /> {saving ? 'Сохранение...' : 'Сохранить'}
                </button>
                <button type="button" onClick={() => setEditing(false)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <div className="prose prose-slate dark:prose-invert max-w-none text-sm">
              {inst.description ? (
                <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(inst.description) }} />
              ) : (
                <p className="text-slate-400 italic">Описание не заполнено</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar: stage actions */}
      <div className="space-y-6">
        {/* Stage change card */}
        {canManage && nextStages.length > 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Управление этапом</h4>
            <div className="flex flex-col gap-2">
              {nextStages.filter((s) => s !== 'paused' && s !== 'cancelled').map((s) => (
                <button key={s} type="button" disabled={stageChanging} onClick={() => changeStage(s)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 disabled:opacity-60 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
                  <ChevronRight size={14} />
                  {STAGE_LABELS[s] || s}
                </button>
              ))}
              {nextStages.includes('paused') ? (
                <button type="button" disabled={stageChanging} onClick={() => changeStage('paused')}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
                  <Pause size={14} /> На паузу
                </button>
              ) : null}
              {nextStages.includes('cancelled') ? (
                <button type="button" onClick={() => setCancelOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-950/30">
                  <XCircle size={14} /> Отменить
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Info + Executors — vertical card */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-500 dark:text-slate-400">Создатель</span>
              <span className="font-medium text-slate-800 dark:text-slate-200 truncate ml-3">{resolveUserLabel(inst.creatorId)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-500 dark:text-slate-400">Контрагент</span>
              <span className="font-medium text-slate-800 dark:text-slate-200 truncate ml-3">{resolveTenantLabel(inst.tenantId)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-500 dark:text-slate-400">Приоритет</span>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_BADGE[inst.priority || ''] || ''}`}>{PRIORITY_LABELS[inst.priority || ''] || '-'}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-500 dark:text-slate-400">Дедлайн</span>
              {canManage ? (
                <input type="date" value={(inst.dueDatePreliminary || '').slice(0, 10)}
                  onChange={async (e) => {
                    const val = e.target.value || null;
                    try {
                      await api.patchT(`/installations/${inst.id}`, { dueDatePreliminary: val });
                      toast.success('Дедлайн обновлён');
                      await onReload();
                    } catch { toast.error('Не удалось обновить'); }
                  }}
                  className="bg-transparent text-xs font-medium text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 cursor-pointer hover:border-red-400 focus:border-red-500 focus:outline-none" />
              ) : (
                <span className="font-medium text-slate-800 dark:text-slate-200">{inst.dueDatePreliminary ? new Date(inst.dueDatePreliminary).toLocaleDateString('ru-RU') : '-'}</span>
              )}
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-500 dark:text-slate-400">Создан</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">{inst.createdAt ? new Date(inst.createdAt).toLocaleDateString('ru-RU') : '-'}</span>
            </div>
            <div className="px-4 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-slate-500 dark:text-slate-400">Исполнители</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {(inst.executorIds || []).length > 0 ? (inst.executorIds || []).map((eid, i) => (
                  <span key={eid} className="inline-flex items-center gap-1 rounded-full bg-slate-100 pl-0.5 pr-2 py-0.5 dark:bg-slate-800" title={resolveUserLabel(eid)}>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-[10px] font-bold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                      {resolveUserLabel(eid)[0]?.toUpperCase() || '?'}
                    </span>
                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">{resolveUserLabel(eid).split(' ')[0]}</span>
                    {i === 0 ? <span className="text-[9px] text-amber-500">★</span> : null}
                  </span>
                )) : <span className="text-[11px] text-amber-600 dark:text-amber-400">Не назначены</span>}
              </div>
            </div>
            <div className="px-4 py-2.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Счетчики</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {counterRows.map((row) => (
                  <div key={row.label} className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/80">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">{row.label}</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-800 dark:text-slate-100">{row.value}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-4 py-2.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Закупка</span>
                {procurementSummary.allReceived ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300">
                    Все получено
                  </span>
                ) : null}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/80">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Нужно</div>
                  <div className="mt-0.5 text-sm font-semibold text-slate-800 dark:text-slate-100">{Number(procurementSummary.needed ?? 0)}</div>
                </div>
                <div className="rounded-lg bg-amber-50 px-2 py-1.5 dark:bg-amber-950/20">
                  <div className="text-[10px] uppercase tracking-wide text-amber-500">Заказано</div>
                  <div className="mt-0.5 text-sm font-semibold text-amber-800 dark:text-amber-300">{Number(procurementSummary.ordered ?? 0)}</div>
                </div>
                <div className="rounded-lg bg-green-50 px-2 py-1.5 dark:bg-green-950/20">
                  <div className="text-[10px] uppercase tracking-wide text-green-500">Получено</div>
                  <div className="mt-0.5 text-sm font-semibold text-green-800 dark:text-green-300">{Number(procurementSummary.received ?? 0)}</div>
                </div>
              </div>
            </div>
          </div>
          {inst.pausedFromStage ? (
            <div className="border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
              <div className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <span className="font-semibold">Пауза с этапа:</span> {STAGE_LABELS[inst.pausedFromStage] || inst.pausedFromStage}
              </div>
            </div>
          ) : null}
          {overdueStages.length > 0 ? (
            <div className="border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
              <div className="mb-1.5 text-xs text-slate-500 dark:text-slate-400">Просроченные этапы</div>
              <div className="flex flex-wrap gap-1.5">
                {overdueStages.map((value) => (
                  <span key={value} className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">
                    <AlertTriangle size={10} />
                    {STAGE_LABELS[value] || value}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {inst.cancelReason ? (
            <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-2.5">
              <div className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400">
                <span className="font-semibold">Причина отмены:</span> {INSTALLATION_CANCEL_REASON_LABELS[inst.cancelReason] || inst.cancelReason}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Cancel dialog */}
      {cancelOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setCancelOpen(false)} />
          <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">Отмена монтажа</h3>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Причина отмены</label>
            <select value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-red-500 transition focus:border-red-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 mb-4">
              <option value="">Выберите причину</option>
              {INSTALLATION_CANCEL_REASONS.map((value) => (
                <option key={value} value={value}>
                  {INSTALLATION_CANCEL_REASON_LABELS[value] || value}
                </option>
              ))}
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setCancelOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                Назад
              </button>
              <button type="button" disabled={!cancelReason} onClick={onCancel}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                Отменить монтаж
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Override procurement dialog */}
      {overrideOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setOverrideOpen(false)} />
          <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">Закупка не завершена</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">Не все позиции закупки получены. Укажите причину для перехода.</p>
            <textarea rows={3} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Причина..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-red-500 transition focus:border-red-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 mb-4" />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setOverrideOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                Назад
              </button>
              <button type="button" disabled={!overrideReason.trim()} onClick={onOverrideConfirm}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60">
                Продолжить
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InstallationDetailInner({ installationId, isModal, onClose }: { installationId?: string; isModal?: boolean; onClose?: () => void }) {
  const id = installationId;
  const navigate = useNavigate();
  const toast = useToast();
  const { canManage } = usePermissions();

  const [tab, setTab] = useState<TabKey>('overview');
  const [loading, setLoading] = useState(true);
  const [inst, setInst] = useState<Installation | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [deadlines, setDeadlines] = useState<StageDeadline[]>([]);
  const [procurement, setProcurement] = useState<ProcurementItem[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [pinnedChatMessages, setPinnedChatMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [files, setFiles] = useState<{ id: string; name: string; url?: string; createdAt?: string; userId?: string }[]>([]);

  const tenantNameById = useMemo(() => {
    const m: Record<string, string> = {};
    tenants.forEach((t) => { m[t.id] = t.brandName || t.name || t.id; });
    return m;
  }, [tenants]);

  const userNameById = useMemo(() => {
    const m: Record<string, string> = {};
    users.forEach((u) => { m[u.id] = u.fullName || u.email || u.id; });
    return m;
  }, [users]);

  const resolveTenantLabel = (tenantId?: string) => {
    if (!tenantId) return '';
    return tenantNameById[tenantId] || (canManage ? tenantId : 'Компания монтажа');
  };

  const resolveExecutorSummary = (executorIds?: string[]) => {
    if (!Array.isArray(executorIds) || executorIds.length === 0) return 'Не назначены';
    if (canManage) {
      return executorIds.map((eid) => userNameById[eid] || eid).join(', ');
    }
    return executorIds.length === 1 ? 'Назначенный исполнитель' : `Исполнители: ${executorIds.length}`;
  };

  const goBack = useCallback(() => {
    if (isModal && onClose) onClose();
    else navigate('/installations');
  }, [isModal, onClose, navigate]);

  const loadInstallation = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getT<Installation>(`/installations/${id}/extended`);
      setInst(data);
      setFiles(mapInstallationFiles(data));
      const extendedDeadlines = mapStageDeadlineRecord(data);
      if (extendedDeadlines.length > 0) {
        setDeadlines(extendedDeadlines);
      }
    } catch {
      toast.error('Не удалось загрузить монтаж');
      goBack();
    }
  }, [id, toast, goBack]);

  const loadDeadlines = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getT<ListResponse<StageDeadline>>(`/installations/${id}/stage-deadlines`);
      setDeadlines(normalizeList(data));
    } catch { /* ignore */ }
  }, [id]);

  const loadProcurement = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getT<ListResponse<ProcurementItem>>(`/installations/${id}/procurement`);
      setProcurement(normalizeList(data));
    } catch { /* ignore */ }
  }, [id]);

  const loadChat = useCallback(async () => {
    if (!id) return;
    try {
      const [messagesRaw, pinnedRaw] = await Promise.all([
        api.getT<ListResponse<ChatMessage>>(`/installations/${id}/chat/messages`),
        api.getT<ListResponse<ChatMessage>>(`/installations/${id}/chat/pinned`).catch(() => ({ items: [] as ChatMessage[] })),
      ]);
      setChatMessages(normalizeList(messagesRaw));
      setPinnedChatMessages(normalizeList(pinnedRaw));
    } catch { /* ignore */ }
  }, [id]);

  const loadEvents = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getT<ListResponse<EventRow>>(`/installations/${id}/events`);
      setEvents(normalizeList(data));
    } catch { /* ignore */ }
  }, [id]);

  const loadFiles = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getT<Installation>(`/installations/${id}/extended`);
      setFiles(mapInstallationFiles(data));
    } catch { /* ignore */ }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      loadInstallation(),
      canManage
        ? api.getT<ListResponse<Tenant>>('/tenants').then((d) => setTenants(normalizeList(d))).catch(() => {})
        : Promise.resolve(),
      canManage
        ? api.getT<ListResponse<User>>('/users').then((d) => setUsers(normalizeList(d))).catch(() => {})
        : Promise.resolve(),
      loadDeadlines(),
      loadProcurement(),
      loadChat(),
      loadEvents(),
    ]).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadInstallation, loadDeadlines, loadProcurement, loadChat, loadEvents, canManage]);

  const stage = getInstallationStage(inst);
  const stageIdx = STAGE_ORDER.indexOf(stage);
  const progressPct = getInstallationStageProgressPercent(stage);
  const chatCount = getInstallationCounter(inst, 'chatMessages', chatMessages.length);
  const procurementCount = getInstallationCounter(inst, 'procurementItems', procurement.length);
  const fileCount = getInstallationCounter(inst, 'files', files.length);
  const eventCount = getInstallationCounter(inst, 'events', events.length);

  if (loading) {
    return (
      <div className="space-y-6">
        {!isModal && <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Монтажи', to: '/installations' }, { label: '...' }]} />}
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-red-600 border-t-transparent" />
        </div>
      </div>
    );
  }

  if (!inst) {
    return (
      <div className="space-y-6">
        {!isModal && <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Монтажи', to: '/installations' }, { label: 'Не найден' }]} />}
        <p className="text-center text-slate-500 py-20">Монтаж не найден</p>
      </div>
    );
  }

  return (
    <div className={isModal ? 'space-y-3 p-4' : 'space-y-6'}>
      {/* Breadcrumbs */}
      {!isModal && <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Монтажи', to: '/installations' }, { label: inst.title || inst.id }]} />}

      {/* Header card */}
      <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden`}>
        {/* Progress bar */}
        <div className="h-1 bg-slate-100 dark:bg-slate-800">
          <div
            className={`h-full transition-all duration-700 ease-out ${STAGE_COLORS[stage] || 'bg-slate-400'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <div className={isModal ? 'px-4 py-3' : 'p-6'}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                {!isModal && (
                  <button type="button" onClick={() => goBack()}
                    className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                    <ArrowLeft size={20} />
                  </button>
                )}
                <h1 className={`${isModal ? 'text-lg' : 'text-2xl'} font-bold text-slate-900 dark:text-slate-100 truncate`}>
                  {inst.title || 'Без названия'}
                </h1>
                {inst.isOverdue ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                    <AlertTriangle size={10} /> Просрочено
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${STAGE_BADGE[stage] || 'bg-slate-100 text-slate-600'}`}>
                  {STAGE_LABELS[stage] || stage}
                </span>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_BADGE[inst.priority || ''] || 'bg-slate-100 text-slate-600'}`}>
                  {PRIORITY_LABELS[inst.priority || ''] || inst.priority || '-'}
                </span>
                {inst.tenantId ? (
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {resolveTenantLabel(inst.tenantId)}
                  </span>
                ) : null}
                <span className="text-[10px] text-slate-400 ml-1">
                  <Users size={11} className="inline mr-0.5" />
                  {(inst.executorIds || []).length > 0 ? resolveExecutorSummary(inst.executorIds) : <span className="text-amber-500">Не назначены</span>}
                </span>
                {inst.dueDatePreliminary ? (
                  <span className="text-[10px] text-slate-400 ml-1">
                    <Clock size={11} className="inline mr-0.5" />{String(inst.dueDatePreliminary).slice(0, 10)}
                  </span>
                ) : null}
              </div>
            </div>

            {isModal && (
              <button type="button" onClick={() => goBack()}
                className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                <XCircle size={20} />
              </button>
            )}
          </div>

          {/* Stage pipeline */}
          <div className={`${isModal ? 'mt-3' : 'mt-6'} hidden sm:flex items-center gap-0.5`}>
            {STAGE_ORDER.map((s, i) => {
              const isCurrent = s === stage;
              const isPast = stageIdx >= 0 && i < stageIdx;
              const isFuture = stageIdx >= 0 && i > stageIdx;
              return (
                <div key={s} className="flex items-center gap-0.5 flex-1">
                  <div className={[
                    'flex-1 flex items-center justify-center rounded-md px-1.5 py-1 text-[10px] font-medium transition-all',
                    isCurrent ? `${STAGE_COLORS[s]} text-white shadow-sm` : '',
                    isPast ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : '',
                    isFuture ? 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500' : '',
                  ].join(' ')}>
                    {isPast ? <CheckCircle2 size={10} className="mr-0.5 shrink-0" /> : null}
                    <span className="truncate">{STAGE_LABELS[s] || s}</span>
                  </div>
                  {i < STAGE_ORDER.length - 1 ? <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 shrink-0" /> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <nav className="-mb-px flex gap-0.5 overflow-x-auto px-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={[
                  `inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 ${isModal ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'} font-medium transition-colors`,
                  isActive
                    ? 'border-red-600 text-red-600 dark:border-red-500 dark:text-red-400'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                ].join(' ')}
              >
                <Icon size={isModal ? 14 : 16} />
                {t.label}
                {t.key === 'procurement' && procurementCount > 0 ? (
                  <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-purple-100 px-1.5 text-xs font-semibold text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                    {procurementCount}
                  </span>
                ) : null}
                {t.key === 'chat' && chatCount > 0 ? (
                  <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-blue-100 px-1.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    {chatCount}
                  </span>
                ) : null}
                {t.key === 'files' && fileCount > 0 ? (
                  <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-slate-100 px-1.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {fileCount}
                  </span>
                ) : null}
                {t.key === 'history' && eventCount > 0 ? (
                  <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-slate-100 px-1.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {eventCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      <div className={isModal ? 'min-h-[200px]' : 'min-h-[400px]'}>
        {tab === 'overview' && (
          <OverviewTab inst={inst} canManage={canManage} userNameById={userNameById} tenantNameById={tenantNameById} users={users} tenants={tenants} onReload={loadInstallation} toast={toast} />
        )}
        {tab === 'deadlines' && (
          <DeadlinesTab instId={inst.id} deadlines={deadlines} canManage={canManage} onReload={loadDeadlines} toast={toast} />
        )}
        {tab === 'procurement' && (
          <ProcurementTab instId={inst.id} items={procurement} canManage={canManage} users={users} userNameById={userNameById} onReload={loadProcurement} toast={toast} />
        )}
        {tab === 'files' && (
          <FilesTab instId={inst.id} files={files} canManage={canManage} userNameById={userNameById} onReload={loadFiles} toast={toast} />
        )}
        {tab === 'chat' && (
          <ChatTab instId={inst.id} messages={chatMessages} pinnedMessages={pinnedChatMessages} userNameById={userNameById} canManage={canManage} onReload={loadChat} toast={toast} />
        )}
        {tab === 'history' && (
          <HistoryTab events={events} userNameById={userNameById} />
        )}
      </div>
    </div>
  );
}
