import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, useCallback } from 'react';
import { Check, Download, Maximize2, MessageSquare, Minimize2, Paperclip, Plus, Search, Send, Sparkles, Trash2, UserCheck, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Editor } from '@tinymce/tinymce-react';
import Modal from '@/components/Modal';
import Breadcrumbs from '@/components/Breadcrumbs';
import ConfirmDialog from '@/components/ConfirmDialog';
import { SkeletonTable } from '@/components/Skeleton';
import AiSuggestionBadges from '@/components/AiSuggestionBadges';
import CustomFieldsForm, { type CustomFieldDefinition } from '@/components/CustomFieldsForm';
import { api, buildApiUrl, getAccessToken, uploadFileT } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { SYSTEM_LABELS, SystemType, UserRole, type Direction, type MaintenanceItem, type User } from '@/types';
import { usePermissions } from '@/hooks/usePermissions';
import { useDebounce } from '@/hooks/useDebounce';

type ServiceRequest = {
  id: string; title?: string; description?: string; type?: string; directionId?: string;
  systemType?: string; itemIds?: string[]; executorIds?: string[]; priority?: string;
  status?: string; createdAt?: string;
  clientAction?: 'confirmed' | 'reschedule_requested' | null;
  clientActionAt?: string | null;
};
type ServiceRequestsResponse = ServiceRequest[] | { items?: ServiceRequest[]; requests?: ServiceRequest[]; data?: ServiceRequest[] };
type ListResponse<T> = T[] | { items?: T[]; data?: T[] };
type FileAttachment = { id?: string; name: string; url: string; mimeType?: string; sizeBytes?: number };
type RequestForm = {
  title: string; description: string; type: string; directionId: string; systemType: string;
  priority: string; executorIds: string[]; itemIds: string[]; status: string;
  dueDatePreliminary: string;
  visitDate: string;
  files: FileAttachment[];
  customFields?: Record<string, string | null>;
};
type AiSuggestionItem = { value: string; label: string; confidence: string } | null;
type AiSuggestionResponse = { type: AiSuggestionItem; systemType: AiSuggestionItem; priority: AiSuggestionItem };
type SimilarSuggestion = { requestId: string; title?: string; resolution?: string; similarity?: string };
type RequestComment = { id: string; userId: string; authorName: string; text: string; createdAt: string };
type RequestAuditEntry = { id: string; actorName?: string; changes?: Record<string, unknown> | null; createdAt: string };
type RequestAuditChange = { from?: unknown; to?: unknown };
type SavedView = {
  id: string; name: string; params: Record<string, string>; isDefault?: boolean; isSystem?: boolean;
};
type SavedViewsResponse = { items: SavedView[]; defaultViewId: string; systemViewId: string };

const REQUEST_TYPE_LABELS: Record<string, string> = { emergency: 'Аварийная', operation: 'Эксплуатация', maintenance_planned: 'Плановое ТО', installation: 'Монтаж', general: 'Общая' };
const REQUEST_STATUS_LABELS: Record<string, string> = { new: 'Новая', triage: 'Сортировка', assigned: 'Назначена', in_progress: 'В работе', on_site: 'На объекте', review: 'На проверке', done: 'Выполнена', closed: 'Закрыта', cancelled: 'Отменена', paused: 'Приостановлена' };
const PRIORITY_LABELS: Record<string, string> = { critical: 'Критический', high: 'Высокий', medium: 'Средний', low: 'Низкий' };
const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};
const STATUS_COLORS: Record<string, string> = {
  triage: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  assigned: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  in_progress: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  on_site: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  done: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  closed: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};
const SIMILARITY_LABELS: Record<string, string> = { high: 'Высокая', medium: 'Средняя', low: 'Низкая' };
const SIMILARITY_COLORS: Record<string, string> = {
  high: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  low: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
};
const CLIENT_ACTION_LABELS: Record<string, string> = {
  confirmed: 'Согласована',
  reschedule_requested: 'Запрос переноса',
};
const CLIENT_ACTION_COLORS: Record<string, string> = {
  confirmed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  reschedule_requested: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
};
const AUDIT_FIELD_LABELS: Record<string, string> = {
  action: 'Действие',
  status: 'Статус',
  title: 'Название',
  description: 'Описание',
  priority: 'Приоритет',
  dueDate: 'Дедлайн',
  visitDate: 'Дата выезда',
  executorIds: 'Исполнители',
  itemIds: 'Объекты',
};
const AUDIT_ACTION_LABELS: Record<string, string> = {
  qualified: 'Квалификация заявки',
  status_changed: 'Изменение статуса',
  confirmed: 'Согласование заявки',
  reschedule_requested: 'Запрос переноса даты',
  deleted: 'Удаление заявки',
};

import { normalizeList } from '@/utils/normalize';

const INITIAL_FORM: RequestForm = {
  title: '', description: '', type: 'maintenance_planned', directionId: '', systemType: '',
  priority: 'medium', executorIds: [], itemIds: [], status: 'triage', dueDatePreliminary: '', visitDate: '',
  files: [],
  customFields: {},
};
const AI_FEATURE_ENABLED = String(import.meta.env.VITE_AI_ENABLED ?? 'true').toLowerCase() !== 'false';
const SERVICE_REQUEST_CREATE_ROLES = new Set<string>([
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.CURATOR,
  UserRole.DISPATCHER,
  UserRole.EXECUTOR,
  UserRole.INSTALLER,
  UserRole.CLIENT_MANAGER,
  UserRole.CLIENT_USER,
  UserRole.USER,
]);

/* Searchable checkbox list */
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

export default function ServiceRequestsPage() {
  const toast = useToast();
  const { canManage, role } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const debouncedSearch = useDebounce(search);
  const typeFilter = searchParams.get('type') || '';
  const statusFilter = searchParams.get('status') || '';
  const priorityFilter = searchParams.get('priority') || '';
  const executorFilter = searchParams.get('executor') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';

  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [defaultViewId, setDefaultViewId] = useState<string>('');
  const [currentViewId, setCurrentViewId] = useState<string>('');
  const [_viewsLoading, setViewsLoading] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [viewFormName, setViewFormName] = useState('');
  const [viewFormDefault, setViewFormDefault] = useState(false);
  const [editingViewId, setEditingViewId] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editFullscreen, setEditFullscreen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServiceRequest | null>(null);
  const [createForm, setCreateForm] = useState<RequestForm>(INITIAL_FORM);
  const [editForm, setEditForm] = useState<RequestForm>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [descFullscreen, setDescFullscreen] = useState(false);
  const [aiDescLoading, setAiDescLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [aiExecutorSuggestion, setAiExecutorSuggestion] = useState<{ executorId: string; executorName: string; reason: string } | null>(null);
  const [aiExecutorLoading, setAiExecutorLoading] = useState(false);
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState<CustomFieldDefinition[]>([]);
  const [_customFieldsLoading, setCustomFieldsLoading] = useState(false);
  const [ragSuggestions, setRagSuggestions] = useState<Array<{ documentId: string; documentTitle: string; maxSimilarity: number; chunks: Array<{ content: string; similarity: number }> }>>([]);
  const [ragLoading, setRagLoading] = useState(false);
  const [aiClassification, setAiClassification] = useState<{
    type: { value: string; confidence: number };
    systemType: { value: string; confidence: number };
    priority: { value: string; confidence: number };
    suggestedDirection: { value: string; confidence: number };
  } | null>(null);
  const [aiClassifyLoading, setAiClassifyLoading] = useState(false);
  const canCreateRequest = SERVICE_REQUEST_CREATE_ROLES.has(role);
  const canExportRequests = canManage;
  const canOpenUserDirectory = canManage;
  const canEditRequest = canManage;
  const canUseAiDescriptionImprove = canManage;
  const canUseAiSummary = canManage;
  const canUseAiExecutorSuggestion = canManage;

  const requestAiExecutor = async () => {
    if (!canUseAiExecutorSuggestion) return;
    if (!createForm.title || !createForm.description) return;
    setAiExecutorLoading(true);
    setAiExecutorSuggestion(null);
    try {
      const result = await api.postT<{ executorId: string | null; executorName: string | null; reason: string | null }>('/ai/suggest-executor', {
        title: createForm.title,
        description: createForm.description,
        systemType: createForm.systemType || undefined,
        directionId: createForm.directionId || undefined,
      });
      if (result.executorId) {
        setAiExecutorSuggestion({ executorId: result.executorId, executorName: result.executorName || '', reason: result.reason || '' });
      } else {
        toast.error(result.reason || 'AI не смог подобрать исполнителя.');
      }
    } catch {
      toast.error('Не удалось получить рекомендацию AI.');
    } finally {
      setAiExecutorLoading(false);
    }
  };

  const requestRagSuggestions = async () => {
    if (!createForm.title && !createForm.description) return;
    setRagLoading(true);
    setRagSuggestions([]);
    try {
      const result = await api.post('/knowledge-base/suggest-for-request', {
        title: createForm.title,
        description: createForm.description,
      }) as any;
      setRagSuggestions(result.suggestions || []);
    } catch (error) {
      console.error('Failed to fetch RAG suggestions:', error);
    } finally {
      setRagLoading(false);
    }
  };

  const requestAiClassification = useCallback(async (title: string, description: string) => {
    if (!AI_FEATURE_ENABLED) { setAiClassification(null); return; }
    const t = title.trim();
    const d = description.trim();
    if (t.length < 3 && d.length < 10) { setAiClassification(null); return; }
    setAiClassifyLoading(true);
    try {
      const r = await api.postT<{
        type: { value: string; confidence: number };
        systemType: { value: string; confidence: number };
        priority: { value: string; confidence: number };
        suggestedDirection: { value: string; confidence: number };
      }>('/ai/classify-request', { title: t, description: d });
      setAiClassification(r || null);
    } catch { setAiClassification(null); }
    finally { setAiClassifyLoading(false); }
  }, []);

  const uploadFile = useCallback(async (file: File): Promise<FileAttachment | null> => {
    try {
      const result = await uploadFileT<{ id: string; name: string; url: string; mimeType: string; sizeBytes: number }>('/files/upload', file);
      return { id: result.id, name: result.name, url: result.url, mimeType: result.mimeType, sizeBytes: result.sizeBytes };
    } catch {
      return null;
    }
  }, []);

  const handleFileSelect = useCallback(async (formType: 'create' | 'edit', fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    const setter = formType === 'create' ? setCreateForm : setEditForm;
    try {
      for (const file of Array.from(fileList)) {
        const uploaded = await uploadFile(file);
        if (uploaded) {
          setter((prev) => ({ ...prev, files: [...prev.files, uploaded] }));
        } else {
          toast.error(`Не удалось загрузить: ${file.name}`);
        }
      }
    } finally { setUploading(false); }
  }, [uploadFile, toast]);

  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestionResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSimilarLoading, setAiSimilarLoading] = useState(false);
  const [aiSimilarSuggestions, setAiSimilarSuggestions] = useState<SimilarSuggestion[]>([]);

  const [directionItems, setDirectionItems] = useState<MaintenanceItem[]>([]);
  const [directionItemsLoading, setDirectionItemsLoading] = useState(false);

  const [chatOpen, setChatOpen] = useState(false);
  const [comments, setComments] = useState<RequestComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [auditEntries, setAuditEntries] = useState<RequestAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [aiSummary, setAiSummary] = useState('');
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);

  const executorItems = useMemo(() => users.map((u) => ({
    id: u.id,
    label: u.fullName || u.email || u.id,
    sub: u.companyName || undefined,
  })), [users]);

  const objectItems = useMemo(() => directionItems.map((i) => ({
    id: i.id,
    label: i.name,
    sub: i.address || undefined,
  })), [directionItems]);

  const itemNameById = useMemo(() => {
    const map: Record<string, string> = {};
    directionItems.forEach((item) => { map[item.id] = item.name || item.id; });
    return map;
  }, [directionItems]);

  const downloadCsv = async () => {
    if (!canExportRequests) return;
    setExporting(true);
    try {
      const token = getAccessToken();
      const res = await fetch(buildApiUrl('/service-requests/export-xlsx'), {
        headers: { Authorization: `Bearer ${token ?? ''}` },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'service-requests.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Не удалось скачать Excel'); }
    finally { setExporting(false); }
  };

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value.trim()) { params.set(key, value); } else { params.delete(key); }
    setSearchParams(params, { replace: true });
  };

  const directionNameById = useMemo(() => {
    const map: Record<string, string> = {};
    directions.forEach((d) => { map[d.id] = d.name || d.id; });
    return map;
  }, [directions]);

  const userNameById = useMemo(() => {
    const map: Record<string, string> = {};
    users.forEach((u) => {
      const name = u.fullName || u.email || u.id;
      map[u.id] = u.companyName ? `${name} (${u.companyName})` : name;
    });
    return map;
  }, [users]);

  const loadAll = async () => {
    setError('');
    const [rr, dr, ur] = await Promise.all([
      api.getT<ServiceRequestsResponse>('/service-requests'),
      api.getT<ListResponse<Direction>>('/directions'),
      canOpenUserDirectory
        ? api.getT<ListResponse<User>>('/users').catch(() => ({ items: [] as User[] }))
        : Promise.resolve({ items: [] as User[] }),
    ]);
    setRequests(normalizeList(rr)); setDirections(normalizeList(dr)); setUsers(normalizeList(ur));
  };

  const loadCustomFieldDefinitions = async () => {
    setCustomFieldsLoading(true);
    try {
      const result = await api.getT<CustomFieldDefinition[]>('/custom-fields/definitions?entityType=service_request');
      setCustomFieldDefinitions(Array.isArray(result) ? result : []);
    } catch {
      setCustomFieldDefinitions([]);
    } finally {
      setCustomFieldsLoading(false);
    }
  };

  const requestAiSuggestions = async (description: string, files?: FileAttachment[]) => {
    if (!AI_FEATURE_ENABLED) { setAiSuggestions(null); return; }
    const src = description.trim();
    if (src.length < 3 && (!files || files.length === 0)) { setAiSuggestions(null); return; }
    setAiLoading(true);
    try { const r = await api.postT<AiSuggestionResponse>('/ai/suggest-request-fields', { description: src, files: files || [] }); setAiSuggestions(r || null); }
    catch { setAiSuggestions(null); } finally { setAiLoading(false); }
  };

  const loadSimilarSuggestions = async (item: ServiceRequest) => {
    if (!AI_FEATURE_ENABLED) { setAiSimilarSuggestions([]); return; }
    const title = String(item.title || '').trim();
    const description = String(item.description || '').trim();
    if (!title || !description) { setAiSimilarSuggestions([]); return; }
    setAiSimilarLoading(true);
    try {
      const r = await api.postT<{ suggestions?: SimilarSuggestion[] }>('/ai/similar-requests', { title, description, systemType: String(item.systemType || '').trim() || null });
      setAiSimilarSuggestions(Array.isArray(r?.suggestions) ? r.suggestions : []);
    } catch { setAiSimilarSuggestions([]); } finally { setAiSimilarLoading(false); }
  };

  const loadDirectionItems = async (directionId: string) => {
    setDirectionItemsLoading(true);
    try {
      if (directionId) {
        const raw = await api.getT<ListResponse<MaintenanceItem>>(`/directions/${directionId}/items`);
        setDirectionItems(normalizeList<MaintenanceItem>(raw));
      } else {
        const raw = await api.getT<ListResponse<MaintenanceItem>>('/maintenance-items');
        setDirectionItems(normalizeList<MaintenanceItem>(raw));
      }
    }
    catch { setDirectionItems([]); } finally { setDirectionItemsLoading(false); }
  };

  const loadComments = async (requestId: string) => {
    setCommentsLoading(true);
    try {
      const r = await api.getT<RequestComment[] | { comments?: RequestComment[] }>(`/service-requests/${requestId}/comments`);
      setComments(Array.isArray(r) ? r : Array.isArray((r as any)?.comments) ? (r as any).comments : []);
    } catch { setComments([]); } finally { setCommentsLoading(false); }
  };

  const loadAudit = async (requestId: string) => {
    setAuditLoading(true);
    try {
      const response = await api.getT<RequestAuditEntry[] | { items?: RequestAuditEntry[]; data?: RequestAuditEntry[] }>(`/service-requests/${requestId}/audit`);
      setAuditEntries(normalizeList<RequestAuditEntry>(response));
    } catch { setAuditEntries([]); } finally { setAuditLoading(false); }
  };

  const sendComment = async () => {
    const text = commentText.trim();
    if (!text || !selectedRequest) return;
    setCommentSending(true);
    try { await api.postT(`/service-requests/${selectedRequest.id}/comments`, { text }); setCommentText(''); await loadComments(selectedRequest.id); }
    catch { toast.error('Не удалось отправить'); } finally { setCommentSending(false); }
  };

  const improveDescription = async (form: 'create' | 'edit') => {
    if (!canUseAiDescriptionImprove) return;
    const text = (form === 'create' ? createForm : editForm).description.trim();
    if (!text || text.length < 5) return;
    setAiDescLoading(true);
    try {
      const r = await api.postT<{ reply: string }>('/ai/chat', {
        messages: [{ role: 'user', content: `Перепиши описание сервисной заявки: исправь ошибки, сделай формулировки чёткими и профессиональными. НЕ добавляй шаблонный текст, НЕ придумывай информацию, НЕ добавляй общие описания систем. Работай только с тем текстом что дан. Если текст короткий — просто улучши формулировку. Верни только готовый текст без пояснений:\n\n${text}` }],
      });
      if (r?.reply) {
        const setter = form === 'create' ? setCreateForm : setEditForm;
        setter((p) => ({ ...p, description: r.reply }));
      }
    } catch { toast.error('AI недоступен'); }
    finally { setAiDescLoading(false); }
  };

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [comments]);

  const getItemSystems = (itemIds: string[]) => {
    const systems = new Set<SystemType>();
    directionItems.filter((i) => itemIds.includes(i.id)).forEach((i) => {
      if (i.systems) Object.entries(i.systems).forEach(([k, v]) => { if (v) systems.add(k as SystemType); });
    });
    return Array.from(systems);
  };

  const selectedItemSystems = useMemo(() => getItemSystems(editForm.itemIds), [directionItems, editForm.itemIds]);
  const createItemSystems = useMemo(() => getItemSystems(createForm.itemIds), [directionItems, createForm.itemIds]);

  const toggleFormField = (form: 'create' | 'edit', field: 'executorIds' | 'itemIds', id: string) => {
    const setter = form === 'create' ? setCreateForm : setEditForm;
    setter((p) => ({
      ...p,
      [field]: p[field].includes(id) ? p[field].filter((x) => x !== id) : [...p[field], id],
    }));
  };

  useEffect(() => {
    let cancelled = false;
    void loadAll()
      .catch(() => { if (!cancelled) { setError('Не удалось загрузить сервисные заявки.'); toast.error('Не удалось загрузить сервисные заявки.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    void loadCustomFieldDefinitions();
    return () => { cancelled = true; };
  }, [toast]);

  const loadSavedViews = useCallback(async () => {
    setViewsLoading(true);
    try {
      const result = await api.getT<SavedViewsResponse>('/service-requests/views');
      setSavedViews(result.items || []);
      setDefaultViewId(result.defaultViewId || '');
      if (!currentViewId && result.defaultViewId) {
        setCurrentViewId(result.defaultViewId);
      }
    } catch {
      toast.error('Не удалось загрузить сох��аненные виды.');
    } finally {
      setViewsLoading(false);
    }
  }, [toast, currentViewId]);

  useEffect(() => {
    void loadSavedViews();
  }, []);

  const applyView = useCallback((view: SavedView) => {
    const params = new URLSearchParams();
    if (view.params.search) params.set('search', view.params.search);
    if (view.params.status) params.set('status', view.params.status);
    if (view.params.priority) params.set('priority', view.params.priority);
    if (view.params.executor) params.set('executor', view.params.executor);
    setSearchParams(params);
    setCurrentViewId(view.id);
  }, [setSearchParams]);

  const saveCurrentView = async () => {
    if (!viewFormName.trim()) {
      toast.error('Введите название вида.');
      return;
    }
    try {
      const params = {
        search: search || '',
        status: statusFilter || '',
        priority: priorityFilter || '',
        executor: executorFilter || '',
      };
      if (editingViewId) {
        await api.patchT(`/service-requests/views/${editingViewId}`, {
          name: viewFormName,
          params,
          isDefault: viewFormDefault,
        });
        toast.success('Вид обновлен.');
      } else {
        await api.postT('/service-requests/views', {
          name: viewFormName,
          params,
          isDefault: viewFormDefault,
        });
        toast.success('Вид сохранен.');
      }
      await loadSavedViews();
      setIsViewModalOpen(false);
      setViewFormName('');
      setViewFormDefault(false);
      setEditingViewId(null);
    } catch {
      toast.error('Не удалось сохранить вид.');
    }
  };

  const deleteView = async (viewId: string) => {
    try {
      await api.deleteT(`/service-requests/views/${viewId}`);
      toast.success('Вид удален.');
      await loadSavedViews();
      if (currentViewId === viewId) {
        setCurrentViewId(defaultViewId);
      }
    } catch {
      toast.error('Не удалось удалить вид.');
    }
  };

  const openSaveViewModal = () => {
    setViewFormName('');
    setViewFormDefault(false);
    setEditingViewId(null);
    setIsViewModalOpen(true);
  };

  const openEditViewModal = (view: SavedView) => {
    setViewFormName(view.name);
    setViewFormDefault(view.isDefault || false);
    setEditingViewId(view.id);
    setIsViewModalOpen(true);
  };

  useEffect(() => {
    if (!AI_FEATURE_ENABLED || !isCreateOpen) { setAiSuggestions(null); setAiLoading(false); return; }
    const d = createForm.description.trim();
    if (d.length <= 20) { setAiSuggestions(null); return; }
    const t = window.setTimeout(() => { void requestAiSuggestions(d, createForm.files); }, 1500);
    return () => { window.clearTimeout(t); };
  }, [createForm.description, isCreateOpen]);

  // Auto-classification: debounce 1 second after description changes
  useEffect(() => {
    if (!AI_FEATURE_ENABLED || !isCreateOpen) { setAiClassification(null); setAiClassifyLoading(false); return; }
    const d = createForm.description.trim();
    if (d.length < 10 && createForm.title.trim().length < 3) { setAiClassification(null); return; }
    const t = window.setTimeout(() => { void requestAiClassification(createForm.title, createForm.description); }, 1000);
    return () => { window.clearTimeout(t); };
  }, [createForm.description, createForm.title, isCreateOpen, requestAiClassification]);

  useEffect(() => {
    if (isEditOpen) { void loadDirectionItems(editForm.directionId); }
  }, [editForm.directionId, isEditOpen]);

  useEffect(() => {
    if (isCreateOpen) { void loadDirectionItems(createForm.directionId); }
  }, [createForm.directionId, isCreateOpen]);

  const onAcceptAiSuggestion = (field: 'type' | 'systemType' | 'priority', value: string) => {
    if (!value) return;
    setCreateForm((p) => ({ ...p, [field]: value }));
  };

  const filteredRequests = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return requests.filter((r) => {
      if (typeFilter && r.type !== typeFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (priorityFilter && r.priority !== priorityFilter) return false;
      if (executorFilter && !r.executorIds?.includes(executorFilter)) return false;
      if (dateFrom && r.createdAt && r.createdAt.slice(0, 10) < dateFrom) return false;
      if (dateTo && r.createdAt && r.createdAt.slice(0, 10) > dateTo) return false;
      if (!term) return true;
      return String(r.title || '').toLowerCase().includes(term) || String(r.description || '').toLowerCase().includes(term);
    });
  }, [requests, debouncedSearch, typeFilter, statusFilter, priorityFilter, executorFilter, dateFrom, dateTo]);

  const stats = useMemo(() => {
    const total = requests.length;
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    let overdueCount = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const r of requests) {
      byStatus[r.status || 'unknown'] = (byStatus[r.status || 'unknown'] || 0) + 1;
      byPriority[r.priority || 'unknown'] = (byPriority[r.priority || 'unknown'] || 0) + 1;
      if ((r as any).isOverdue === true) { overdueCount++; continue; }
      const deadline = (r as any).dueDatePreliminary;
      const visit = (r as any).visitDate;
      const notClosed = !['done', 'closed', 'cancelled'].includes(r.status || '');
      if (notClosed && ((deadline && deadline < today) || (visit && visit < today))) overdueCount++;
    }
    return { total, byStatus, byPriority, overdueCount };
  }, [requests]);

  const loadAiSummary = async () => {
    if (!canUseAiSummary) return;
    if (!AI_FEATURE_ENABLED || requests.length === 0) return;
    setAiSummaryLoading(true);
    try {
      const snapshot = requests.slice(0, 30).map((r) => `${r.title || '-'} [${REQUEST_STATUS_LABELS[r.status || ''] || r.status}] [${PRIORITY_LABELS[r.priority || ''] || r.priority}]`).join('\n');
      const r = await api.postT<{ reply: string }>('/ai/chat', {
        messages: [{ role: 'user', content: `Кратко (3-5 предложений) опиши текущую ситуацию по сервисным заявкам. Выдели ключевые проблемы и что требует внимания. Без шаблонных фраз, только факты:\n\nВсего заявок: ${stats.total}\nПросрочено: ${stats.overdueCount}\nПо статусам: ${Object.entries(stats.byStatus).map(([k, v]) => `${REQUEST_STATUS_LABELS[k] || k}: ${v}`).join(', ')}\n\nЗаявки:\n${snapshot}` }],
      });
      if (r?.reply) setAiSummary(r.reply);
    } catch { /* ignore */ }
    finally { setAiSummaryLoading(false); }
  };

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await api.postT('/service-requests', {
        title: createForm.title, description: createForm.description, type: createForm.type,
        directionId: createForm.directionId || null, systemType: createForm.systemType || null,
        priority: createForm.priority, executorIds: createForm.executorIds, itemIds: createForm.itemIds,
        dueDatePreliminary: createForm.dueDatePreliminary || null,
        visitDate: createForm.visitDate || null,
        files: createForm.files,
      });
      setCreateForm(INITIAL_FORM); setAiSuggestions(null); setAiClassification(null); setIsCreateOpen(false);
      await loadAll(); toast.success('Сервисная заявка создана.');
    } catch { setError('Не удалось создать.'); toast.error('Не удалось создать.'); }
    finally { setSaving(false); }
  };

  const closeEditModal = () => {
    setIsEditOpen(false); setSelectedRequest(null); setAiSimilarSuggestions([]);
    setComments([]); setEditFullscreen(false); setChatOpen(false); setDescFullscreen(false);
    setAuditEntries([]); setAuditLoading(false);
  };

  const onRowClick = (item: ServiceRequest) => {
    setAiSimilarSuggestions([]); setComments([]); setCommentText('');
    setAuditEntries([]);
    setDirectionItems([]); setEditFullscreen(false); setChatOpen(false); setDescFullscreen(false);
    setSelectedRequest(item);
    setEditForm({
      title: item.title || '', description: item.description || '',
      type: item.type || 'maintenance_planned', directionId: item.directionId || '',
      systemType: item.systemType || '', priority: item.priority || 'medium',
      executorIds: Array.isArray(item.executorIds) ? item.executorIds : [],
      itemIds: Array.isArray(item.itemIds) ? item.itemIds : [],
      status: item.status || 'triage',
      dueDatePreliminary: (item as any).dueDatePreliminary || '',
      visitDate: (item as any).visitDate || '',
      files: Array.isArray((item as any).files) ? (item as any).files : [],
    });
    setIsEditOpen(true);
    void loadComments(item.id);
    void loadAudit(item.id);
    if (AI_FEATURE_ENABLED) { void loadSimilarSuggestions(item); }
  };

  useEffect(() => {
    const focusId = searchParams.get('focus');
    if (!focusId || loading || requests.length === 0 || isEditOpen) return;
    const focusRequest = requests.find((item) => item.id === focusId);
    if (!focusRequest) return;
    onRowClick(focusRequest);
    const params = new URLSearchParams(searchParams);
    params.delete('focus');
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams, requests, loading, isEditOpen]);

  const onUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selectedRequest) return;
    if (!canEditRequest) return;
    setSaving(true); setError('');
    try {
      await api.patchT(`/service-requests/${selectedRequest.id}`, {
        title: editForm.title, description: editForm.description, type: editForm.type,
        directionId: editForm.directionId || null, systemType: editForm.systemType || null,
        priority: editForm.priority, executorIds: editForm.executorIds, itemIds: editForm.itemIds,
        dueDatePreliminary: editForm.dueDatePreliminary || null,
        visitDate: editForm.visitDate || null,
        files: editForm.files,
      });
      if (editForm.status && editForm.status !== (selectedRequest.status || '')) {
        await api.patchT(`/service-requests/${selectedRequest.id}/status`, { status: editForm.status });
      }
      closeEditModal(); await loadAll(); toast.success('Заявка обновлена.');
    } catch { setError('Не удалось обновить.'); toast.error('Не удалось обновить.'); }
    finally { setSaving(false); }
  };

  const onDeleteClick = (event: MouseEvent, request: ServiceRequest) => { event.stopPropagation(); setDeleteTarget(request); };
  const onConfirmDelete = async () => {
    if (!deleteTarget) return; setError('');
    try { await api.delT(`/service-requests/${deleteTarget.id}`); await loadAll(); toast.success('Заявка удалена.'); }
    catch { setError('Не удалось удалить.'); toast.error('Не удалось удалить.'); }
    finally { setDeleteTarget(null); }
  };

  const renderExecutorNames = (ids: string[] | undefined) => {
    if (!Array.isArray(ids) || ids.length === 0) return '-';
    const names = ids.map((id) => userNameById[id]).filter(Boolean);
    if (names.length > 0) return names.join(', ');
    return canOpenUserDirectory ? ids.join(', ') : `Назначено: ${ids.length}`;
  };

  const formatAuditTimestamp = (value: string | undefined) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('ru-RU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatAuditValue = (field: string, value: unknown): string => {
    if (value === null || value === undefined || value === '') return 'не указано';
    if (field === 'action') {
      const action = String(value);
      return AUDIT_ACTION_LABELS[action] || action;
    }
    if (field === 'status') {
      const status = String(value);
      return REQUEST_STATUS_LABELS[status] || status;
    }
    if (field === 'priority') {
      const priority = String(value);
      return PRIORITY_LABELS[priority] || priority;
    }
    if (field === 'description') return 'обновлено';
    if (field === 'dueDate' || field === 'visitDate') {
      const date = new Date(String(value));
      if (!Number.isNaN(date.getTime())) return date.toLocaleDateString('ru-RU');
      return String(value);
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return 'не выбрано';
      if (field === 'executorIds') {
        return value.map((id) => userNameById[String(id)] || String(id)).join(', ');
      }
      if (field === 'itemIds') {
        return value.map((id) => itemNameById[String(id)] || String(id)).join(', ');
      }
      return value.map((item) => String(item)).join(', ');
    }
    if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch { return 'изменено'; }
    }
    return String(value);
  };

  const buildAuditLines = (entry: RequestAuditEntry): string[] => {
    if (!entry.changes || typeof entry.changes !== 'object' || Array.isArray(entry.changes)) {
      return ['Изменения зафиксированы'];
    }
    const lines: string[] = [];
    for (const [field, changeRaw] of Object.entries(entry.changes)) {
      const label = AUDIT_FIELD_LABELS[field] || field;
      if (changeRaw && typeof changeRaw === 'object' && !Array.isArray(changeRaw) && ('from' in changeRaw || 'to' in changeRaw)) {
        const change = changeRaw as RequestAuditChange;
        const fromValue = formatAuditValue(field, change.from);
        const toValue = formatAuditValue(field, change.to);
        if (field === 'description') {
          lines.push('Описание обновлено');
        } else if (field === 'action') {
          lines.push(`${label}: ${toValue}`);
        } else if (fromValue === toValue) {
          lines.push(`${label}: ${toValue}`);
        } else {
          lines.push(`${label}: ${fromValue} -> ${toValue}`);
        }
        continue;
      }
      lines.push(`${label}: ${formatAuditValue(field, changeRaw)}`);
    }
    return lines.length > 0 ? lines : ['Изменения зафиксированы'];
  };

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-red-900/30 dark:disabled:bg-slate-800/60 dark:disabled:text-slate-400';
  const selectCls = inputCls;
  const labelCls = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';

  return (
    <div className="space-y-3 sm:space-y-6">
      <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Сервисные заявки' }]} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">Сервисные заявки</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {canExportRequests ? (
            <button type="button" onClick={() => void downloadCsv()} disabled={exporting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:w-auto">
              <Download size={16} />{exporting ? 'Скачиваю...' : 'Скачать Excel'}
            </button>
          ) : null}
          {AI_FEATURE_ENABLED && canUseAiSummary ? (
            <button type="button" onClick={() => void loadAiSummary()} disabled={aiSummaryLoading || requests.length === 0}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:w-auto">
              <Sparkles size={16} />{aiSummaryLoading ? 'Анализ...' : 'AI сводка'}
            </button>
          ) : null}
          {canCreateRequest ? (
            <button type="button" onClick={() => { setAiSuggestions(null); setAiLoading(false); setAiClassification(null); setAiClassifyLoading(false); setIsCreateOpen(true); }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 sm:w-auto">
              <Plus size={16} />Создать
            </button>
          ) : null}
        </div>
      </div>

      {/* Stats cards */}
      {!loading ? (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-4 lg:grid-cols-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-slate-400">Всего</p>
            <p className="mt-1 text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-3 sm:p-4 dark:border-yellow-900/40 dark:bg-yellow-950/20">
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-yellow-600 dark:text-yellow-400">В работе</p>
            <p className="mt-1 text-xl sm:text-2xl font-bold text-yellow-700 dark:text-yellow-300">{(stats.byStatus['in_progress'] || 0) + (stats.byStatus['on_site'] || 0)}</p>
          </div>
          <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-3 sm:p-4 dark:border-cyan-900/40 dark:bg-cyan-950/20">
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-cyan-600 dark:text-cyan-400">Назначено</p>
            <p className="mt-1 text-xl sm:text-2xl font-bold text-cyan-700 dark:text-cyan-300">{(stats.byStatus['assigned'] || 0) + (stats.byStatus['triage'] || 0) + (stats.byStatus['new'] || 0)}</p>
          </div>
          <div className="rounded-2xl border border-green-200 bg-green-50 p-3 sm:p-4 dark:border-green-900/40 dark:bg-green-950/20">
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-green-600 dark:text-green-400">Выполнено</p>
            <p className="mt-1 text-xl sm:text-2xl font-bold text-green-700 dark:text-green-300">{(stats.byStatus['done'] || 0) + (stats.byStatus['closed'] || 0)}</p>
          </div>
          <div className="col-span-2 sm:col-span-1 rounded-2xl border border-red-200 bg-red-50 p-3 sm:p-4 dark:border-red-900/40 dark:bg-red-950/20">
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">Просрочено</p>
            <p className="mt-1 text-xl sm:text-2xl font-bold text-red-700 dark:text-red-300">{stats.overdueCount}</p>
          </div>
        </div>
      ) : null}

      {/* AI Summary */}
      {aiSummary ? (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-900/40 dark:bg-indigo-950/20">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-indigo-500" />
              <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">AI сводка</span>
            </div>
            <button type="button" onClick={() => setAiSummary('')} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-xs text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          </div>
          <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">{aiSummary}</p>
        </div>
      ) : null}

      {/* Saved Views */}
      {!loading && savedViews.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Виды:</span>
          {savedViews.map((view) => (
            <div key={view.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => applyView(view)}
                className={[
                  'rounded-lg px-3 py-2 min-h-[44px] text-xs font-medium transition',
                  currentViewId === view.id
                    ? 'bg-red-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
                ].join(' ')}
              >
                {view.name}
              </button>
              {!view.isSystem && canManage ? (
                <div className="flex gap-0.5">
                  <button
                    type="button"
                    onClick={() => openEditViewModal(view)}
                    className="rounded p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    title="Редактировать"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteView(view.id)}
                    className="rounded p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-xs text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                    title="Удалить"
                  >
                    ×
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {canManage ? (
            <button
              type="button"
              onClick={openSaveViewModal}
              className="rounded-lg border border-dashed border-slate-300 px-3 py-2 min-h-[44px] text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600"
            >
              + Сохранить вид
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Filters */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
        <div className="relative sm:col-span-2 md:col-span-2">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input value={search} onChange={(e) => updateFilter('search', e.target.value)} placeholder="Поиск..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <select value={statusFilter} onChange={(e) => updateFilter('status', e.target.value)} className={selectCls}>
          <option value="">Все статусы</option>
          {Object.entries(REQUEST_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={priorityFilter} onChange={(e) => updateFilter('priority', e.target.value)} className={selectCls}>
          <option value="">Все приоритеты</option>
          {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
        <select value={typeFilter} onChange={(e) => updateFilter('type', e.target.value)} className={selectCls}>
          <option value="">Все типы</option>
          {Object.entries(REQUEST_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={executorFilter} onChange={(e) => updateFilter('executor', e.target.value)} className={selectCls}>
          <option value="">Все исполнители</option>
          {users.filter((u) => u.role === 'executor' || u.role === 'installer').map((u) => (
            <option key={u.id} value={u.id}>{u.fullName || u.email}</option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 whitespace-nowrap">с</label>
          <input type="date" value={dateFrom} onChange={(e) => updateFilter('dateFrom', e.target.value)} className={inputCls} />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 whitespace-nowrap">по</label>
          <input type="date" value={dateTo} onChange={(e) => updateFilter('dateTo', e.target.value)} className={inputCls} />
        </div>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</div> : null}

      {/* Mobile card list */}
      <div className="space-y-2 sm:hidden">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="animate-pulse space-y-3">
              {[1,2,3,4,5].map((i) => <div key={i} className="h-20 rounded-xl bg-slate-100 dark:bg-slate-800" />)}
            </div>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-3 py-12 text-center dark:border-slate-800 dark:bg-slate-900">
            <Search size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-500 dark:text-slate-400">Ничего не найдено</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">Попробуйте изменить фильтры</p>
          </div>
        ) : filteredRequests.map((r) => {
          const notClosed = !['done', 'closed', 'cancelled'].includes(r.status || '');
          const visitRaw = (r as any).visitDate;
          const deadlineRaw = (r as any).dueDatePreliminary;
          const clientAction = String(r.clientAction || '').toLowerCase();
          const clientActionLabel = CLIENT_ACTION_LABELS[clientAction] || '';
          const visitDate = visitRaw ? new Date(visitRaw).toLocaleDateString('ru-RU') : null;
          const deadlineDate = deadlineRaw ? new Date(deadlineRaw).toLocaleDateString('ru-RU') : null;
          const todayStr = new Date().toISOString().slice(0, 10);
          const deadlinePast = deadlineRaw && deadlineRaw < todayStr;
          const visitPast = visitRaw && visitRaw < todayStr;
          const isOverdue = (r as any).isOverdue === true || (notClosed && (deadlinePast || visitPast));
          return (
            <div key={r.id} onClick={() => onRowClick(r)}
              className={['cursor-pointer rounded-xl border bg-white p-3 transition active:bg-slate-50 dark:bg-slate-900', isOverdue ? 'border-red-200 bg-red-50/40 dark:border-red-900/40 dark:bg-red-950/10' : 'border-slate-200 dark:border-slate-800'].join(' ')}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  {isOverdue ? <span className="shrink-0 h-2 w-2 rounded-full bg-red-500" title="Просрочено" /> : null}
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">{r.title || '-'}</span>
                </div>
                {canManage ? (
                  <button type="button" onClick={(e) => onDeleteClick(e, r)}
                    className="shrink-0 rounded-lg p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40">
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                <span>{REQUEST_TYPE_LABELS[r.type || ''] || r.type || '-'}</span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span className="truncate max-w-[140px]">{directionNameById[r.directionId || ''] || '-'}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <span className={['inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight', PRIORITY_COLORS[r.priority || ''] || 'bg-slate-100 text-slate-600'].join(' ')}>
                  {PRIORITY_LABELS[r.priority || ''] || r.priority || '-'}
                </span>
                <span className={['inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight', isOverdue ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : (STATUS_COLORS[r.status || ''] || 'bg-slate-100 text-slate-600')].join(' ')}>
                  {isOverdue ? 'Просрочено' : (REQUEST_STATUS_LABELS[r.status || ''] || r.status || '-')}
                </span>
                {clientActionLabel ? (
                  <span className={['inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight', CLIENT_ACTION_COLORS[clientAction] || 'bg-slate-100 text-slate-600'].join(' ')}>
                    {clientActionLabel}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] leading-tight">
                {visitDate ? <span className={visitPast && notClosed ? 'text-red-500 font-semibold' : 'text-green-600 dark:text-green-400'}>▸ Выезд: {visitDate}</span> : null}
                {deadlineDate ? <span className={deadlinePast ? 'text-red-500 font-semibold' : 'text-orange-500 dark:text-orange-400'}>◆ Дедлайн: {deadlineDate}</span> : null}
                <span className="text-slate-400">Создана: {r.createdAt ? new Date(r.createdAt).toLocaleDateString('ru-RU') : '-'}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop Table */}
      <div className="hidden sm:block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/50">
                {['Заявка','Приоритет / Статус','Даты',''].map((h) => (
                  <th key={h} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {loading ? <SkeletonTable rows={5} cols={4} /> : (
                <>
                  {filteredRequests.map((r) => {
                    const notClosed = !['done', 'closed', 'cancelled'].includes(r.status || '');
                    const visitRaw = (r as any).visitDate;
                    const deadlineRaw = (r as any).dueDatePreliminary;
                    const clientAction = String(r.clientAction || '').toLowerCase();
                    const clientActionLabel = CLIENT_ACTION_LABELS[clientAction] || '';
                    const clientActionDate = r.clientActionAt
                      ? new Date(r.clientActionAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                      : '';
                    const visitDate = visitRaw ? new Date(visitRaw).toLocaleDateString('ru-RU') : null;
                    const deadlineDate = deadlineRaw ? new Date(deadlineRaw).toLocaleDateString('ru-RU') : null;
                    const todayStr = new Date().toISOString().slice(0, 10);
                    const deadlinePast = deadlineRaw && deadlineRaw < todayStr;
                    const visitPast = visitRaw && visitRaw < todayStr;
                    const isOverdue = (r as any).isOverdue === true || (notClosed && (deadlinePast || visitPast));
                    return (
                    <tr key={r.id} className={['cursor-pointer transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40', isOverdue ? 'bg-red-50/40 dark:bg-red-950/10' : ''].join(' ')} onClick={() => onRowClick(r)}>
                      {/* Заявка: название + тип/направление/исполнители */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {isOverdue ? <span className="shrink-0 h-2 w-2 rounded-full bg-red-500" title="Просрочено" /> : null}
                          <span className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[280px]">{r.title || '-'}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          <span>{REQUEST_TYPE_LABELS[r.type || ''] || r.type || '-'}</span>
                          <span className="text-slate-300 dark:text-slate-600">·</span>
                          <span className="truncate max-w-[140px]">{directionNameById[r.directionId || ''] || '-'}</span>
                          {renderExecutorNames(r.executorIds) !== '-' ? (
                            <>
                              <span className="text-slate-300 dark:text-slate-600">·</span>
                              <span className="truncate max-w-[160px]">{renderExecutorNames(r.executorIds)}</span>
                            </>
                          ) : null}
                        </div>
                      </td>
                      {/* Приоритет + Статус */}
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-1">
                          <span className={['inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight', PRIORITY_COLORS[r.priority || ''] || 'bg-slate-100 text-slate-600'].join(' ')}>
                            {PRIORITY_LABELS[r.priority || ''] || r.priority || '-'}
                          </span>
                          <span className={['inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight', isOverdue ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : (STATUS_COLORS[r.status || ''] || 'bg-slate-100 text-slate-600')].join(' ')}>
                            {isOverdue ? 'Просрочено' : (REQUEST_STATUS_LABELS[r.status || ''] || r.status || '-')}
                          </span>
                          {clientActionLabel ? (
                            <span
                              title={clientActionDate ? `Клиент: ${clientActionDate}` : 'Клиентское действие'}
                              className={['inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight', CLIENT_ACTION_COLORS[clientAction] || 'bg-slate-100 text-slate-600'].join(' ')}>
                              {clientActionLabel}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      {/* Даты */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex flex-col gap-0.5 text-[11px] leading-tight">
                          {visitDate ? <span className={visitPast && notClosed ? 'text-red-500 font-semibold' : 'text-green-600 dark:text-green-400'}>▸ Выезд: {visitDate}</span> : null}
                          {deadlineDate ? <span className={deadlinePast ? 'text-red-500 font-semibold' : 'text-orange-500 dark:text-orange-400'}>◆ Дедлайн: {deadlineDate}</span> : null}
                          <span className="text-slate-400">Создана: {r.createdAt ? new Date(r.createdAt).toLocaleDateString('ru-RU') : '-'}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        {canManage ? (
                          <button type="button" onClick={(e) => onDeleteClick(e, r)}
                            className="rounded-lg p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40">
                            <Trash2 size={14} />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    );
                  })}
                  {filteredRequests.length === 0 ? <tr><td colSpan={4} className="px-3 py-12 text-center"><Search size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" /><p className="text-sm text-slate-500 dark:text-slate-400">Ничего не найдено</p><p className="text-xs text-slate-400 dark:text-slate-500">Попробуйте изменить фильтры</p></td></tr> : null}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      <Modal isOpen={isCreateOpen} onClose={() => { setIsCreateOpen(false); setAiSuggestions(null); setAiLoading(false); setAiClassification(null); setAiClassifyLoading(false); }} title="Создание сервисной заявки">
        <form onSubmit={onCreate} className="space-y-5">
          <div>
            <label className={labelCls}>Название</label>
            <input required minLength={2} value={createForm.title} onChange={(e) => setCreateForm((p) => ({ ...p, title: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
              <label className={labelCls}>Описание</label>
              <div className="flex flex-wrap items-center gap-1.5">
                {AI_FEATURE_ENABLED ? (
                  <>
                    {canUseAiDescriptionImprove ? (
                      <button type="button" onClick={() => void improveDescription('create')} disabled={aiDescLoading || createForm.description.trim().length < 5}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 min-h-[44px] text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
                        <Sparkles size={12} />{aiDescLoading ? 'Улучшаю...' : 'AI улучшить'}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => void requestAiSuggestions(createForm.description, createForm.files)} disabled={aiLoading || createForm.description.trim().length < 3}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 min-h-[44px] text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
                      <Sparkles size={12} />AI-подсказка
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            <Editor
              licenseKey="gpl"
              tinymceScriptSrc="/tinymce/tinymce.min.js"
              value={createForm.description}
              onEditorChange={(content) => setCreateForm((p) => ({ ...p, description: content }))}
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
            {AI_FEATURE_ENABLED ? <AiSuggestionBadges suggestions={aiSuggestions} loading={aiLoading} onAccept={onAcceptAiSuggestion} /> : null}
            {AI_FEATURE_ENABLED && (aiClassifyLoading || aiClassification) ? (
              <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-900/60 dark:bg-indigo-950/30">
                {aiClassifyLoading ? (
                  <p className="text-xs text-indigo-600 dark:text-indigo-400">AI классифицирует заявку...</p>
                ) : aiClassification ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">AI-классификация (нажмите для применения):</p>
                    <div className="flex flex-wrap gap-1.5">
                      {aiClassification.type.confidence > 0.3 && aiClassification.type.value !== createForm.type ? (
                        <button type="button" onClick={() => setCreateForm((p) => ({ ...p, type: aiClassification.type.value }))}
                          className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60">
                          Тип: {REQUEST_TYPE_LABELS[aiClassification.type.value] || aiClassification.type.value}
                          <span className="opacity-60">({Math.round(aiClassification.type.confidence * 100)}%)</span>
                        </button>
                      ) : null}
                      {aiClassification.priority.confidence > 0.3 && aiClassification.priority.value !== createForm.priority ? (
                        <button type="button" onClick={() => setCreateForm((p) => ({ ...p, priority: aiClassification.priority.value }))}
                          className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60">
                          Приоритет: {PRIORITY_LABELS[aiClassification.priority.value] || aiClassification.priority.value}
                          <span className="opacity-60">({Math.round(aiClassification.priority.confidence * 100)}%)</span>
                        </button>
                      ) : null}
                      {aiClassification.systemType.confidence > 0.3 && aiClassification.systemType.value !== 'other' && aiClassification.systemType.value !== createForm.systemType ? (
                        <button type="button" onClick={() => setCreateForm((p) => ({ ...p, systemType: aiClassification.systemType.value }))}
                          className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60">
                          Система: {SYSTEM_LABELS[aiClassification.systemType.value as SystemType] || aiClassification.systemType.value}
                          <span className="opacity-60">({Math.round(aiClassification.systemType.confidence * 100)}%)</span>
                        </button>
                      ) : null}
                      {aiClassification.suggestedDirection.confidence > 0.3 && aiClassification.suggestedDirection.value ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-indigo-100 bg-white/70 px-2.5 py-1 text-xs text-indigo-600 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400">
                          Направление: {aiClassification.suggestedDirection.value}
                          <span className="opacity-60">({Math.round(aiClassification.suggestedDirection.confidence * 100)}%)</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><label className={labelCls}>Тип</label><select value={createForm.type} onChange={(e) => setCreateForm((p) => ({ ...p, type: e.target.value }))} className={selectCls}>
              {Object.entries(REQUEST_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
            <div><label className={labelCls}>Приоритет</label><select value={createForm.priority} onChange={(e) => setCreateForm((p) => ({ ...p, priority: e.target.value }))} className={selectCls}>
              {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><label className={labelCls}>Направление</label><select value={createForm.directionId} onChange={(e) => setCreateForm((p) => ({ ...p, directionId: e.target.value, itemIds: [] }))} className={selectCls}>
              <option value="">Не выбрано</option>
              {directions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select></div>
            <div><label className={labelCls}>Система</label><select value={createForm.systemType} onChange={(e) => setCreateForm((p) => ({ ...p, systemType: e.target.value }))} className={selectCls}>
              <option value="">Не выбрано</option>
              {Object.values(SystemType).map((s) => <option key={s} value={s}>{SYSTEM_LABELS[s]}</option>)}
            </select></div>
          </div>
          <div>
            <label className={labelCls}>Объекты</label>
            {directionItemsLoading ? <p className="text-xs text-slate-400">Загрузка...</p>
              : directionItems.length === 0 ? <p className="text-xs text-slate-400">Нет объектов</p>
              : <CheckList items={objectItems} selected={createForm.itemIds} onToggle={(id) => toggleFormField('create', 'itemIds', id)} searchPlaceholder="Поиск объекта..." />}
          </div>
          {createItemSystems.length > 0 ? (
            <div>
              <label className={labelCls}>Системы</label>
              <div className="flex flex-wrap gap-1.5">
                {createItemSystems.map((s) => (
                  <span key={s} className="inline-flex rounded-full bg-gradient-to-r from-slate-100 to-slate-50 px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200/60 dark:from-slate-800 dark:to-slate-800/50 dark:text-slate-300 dark:ring-slate-700/60">
                    {SYSTEM_LABELS[s] || s}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><label className={labelCls}>Дата выезда</label>
              <input type="date" value={createForm.visitDate} onChange={(e) => setCreateForm((p) => ({ ...p, visitDate: e.target.value }))} className={inputCls} />
            </div>
            <div><label className={labelCls}>Дедлайн</label>
              <input type="date" value={createForm.dueDatePreliminary} onChange={(e) => setCreateForm((p) => ({ ...p, dueDatePreliminary: e.target.value }))} className={inputCls} />
            </div>
          </div>
          {canManage ? (
            <div>
              <label className={labelCls}>Исполнители</label>
              <CheckList items={executorItems} selected={createForm.executorIds} onToggle={(id) => toggleFormField('create', 'executorIds', id)} searchPlaceholder="Поиск исполнителя..." />
              {canUseAiExecutorSuggestion ? (
                <button type="button" disabled={!createForm.title || !createForm.description || aiExecutorLoading} onClick={() => void requestAiExecutor()}
                  className="mt-2 flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
                  <UserCheck size={14} />
                  {aiExecutorLoading ? 'Подбираю...' : 'AI подобрать'}
                </button>
              ) : null}
              {canUseAiExecutorSuggestion && aiExecutorSuggestion ? (
                <div className="mt-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-900/30">
                  <div className="font-medium text-green-800 dark:text-green-300">{aiExecutorSuggestion.executorName}</div>
                  {aiExecutorSuggestion.reason && <div className="mt-1 text-green-700 dark:text-green-400">{aiExecutorSuggestion.reason}</div>}
                  <button type="button" onClick={() => {
                    if (!createForm.executorIds.includes(aiExecutorSuggestion.executorId)) {
                      setCreateForm((p) => ({ ...p, executorIds: [...p.executorIds, aiExecutorSuggestion.executorId] }));
                    }
                    setAiExecutorSuggestion(null);
                  }} className="mt-2 rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-green-700">
                    Применить
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div>
            <label className={labelCls}>Файлы</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 transition hover:border-brand-red hover:text-brand-red dark:border-slate-600 dark:text-slate-400">
              <Paperclip size={14} />
              {uploading ? 'Загрузка...' : 'Прикрепить файл'}
              <input type="file" multiple className="hidden" disabled={uploading} onChange={(e) => void handleFileSelect('create', e.target.files)} />
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

          {/* Custom Fields */}
          {customFieldDefinitions.length > 0 && (
            <CustomFieldsForm
              fields={customFieldDefinitions}
              values={createForm.customFields || {}}
              onChange={(fieldKey, value) => setCreateForm((p) => ({ ...p, customFields: { ...p.customFields, [fieldKey]: value } }))}
              userRole={role}
              disabled={saving}
            />
          )}

          {/* RAG Suggestions */}
          {(createForm.title || createForm.description) && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <label className={labelCls}>Похожие статьи из базы знаний</label>
                <button
                  type="button"
                  onClick={() => void requestRagSuggestions()}
                  disabled={ragLoading || (!createForm.title && !createForm.description)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <Search size={12} />
                  {ragLoading ? 'Поиск...' : 'Найти похожие'}
                </button>
              </div>
              {ragSuggestions.length > 0 && (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {ragSuggestions.map((suggestion) => (
                    <div key={suggestion.documentId} className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm dark:bg-blue-900/20 dark:border-blue-800">
                      <div className="flex items-start justify-between mb-1">
                        <div className="font-medium text-blue-800 dark:text-blue-300">{suggestion.documentTitle}</div>
                        <div className="text-xs text-blue-600 dark:text-blue-400">{(suggestion.maxSimilarity * 100).toFixed(0)}%</div>
                      </div>
                      {suggestion.chunks.slice(0, 1).map((chunk, idx) => (
                        <div key={idx} className="text-blue-700 dark:text-blue-400 text-xs line-clamp-2">{chunk.content}</div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {ragSuggestions.length === 0 && !ragLoading && (createForm.title || createForm.description) && (
                <p className="text-xs text-slate-400">Нажмите "Найти похожие" для поиска релевантных статей</p>
              )}
            </div>
          )}

          <button type="submit" disabled={saving}
            className="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60">
            {saving ? 'Сохранение...' : 'Создать заявку'}
          </button>
        </form>
      </Modal>

      {/* Description fullscreen */}
      {descFullscreen && isEditOpen ? (
        <div className="fixed inset-0 z-[60] flex flex-col bg-white dark:bg-slate-900">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-3 sm:px-6 sm:py-4 dark:border-slate-800">
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">Описание заявки</h3>
            <button type="button" onClick={() => setDescFullscreen(false)}
              className="rounded-xl p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
              <Minimize2 size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-hidden p-3 sm:p-6">
            {canEditRequest ? (
              <Editor
                licenseKey="gpl"
                tinymceScriptSrc="/tinymce/tinymce.min.js"
                value={editForm.description}
                onEditorChange={(content) => setEditForm((p) => ({ ...p, description: content }))}
                init={{
                  height: '100%',
                  menubar: false,
                  plugins: 'lists table link autolink fullscreen',
                  toolbar: 'bold italic underline | bullist numlist | table link | removeformat',
                  content_style: 'body { font-family: Arial, sans-serif; font-size: 15px; line-height: 1.6; }',
                  branding: false,
                  statusbar: false,
                }}
              />
            ) : (
              <div
                className="h-full overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                dangerouslySetInnerHTML={{ __html: editForm.description || '<p>Описание не заполнено</p>' }}
              />
            )}
          </div>
        </div>
      ) : null}

      {/* Edit Modal */}
      {isEditOpen && selectedRequest && !descFullscreen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={closeEditModal} />
          <div className={[
            'relative flex flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 transition-all duration-200',
            editFullscreen ? 'h-full w-full' : 'h-full w-full sm:h-auto sm:max-h-[92vh] sm:w-[calc(100%-2rem)] sm:max-w-5xl sm:rounded-2xl',
          ].join(' ')}>
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-3 sm:px-6 sm:py-4 dark:border-slate-800">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <h3 className="text-sm sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">{canEditRequest ? 'Редактирование заявки' : 'Просмотр заявки'}</h3>
                <span className={['inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold', STATUS_COLORS[editForm.status] || 'bg-slate-100 text-slate-600'].join(' ')}>
                  {REQUEST_STATUS_LABELS[editForm.status] || editForm.status}
                </span>
              </div>
              <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                <button type="button" onClick={() => setChatOpen((p) => !p)} title="Чат по заявке"
                  className={['rounded-xl p-2 min-w-[44px] min-h-[44px] flex items-center justify-center transition', chatOpen ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800'].join(' ')}>
                  <MessageSquare size={18} />
                </button>
                <button type="button" onClick={() => setEditFullscreen((p) => !p)} title="На весь экран"
                  className="hidden sm:flex rounded-xl p-2 min-w-[44px] min-h-[44px] items-center justify-center text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
                  {editFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button type="button" onClick={closeEditModal}
                  className="rounded-xl p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex min-h-0 flex-1 overflow-hidden relative">
              {/* Form */}
              <div className="flex-1 overflow-y-auto p-3 sm:p-6">
                <form onSubmit={onUpdate} className="space-y-5" id="edit-form">
                  {!canEditRequest ? (
                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300">
                      Для вашей роли карточка заявки доступна только в режиме просмотра.
                    </div>
                  ) : null}
                  <div>
                    <label className={labelCls}>Название</label>
                    <input required minLength={2} disabled={!canEditRequest} value={editForm.title} onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className={labelCls}>Описание</label>
                      <div className="flex items-center gap-1.5">
                        {AI_FEATURE_ENABLED && canUseAiDescriptionImprove ? (
                          <button type="button" onClick={() => void improveDescription('edit')} disabled={aiDescLoading || editForm.description.trim().length < 5}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
                            <Sparkles size={12} />{aiDescLoading ? 'Улучшаю...' : 'AI улучшить'}
                          </button>
                        ) : null}
                        <button type="button" onClick={() => setDescFullscreen(true)} title="На весь экран"
                          className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
                          <Maximize2 size={14} />
                        </button>
                      </div>
                    </div>
                    {canEditRequest ? (
                      <Editor
                        licenseKey="gpl"
                        tinymceScriptSrc="/tinymce/tinymce.min.js"
                        value={editForm.description}
                        onEditorChange={(content) => setEditForm((p) => ({ ...p, description: content }))}
                        init={{
                          height: 250,
                          menubar: false,
                          plugins: 'lists table link autolink',
                          toolbar: 'bold italic underline | bullist numlist | table link | removeformat',
                          content_style: 'body { font-family: Arial, sans-serif; font-size: 14px; }',
                          branding: false,
                          statusbar: false,
                        }}
                      />
                    ) : (
                      <div
                        className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-200"
                        dangerouslySetInnerHTML={{ __html: editForm.description || '<p>Описание не заполнено</p>' }}
                      />
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-3">
                    <div><label className={labelCls}>Тип</label><select disabled={!canEditRequest} value={editForm.type} onChange={(e) => setEditForm((p) => ({ ...p, type: e.target.value }))} className={selectCls}>
                      {Object.entries(REQUEST_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select></div>
                    <div><label className={labelCls}>Приоритет</label><select disabled={!canEditRequest} value={editForm.priority} onChange={(e) => setEditForm((p) => ({ ...p, priority: e.target.value }))} className={selectCls}>
                      {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select></div>
                    <div><label className={labelCls}>Статус</label><select disabled={!canEditRequest} value={editForm.status} onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value }))} className={selectCls}>
                      {Object.entries(REQUEST_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select></div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div><label className={labelCls}>Дата выезда</label>
                      <input type="date" disabled={!canEditRequest} value={editForm.visitDate} onChange={(e) => setEditForm((p) => ({ ...p, visitDate: e.target.value }))} className={inputCls} />
                    </div>
                    <div><label className={labelCls}>Дедлайн</label>
                      <input type="date" disabled={!canEditRequest} value={editForm.dueDatePreliminary} onChange={(e) => setEditForm((p) => ({ ...p, dueDatePreliminary: e.target.value }))} className={inputCls} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div><label className={labelCls}>Направление</label><select disabled={!canEditRequest} value={editForm.directionId} onChange={(e) => setEditForm((p) => ({ ...p, directionId: e.target.value, itemIds: [] }))} className={selectCls}>
                      <option value="">Не выбрано</option>
                      {directions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select></div>
                  </div>

                  <div>
                    <label className={labelCls}>Объекты</label>
                    {directionItemsLoading ? <p className="text-xs text-slate-400">Загрузка...</p>
                      : directionItems.length === 0 ? <p className="text-xs text-slate-400">Нет объектов</p>
                      : canEditRequest
                        ? <CheckList items={objectItems} selected={editForm.itemIds} onToggle={(id) => toggleFormField('edit', 'itemIds', id)} searchPlaceholder="Поиск объекта..." />
                        : (
                          <div className="flex flex-wrap gap-1.5">
                            {editForm.itemIds.length > 0 ? editForm.itemIds.map((itemId) => (
                              <span key={itemId} className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                {itemNameById[itemId] || itemId}
                              </span>
                            )) : <p className="text-xs text-slate-400">Не выбрано</p>}
                          </div>
                        )}
                  </div>

                  {selectedItemSystems.length > 0 ? (
                    <div>
                      <label className={labelCls}>Системы</label>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedItemSystems.map((s) => (
                          <span key={s} className="inline-flex rounded-full bg-gradient-to-r from-slate-100 to-slate-50 px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200/60 dark:from-slate-800 dark:to-slate-800/50 dark:text-slate-300 dark:ring-slate-700/60">
                            {SYSTEM_LABELS[s] || s}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <label className={labelCls}>Исполнители</label>
                    {canEditRequest ? (
                      <CheckList items={executorItems} selected={editForm.executorIds} onToggle={(id) => toggleFormField('edit', 'executorIds', id)} searchPlaceholder="Поиск исполнителя..." />
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {editForm.executorIds.length > 0 ? editForm.executorIds.map((executorId) => (
                          <span key={executorId} className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {userNameById[executorId] || 'Назначенный исполнитель'}
                          </span>
                        )) : <p className="text-xs text-slate-400">Не назначены</p>}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className={labelCls}>Файлы</label>
                    {canEditRequest ? (
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 transition hover:border-brand-red hover:text-brand-red dark:border-slate-600 dark:text-slate-400">
                        <Paperclip size={14} />
                        {uploading ? 'Загрузка...' : 'Прикрепить файл'}
                        <input type="file" multiple className="hidden" disabled={uploading} onChange={(e) => void handleFileSelect('edit', e.target.files)} />
                      </label>
                    ) : null}
                    {editForm.files.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {editForm.files.map((f, i) => (
                          <div key={f.url || i} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-slate-800">
                            <Paperclip size={12} className="shrink-0 text-slate-400" />
                            <span className="truncate text-slate-700 dark:text-slate-300">{f.name}</span>
                            <a href={f.url} download={f.name} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0 text-blue-500 hover:text-blue-700" title="Скачать"><Download size={12} /></a>
                            {canEditRequest ? (
                              <button type="button" onClick={() => setEditForm((p) => ({ ...p, files: p.files.filter((_, fi) => fi !== i) }))} className="shrink-0 text-slate-400 hover:text-red-500" title="Удалить"><X size={12} /></button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* AI Similar */}
                  {AI_FEATURE_ENABLED ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/30">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI-подсказки</p>
                        <button type="button" onClick={() => selectedRequest && void loadSimilarSuggestions(selectedRequest)} disabled={aiSimilarLoading}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-white disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
                          <Sparkles size={12} />Обновить
                        </button>
                      </div>
                      {aiSimilarLoading ? <p className="text-xs text-slate-400">Поиск похожих заявок...</p>
                        : aiSimilarSuggestions.length === 0 ? <p className="text-xs text-slate-400">Похожих не найдено</p>
                        : (
                        <div className="space-y-2">
                          {aiSimilarSuggestions.map((sug) => {
                            const sim = String(sug.similarity || '').toLowerCase();
                            return (
                              <a key={sug.requestId} href={`/service-requests?focus=${encodeURIComponent(sug.requestId)}`} target="_blank" rel="noreferrer"
                                className="block rounded-xl border border-slate-200 bg-white p-3 transition hover:shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{sug.title || sug.requestId}</p>
                                  <span className={['inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold', SIMILARITY_COLORS[sim] || 'bg-slate-100 text-slate-700'].join(' ')}>
                                    {SIMILARITY_LABELS[sim] || 'Средняя'}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-500">{sug.resolution || '-'}</p>
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/30">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">История действий</p>
                      <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-400">{auditEntries.length}</span>
                    </div>
                    {auditLoading ? (
                      <p className="text-xs text-slate-400">Загрузка истории...</p>
                    ) : auditEntries.length === 0 ? (
                      <p className="text-xs text-slate-400">История пока пуста</p>
                    ) : (
                      <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                        {auditEntries.map((entry) => {
                          const lines = buildAuditLines(entry);
                          return (
                            <div key={entry.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{entry.actorName || 'Пользователь'}</p>
                                <p className="text-[11px] text-slate-400">{formatAuditTimestamp(entry.createdAt)}</p>
                              </div>
                              <div className="mt-1.5 space-y-1">
                                {lines.map((line, index) => (
                                  <p key={`${entry.id}-${index}`} className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{line}</p>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Custom Fields */}
                  {customFieldDefinitions.length > 0 && (
                    <CustomFieldsForm
                      fields={customFieldDefinitions}
                      values={editForm.customFields || {}}
                      onChange={(fieldKey, value) => setEditForm((p) => ({ ...p, customFields: { ...p.customFields, [fieldKey]: value } }))}
                      userRole={role}
                      disabled={!canEditRequest || saving}
                    />
                  )}

                  {canEditRequest ? (
                    <button type="submit" disabled={saving}
                      className="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60">
                      {saving ? 'Сохранение...' : 'Сохранить'}
                    </button>
                  ) : null}
                </form>
              </div>

              {/* Chat panel */}
              {chatOpen ? (
                <div className="absolute inset-0 z-10 flex flex-col bg-slate-50/95 backdrop-blur-sm dark:bg-slate-900/95 sm:relative sm:inset-auto sm:z-auto sm:w-80 sm:shrink-0 sm:border-l sm:border-slate-100 sm:bg-slate-50/50 sm:backdrop-blur-none sm:dark:bg-slate-900/50 sm:dark:border-slate-800 lg:w-96">
                  <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <MessageSquare size={15} className="text-slate-400" />
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Чат</span>
                      <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-400">{comments.length}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <a href={`/service-chats?id=${selectedRequest.id}`} className="text-[11px] text-red-600 hover:underline dark:text-red-400">Открыть</a>
                      <button type="button" onClick={() => setChatOpen(false)} className="rounded-lg p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600"><X size={15} /></button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto px-4 py-3">
                    {commentsLoading ? <p className="text-center text-xs text-slate-400">Загрузка...</p>
                      : comments.length === 0 ? (
                        <div className="flex h-full items-center justify-center">
                          <div className="text-center">
                            <MessageSquare size={28} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                            <p className="text-xs text-slate-400">Начните диалог</p>
                          </div>
                        </div>
                      ) : (
                      <div className="space-y-2.5">
                        {comments.map((c) => (
                          <div key={c.id} className="rounded-xl bg-white px-3.5 py-2.5 shadow-sm dark:bg-slate-800">
                            <div className="mb-1 flex items-center gap-2">
                              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{c.authorName}</span>
                              <span className="text-[10px] text-slate-400">{new Date(c.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">{c.text}</p>
                          </div>
                        ))}
                        <div ref={chatEndRef} />
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 border-t border-slate-100 p-3 dark:border-slate-800">
                    <div className="flex gap-2">
                      <input type="text" value={commentText} onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendComment(); } }}
                        placeholder="Сообщение..."
                        className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                      <button type="button" onClick={() => void sendComment()} disabled={commentSending || !commentText.trim()}
                        className="rounded-xl bg-red-600 px-3.5 py-2.5 text-white transition hover:bg-red-700 disabled:opacity-50">
                        <Send size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void onConfirmDelete()}
        title="Удалить сервисную заявку?"
        message="Это действие нельзя отменить."
        confirmLabel="Удалить"
      />

      {/* Save View Modal */}
      <Modal isOpen={isViewModalOpen} onClose={() => { setIsViewModalOpen(false); setEditingViewId(null); }} title={editingViewId ? 'Редактировать вид' : 'Сохранить вид'}>
        <form onSubmit={(e) => { e.preventDefault(); void saveCurrentView(); }} className="space-y-4">
          <div>
            <label className={labelCls}>Название</label>
            <input
              type="text"
              value={viewFormName}
              onChange={(e) => setViewFormName(e.target.value)}
              placeholder="Например: Критические заявки"
              className={inputCls}
              required
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="view-default"
              checked={viewFormDefault}
              onChange={(e) => setViewFormDefault(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-2 focus:ring-red-500"
            />
            <label htmlFor="view-default" className="text-sm text-slate-700 dark:text-slate-300">
              Использовать по умолчанию
            </label>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => { setIsViewModalOpen(false); setEditingViewId(null); }}
              className="rounded-xl border border-slate-200 px-4 py-3 sm:py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="rounded-xl bg-red-600 px-4 py-3 sm:py-2 text-sm font-semibold text-white transition hover:bg-red-700"
            >
              {editingViewId ? 'Обновить' : 'Сохранить'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
