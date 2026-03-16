import { useState, useCallback } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import {
  FilterOperator,
  LogicalOperator,
  FieldType,
  type FilterCondition,
  type FilterGroup,
} from '@/types/filters';

interface FieldDefinition {
  name: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
}

interface AdvancedFilterBuilderProps {
  fields: FieldDefinition[];
  filterGroup: FilterGroup;
  onChange: (filterGroup: FilterGroup) => void;
  onClose?: () => void;
}

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  [FilterOperator.EQUALS]: 'Равно',
  [FilterOperator.NOT_EQUALS]: 'Не равно',
  [FilterOperator.CONTAINS]: 'Содержит',
  [FilterOperator.NOT_CONTAINS]: 'Не содержит',
  [FilterOperator.STARTS_WITH]: 'Начинается с',
  [FilterOperator.ENDS_WITH]: 'Заканчивается на',
  [FilterOperator.GREATER_THAN]: 'Больше',
  [FilterOperator.GREATER_THAN_OR_EQUAL]: 'Больше или равно',
  [FilterOperator.LESS_THAN]: 'Меньше',
  [FilterOperator.LESS_THAN_OR_EQUAL]: 'Меньше или равно',
  [FilterOperator.IN]: 'В списке',
  [FilterOperator.NOT_IN]: 'Не в списке',
  [FilterOperator.IS_EMPTY]: 'Пусто',
  [FilterOperator.IS_NOT_EMPTY]: 'Не пусто',
  [FilterOperator.DATE_RANGE]: 'В диапазоне',
  [FilterOperator.DATE_BEFORE]: 'До',
  [FilterOperator.DATE_AFTER]: 'После',
};

const getOperatorsForFieldType = (fieldType: FieldType): FilterOperator[] => {
  switch (fieldType) {
    case FieldType.TEXT:
      return [
        FilterOperator.EQUALS,
        FilterOperator.NOT_EQUALS,
        FilterOperator.CONTAINS,
        FilterOperator.NOT_CONTAINS,
        FilterOperator.STARTS_WITH,
        FilterOperator.ENDS_WITH,
        FilterOperator.IS_EMPTY,
        FilterOperator.IS_NOT_EMPTY,
      ];
    case FieldType.NUMBER:
      return [
        FilterOperator.EQUALS,
        FilterOperator.NOT_EQUALS,
        FilterOperator.GREATER_THAN,
        FilterOperator.GREATER_THAN_OR_EQUAL,
        FilterOperator.LESS_THAN,
        FilterOperator.LESS_THAN_OR_EQUAL,
        FilterOperator.IS_EMPTY,
        FilterOperator.IS_NOT_EMPTY,
      ];
    case FieldType.DATE:
      return [
        FilterOperator.EQUALS,
        FilterOperator.DATE_BEFORE,
        FilterOperator.DATE_AFTER,
        FilterOperator.DATE_RANGE,
        FilterOperator.IS_EMPTY,
        FilterOperator.IS_NOT_EMPTY,
      ];
    case FieldType.SELECT:
    case FieldType.USER:
      return [
        FilterOperator.EQUALS,
        FilterOperator.NOT_EQUALS,
        FilterOperator.IS_EMPTY,
        FilterOperator.IS_NOT_EMPTY,
      ];
    case FieldType.MULTI_SELECT:
      return [
        FilterOperator.IN,
        FilterOperator.NOT_IN,
        FilterOperator.IS_EMPTY,
        FilterOperator.IS_NOT_EMPTY,
      ];
    case FieldType.BOOLEAN:
      return [FilterOperator.EQUALS];
    default:
      return [FilterOperator.EQUALS, FilterOperator.NOT_EQUALS];
  }
};

const generateId = () => Math.random().toString(36).substring(2, 11);

export default function AdvancedFilterBuilder({
  fields,
  filterGroup,
  onChange,
  onClose,
}: AdvancedFilterBuilderProps) {
  const [localGroup, setLocalGroup] = useState<FilterGroup>(filterGroup);

  const updateGroup = useCallback((updatedGroup: FilterGroup) => {
    setLocalGroup(updatedGroup);
    onChange(updatedGroup);
  }, [onChange]);

  const addCondition = useCallback((group: FilterGroup) => {
    const firstField = fields[0];
    const newCondition: FilterCondition = {
      id: generateId(),
      field: firstField.name,
      operator: getOperatorsForFieldType(firstField.type)[0],
      value: '',
      fieldType: firstField.type,
    };

    const updated = { ...group, conditions: [...group.conditions, newCondition] };
    updateGroup(updated);
  }, [fields, updateGroup]);

  const removeCondition = useCallback((group: FilterGroup, conditionId: string) => {
    const updated = {
      ...group,
      conditions: group.conditions.filter((c) => c.id !== conditionId),
    };
    updateGroup(updated);
  }, [updateGroup]);

  const updateCondition = useCallback((
    group: FilterGroup,
    conditionId: string,
    updates: Partial<FilterCondition>
  ) => {
    const updated = {
      ...group,
      conditions: group.conditions.map((c) =>
        c.id === conditionId ? { ...c, ...updates } : c
      ),
    };
    updateGroup(updated);
  }, [updateGroup]);

  const toggleOperator = useCallback((group: FilterGroup) => {
    const updated = {
      ...group,
      operator: group.operator === LogicalOperator.AND ? LogicalOperator.OR : LogicalOperator.AND,
    };
    updateGroup(updated);
  }, [updateGroup]);

  const renderCondition = (condition: FilterCondition) => {
    const field = fields.find((f) => f.name === condition.field);
    if (!field) return null;

    const operators = getOperatorsForFieldType(field.type);
    const needsValue = ![FilterOperator.IS_EMPTY, FilterOperator.IS_NOT_EMPTY].includes(condition.operator);

    return (
      <div key={condition.id} className="flex flex-col gap-2 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <select
            value={condition.field}
            onChange={(e) => {
              const newField = fields.find((f) => f.name === e.target.value);
              if (newField) {
                updateCondition(localGroup, condition.id, {
                  field: e.target.value,
                  fieldType: newField.type,
                  operator: getOperatorsForFieldType(newField.type)[0],
                  value: '',
                });
              }
            }}
            className="min-h-[44px] w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm sm:min-h-0 sm:w-auto"
          >
            {fields.map((f) => (
              <option key={f.name} value={f.name}>
                {f.label}
              </option>
            ))}
          </select>

          <button
            onClick={() => removeCondition(localGroup, condition.id)}
            className="min-h-[44px] min-w-[44px] p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors sm:hidden"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <select
          value={condition.operator}
          onChange={(e) =>
            updateCondition(localGroup, condition.id, { operator: e.target.value as FilterOperator })
          }
          className="min-h-[44px] w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm sm:min-h-0 sm:w-auto"
        >
          {operators.map((op) => (
            <option key={op} value={op}>
              {OPERATOR_LABELS[op]}
            </option>
          ))}
        </select>

        {needsValue && (
          <>
            {field.type === FieldType.SELECT && field.options ? (
              <select
                value={condition.value as string}
                onChange={(e) => updateCondition(localGroup, condition.id, { value: e.target.value })}
                className="min-h-[44px] w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm sm:min-h-0 sm:flex-1 sm:w-auto"
              >
                <option value="">Выберите...</option>
                {field.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : field.type === FieldType.BOOLEAN ? (
              <select
                value={condition.value as string}
                onChange={(e) => updateCondition(localGroup, condition.id, { value: e.target.value === 'true' })}
                className="min-h-[44px] w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm sm:min-h-0 sm:flex-1 sm:w-auto"
              >
                <option value="true">Да</option>
                <option value="false">Нет</option>
              </select>
            ) : (
              <input
                type={field.type === FieldType.NUMBER ? 'number' : field.type === FieldType.DATE ? 'date' : 'text'}
                value={condition.value as string}
                onChange={(e) => updateCondition(localGroup, condition.id, { value: e.target.value })}
                placeholder="Значение..."
                className="min-h-[44px] w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm sm:min-h-0 sm:flex-1 sm:w-auto"
              />
            )}
          </>
        )}

        <button
          onClick={() => removeCondition(localGroup, condition.id)}
          className="hidden p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors sm:block"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    );
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Расширенные фильтры</h3>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="space-y-3">
        {localGroup.conditions.length > 0 && (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm text-slate-600 dark:text-slate-400">Условия:</span>
            <button
              onClick={() => toggleOperator(localGroup)}
              className="px-3 py-1 text-sm font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors"
            >
              {localGroup.operator === LogicalOperator.AND ? 'И (AND)' : 'ИЛИ (OR)'}
            </button>
          </div>
        )}

        {localGroup.conditions.map((condition) => renderCondition(condition))}

        <button
          onClick={() => addCondition(localGroup)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Добавить условие
        </button>
      </div>
    </div>
  );
}
