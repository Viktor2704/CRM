import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, FileSignature, Loader2, MailWarning, ShieldCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { buildApiUrl } from '@/api/client';

type SessionEntry = {
  id: string;
  objectName: string;
  eventDateTime: string;
  section?: string;
  sections?: string[];
  recordType: string;
  description: string;
  status: string;
};

type SigningSession = {
  contractor: {
    id?: string;
    key?: string;
    name: string;
    email: string;
  };
  expiresAt: string;
  pendingCount: number;
  entries: SessionEntry[];
};

const SECTION_LABELS: Record<string, string> = {
  aps: 'СПС',
  soue: 'СОУЭ',
  aupt: 'АУПТ',
  vpv: 'ВПВ',
  fire_extinguishers: 'Огнетушители',
  custom: 'Прочее',
};

const RECORD_TYPE_LABELS: Record<string, string> = {
  maintenance: 'ТО',
  repair: 'Ремонт',
  testing: 'Испытания',
  functional_control: 'Контроль функционирования',
  shutdown: 'Отключение',
  fault: 'Неисправность',
  false_trigger: 'Ложное срабатывание',
  trigger: 'Срабатывание',
  other: 'Прочее',
};

const parseSessionEntry = (raw: unknown): SessionEntry | null => {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const id = String(source.id || '').trim();
  if (!id) return null;

  const sections = Array.isArray(source.sections)
    ? source.sections.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  return {
    id,
    objectName: String(source.objectName || ''),
    eventDateTime: String(source.eventDateTime || ''),
    section: String(source.section || '').trim() || undefined,
    sections,
    recordType: String(source.recordType || 'other'),
    description: String(source.description || ''),
    status: String(source.status || ''),
  };
};

const parseSigningSession = (raw: unknown): SigningSession | null => {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;

  const contractorRaw = source.contractor && typeof source.contractor === 'object'
    ? (source.contractor as Record<string, unknown>)
    : {};

  const entriesRaw = Array.isArray(source.entries) ? source.entries : [];
  const entries = entriesRaw
    .map((entry) => parseSessionEntry(entry))
    .filter((entry): entry is SessionEntry => Boolean(entry));

  return {
    contractor: {
      id: contractorRaw.id ? String(contractorRaw.id) : undefined,
      key: contractorRaw.key ? String(contractorRaw.key) : undefined,
      name: String(contractorRaw.name || 'Контрагент'),
      email: String(contractorRaw.email || ''),
    },
    expiresAt: String(source.expiresAt || ''),
    pendingCount: Number(source.pendingCount || entries.length),
    entries,
  };
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString('ru-RU');
};

const getEntrySectionsLabel = (entry: SessionEntry) => {
  const sections = entry.sections && entry.sections.length > 0
    ? entry.sections
    : entry.section
      ? [entry.section]
      : [];
  if (sections.length === 0) return 'Прочее';
  return sections.map((section) => SECTION_LABELS[section] || section).join(', ');
};

export default function SppzCustomerSignPage() {
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState(searchParams.get('token') ?? '');
  const [session, setSession] = useState<SigningSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [signerFio, setSignerFio] = useState('');
  const [signerOrderNumber, setSignerOrderNumber] = useState('');
  const [signAllPending, setSignAllPending] = useState(true);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const selectedCount = selectedEntryIds.size;

  const selectableEntries = useMemo(() => session?.entries || [], [session]);

  const loadSession = async (nextToken: string) => {
    const normalizedToken = nextToken.trim();
    if (!normalizedToken) {
      setSession(null);
      setError('Введите токен из письма.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const response = await fetch(
        `${buildApiUrl('/sppz-journal/customer-sign/session')}?token=${encodeURIComponent(normalizedToken)}`,
        {
          method: 'GET',
          credentials: 'include',
        },
      );

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message =
          payload && typeof payload === 'object' && typeof (payload as { message?: unknown }).message === 'string'
            ? (payload as { message: string }).message
            : 'Не удалось загрузить записи для подписи.';
        throw new Error(message);
      }

      const parsed = parseSigningSession(payload);
      if (!parsed) {
        throw new Error('Некорректный ответ сервера по сессии подписи.');
      }

      setSession(parsed);
      setSelectedEntryIds(new Set(parsed.entries.map((entry) => entry.id)));
    } catch (err) {
      setSession(null);
      setSelectedEntryIds(new Set());
      setError(err instanceof Error ? err.message : 'Не удалось загрузить записи для подписи.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token.trim()) return;
    void loadSession(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleEntry = (entryId: string, checked: boolean) => {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(entryId);
      } else {
        next.delete(entryId);
      }
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    if (!session) return;
    if (!checked) {
      setSelectedEntryIds(new Set());
      return;
    }
    setSelectedEntryIds(new Set(session.entries.map((entry) => entry.id)));
  };

  const submitSignature = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSuccessMessage('');
    setError('');

    const normalizedToken = token.trim();
    if (!normalizedToken) {
      setError('Токен обязателен.');
      return;
    }
    if (!signerFio.trim() || !signerOrderNumber.trim()) {
      setError('Введите ФИО и номер приказа.');
      return;
    }
    if (!signAllPending && selectedEntryIds.size === 0) {
      setError('Выберите хотя бы одну запись для подписи.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(buildApiUrl('/sppz-journal/customer-sign/submit'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          token: normalizedToken,
          signerFio: signerFio.trim(),
          signerOrderNumber: signerOrderNumber.trim(),
          signAllPending,
          entryIds: signAllPending ? [] : Array.from(selectedEntryIds),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          payload && typeof payload === 'object' && typeof (payload as { message?: unknown }).message === 'string'
            ? (payload as { message: string }).message
            : 'Подписание завершилось ошибкой.';
        throw new Error(message);
      }

      const signedCount = Number(
        payload && typeof payload === 'object' ? (payload as { signedCount?: unknown }).signedCount || 0 : 0,
      );

      setSuccessMessage(
        signedCount > 0
          ? `Подписано записей: ${signedCount}.`
          : 'Нет доступных записей для подписи (возможно, уже подписаны ранее).',
      );

      await loadSession(normalizedToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Подписание завершилось ошибкой.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-brand-red">Новинжстрой</p>
              <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                Подпись записей журнала СППЗ
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Подписание доступно только по персональной ссылке контрагента.
              </p>
            </div>
            <Link
              to="/login"
              className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Войти в систему
            </Link>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Вставьте токен из письма"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
            />
            <button
              type="button"
              onClick={() => void loadSession(token)}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              Проверить токен
            </button>
          </div>

          {session ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-800/50">
              <p className="font-semibold">Контрагент: {session.contractor.name}</p>
              <p className="mt-1 text-slate-600 dark:text-slate-300">Email: {session.contractor.email || 'не указан'}</p>
              <p className="mt-1 text-slate-600 dark:text-slate-300">
                Записей к подписи: {session.pendingCount} • Ссылка действует до: {formatDateTime(session.expiresAt)}
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 inline-flex w-full items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
              <MailWarning size={16} />
              {error}
            </div>
          ) : null}

          {successMessage ? (
            <div className="mt-4 inline-flex w-full items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300">
              <CheckCircle2 size={16} />
              {successMessage}
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center gap-2">
            <FileSignature size={16} className="text-slate-500" />
            <h2 className="text-lg font-semibold">Подписание</h2>
          </div>

          <form onSubmit={(event) => void submitSignature(event)} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs text-slate-500 dark:text-slate-400">ФИО подписанта заказчика</span>
                <input
                  value={signerFio}
                  onChange={(event) => setSignerFio(event.target.value)}
                  required
                  placeholder="Иванов Иван Иванович"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-slate-500 dark:text-slate-400">Номер приказа</span>
                <input
                  value={signerOrderNumber}
                  onChange={(event) => setSignerOrderNumber(event.target.value)}
                  required
                  placeholder="Приказ № 15-ОД от 01.03.2026"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/50">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={signAllPending}
                  onChange={(event) => setSignAllPending(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-red focus:ring-brand-red dark:border-slate-600"
                />
                Подписать сразу все неподписанные записи
              </label>
              {!signAllPending ? <span>Выбрано: {selectedCount}</span> : null}
            </div>

            {!signAllPending ? (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <span>Выбор записей</span>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={session ? selectedCount === session.entries.length && session.entries.length > 0 : false}
                      onChange={(event) => toggleAllVisible(event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-red focus:ring-brand-red dark:border-slate-600"
                    />
                    Выбрать все
                  </label>
                </div>
                <div className="max-h-80 overflow-auto divide-y divide-slate-200 dark:divide-slate-700">
                  {selectableEntries.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-slate-500 dark:text-slate-400">Нет записей для подписи.</p>
                  ) : (
                    selectableEntries.map((entry) => (
                      <label key={entry.id} className="flex cursor-pointer items-start gap-3 px-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <input
                          type="checkbox"
                          checked={selectedEntryIds.has(entry.id)}
                          onChange={(event) => toggleEntry(entry.id, event.target.checked)}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-red focus:ring-brand-red dark:border-slate-600"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            {entry.objectName || 'Объект'} • {RECORD_TYPE_LABELS[entry.recordType] || entry.recordType}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {getEntrySectionsLabel(entry)} • {formatDateTime(entry.eventDateTime)}
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">{entry.description}</p>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300">
                Будут подписаны все записи со статусом "Подписано исполнителем" для вашего контрагента.
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || loading || !session}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              {signAllPending
                ? `Подписать все (${session?.pendingCount || 0})`
                : `Подписать выбранные (${selectedCount})`}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
