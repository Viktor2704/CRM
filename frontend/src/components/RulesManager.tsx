import { useEffect, useState } from 'react';
import { Edit2, Plus, Trash2 } from 'lucide-react';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';

type TelegramRule = {
  id: string;
  eventType: string;
  templateId: string;
  templateName?: string;
  enabled: boolean;
  priority: number;
  conditions: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type RuleFormData = {
  eventType: string;
  templateId: string;
  enabled: boolean;
  priority: number;
  conditions: string;
};

const EVENT_TYPES = [
  { value: 'installation.created', label: 'Создание монтажа' },
  { value: 'installation.updated', label: 'Обновление монтажа' },
  { value: 'installation.deadline', label: 'Дедлайн монтажа' },
  { value: 'service_request.created', label: 'Создание заявки' },
  { value: 'service_request.updated', label: 'Обновление заявки' },
  { value: 'contract.signed', label: 'Подписание договора' },
  { value: 'payment.received', label: 'Получение платежа' },
];

export default function RulesManager() {
  const toast = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [rules, setRules] = useState<TelegramRule[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingRule, setEditingRule] = useState<TelegramRule | null>(null);
  const [formData, setFormData] = useState<RuleFormData>({
    eventType: '',
    templateId: '',
    enabled: true,
    priority: 0,
    conditions: '{}',
  });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const loadRules = async () => {
    setLoading(true);
    try {
      const result = await api.getT<TelegramRule[]>('/telegram/rules');
      setRules(result);
    } catch {
      toast.error('Не удалось загрузить правила.');
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const result = await api.getT<{ id: string; name: string }[]>('/telegram/templates');
      setTemplates(result);
    } catch {
      toast.error('Не удалось загрузить шаблоны.');
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadRules();
      void loadTemplates();
    }
  }, [isOpen]);

  const handleCreate = () => {
    setEditingRule(null);
    setFormData({
      eventType: '',
      templateId: '',
      enabled: true,
      priority: 0,
      conditions: '{}',
    });
  };

  const handleEdit = (rule: TelegramRule) => {
    setEditingRule(rule);
    setFormData({
      eventType: rule.eventType,
      templateId: rule.templateId,
      enabled: rule.enabled,
      priority: rule.priority,
      conditions: JSON.stringify(rule.conditions, null, 2),
    });
  };

  const handleSave = async () => {
    if (!formData.eventType || !formData.templateId) {
      toast.error('Заполните все обязательные поля.');
      return;
    }

    let parsedConditions: Record<string, unknown>;
    try {
      parsedConditions = JSON.parse(formData.conditions);
    } catch {
      toast.error('Некорректный JSON в условиях.');
      return;
    }

    const payload = {
      eventType: formData.eventType,
      templateId: formData.templateId,
      enabled: formData.enabled,
      priority: formData.priority,
      conditions: parsedConditions,
    };

    try {
      if (editingRule) {
        await api.patchT(`/telegram/rules/${editingRule.id}`, payload);
        toast.success('Правило обновлено.');
      } else {
        await api.postT('/telegram/rules', payload);
        toast.success('Правило создано.');
      }
      setEditingRule(null);
      setFormData({
        eventType: '',
        templateId: '',
        enabled: true,
        priority: 0,
        conditions: '{}',
      });
      void loadRules();
    } catch {
      toast.error('Не удалось сохранить правило.');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delT(`/telegram/rules/${id}`);
      toast.success('Правило удалено.');
      setDeleteConfirm(null);
      void loadRules();
    } catch {
      toast.error('Не удалось удалить правило.');
    }
  };

  const toggleEnabled = async (rule: TelegramRule) => {
    try {
      await api.patchT(`/telegram/rules/${rule.id}`, { enabled: !rule.enabled });
      setRules((current) =>
        current.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
      );
      toast.success(rule.enabled ? 'Правило отключено.' : 'Правило включено.');
    } catch {
      toast.error('Не удалось изменить статус правила.');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        Правила уведомлений
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Правила Telegram">
        <div className="space-y-4">
          {editingRule !== null || formData.eventType || formData.templateId ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
              <h4 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {editingRule ? 'Редактировать правило' : 'Новое правило'}
              </h4>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Тип события
                  </label>
                  <select
                    value={formData.eventType}
                    onChange={(e) => setFormData({ ...formData, eventType: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">Выберите тип события</option>
                    {EVENT_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Шаблон
                  </label>
                  <select
                    value={formData.templateId}
                    onChange={(e) => setFormData({ ...formData, templateId: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">Выберите шаблон</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Приоритет
                  </label>
                  <input
                    type="number"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Условия (JSON)
                  </label>
                  <textarea
                    value={formData.conditions}
                    onChange={(e) => setFormData({ ...formData, conditions: e.target.value })}
                    rows={4}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    placeholder='{"status": "active"}'
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="enabled"
                    checked={formData.enabled}
                    onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-2 focus:ring-sky-500/20"
                  />
                  <label htmlFor="enabled" className="text-sm text-slate-700 dark:text-slate-300">
                    Включено
                  </label>
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
                      setEditingRule(null);
                      setFormData({
                        eventType: '',
                        templateId: '',
                        enabled: true,
                        priority: 0,
                        conditions: '{}',
                      });
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
              Создать правило
            </button>
          )}

          {loading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400">
              Загрузка...
            </div>
          ) : (
            <div className="space-y-2">
              {rules.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400">
                  Правил нет.
                </div>
              ) : (
                rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h5 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {EVENT_TYPES.find((t) => t.value === rule.eventType)?.label || rule.eventType}
                          </h5>
                          <span
                            className={[
                              'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                              rule.enabled
                                ? 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
                            ].join(' ')}
                          >
                            {rule.enabled ? 'Включено' : 'Выключено'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                          Шаблон: {rule.templateName || rule.templateId}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Приоритет: {rule.priority}
                        </p>
                        {Object.keys(rule.conditions).length > 0 && (
                          <p className="mt-1 text-xs font-mono text-slate-500 dark:text-slate-400">
                            {JSON.stringify(rule.conditions)}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => toggleEnabled(rule)}
                          className="rounded-lg px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                          title={rule.enabled ? 'Отключить' : 'Включить'}
                        >
                          {rule.enabled ? 'Откл.' : 'Вкл.'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEdit(rule)}
                          className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                          title="Редактировать"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm(rule.id)}
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
        title="Удалить правило"
        message="Вы уверены, что хотите удалить это правило?"
        confirmLabel="Удалить"
      />
    </>
  );
}
