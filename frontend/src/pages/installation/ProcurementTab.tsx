import { useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, Package2, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import { api, buildApiUrl, getAccessToken, uploadFileT } from '@/api/client';
import type { User } from '@/types';
import type { useToast } from '@/context/ToastContext';

type ProcurementFile = {
  id?: string;
  name?: string;
  url?: string;
  type?: string;
  size?: string;
};

type ProcurementItem = {
  id: string;
  installationId?: string;
  name: string;
  quantity?: number;
  unit?: string;
  comment?: string;
  link?: string;
  status?: string;
  responsibleUserId?: string | null;
  files?: ProcurementFile[];
  createdAt?: string;
  updatedAt?: string;
};

type ProcurementForm = {
  name: string;
  quantity: number;
  unit: string;
  responsibleUserId: string;
  comment: string;
  link: string;
};

const STATUS_LABELS: Record<string, string> = {
  needed: 'Нужно',
  ordered: 'Заказано',
  received: 'Получено',
};

const STATUS_BADGES: Record<string, string> = {
  needed: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  ordered: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  received: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

const INITIAL_FORM: ProcurementForm = {
  name: '',
  quantity: 1,
  unit: 'шт',
  responsibleUserId: '',
  comment: '',
  link: '',
};

export default function ProcurementTab({ instId, items, canManage, users, userNameById, onReload, toast }: {
  instId: string;
  items: ProcurementItem[];
  canManage: boolean;
  users: User[];
  userNameById: Record<string, string>;
  onReload: () => Promise<void>;
  toast: ReturnType<typeof useToast>;
}) {
  const [form, setForm] = useState<ProcurementForm>(INITIAL_FORM);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [uploadingItemId, setUploadingItemId] = useState('');
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedUploadItemId, setSelectedUploadItemId] = useState('');

  const procurementItems = useMemo(
    () => (Array.isArray(items) ? [...items] : []).sort((left, right) => {
      const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
      const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
      return rightTime - leftTime;
    }),
    [items],
  );

  const resolveUserLabel = (userId?: string | null) => {
    if (!userId) return 'Не назначен';
    return userNameById[userId] || 'Сотрудник';
  };

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error('Укажите название позиции');
      return;
    }
    setCreating(true);
    try {
      await api.postT(`/installations/${instId}/procurement`, {
        name: form.name.trim(),
        quantity: Number(form.quantity) || 1,
        unit: form.unit.trim() || 'шт',
        responsibleUserId: form.responsibleUserId || null,
        comment: form.comment.trim(),
        link: form.link.trim(),
        files: [],
      });
      setForm(INITIAL_FORM);
      toast.success('Позиция закупки добавлена');
      await onReload();
    } catch (err: any) {
      const msg = err?.message || err?.data?.message || '';
      toast.error(`Не удалось добавить позицию закупки${msg ? ': ' + msg : ''}`);
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (itemId: string, status: string) => {
    setUpdatingId(itemId);
    try {
      await api.patchT(`/installations/${instId}/procurement/${itemId}`, { status });
      await onReload();
    } catch {
      toast.error('Не удалось обновить статус закупки');
    } finally {
      setUpdatingId('');
    }
  };

  const handleDelete = async (itemId: string) => {
    setDeletingId(itemId);
    try {
      const token = getAccessToken() ?? '';
      const response = await fetch(buildApiUrl(`/installations/${instId}/procurement/${itemId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('delete failed');
      toast.success('Позиция удалена');
      await onReload();
    } catch {
      toast.error('Не удалось удалить позицию закупки');
    } finally {
      setDeletingId('');
    }
  };

  const openUploadDialog = (itemId: string) => {
    setSelectedUploadItemId(itemId);
    uploadInputRef.current?.click();
  };

  const handleUploadFiles = async (item: ProcurementItem, fileList: FileList | null) => {
    const filesToUpload = Array.from(fileList || []);
    if (filesToUpload.length === 0) return;
    setUploadingItemId(item.id);
    try {
      const uploaded: ProcurementFile[] = [];
      for (const file of filesToUpload) {
        const result = await uploadFileT<{ id: string; name: string; url: string; mimeType?: string; sizeBytes?: number }>('/files/upload', file);
        uploaded.push({
          id: result.id,
          name: result.name,
          url: result.url,
          type: result.mimeType,
          size: result.sizeBytes ? String(result.sizeBytes) : undefined,
        });
      }
      await api.patchT(`/installations/${instId}/procurement/${item.id}`, {
        files: [...(Array.isArray(item.files) ? item.files : []), ...uploaded],
      });
      toast.success(`Файлов загружено: ${uploaded.length}`);
      await onReload();
    } catch {
      toast.error('Не удалось загрузить файлы закупки');
    } finally {
      setUploadingItemId('');
      setSelectedUploadItemId('');
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  const handleDeleteFile = async (item: ProcurementItem, fileId?: string) => {
    if (!fileId) return;
    setUpdatingId(item.id);
    try {
      await api.patchT(`/installations/${instId}/procurement/${item.id}`, {
        files: (Array.isArray(item.files) ? item.files : []).filter((file) => file.id !== fileId),
      });
      toast.success('Файл закупки удалён');
      await onReload();
    } catch {
      toast.error('Не удалось удалить файл закупки');
    } finally {
      setUpdatingId('');
    }
  };

  return (
    <div className="space-y-4">
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const targetItem = procurementItems.find((item) => item.id === selectedUploadItemId);
          if (targetItem) {
            void handleUploadFiles(targetItem, event.target.files);
          }
          else if (uploadInputRef.current) {
            uploadInputRef.current.value = '';
          }
        }}
      />
      {canManage ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2">
            <Plus size={16} className="text-purple-500" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Новая позиция закупки</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Название</label>
              <input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Количество</label>
              <input
                type="number"
                min={1}
                value={form.quantity}
                onChange={(e) => setForm((prev) => ({ ...prev, quantity: Math.max(1, Number(e.target.value) || 1) }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Ед. изм.</label>
              <input
                value={form.unit}
                onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Ответственный</label>
              <select
                value={form.responsibleUserId}
                onChange={(e) => setForm((prev) => ({ ...prev, responsibleUserId: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="">Не назначен</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName || user.email || user.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Ссылка</label>
              <input
                value={form.link}
                onChange={(e) => setForm((prev) => ({ ...prev, link: e.target.value }))}
                placeholder="https://..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Комментарий</label>
              <textarea
                rows={3}
                value={form.comment}
                onChange={(e) => setForm((prev) => ({ ...prev, comment: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              disabled={creating || !form.name.trim()}
              onClick={() => void handleCreate()}
              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60"
            >
              <Plus size={14} />
              {creating ? 'Добавление...' : 'Добавить позицию'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Package2 size={16} className="text-purple-500" />
            Позиции закупки
          </h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            {procurementItems.length}
          </span>
        </div>

        {procurementItems.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Package2 size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-500 dark:text-slate-400">Позиции закупки еще не добавлены</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {procurementItems.map((item) => (
              <div key={item.id} className="px-5 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.name}</h4>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGES[item.status || 'needed'] || STATUS_BADGES.needed}`}>
                        {STATUS_LABELS[item.status || 'needed'] || item.status || 'Нужно'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <span>Количество: {item.quantity || 1} {item.unit || 'шт'}</span>
                      <span>Ответственный: {resolveUserLabel(item.responsibleUserId)}</span>
                      {item.updatedAt ? <span>Обновлено: {new Date(item.updatedAt).toLocaleString('ru-RU')}</span> : null}
                    </div>
                    {item.comment ? (
                      <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{item.comment}</p>
                    ) : null}
                    {item.link ? (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 transition hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        <ExternalLink size={12} />
                        Ссылка на поставку
                      </a>
                    ) : null}
                    {Array.isArray(item.files) && item.files.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.files.map((file, index) => (
                          <span
                            key={file.id || `${item.id}-file-${index}`}
                            className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          >
                            <Paperclip size={12} />
                            <span>{file.name || 'Файл'}</span>
                            {file.url ? (
                              <a
                                href={file.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded p-0.5 transition hover:text-blue-600 dark:hover:text-blue-300"
                              >
                                <Download size={12} />
                              </a>
                            ) : null}
                            {canManage && file.id ? (
                              <button
                                type="button"
                                disabled={updatingId === item.id}
                                onClick={() => void handleDeleteFile(item, file.id)}
                                className="rounded p-0.5 transition hover:text-red-500 disabled:opacity-60"
                              >
                                <Trash2 size={12} />
                              </button>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    {canManage ? (
                      <>
                        <button
                          type="button"
                          disabled={uploadingItemId === item.id}
                          onClick={() => openUploadDialog(item.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          <Upload size={12} />
                          {uploadingItemId === item.id ? 'Загрузка...' : 'Файл'}
                        </button>
                        {(['needed', 'ordered', 'received'] as const).map((status) => (
                          <button
                            key={status}
                            type="button"
                            disabled={updatingId === item.id || item.status === status}
                            onClick={() => void handleStatusChange(item.id, status)}
                            className={[
                              'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                              item.status === status
                                ? STATUS_BADGES[status]
                                : 'border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                            ].join(' ')}
                          >
                            {STATUS_LABELS[status]}
                          </button>
                        ))}
                        <button
                          type="button"
                          disabled={deletingId === item.id}
                          onClick={() => void handleDelete(item.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-60 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-950/20"
                        >
                          <Trash2 size={12} />
                          Удалить
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
