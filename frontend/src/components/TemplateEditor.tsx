import { useEffect, useState } from 'react';
import { Edit2, Plus, Trash2 } from 'lucide-react';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';

type TelegramTemplate = {
  id: string;
  name: string;
  content: string;
  variables: string[];
  createdAt: string;
  updatedAt: string;
};

type TemplateFormData = {
  name: string;
  content: string;
};

export default function TemplateEditor() {
  const toast = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [templates, setTemplates] = useState<TelegramTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TelegramTemplate | null>(null);
  const [formData, setFormData] = useState<TemplateFormData>({ name: '', content: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const result = await api.getT<TelegramTemplate[]>('/telegram/templates');
      setTemplates(result);
    } catch {
      toast.error('Не удалось загрузить шаблоны.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadTemplates();
    }
  }, [isOpen]);

  const handleCreate = () => {
    setEditingTemplate(null);
    setFormData({ name: '', content: '' });
  };

  const handleEdit = (template: TelegramTemplate) => {
    setEditingTemplate(template);
    setFormData({ name: template.name, content: template.content });
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.content.trim()) {
      toast.error('Заполните все поля.');
      return;
    }

    try {
      if (editingTemplate) {
        await api.patchT(`/telegram/templates/${editingTemplate.id}`, formData);
        toast.success('Шаблон обновлён.');
      } else {
        await api.postT('/telegram/templates', formData);
        toast.success('Шаблон создан.');
      }
      setEditingTemplate(null);
      setFormData({ name: '', content: '' });
      void loadTemplates();
    } catch {
      toast.error('Не удалось сохранить шаблон.');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delT(`/telegram/templates/${id}`);
      toast.success('Шаблон удалён.');
      setDeleteConfirm(null);
      void loadTemplates();
    } catch {
      toast.error('Не удалось удалить шаблон.');
    }
  };

  const extractVariables = (content: string): string[] => {
    const matches = content.match(/\{\{(\w+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map((m) => m.slice(2, -2)))];
  };

  const currentVariables = extractVariables(formData.content);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        Шаблоны сообщений
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Шаблоны Telegram">
        <div className="space-y-4">
          {editingTemplate !== null || formData.name || formData.content ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
              <h4 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {editingTemplate ? 'Редактировать шаблон' : 'Новый шаблон'}
              </h4>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Название
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    placeholder="Название шаблона"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Содержимое
                  </label>
                  <textarea
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    rows={6}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    placeholder="Используйте {{переменная}} для вставки данных"
                  />
                  {currentVariables.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Переменные: {currentVariables.join(', ')}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
                  >
                    Сохранить
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTemplate(null);
                      setFormData({ name: '', content: '' });
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
            >
              <Plus size={16} />
              Создать шаблон
            </button>
          )}

          {loading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400">
              Загрузка...
            </div>
          ) : (
            <div className="space-y-2">
              {templates.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400">
                  Шаблонов нет.
                </div>
              ) : (
                templates.map((template) => (
                  <div
                    key={template.id}
                    className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <h5 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {template.name}
                        </h5>
                        <p className="mt-1 whitespace-pre-line text-xs text-slate-600 dark:text-slate-400">
                          {template.content}
                        </p>
                        {template.variables.length > 0 && (
                          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            Переменные: {template.variables.join(', ')}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => handleEdit(template)}
                          className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                          title="Редактировать"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm(template.id)}
                          className="rounded-lg p-2 text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                          title="Удалить"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={deleteConfirm !== null}
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
        title="Удалить шаблон"
        message="Вы уверены, что хотите удалить этот шаблон?"
        confirmLabel="Удалить"
      />
    </>
  );
}
