import { useState } from 'react';
import { Plus, Trash2, Star, Eye } from 'lucide-react';

export interface SavedView {
  id: string;
  name: string;
  params: Record<string, any>;
  isDefault?: boolean;
  isSystem?: boolean;
}

interface SavedViewsPanelProps {
  views: SavedView[];
  defaultViewId?: string | null;
  systemViewId?: string | null;
  currentParams: Record<string, any>;
  onSelectView: (view: SavedView) => void;
  onCreateView: (name: string, params: Record<string, any>) => Promise<void>;
  onUpdateView: (id: string, updates: Partial<SavedView>) => Promise<void>;
  onDeleteView: (id: string) => Promise<void>;
  loading?: boolean;
}

export default function SavedViewsPanel({
  views,
  defaultViewId,
  systemViewId: _systemViewId,
  currentParams,
  onSelectView,
  onCreateView,
  onUpdateView,
  onDeleteView,
  loading = false,
}: SavedViewsPanelProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreateView = async () => {
    if (!newViewName.trim()) return;
    setSaving(true);
    try {
      await onCreateView(newViewName, currentParams);
      setNewViewName('');
      setShowCreateForm(false);
    } catch (error) {
      console.error('Failed to create view:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (viewId: string) => {
    try {
      await onUpdateView(viewId, { isDefault: true });
    } catch (error) {
      console.error('Failed to set default view:', error);
    }
  };

  const handleDelete = async (viewId: string) => {
    if (!confirm('Удалить сохраненное представление?')) return;
    try {
      await onDeleteView(viewId);
    } catch (error) {
      console.error('Failed to delete view:', error);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Сохраненные представления
        </h3>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700"
          title="Создать представление"
        >
          <Plus size={16} />
        </button>
      </div>

      {showCreateForm && (
        <div className="mb-3 space-y-2">
          <input
            type="text"
            value={newViewName}
            onChange={(e) => setNewViewName(e.target.value)}
            placeholder="Название представления"
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-700"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void handleCreateView();
              }
            }}
          />
          <div className="flex gap-2">
            <button
              onClick={() => void handleCreateView()}
              disabled={saving || !newViewName.trim()}
              className="flex-1 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
            <button
              onClick={() => {
                setShowCreateForm(false);
                setNewViewName('');
              }}
              className="flex-1 rounded bg-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Загрузка...</div>
      ) : views.length === 0 ? (
        <div className="text-sm text-slate-500">Нет сохраненных представлений</div>
      ) : (
        <div className="space-y-1">
          {views.map((view) => (
            <div
              key={view.id}
              className="group flex items-center justify-between rounded px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <button
                onClick={() => onSelectView(view)}
                className="flex flex-1 items-center gap-2 text-left text-sm text-slate-700 dark:text-slate-300"
              >
                <Eye size={14} className="text-slate-400" />
                <span className="flex-1 truncate">{view.name}</span>
                {view.id === defaultViewId && (
                  <Star size={12} className="text-yellow-500" fill="currentColor" />
                )}
              </button>
              {!view.isSystem && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  {view.id !== defaultViewId && (
                    <button
                      onClick={() => void handleSetDefault(view.id)}
                      className="rounded p-1 text-slate-400 hover:text-yellow-500"
                      title="Сделать по умолчанию"
                    >
                      <Star size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => void handleDelete(view.id)}
                    className="rounded p-1 text-slate-400 hover:text-red-500"
                    title="Удалить"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
