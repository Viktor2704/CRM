import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';

type EntityType = 'projects' | 'installations' | 'service_requests';

type ReportConfig = {
  fields: string[];
  filters: Array<{
    field: string;
    operator: string;
    value: any;
  }>;
  groupBy?: string;
  aggregations: Array<{
    field: string;
    function: string;
  }>;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
  limit?: number;
};

const ENTITY_FIELDS: Record<EntityType, Array<{ value: string; label: string }>> = {
  projects: [
    { value: 'id', label: 'ID' },
    { value: 'title', label: 'Название' },
    { value: 'description', label: 'Описание' },
    { value: 'status', label: 'Статус' },
    { value: 'priority', label: 'Приоритет' },
    { value: 'tenantId', label: 'Клиент' },
    { value: 'executorIds', label: 'Исполнители' },
    { value: 'responsibleIds', label: 'Ответственные' },
    { value: 'dueDatePreliminary', label: 'Срок' },
    { value: 'createdAt', label: 'Создан' },
    { value: 'updatedAt', label: 'Обновлен' },
  ],
  installations: [
    { value: 'id', label: 'ID' },
    { value: 'title', label: 'Название' },
    { value: 'description', label: 'Описание' },
    { value: 'status', label: 'Статус' },
    { value: 'stage', label: 'Стадия' },
    { value: 'priority', label: 'Приоритет' },
    { value: 'tenantId', label: 'Клиент' },
    { value: 'executorIds', label: 'Исполнители' },
    { value: 'dueDatePreliminary', label: 'Срок' },
    { value: 'createdAt', label: 'Создан' },
  ],
  service_requests: [
    { value: 'id', label: 'ID' },
    { value: 'title', label: 'Название' },
    { value: 'description', label: 'Описание' },
    { value: 'status', label: 'Статус' },
    { value: 'priority', label: 'Приоритет' },
    { value: 'maintenanceItemId', label: 'Объект ТО' },
    { value: 'assignedToId', label: 'Назначен' },
    { value: 'createdAt', label: 'Создан' },
  ],
};

const OPERATORS = [
  { value: 'eq', label: 'Равно' },
  { value: 'ne', label: 'Не равно' },
  { value: 'gt', label: 'Больше' },
  { value: 'lt', label: 'Меньше' },
  { value: 'gte', label: 'Больше или равно' },
  { value: 'lte', label: 'Меньше или равно' },
  { value: 'in', label: 'В списке' },
  { value: 'contains', label: 'Содержит' },
];

const AGGREGATION_FUNCTIONS = [
  { value: 'count', label: 'Количество' },
  { value: 'sum', label: 'Сумма' },
  { value: 'avg', label: 'Среднее' },
  { value: 'min', label: 'Минимум' },
  { value: 'max', label: 'Максимум' },
];

export default function ReportBuilder({
  onSave,
  onCancel,
}: {
  onSave: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [entityType, setEntityType] = useState<EntityType>('projects');
  const [selectedFields, setSelectedFields] = useState<string[]>(['id', 'title', 'status']);
  const [filters, setFilters] = useState<Array<{ field: string; operator: string; value: string }>>([]);
  const [groupBy, setGroupBy] = useState('');
  const [aggregations, setAggregations] = useState<Array<{ field: string; function: string }>>([]);
  const [orderBy, setOrderBy] = useState('');
  const [orderDirection, setOrderDirection] = useState<'asc' | 'desc'>('asc');
  const [limit, setLimit] = useState(1000);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const availableFields = ENTITY_FIELDS[entityType];

  const toggleField = (field: string) => {
    setSelectedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  };

  const addFilter = () => {
    setFilters([...filters, { field: availableFields[0].value, operator: 'eq', value: '' }]);
  };

  const updateFilter = (index: number, key: string, value: any) => {
    const updated = [...filters];
    updated[index] = { ...updated[index], [key]: value };
    setFilters(updated);
  };

  const removeFilter = (index: number) => {
    setFilters(filters.filter((_, i) => i !== index));
  };

  const addAggregation = () => {
    setAggregations([...aggregations, { field: 'id', function: 'count' }]);
  };

  const updateAggregation = (index: number, key: string, value: any) => {
    const updated = [...aggregations];
    updated[index] = { ...updated[index], [key]: value };
    setAggregations(updated);
  };

  const removeAggregation = (index: number) => {
    setAggregations(aggregations.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showToast('Введите название отчета', 'error');
      return;
    }

    if (selectedFields.length === 0) {
      showToast('Выберите хотя бы одно поле', 'error');
      return;
    }

    setSaving(true);
    try {
      const config: ReportConfig = {
        fields: selectedFields,
        filters: filters.filter((f) => f.value),
        groupBy: groupBy || undefined,
        aggregations,
        orderBy: orderBy || undefined,
        orderDirection,
        limit,
      };

      await api.post('/reports/definitions', {
        name: name.trim(),
        description: description.trim() || undefined,
        entityType,
        config,
      });

      showToast('Отчет создан', 'success');
      onSave();
    } catch (error) {
      showToast('Ошибка создания отчета', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Название отчета</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
          placeholder="Например: Проекты по статусам"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Описание</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
          placeholder="Краткое описание отчета"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Тип сущности</label>
        <select
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value as EntityType);
            setSelectedFields(['id', 'title', 'status']);
            setFilters([]);
            setGroupBy('');
            setAggregations([]);
          }}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
        >
          <option value="projects">Проекты</option>
          <option value="installations">Монтажи</option>
          <option value="service_requests">Заявки</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Поля для отчета</label>
        <div className="grid grid-cols-2 gap-2">
          {availableFields.map((field) => (
            <label key={field.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedFields.includes(field.value)}
                onChange={() => toggleField(field.value)}
                className="rounded border-slate-300"
              />
              <span className="text-slate-700 dark:text-slate-300">{field.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Фильтры</label>
          <button
            onClick={addFilter}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
          >
            <Plus className="h-4 w-4" />
            Добавить фильтр
          </button>
        </div>
        <div className="space-y-2">
          {filters.map((filter, index) => (
            <div key={index} className="flex items-center gap-2">
              <select
                value={filter.field}
                onChange={(e) => updateFilter(index, 'field', e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700"
              >
                {availableFields.map((field) => (
                  <option key={field.value} value={field.value}>
                    {field.label}
                  </option>
                ))}
              </select>
              <select
                value={filter.operator}
                onChange={(e) => updateFilter(index, 'operator', e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700"
              >
                {OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={filter.value}
                onChange={(e) => updateFilter(index, 'value', e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700"
                placeholder="Значение"
              />
              <button
                onClick={() => removeFilter(index)}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Группировка по полю</label>
        <select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
        >
          <option value="">Без группировки</option>
          {availableFields.map((field) => (
            <option key={field.value} value={field.value}>
              {field.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Агрегации</label>
          <button
            onClick={addAggregation}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
          >
            <Plus className="h-4 w-4" />
            Добавить агрегацию
          </button>
        </div>
        <div className="space-y-2">
          {aggregations.map((agg, index) => (
            <div key={index} className="flex items-center gap-2">
              <select
                value={agg.function}
                onChange={(e) => updateAggregation(index, 'function', e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700"
              >
                {AGGREGATION_FUNCTIONS.map((func) => (
                  <option key={func.value} value={func.value}>
                    {func.label}
                  </option>
                ))}
              </select>
              <select
                value={agg.field}
                onChange={(e) => updateAggregation(index, 'field', e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700"
              >
                {availableFields.map((field) => (
                  <option key={field.value} value={field.value}>
                    {field.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => removeAggregation(index)}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Сортировка</label>
          <select
            value={orderBy}
            onChange={(e) => setOrderBy(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
          >
            <option value="">Без сортировки</option>
            {availableFields.map((field) => (
              <option key={field.value} value={field.value}>
                {field.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Направление</label>
          <select
            value={orderDirection}
            onChange={(e) => setOrderDirection(e.target.value as 'asc' | 'desc')}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
          >
            <option value="asc">По возрастанию</option>
            <option value="desc">По убыванию</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Лимит строк</label>
        <input
          type="number"
          value={limit}
          onChange={(e) => setLimit(Math.max(1, Math.min(10000, parseInt(e.target.value) || 1000)))}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
          min="1"
          max="10000"
        />
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-slate-200 dark:border-slate-700">
        <button
          onClick={onCancel}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
        >
          Отмена
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Сохранение...' : 'Создать отчет'}
        </button>
      </div>
    </div>
  );
}
