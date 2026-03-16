import { useState } from 'react';
import { Calendar, Save, Plus, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import type { useToast } from '@/context/ToastContext';
import {
  INSTALLATION_DEADLINE_STAGES,
  INSTALLATION_DEADLINE_STAGE_LABELS,
} from '@/pages/installation/meta';

type StageDeadline = { stage: string; dueDate: string };

export default function DeadlinesTab({ instId, deadlines, canManage, onReload, toast }: {
  instId: string; deadlines: StageDeadline[]; canManage: boolean;
  onReload: () => Promise<void>; toast: ReturnType<typeof useToast>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    const map: Record<string, string> = {};
    INSTALLATION_DEADLINE_STAGES.forEach((s) => {
      const found = deadlines.find((d) => d.stage === s);
      map[s] = found?.dueDate?.slice(0, 10) || '';
    });
    setForm(map);
    setEditing(true);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const items = INSTALLATION_DEADLINE_STAGES
        .filter((s) => form[s])
        .map((s) => ({ stage: s, dueDate: form[s] }));
      await api.putT(`/installations/${instId}/stage-deadlines`, { deadlines: items });
      toast.success('Сроки сохранены');
      setEditing(false);
      await onReload();
    } catch {
      toast.error('Не удалось сохранить сроки');
    } finally {
      setSaving(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
          <Calendar size={18} className="text-red-500" />
          Сроки по этапам
        </h3>
        {canManage && !editing ? (
          <button type="button" onClick={startEdit}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
            <Plus size={14} /> Настроить
          </button>
        ) : null}
      </div>

      <div className="p-6">
        {editing ? (
          <div className="space-y-4">
            {INSTALLATION_DEADLINE_STAGES.map((s) => (
              <div key={s} className="flex items-center gap-4">
                <label className="w-32 text-sm font-medium text-slate-700 dark:text-slate-300 shrink-0">
                  {INSTALLATION_DEADLINE_STAGE_LABELS[s]}
                </label>
                <input
                  type="date"
                  value={form[s] || ''}
                  onChange={(e) => setForm((p) => ({ ...p, [s]: e.target.value }))}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-red-500 transition focus:border-red-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                {form[s] ? (
                  <button type="button" onClick={() => setForm((p) => ({ ...p, [s]: '' }))}
                    className="rounded p-1 text-slate-400 hover:text-red-500 transition">
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <button type="button" disabled={saving} onClick={onSave}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60">
                <Save size={14} /> {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button type="button" onClick={() => setEditing(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {deadlines.length === 0 ? (
              <p className="text-sm text-slate-400 italic py-4 text-center">Сроки по этапам не заданы</p>
            ) : (
              deadlines.map((d) => {
                const isOverdue = d.dueDate && d.dueDate.slice(0, 10) < today;
                return (
                  <div key={d.stage} className={[
                    'flex items-center justify-between rounded-lg border px-4 py-3 transition',
                    isOverdue
                      ? 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20'
                      : 'border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50',
                  ].join(' ')}>
                    <div className="flex items-center gap-3">
                      <div className={[
                        'flex h-8 w-8 items-center justify-center rounded-lg',
                        isOverdue ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                      ].join(' ')}>
                        <Calendar size={16} />
                      </div>
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {INSTALLATION_DEADLINE_STAGE_LABELS[d.stage] || d.stage}
                      </span>
                    </div>
                    <span className={[
                      'text-sm font-semibold',
                      isOverdue ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300',
                    ].join(' ')}>
                      {d.dueDate?.slice(0, 10) || '-'}
                      {isOverdue ? ' (просрочено)' : ''}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
