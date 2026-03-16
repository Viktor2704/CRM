import { useRef, useState } from 'react';
import { FileText, Upload, Trash2, Download } from 'lucide-react';
import { api, buildApiUrl, getAccessToken, uploadFileT } from '@/api/client';
import type { useToast } from '@/context/ToastContext';

type FileItem = { id: string; name: string; url?: string; createdAt?: string; userId?: string };

export default function FilesTab({ instId, files, canManage, userNameById, onReload, toast }: {
  instId: string; files: FileItem[]; canManage: boolean;
  userNameById: Record<string, string>;
  onReload: () => Promise<void>; toast: ReturnType<typeof useToast>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const resolveUserLabel = (userId?: string) => {
    if (!userId) return '';
    return userNameById[userId] || 'Сотрудник';
  };

  const uploadFiles = async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    setUploading(true);
    try {
      const uploaded: Array<{ id: string; name: string; url: string }> = [];
      for (const file of arr) {
        const result = await uploadFileT<{ id: string; name: string; url: string }>('/files/upload', file);
        uploaded.push({ id: result.id, name: result.name, url: result.url });
      }
      // Attach uploaded files to installation
      await api.patchT(`/installations/${instId}/files`, { files: uploaded });
      toast.success(`Загружено файлов: ${arr.length}`);
      await onReload();
    } catch {
      toast.error('Не удалось загрузить файлы');
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      void uploadFiles(e.dataTransfer.files);
    }
  };

  const onDelete = async (fileId: string) => {
    try {
      const token = getAccessToken() ?? '';
      const resp = await fetch(buildApiUrl(`/installations/${instId}/files`), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify({ fileIds: [fileId] }),
      });
      if (!resp.ok) throw new Error();
      toast.success('Файл удалён');
      await onReload();
    } catch {
      toast.error('Не удалось удалить файл');
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
          <FileText size={18} className="text-blue-500" />
          Файлы
          {files.length > 0 ? (
            <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-blue-100 px-1.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              {files.length}
            </span>
          ) : null}
        </h3>
        {canManage ? (
          <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60">
            <Upload size={14} /> {uploading ? 'Загрузка...' : 'Загрузить'}
          </button>
        ) : null}
        <input ref={inputRef} type="file" multiple className="hidden"
          onChange={(e) => { if (e.target.files) void uploadFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {/* Drop zone */}
      {canManage ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={[
            'mx-6 mt-4 rounded-lg border-2 border-dashed p-6 text-center transition',
            dragOver
              ? 'border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950/20'
              : 'border-slate-200 dark:border-slate-700',
          ].join(' ')}
        >
          <Upload size={24} className="mx-auto mb-2 text-slate-400" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Перетащите файлы сюда или нажмите «Загрузить»
          </p>
        </div>
      ) : null}

      {/* File list */}
      {files.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <FileText size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-400">Файлы не загружены</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800 mt-2">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-6 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
                <FileText size={16} className="text-slate-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{f.name}</p>
                <p className="text-xs text-slate-400">
                  {resolveUserLabel(f.userId)}{f.createdAt ? ` · ${f.createdAt.slice(0, 10)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noopener noreferrer"
                    className="rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800">
                    <Download size={14} />
                  </a>
                ) : null}
                {canManage ? (
                  <button type="button" onClick={() => onDelete(f.id)}
                    className="rounded p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30">
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
