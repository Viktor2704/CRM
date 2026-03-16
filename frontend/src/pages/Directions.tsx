import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowLeft, Check, Compass, Download, MapPin, Plus, Search, Trash2, Upload, UserCheck } from 'lucide-react';
import Modal from '@/components/Modal';
import Breadcrumbs from '@/components/Breadcrumbs';
import ConfirmDialog from '@/components/ConfirmDialog';
import { SkeletonTable } from '@/components/Skeleton';
import { api, buildApiUrl, getAccessToken } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { SYSTEM_LABELS, SystemType, type Direction, type MaintenanceItem, type PartialRecord } from '@/types';
import { usePermissions } from '@/hooks/usePermissions';

type TenantOption = { id: string; name: string; inn: string; type?: string };
type ManagerOption = { id: string; fullName: string };

type DirectionsResponse = Direction[] | { items?: Direction[]; directions?: Direction[]; data?: Direction[] };
type MaintenanceItemsResponse =
  | MaintenanceItem[]
  | { items?: MaintenanceItem[]; maintenanceItems?: MaintenanceItem[]; data?: MaintenanceItem[] };

const SYSTEM_ORDER: SystemType[] = [
  SystemType.APS,
  SystemType.SOUE,
  SystemType.AUPT,
  SystemType.VPV,
  SystemType.FIRE_EXTINGUISHERS,
  SystemType.EXIT_SIGNS,
  SystemType.GAS,
  SystemType.SKUD,
  SystemType.SKS,
  SystemType.SVN,
  SystemType.ASUTP,
  SystemType.SOTS,
];

const buildInitialSystems = (): PartialRecord<SystemType, boolean> => {
  const value: PartialRecord<SystemType, boolean> = {};
  SYSTEM_ORDER.forEach((systemType) => {
    value[systemType] = false;
  });
  return value;
};

import { normalizeList } from '@/utils/normalize';

const asText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export default function DirectionsPage() {
  const toast = useToast();
  const { canManage, isAdminOrManager } = usePermissions();
  const [directions, setDirections] = useState<Direction[]>([]);
  const [selectedDirection, setSelectedDirection] = useState<Direction | null>(null);
  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [loadingDirections, setLoadingDirections] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');

  const [isDirectionModalOpen, setIsDirectionModalOpen] = useState(false);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [deleteDirectionTarget, setDeleteDirectionTarget] = useState<Direction | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] = useState<MaintenanceItem | null>(null);

  const [directionForm, setDirectionForm] = useState({ name: '', address: '' });
  const [itemForm, setItemForm] = useState({
    positionNumber: '',
    name: '',
    address: '',
    legalEntity: '',
    contractNumber: '',
    tenantId: '',
    systems: buildInitialSystems(),
  });
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [savingManagerFor, setSavingManagerFor] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdminOrManager) {
      setTenants([]);
      return;
    }
    void api.getT<TenantOption[]>('/tenants').then((data) => {
      setTenants(Array.isArray(data) ? data : []);
    }).catch(() => {});
  }, [isAdminOrManager]);

  useEffect(() => {
    if (!isAdminOrManager) {
      setManagers([]);
      return;
    }
    void api.getT<{ items?: ManagerOption[] }>('/client-managers').then((data) => {
      const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
      setManagers(list);
    }).catch(() => {});
  }, [isAdminOrManager]);
  const itemsImportXlsxRef = useRef<HTMLInputElement | null>(null);
  const [importingItemsXlsx, setImportingItemsXlsx] = useState(false);
  const [exportingItems, setExportingItems] = useState(false);
  const [exportingDirections, setExportingDirections] = useState(false);

  const downloadDirectionsCsv = async () => {
    setExportingDirections(true);
    try {
      const token = getAccessToken();
      const res = await fetch(buildApiUrl('/directions/export-xlsx'), {
        headers: { Authorization: `Bearer ${token ?? ''}` },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'directions.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Не удалось скачать Excel');
    } finally {
      setExportingDirections(false);
    }
  };

  const downloadItemsXlsx = async () => {
    if (!selectedDirection?.id) return;
    setExportingItems(true);
    try {
      const token = getAccessToken();
      const res = await fetch(buildApiUrl(`/directions/${selectedDirection.id}/items/export-xlsx`), {
        headers: { Authorization: `Bearer ${token ?? ''}` },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `items-${selectedDirection.id}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Таблица объектов выгружена.');
    } catch {
      toast.error('Не удалось выгрузить таблицу объектов.');
    } finally {
      setExportingItems(false);
    }
  };

  const loadDirections = async () => {
    setError('');
    const response = await api.getDirection<DirectionsResponse>('/directions');
    const parsed = normalizeList<Direction>(response);
    setDirections(parsed);

    if (selectedDirection) {
      const exists = parsed.find((direction) => direction.id === selectedDirection.id);
      if (!exists) {
        setSelectedDirection(null);
        setItems([]);
      } else {
        setSelectedDirection(exists);
      }
    }
  };

  const loadItems = async (directionId: string) => {
    setLoadingItems(true);
    try {
      const response = await api.getMaintenanceItem<MaintenanceItemsResponse>(`/directions/${directionId}/items`);
      setItems(normalizeList<MaintenanceItem>(response));
    } finally {
      setLoadingItems(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void loadDirections()
      .catch(() => {
        if (!cancelled) {
          setError('Не удалось загрузить направления.');
          toast.error('Не удалось загрузить направления.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDirections(false);
      });

    return () => {
      cancelled = true;
    };
  }, [toast]);

  useEffect(() => {
    if (!selectedDirection?.id) return;
    void loadItems(selectedDirection.id).catch(() => {
      toast.error('Не удалось загрузить объекты обслуживания.');
    });
  }, [selectedDirection?.id, toast]);

  const filteredDirections = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return directions;
    return directions.filter((direction) => {
      return asText(direction.name).toLowerCase().includes(term) || asText(direction.address).toLowerCase().includes(term);
    });
  }, [directions, searchTerm]);

  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => {
      return (
        asText(item.positionNumber).toLowerCase().includes(term) ||
        asText(item.name).toLowerCase().includes(term) ||
        asText(item.address).toLowerCase().includes(term) ||
        asText(item.legalEntity).toLowerCase().includes(term) ||
        asText(item.contractNumber).toLowerCase().includes(term)
      );
    });
  }, [items, searchTerm]);

  const handleImportItemsXlsx = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selectedDirection?.id) return;
    setImportingItemsXlsx(true);
    try {
      const token = getAccessToken();
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(buildApiUrl(`/directions/${selectedDirection.id}/items/import-xlsx`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token ?? ''}` },
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) throw new Error('import failed');
      const result = await res.json() as { summary?: { created?: number; updated?: number } };
      await loadItems(selectedDirection.id);
      toast.success(`Импортировано: ${result?.summary?.created ?? 0} создано, ${result?.summary?.updated ?? 0} обновлено.`);
    } catch {
      toast.error('Не удалось импортировать Excel.');
    } finally {
      setImportingItemsXlsx(false);
    }
  };

  const openCreateItemModal = () => {
    const numericPositions = items
      .map((item) => Number(item.positionNumber))
      .filter((value) => Number.isFinite(value));
    const nextNumber = numericPositions.length > 0 ? Math.max(...numericPositions) + 1 : items.length + 1;

    setItemForm({
      positionNumber: String(nextNumber),
      name: '',
      address: '',
      legalEntity: '',
      contractNumber: '',
      tenantId: '',
      systems: buildInitialSystems(),
    });
    setIsItemModalOpen(true);
  };

  const createDirection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await api.post('/directions', directionForm);
      setIsDirectionModalOpen(false);
      setDirectionForm({ name: '', address: '' });
      await loadDirections();
      toast.success('Направление создано.');
    } catch {
      toast.error('Не удалось создать направление.');
    }
  };

  const createItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedDirection?.id) return;
    try {
      await api.post(`/directions/${selectedDirection.id}/items`, itemForm);
      setIsItemModalOpen(false);
      await loadItems(selectedDirection.id);
      toast.success('Объект обслуживания добавлен.');
    } catch {
      toast.error('Не удалось добавить объект обслуживания.');
    }
  };

  const onConfirmDeleteDirection = async () => {
    if (!deleteDirectionTarget) return;
    try {
      await api.del(`/directions/${deleteDirectionTarget.id}`);
      await loadDirections();
      toast.success('Направление удалено.');
    } catch {
      toast.error('Не удалось удалить направление.');
    } finally {
      setDeleteDirectionTarget(null);
    }
  };

  const handleManagerChange = useCallback(async (itemId: string, userId: string) => {
    if (!selectedDirection?.id) return;
    setSavingManagerFor(itemId);
    try {
      const updated = await api.put<MaintenanceItem>(
        `/directions/${selectedDirection.id}/items/${itemId}/manager`,
        { userId: userId || null },
      );
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? { ...item, managerId: updated?.managerId ?? (userId || null), managerName: updated?.managerName ?? null }
            : item,
        ),
      );
      toast.success('Менеджер назначен.');
    } catch {
      toast.error('Не удалось назначить менеджера.');
    } finally {
      setSavingManagerFor(null);
    }
  }, [selectedDirection?.id, toast]);

  const onConfirmDeleteItem = async () => {
    if (!deleteItemTarget || !selectedDirection?.id) return;
    try {
      await api.del(`/directions/${selectedDirection.id}/items/${deleteItemTarget.id}`);
      await loadItems(selectedDirection.id);
      toast.success('Объект обслуживания удалён.');
    } catch {
      toast.error('Не удалось удалить объект обслуживания.');
    } finally {
      setDeleteItemTarget(null);
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={
          selectedDirection
            ? [
                { label: 'Панель', to: '/' },
                { label: 'Направления', to: '/directions' },
                { label: selectedDirection.name || 'Направление' },
              ]
            : [{ label: 'Панель', to: '/' }, { label: 'Направления' }]
        }
      />

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {!selectedDirection ? (
        <>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Направления</h2>
              <p className="text-slate-500 dark:text-slate-400">Объекты и системы безопасности по направлениям.</p>
            </div>

            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              {canManage ? (
                <button
                  type="button"
                  onClick={() => void downloadDirectionsCsv()}
                  disabled={exportingDirections}
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Download size={16} />
                  {exportingDirections ? 'Скачиваю...' : 'Скачать Excel'}
                </button>
              ) : null}
              <div className="relative w-full sm:w-80">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                  size={18}
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="Поиск по направлению..."
                />
              </div>
              {isAdminOrManager ? (
                <button
                  type="button"
                  onClick={() => setIsDirectionModalOpen(true)}
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
                >
                  <Plus size={16} />
                  Направление
                </button>
              ) : null}
            </div>
          </div>

          {loadingDirections ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-40 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredDirections.map((direction) => (
                <div
                  key={direction.id}
                  className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDirection(direction);
                      setSearchTerm('');
                    }}
                    className="block w-full text-left"
                  >
                    <div className="mb-2 flex items-center gap-2 text-slate-900 dark:text-slate-100">
                      <Compass size={18} className="text-brand-red" />
                      <h3 className="text-lg font-bold">{direction.name}</h3>
                    </div>
                    <p className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <MapPin size={15} className="mt-0.5 shrink-0 text-slate-400 dark:text-slate-500" />
                      <span>{direction.address || 'Адрес не указан'}</span>
                    </p>
                  </button>

                  <div className="mt-4 flex justify-end">
                    {isAdminOrManager ? (
                      <button
                        type="button"
                        onClick={() => setDeleteDirectionTarget(direction)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300 min-h-[44px]"
                      >
                        <Trash2 size={14} />
                        Удалить
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
              {filteredDirections.length === 0 ? (
                <div className="col-span-full flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-12 text-center dark:border-slate-800 dark:bg-slate-900">
                  <Compass size={32} className="text-slate-300 dark:text-slate-600" />
                  <p className="text-sm text-slate-500 dark:text-slate-400">Направления не найдены</p>
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => {
                setSelectedDirection(null);
                setSearchTerm('');
              }}
              className="inline-flex items-center gap-2 text-sm font-medium text-brand-red transition hover:text-red-700"
            >
              <ArrowLeft size={16} />
              К списку направлений
            </button>

            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <div className="relative w-full sm:w-80">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                  size={18}
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="Поиск в таблице..."
                />
              </div>

              {isAdminOrManager ? (
                <>
                  <input
                    ref={itemsImportXlsxRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => void handleImportItemsXlsx(e)}
                  />
                  <button
                    type="button"
                    onClick={() => itemsImportXlsxRef.current?.click()}
                    disabled={importingItemsXlsx}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-green-300 bg-white px-3 py-2 text-sm font-semibold text-green-700 transition hover:bg-green-50 disabled:opacity-60 dark:border-green-700 dark:bg-slate-800 dark:text-green-400 dark:hover:bg-green-900/20 sm:px-4"
                  >
                    <Upload size={16} />
                    <span className="hidden sm:inline">{importingItemsXlsx ? 'Загрузка...' : 'Загрузить Excel'}</span>
                    <span className="sm:hidden">{importingItemsXlsx ? '...' : 'Импорт'}</span>
                  </button>
                </>
              ) : null}

              {canManage ? (
                <button
                  type="button"
                  onClick={() => void downloadItemsXlsx()}
                  disabled={exportingItems}
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 sm:px-4"
                >
                  <Download size={16} />
                  <span className="hidden sm:inline">{exportingItems ? 'Выгрузка...' : 'Скачать Excel'}</span>
                  <span className="sm:hidden">{exportingItems ? '...' : 'Excel'}</span>
                </button>
              ) : null}

              {isAdminOrManager ? (
                <button
                  type="button"
                  onClick={openCreateItemModal}
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand-red px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-700 sm:px-4"
                >
                  <Plus size={16} />
                  <span className="hidden sm:inline">Объект</span>
                </button>
              ) : null}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 bg-slate-900 p-3 sm:p-5 text-white dark:border-slate-800">
              <h3 className="text-xl font-bold">{selectedDirection.name}</h3>
              <p className="mt-1 text-sm text-slate-300">{selectedDirection.address}</p>
            </div>

            <div className="overflow-x-auto p-2 sm:p-4">
              {loadingItems ? (
                <table className="min-w-[1500px] border-collapse text-left">
                  <tbody>
                    <SkeletonTable rows={5} cols={7 + SYSTEM_ORDER.length} />
                  </tbody>
                </table>
              ) : (
                <table className="min-w-[1500px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800">
                      <th className="px-3 py-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">№</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Объект</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Адрес</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Юр. лицо</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Договор</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Арендатор</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Менеджер</th>
                      {SYSTEM_ORDER.map((systemType) => (
                        <th key={systemType} className="px-3 py-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                          {SYSTEM_LABELS[systemType]}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Действие</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredItems.map((item) => (
                      <tr key={item.id} className={item.managerId ? 'hover:bg-slate-50 dark:hover:bg-slate-800' : 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:hover:bg-amber-900/30'}>
                        <td className="px-3 py-3 text-sm text-slate-700 dark:text-slate-300">{item.positionNumber || '-'}</td>
                        <td className="px-3 py-3 text-sm font-medium text-slate-900 dark:text-slate-100">{item.name}</td>
                        <td className="px-3 py-3 text-sm text-slate-700 dark:text-slate-300">{item.address || '-'}</td>
                        <td className="px-3 py-3 text-sm text-slate-700 dark:text-slate-300">{item.legalEntity || '-'}</td>
                        <td className="px-3 py-3 text-sm text-slate-700 dark:text-slate-300">{item.contractNumber || '-'}</td>
                        <td className="px-3 py-3 text-sm">
                          {item.tenantId ? (
                            <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">Привязан</span>
                          ) : (
                            <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Не привязан</span>
                          )}
                        </td>

                        <td className="px-3 py-3 text-sm">
                          {isAdminOrManager ? (
                            <select
                              value={item.managerId ?? ''}
                              disabled={savingManagerFor === item.id}
                              onChange={(e) => void handleManagerChange(item.id, e.target.value)}
                              className={`w-full min-w-[160px] rounded-md border px-2 py-1.5 text-xs outline-none transition focus:border-brand-red focus:ring-1 focus:ring-brand-red disabled:opacity-50 ${
                                item.managerId
                                  ? 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                                  : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300'
                              }`}
                            >
                              <option value="">— не назначен —</option>
                              {managers.map((m) => (
                                <option key={m.id} value={m.id}>{m.fullName}</option>
                              ))}
                            </select>
                          ) : (
                            item.managerId ? (
                              <span className="inline-flex items-center gap-1 text-xs text-slate-700 dark:text-slate-300">
                                <UserCheck size={13} className="text-green-600" />
                                {item.managerName || 'Назначен'}
                              </span>
                            ) : (
                              <span className="text-xs text-amber-600 dark:text-amber-400">Не назначен</span>
                            )
                          )}
                        </td>

                        {SYSTEM_ORDER.map((systemType) => (
                          <td key={systemType} className="px-3 py-3 text-center">
                            {item.systems?.[systemType] ? (
                              <Check size={15} className="mx-auto text-green-600" />
                            ) : (
                              <span className="text-slate-300 dark:text-slate-600">-</span>
                            )}
                          </td>
                        ))}

                        <td className="px-3 py-3">
                          {isAdminOrManager ? (
                            <button
                              type="button"
                              onClick={() => setDeleteItemTarget(item)}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300 min-h-[44px]"
                            >
                              <Trash2 size={14} />
                              Удалить
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {filteredItems.length === 0 ? (
                      <tr>
                        <td colSpan={7 + SYSTEM_ORDER.length} className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                          Нет записей
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      <Modal isOpen={isDirectionModalOpen} onClose={() => setIsDirectionModalOpen(false)} title="Новое направление">
        <form onSubmit={createDirection} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Название</label>
            <input
              required
              value={directionForm.name}
              onChange={(event) => setDirectionForm((prev) => ({ ...prev, name: event.target.value }))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              placeholder="Северное направление"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Адрес</label>
            <input
              required
              value={directionForm.address}
              onChange={(event) => setDirectionForm((prev) => ({ ...prev, address: event.target.value }))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              placeholder="г. Москва, ул. Пример, 1"
            />
          </div>
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-red px-4 py-2.5 font-semibold text-white transition hover:bg-red-700"
          >
            Создать
          </button>
        </form>
      </Modal>

      <Modal isOpen={isItemModalOpen} onClose={() => setIsItemModalOpen(false)} title="Добавить объект обслуживания">
        <form onSubmit={createItem} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-1">
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">№</label>
              <input
                required
                value={itemForm.positionNumber}
                onChange={(event) => setItemForm((prev) => ({ ...prev, positionNumber: event.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Название объекта</label>
              <input
                required
                value={itemForm.name}
                onChange={(event) => setItemForm((prev) => ({ ...prev, name: event.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Адрес</label>
            <input
              value={itemForm.address}
              onChange={(event) => setItemForm((prev) => ({ ...prev, address: event.target.value }))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Юридическое лицо</label>
              <input
                value={itemForm.legalEntity}
                onChange={(event) => {
                  const val = event.target.value;
                  const matched = tenants.find((t) =>
                    t.type !== 'contractor' && (
                      t.name.toLowerCase() === val.trim().toLowerCase() ||
                      (t.inn && t.inn === val.trim())
                    )
                  );
                  setItemForm((prev) => ({ ...prev, legalEntity: val, tenantId: matched ? matched.id : prev.tenantId }));
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">№ договора</label>
              <input
                value={itemForm.contractNumber}
                onChange={(event) => setItemForm((prev) => ({ ...prev, contractNumber: event.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Арендатор</label>
            <select
              value={itemForm.tenantId}
              onChange={(event) => setItemForm((prev) => ({ ...prev, tenantId: event.target.value }))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">— не выбран —</option>
              {tenants.filter((t) => t.type !== 'contractor').map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.inn ? ` (${t.inn})` : ''}</option>
              ))}
            </select>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Системы</p>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800 sm:grid-cols-3">
              {SYSTEM_ORDER.map((systemType) => (
                <label key={systemType} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={Boolean(itemForm.systems[systemType])}
                    onChange={(event) =>
                      setItemForm((prev) => ({
                        ...prev,
                        systems: {
                          ...prev.systems,
                          [systemType]: event.target.checked,
                        },
                      }))
                    }
                    className="rounded border-slate-300 text-brand-red focus:ring-brand-red"
                  />
                  {SYSTEM_LABELS[systemType]}
                </label>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-red px-4 py-2.5 font-semibold text-white transition hover:bg-red-700"
          >
            Добавить объект
          </button>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(deleteDirectionTarget)}
        onCancel={() => setDeleteDirectionTarget(null)}
        onConfirm={() => void onConfirmDeleteDirection()}
        title="Удалить направление?"
        message={`Это действие нельзя отменить.${deleteDirectionTarget?.name ? `\n\n${deleteDirectionTarget.name}` : ''}`}
        confirmLabel="Удалить"
      />

      <ConfirmDialog
        isOpen={Boolean(deleteItemTarget)}
        onCancel={() => setDeleteItemTarget(null)}
        onConfirm={() => void onConfirmDeleteItem()}
        title="Удалить объект обслуживания?"
        message={`Это действие нельзя отменить.${deleteItemTarget?.name ? `\n\n${deleteItemTarget.name}` : ''}`}
        confirmLabel="Удалить"
      />
    </div>
  );
}


