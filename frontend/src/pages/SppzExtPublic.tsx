import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const EXT_TYPE_LABELS: Record<string, string> = {
  op: 'ОП (порошковый)',
  ou: 'ОУ (углекислотный)',
  ov: 'ОВ (водный)',
  ove: 'ОВЭ (водно-эмульсионный)',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Активен',
  recharged: 'Перезаряжен',
  decommissioned: 'Списан',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  recharged: 'bg-blue-100 text-blue-800',
  decommissioned: 'bg-slate-200 text-slate-600',
};

type Extinguisher = {
  id: string;
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
  directionName: string;
};

type HistoryEntry = {
  id: string;
  eventDateTime: string;
  description: string;
  executorName: string;
  status: string;
};

const formatDate = (value: string | null) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('ru-RU');
};

const getRechargeColor = (nextRechargeDate: string | null) => {
  if (!nextRechargeDate) return '';
  const next = new Date(nextRechargeDate);
  const now = new Date();
  const diffDays = (next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return 'text-red-600 font-semibold';
  if (diffDays < 60) return 'text-amber-600 font-semibold';
  return 'text-emerald-600';
};

export default function SppzExtPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [ext, setExt] = useState<Extinguisher | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/sppz-journal/ext/${encodeURIComponent(token)}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: 'Not found' }));
          throw new Error(err.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled) {
          setExt(data.extinguisher);
          setHistory(data.history || []);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-500">Загрузка...</p>
      </div>
    );
  }

  if (error || !ext) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="rounded-xl border border-red-200 bg-white p-8 text-center shadow">
          <h1 className="text-xl font-semibold text-red-700">Огнетушитель не найден</h1>
          <p className="mt-2 text-sm text-slate-500">{error || 'QR-код недействителен или устройство было удалено.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                Огнетушитель {ext.serialNumber}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {EXT_TYPE_LABELS[ext.type] || ext.type}
                {ext.brand ? ` / ${ext.brand}` : ''}
                {ext.chargeMassKg ? ` / ${ext.chargeMassKg} кг` : ''}
              </p>
            </div>
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${STATUS_COLORS[ext.status] || 'bg-slate-100 text-slate-600'}`}>
              {STATUS_LABELS[ext.status] || ext.status}
            </span>
          </div>

          {ext.directionName ? (
            <p className="mt-3 text-sm text-slate-600">
              Объект: <span className="font-medium">{ext.directionName}</span>
            </p>
          ) : null}

          <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Размещение</p>
              <p className="mt-1 text-slate-700">
                {[ext.locationFloor && `Этаж: ${ext.locationFloor}`, ext.locationRoom && `Помещение: ${ext.locationRoom}`]
                  .filter(Boolean)
                  .join(', ') || '-'}
              </p>
              {ext.locationDescription ? <p className="text-xs text-slate-500">{ext.locationDescription}</p> : null}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Дата изготовления</p>
              <p className="mt-1 text-slate-700">{formatDate(ext.manufactureDate)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Дата ввода в эксплуатацию</p>
              <p className="mt-1 text-slate-700">{formatDate(ext.commissioningDate)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Последняя перезарядка</p>
              <p className="mt-1 text-slate-700">{formatDate(ext.lastRechargeDate)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Следующая перезарядка</p>
              <p className={`mt-1 ${getRechargeColor(ext.nextRechargeDate)}`}>
                {formatDate(ext.nextRechargeDate)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Последняя проверка</p>
              <p className="mt-1 text-slate-700">{formatDate(ext.lastInspectionDate)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Следующая проверка</p>
              <p className="mt-1 text-slate-700">{formatDate(ext.nextInspectionDate)}</p>
            </div>
          </div>
        </div>

        {history.length > 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800">История обслуживания</h2>
            <div className="mt-4 space-y-3">
              {history.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{formatDate(entry.eventDateTime)}</span>
                    <span className="text-xs text-slate-400">{entry.executorName}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{entry.description}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <p className="text-center text-xs text-slate-400">
          Карточка огнетушителя - Журнал СППЗ
        </p>
      </div>
    </div>
  );
}
