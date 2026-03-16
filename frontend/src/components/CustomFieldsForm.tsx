import { type ChangeEvent } from 'react';

export interface CustomFieldDefinition {
  id: string;
  entityType: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: 'text' | 'number' | 'select' | 'date';
  fieldOptions: string[];
  isRequired: boolean;
  displayOrder: number;
  visibleToRoles: string[];
  editableByRoles: string[];
  value?: string | null;
}

interface CustomFieldsFormProps {
  fields: CustomFieldDefinition[];
  values: Record<string, string | null>;
  onChange: (fieldKey: string, value: string | null) => void;
  userRole: string;
  disabled?: boolean;
}

export default function CustomFieldsForm({ fields, values, onChange, userRole, disabled }: CustomFieldsFormProps) {
  if (!fields || fields.length === 0) return null;

  const canEditField = (field: CustomFieldDefinition): boolean => {
    if (disabled) return false;
    if (!field.editableByRoles || field.editableByRoles.length === 0) return true;
    return field.editableByRoles.includes(userRole);
  };

  const handleChange = (fieldKey: string, value: string) => {
    onChange(fieldKey, value || null);
  };

  const renderField = (field: CustomFieldDefinition) => {
    const value = values[field.fieldKey] ?? field.value ?? '';
    const isEditable = canEditField(field);
    const inputClasses = `w-full rounded-lg border px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:text-slate-100 ${
      isEditable
        ? 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800'
        : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50'
    }`;

    switch (field.fieldType) {
      case 'text':
        return (
          <input
            type="text"
            value={value}
            onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange(field.fieldKey, e.target.value)}
            disabled={!isEditable}
            required={field.isRequired}
            className={inputClasses}
            placeholder={field.fieldLabel}
          />
        );

      case 'number':
        return (
          <input
            type="number"
            value={value}
            onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange(field.fieldKey, e.target.value)}
            disabled={!isEditable}
            required={field.isRequired}
            className={inputClasses}
            placeholder={field.fieldLabel}
            step="any"
          />
        );

      case 'date':
        return (
          <input
            type="date"
            value={value}
            onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange(field.fieldKey, e.target.value)}
            disabled={!isEditable}
            required={field.isRequired}
            className={inputClasses}
          />
        );

      case 'select':
        return (
          <select
            value={value}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => handleChange(field.fieldKey, e.target.value)}
            disabled={!isEditable}
            required={field.isRequired}
            className={inputClasses}
          >
            <option value="">-- Выберите --</option>
            {field.fieldOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Дополнительные поля</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.id} className="space-y-1">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {field.fieldLabel}
              {field.isRequired && <span className="ml-1 text-red-500">*</span>}
            </label>
            {renderField(field)}
          </div>
        ))}
      </div>
    </div>
  );
}
