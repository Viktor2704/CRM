import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent } from 'react';
import { Building2, Download, Mail, Pencil, Phone, Plus, Search, Trash2, Upload, Clock, Eye } from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Modal from '@/components/Modal';
import Breadcrumbs from '@/components/Breadcrumbs';
import ConfirmDialog from '@/components/ConfirmDialog';
import { SkeletonTable } from '@/components/Skeleton';
import SavedViewsPanel from '@/components/SavedViewsPanel';
import ActivityTimeline from '@/components/ActivityTimeline';
import { api, buildApiUrl, getAccessToken } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useDebounce } from '@/hooks/useDebounce';
import { useSavedViews, type SavedView } from '../hooks/useSavedViews';
import type { Tenant } from '@/types';

type TenantsResponse = Tenant[] | { items?: Tenant[]; tenants?: Tenant[]; data?: Tenant[] };

type TenantForm = {
  name: string;
  brandName: string;
  inn: string;
  email: string;
  phone: string;
  type: 'tenant' | 'contractor';
};

type TenantDetails = {
  tenant: Tenant;
  items: { id: string; name: string; address?: string; positionNumber?: string; legalEntity?: string; contractNumber?: string; directionName?: string }[];
  requests: { id: string; title?: string; status: string; type: string; createdAt: string }[];
  installations: { id: string; title?: string; status: string; type: string; isProject: boolean; createdAt: string }[];
  activityLog?: Array<{
    id: string;
    entityType: string;
    entityId: string;
    activityType: string;
    actorUserId?: string;
    actorName: string;
    severity: 'info' | 'warning' | 'error' | 'success';
    title: string;
    description: string;
    metadata?: Record<string, any>;
    createdAt: string;
  }>;
};

const INITIAL_FORM: TenantForm = { name: '', brandName: '', inn: '', email: '', phone: '', type: 'tenant' };

const STATUS_LABELS: Record<string, string> = {
  new: 'Новая', in_progress: 'В работе', done: 'Выполнена', closed: 'Закрыта', cancelled: 'Отменена',
};

import { normalizeList } from '@/utils/normalize';

const buildQueryString = (params: Record<string, string | number | undefined>) => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    searchParams.set(key, String(value));
  });
  return searchParams.toString();
};

export default function TenantsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { isAdminOrManager } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const brandFilter = searchParams.get('brand') || '';
  const innFilter = searchParams.get('inn') || '';
  const contactFilter = searchParams.get('contact') || '';
  const debouncedSearch = useDebounce(search);
  const debouncedBrand = useDebounce(brandFilter);
  const debouncedInn = useDebounce(innFilter);
  const debouncedContact = useDebounce(contactFilter);

  // Saved views
  const savedViews = useSavedViews('tenants');
  const currentViewParams = {
    search: debouncedSearch,
    brand: debouncedBrand,
    inn: debouncedInn,
    contact: debouncedContact,
  };

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [importingXlsx, setImportingXlsx] = useState(false);
  const importXlsxRef = useRef<HTMLInputElement>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null);
  const [createForm, setCreateForm] = useState<TenantForm>(INITIAL_FORM);
  const [editForm, setEditForm] = useState<TenantForm>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);

  // Card panel
  const [cardTenant, setCardTenant] = useState<Tenant | null>(null);
  const [cardDetails, setCardDetails] = useState<TenantDetails | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [cardTab, setCardTab] = useState<'overview' | 'activity'>('overview');

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value.trim()) { params.set(key, value); } else { params.delete(key); }
    setSearchParams(params, { replace: true });
  };

  const loadTenants = async (searchValue = debouncedSearch, brand = debouncedBrand, inn = debouncedInn, contact = debouncedContact) => {
    setError('');
    const query = buildQueryString({
      search: searchValue.trim() || undefined,
      brand: brand.trim() || undefined,
      inn: inn.trim() || undefined,
      contact: contact.trim() || undefined,
      limit: 100,
    });
    const response = await api.getT<TenantsResponse>(`/tenants${query ? `?${query}` : ''}`);
    setTenants(normalizeList(response));
  };

  useEffect(() => {
    let cancelled = false;
    void loadTenants()
      .catch(() => { if (!cancelled) { setError('Не удалось загрузить контрагентов.'); toast.error('Не удалось загрузить контрагентов.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedSearch, debouncedBrand, debouncedInn, debouncedContact, toast]);

  useEffect(() => {
    const focusId = searchParams.get('focus');
    if (!focusId || loading || tenants.length === 0 || cardTenant) return;
    const focusTenant = tenants.find((tenant) => tenant.id === focusId);
    if (!focusTenant) return;
    void openCard(focusTenant);
    const params = new URLSearchParams(searchParams);
    params.delete('focus');
    setSearchParams(params, { replace: true });
  }, [cardTenant, loading, searchParams, setSearchParams, tenants]);

  const openCard = async (tenant: Tenant) => {
    setCardTenant(tenant);
    setCardDetails(null);
    setCardLoading(true);
    try {
      const details = await api.getT<TenantDetails>(`/tenants/${tenant.id}/360`);
      setCardDetails(details);
    } catch {
      // show card without details
    } finally {
      setCardLoading(false);
    }
  };

  const openEdit = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setEditForm({
      name: tenant.name || '',
      brandName: tenant.brandName || '',
      inn: tenant.inn || '',
      email: tenant.email || '',
      phone: tenant.phone || '',
      type: tenant.type === 'contractor' ? 'contractor' : 'tenant',
    });
    setIsEditOpen(true);
  };

  const onRowClick = (tenant: Tenant) => {
    void openCard(tenant);
  };

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.postT('/tenants', createForm);
      setCreateForm(INITIAL_FORM);
      setIsCreateOpen(false);
      await loadTenants();
      toast.success('Контрагент создан.');
    } catch {
      setError('Не удалось создать контрагента.');
      toast.error('Не удалось создать контрагента.');
    } finally {
      setSaving(false);
    }
  };

  const onUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTenant) return;
    setSaving(true);
    setError('');
    try {
      await api.patchT(`/tenants/${selectedTenant.id}`, editForm);
      setIsEditOpen(false);
      setSelectedTenant(null);
      await loadTenants();
      toast.success('Контрагент обновлён.');
      if (cardTenant?.id === selectedTenant.id) {
        void openCard({ ...cardTenant, ...editForm });
      }
    } catch {
      setError('Не удалось обновить контрагента.');
      toast.error('Не удалось обновить контрагента.');
    } finally {
      setSaving(false);
    }
  };

  const onDeleteClick = (event: MouseEvent, tenant: Tenant) => {
    event.stopPropagation();
    setDeleteTarget(tenant);
  };

  const onConfirmDelete = async () => {
    if (!deleteTarget) return;
    setError('');
    try {
      await api.delT(`/tenants/${deleteTarget.id}`);
      if (cardTenant?.id === deleteTarget.id) setCardTenant(null);
      await loadTenants();
      toast.success('Контрагент удалён.');
    } catch {
      setError('Не удалось удалить контрагента.');
      toast.error('Не удалось удалить контрагента.');
    } finally {
      setDeleteTarget(null);
    }
  };

  const downloadCsv = async () => {
    setExporting(true);
    try {
      const token = getAccessToken();
      const res = await fetch(buildApiUrl('/tenants/export-xlsx'), {
        headers: { Authorization: `Bearer ${token ?? ''}` },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'tenants.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Не удалось скачать Excel'); } finally { setExporting(false); }
  };

  const handleImportXlsx = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (importXlsxRef.current) importXlsxRef.current.value = '';
    setImportingXlsx(true);
    try {
      const token = getAccessToken();
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(buildApiUrl('/tenants/import-xlsx'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token ?? ''}` },
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) throw new Error('import failed');
      const result = await res.json() as { summary?: { created?: number; updated?: number } };
      await loadTenants();
      toast.success(`Импортировано: ${result?.summary?.created ?? 0} создано, ${result?.summary?.updated ?? 0} обновлено.`);
    } catch { toast.error('Не удалось импортировать Excel.'); } finally { setImportingXlsx(false); }
  };

  const TenantFormFields = ({ form, setForm }: { form: TenantForm; setForm: (fn: (prev: TenantForm) => TenantForm) => void }) => (
    <>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Тип</label>
        <div className="flex gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" checked={form.type === 'tenant'} onChange={() => setForm((p) => ({ ...p, type: 'tenant' }))}
              className="text-brand-red focus:ring-brand-red" />
            Арендатор
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" checked={form.type === 'contractor'} onChange={() => setForm((p) => ({ ...p, type: 'contractor' }))}
              className="text-brand-red focus:ring-brand-red" />
            Заказчик (монтаж)
          </label>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Название</label>
        <input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="ООО «Компания»"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Бренд</label>
          <input value={form.brandName} onChange={(e) => setForm((p) => ({ ...p, brandName: e.target.value }))} placeholder="Бренд компании"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">ИНН</label>
          <input value={form.inn} onChange={(e) => setForm((p) => ({ ...p, inn: e.target.value }))} placeholder="1234567890"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Email</label>
          <input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} placeholder="info@novinjstroi.ru"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Телефон</label>
          <input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="+7 (495) 922-07-01"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
        </div>
      </div>
    </>
  );

  const handleSelectView = (view: SavedView) => {
    const params = new URLSearchParams();
    if (view.params.search) params.set('search', view.params.search);
    if (view.params.brand) params.set('brand', view.params.brand);
    if (view.params.inn) params.set('inn', view.params.inn);
    if (view.params.contact) params.set('contact', view.params.contact);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Контрагенты' }]} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        {/* Saved Views Sidebar */}
        <div className="hidden lg:block">
          <SavedViewsPanel
            views={savedViews.views}
            defaultViewId={savedViews.defaultViewId}
            systemViewId={savedViews.systemViewId}
            currentParams={currentViewParams}
            onSelectView={handleSelectView}
            onCreateView={savedViews.createView}
            onUpdateView={savedViews.updateView}
            onDeleteView={savedViews.deleteView}
            loading={savedViews.loading}
          />
        </div>

        {/* Main Content */}
        <div className="space-y-6">

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Контрагенты</h2>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button type="button" onClick={() => void downloadCsv()} disabled={exporting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:w-auto">
              <Download size={16} />{exporting ? 'Скачиваю...' : 'Скачать Excel'}
            </button>
            {isAdminOrManager ? (
              <>
                <input ref={importXlsxRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => void handleImportXlsx(e)} />
                <button type="button" onClick={() => importXlsxRef.current?.click()} disabled={importingXlsx}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-green-300 bg-white px-4 py-2 text-sm font-semibold text-green-700 transition hover:bg-green-50 disabled:opacity-60 dark:border-green-700 dark:bg-slate-900 dark:text-green-400 dark:hover:bg-green-900/20 sm:w-auto">
                  <Upload size={16} />{importingXlsx ? 'Загружаю...' : 'Загрузить Excel'}
                </button>
                <button type="button" onClick={() => setIsCreateOpen(true)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 sm:w-auto">
                  <Plus size={16} />Создать
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={17} />
          <input value={search} onChange={(e) => updateFilter('search', e.target.value)} placeholder="Поиск по названию или ИНН..."
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
        </div>

        {/* Filter inputs for brand, inn, contact */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="relative">
            <input
              value={brandFilter}
              onChange={(e) => updateFilter('brand', e.target.value)}
              placeholder="Фильтр по бренду..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <div className="relative">
            <input
              value={innFilter}
              onChange={(e) => updateFilter('inn', e.target.value)}
              placeholder="Фильтр по ИНН..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <div className="relative">
            <input
              value={contactFilter}
              onChange={(e) => updateFilter('contact', e.target.value)}
              placeholder="Фильтр по контакту..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800">
                  <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Название</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Тип</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Бренд</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">ИНН</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Email</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Телефон</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? <SkeletonTable rows={5} cols={6} /> : (
                  <>
                    {tenants.map((tenant) => (
                      <tr key={tenant.id}
                        className={['cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800',
                          cardTenant?.id === tenant.id ? 'bg-red-50 dark:bg-red-950/20' :
                          tenant.type === 'contractor' ? 'bg-blue-50/40 dark:bg-blue-950/10' : ''
                        ].join(' ')}
                        onClick={() => onRowClick(tenant)}>
                        <td className="px-5 py-3 text-sm font-medium text-slate-900 dark:text-slate-100">{tenant.name || '-'}</td>
                        <td className="px-5 py-3 text-sm">
                          {tenant.type === 'contractor' ? (
                            <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Заказчик</span>
                          ) : (
                            <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/40 dark:text-green-300">Арендатор</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-700 dark:text-slate-300">{tenant.brandName || '-'}</td>
                        <td className="px-5 py-3 text-sm text-slate-700 dark:text-slate-300">{tenant.inn || '-'}</td>
                        <td className="px-5 py-3 text-sm text-slate-700 dark:text-slate-300">{tenant.email || '-'}</td>
                        <td className="px-5 py-3 text-sm text-slate-700 dark:text-slate-300">{tenant.phone || '-'}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/tenants/${tenant.id}/360`); }}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-blue-50 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-blue-950/40 dark:hover:text-blue-300">
                              <Eye size={13} />360°
                            </button>
                            {isAdminOrManager ? (
                              <>
                                <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(tenant); }}
                                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700">
                                  <Pencil size={13} />Изменить
                                </button>
                                <button type="button" onClick={(e) => onDeleteClick(e, tenant)}
                                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300">
                                  <Trash2 size={13} />Удалить
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {tenants.length === 0 ? (
                      <tr><td colSpan={7} className="px-5 py-12 text-center"><Search size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" /><p className="text-sm text-slate-500 dark:text-slate-400">Ничего не найдено</p><p className="text-xs text-slate-400 dark:text-slate-500">Попробуйте изменить фильтры</p></td></tr>
                    ) : null}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>

      {/* Tenant card modal */}
      <Modal isOpen={Boolean(cardTenant)} onClose={() => { setCardTenant(null); setCardTab('overview'); }} title={cardTenant?.name ?? ''}>
        {cardTenant ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Building2 size={20} className="shrink-0 text-brand-red" />
              <div>
                {cardTenant.brandName && cardTenant.brandName !== cardTenant.name ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">{cardTenant.brandName}</p>
                ) : null}
                {cardTenant.inn ? <p className="text-sm text-slate-600 dark:text-slate-400">ИНН: <span className="font-medium text-slate-900 dark:text-slate-100">{cardTenant.inn}</span></p> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              {cardTenant.email ? (
                <a href={`mailto:${cardTenant.email}`} className="flex items-center gap-1.5 text-brand-red hover:underline">
                  <Mail size={14} />{cardTenant.email}
                </a>
              ) : null}
              {cardTenant.phone ? (
                <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                  <Phone size={14} />{cardTenant.phone}
                </span>
              ) : null}
            </div>
            {isAdminOrManager ? (
              <button type="button" onClick={() => { setCardTenant(null); openEdit(cardTenant); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                <Pencil size={14} />Редактировать
              </button>
            ) : null}

            {/* Tabs */}
            <div className="border-b border-slate-200 dark:border-slate-700">
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setCardTab('overview')}
                  className={`pb-2 text-sm font-medium transition ${
                    cardTab === 'overview'
                      ? 'border-b-2 border-brand-red text-brand-red'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                  }`}
                >
                  Обзор
                </button>
                <button
                  type="button"
                  onClick={() => setCardTab('activity')}
                  className={`flex items-center gap-1.5 pb-2 text-sm font-medium transition ${
                    cardTab === 'activity'
                      ? 'border-b-2 border-brand-red text-brand-red'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                  }`}
                >
                  <Clock size={14} />
                  Активность
                </button>
              </div>
            </div>

            {cardLoading ? (
              <p className="text-sm text-slate-400">Загрузка...</p>
            ) : cardDetails ? (
              <>
                {cardTab === 'overview' && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 dark:border-slate-800">
                  <div className="border-b border-slate-200 px-4 py-2 text-xs font-semibold uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    Объекты ({cardDetails.items.length})
                  </div>
                  {cardDetails.items.length > 0 ? (
                    <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                      {cardDetails.items.map((item) => (
                        <li key={item.id} className="px-4 py-2">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.name || '-'}</p>
                          {item.directionName ? <p className="text-xs text-slate-500 dark:text-slate-400">{item.directionName}</p> : null}
                          {item.address ? <p className="text-xs text-slate-500 dark:text-slate-400">{item.address}</p> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 py-3 text-sm text-slate-400">Нет привязанных объектов</p>
                  )}
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800">
                  <div className="border-b border-slate-200 px-4 py-2 text-xs font-semibold uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    Заявки ПО ТО ({cardDetails.requests.length})
                  </div>
                  {cardDetails.requests.length > 0 ? (
                    <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                      {cardDetails.requests.map((req) => (
                        <li key={req.id} className="px-4 py-2">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{req.title || 'Без названия'}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {STATUS_LABELS[req.status] ?? req.status} · {new Date(req.createdAt).toLocaleDateString('ru')}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 py-3 text-sm text-slate-400">Нет заявок</p>
                  )}
                </div>
                {cardDetails.installations.length > 0 || cardTenant.type === 'contractor' ? (
                  <div className="rounded-lg border border-blue-200 dark:border-blue-900 sm:col-span-2">
                    <div className="border-b border-blue-200 px-4 py-2 text-xs font-semibold uppercase text-blue-600 dark:border-blue-900 dark:text-blue-400">
                      Монтажи и проекты ({cardDetails.installations.length})
                    </div>
                    {cardDetails.installations.length > 0 ? (
                      <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                        {cardDetails.installations.map((inst) => (
                          <li key={inst.id} className="flex items-center justify-between px-4 py-2">
                            <div>
                              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{inst.title || 'Без названия'}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {inst.isProject ? 'Проект' : 'Монтаж'} · {new Date(inst.createdAt).toLocaleDateString('ru')}
                              </p>
                            </div>
                            <span className={[
                              'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold',
                              inst.status === 'done' || inst.status === 'closed' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' :
                              inst.status === 'in_progress' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                              inst.status === 'cancelled' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                              'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                            ].join(' ')}>
                              {STATUS_LABELS[inst.status] ?? inst.status}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="px-4 py-3 text-sm text-slate-400">Нет монтажей и проектов</p>
                    )}
                  </div>
                ) : null}
              </div>
            )}

            {cardTab === 'activity' && (
              <div className="max-h-[500px] overflow-y-auto">
                <ActivityTimeline
                  activities={cardDetails?.activityLog || []}
                  loading={cardLoading}
                />
              </div>
            )}
          </>
        ) : null}
      </div>
    ) : null}
  </Modal>

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Создание контрагента">
        <form onSubmit={onCreate} className="space-y-4">
          <TenantFormFields form={createForm} setForm={setCreateForm} />
          <button type="submit" disabled={saving}
            className="inline-flex w-full items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60">
            {saving ? 'Сохранение...' : 'Создать'}
          </button>
        </form>
      </Modal>

      <Modal isOpen={isEditOpen} onClose={() => { setIsEditOpen(false); setSelectedTenant(null); }} title="Редактирование контрагента">
        <form onSubmit={onUpdate} className="space-y-4">
          <TenantFormFields form={editForm} setForm={setEditForm} />
          <button type="submit" disabled={saving}
            className="inline-flex w-full items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60">
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </form>
      </Modal>

      <ConfirmDialog isOpen={Boolean(deleteTarget)} onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void onConfirmDelete()} title="Удалить контрагента?" message="Это действие нельзя отменить." confirmLabel="Удалить" />
        </div>
      </div>
    </div>
  );
}
