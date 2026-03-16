/**
 * Dynamic Form Component
 * Renders forms dynamically based on entity metadata
 */

import React, { useState, useEffect } from 'react';

// Frontend types (duplicated from backend to avoid cross-boundary imports)
type EntityFieldMetadata = {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
  defaultValue?: any;
  validation?: any;
  conditionalLogic?: ConditionalLogic;
  [key: string]: any;
};

type ConditionalLogic = {
  operator?: 'and' | 'or';
  conditions?: Array<{ field: string; operator: string; value: any }>;
  show?: Array<{ field: string; operator: string; value: any }>;
  hide?: Array<{ field: string; operator: string; value: any }>;
  require?: Array<{ field: string; operator: string; value: any }>;
};

type EntityMetadata = {
  name: string;
  fields: EntityFieldMetadata[];
  [key: string]: any;
};

interface DynamicFormProps {
  entityType: string;
  metadata: EntityMetadata;
  initialData?: Record<string, any>;
  onSubmit: (data: Record<string, any>) => void | Promise<void>;
  onCancel?: () => void;
  mode?: 'create' | 'edit' | 'view';
}

export const DynamicForm: React.FC<DynamicFormProps> = ({
  entityType,
  metadata,
  initialData = {},
  onSubmit,
  onCancel,
  mode = 'create',
}) => {
  const [formData, setFormData] = useState<Record<string, any>>(initialData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const isReadOnly = mode === 'view';

  // Update form data when initial data changes
  useEffect(() => {
    setFormData(initialData);
  }, [initialData]);

  // Check if field should be visible based on conditional logic
  const isFieldVisible = (field: EntityFieldMetadata): boolean => {
    if (!field.visibleIf) return true;
    return evaluateConditionalLogic(field.visibleIf, formData);
  };

  // Check if field should be required based on conditional logic
  const isFieldRequired = (field: EntityFieldMetadata): boolean => {
    if (field.requiredIf) {
      return evaluateConditionalLogic(field.requiredIf, formData);
    }
    return field.required || false;
  };

  // Check if field should be read-only based on conditional logic
  const isFieldReadOnly = (field: EntityFieldMetadata): boolean => {
    if (isReadOnly) return true;
    if (field.readOnly) return true;
    if (field.readOnlyIf) {
      return evaluateConditionalLogic(field.readOnlyIf, formData);
    }
    return false;
  };

  // Evaluate conditional logic
  const evaluateConditionalLogic = (logic: ConditionalLogic, data: Record<string, any>): boolean => {
    const conditions = logic.conditions || [];
    const results = conditions.map((condition: any) => {
      const fieldValue = data[condition.field];

      switch (condition.operator) {
        case 'equals':
          return fieldValue === condition.value;
        case 'notEquals':
          return fieldValue !== condition.value;
        case 'in':
          return Array.isArray(condition.value) && condition.value.includes(fieldValue);
        case 'notIn':
          return Array.isArray(condition.value) && !condition.value.includes(fieldValue);
        case 'isEmpty':
          return !fieldValue || fieldValue === '' || (Array.isArray(fieldValue) && fieldValue.length === 0);
        case 'isNotEmpty':
          return !!fieldValue && fieldValue !== '' && (!Array.isArray(fieldValue) || fieldValue.length > 0);
        case 'greaterThan':
          return Number(fieldValue) > Number(condition.value);
        case 'lessThan':
          return Number(fieldValue) < Number(condition.value);
        default:
          return false;
      }
    });

    return (logic.operator || 'and') === 'and'
      ? results.every((r: any) => r)
      : results.some((r: any) => r);
  };

  // Validate field
  const validateField = (field: EntityFieldMetadata, value: any): string | null => {
    if (isFieldRequired(field) && (!value || value === '')) {
      return `${field.label || field.name} is required`;
    }

    if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return 'Invalid email format';
    }

    if (field.type === 'url' && value && !/^https?:\/\/.+/.test(value)) {
      return 'Invalid URL format';
    }

    if (field.pattern && value && !new RegExp(field.pattern).test(value)) {
      return `Invalid format for ${field.label || field.name}`;
    }

    if (field.maxLength && value && value.length > field.maxLength) {
      return `Maximum length is ${field.maxLength}`;
    }

    if (field.min !== undefined && value < field.min) {
      return `Minimum value is ${field.min}`;
    }

    if (field.max !== undefined && value > field.max) {
      return `Maximum value is ${field.max}`;
    }

    return null;
  };

  // Handle field change
  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));

    // Clear error for this field
    if (errors[fieldName]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[fieldName];
        return newErrors;
      });
    }
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all visible fields
    const newErrors: Record<string, string> = {};
    for (const [fieldName, field] of Object.entries(metadata.fields)) {
      if (isFieldVisible(field) && !field.notStorable) {
        const error = validateField(field, formData[fieldName]);
        if (error) {
          newErrors[fieldName] = error;
        }
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    try {
      await onSubmit(formData);
    } catch (error) {
      console.error('Form submission error:', error);
    } finally {
      setLoading(false);
    }
  };

  // Render field based on type
  const renderField = (fieldName: string, field: EntityFieldMetadata) => {
    if (!isFieldVisible(field)) return null;
    if (field.layoutDetailDisabled && mode === 'view') return null;

    const value = formData[fieldName] ?? field.default ?? '';
    const readOnly = isFieldReadOnly(field);
    const required = isFieldRequired(field);
    const error = errors[fieldName];

    const commonProps = {
      id: fieldName,
      name: fieldName,
      disabled: readOnly || loading,
      required,
      className: `form-control ${error ? 'is-invalid' : ''}`,
    };

    let input: React.ReactNode;

    switch (field.type) {
      case 'varchar':
      case 'email':
      case 'phone':
      case 'url':
      case 'barcode':
        input = (
          <input
            {...commonProps}
            type={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'}
            value={value}
            onChange={(e) => handleFieldChange(fieldName, e.target.value)}
            maxLength={field.maxLength}
            pattern={field.pattern}
          />
        );
        break;

      case 'text':
      case 'wysiwyg':
        input = (
          <textarea
            {...commonProps}
            value={value}
            onChange={(e) => handleFieldChange(fieldName, e.target.value)}
            rows={4}
          />
        );
        break;

      case 'int':
      case 'float':
      case 'currency':
      case 'autoincrement':
        input = (
          <input
            {...commonProps}
            type="number"
            value={value}
            onChange={(e) => handleFieldChange(fieldName, parseFloat(e.target.value))}
            min={field.min}
            max={field.max}
            step={field.type === 'int' ? 1 : 0.01}
          />
        );
        break;

      case 'bool':
        input = (
          <div className="form-check">
            <input
              {...commonProps}
              type="checkbox"
              className="form-check-input"
              checked={!!value}
              onChange={(e) => handleFieldChange(fieldName, e.target.checked)}
            />
          </div>
        );
        break;

      case 'date':
        input = (
          <input
            {...commonProps}
            type="date"
            value={value}
            onChange={(e) => handleFieldChange(fieldName, e.target.value)}
          />
        );
        break;

      case 'datetime':
      case 'datetimeOptional':
        input = (
          <input
            {...commonProps}
            type="datetime-local"
            value={value}
            onChange={(e) => handleFieldChange(fieldName, e.target.value)}
          />
        );
        break;

      case 'enum':
        input = (
          <select
            {...commonProps}
            value={value}
            onChange={(e) => handleFieldChange(fieldName, e.target.value)}
          >
            <option value="">-- Select --</option>
            {field.options?.map((option: any) => {
              const optValue = typeof option === 'string' ? option : option.value;
              const optLabel = typeof option === 'string' ? option : option.label;
              return (
                <option key={optValue} value={optValue}>
                  {optLabel}
                </option>
              );
            })}
          </select>
        );
        break;

      case 'multiEnum':
        input = (
          <select
            {...commonProps}
            multiple
            value={Array.isArray(value) ? value : []}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions, option => option.value);
              handleFieldChange(fieldName, selected);
            }}
          >
            {field.options?.map((option: any) => {
              const optValue = typeof option === 'string' ? option : option.value;
              const optLabel = typeof option === 'string' ? option : option.label;
              return (
                <option key={optValue} value={optValue}>
                  {optLabel}
                </option>
              );
            })}
          </select>
        );
        break;

      default:
        input = (
          <input
            {...commonProps}
            type="text"
            value={value}
            onChange={(e) => handleFieldChange(fieldName, e.target.value)}
          />
        );
    }

    return (
      <div key={fieldName} className="mb-3">
        <label htmlFor={fieldName} className="form-label">
          {field.label || fieldName}
          {required && <span className="text-danger">*</span>}
        </label>
        {input}
        {error && <div className="invalid-feedback d-block">{error}</div>}
      </div>
    );
  };

  // Group fields into rows (2 columns)
  const renderFields = () => {
    const fields = Object.entries(metadata.fields).filter(
      ([_, field]) => !field.layoutDetailDisabled || mode !== 'view'
    );

    const rows: JSX.Element[] = [];
    for (let i = 0; i < fields.length; i += 2) {
      const [name1, field1] = fields[i];
      const field1Element = renderField(name1, field1);

      let field2Element = null;
      if (i + 1 < fields.length) {
        const [name2, field2] = fields[i + 1];
        field2Element = renderField(name2, field2);
      }

      rows.push(
        <div key={i} className="row">
          <div className="col-md-6">{field1Element}</div>
          <div className="col-md-6">{field2Element}</div>
        </div>
      );
    }

    return rows;
  };

  return (
    <form onSubmit={handleSubmit} className="dynamic-form">
      <h3>{mode === 'create' ? 'Create' : mode === 'edit' ? 'Edit' : 'View'} {metadata.labelSingular || entityType}</h3>

      {renderFields()}

      {!isReadOnly && (
        <div className="mt-4 d-flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Saving...' : 'Save'}
          </button>
          {onCancel && (
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>
              Cancel
            </button>
          )}
        </div>
      )}
    </form>
  );
};

export default DynamicForm;
