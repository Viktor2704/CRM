import { useCallback, useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import { Check, Download, Paperclip, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { Editor } from '@tinymce/tinymce-react';
import { useSearchParams } from 'react-router-dom';
import Modal from '@/components/Modal';
import { InstallationDetailModal } from '@/pages/InstallationDetail';
import Breadcrumbs from '@/components/Breadcrumbs';
import ConfirmDialog from '@/components/ConfirmDialog';
import { SkeletonTable } from '@/components/Skeleton';
import { api, buildApiUrl, getAccessToken, uploadFileT } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import type { Tenant, User } from '@/types';
import { usePermissions } from '@/hooks/usePermissions';
import { useDebounce } from '@/hooks/useDebounce';
import {
  getInstallationStage,
  INSTALLATION_STAGE_BADGE_CLASSES,
  INSTALLATION_STAGE_LABELS,
  INSTALLATION_STAGE_VALUES,
  isInstallationClosedStage,
} from '@/pages/installation/meta';
import { normalizeList } from '@/utils/normalize';

type FileAttachment = { id?: string; name: string; url: string; mimeType?: string; sizeBytes?: number };

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
  systemType?: string;
  createdAt?: string;
};

type ListResponse<T> = T[] | { items?: T[]; data?: T[] };

type InstallationForm = {
  title: string;
  description: string;
  tenantId: string;
  priority: string;
  executorIds: string[];
  dueDatePreliminary: string;
  address: string;
  files: FileAttachment[];
};

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

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Критический',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  low: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300',
};

const INITIAL_FORM: InstallationForm = {
  title: '',
  description: '',
  tenantId: '',
  priority: 'medium',
  executorIds: [],
  dueDatePreliminary: '',
  address: '',
  files: [],
};

const getExecutorIds = (inst: Installation) => {
  if (Array.isArray(inst.executorIds)) return inst.executorIds;
  if (Array.isArray(inst.responsibleIds)) return inst.responsibleIds;
  return [];
};

export default function InstallationsPage() {
  const toast = useToast();
  const { canManage } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedInstId, setSelectedInstId] = useState<string | null>(null);
  const search = searchParams.get('search') || '';
  const debouncedSearch = useDebounce(search);
  const statusFilter = searchParams.get('status') || '';
  const systemTypeFilter = searchParams.get('systemType') || '';

  const [installations, setInstallations] = useState<Installation[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Installation | null>(null);
  const [createForm, setCreateForm] = useState<InstallationForm>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [aiDescLoading, setAiDescLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

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

  const generateAiDescription = useCallback(async () => {
    if (!createForm.title.trim() && createForm.files.length === 0) { toast.error('Введите название или прикрепите файлы'); return; }
    setAiDescLoading(true);
    try {
      const result = await api.postT<{ plan: string }>('/ai/generate-installation', {
        projectTitle: createForm.title,
        projectDescription: createForm.description || '',
        address: createForm.address || '',
        files: createForm.files,
      });
      if (result.plan) {
        setCreateForm((p) => ({ ...p, description: result.plan }));
        toast.success('Описание сгенерировано');
      }
    } catch {
      toast.error('Не удалось сгенерировать описание');
    } finally { setAiDescLoading(false); }
  }, [createForm.title, createForm.description, createForm.files, toast]);

  const contractorTenants = useMemo(() => tenants.filter((t) => t.type === 'contractor'), [tenants]);

  const contractorItems = useMemo(() => contractorTenants.map((t) => ({
    id: t.id,
    label: t.brandName || t.name || t.id,
    sub: t.inn || undefined,
  })), [contractorTenants]);

  const executorItems = useMemo(() => users.map((u) => ({
    id: u.id,
    label: u.fullName || u.email || u.id,
    sub: u.companyName || undefined,
  })), [users]);

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-red-900/30';
  const selectCls = inputCls;
  const labelCls = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';

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
    return tenantNameById[tenantId] || (canManage ? tenantId : 'Компания монтажа');
  };

  const loadAll = async () => {
    setError('');
    const [instRaw, tenantsRaw, usersRaw] = await Promise.all([
      api.getT<ListResponse<Installation>>('/installations'),
      canManage
        ? api.getT<ListResponse<Tenant>>('/tenants').catch(() => ({ items: [] as Tenant[] }))
        : Promise.resolve({ items: [] as Tenant[] }),
      canManage
        ? api.getT<ListResponse<User>>('/users').catch(() => ({ items: [] as User[] }))
        : Promise.resolve({ items: [] as User[] }),
    ]);
    setInstallations(normalizeList(instRaw));
    setTenants(normalizeList(tenantsRaw));
    setUsers(normalizeList(usersRaw));
  };

  useEffect(() => {
    let cancelled = false;
    void loadAll()
      .catch(() => { if (!cancelled) { setError('Не удалось загрузить монтажи.'); toast.error('Не удалось загрузить монтажи.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [toast, canManage]);

  const stats = useMemo(() => {
    const total = installations.length;
    const byStage: Record<string, number> = {};
    let overdueCount = 0;
    let noExecutors = 0;
    for (const inst of installations) {
      const stage = getInstallationStage(inst);
      byStage[stage] = (byStage[stage] || 0) + 1;
      if (inst.isOverdue) overdueCount++;
      if (getExecutorIds(inst).length === 0 && !isInstallationClosedStage(stage)) noExecutors++;
    }
    return { total, byStage, overdueCount, noExecutors };
  }, [installations]);

  const availableSystemTypes = useMemo(() => {
    const types = new Set<string>();
    installations.forEach((inst) => { if (inst.systemType) types.add(inst.systemType); });
    return [...types].sort();
  }, [installations]);

  const SYSTEM_TYPE_LABELS: Record<string, string> = {
    aps: 'АПС',
    ventilation: 'Вентиляция',
    plumbing: 'Водоснабжение',
    fire_suppression: 'Пожаротушение',
    security: 'Охранная сигнализация',
    АПС: 'АПС',
  };

  const filteredInstallations = useMemo(() => {
    let list = installations;
    const term = debouncedSearch.trim().toLowerCase();
    if (term) {
      list = list.filter((inst) =>
        String(inst.title || '').toLowerCase().includes(term) ||
        String(tenantNameById[inst.tenantId || ''] || inst.tenantId || '').toLowerCase().includes(term)
      );
    }
    if (statusFilter) {
      list = list.filter((inst) => getInstallationStage(inst) === statusFilter);
    }
    if (systemTypeFilter) {
      list = list.filter((inst) => (inst.systemType || '').toLowerCase() === systemTypeFilter.toLowerCase());
    }
    // Sort: without executors first, then overdue, then by date
    return [...list].sort((a, b) => {
      const aNoExec = getExecutorIds(a).length === 0 ? 0 : 1;
      const bNoExec = getExecutorIds(b).length === 0 ? 0 : 1;
      if (aNoExec !== bNoExec) return aNoExec - bNoExec;
      const aOverdue = a.isOverdue ? 0 : 1;
      const bOverdue = b.isOverdue ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }, [installations, debouncedSearch, statusFilter, systemTypeFilter, tenantNameById]);

  const downloadCsv = async () => {
    setExporting(true);
    try {
      const token = getAccessToken();
      const res = await fetch(buildApiUrl('/installations/export-xlsx'), {
        headers: { Authorization: `Bearer ${token ?? ''}` },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'installations.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Не удалось скачать Excel');
    } finally {
      setExporting(false);
    }
  };

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.postT('/installations', {
        title: createForm.title,
        description: createForm.description,
        tenantId: createForm.tenantId || undefined,
        priority: createForm.priority,
        responsibleIds: createForm.executorIds,
        dueDatePreliminary: createForm.dueDatePreliminary || null,
        files: createForm.files.map((f) => ({ id: f.id, name: f.name, url: f.url, type: f.mimeType || '', size: String(f.sizeBytes || 0) })),
      });
      setCreateForm(INITIAL_FORM);
      setIsCreateOpen(false);
      await loadAll();
      toast.success('Монтаж создан.');
    } catch {
      setError('Не удалось создать монтаж.');
      toast.error('Не удалось создать монтаж.');
    } finally {
      setSaving(false);
    }
  };

  const onRowClick = (inst: Installation) => setSelectedInstId(inst.id);

  const onDeleteClick = (event: MouseEvent, inst: Installation) => {
    event.stopPropagation();
    setDeleteTarget(inst);
  };

  const onConfirmDelete = async () => {
    if (!deleteTarget) return;
    setError('');
    try {
      await api.delT(`/installations/${deleteTarget.id}`);
      await loadAll();
      toast.success('Монтаж удалён.');
    } catch {
      setError('Не удалось удалить монтаж.');
      toast.error('Не удалось удалить монтаж.');
    } finally {
      setDeleteTarget(null);
    }
  };

  const renderExecutorNames = (ids?: string[]) => {
    if (!ids || ids.length === 0) return '-';
    if (canManage) {
      return ids.map((id) => userNameById[id] || id).join(', ');
    }
    return ids.length === 1 ? 'Назначенный исполнитель' : `Исполнители: ${ids.length}`;
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Монтажи' }]} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Монтажи</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {canManage ? (
            <button type="button" onClick={() => void downloadCsv()} disabled={exporting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:w-auto">
              <Download size={16} />{exporting ? 'Скачиваю...' : 'Скачать Excel'}
            </button>
          ) : null}
          {canManage ? (
            <button type="button" onClick={() => setIsCreateOpen(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 sm:w-auto">
              <Plus size={16} />Создать
            </button>
          ) : null}
        </div>
      </div>

      {/* Stats cards */}
      {!loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Всего</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900/40 dark:bg-yellow-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-yellow-600 dark:text-yellow-400">В работе</p>
            <p className="mt-1 text-2xl font-bold text-yellow-700 dark:text-yellow-300">{(stats.byStage['in_progress'] || 0) + (stats.byStage['pnr'] || 0)}</p>
          </div>
          <div className="rounded-2xl border border-purple-200 bg-purple-50 p-4 dark:border-purple-900/40 dark:bg-purple-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-400">Закупка</p>
            <p className="mt-1 text-2xl font-bold text-purple-700 dark:text-purple-300">{stats.byStage['procurement'] || 0}</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Без исполнителей</p>
            <p className="mt-1 text-2xl font-bold text-amber-700 dark:text-amber-300">{stats.noExecutors}</p>
          </div>
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900/40 dark:bg-red-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">Просрочено</p>
            <p className="mt-1 text-2xl font-bold text-red-700 dark:text-red-300">{stats.overdueCount}</p>
          </div>
        </div>
      ) : null}

      {/* Filters */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <div className="relative md:col-span-2">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input value={search} onChange={(e) => updateFilter('search', e.target.value)} placeholder="Поиск по названию и контрагенту..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <select value={statusFilter} onChange={(e) => updateFilter('status', e.target.value)} className={selectCls}>
          <option value="">Все этапы</option>
          {INSTALLATION_STAGE_VALUES.map((value) => <option key={value} value={value}>{INSTALLATION_STAGE_LABELS[value] || value}</option>)}
        </select>
        <select value={systemTypeFilter} onChange={(e) => updateFilter('systemType', e.target.value)} className={selectCls}>
          <option value="">Все типы систем</option>
          {availableSystemTypes.map((st) => <option key={st} value={st}>{SYSTEM_TYPE_LABELS[st] || st}</option>)}
        </select>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</div> : null}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/50">
                {['Монтаж', 'Этап / Приоритет', 'Даты', ''].map((h) => (
                  <th key={h} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {loading ? <SkeletonTable rows={5} cols={4} /> : (
                <>
                  {filteredInstallations.map((inst) => {
                    const stage = getInstallationStage(inst);
                    const notClosed = !isInstallationClosedStage(stage);
                    const deadlineRaw = inst.dueDatePreliminary;
                    const deadlineDate = deadlineRaw ? new Date(deadlineRaw).toLocaleDateString('ru-RU') : null;
                    const todayStr = new Date().toISOString().slice(0, 10);
                    const deadlinePast = deadlineRaw && deadlineRaw < todayStr;
                    const isOverdue = inst.isOverdue === true || (notClosed && deadlinePast);
                    const noExec = getExecutorIds(inst).length === 0 && notClosed;
                    return (
                      <tr key={inst.id}
                        className={['cursor-pointer transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40', isOverdue ? 'bg-red-50/40 dark:bg-red-950/10' : ''].join(' ')}
                        onClick={() => onRowClick(inst)}>
                        {/* Монтаж: название + контрагент/исполнители */}
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            {isOverdue ? <span className="shrink-0 h-2 w-2 rounded-full bg-red-500" title="Просрочено" /> : null}
                            {noExec ? <span className="shrink-0 h-2 w-2 rounded-full bg-amber-500" title="Без исполнителей" /> : null}
                            <span className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[280px]">{inst.title || '-'}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="truncate max-w-[140px]">{resolveTenantLabel(inst.tenantId)}</span>
                            {renderExecutorNames(getExecutorIds(inst)) !== '-' ? (
                              <>
                                <span className="text-slate-300 dark:text-slate-600">·</span>
                                <span className="truncate max-w-[160px]">{renderExecutorNames(getExecutorIds(inst))}</span>
                              </>
                            ) : (
                              <>
                                <span className="text-slate-300 dark:text-slate-600">·</span>
                                <span className="text-amber-500 font-medium">Не назначены</span>
                              </>
                            )}
                          </div>
                        </td>
                        {/* Этап + Приоритет */}
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col gap-1">
                            <span className={['inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight',
                              isOverdue ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : (INSTALLATION_STAGE_BADGE_CLASSES[stage] || 'bg-slate-100 text-slate-600')].join(' ')}>
                              {isOverdue ? 'Просрочено' : (INSTALLATION_STAGE_LABELS[stage] || stage || '-')}
                            </span>
                            <span className={['inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight', PRIORITY_COLORS[inst.priority || ''] || 'bg-slate-100 text-slate-600'].join(' ')}>
                              {PRIORITY_LABELS[inst.priority || ''] || inst.priority || '-'}
                            </span>
                          </div>
                        </td>
                        {/* Даты */}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex flex-col gap-0.5 text-[11px] leading-tight">
                            {deadlineDate ? <span className={deadlinePast && notClosed ? 'text-red-500 font-semibold' : 'text-orange-500 dark:text-orange-400'}>◆ Дедлайн: {deadlineDate}</span> : null}
                            <span className="text-slate-400">Создан: {inst.createdAt ? new Date(inst.createdAt).toLocaleDateString('ru-RU') : '-'}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          {canManage ? (
                            <button type="button" onClick={(e) => onDeleteClick(e, inst)}
                              className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 min-h-[44px] min-w-[44px] flex items-center justify-center">
                              <Trash2 size={14} />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredInstallations.length === 0 ? <tr><td colSpan={4} className="px-3 py-12 text-center"><Search size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" /><p className="text-sm text-slate-500 dark:text-slate-400">Ничего не найдено</p></td></tr> : null}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Создание монтажа">
        <form onSubmit={onCreate} className="space-y-5">
          <div>
            <label className={labelCls}>Название</label>
            <input required minLength={2} value={createForm.title} onChange={(e) => setCreateForm((p) => ({ ...p, title: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400`}>Описание</label>
              <button type="button" disabled={aiDescLoading || (!createForm.title.trim() && createForm.files.length === 0)} onClick={() => void generateAiDescription()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 transition hover:bg-purple-100 disabled:opacity-50 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50">
                <Sparkles size={12} />
                {aiDescLoading ? 'Генерация...' : 'Подсказка от ИИ'}
              </button>
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
          </div>
          <div>
            <label className={labelCls}>Адрес / локация монтажа</label>
            <input value={createForm.address} onChange={(e) => setCreateForm((p) => ({ ...p, address: e.target.value }))} placeholder="г. Москва, ул. Примерная, д. 1" className={inputCls} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Контрагент (заказчик)</label>
              <SearchableSelect
                items={contractorItems}
                value={createForm.tenantId}
                onChange={(id) => setCreateForm((p) => ({ ...p, tenantId: id }))}
                placeholder="Поиск заказчика..."
              />
            </div>
            <div>
              <label className={labelCls}>Приоритет</label>
              <select value={createForm.priority} onChange={(e) => setCreateForm((p) => ({ ...p, priority: e.target.value }))} className={selectCls}>
                {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Исполнители</label>
            <CheckList
              items={executorItems}
              selected={createForm.executorIds}
              onToggle={(id) => setCreateForm((p) => ({
                ...p,
                executorIds: p.executorIds.includes(id) ? p.executorIds.filter((x) => x !== id) : [...p.executorIds, id],
              }))}
              searchPlaceholder="Поиск исполнителя..."
            />
          </div>
          <div>
            <label className={labelCls}>Предварительный дедлайн</label>
            <input type="date" value={createForm.dueDatePreliminary} onChange={(e) => setCreateForm((p) => ({ ...p, dueDatePreliminary: e.target.value }))} className={inputCls} />
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

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void onConfirmDelete()}
        title="Удалить монтаж?"
        message="Это действие нельзя отменить."
        confirmLabel="Удалить"
      />

      {selectedInstId && (
        <InstallationDetailModal
          installationId={selectedInstId}
          onClose={() => { setSelectedInstId(null); void loadAll(); }}
        />
      )}
    </div>
  );
}
