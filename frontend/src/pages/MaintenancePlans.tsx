import { useCallback, useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import { Download, Plus, Search, Sparkles, Trash2, Play, Pause, Archive, ChevronLeft, ChevronRight, RefreshCw, Eye, Paperclip, X } from 'lucide-react';
import { Editor } from '@tinymce/tinymce-react';
import { useSearchParams } from 'react-router-dom';
import Modal from '@/components/Modal';
import Breadcrumbs from '@/components/Breadcrumbs';
import ConfirmDialog from '@/components/ConfirmDialog';
import { SkeletonTable } from '@/components/Skeleton';
import { api, buildApiUrl, getAccessToken, uploadFileT } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { SYSTEM_LABELS, SystemType, type Direction, type MaintenanceItem, type User } from '@/types';
import { usePermissions } from '@/hooks/usePermissions';

type PlanStatus = 'draft' | 'active' | 'paused' | 'archived';
type UpdateMode = 'skip' | 'update_not_started' | 'versioning';
type FileAttachment = { id?: string; name: string; url: string; mimeType?: string; sizeBytes?: number };

type MaintenancePlan = {
  id: string;
  name?: string;
  directionId?: string;
  directionName?: string;
  maintenanceItemIds?: string[];
  systemType?: string;
  frequency?: string;
  dayOfMonth?: number;
  arrivalFromDay?: number;
  arrivalToDay?: number;
  periodOffset?: number;
  updateMode?: UpdateMode;
  validFrom?: string;
  validTo?: string | null;
  status?: PlanStatus;
  isActive?: boolean;
  sendEmail?: boolean;
  notifyExecutor?: boolean;
  notifyManager?: boolean;
  defaultExecutorIds?: string[];
  contactPerson?: string;
  contactPhone?: string;
  description?: string;
  lastGenerated?: string | null;
  createdAt?: string;
};

type PlanForm = {
  name: string;
  directionId: string;
  maintenanceItemIds: string[];
  systemType: string;
  frequency: string;
  dayOfMonth: number;
  arrivalFromDay: number;
  arrivalToDay: number;
  periodOffset: number;
  updateMode: UpdateMode;
  validFrom: string;
  validTo: string;
  status: PlanStatus;
  sendEmail: boolean;
  notifyExecutor: boolean;
  notifyManager: boolean;
  defaultExecutorIds: string[];
  contactPerson: string;
  contactPhone: string;
  description: string;
  files: FileAttachment[];
};

type GeneratedRequest = {
  linkId: string;
  objectId: string;
  objectName: string;
  objectAddress: string;
  periodStart: string;
  periodEnd: string;
  linkStatus: string;
  requestId: string;
  requestTitle: string;
  requestStatus: string;
  requestPriority: string;
  requestDueDate: string;
  createdAt: string;
};

type GenerationLog = {
  id: string;
  planId: string;
  mode: string;
  periodStart: string;
  periodEnd: string;
  created: number;
  skipped: number;
  updated: number;
  errors: number;
  executedAt: string;
};

type ListResponse<T> = T[] | { items?: T[]; data?: T[] };

const FREQUENCY_LABELS: Record<string, string> = { monthly: 'Ежемесячно', quarterly: 'Ежеквартально', yearly: 'Ежегодно' };
const STATUS_LABELS: Record<string, string> = { draft: 'Черновик', active: 'Активен', paused: 'Пауза', archived: 'Архив' };
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  active: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  paused: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  archived: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300',
};
const UPDATE_MODE_LABELS: Record<string, string> = { skip: 'Не изменять', update_not_started: 'Обновлять не начатые', versioning: 'Создавать новую версию' };
const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

const INITIAL_FORM: PlanForm = {
  name: '', directionId: '', maintenanceItemIds: [], systemType: SystemType.APS,
  frequency: 'monthly', dayOfMonth: 1, arrivalFromDay: 1, arrivalToDay: 28,
  periodOffset: 1, updateMode: 'skip', validFrom: '', validTo: '',
  status: 'draft', sendEmail: false, notifyExecutor: true, notifyManager: true,
  defaultExecutorIds: [], contactPerson: '', contactPhone: '',
  description: '',
  files: [],
};

import { normalizeList } from '@/utils/normalize';

const uniqueById = <T extends { id: string }>(items: T[]) => {
  const map = new Map<string, T>();
  items.forEach((item) => map.set(item.id, item));
  return Array.from(map.values());
};

const inputCls = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
const selectCls = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const btnPrimary = "inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60";
const btnSecondary = "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800";

export default function MaintenancePlansPage() {
  const toast = useToast();
  const { canManage } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const statusFilter = searchParams.get('status') || '';
  const dirFilter = searchParams.get('directionId') || '';

  const [plans, setPlans] = useState<MaintenancePlan[]>([]);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [allItems, setAllItems] = useState<MaintenanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCardOpen, setIsCardOpen] = useState(false);
  const [isGenOpen, setIsGenOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<MaintenancePlan | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MaintenancePlan | null>(null);
  const [createForm, setCreateForm] = useState<PlanForm>(INITIAL_FORM);
  const [editForm, setEditForm] = useState<PlanForm>(INITIAL_FORM);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [aiDescLoading, setAiDescLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Card tabs
  const [cardTab, setCardTab] = useState<'objects'|'requests'|'logs'>('objects');
  const [cardRequests, setCardRequests] = useState<GeneratedRequest[]>([]);
  const [cardLogs, setCardLogs] = useState<GenerationLog[]>([]);
  const [cardLoading, setCardLoading] = useState(false);

  // Generation
  const [genMonth, setGenMonth] = useState(new Date().getMonth());
  const [genYear, setGenYear] = useState(new Date().getFullYear());
  const [genResult, setGenResult] = useState<any>(null);
  const [generating, setGenerating] = useState(false);

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value.trim()) params.set(key, value); else params.delete(key);
    setSearchParams(params, { replace: true });
  };

  const _itemNameById = useMemo(() => {
    const map: Record<string, string> = {};
    allItems.forEach((item) => { map[item.id] = item.name || item.id; });
    return map;
  }, [allItems]);

  const userNameById = useMemo(() => {
    const map: Record<string, string> = {};
    users.forEach((u) => { map[u.id] = u.fullName || u.email || u.id; });
    return map;
  }, [users]);

  const dirNameById = useMemo(() => {
    const map: Record<string, string> = {};
    directions.forEach((d) => { map[d.id] = d.name || d.id; });
    return map;
  }, [directions]);

  const loadMaintenanceItems = async () => {
    const dirs = normalizeList<Direction>(await api.getT<ListResponse<Direction>>('/directions'));
    const results = await Promise.all(dirs.map(async (d) => {
      try { return normalizeList<MaintenanceItem>(await api.getT<ListResponse<MaintenanceItem>>(`/directions/${d.id}/items`)); }
      catch { return []; }
    }));
    return uniqueById(results.flat());
  };

  const loadAll = async () => {
    setError('');
    const qs = new URLSearchParams();
    if (statusFilter) qs.set('status', statusFilter);
    if (dirFilter) qs.set('directionId', dirFilter);
    if (search.trim()) qs.set('search', search.trim());
    const [plansRaw, dirsRaw, usersRaw, items] = await Promise.all([
      api.getT<ListResponse<MaintenancePlan>>(`/maintenance-plans?${qs.toString()}`),
      api.getT<ListResponse<Direction>>('/directions'),
      canManage
        ? api.getT<ListResponse<User>>('/users').catch(() => ({ items: [] as User[] }))
        : Promise.resolve({ items: [] as User[] }),
      loadMaintenanceItems(),
    ]);
    setPlans(normalizeList<MaintenancePlan>(plansRaw));
    setDirections(normalizeList<Direction>(dirsRaw));
    setUsers(normalizeList<User>(usersRaw));
    setAllItems(items);
  };

  useEffect(() => {
    let cancelled = false;
    void loadAll().catch(() => { if (!cancelled) { setError('Не удалось загрузить планы ТО.'); toast.error('Не удалось загрузить планы ТО.'); } }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [statusFilter, dirFilter, search, canManage]);

  const downloadCsv = async () => {
    setExporting(true);
    try {
      const token = getAccessToken();
      const res = await fetch(buildApiUrl('/maintenance-plans/export-xlsx'), {
        headers: { Authorization: `Bearer ${token ?? ''}` },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'maintenance-plans.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Не удалось скачать Excel'); }
    finally { setExporting(false); }
  };

  const uploadFile = useCallback(async (file: File): Promise<FileAttachment | null> => {
    try {
      const result = await uploadFileT<{ id: string; name: string; url: string; mimeType: string; sizeBytes: number }>('/files/upload', file);
      return { id: result.id, name: result.name, url: result.url, mimeType: result.mimeType, sizeBytes: result.sizeBytes };
    } catch {
      return null;
    }
  }, []);

  const handleFileSelect = useCallback(async (fileList: FileList | null, setForm: React.Dispatch<React.SetStateAction<PlanForm>>) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const uploaded = await uploadFile(file);
        if (uploaded) {
          setForm((prev) => ({ ...prev, files: [...prev.files, uploaded] }));
        } else {
          toast.error(`Не удалось загрузить: ${file.name}`);
        }
      }
    } finally { setUploading(false); }
  }, [uploadFile, toast]);

  const generateAiDescription = useCallback(async (form: PlanForm, setForm: React.Dispatch<React.SetStateAction<PlanForm>>) => {
    if (!form.name.trim() && form.files.length === 0) { toast.error('Введите название плана или прикрепите файлы'); return; }
    setAiDescLoading(true);
    try {
      const result = await api.postT<{ plan: string }>('/ai/generate-maintenance-description', {
        planName: form.name,
        systemType: form.systemType || '',
        frequency: form.frequency || '',
        currentDescription: form.description || '',
        files: form.files,
      });
      if (result.plan) {
        setForm((p) => ({ ...p, description: result.plan }));
        toast.success('Описание сгенерировано');
      }
    } catch {
      toast.error('Не удалось сгенерировать описание');
    } finally { setAiDescLoading(false); }
  }, [toast]);

  const filteredItems = useMemo(() => {
    if (!createForm.directionId && !editForm.directionId) return allItems;
    const dirId = isCreateOpen ? createForm.directionId : editForm.directionId;
    if (!dirId) return allItems;
    return allItems.filter((i) => i.directionId === dirId);
  }, [allItems, createForm.directionId, editForm.directionId, isCreateOpen]);

  const createItemSystems = useMemo(() => {
    if (createForm.maintenanceItemIds.length === 0) return Object.values(SystemType);
    const systems = new Set<SystemType>();
    allItems.filter((i) => createForm.maintenanceItemIds.includes(i.id)).forEach((i) => {
      if (i.systems) Object.entries(i.systems).forEach(([k, v]) => { if (v) systems.add(k as SystemType); });
    });
    return systems.size > 0 ? Array.from(systems) : Object.values(SystemType);
  }, [allItems, createForm.maintenanceItemIds]);

  const editItemSystems = useMemo(() => {
    if (editForm.maintenanceItemIds.length === 0) return Object.values(SystemType);
    const systems = new Set<SystemType>();
    allItems.filter((i) => editForm.maintenanceItemIds.includes(i.id)).forEach((i) => {
      if (i.systems) Object.entries(i.systems).forEach(([k, v]) => { if (v) systems.add(k as SystemType); });
    });
    return systems.size > 0 ? Array.from(systems) : Object.values(SystemType);
  }, [allItems, editForm.maintenanceItemIds]);

  const toPayload = (form: PlanForm) => ({
    name: form.name, directionId: form.directionId || null,
    maintenanceItemIds: form.maintenanceItemIds, systemType: form.systemType,
    frequency: form.frequency, dayOfMonth: form.dayOfMonth,
    arrivalFromDay: form.arrivalFromDay, arrivalToDay: form.arrivalToDay,
    periodOffset: form.periodOffset, updateMode: form.updateMode,
    validFrom: form.validFrom || null, validTo: form.validTo || null,
    status: form.status, sendEmail: form.sendEmail,
    notifyExecutor: form.notifyExecutor, notifyManager: form.notifyManager,
    defaultExecutorIds: form.defaultExecutorIds,
    contactPerson: form.contactPerson, contactPhone: form.contactPhone,
    description: form.description,
  });

  const onCreate = async (e: FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await api.postT('/maintenance-plans', toPayload(createForm));
      setCreateForm(INITIAL_FORM); setIsCreateOpen(false); setStep(0);
      await loadAll(); toast.success('План ТО создан.');
    } catch { setError('Не удалось создать план.'); toast.error('Не удалось создать план.'); }
    finally { setSaving(false); }
  };

  const onUpdate = async (e: FormEvent) => {
    e.preventDefault(); if (!selectedPlan) return; setSaving(true); setError('');
    try {
      await api.patchT(`/maintenance-plans/${selectedPlan.id}`, toPayload(editForm));
      setIsEditOpen(false); setSelectedPlan(null);
      await loadAll(); toast.success('План ТО обновлён.');
    } catch { setError('Не удалось обновить план.'); toast.error('Не удалось обновить план.'); }
    finally { setSaving(false); }
  };

  const onStatusChange = async (plan: MaintenancePlan, newStatus: PlanStatus) => {
    try {
      await api.patchT(`/maintenance-plans/${plan.id}`, { status: newStatus });
      await loadAll(); toast.success(`Статус изменён: ${STATUS_LABELS[newStatus]}`);
    } catch { toast.error('Не удалось изменить статус.'); }
  };

  const onDeleteClick = (e: MouseEvent, plan: MaintenancePlan) => { e.stopPropagation(); setDeleteTarget(plan); };
  const onConfirmDelete = async () => {
    if (!deleteTarget) return; setError('');
    try { await api.delT(`/maintenance-plans/${deleteTarget.id}`); await loadAll(); toast.success('План удалён.'); }
    catch { toast.error('Не удалось удалить план.'); }
    finally { setDeleteTarget(null); }
  };

  const openCard = async (plan: MaintenancePlan) => {
    setSelectedPlan(plan); setCardTab('objects'); setIsCardOpen(true);
    setCardLoading(true);
    try {
      const [reqsRaw, logsRaw] = await Promise.all([
        api.getT<{ items: GeneratedRequest[] }>(`/maintenance-plans/${plan.id}/requests`),
        api.getT<{ items: GenerationLog[] }>(`/maintenance-plans/${plan.id}/logs`),
      ]);
      setCardRequests(Array.isArray(reqsRaw.items) ? reqsRaw.items : []);
      setCardLogs(Array.isArray(logsRaw.items) ? logsRaw.items : []);
    } catch { toast.error('Не удалось загрузить данные плана.'); }
    finally { setCardLoading(false); }
  };

  const openEdit = (plan: MaintenancePlan) => {
    setSelectedPlan(plan);
    setEditForm({
      name: plan.name || '', directionId: plan.directionId || '',
      maintenanceItemIds: Array.isArray(plan.maintenanceItemIds) ? plan.maintenanceItemIds : [],
      systemType: plan.systemType || SystemType.APS, frequency: plan.frequency || 'monthly',
      dayOfMonth: plan.dayOfMonth || 1, arrivalFromDay: plan.arrivalFromDay || 1,
      arrivalToDay: plan.arrivalToDay || 28, periodOffset: plan.periodOffset ?? 1,
      updateMode: (plan.updateMode as UpdateMode) || 'skip',
      validFrom: (plan.validFrom || '').slice(0, 10), validTo: (plan.validTo || '').slice(0, 10),
      status: (plan.status as PlanStatus) || 'draft', sendEmail: plan.sendEmail || false,
      notifyExecutor: plan.notifyExecutor !== false, notifyManager: plan.notifyManager !== false,
      defaultExecutorIds: Array.isArray(plan.defaultExecutorIds) ? plan.defaultExecutorIds : [],
      contactPerson: plan.contactPerson || '', contactPhone: plan.contactPhone || '',
      description: plan.description || '',
      files: [],
    });
    setIsEditOpen(true);
  };

  const openGenerate = (plan: MaintenancePlan) => {
    setSelectedPlan(plan); setGenResult(null);
    const now = new Date();
    const offset = plan.periodOffset ?? 1;
    const target = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    setGenMonth(target.getMonth()); setGenYear(target.getFullYear());
    setIsGenOpen(true);
  };

  const runGeneration = async () => {
    if (!selectedPlan) return; setGenerating(true); setGenResult(null);
    try {
      const result = await api.postT('/maintenance-plans/generate', { planId: selectedPlan.id, month: genMonth, year: genYear, mode: 'execute' });
      setGenResult(result); await loadAll();
      toast.success(`Генерация завершена: создано ${(result as any)?.created || 0}`);
    } catch { toast.error('Ошибка генерации.'); }
    finally { setGenerating(false); }
  };

  const renderExecutors = (ids: string[] | undefined) => {
    if (!Array.isArray(ids) || ids.length === 0) return '-';
    if (canManage) {
      return ids.map((id) => userNameById[id] || id).join(', ');
    }
    return ids.length === 1 ? 'Назначенный исполнитель' : `Исполнители: ${ids.length}`;
  };

  // ── Wizard step renderer ─────────────────────────────────���────────
  const renderStep = (form: PlanForm, setForm: React.Dispatch<React.SetStateAction<PlanForm>>) => {
    const items = allItems.filter((i) => !form.directionId || i.directionId === form.directionId);
    const [itemSearch, setItemSearch] = useState('');
    const filtItems = items.filter((i) => !itemSearch || i.name.toLowerCase().includes(itemSearch.toLowerCase()));

    if (step === 0) return (
      <div className="space-y-4">
        <div><label className={labelCls}>Название плана</label>
          <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="ТО — Направление — Клиент" className={inputCls} /></div>
        <div><label className={labelCls}>Направление</label>
          <select value={form.directionId} onChange={(e) => setForm((p) => ({ ...p, directionId: e.target.value, maintenanceItemIds: [] }))} className={selectCls}>
            <option value="">— Все направления —</option>
            {directions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className={labelCls}>Описание</label>
            <button type="button" disabled={aiDescLoading || (!form.name.trim() && form.files.length === 0)} onClick={() => void generateAiDescription(form, setForm)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 transition hover:bg-purple-100 disabled:opacity-50 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50">
              <Sparkles size={12} />
              {aiDescLoading ? 'Генерация...' : 'Подсказка от ИИ'}
            </button>
          </div>
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
        <div>
          <label className={labelCls}>Файлы</label>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 transition hover:border-red-400 hover:text-red-500 dark:border-slate-600 dark:text-slate-400">
            <Paperclip size={14} />
            {uploading ? 'Загрузка...' : 'Прикрепить файл'}
            <input type="file" multiple className="hidden" disabled={uploading} onChange={(e) => void handleFileSelect(e.target.files, setForm)} />
          </label>
          {form.files.length > 0 && (
            <div className="mt-2 space-y-1">
              {form.files.map((f, i) => (
                <div key={f.url || i} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-slate-800">
                  <Paperclip size={12} className="shrink-0 text-slate-400" />
                  <span className="truncate text-slate-700 dark:text-slate-300">{f.name}</span>
                  <a href={f.url} download={f.name} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0 text-blue-500 hover:text-blue-700" title="Скачать"><Download size={12} /></a>
                  <button type="button" onClick={() => setForm((p) => ({ ...p, files: p.files.filter((_, fi) => fi !== i) }))} className="shrink-0 text-slate-400 hover:text-red-500" title="Удалить"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={labelCls}>Действует с</label><input type="date" value={form.validFrom} onChange={(e) => setForm((p) => ({ ...p, validFrom: e.target.value }))} className={inputCls} /></div>
          <div><label className={labelCls}>Действует до</label><input type="date" value={form.validTo} onChange={(e) => setForm((p) => ({ ...p, validTo: e.target.value }))} className={inputCls} /></div>
        </div>
      </div>
    );
    if (step === 1) return (
      <div className="space-y-3">
        <div className="flex items-center justify-between"><label className={labelCls}>Объекты обслуживания</label><span className="text-xs text-slate-500">Выбрано: {form.maintenanceItemIds.length}</span></div>
        <input placeholder="Поиск объектов..." value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} className={inputCls} />
        <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
          {filtItems.map((item) => (
            <label key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer border-b border-slate-100 dark:border-slate-800 last:border-0">
              <input type="checkbox" checked={form.maintenanceItemIds.includes(item.id)}
                onChange={(e) => { const checked = e.target.checked; setForm((p) => ({ ...p, maintenanceItemIds: checked ? [...p.maintenanceItemIds, item.id] : p.maintenanceItemIds.filter((x) => x !== item.id) })); }}
                className="rounded border-slate-300 text-brand-red focus:ring-brand-red" />
              <span className="truncate text-slate-900 dark:text-slate-100">{item.positionNumber ? `${item.positionNumber}. ` : ''}{item.name}</span>
              <span className="ml-auto text-xs text-slate-400">{item.address || ''}</span>
            </label>
          ))}
          {filtItems.length === 0 && <div className="px-3 py-4 text-center text-sm text-slate-400">Нет объектов</div>}
        </div>
      </div>
    );
    if (step === 2) return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={labelCls}>Система</label>
            <select value={form.systemType} onChange={(e) => setForm((p) => ({ ...p, systemType: e.target.value }))} className={inputCls}>
              {createItemSystems.map((st) => <option key={st} value={st}>{SYSTEM_LABELS[st]}</option>)}
            </select></div>
          <div><label className={labelCls}>Частота</label>
            <select value={form.frequency} onChange={(e) => setForm((p) => ({ ...p, frequency: e.target.value }))} className={inputCls}>
              {Object.entries(FREQUENCY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className={labelCls}>День генерации</label><input type="number" min={1} max={31} value={form.dayOfMonth} onChange={(e) => setForm((p) => ({ ...p, dayOfMonth: Number(e.target.value || 1) }))} className={inputCls} /></div>
          <div><label className={labelCls}>Смещение периода</label>
            <select value={form.periodOffset} onChange={(e) => setForm((p) => ({ ...p, periodOffset: Number(e.target.value) }))} className={inputCls}>
              <option value={0}>Текущий месяц</option><option value={1}>Следующий месяц</option><option value={2}>Через 2 месяца</option>
            </select></div>
          <div><label className={labelCls}>Режим обновления</label>
            <select value={form.updateMode} onChange={(e) => setForm((p) => ({ ...p, updateMode: e.target.value as UpdateMode }))} className={inputCls}>
              {Object.entries(UPDATE_MODE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={labelCls}>Окно прибытия: с (день)</label><input type="number" min={1} max={31} value={form.arrivalFromDay} onChange={(e) => setForm((p) => ({ ...p, arrivalFromDay: Number(e.target.value || 1) }))} className={inputCls} /></div>
          <div><label className={labelCls}>Окно прибытия: по (день)</label><input type="number" min={1} max={31} value={form.arrivalToDay} onChange={(e) => setForm((p) => ({ ...p, arrivalToDay: Number(e.target.value || 28) }))} className={inputCls} /></div>
        </div>
      </div>
    );
    if (step === 3) return (
      <div className="space-y-4">
        <div><label className={labelCls}>Исполнители</label>
          <select multiple value={form.defaultExecutorIds} onChange={(e) => { const sel = Array.from(e.target.selectedOptions).map((o) => o.value); setForm((p) => ({ ...p, defaultExecutorIds: sel })); }}
            className={`${inputCls} h-28`}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.fullName || u.email || u.id}</option>)}
          </select></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={labelCls}>Контактное лицо</label><input value={form.contactPerson} onChange={(e) => setForm((p) => ({ ...p, contactPerson: e.target.value }))} className={inputCls} /></div>
          <div><label className={labelCls}>Контактный телефон</label><input value={form.contactPhone} onChange={(e) => setForm((p) => ({ ...p, contactPhone: e.target.value }))} className={inputCls} /></div>
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={form.sendEmail} onChange={(e) => setForm((p) => ({ ...p, sendEmail: e.target.checked }))} className="rounded border-slate-300 text-brand-red focus:ring-brand-red" />
            Отправлять email заказчику</label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={form.notifyExecutor} onChange={(e) => setForm((p) => ({ ...p, notifyExecutor: e.target.checked }))} className="rounded border-slate-300 text-brand-red focus:ring-brand-red" />
            Уведомлять исполнителя</label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={form.notifyManager} onChange={(e) => setForm((p) => ({ ...p, notifyManager: e.target.checked }))} className="rounded border-slate-300 text-brand-red focus:ring-brand-red" />
            Уведомлять менеджера</label>
        </div>
      </div>
    );
    // Step 4: Preview
    const noSystems = form.maintenanceItemIds.filter((id) => { const item = allItems.find((i) => i.id === id); return item && Object.keys(item.systems || {}).filter((k) => (item.systems as any)[k]).length === 0; });
    return (
      <div className="space-y-3 text-sm">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">Предпросмотр плана</h3>
        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800 space-y-1">
          <div><span className="text-slate-500">Название:</span> {form.name || '—'}</div>
          <div><span className="text-slate-500">Направление:</span> {dirNameById[form.directionId] || '—'}</div>
          <div><span className="text-slate-500">Объектов:</span> {form.maintenanceItemIds.length}</div>
          <div><span className="text-slate-500">Система:</span> {SYSTEM_LABELS[form.systemType as SystemType] || form.systemType}</div>
          <div><span className="text-slate-500">Частота:</span> {FREQUENCY_LABELS[form.frequency] || form.frequency}</div>
          <div><span className="text-slate-500">День генерации:</span> {form.dayOfMonth}</div>
          <div><span className="text-slate-500">Период:</span> {form.periodOffset === 0 ? 'Текущий месяц' : `+${form.periodOffset} мес.`}</div>
          <div><span className="text-slate-500">Окно прибытия:</span> {form.arrivalFromDay} — {form.arrivalToDay} число</div>
          <div><span className="text-slate-500">Исполнители:</span> {renderExecutors(form.defaultExecutorIds)}</div>
          <div><span className="text-slate-500">Режим обновления:</span> {UPDATE_MODE_LABELS[form.updateMode]}</div>
          <div><span className="text-slate-500">Email заказчику:</span> {form.sendEmail ? 'Да' : 'Нет'}</div>
        </div>
        {noSystems.length > 0 && <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-2 text-xs text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-300">
          У {noSystems.length} объектов не заполнены системы</div>}
        {form.maintenanceItemIds.length === 0 && <div className="rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-300">
          Не выбрано ни одного объекта</div>}
      </div>
    );
  };

  const STEPS = ['Основное', 'Объекты', 'Расписание', 'Исполнитель', 'Предпросмотр'];

  const stats = useMemo(() => {
    const total = plans.length;
    const active = plans.filter((p) => p.status === 'active').length;
    const paused = plans.filter((p) => p.status === 'paused').length;
    const draft = plans.filter((p) => p.status === 'draft').length;
    return { total, active, paused, draft };
  }, [plans]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Планы ТО' }]} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Планы ТО</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {canManage ? (
            <button type="button" onClick={() => void downloadCsv()} disabled={exporting} className={btnSecondary}>
              <Download size={16} />{exporting ? 'Скачиваю...' : 'Excel'}
            </button>
          ) : null}
          {canManage && <button type="button" onClick={() => { setCreateForm(INITIAL_FORM); setStep(0); setIsCreateOpen(true); }} className={btnPrimary}>
            <Plus size={16} />Создать</button>}
        </div>
      </div>

      {/* Stats cards */}
      {!loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Всего</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 dark:border-green-900/40 dark:bg-green-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-green-600 dark:text-green-400">Активных</p>
            <p className="mt-1 text-2xl font-bold text-green-700 dark:text-green-300">{stats.active}</p>
          </div>
          <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900/40 dark:bg-yellow-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-yellow-600 dark:text-yellow-400">На паузе</p>
            <p className="mt-1 text-2xl font-bold text-yellow-700 dark:text-yellow-300">{stats.paused}</p>
          </div>
          <div className="rounded-2xl border border-purple-200 bg-purple-50 p-4 dark:border-purple-900/40 dark:bg-purple-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-400">Черновиков</p>
            <p className="mt-1 text-2xl font-bold text-purple-700 dark:text-purple-300">{stats.draft}</p>
          </div>
        </div>
      ) : null}

      {/* Filters */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <div className="relative md:col-span-2">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input value={search} onChange={(e) => updateFilter('search', e.target.value)} placeholder="Поиск по названию..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <select value={statusFilter} onChange={(e) => updateFilter('status', e.target.value)} className={selectCls}>
          <option value="">Все статусы</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={dirFilter} onChange={(e) => updateFilter('directionId', e.target.value)} className={selectCls}>
          <option value="">Все направления</option>
          {directions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</div> : null}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/50">
                {['Название', 'Объекты / Система', 'Расписание', 'Статус', 'Действия'].map((h) => (
                  <th key={h} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {loading ? <SkeletonTable rows={5} cols={5} /> : (
                <>
                  {plans.map((plan) => (
                    <tr key={plan.id}
                      className="cursor-pointer transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                      onClick={() => void openCard(plan)}>
                      {/* Название + направление */}
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[250px]">
                          {plan.name || SYSTEM_LABELS[plan.systemType as SystemType] || plan.systemType || '—'}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[250px]">
                          {(plan as any).directionName || dirNameById[plan.directionId || ''] || '—'}
                        </div>
                      </td>
                      {/* Объекты / Система */}
                      <td className="px-3 py-2.5">
                        <div className="text-slate-900 dark:text-slate-100">{(plan.maintenanceItemIds || []).length} объектов</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{SYSTEM_LABELS[plan.systemType as SystemType] || plan.systemType || '—'}</div>
                      </td>
                      {/* Расписание */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="text-slate-900 dark:text-slate-100">{FREQUENCY_LABELS[plan.frequency || ''] || '—'}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {plan.lastGenerated ? `Посл.: ${new Date(plan.lastGenerated).toLocaleDateString('ru')}` : 'Не генерировался'}
                        </div>
                      </td>
                      {/* Статус */}
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight ${STATUS_COLORS[plan.status || 'draft']}`}>
                          {STATUS_LABELS[plan.status || 'draft']}
                        </span>
                      </td>
                      {/* Действия */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {canManage && plan.status === 'draft' && <button type="button" onClick={() => void onStatusChange(plan, 'active')} className="rounded-lg p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30" title="Активировать"><Play size={14} /></button>}
                          {canManage && plan.status === 'active' && <button type="button" onClick={() => void onStatusChange(plan, 'paused')} className="rounded-lg p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-950/30" title="Пауза"><Pause size={14} /></button>}
                          {canManage && plan.status === 'paused' && <button type="button" onClick={() => void onStatusChange(plan, 'active')} className="rounded-lg p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30" title="Возобновить"><Play size={14} /></button>}
                          {canManage && (plan.status === 'active' || plan.status === 'paused') && <button type="button" onClick={() => void onStatusChange(plan, 'archived')} className="rounded-lg p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Архив"><Archive size={14} /></button>}
                          {canManage && plan.status === 'active' && <button type="button" onClick={() => openGenerate(plan)} className="rounded-lg p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30" title="Генерация"><RefreshCw size={14} /></button>}
                          {canManage ? <button type="button" onClick={() => openEdit(plan)} className="rounded-lg p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Редактировать"><Eye size={14} /></button> : null}
                          {canManage && <button type="button" onClick={(e) => onDeleteClick(e, plan)} className="rounded-lg p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40" title="Удалить"><Trash2 size={14} /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {plans.length === 0 ? <tr><td colSpan={5} className="px-3 py-12 text-center"><Search size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" /><p className="text-sm text-slate-500 dark:text-slate-400">Ничего не найдено</p></td></tr> : null}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create wizard modal */}
      <Modal isOpen={isCreateOpen} onClose={() => { setIsCreateOpen(false); setStep(0); }} title={`Создание плана — ${STEPS[step]}`}>
        <div className="mb-4 flex gap-1">
          {STEPS.map((s, i) => <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-red-500' : 'bg-slate-200 dark:bg-slate-700'}`} />)}
        </div>
        <form onSubmit={step === 4 ? onCreate : (e) => { e.preventDefault(); setStep((s) => s + 1); }}>
          {renderStep(createForm, setCreateForm)}
          <div className="mt-4 flex justify-between">
            {step > 0 ? <button type="button" onClick={() => setStep((s) => s - 1)} className={btnSecondary}><ChevronLeft size={16} />Назад</button> : <div />}
            {step < 4 ? <button type="submit" className={btnPrimary}>Далее<ChevronRight size={16} /></button>
              : <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Сохранение...' : 'Создать план'}</button>}
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      <Modal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title="Редактирование плана ТО">
        <form onSubmit={onUpdate} className="space-y-4">
          <div><label className={labelCls}>Название</label><input value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} className={inputCls} /></div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={labelCls}>Описание</label>
              <button type="button" disabled={aiDescLoading || (!editForm.name.trim() && editForm.files.length === 0)} onClick={() => void generateAiDescription(editForm, setEditForm)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 transition hover:bg-purple-100 disabled:opacity-50 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50">
                <Sparkles size={12} />
                {aiDescLoading ? 'Генерация...' : 'Подсказка о�� ИИ'}
              </button>
            </div>
            <Editor
              licenseKey="gpl"
              tinymceScriptSrc="/tinymce/tinymce.min.js"
              value={editForm.description}
              onEditorChange={(content) => setEditForm((p) => ({ ...p, description: content }))}
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
            <label className={labelCls}>Файлы</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 transition hover:border-red-400 hover:text-red-500 dark:border-slate-600 dark:text-slate-400">
              <Paperclip size={14} />
              {uploading ? 'Загрузка...' : 'Прикрепить файл'}
              <input type="file" multiple className="hidden" disabled={uploading} onChange={(e) => void handleFileSelect(e.target.files, setEditForm)} />
            </label>
            {editForm.files.length > 0 && (
              <div className="mt-2 space-y-1">
                {editForm.files.map((f, i) => (
                  <div key={f.url || i} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-slate-800">
                    <Paperclip size={12} className="shrink-0 text-slate-400" />
                    <span className="truncate text-slate-700 dark:text-slate-300">{f.name}</span>
                    <a href={f.url} download={f.name} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0 text-blue-500 hover:text-blue-700" title="Скачать"><Download size={12} /></a>
                    <button type="button" onClick={() => setEditForm((p) => ({ ...p, files: p.files.filter((_, fi) => fi !== i) }))} className="shrink-0 text-slate-400 hover:text-red-500" title="Удалить"><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div><label className={labelCls}>Направление</label>
            <select value={editForm.directionId} onChange={(e) => setEditForm((p) => ({ ...p, directionId: e.target.value }))} className={selectCls}>
              <option value="">—</option>{directions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select></div>
          <div><label className={labelCls}>Объекты ({editForm.maintenanceItemIds.length})</label>
            <select multiple value={editForm.maintenanceItemIds} onChange={(e) => { const sel = Array.from(e.target.selectedOptions).map((o) => o.value); setEditForm((p) => ({ ...p, maintenanceItemIds: sel })); }}
              className={`${inputCls} h-32`}>
              {filteredItems.map((item) => <option key={item.id} value={item.id}>{item.positionNumber ? `${item.positionNumber}. ` : ''}{item.name}</option>)}
            </select></div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className={labelCls}>Система</label><select value={editForm.systemType} onChange={(e) => setEditForm((p) => ({ ...p, systemType: e.target.value }))} className={inputCls}>
              {editItemSystems.map((st) => <option key={st} value={st}>{SYSTEM_LABELS[st]}</option>)}</select></div>
            <div><label className={labelCls}>Частота</label><select value={editForm.frequency} onChange={(e) => setEditForm((p) => ({ ...p, frequency: e.target.value }))} className={inputCls}>
              {Object.entries(FREQUENCY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label className={labelCls}>День генерации</label><input type="number" min={1} max={31} value={editForm.dayOfMonth} onChange={(e) => setEditForm((p) => ({ ...p, dayOfMonth: Number(e.target.value || 1) }))} className={inputCls} /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className={labelCls}>Окно с (день)</label><input type="number" min={1} max={31} value={editForm.arrivalFromDay} onChange={(e) => setEditForm((p) => ({ ...p, arrivalFromDay: Number(e.target.value || 1) }))} className={inputCls} /></div>
            <div><label className={labelCls}>Окно по (день)</label><input type="number" min={1} max={31} value={editForm.arrivalToDay} onChange={(e) => setEditForm((p) => ({ ...p, arrivalToDay: Number(e.target.value || 28) }))} className={inputCls} /></div>
            <div><label className={labelCls}>Смещение</label><select value={editForm.periodOffset} onChange={(e) => setEditForm((p) => ({ ...p, periodOffset: Number(e.target.value) }))} className={inputCls}>
              <option value={0}>Текущий</option><option value={1}>+1 мес</option><option value={2}>+2 мес</option></select></div>
          </div>
          <div><label className={labelCls}>Режим обновления</label><select value={editForm.updateMode} onChange={(e) => setEditForm((p) => ({ ...p, updateMode: e.target.value as UpdateMode }))} className={inputCls}>
            {Object.entries(UPDATE_MODE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className={labelCls}>Исполнители</label>
            <select multiple value={editForm.defaultExecutorIds} onChange={(e) => { const sel = Array.from(e.target.selectedOptions).map((o) => o.value); setEditForm((p) => ({ ...p, defaultExecutorIds: sel })); }}
              className={`${inputCls} h-24`}>{users.map((u) => <option key={u.id} value={u.id}>{u.fullName || u.email}</option>)}</select></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Контактное лицо</label><input value={editForm.contactPerson} onChange={(e) => setEditForm((p) => ({ ...p, contactPerson: e.target.value }))} className={inputCls} /></div>
            <div><label className={labelCls}>Телефон</label><input value={editForm.contactPhone} onChange={(e) => setEditForm((p) => ({ ...p, contactPhone: e.target.value }))} className={inputCls} /></div>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><input type="checkbox" checked={editForm.sendEmail} onChange={(e) => setEditForm((p) => ({ ...p, sendEmail: e.target.checked }))} className="rounded border-slate-300 text-brand-red focus:ring-brand-red" />Email заказчику</label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><input type="checkbox" checked={editForm.notifyExecutor} onChange={(e) => setEditForm((p) => ({ ...p, notifyExecutor: e.target.checked }))} className="rounded border-slate-300 text-brand-red focus:ring-brand-red" />Уведомлять исполнителя</label>
          </div>
          <button type="submit" disabled={saving} className={`${btnPrimary} w-full`}>{saving ? 'Сохранение...' : 'Сохранить'}</button>
        </form>
      </Modal>

      {/* Plan card modal */}
      <Modal isOpen={isCardOpen} onClose={() => setIsCardOpen(false)} title={selectedPlan?.name || 'Карточка плана'}>
        {selectedPlan && <>
          <div className="mb-4 flex gap-2 border-b border-slate-200 dark:border-slate-700">
            {(['objects', 'requests', 'logs'] as const).map((tab) => (
              <button key={tab} type="button" onClick={() => setCardTab(tab)}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition ${cardTab === tab ? 'border-red-500 text-red-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {tab === 'objects' ? `Объекты (${(selectedPlan.maintenanceItemIds || []).length})` : tab === 'requests' ? `Заявки (${cardRequests.length})` : `Логи (${cardLogs.length})`}
              </button>
            ))}
          </div>
          {cardLoading ? <div className="py-8 text-center text-sm text-slate-400">Загрузка...</div> : <>
            {cardTab === 'objects' && <div className="max-h-80 overflow-y-auto space-y-1">
              {(selectedPlan.maintenanceItemIds || []).map((id) => {
                const item = allItems.find((i) => i.id === id);
                return <div key={id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
                  <span className="text-slate-900 dark:text-slate-100">{item?.name || id}</span>
                  <span className="text-xs text-slate-400">{item?.address || ''}</span>
                </div>;
              })}
              {(selectedPlan.maintenanceItemIds || []).length === 0 && <div className="py-4 text-center text-sm text-slate-400">Нет объектов</div>}
            </div>}
            {cardTab === 'requests' && <div className="max-h-80 overflow-y-auto overflow-x-auto">
              <table className="w-full min-w-[500px] text-left text-sm">
                <thead><tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="px-2 py-1.5 text-xs text-slate-500">Объект</th>
                  <th className="px-2 py-1.5 text-xs text-slate-500">Период</th>
                  <th className="px-2 py-1.5 text-xs text-slate-500">Статус</th>
                  <th className="px-2 py-1.5 text-xs text-slate-500">Заявка</th>
                </tr></thead>
                <tbody>{cardRequests.map((r) => (
                  <tr key={r.linkId} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-2 py-1.5 text-slate-900 dark:text-slate-100">{r.objectName || r.objectId?.slice(0, 8)}</td>
                    <td className="px-2 py-1.5 text-slate-500">{r.periodStart?.slice(0, 7)}</td>
                    <td className="px-2 py-1.5"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-700">{r.requestStatus || r.linkStatus}</span></td>
                    <td className="px-2 py-1.5 text-slate-500 truncate max-w-[150px]">{r.requestTitle || r.requestId?.slice(0, 8)}</td>
                  </tr>
                ))}</tbody>
              </table>
              {cardRequests.length === 0 && <div className="py-4 text-center text-sm text-slate-400">Нет заявок</div>}
            </div>}
            {cardTab === 'logs' && <div className="max-h-80 overflow-y-auto space-y-2">
              {cardLogs.map((log) => (
                <div key={log.id} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900 dark:text-slate-100">{log.periodStart?.slice(0, 7)} ({log.mode})</span>
                    <span className="text-xs text-slate-400">{log.executedAt ? new Date(log.executedAt).toLocaleString('ru') : ''}</span>
                  </div>
                  <div className="mt-1 flex gap-3 text-xs">
                    <span className="text-green-600">Создано: {log.created}</span>
                    <span className="text-slate-500">Пропущено: {log.skipped}</span>
                    <span className="text-blue-500">Обновлено: {log.updated}</span>
                    {log.errors > 0 && <span className="text-red-500">Ошибок: {log.errors}</span>}
                  </div>
                </div>
              ))}
              {cardLogs.length === 0 && <div className="py-4 text-center text-sm text-slate-400">Нет логов</div>}
            </div>}
          </>}
        </>}
      </Modal>

      {/* Generation modal */}
      <Modal isOpen={isGenOpen} onClose={() => setIsGenOpen(false)} title="Ручная генерация">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Месяц</label>
              <select value={genMonth} onChange={(e) => setGenMonth(Number(e.target.value))} className={inputCls}>
                {MONTH_NAMES.map((m, i) => <option key={i} value={i}>{m}</option>)}
              </select></div>
            <div><label className={labelCls}>Год</label>
              <input type="number" min={2024} max={2030} value={genYear} onChange={(e) => setGenYear(Number(e.target.value))} className={inputCls} /></div>
          </div>
          {genResult && <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800 space-y-1">
            <div className="text-green-600">Создано: {genResult.created}</div>
            <div className="text-slate-500">Пропущено: {genResult.skipped}</div>
            {genResult.updated > 0 && <div className="text-blue-500">Обновлено: {genResult.updated}</div>}
            {genResult.errors > 0 && <div className="text-red-500">Ошибок: {genResult.errors}</div>}
            {genResult.warnings?.length > 0 && <div className="text-yellow-600">Предупреждений: {genResult.warnings.length}</div>}
          </div>}
          <button type="button" onClick={() => void runGeneration()} disabled={generating} className={`${btnPrimary} w-full`}>
            <RefreshCw size={16} />{generating ? 'Генерация...' : 'Запустить генерацию'}</button>
        </div>
      </Modal>

      <ConfirmDialog isOpen={Boolean(deleteTarget)} onCancel={() => setDeleteTarget(null)} onConfirm={() => void onConfirmDelete()}
        title="Удалить план ТО?" message="План будет архивирован." confirmLabel="Удалить" />
    </div>
  );
}
