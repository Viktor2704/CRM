import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Flame,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Trash2,
  X,
} from 'lucide-react';
import { api, buildApiUrl } from '@/api/client';
import type { Direction } from '@/types';

type Extinguisher = {
  id: string;
  directionId: string;
  maintenanceItemId: string | null;
  serialNumber: string;
  type: string;
  brand: string;
  chargeMassKg: number | null;
  manufactureDate: string | null;
  commissioningDate: string | null;
  locationFloor: string;
  locationRoom: string;
  locationDescription: string;
  lastRechargeDate: string | null;
  nextRechargeDate: string | null;
  lastInspectionDate: string | null;
  nextInspectionDate: string | null;
  status: string;
  qrCodeToken: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type ExtFormState = {
  directionId: string;
  serialNumber: string;
  type: string;
  brand: string;
  chargeMassKg: string;
  manufactureDate: string;
  commissioningDate: string;
  locationFloor: string;
  locationRoom: string;
  locationDescription: string;
  lastRechargeDate: string;
  lastInspectionDate: string;
  nextInspectionDate: string;
  status: string;
};

const EXT_TYPE_LABELS: Record<string, string> = {
  op: 'ОП (порошковый)',
  ou: 'ОУ (углекислотный)',
  ov: 'ОВ (водный)',
  ove: 'ОВЭ (водно-эмульсионный)',
};

const EXT_TYPE_SHORT: Record<string, string> = {
  op: 'ОП',
  ou: 'ОУ',
  ov: 'ОВ',
  ove: 'ОВЭ',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Активен',
  recharged: 'Перезаряжен',
  decommissioned: 'Списан',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  recharged: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  decommissioned: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

const formatDate = (value: string | null) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('ru-RU');
};

const getRechargeStatusClass = (nextRechargeDate: string | null): string => {
  if (!nextRechargeDate) return '';
  const next = new Date(nextRechargeDate);
  const now = new Date();
  const diffDays = (next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return 'bg-red-50 dark:bg-red-950/30';
  if (diffDays < 60) return 'bg-amber-50 dark:bg-amber-950/30';
  return '';
};

const getRechargeTextClass = (nextRechargeDate: string | null): string => {
  if (!nextRechargeDate) return 'text-slate-500';
  const next = new Date(nextRechargeDate);
  const now = new Date();
  const diffDays = (next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return 'text-red-600 font-semibold dark:text-red-400';
  if (diffDays < 60) return 'text-amber-600 font-semibold dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
};

const INITIAL_FORM: ExtFormState = {
  directionId: '',
  serialNumber: '',
  type: 'op',
  brand: '',
  chargeMassKg: '',
  manufactureDate: '',
  commissioningDate: '',
  locationFloor: '',
  locationRoom: '',
  locationDescription: '',
  lastRechargeDate: '',
  lastInspectionDate: '',
  nextInspectionDate: '',
  status: 'active',
};

type Props = {
  directions: Direction[];
  referenceLoading: boolean;
};

export default function SppzExtinguishersTab({ directions, referenceLoading }: Props) {
  const [extinguishers, setExtinguishers] = useState<Extinguisher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterDirectionId, setFilterDirectionId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ExtFormState>(INITIAL_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [qrModalId, setQrModalId] = useState<string | null>(null);

  const loadExtinguishers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = filterDirectionId ? `?directionId=${filterDirectionId}` : '';
      const data = await api.getT<Extinguisher[]>(`/sppz-journal/extinguishers${params}`);
      setExtinguishers(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message || 'Ошибка загрузки');
      setExtinguishers([]);
    } finally {
      setLoading(false);
    }
  }, [filterDirectionId]);

  useEffect(() => {
    void loadExtinguishers();
  }, [loadExtinguishers]);

  useEffect(() => {
    if (directions.length > 0 && !form.directionId) {
      setForm((prev) => ({ ...prev, directionId: directions[0].id }));
    }
  }, [directions, form.directionId]);

  const updateForm = <K extends keyof ExtFormState>(key: K, value: ExtFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetForm = () => {
    setForm({
      ...INITIAL_FORM,
      directionId: filterDirectionId || (directions[0]?.id ?? ''),
    });
    setEditingId(null);
    setFormError('');
  };

  const openCreateForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (ext: Extinguisher) => {
    setForm({
      directionId: ext.directionId,
      serialNumber: ext.serialNumber,
      type: ext.type,
      brand: ext.brand,
      chargeMassKg: ext.chargeMassKg != null ? String(ext.chargeMassKg) : '',
      manufactureDate: ext.manufactureDate?.slice(0, 10) ?? '',
      commissioningDate: ext.commissioningDate?.slice(0, 10) ?? '',
      locationFloor: ext.locationFloor,
      locationRoom: ext.locationRoom,
      locationDescription: ext.locationDescription,
      lastRechargeDate: ext.lastRechargeDate?.slice(0, 10) ?? '',
      lastInspectionDate: ext.lastInspectionDate?.slice(0, 10) ?? '',
      nextInspectionDate: ext.nextInspectionDate?.slice(0, 10) ?? '',
      status: ext.status,
    });
    setEditingId(ext.id);
    setFormError('');
    setShowForm(true);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.serialNumber.trim()) {
      setFormError('Серийный номер обязателен');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        directionId: form.directionId,
        serialNumber: form.serialNumber.trim(),
        type: form.type,
        brand: form.brand.trim() || undefined,
        chargeMassKg: form.chargeMassKg ? Number(form.chargeMassKg) : undefined,
        manufactureDate: form.manufactureDate || undefined,
        commissioningDate: form.commissioningDate || undefined,
        locationFloor: form.locationFloor.trim() || undefined,
        locationRoom: form.locationRoom.trim() || undefined,
        locationDescription: form.locationDescription.trim() || undefined,
        lastRechargeDate: form.lastRechargeDate || undefined,
        lastInspectionDate: form.lastInspectionDate || undefined,
        nextInspectionDate: form.nextInspectionDate || undefined,
        status: form.status,
      };

      if (editingId) {
        await api.patchT(`/sppz-journal/extinguishers/${editingId}`, payload);
      } else {
        await api.postT('/sppz-journal/extinguishers', payload);
      }

      setShowForm(false);
      resetForm();
      await loadExtinguishers();
    } catch (e: any) {
      setFormError(e.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить огнетушитель? Действие не может быть отменено.')) return;
    try {
      await api.deleteT(`/sppz-journal/extinguishers/${id}`);
      await loadExtinguishers();
    } catch (e: any) {
      alert(e.message || 'Ошибка удаления');
    }
  };

  const printQr = (id: string) => {
    const qrUrl = buildApiUrl(`/sppz-journal/extinguishers/${id}/qr`);
    const ext = extinguishers.find((e) => e.id === id);
    const w = window.open('', '_blank', 'width=400,height=500');
    if (!w) return;
    w.document.write(`
      <html>
      <head><title>QR - ${ext?.serialNumber || id}</title></head>
      <body style="text-align:center;font-family:sans-serif;padding:20px">
        <h2>Огнетушитель ${ext?.serialNumber || ''}</h2>
        <p>${EXT_TYPE_LABELS[ext?.type || ''] || ext?.type || ''}</p>
        <img src="${qrUrl}" width="280" height="280" onload="window.print()" />
        <p style="font-size:12px;color:#666;margin-top:12px">${ext?.locationFloor ? 'Этаж: ' + ext.locationFloor : ''} ${ext?.locationRoom ? 'Пом: ' + ext.locationRoom : ''}</p>
      </body>
      </html>
    `);
    w.document.close();
  };

  const directionNameMap = new Map(directions.map((d) => [d.id, d.name]));

  return (
    <div className="space-y-4">
      {/* Filter bar + Add button */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs text-slate-500 dark:text-slate-400">Направление:</span>
          <select
            value={filterDirectionId}
            onChange={(e) => setFilterDirectionId(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
          >
            <option value="">Все</option>
            {directions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <div className="flex-1" />
        <button
          type="button"
          onClick={openCreateForm}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
        >
          <Plus size={16} />
          Добавить огнетушитель
        </button>
      </div>

      {/* Error */}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {/* Loading */}
      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          Загрузка огнетушителей...
        </div>
      ) : null}

      {/* Table */}
      {!loading && extinguishers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <Flame size={32} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
          Огнетушители не найдены. Добавьте первый с помощью кнопки выше.
        </div>
      ) : null}

      {!loading && extinguishers.length > 0 ? (
        <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                <th className="px-4 py-3">Серийный номер</th>
                <th className="px-4 py-3">Тип</th>
                <th className="px-4 py-3">Направление</th>
                <th className="px-4 py-3">Размещение</th>
                <th className="px-4 py-3">Посл. перезарядка</th>
                <th className="px-4 py-3">След. перезарядка</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {extinguishers.map((ext) => (
                <tr
                  key={ext.id}
                  className={`border-b border-slate-100 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40 ${getRechargeStatusClass(ext.nextRechargeDate)}`}
                >
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                    {ext.serialNumber}
                    {ext.brand ? <span className="ml-1 text-xs text-slate-400">({ext.brand})</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-medium dark:bg-slate-800">
                      {EXT_TYPE_SHORT[ext.type] || ext.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                    {directionNameMap.get(ext.directionId) || ext.directionId.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                    {[ext.locationFloor && `Эт. ${ext.locationFloor}`, ext.locationRoom && `Пом. ${ext.locationRoom}`]
                      .filter(Boolean)
                      .join(', ') || '-'}
                  </td>
                  <td className="px-4 py-3 text-xs">{formatDate(ext.lastRechargeDate)}</td>
                  <td className={`px-4 py-3 text-xs ${getRechargeTextClass(ext.nextRechargeDate)}`}>
                    {formatDate(ext.nextRechargeDate)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[ext.status] || ''}`}>
                      {STATUS_LABELS[ext.status] || ext.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setQrModalId(ext.id)}
                        title="QR-код"
                        className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <QrCode size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => printQr(ext.id)}
                        title="Печать QR"
                        className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Printer size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditForm(ext)}
                        title="Редактировать"
                        className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(ext.id)}
                        title="Удалить"
                        className="rounded-lg p-1.5 text-red-400 transition hover:bg-red-50 dark:hover:bg-red-950/40"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* QR Modal */}
      {qrModalId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">QR-код огнетушителя</h3>
              <button
                type="button"
                onClick={() => setQrModalId(null)}
                className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-4 flex flex-col items-center gap-4">
              <img
                src={buildApiUrl(`/sppz-journal/extinguishers/${qrModalId}/qr`)}
                alt="QR code"
                className="h-64 w-64 rounded-lg border border-slate-200 dark:border-slate-700"
              />
              <p className="text-xs text-slate-500">
                {extinguishers.find((e) => e.id === qrModalId)?.serialNumber || ''}
              </p>
              <button
                type="button"
                onClick={() => printQr(qrModalId)}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
              >
                <Printer size={16} />
                Печать QR
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Create/Edit Form Modal */}
      {showForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                {editingId ? 'Редактирование огнетушителя' : 'Новый огнетушитель'}
              </h3>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm(); }}
                className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Направление *</span>
                  <select
                    value={form.directionId}
                    onChange={(e) => updateForm('directionId', e.target.value)}
                    required
                    disabled={referenceLoading}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  >
                    {directions.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Серийный номер *</span>
                  <input
                    value={form.serialNumber}
                    onChange={(e) => updateForm('serialNumber', e.target.value)}
                    required
                    placeholder="ОП-5 №12345"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Тип *</span>
                  <select
                    value={form.type}
                    onChange={(e) => updateForm('type', e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  >
                    {Object.entries(EXT_TYPE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Марка</span>
                  <input
                    value={form.brand}
                    onChange={(e) => updateForm('brand', e.target.value)}
                    placeholder="Ярпожинвест"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Масса заряда (кг)</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.chargeMassKg}
                    onChange={(e) => updateForm('chargeMassKg', e.target.value)}
                    placeholder="5.00"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Статус</span>
                  <select
                    value={form.status}
                    onChange={(e) => updateForm('status', e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  >
                    {Object.entries(STATUS_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Этаж</span>
                  <input
                    value={form.locationFloor}
                    onChange={(e) => updateForm('locationFloor', e.target.value)}
                    placeholder="1"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Помещение</span>
                  <input
                    value={form.locationRoom}
                    onChange={(e) => updateForm('locationRoom', e.target.value)}
                    placeholder="101"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Описание размещения</span>
                  <input
                    value={form.locationDescription}
                    onChange={(e) => updateForm('locationDescription', e.target.value)}
                    placeholder="У входа"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Дата изготовления</span>
                  <input
                    type="date"
                    value={form.manufactureDate}
                    onChange={(e) => updateForm('manufactureDate', e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Дата ввода в эксплуатацию</span>
                  <input
                    type="date"
                    value={form.commissioningDate}
                    onChange={(e) => updateForm('commissioningDate', e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Последняя перезарядка</span>
                  <input
                    type="date"
                    value={form.lastRechargeDate}
                    onChange={(e) => updateForm('lastRechargeDate', e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                  <p className="font-medium">Следующая перезарядка</p>
                  <p className="mt-1">Рассчитывается автоматически:</p>
                  <p className="mt-0.5">ОП/ОУ: +5 лет, ОВ/ОВЭ: +1 год</p>
                  <p className="mt-0.5">от даты перезарядки или ввода в эксплуатацию</p>
                </div>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Последняя проверка</span>
                  <input
                    type="date"
                    value={form.lastInspectionDate}
                    onChange={(e) => updateForm('lastInspectionDate', e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Следующая проверка</span>
                  <input
                    type="date"
                    value={form.nextInspectionDate}
                    onChange={(e) => updateForm('nextInspectionDate', e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>
              </div>

              {formError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                  {formError}
                </div>
              ) : null}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-lg bg-brand-red px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Сохраняем...' : editingId ? 'Сохранить изменения' : 'Создать огнетушитель'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); resetForm(); }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
