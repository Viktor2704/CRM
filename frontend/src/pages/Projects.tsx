import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Check, Download, FileText, MessageSquare, Paperclip, Pin, Plus, Search, Send, Sparkles, Trash2, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import Modal from '@/components/Modal';
import Breadcrumbs from '@/components/Breadcrumbs';
import ConfirmDialog from '@/components/ConfirmDialog';
import { SkeletonTable } from '@/components/Skeleton';
import { api, buildApiUrl, getAccessToken, uploadFileT } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import type { Tenant, User } from '@/types';
import { usePermissions } from '@/hooks/usePermissions';
import { useDebounce } from '@/hooks/useDebounce';

type Project = {
  id: string;
  title?: string;
  description?: string;
  tenantId?: string;
  status?: string;
  priority?: string;
  executorIds?: string[];
  responsibleIds?: string[];
  dueDatePreliminary?: string | null;
  createdAt?: string;
  files?: { id?: string; name: string; url: string; type?: string; size?: string }[];
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

type FileAttachment = { id?: string; name: string; url: string; mimeType?: string; sizeBytes?: number };

type ListResponse<T> = T[] | { items?: T[]; data?: T[] };

type ProjectForm = {
  title: string;
  description: string;
  tenantId: string;
  executorIds: string[];
  dueDatePreliminary: string;
  files: FileAttachment[];
};

const PROJECT_STATUS_LABELS: Record<string, string> = {
  new: 'Новый',
  tz_preparation: 'Подготовка ТЗ',
  in_progress: 'В работе',
  design: 'Проектирование',
  internal_review: 'Внутренняя проверка',
  client_approval: 'Согласование с клиентом',
  ready_for_installation: 'Готов к монтажу',
  done: 'Сдан',
  closed: 'Закрыт',
  cancelled: 'Отменён',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  tz_preparation: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  in_progress: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  design: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  internal_review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  client_approval: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  ready_for_installation: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  done: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  closed: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const PROJECT_STAGE_TRANSITIONS: Record<string, string[]> = {
  new: ['tz_preparation', 'cancelled'],
  tz_preparation: ['design', 'cancelled'],
  design: ['internal_review', 'cancelled'],
  internal_review: ['design', 'client_approval', 'cancelled'],
  client_approval: ['design', 'ready_for_installation', 'cancelled'],
  ready_for_installation: ['done', 'cancelled'],
  done: ['closed'],
  closed: [],
  cancelled: [],
};

const INITIAL_FORM: ProjectForm = {
  title: '',
  description: '',
  tenantId: '',
  executorIds: [],
  dueDatePreliminary: '',
  files: [],
};

import { normalizeList } from '@/utils/normalize';

const getExecutorIds = (project: Project) => {
  if (Array.isArray(project.executorIds)) return project.executorIds;
  if (Array.isArray(project.responsibleIds)) return project.responsibleIds;
  return [];
};

const AI_FEATURE_ENABLED = String(import.meta.env.VITE_AI_ENABLED ?? 'true').toLowerCase() !== 'false';

/* ── Searchable select (like Installations) ── */
function SearchableSelect({ items, value, onChange, placeholder }: {
  items: { id: string; label: string; sub?: string }[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((i) => i.label.toLowerCase().includes(t) || (i.sub || '').toLowerCase().includes(t));
  }, [items, q]);
  const selectedLabel = items.find((i) => i.id === value)?.label;

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-sm text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-red-900/30">
        {selectedLabel || <span className="text-slate-400">{placeholder || 'Не выбрано'}</span>}
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <div className="relative border-b border-slate-100 dark:border-slate-700/50">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск..."
              className="w-full bg-transparent py-2 pl-8 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100" />
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            <button type="button" onClick={() => { onChange(''); setOpen(false); setQ(''); }}
              className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-slate-400 transition hover:bg-slate-50 dark:hover:bg-slate-700/40">
              Не выбрано
            </button>
            {filtered.map((item) => (
              <button key={item.id} type="button" onClick={() => { onChange(item.id); setOpen(false); setQ(''); }}
                className={[
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition',
                  item.id === value ? 'bg-red-50 font-medium text-red-700 dark:bg-red-900/20 dark:text-red-300' : 'text-slate-900 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-700/40',
                ].join(' ')}>
                <span className="truncate">{item.label}</span>
                {item.sub ? <span className="text-xs text-slate-400">{item.sub}</span> : null}
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Ничего не найдено</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── CheckList (like Installations) ── */
function CheckList({ items, selected, onToggle, searchPlaceholder }: {
  items: { id: string; label: string; sub?: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  searchPlaceholder?: string;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((i) => i.label.toLowerCase().includes(t) || (i.sub || '').toLowerCase().includes(t));
  }, [items, q]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/50">
      <div className="relative border-b border-slate-100 dark:border-slate-700/50">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder || 'Поиск...'}
          className="w-full bg-transparent py-2 pl-8 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100" />
      </div>
      <div className="max-h-44 overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-400">Ничего не найдено</p>
        ) : filtered.map((item) => {
          const active = selected.includes(item.id);
          return (
            <button key={item.id} type="button" onClick={() => onToggle(item.id)}
              className={[
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition',
                active ? 'bg-red-50 dark:bg-red-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40',
              ].join(' ')}>
              <span className={[
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition',
                active ? 'border-red-500 bg-red-500 text-white' : 'border-slate-300 dark:border-slate-600',
              ].join(' ')}>
                {active ? <Check size={12} strokeWidth={3} /> : null}
              </span>
              <span className="flex-1 truncate">
                <span className={active ? 'font-medium text-red-700 dark:text-red-300' : 'text-slate-900 dark:text-slate-100'}>{item.label}</span>
                {item.sub ? <span className="ml-1.5 text-xs text-slate-400">{item.sub}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      {selected.length > 0 ? (
        <div className="border-t border-slate-100 px-3 py-1.5 dark:border-slate-700/50">
          <span className="text-xs text-slate-500">Выбрано: {selected.length}</span>
        </div>
      ) : null}
    </div>
  );
}


/* ── Detail Modal ── */
function ProjectDetailModal({ project, onClose, onRefresh, tenants, users }: {
  project: Project;
  onClose: () => void;
  onRefresh?: (updated: Project) => void;
  tenants: Tenant[];
  users: User[];
}) {
  const toast = useToast();
  const { canManage, role } = usePermissions();
  const [tab, setTab] = useState<'info' | 'chat'>('info');
  const [editForm, setEditForm] = useState<ProjectForm>({
    title: project.title || '',
    description: project.description || '',
    tenantId: project.tenantId || '',
    executorIds: getExecutorIds(project),
    dueDatePreliminary: (project.dueDatePreliminary || '').slice(0, 10),
    files: (project.files || []).map((f) => ({ id: f.id, name: f.name, url: f.url, mimeType: f.type, sizeBytes: f.size ? parseInt(f.size, 10) || 0 : 0 })),
  });
  const [saving, setSaving] = useState(false);
  const [editUploading, setEditUploading] = useState(false);
  const [editAiDescLoading, setEditAiDescLoading] = useState(false);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);

  // AI
  const [aiChatSummary, setAiChatSummary] = useState('');
  const [aiChatSummaryLoading, setAiChatSummaryLoading] = useState(false);
  const isClientRole = ['installer', 'client_manager', 'client_user', 'user'].includes(role);

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
    if (!tenantId) return '-';
    return tenantNameById[tenantId] || (canManage ? tenantId : 'Компания проекта');
  };

  const resolveUserLabel = (userId?: string) => {
    if (!userId) return 'Система';
    return userNameById[userId] || (canManage ? userId : 'Участник проекта');
  };

  const resolveExecutorSummary = (executorIds: string[]) => {
    if (executorIds.length === 0) return 'Не назначены';
    if (canManage) {
      return executorIds.map((id) => resolveUserLabel(id)).join(', ');
    }
    return executorIds.length === 1 ? 'Назначенный исполнитель' : `Исполнители: ${executorIds.length}`;
  };

  const contractorItems = useMemo(() => tenants.filter((t) => t.type === 'contractor').map((t) => ({
    id: t.id, label: t.brandName || t.name || t.id, sub: t.inn || undefined,
  })), [tenants]);

  const executorItems = useMemo(() => users.map((u) => ({
    id: u.id, label: u.fullName || u.email || u.id, sub: u.companyName || undefined,
  })), [users]);

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-red-900/30';
  const labelCls = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';

  const editUploadFile = useCallback(async (file: File): Promise<FileAttachment | null> => {
    try {
      const result = await uploadFileT<{ id: string; name: string; url: string; mimeType: string; sizeBytes: number }>('/files/upload', file);
      return { id: result.id, name: result.name, url: result.url, mimeType: result.mimeType, sizeBytes: result.sizeBytes };
    } catch {
      return null;
    }
  }, []);

  const handleEditFileSelect = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setEditUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const uploaded = await editUploadFile(file);
        if (uploaded) {
          setEditForm((prev) => ({ ...prev, files: [...prev.files, uploaded] }));
          // Immediately save file to project
          try {
            await api.patchT(`/projects/${project.id}/files`, {
              files: [{ id: uploaded.id, name: uploaded.name, url: uploaded.url, type: (uploaded.mimeType || '').slice(0, 60), size: String(uploaded.sizeBytes || 0) }],
            });
          } catch { /* will be saved on form submit */ }
        } else {
          toast.error(`Не удалось загрузить: ${file.name}`);
        }
      }
    } finally { setEditUploading(false); }
  }, [editUploadFile, toast, project.id]);

  const removeEditFile = useCallback(async (fileIndex: number) => {
    const file = editForm.files[fileIndex];
    if (!file) return;
    setEditForm((p) => ({ ...p, files: p.files.filter((_, fi) => fi !== fileIndex) }));
    if (file.id) {
      try {
        const token = getAccessToken();
        await fetch(buildApiUrl(`/projects/${project.id}/files`), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
          credentials: 'include',
          body: JSON.stringify({ fileIds: [file.id] }),
        });
      } catch { toast.error('Не удалось удалить файл'); }
    }
  }, [editForm.files, project.id, toast]);

  const generateEditAiDescription = useCallback(async () => {
    if (!editForm.title.trim() && editForm.files.length === 0) { toast.error('Введите название или прикрепите файлы'); return; }
    setEditAiDescLoading(true);
    try {
      const result = await api.postT<{ description: string }>('/ai/generate-project-description', {
        projectTitle: editForm.title,
        projectDescription: editForm.description || '',
        files: editForm.files,
      });
      if (result.description) {
        setEditForm((p) => ({ ...p, description: result.description }));
        toast.success('Описание сгенерировано');
      }
    } catch { toast.error('Не удалось сгенерировать описание'); }
    finally { setEditAiDescLoading(false); }
  }, [editForm.title, editForm.description, editForm.files, toast]);

  const loadChat = useCallback(async () => {
    setChatLoading(true);
    try {
      const raw = await api.getT<ListResponse<ChatMessage>>(`/projects/${project.id}/chat/messages`);
      setChatMessages(normalizeList(raw));
    } catch { /* ignore */ }
    finally { setChatLoading(false); }
  }, [project.id]);

  useEffect(() => { void loadChat(); }, [loadChat]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages.length]);

  const onSendChat = async () => {
    const trimmed = chatText.trim();
    if (!trimmed) return;
    setChatSending(true);
    try {
      await api.postT(`/projects/${project.id}/chat/messages`, {
        text: trimmed,
        visibility: isClientRole ? 'client-visible' : 'internal',
      });
      setChatText('');
      await loadChat();
    } catch { toast.error('Не удалось отправить сообщение'); }
    finally { setChatSending(false); }
  };

  const onUpdate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patchT(`/projects/${project.id}`, {
        title: editForm.title,
        description: editForm.description,
        tenantId: editForm.tenantId || undefined,
        responsibleIds: editForm.executorIds,
        dueDatePreliminary: editForm.dueDatePreliminary || null,
      });
      // Upload files separately if any
      if (editForm.files.length > 0) {
        try {
          await api.patchT(`/projects/${project.id}/files`, {
            files: editForm.files.map((f) => ({ id: f.id, name: f.name, url: f.url, type: (f.mimeType || '').slice(0, 60), size: String(f.sizeBytes || 0) })),
          });
        } catch { /* ignore file upload errors */ }
      }
      toast.success('Проект обновлён.');
      onClose();
    } catch { toast.error('Не удалось обновить проект.'); }
    finally { setSaving(false); }
  };

  const [stageChanging, setStageChanging] = useState(false);
  const onStageChange = async (nextStage: string) => {
    if (stageChanging) return;
    setStageChanging(true);
    try {
      await api.patchT<Project>(`/projects/${project.id}/stage`, { stage: nextStage });
      toast.success(`Стадия изменена: ${PROJECT_STATUS_LABELS[nextStage] || nextStage}`);
      if (onRefresh) {
        try {
          const fresh = await api.getT<Project>(`/projects/${project.id}`);
          onRefresh(fresh);
        } catch {
          onRefresh({ ...project, status: nextStage });
        }
      } else {
        onClose();
      }
    } catch { toast.error('Не удалось сменить стадию.'); }
    finally { setStageChanging(false); }
  };

  const onGenerateAiChatSummary = async () => {
    if (!AI_FEATURE_ENABLED) return;
    setAiChatSummaryLoading(true);
    try {
      const result = await api.postT<{ summary?: string | null }>('/ai/summarize-chat', { projectId: project.id });
      setAiChatSummary(String(result?.summary || '').trim());
      if (!String(result?.summary || '').trim()) toast.info('Нет данных чата для AI-резюме.');
    } catch { toast.error('Не удалось получить AI-резюме.'); }
    finally { setAiChatSummaryLoading(false); }
  };

  const pinnedMessages = chatMessages.filter((m) => m.isPinned);

  const _onPin = async (msgId: string, pin: boolean) => {
    try {
      await api.patchT(`/projects/${project.id}/chat/${msgId}/pin`, { isPinned: pin });
      await loadChat();
    } catch { toast.error('Не удалось закрепить'); }
  };

  const tabs: { key: 'info' | 'chat'; label: string; icon: typeof FileText }[] = [
    { key: 'info', label: 'Информация', icon: FileText },
    { key: 'chat', label: `Чат (${chatMessages.length})`, icon: MessageSquare },
  ];

  return (
    <Modal isOpen onClose={onClose} title={project.title || 'Проект'}>
      {/* Tabs */}
      <div className="mb-5 flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => { setTab(t.key); if (t.key === 'chat') setTimeout(() => chatInputRef.current?.focus(), 100); }}
            className={[
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition',
              tab === t.key ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400',
            ].join(' ')}>
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Info tab */}
      {tab === 'info' && (
        <form onSubmit={canManage ? onUpdate : (e) => e.preventDefault()} className="space-y-5">
          <div>
            <label className={labelCls}>Название</label>
            {canManage ? (
              <input required value={editForm.title} onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))} className={inputCls} />
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                {editForm.title || '-'}
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Описание</label>
              {canManage ? (
                <button type="button" disabled={editAiDescLoading || (!editForm.title.trim() && editForm.files.length === 0)} onClick={() => void generateEditAiDescription()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 transition hover:bg-purple-100 disabled:opacity-50 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50">
                  <Sparkles size={12} />
                  {editAiDescLoading ? 'Генерация...' : 'Подсказка от ИИ'}
                </button>
              ) : null}
            </div>
            {canManage ? (
              <textarea rows={3} value={editForm.description} onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))} className={inputCls} />
            ) : (
              <div className="min-h-[88px] whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {editForm.description || 'Описание не заполнено'}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Контрагент</label>
              {canManage ? (
                <SearchableSelect items={contractorItems} value={editForm.tenantId}
                  onChange={(id) => setEditForm((p) => ({ ...p, tenantId: id }))} placeholder="Поиск контрагента..." />
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                  {resolveTenantLabel(editForm.tenantId)}
                </div>
              )}
            </div>
            <div>
              <label className={labelCls}>Дедлайн</label>
              {canManage ? (
                <input type="date" value={editForm.dueDatePreliminary} onChange={(e) => setEditForm((p) => ({ ...p, dueDatePreliminary: e.target.value }))} className={inputCls} />
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                  {editForm.dueDatePreliminary ? new Date(editForm.dueDatePreliminary).toLocaleDateString('ru-RU') : '-'}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className={labelCls}>Ответственные</label>
            {canManage ? (
              <CheckList items={executorItems} selected={editForm.executorIds}
                onToggle={(id) => setEditForm((p) => ({
                  ...p, executorIds: p.executorIds.includes(id) ? p.executorIds.filter((x) => x !== id) : [...p.executorIds, id],
                }))} searchPlaceholder="Поиск сотрудника..." />
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                {resolveExecutorSummary(editForm.executorIds)}
              </div>
            )}
          </div>
          <div>
            <label className={labelCls}>Файлы</label>
            {canManage ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 transition hover:border-red-400 hover:text-red-500 dark:border-slate-600 dark:text-slate-400">
                <Paperclip size={14} />
                {editUploading ? 'Загрузка...' : 'Прикрепить файл'}
                <input type="file" multiple className="hidden" disabled={editUploading} onChange={(e) => void handleEditFileSelect(e.target.files)} />
              </label>
            ) : null}
            {editForm.files.length > 0 && (
              <div className="mt-2 space-y-1">
                {editForm.files.map((f, i) => (
                  <div key={f.url || i} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-slate-800">
                    <Paperclip size={12} className="shrink-0 text-slate-400" />
                    <span className="truncate text-slate-700 dark:text-slate-300">{f.name}</span>
                    <a href={f.url} download={f.name} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0 text-blue-500 hover:text-blue-700" title="Скачать"><Download size={12} /></a>
                    {canManage ? (
                      <button type="button" onClick={() => void removeEditFile(i)} className="shrink-0 text-slate-400 hover:text-red-500" title="Удалить"><X size={12} /></button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Stage control */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className={['inline-flex rounded-full px-2.5 py-1 text-xs font-semibold',
                STATUS_COLORS[project.status || ''] || 'bg-slate-100 text-slate-600'].join(' ')}>
                {PROJECT_STATUS_LABELS[project.status || ''] || project.status || 'Новый'}
              </span>
              <span className="text-xs text-slate-400">
                Создан: {project.createdAt ? new Date(project.createdAt).toLocaleDateString('ru-RU') : '-'}
              </span>
            </div>
            {canManage && (PROJECT_STAGE_TRANSITIONS[project.status || 'new'] || []).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {(PROJECT_STAGE_TRANSITIONS[project.status || 'new'] || []).map((nextStage) => (
                  <button
                    key={nextStage}
                    type="button"
                    disabled={stageChanging}
                    onClick={() => void onStageChange(nextStage)}
                    className={['inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50',
                      nextStage === 'cancelled'
                        ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40'
                        : 'bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40',
                    ].join(' ')}
                  >
                    {stageChanging ? '...' : `→ ${PROJECT_STATUS_LABELS[nextStage] || nextStage}`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {AI_FEATURE_ENABLED && canManage && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">AI резюме чата</p>
                <button type="button" onClick={() => void onGenerateAiChatSummary()} disabled={aiChatSummaryLoading}
                  className="inline-flex items-center gap-1 rounded-lg bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 transition hover:bg-purple-100 disabled:opacity-50 dark:bg-purple-900/30 dark:text-purple-300">
                  <Sparkles size={12} />{aiChatSummaryLoading ? 'Генерация...' : 'Сгенерировать'}
                </button>
              </div>
              {aiChatSummary ? (
                <p className="whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-300">{aiChatSummary}</p>
              ) : (
                <p className="text-xs text-slate-400">Нажмите кнопку для получения AI-резюме переписки.</p>
              )}
            </div>
          )}

          {canManage && (
            <button type="submit" disabled={saving}
              className="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60">
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          )}
        </form>
      )}

      {/* Chat tab */}
      {tab === 'chat' && (
        <div className="flex flex-col" style={{ height: 'min(500px, 60vh)' }}>
          {/* Pinned */}
          {pinnedMessages.length > 0 && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-2 dark:border-amber-900/30 dark:bg-amber-950/10">
              {pinnedMessages.map((m) => (
                <div key={m.id} className="flex items-start gap-2 py-1">
                  <Pin size={12} className="mt-0.5 shrink-0 text-amber-500" />
                  <p className="line-clamp-2 text-xs text-amber-800 dark:text-amber-300">{m.text}</p>
                </div>
              ))}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto space-y-3">
            {chatLoading ? (
              <p className="text-center text-sm text-slate-400 py-8">Загрузка...</p>
            ) : chatMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <MessageSquare size={40} className="mb-3 text-slate-300 dark:text-slate-600" />
                <p className="text-sm text-slate-400">Сообщений пока нет</p>
              </div>
            ) : (
              chatMessages.map((msg) => {
                if (msg.isSystem) {
                  return (
                    <div key={msg.id} className="flex justify-center">
                      <div className="rounded-full bg-slate-100 px-4 py-1.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{msg.text}</div>
                    </div>
                  );
                }
                return (
                  <div key={msg.id} className="group flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                      {resolveUserLabel(msg.userId)[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{resolveUserLabel(msg.userId)}</span>
                        <span className="text-xs text-slate-400">
                          {msg.createdAt ? new Date(msg.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                        {msg.isPinned ? <Pin size={10} className="text-amber-500" /> : null}
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300">{msg.text}</p>
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {msg.attachments.map((a) => (
                            <a key={a.id} href={a.url || '#'} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400">{a.name}</a>
                          ))}
                        </div>
                      )}
                    </div>
                    {null}
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="mt-3 flex items-end gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
            <textarea ref={chatInputRef} rows={1} value={chatText} onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void onSendChat(); } }}
              onClick={(e) => e.stopPropagation()}
              placeholder="Написать сообщение..."
              className="flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
            <button type="button" disabled={chatSending || !chatText.trim()} onClick={() => void onSendChat()}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white transition hover:bg-red-700 disabled:opacity-40">
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}


/* ── Main Page ── */
export default function ProjectsPage() {
  const toast = useToast();
  const { canManage } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const debouncedSearch = useDebounce(search);

  const [projects, setProjects] = useState<Project[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [createForm, setCreateForm] = useState<ProjectForm>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [aiDescLoading, setAiDescLoading] = useState(false);

  const generateAiDescription = useCallback(async () => {
    if (!createForm.title.trim() && createForm.files.length === 0) { toast.error('Введите название или прикрепите файлы'); return; }
    setAiDescLoading(true);
    try {
      const result = await api.postT<{ description: string }>('/ai/generate-project-description', {
        projectTitle: createForm.title,
        projectDescription: createForm.description || '',
        files: createForm.files,
      });
      if (result.description) {
        setCreateForm((p) => ({ ...p, description: result.description }));
        toast.success('Описание сгенерировано');
      }
    } catch { toast.error('Не удалось сгенерировать описание'); }
    finally { setAiDescLoading(false); }
  }, [createForm.title, createForm.description, createForm.files, toast]);

  const uploadFile = useCallback(async (file: File): Promise<FileAttachment | null> => {
    try {
      const result = await uploadFileT<{ id: string; name: string; url: string; mimeType: string; sizeBytes: number }>('/files/upload', file);
      return { id: result.id, name: result.name, url: result.url, mimeType: result.mimeType, sizeBytes: result.sizeBytes };
    } catch {
      return null;
    }
  }, []);

  const handleFileSelect = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const uploaded = await uploadFile(file);
        if (uploaded) {
          setCreateForm((prev) => ({ ...prev, files: [...prev.files, uploaded] }));
        } else {
          toast.error(`Не удалось загрузить: ${file.name}`);
        }
      }
    } finally { setUploading(false); }
  }, [uploadFile, toast]);

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value.trim()) { params.set(key, value); } else { params.delete(key); }
    setSearchParams(params, { replace: true });
  };

  const tenantNameById = useMemo(() => {
    const map: Record<string, string> = {};
    tenants.forEach((t) => { map[t.id] = t.brandName || t.name || t.id; });
    return map;
  }, [tenants]);

  const userNameById = useMemo(() => {
    const map: Record<string, string> = {};
    users.forEach((u) => { map[u.id] = u.fullName || u.email || u.id; });
    return map;
  }, [users]);

  const resolveTenantLabel = (tenantId?: string) => {
    if (!tenantId) return '-';
    return tenantNameById[tenantId] || (canManage ? tenantId : 'Компания проекта');
  };

  const resolveExecutorSummary = (executorIds: string[]) => {
    if (executorIds.length === 0) return 'Не назначены';
    if (canManage) {
      return executorIds.map((id) => userNameById[id] || id).join(', ');
    }
    return executorIds.length === 1 ? 'Назначенный исполнитель' : `Исполнители: ${executorIds.length}`;
  };

  const contractorItems = useMemo(() => tenants.filter((t) => t.type === 'contractor').map((t) => ({
    id: t.id, label: t.brandName || t.name || t.id, sub: t.inn || undefined,
  })), [tenants]);

  const executorItems = useMemo(() => users.map((u) => ({
    id: u.id, label: u.fullName || u.email || u.id, sub: u.companyName || undefined,
  })), [users]);

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-red-900/30';
  const labelCls = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';

  const loadAll = async () => {
    setError('');
    const [projectsRaw, tenantsRaw, usersRaw] = await Promise.all([
      api.getT<ListResponse<Project>>('/projects'),
      canManage
        ? api.getT<ListResponse<Tenant>>('/tenants').catch(() => ({ items: [] as Tenant[] }))
        : Promise.resolve({ items: [] as Tenant[] }),
      canManage
        ? api.getT<ListResponse<User>>('/users').catch(() => ({ items: [] as User[] }))
        : Promise.resolve({ items: [] as User[] }),
    ]);
    setProjects(normalizeList(projectsRaw));
    setTenants(normalizeList(tenantsRaw));
    setUsers(normalizeList(usersRaw));
  };

  useEffect(() => {
    let cancelled = false;
    void loadAll()
      .catch(() => { if (!cancelled) { setError('Не удалось загрузить проекты.'); toast.error('Не удалось загрузить проекты.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [toast, canManage]);

  const stats = useMemo(() => {
    const total = projects.length;
    const byStatus: Record<string, number> = {};
    let noExecutors = 0;
    for (const p of projects) {
      const s = p.status || 'new';
      byStatus[s] = (byStatus[s] || 0) + 1;
      if (getExecutorIds(p).length === 0 && !['done', 'closed', 'cancelled'].includes(s)) noExecutors++;
    }
    return { total, byStatus, noExecutors };
  }, [projects]);

  const filteredProjects = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return projects.filter((p) => {
      if (!term) return true;
      return (
        String(p.title || '').toLowerCase().includes(term) ||
        String(tenantNameById[p.tenantId || ''] || p.tenantId || '').toLowerCase().includes(term)
      );
    });
  }, [projects, debouncedSearch, tenantNameById]);

  const downloadCsv = async () => {
    setExporting(true);
    try {
      const token = getAccessToken();
      const res = await fetch(buildApiUrl('/projects/export-xlsx'), {
        headers: { Authorization: `Bearer ${token ?? ''}` },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'projects.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Не удалось скачать Excel'); }
    finally { setExporting(false); }
  };

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.postT('/projects', {
        title: createForm.title,
        description: createForm.description,
        tenantId: createForm.tenantId || undefined,
        responsibleIds: createForm.executorIds,
        dueDatePreliminary: createForm.dueDatePreliminary || null,
        files: createForm.files.map((f) => ({ id: f.id, name: f.name, url: f.url, type: (f.mimeType || '').slice(0, 60), size: String(f.sizeBytes || 0) })),
      });
      setCreateForm(INITIAL_FORM);
      setIsCreateOpen(false);
      await loadAll();
      toast.success('Проект создан.');
    } catch { setError('Не удалось создать проект.'); toast.error('Не удалось создать проект.'); }
    finally { setSaving(false); }
  };

  const onDeleteClick = (event: MouseEvent, project: Project) => {
    event.stopPropagation();
    setDeleteTarget(project);
  };

  const onConfirmDelete = async () => {
    if (!deleteTarget) return;
    setError('');
    try {
      await api.delT(`/projects/${deleteTarget.id}`);
      await loadAll();
      toast.success('Проект удалён.');
    } catch { toast.error('Не удалось удалить проект.'); }
    finally { setDeleteTarget(null); }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Проекты' }]} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Проекты</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {canManage && (
            <button type="button" onClick={() => void downloadCsv()} disabled={exporting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:w-auto">
              <Download size={16} />{exporting ? 'Скачиваю...' : 'Скачать Excel'}
            </button>
          )}
          {canManage && (
            <button type="button" onClick={() => setIsCreateOpen(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 sm:w-auto">
              <Plus size={16} />Создать
            </button>
          )}
        </div>
      </div>

      {/* Stats cards */}
      {!loading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Всего</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900/40 dark:bg-yellow-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-yellow-600 dark:text-yellow-400">В работе</p>
            <p className="mt-1 text-2xl font-bold text-yellow-700 dark:text-yellow-300">{(stats.byStatus['in_progress'] || 0) + (stats.byStatus['design'] || 0)}</p>
          </div>
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 dark:border-green-900/40 dark:bg-green-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-green-600 dark:text-green-400">Выполнено</p>
            <p className="mt-1 text-2xl font-bold text-green-700 dark:text-green-300">{(stats.byStatus['done'] || 0) + (stats.byStatus['closed'] || 0)}</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Без ответственных</p>
            <p className="mt-1 text-2xl font-bold text-amber-700 dark:text-amber-300">{stats.noExecutors}</p>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input value={search} onChange={(e) => updateFilter('search', e.target.value)} placeholder="Поиск по названию и контрагенту..."
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</div>}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/50">
                {['Проект', 'Статус', 'Даты', ''].map((h) => (
                  <th key={h} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {loading ? <SkeletonTable rows={5} cols={4} /> : (
                <>
                  {filteredProjects.map((project) => {
                    const noExec = getExecutorIds(project).length === 0 && !['done', 'closed', 'cancelled'].includes(project.status || '');
                    const deadlineRaw = project.dueDatePreliminary;
                    const deadlineDate = deadlineRaw ? new Date(deadlineRaw).toLocaleDateString('ru-RU') : null;
                    const todayStr = new Date().toISOString().slice(0, 10);
                    const deadlinePast = deadlineRaw && deadlineRaw < todayStr && !['done', 'closed', 'cancelled'].includes(project.status || '');
                    return (
                      <tr key={project.id}
                        className={['cursor-pointer transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40', deadlinePast ? 'bg-red-50/40 dark:bg-red-950/10' : ''].join(' ')}
                        onClick={() => setSelectedProject(project)}>
                        <td className="px-3 py-2.5">
                          <div className="mb-0.5 flex items-center gap-1.5">
                            {deadlinePast ? <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" title="Просрочено" /> : null}
                            {noExec ? <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Без ответственных" /> : null}
                            <span className="max-w-[280px] truncate font-semibold text-slate-900 dark:text-slate-100">{project.title || '-'}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="max-w-[140px] truncate">{resolveTenantLabel(project.tenantId)}</span>
                            {getExecutorIds(project).length > 0 ? (
                              <>
                                <span className="text-slate-300 dark:text-slate-600">·</span>
                                <span className="max-w-[160px] truncate">{resolveExecutorSummary(getExecutorIds(project))}</span>
                              </>
                            ) : (
                              <>
                                <span className="text-slate-300 dark:text-slate-600">·</span>
                                <span className="font-medium text-amber-500">Не назначены</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={['inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight',
                            STATUS_COLORS[project.status || ''] || 'bg-slate-100 text-slate-600'].join(' ')}>
                            {PROJECT_STATUS_LABELS[project.status || ''] || project.status || 'Новый'}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <div className="flex flex-col gap-0.5 text-[11px] leading-tight">
                            {deadlineDate ? <span className={deadlinePast ? 'font-semibold text-red-500' : 'text-orange-500 dark:text-orange-400'}>◆ Дедлайн: {deadlineDate}</span> : null}
                            <span className="text-slate-400">Создан: {project.createdAt ? new Date(project.createdAt).toLocaleDateString('ru-RU') : '-'}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          {canManage && (
                            <button type="button" onClick={(e) => onDeleteClick(e, project)}
                              className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 min-h-[44px] min-w-[44px] flex items-center justify-center">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredProjects.length === 0 && <tr><td colSpan={4} className="px-3 py-12 text-center"><Search size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" /><p className="text-sm text-slate-500 dark:text-slate-400">Ничего не найдено</p></td></tr>}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Создание проекта">
        <form onSubmit={onCreate} className="space-y-5">
          <div>
            <label className={labelCls}>Название</label>
            <input required minLength={2} value={createForm.title} onChange={(e) => setCreateForm((p) => ({ ...p, title: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Описание</label>
              <button type="button" disabled={aiDescLoading || (!createForm.title.trim() && createForm.files.length === 0)} onClick={() => void generateAiDescription()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 transition hover:bg-purple-100 disabled:opacity-50 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50">
                <Sparkles size={12} />
                {aiDescLoading ? 'Генерация...' : 'Подсказка от ИИ'}
              </button>
            </div>
            <textarea rows={3} value={createForm.description} onChange={(e) => setCreateForm((p) => ({ ...p, description: e.target.value }))} className={inputCls} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Контрагент</label>
              <SearchableSelect items={contractorItems} value={createForm.tenantId}
                onChange={(id) => setCreateForm((p) => ({ ...p, tenantId: id }))} placeholder="Поиск контрагента..." />
            </div>
            <div>
              <label className={labelCls}>Дедлайн</label>
              <input type="date" value={createForm.dueDatePreliminary} onChange={(e) => setCreateForm((p) => ({ ...p, dueDatePreliminary: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Ответственные</label>
            <CheckList items={executorItems} selected={createForm.executorIds}
              onToggle={(id) => setCreateForm((p) => ({
                ...p, executorIds: p.executorIds.includes(id) ? p.executorIds.filter((x) => x !== id) : [...p.executorIds, id],
              }))} searchPlaceholder="Поиск сотрудника..." />
          </div>
          <div>
            <label className={labelCls}>Файлы</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 transition hover:border-red-400 hover:text-red-500 dark:border-slate-600 dark:text-slate-400">
              <Paperclip size={14} />
              {uploading ? 'Загрузка...' : 'Прикрепить файл'}
              <input type="file" multiple className="hidden" disabled={uploading} onChange={(e) => void handleFileSelect(e.target.files)} />
            </label>
            {createForm.files.length > 0 && (
              <div className="mt-2 space-y-1">
                {createForm.files.map((f, i) => (
                  <div key={f.url || i} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-slate-800">
                    <Paperclip size={12} className="shrink-0 text-slate-400" />
                    <span className="truncate text-slate-700 dark:text-slate-300">{f.name}</span>
                    <a href={f.url} download={f.name} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0 text-blue-500 hover:text-blue-700" title="Скачать"><Download size={12} /></a>
                    <button type="button" onClick={() => setCreateForm((p) => ({ ...p, files: p.files.filter((_, fi) => fi !== i) }))} className="shrink-0 text-slate-400 hover:text-red-500" title="Удалить"><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button type="submit" disabled={saving}
            className="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60">
            {saving ? 'Сохранение...' : 'Создать'}
          </button>
        </form>
      </Modal>

      {/* Detail Modal */}
      {selectedProject && (
        <ProjectDetailModal project={selectedProject} onClose={() => { setSelectedProject(null); void loadAll(); }} onRefresh={(updated) => { setSelectedProject(updated); setProjects((prev) => prev.map((p) => p.id === updated.id ? updated : p)); }} tenants={tenants} users={users} />
      )}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void onConfirmDelete()}
        title="Удалить проект?"
        message="Это действие нельзя отменить."
        confirmLabel="Удалить"
      />
    </div>
  );
}
