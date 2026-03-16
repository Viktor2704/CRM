import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import { Download, FileText, Plus, Search, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import Modal from '@/components/Modal';
import Breadcrumbs from '@/components/Breadcrumbs';
import ConfirmDialog from '@/components/ConfirmDialog';
import { SkeletonTable } from '@/components/Skeleton';
import { api, buildApiUrl, getAccessToken } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import type { Contract, Tenant, Direction } from '@/types';
import { usePermissions } from '@/hooks/usePermissions';
import { useDebounce } from '@/hooks/useDebounce';

type ContractsResponse = Contract[] | { items?: Contract[]; data?: Contract[] };
type ListResponse<T> = T[] | { items?: T[]; data?: T[] };

import { normalizeList } from '@/utils/normalize';

type ContractForm = {
  number: string;
  type: string;
  tenantId: string;
  directionId: string;
  startDate: string;
  endDate: string;
  status: string;
  description: string;
};

const INITIAL_FORM: ContractForm = {
  number: '',
  type: 'MAINTENANCE',
  tenantId: '',
  directionId: '',
  startDate: '',
  endDate: '',
  status: 'DRAFT',
  description: '',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  ACTIVE: 'Активный',
  EXPIRED: 'Истёк',
  TERMINATED: 'Расторгнут',
};

const TYPE_LABELS: Record<string, string> = {
  MAINTENANCE: 'Обслуживание',
  SERVICE: 'Сервис',
  SUPPLY: 'Поставка',
  LEASE: 'Аренда',
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  DRAFT: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  EXPIRED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  TERMINATED: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

export default function ContractsPage() {
  const toast = useToast();
  const { canManage } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const debouncedSearch = useDebounce(search);
  const statusFilter = searchParams.get('status') || '';

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Contract | null>(null);
  const [createForm, setCreateForm] = useState<ContractForm>(INITIAL_FORM);
  const [editForm, setEditForm] = useState<ContractForm>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const canOpenContracts = canManage;

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value.trim()) params.set(key, value);
    else params.delete(key);
    setSearchParams(params, { replace: true });
  };

  const loadAll = async () => {
    setError('');
    const [contractsRaw, tenantsRaw, directionsRaw] = await Promise.all([
      api.getT<ContractsResponse>('/contracts'),
      api.getT<ListResponse<Tenant>>('/tenants').catch(() => ({ items: [] as Tenant[] })),
      api.getT<ListResponse<Direction>>('/directions'),
    ]);
    setContracts(normalizeList(contractsRaw));
    setTenants(normalizeList(tenantsRaw));
    setDirections(normalizeList(directionsRaw));
  };

  useEffect(() => {
    if (!canOpenContracts) {
      setLoading(false);
      setContracts([]);
      setTenants([]);
      setDirections([]);
      setError('');
      return;
    }
    let cancelled = false;
    void loadAll()
      .catch(() => {
        if (!cancelled) {
          setError('Не удалось загрузить договоры.');
          toast.error('Не удалось загрузить договоры.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [canOpenContracts, toast]);

  if (!canOpenContracts) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Договоры' }]} />
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          Доступ к реестру договоров открыт только внутренним глобальным ролям.
        </div>
      </div>
    );
  }

  const tenantNameById = useMemo(() => {
    const map: Record<string, string> = {};
    tenants.forEach((t) => { map[t.id] = t.brandName || t.name || t.id; });
    return map;
  }, [tenants]);

  const _directionNameById = useMemo(() => {
    const map: Record<string, string> = {};
    directions.forEach((d) => { map[d.id] = d.name || d.id; });
    return map;
  }, [directions]);

  const filtered = useMemo(() => {
    let list = contracts;
    if (statusFilter) list = list.filter((c) => c.status === statusFilter);
    const term = debouncedSearch.trim().toLowerCase();
    if (term) list = list.filter((c) =>
      String(c.number || '').toLowerCase().includes(term) ||
      String(c.description || '').toLowerCase().includes(term)
    );
    return list;
  }, [contracts, debouncedSearch, statusFilter]);

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.postT('/contracts', {
        number: createForm.number,
        type: createForm.type,
        tenantId: createForm.tenantId || null,
        directionId: createForm.directionId || null,
        startDate: createForm.startDate || null,
        endDate: createForm.endDate || null,
        status: createForm.status,
        description: createForm.description,
      });
      setCreateForm(INITIAL_FORM);
      setIsCreateOpen(false);
      await loadAll();
      toast.success('Договор создан.');
    } catch {
      toast.error('Не удалось создать договор.');
    } finally {
      setSaving(false);
    }
  };

  const onRowClick = (contract: Contract) => {
    setSelectedContract(contract);
    setEditForm({
      number: contract.number || '',
      type: contract.type || 'MAINTENANCE',
      tenantId: contract.tenantId || '',
      directionId: contract.directionId || '',
      startDate: (contract.startDate || '').slice(0, 10),
      endDate: (contract.endDate || '').slice(0, 10),
      status: contract.status || 'DRAFT',
      description: contract.description || '',
    });
    setIsEditOpen(true);
  };

  const onUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedContract) return;
    setSaving(true);
    try {
      await api.patchT(`/contracts/${selectedContract.id}`, {
        number: editForm.number,
        type: editForm.type,
        tenantId: editForm.tenantId || null,
        directionId: editForm.directionId || null,
        startDate: editForm.startDate || null,
        endDate: editForm.endDate || null,
        status: editForm.status,
        description: editForm.description,
      });
      setIsEditOpen(false);
      setSelectedContract(null);
      await loadAll();
      toast.success('Договор обновлён.');
    } catch {
      toast.error('Не удалось обновить договор.');
    } finally {
      setSaving(false);
    }
  };

  const onDeleteClick = (event: MouseEvent, contract: Contract) => {
    event.stopPropagation();
    setDeleteTarget(contract);
  };

  const onConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delT(`/contracts/${deleteTarget.id}`);
      await loadAll();
      toast.success('Договор удалён.');
    } catch {
      toast.error('Не удалось удалить договор.');
    } finally {
      setDeleteTarget(null);
    }
  };

  const downloadCsv = async () => {
    setExporting(true);
    try {
      const token = getAccessToken();
      const res = await fetch(buildApiUrl('/contracts/export-xlsx'), {
        headers: { Authorization: `Bearer ${token ?? ''}` },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'contracts.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Не удалось скачать Excel');
    } finally {
      setExporting(false);
    }
  };

  const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
  const labelClass = 'mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300';

  const renderForm = (form: ContractForm, setForm: (f: ContractForm) => void) => (
    <div className="space-y-4">
      <div>
        <label className={labelClass}>Номер договора</label>
        <input required value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} className={inputClass} placeholder="№48ОНИС/10-25" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Тип</label>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inputClass}>
            {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Статус</label>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputClass}>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={labelClass}>Контрагент</label>
        <select value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} className={inputClass}>
          <option value="">Не выбрано</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.brandName || t.name}</option>)}
        </select>
      </div>
      <div>
        <label className={labelClass}>Направление</label>
        <select value={form.directionId} onChange={(e) => setForm({ ...form, directionId: e.target.value })} className={inputClass}>
          <option value="">Не выбрано</option>
          {directions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Дата начала</label>
          <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Дата окончания</label>
          <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={inputClass} />
        </div>
      </div>
      <div>
        <label className={labelClass}>Описание</label>
        <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Договоры' }]} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Договоры</h2>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button type="button" onClick={() => void downloadCsv()} disabled={exporting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:w-auto">
            <Download size={16} />
            {exporting ? 'Скачиваю...' : 'Скачать Excel'}
          </button>
          {canManage ? (
            <button type="button" onClick={() => setIsCreateOpen(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 sm:w-auto">
              <Plus size={16} />
              Создать
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={17} />
          <input value={search} onChange={(e) => updateFilter('search', e.target.value)}
            placeholder="Поиск по номеру или описанию..."
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <select value={statusFilter} onChange={(e) => updateFilter('status', e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
          <option value="">Все статусы</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800">
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Номер / описание</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Тип</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Контрагент</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Сроки</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Статус</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <SkeletonTable rows={4} cols={6} />
              ) : (
                <>
                  {filtered.map((contract) => (
                    <tr key={contract.id} className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => onRowClick(contract)}>
                      <td className="px-5 py-4">
                        <div className="flex items-start gap-3">
                          <div className="rounded-lg bg-slate-100 p-2 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            <FileText size={16} />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-slate-100">{contract.number}</p>
                            <p className="text-sm text-slate-500 dark:text-slate-400">{contract.description || '-'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-700 dark:text-slate-300">{TYPE_LABELS[contract.type] || contract.type}</td>
                      <td className="px-5 py-4 text-sm text-slate-700 dark:text-slate-300">{tenantNameById[contract.tenantId || ''] || '-'}</td>
                      <td className="px-5 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {contract.startDate ? <p>с {contract.startDate}</p> : null}
                        {contract.endDate ? <p className="text-slate-500 dark:text-slate-400">до {contract.endDate}</p> : null}
                        {!contract.startDate && !contract.endDate ? '-' : null}
                      </td>
                      <td className="px-5 py-4">
                        <span className={['inline-flex rounded-full px-2.5 py-1 text-xs font-semibold', STATUS_COLORS[contract.status] || 'bg-slate-100 text-slate-600'].join(' ')}>
                          {STATUS_LABELS[contract.status] || contract.status}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {canManage ? (
                          <button type="button" onClick={(e) => onDeleteClick(e, contract)}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300 min-h-[44px] min-w-[44px] justify-center sm:min-h-0 sm:min-w-0">
                            <Trash2 size={14} />
                            <span className="hidden sm:inline">Удалить</span>
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center"><Search size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" /><p className="text-sm text-slate-500 dark:text-slate-400">Ничего не найдено</p><p className="text-xs text-slate-400 dark:text-slate-500">Попробуйте изменить фильтры</p></td>
                    </tr>
                  ) : null}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Создание договора">
        <form onSubmit={onCreate} className="space-y-4">
          {renderForm(createForm, setCreateForm)}
          <button type="submit" disabled={saving}
            className="inline-flex w-full items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60">
            {saving ? 'Сохранение...' : 'Создать'}
          </button>
        </form>
      </Modal>

      <Modal isOpen={isEditOpen} onClose={() => { setIsEditOpen(false); setSelectedContract(null); }} title="Редактирование договора">
        <form onSubmit={onUpdate} className="space-y-4">
          {renderForm(editForm, setEditForm)}
          <button type="submit" disabled={saving}
            className="inline-flex w-full items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60">
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void onConfirmDelete()}
        title="Удалить договор?"
        message="Это действие нельзя отменить."
        confirmLabel="Удалить"
      />
    </div>
  );
}
