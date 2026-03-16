/**
 * Entity Manager Admin Page
 * Allows admins to create, edit, and delete custom entities
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';

interface Entity {
  name: string;
  type: string;
  labelSingular?: string;
  labelPlural?: string;
  color?: string;
  iconClass?: string;
  stream?: boolean;
  disabled?: boolean;
  isCustom?: boolean;
  createdAt?: string;
  modifiedAt?: string;
}

export const EntityManager: React.FC = () => {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingEntity, setEditingEntity] = useState<Entity | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: 'BasePlus',
    labelSingular: '',
    labelPlural: '',
    color: '#3498db',
    iconClass: 'fa-cube',
    stream: false,
  });

  useEffect(() => {
    loadEntities();
  }, []);

  const loadEntities = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/metadata/entities');
      setEntities(response.data.entities);
    } catch (error) {
      console.error('Failed to load entities:', error);
      alert('Failed to load entities');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post('/api/metadata/entities', formData);
      alert('Entity created successfully');
      setShowCreateModal(false);
      resetForm();
      loadEntities();
    } catch (error: any) {
      console.error('Failed to create entity:', error);
      alert(error.response?.data?.error || 'Failed to create entity');
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntity) return;

    try {
      await axios.put(`/api/metadata/entities/${editingEntity.name}`, {
        labelSingular: formData.labelSingular,
        labelPlural: formData.labelPlural,
        color: formData.color,
        iconClass: formData.iconClass,
        stream: formData.stream,
      });
      alert('Entity updated successfully');
      setEditingEntity(null);
      resetForm();
      loadEntities();
    } catch (error: any) {
      console.error('Failed to update entity:', error);
      alert(error.response?.data?.error || 'Failed to update entity');
    }
  };

  const handleDelete = async (entityName: string) => {
    if (!confirm(`Are you sure you want to delete entity '${entityName}'? This cannot be undone.`)) {
      return;
    }

    try {
      await axios.delete(`/api/metadata/entities/${entityName}`);
      alert('Entity deleted successfully');
      loadEntities();
    } catch (error: any) {
      console.error('Failed to delete entity:', error);
      alert(error.response?.data?.error || 'Failed to delete entity');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'BasePlus',
      labelSingular: '',
      labelPlural: '',
      color: '#3498db',
      iconClass: 'fa-cube',
      stream: false,
    });
  };

  const openEditModal = (entity: Entity) => {
    setEditingEntity(entity);
    setFormData({
      name: entity.name,
      type: entity.type,
      labelSingular: entity.labelSingular || '',
      labelPlural: entity.labelPlural || '',
      color: entity.color || '#3498db',
      iconClass: entity.iconClass || 'fa-cube',
      stream: entity.stream || false,
    });
  };

  if (loading) {
    return <div className="p-4">Loading entities...</div>;
  }

  return (
    <div className="container-fluid p-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>Entity Manager</h2>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreateModal(true)}
        >
          <i className="fas fa-plus me-2"></i>
          Create Entity
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
                <th>Custom</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entities.map((entity) => (
                <tr key={entity.name}>
                  <td>
                    <i className={`fas ${entity.iconClass || 'fa-cube'} me-2`} style={{ color: entity.color }}></i>
                    {entity.name}
                  </td>
                  <td>{entity.type}</td>
                  <td>{entity.labelSingular || entity.name}</td>
                  <td>
                    {entity.isCustom ? (
                      <span className="badge bg-success">Custom</span>
                    ) : (
                      <span className="badge bg-secondary">Built-in</span>
                    )}
                  </td>
                  <td>
                    {entity.disabled ? (
                      <span className="badge bg-danger">Disabled</span>
                    ) : (
                      <span className="badge bg-success">Active</span>
                    )}
                  </td>
                  <td>
                    <div className="btn-group btn-group-sm">
                      <button
                        className="btn btn-outline-primary"
                        onClick={() => openEditModal(entity)}
                      >
                        <i className="fas fa-edit"></i>
                      </button>
                      <button
                        className="btn btn-outline-secondary"
                        onClick={() => window.location.href = `/admin/field-manager/${entity.name}`}
                      >
                        <i className="fas fa-list"></i> Fields
                      </button>
                      <button
                        className="btn btn-outline-info"
                        onClick={() => window.location.href = `/admin/layout-manager/${entity.name}`}
                      >
                        <i className="fas fa-th"></i> Layout
                      </button>
                      {entity.isCustom && (
                        <button
                          className="btn btn-outline-danger"
                          onClick={() => handleDelete(entity.name)}
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
          <div className="modal-dialog">
            <div className="modal-content">
              <form onSubmit={handleCreate}>
                <div className="modal-header">
                  <h5 className="modal-title">Create Entity</h5>
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
                  <div className="mb-3">
                    <label className="form-label">Name *</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      pattern="[A-Z][a-zA-Z0-9]*"
                      required
                      placeholder="e.g., Product"
                    />
                    <small className="text-muted">Must start with uppercase letter</small>
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Type *</label>
                    <select
                      className="form-select"
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                      required
                    >
                      <option value="Base">Base</option>
                      <option value="BasePlus">Base Plus</option>
                      <option value="Person">Person</option>
                      <option value="Company">Company</option>
                      <option value="Event">Event</option>
                      <option value="CategoryTree">Category Tree</option>
                      <option value="Custom">Custom</option>
                    </select>
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Label (Singular)</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.labelSingular}
                      onChange={(e) => setFormData({ ...formData, labelSingular: e.target.value })}
                      placeholder="e.g., Product"
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Label (Plural)</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.labelPlural}
                      onChange={(e) => setFormData({ ...formData, labelPlural: e.target.value })}
                      placeholder="e.g., Products"
                    />
                  </div>

                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Color</label>
                      <input
                        type="color"
                        className="form-control form-control-color"
                        value={formData.color}
                        onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      />
                    </div>

                    <div className="col-md-6 mb-3">
                      <label className="form-label">Icon Class</label>
                      <input
                        type="text"
                        className="form-control"
                        value={formData.iconClass}
                        onChange={(e) => setFormData({ ...formData, iconClass: e.target.value })}
                        placeholder="fa-cube"
                      />
                    </div>
                  </div>

                  <div className="mb-3 form-check">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      id="stream"
                      checked={formData.stream}
                      onChange={(e) => setFormData({ ...formData, stream: e.target.checked })}
                    />
                    <label className="form-check-label" htmlFor="stream">
                      Enable Stream (Activity Feed)
                    </label>
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
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingEntity && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <form onSubmit={handleUpdate}>
                <div className="modal-header">
                  <h5 className="modal-title">Edit Entity: {editingEntity.name}</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => {
                      setEditingEntity(null);
                      resetForm();
                    }}
                  ></button>
                </div>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label">Label (Singular)</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.labelSingular}
                      onChange={(e) => setFormData({ ...formData, labelSingular: e.target.value })}
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Label (Plural)</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.labelPlural}
                      onChange={(e) => setFormData({ ...formData, labelPlural: e.target.value })}
                    />
                  </div>

                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Color</label>
                      <input
                        type="color"
                        className="form-control form-control-color"
                        value={formData.color}
                        onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      />
                    </div>

                    <div className="col-md-6 mb-3">
                      <label className="form-label">Icon Class</label>
                      <input
                        type="text"
                        className="form-control"
                        value={formData.iconClass}
                        onChange={(e) => setFormData({ ...formData, iconClass: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="mb-3 form-check">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      id="streamEdit"
                      checked={formData.stream}
                      onChange={(e) => setFormData({ ...formData, stream: e.target.checked })}
                    />
                    <label className="form-check-label" htmlFor="streamEdit">
                      Enable Stream (Activity Feed)
                    </label>
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setEditingEntity(null);
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

export default EntityManager;
