/**
 * Field Manager Admin Page
 * Allows admins to add, edit, and remove fields from entities
 */

import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

interface Field {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
  readOnly?: boolean;
  default?: any;
  maxLength?: number;
  min?: number;
  max?: number;
  options?: any[];
  pattern?: string;
}

interface FieldType {
  name: string;
  label: string;
  category: string;
  params: Array<{
    name: string;
    type: string;
    label: string;
    required?: boolean;
    default?: any;
  }>;
}

export const FieldManager: React.FC = () => {
  const { entityName } = useParams<{ entityName: string }>();
  const [fields, setFields] = useState<Record<string, Field>>({});
  const [fieldTypes, setFieldTypes] = useState<FieldType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [formData, setFormData] = useState<Field>({
    name: '',
    type: 'varchar',
    label: '',
    required: false,
    readOnly: false,
  });

  useEffect(() => {
    loadData();
  }, [entityName]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [fieldsRes, typesRes] = await Promise.all([
        axios.get(`/api/metadata/entities/${entityName}/fields`),
        axios.get('/api/metadata/field-types'),
      ]);
      setFields(fieldsRes.data.fields);
      setFieldTypes(typesRes.data.fieldTypes);
    } catch (error) {
      console.error('Failed to load data:', error);
      alert('Failed to load field data');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post(`/api/metadata/entities/${entityName}/fields`, formData);
      alert('Field created successfully');
      setShowCreateModal(false);
      resetForm();
      loadData();
    } catch (error: any) {
      console.error('Failed to create field:', error);
      alert(error.response?.data?.error || 'Failed to create field');
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingField) return;

    try {
      const { name, type, ...updates } = formData;
      await axios.put(`/api/metadata/entities/${entityName}/fields/${editingField}`, updates);
      alert('Field updated successfully');
      setEditingField(null);
      resetForm();
      loadData();
    } catch (error: any) {
      console.error('Failed to update field:', error);
      alert(error.response?.data?.error || 'Failed to update field');
    }
  };

  const handleDelete = async (fieldName: string) => {
    if (!confirm(`Are you sure you want to delete field '${fieldName}'? This cannot be undone.`)) {
      return;
    }

    try {
      await axios.delete(`/api/metadata/entities/${entityName}/fields/${fieldName}`);
      alert('Field deleted successfully');
      loadData();
    } catch (error: any) {
      console.error('Failed to delete field:', error);
      alert(error.response?.data?.error || 'Failed to delete field');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'varchar',
      label: '',
      required: false,
      readOnly: false,
    });
  };

  const openEditModal = (fieldName: string, field: Field) => {
    setEditingField(fieldName);
    setFormData({ ...field });
  };

  const getFieldTypeLabel = (typeName: string): string => {
    const type = fieldTypes.find(t => t.name === typeName);
    return type?.label || typeName;
  };

  const getFieldTypeCategory = (typeName: string): string => {
    const type = fieldTypes.find(t => t.name === typeName);
    return type?.category || 'basic';
  };

  const _selectedFieldType = fieldTypes.find(t => t.name === formData.type);

  if (loading) {
    return <div className="p-4">Loading fields...</div>;
  }

  return (
    <div className="container-fluid p-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2>Field Manager: {entityName}</h2>
          <button
            className="btn btn-link"
            onClick={() => window.history.back()}
          >
            <i className="fas fa-arrow-left me-2"></i>
            Back to Entity Manager
          </button>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreateModal(true)}
        >
          <i className="fas fa-plus me-2"></i>
          Add Field
        </button>
      </div>

      <div className="card">
        <div className="card-body">
          <table className="table table-hover">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Label</th>
                <th>Required</th>
                <th>Read Only</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(fields).map(([fieldName, field]) => (
                <tr key={fieldName}>
                  <td><code>{fieldName}</code></td>
                  <td>
                    <span className={`badge bg-${getFieldTypeCategory(field.type) === 'basic' ? 'primary' : 'secondary'}`}>
                      {getFieldTypeLabel(field.type)}
                    </span>
                  </td>
                  <td>{field.label || fieldName}</td>
                  <td>
                    {field.required ? (
                      <i className="fas fa-check text-success"></i>
                    ) : (
                      <i className="fas fa-times text-muted"></i>
                    )}
                  </td>
                  <td>
                    {field.readOnly ? (
                      <i className="fas fa-lock text-warning"></i>
                    ) : (
                      <i className="fas fa-unlock text-muted"></i>
                    )}
                  </td>
                  <td>
                    <div className="btn-group btn-group-sm">
                      <button
                        className="btn btn-outline-primary"
                        onClick={() => openEditModal(fieldName, field)}
                      >
                        <i className="fas fa-edit"></i>
                      </button>
                      {!['id', 'createdAt', 'modifiedAt', 'deleted'].includes(fieldName) && (
                        <button
                          className="btn btn-outline-danger"
                          onClick={() => handleDelete(fieldName)}
                        >
                          <i className="fas fa-trash"></i>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <form onSubmit={handleCreate}>
                <div className="modal-header">
                  <h5 className="modal-title">Add Field</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => {
                      setShowCreateModal(false);
                      resetForm();
                    }}
                  ></button>
                </div>
                <div className="modal-body">
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Field Name *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        pattern="[a-z][a-zA-Z0-9]*"
                        required
                        placeholder="e.g., price"
                      />
                      <small className="text-muted">Must start with lowercase letter</small>
                    </div>

                    <div className="col-md-6 mb-3">
                      <label className="form-label">Field Type *</label>
                      <select
                        className="form-select"
                        value={formData.type}
                        onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                        required
                      >
                        <optgroup label="Basic">
                          {fieldTypes.filter(t => t.category === 'basic').map(type => (
                            <option key={type.name} value={type.name}>{type.label}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Advanced">
                          {fieldTypes.filter(t => t.category === 'advanced').map(type => (
                            <option key={type.name} value={type.name}>{type.label}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Relationship">
                          {fieldTypes.filter(t => t.category === 'relationship').map(type => (
                            <option key={type.name} value={type.name}>{type.label}</option>
                          ))}
                        </optgroup>
                      </select>
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Label</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.label}
                      onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                      placeholder="e.g., Price"
                    />
                  </div>

                  {/* Type-specific fields */}
                  {(formData.type === 'varchar' || formData.type === 'email' || formData.type === 'phone') && (
                    <div className="mb-3">
                      <label className="form-label">Max Length</label>
                      <input
                        type="number"
                        className="form-control"
                        value={formData.maxLength || ''}
                        onChange={(e) => setFormData({ ...formData, maxLength: parseInt(e.target.value) })}
                        placeholder="255"
                      />
                    </div>
                  )}

                  {(formData.type === 'int' || formData.type === 'float' || formData.type === 'currency') && (
                    <div className="row">
                      <div className="col-md-6 mb-3">
                        <label className="form-label">Min Value</label>
                        <input
                          type="number"
                          className="form-control"
                          value={formData.min || ''}
                          onChange={(e) => setFormData({ ...formData, min: parseFloat(e.target.value) })}
                        />
                      </div>
                      <div className="col-md-6 mb-3">
                        <label className="form-label">Max Value</label>
                        <input
                          type="number"
                          className="form-control"
                          value={formData.max || ''}
                          onChange={(e) => setFormData({ ...formData, max: parseFloat(e.target.value) })}
                        />
                      </div>
                    </div>
                  )}

                  {(formData.type === 'enum' || formData.type === 'multiEnum') && (
                    <div className="mb-3">
                      <label className="form-label">Options (one per line) *</label>
                      <textarea
                        className="form-control"
                        rows={4}
                        value={Array.isArray(formData.options) ? formData.options.join('\n') : ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          options: e.target.value.split('\n').filter(o => o.trim())
                        })}
                        required
                        placeholder="Option 1&#10;Option 2&#10;Option 3"
                      />
                    </div>
                  )}

                  <div className="row">
                    <div className="col-md-6 mb-3 form-check">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        id="required"
                        checked={formData.required}
                        onChange={(e) => setFormData({ ...formData, required: e.target.checked })}
                      />
                      <label className="form-check-label" htmlFor="required">
                        Required
                      </label>
                    </div>

                    <div className="col-md-6 mb-3 form-check">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        id="readOnly"
                        checked={formData.readOnly}
                        onChange={(e) => setFormData({ ...formData, readOnly: e.target.checked })}
                      />
                      <label className="form-check-label" htmlFor="readOnly">
                        Read Only
                      </label>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setShowCreateModal(false);
                      resetForm();
                    }}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Add Field
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingField && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <form onSubmit={handleUpdate}>
                <div className="modal-header">
                  <h5 className="modal-title">Edit Field: {editingField}</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => {
                      setEditingField(null);
                      resetForm();
                    }}
                  ></button>
                </div>
                <div className="modal-body">
                  <div className="alert alert-info">
                    <i className="fas fa-info-circle me-2"></i>
                    Field name and type cannot be changed after creation.
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Label</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.label}
                      onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                    />
                  </div>

                  {(formData.type === 'varchar' || formData.type === 'email' || formData.type === 'phone') && (
                    <div className="mb-3">
                      <label className="form-label">Max Length</label>
                      <input
                        type="number"
                        className="form-control"
                        value={formData.maxLength || ''}
                        onChange={(e) => setFormData({ ...formData, maxLength: parseInt(e.target.value) })}
                      />
                    </div>
                  )}

                  {(formData.type === 'enum' || formData.type === 'multiEnum') && (
                    <div className="mb-3">
                      <label className="form-label">Options (one per line)</label>
                      <textarea
                        className="form-control"
                        rows={4}
                        value={Array.isArray(formData.options) ? formData.options.join('\n') : ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          options: e.target.value.split('\n').filter(o => o.trim())
                        })}
                      />
                    </div>
                  )}

                  <div className="row">
                    <div className="col-md-6 mb-3 form-check">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        id="requiredEdit"
                        checked={formData.required}
                        onChange={(e) => setFormData({ ...formData, required: e.target.checked })}
                      />
                      <label className="form-check-label" htmlFor="requiredEdit">
                        Required
                      </label>
                    </div>

                    <div className="col-md-6 mb-3 form-check">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        id="readOnlyEdit"
                        checked={formData.readOnly}
                        onChange={(e) => setFormData({ ...formData, readOnly: e.target.checked })}
                      />
                      <label className="form-check-label" htmlFor="readOnlyEdit">
                        Read Only
                      </label>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setEditingField(null);
                      resetForm();
                    }}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Update
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FieldManager;
