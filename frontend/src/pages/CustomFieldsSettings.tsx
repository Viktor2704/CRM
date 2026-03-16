import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Pencil, Trash2, Settings as SettingsIcon, Save } from 'lucide-react';
import Modal from '@/components/Modal';
import Breadcrumbs from '@/components/Breadcrumbs';
import ConfirmDialog from '@/components/ConfirmDialog';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { usePermissions } from '@/hooks/usePermissions';

type FieldType = 'text' | 'number' | 'select' | 'date';

type CustomFieldDefinition = {
  id: string;
  entityType: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: FieldType;
  fieldOptions: string[];
  isRequired: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

type FieldForm = {
  fieldLabel: string;
  fieldKey: string;
  fieldType: FieldType;
  fieldOptions: string;
  isRequired: boolean;
  displayOrder: number;
};

const INITIAL_FORM: FieldForm = {
  fieldLabel: '',
  fieldKey: '',
  fieldType: 'text',
  fieldOptions: '',
  isRequired: false,
  displayOrder: 0,
};

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Текст',
  number: 'Число',
  select: 'Выбор',
  date: 'Дата',
};

export default function CustomFieldsSettingsPage() {
  const toast = useToast();
  const { isAdminOrManager } = usePermissions();
  const [fields, setFields] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedField, setSelectedField] = useState<CustomFieldDefinition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomFieldDefinition | null>(null);
  const [createForm, setCreateForm] = useState<FieldForm>(INITIAL_FORM);
  const [editForm, setEditForm] = useState<FieldForm>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);

  const loadFields = async () => {
    setError('');
    try {
      const response = await api.getT<CustomFieldDefinition[]>('/custom-fields/definitions?entityType=tenant');
      setFields(Array.isArray(response) ? response : []);
    } catch {
      setError('Не удалось загрузить настройки полей.');
      toast.error('Не удалось загрузить настройки полей.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFields();
  }, []);

  const openEdit = (field: CustomFieldDefinition) => {
    setSelectedField(field);
    setEditForm({
      fieldLabel: field.fieldLabel,
      fieldKey: field.fieldKey,
      fieldType: field.fieldType,
      fieldOptions: field.fieldOptions.join('\n'),
      isRequired: field.isRequired,
      displayOrder: field.displayOrder,
    });
    setIsEditOpen(true);
  };

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        fieldLabel: createForm.fieldLabel.trim(),
        fieldKey: createForm.fieldKey.trim().toLowerCase(),
        fieldType: createForm.fieldType,
        fieldOptions: createForm.fieldOptions
          .split('\n')
          .map(opt => opt.trim())
          .filter(opt => opt.length > 0),
        isRequired: createForm.isRequired,
        displayOrder: createForm.displayOrder,
      };
      await api.postT('/custom-fields/definitions', { entityType: 'tenant', ...payload });
      setCreateForm(INITIAL_FORM);
      setIsCreateOpen(false);
      await loadFields();
      toast.success('Поле создано.');
    } catch (err: any) {
      const message = err?.message || 'Не удалось создать поле.';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const onUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedField) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        fieldLabel: editForm.fieldLabel.trim(),
        fieldType: editForm.fieldType,
        fieldOptions: editForm.fieldOptions
          .split('\n')
          .map(opt => opt.trim())
          .filter(opt => opt.length > 0),
        isRequired: editForm.isRequired,
        displayOrder: editForm.displayOrder,
      };
      await api.patchT(`/custom-fields/definitions/${selectedField.id}`, payload);
      setIsEditOpen(false);
      setSelectedField(null);
      await loadFields();
      toast.success('Поле обновлено.');
    } catch (err: any) {
      const message = err?.message || 'Не удалось обновить поле.';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const onConfirmDelete = async () => {
    if (!deleteTarget) return;
    setError('');
    try {
      await api.delT(`/custom-fields/definitions/${deleteTarget.id}`);
      await loadFields();
      toast.success('Поле удалено.');
    } catch {
      setError('Не удалось удалить поле.');
      toast.error('Не удалось удалить поле.');
    } finally {
      setDeleteTarget(null);
    }
  };

  const FieldFormFields = ({
    form,
    setForm,
    isEdit = false,
  }: {
    form: FieldForm;
    setForm: (fn: (prev: FieldForm) => FieldForm) => void;
    isEdit?: boolean;
  }) => (
    <>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Название поля
        </label>
        <input
          required
          value={form.fieldLabel}
          onChange={(e) => setForm((p) => ({ ...p, fieldLabel: e.target.value }))}
          placeholder="Например: Номер договора"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Ключ поля (латиница, цифры, подчеркивание)
        </label>
        <input
          required
          disabled={isEdit}
          value={form.fieldKey}
          onChange={(e) => setForm((p) => ({ ...p, fieldKey: e.target.value.toLowerCase() }))}
          placeholder="contract_number"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700"
        />
        {isEdit && (
          <p className="mt-1 text-xs text-slate-500">Ключ поля нельзя изменить после создания</p>
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Тип поля
        </label>
        <select
          value={form.fieldType}
          onChange={(e) => setForm((p) => ({ ...p, fieldType: e.target.value as FieldType }))}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {form.fieldType === 'select' && (
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Варианты выбора (по одному на строку)
          </label>
          <textarea
            value={form.fieldOptions}
            onChange={(e) => setForm((p) => ({ ...p, fieldOptions: e.target.value }))}
            placeholder="Вариант 1&#10;Вариант 2&#10;Вариант 3"
            rows={5}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Порядок отображения
        </label>
        <input
          type="number"
          value={form.displayOrder}
          onChange={(e) => setForm((p) => ({ ...p, displayOrder: parseInt(e.target.value) || 0 }))}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      <div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isRequired}
            onChange={(e) => setForm((p) => ({ ...p, isRequired: e.target.checked }))}
            className="text-brand-red focus:ring-brand-red"
          />
          Обязательное поле
        </label>
      </div>
    </>
  );

  if (!isAdminOrManager) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Настройки' }]} />
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          У вас нет доступа к этой странице.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Панель', to: '/' },
          { label: 'Настройки' },
          { label: 'Дополнительные поля контрагентов' },
        ]}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <SettingsIcon size={24} className="text-brand-red" />
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Дополнительные поля контрагентов
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 sm:w-auto"
        >
          <Plus size={16} />
          Создать поле
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800">
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Название
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Ключ
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Тип
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Обязательное
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Порядок
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-500">
                    Загрузка...
                  </td>
                </tr>
              ) : fields.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <SettingsIcon size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Дополнительные поля не настроены
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      Создайте первое поле для контрагентов
                    </p>
                  </td>
                </tr>
              ) : (
                fields.map((field) => (
                  <tr
                    key={field.id}
                    className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <td className="px-5 py-3 text-sm font-medium text-slate-900 dark:text-slate-100">
                      {field.fieldLabel}
                    </td>
                    <td className="px-5 py-3 text-sm font-mono text-slate-600 dark:text-slate-400">
                      {field.fieldKey}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700 dark:text-slate-300">
                      {FIELD_TYPE_LABELS[field.fieldType]}
                    </td>
                    <td className="px-5 py-3 text-sm">
                      {field.isRequired ? (
                        <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                          Да
                        </span>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">Нет</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700 dark:text-slate-300">
                      {field.displayOrder}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(field)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700"
                        >
                          <Pencil size={13} />
                          Изменить
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(field)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                        >
                          <Trash2 size={13} />
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Создание поля">
        <form onSubmit={onCreate} className="space-y-4">
          <FieldFormFields form={createForm} setForm={setCreateForm} />
          <button
            type="submit"
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            <Save size={16} />
            {saving ? 'Сохранение...' : 'Создать'}
          </button>
        </form>
      </Modal>

      <Modal
        isOpen={isEditOpen}
        onClose={() => {
          setIsEditOpen(false);
          setSelectedField(null);
        }}
        title="Редактирование поля"
      >
        <form onSubmit={onUpdate} className="space-y-4">
          <FieldFormFields form={editForm} setForm={setEditForm} isEdit />
          <button
            type="submit"
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            <Save size={16} />
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void onConfirmDelete()}
        title="Удалить поле?"
        message="Все значения этого поля будут удалены. Это действие нельзя отменить."
        confirmLabel="Удалить"
      />
    </div>
  );
}
