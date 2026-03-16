/**
 * Layout Manager Admin Page
 * Allows admins to customize entity layouts (list, detail, edit views)
 */

import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

interface LayoutMetadata {
  entityType: string;
  layouts: {
    list?: any;
    detail?: any;
    edit?: any;
  };
}

export const LayoutManager: React.FC = () => {
  const { entityName } = useParams<{ entityName: string }>();
  const [layout, setLayout] = useState<LayoutMetadata | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'list' | 'detail' | 'edit'>('list');

  useEffect(() => {
    loadData();
  }, [entityName]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [layoutRes, fieldsRes] = await Promise.all([
        axios.get(`/api/metadata/entities/${entityName}/layout`),
        axios.get(`/api/metadata/entities/${entityName}/fields`),
      ]);
      setLayout(layoutRes.data.layout);
      setFields(Object.keys(fieldsRes.data.fields));
    } catch (error) {
      console.error('Failed to load layout:', error);
      alert('Failed to load layout data');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!layout) return;

    try {
      await axios.put(`/api/metadata/entities/${entityName}/layout`, layout);
      alert('Layout saved successfully');
    } catch (error: any) {
      console.error('Failed to save layout:', error);
      alert(error.response?.data?.error || 'Failed to save layout');
    }
  };

  const addListColumn = (fieldName: string) => {
    if (!layout) return;

    const newLayout = { ...layout };
    if (!newLayout.layouts.list) {
      newLayout.layouts.list = { columns: [] };
    }

    newLayout.layouts.list.columns.push({
      name: fieldName,
      sortable: true,
      link: fieldName === 'name',
    });

    setLayout(newLayout);
  };

  const removeListColumn = (index: number) => {
    if (!layout?.layouts.list) return;

    const newLayout = { ...layout };
    newLayout.layouts.list.columns.splice(index, 1);
    setLayout(newLayout);
  };

  const moveListColumn = (index: number, direction: 'up' | 'down') => {
    if (!layout?.layouts.list) return;

    const newLayout = { ...layout };
    const columns = newLayout.layouts.list.columns;
    const newIndex = direction === 'up' ? index - 1 : index + 1;

    if (newIndex < 0 || newIndex >= columns.length) return;

    [columns[index], columns[newIndex]] = [columns[newIndex], columns[index]];
    setLayout(newLayout);
  };

  const addDetailField = (fieldName: string) => {
    if (!layout) return;

    const newLayout = { ...layout };
    if (!newLayout.layouts.detail) {
      newLayout.layouts.detail = { rows: [] };
    }

    // Add to last row or create new row
    const rows = newLayout.layouts.detail.rows;
    if (rows.length === 0 || rows[rows.length - 1].cells.length >= 2) {
      rows.push({ cells: [{ name: fieldName, span: 6 }] });
    } else {
      rows[rows.length - 1].cells.push({ name: fieldName, span: 6 });
    }

    setLayout(newLayout);
  };

  const removeDetailField = (rowIndex: number, cellIndex: number) => {
    if (!layout?.layouts.detail) return;

    const newLayout = { ...layout };
    const rows = newLayout.layouts.detail.rows;
    rows[rowIndex].cells.splice(cellIndex, 1);

    // Remove empty rows
    if (rows[rowIndex].cells.length === 0) {
      rows.splice(rowIndex, 1);
    }

    setLayout(newLayout);
  };

  if (loading) {
    return <div className="p-4">Loading layout...</div>;
  }

  if (!layout) {
    return <div className="p-4">Layout not found</div>;
  }

  const availableFields = fields.filter(f => {
    if (activeTab === 'list') {
      return !layout.layouts.list?.columns.some((c: any) => c.name === f);
    } else if (activeTab === 'detail') {
      return !layout.layouts.detail?.rows.some((r: any) =>
        r.cells.some((c: any) => c.name === f)
      );
    }
    return true;
  });

  return (
    <div className="container-fluid p-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2>Layout Manager: {entityName}</h2>
          <button
            className="btn btn-link"
            onClick={() => window.history.back()}
          >
            <i className="fas fa-arrow-left me-2"></i>
            Back to Entity Manager
          </button>
        </div>
        <button className="btn btn-primary" onClick={handleSave}>
          <i className="fas fa-save me-2"></i>
          Save Layout
        </button>
      </div>

      <div className="row">
        <div className="col-md-9">
          <div className="card">
            <div className="card-header">
              <ul className="nav nav-tabs card-header-tabs">
                <li className="nav-item">
                  <button
                    className={`nav-link ${activeTab === 'list' ? 'active' : ''}`}
                    onClick={() => setActiveTab('list')}
                  >
                    List View
                  </button>
                </li>
                <li className="nav-item">
                  <button
                    className={`nav-link ${activeTab === 'detail' ? 'active' : ''}`}
                    onClick={() => setActiveTab('detail')}
                  >
                    Detail View
                  </button>
                </li>
                <li className="nav-item">
                  <button
                    className={`nav-link ${activeTab === 'edit' ? 'active' : ''}`}
                    onClick={() => setActiveTab('edit')}
                  >
                    Edit View
                  </button>
                </li>
              </ul>
            </div>
            <div className="card-body">
              {activeTab === 'list' && (
                <div>
                  <h5>List Columns</h5>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>Sortable</th>
                        <th>Link</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {layout.layouts.list?.columns.map((column: any, index: number) => (
                        <tr key={index}>
                          <td><code>{column.name}</code></td>
                          <td>
                            <input
                              type="checkbox"
                              checked={column.sortable}
                              onChange={(e) => {
                                const newLayout = { ...layout };
                                newLayout.layouts.list.columns[index].sortable = e.target.checked;
                                setLayout(newLayout);
                              }}
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={column.link}
                              onChange={(e) => {
                                const newLayout = { ...layout };
                                newLayout.layouts.list.columns[index].link = e.target.checked;
                                setLayout(newLayout);
                              }}
                            />
                          </td>
                          <td>
                            <div className="btn-group btn-group-sm">
                              <button
                                className="btn btn-outline-secondary"
                                onClick={() => moveListColumn(index, 'up')}
                                disabled={index === 0}
                              >
                                <i className="fas fa-arrow-up"></i>
                              </button>
                              <button
                                className="btn btn-outline-secondary"
                                onClick={() => moveListColumn(index, 'down')}
                                disabled={index === layout.layouts.list.columns.length - 1}
                              >
                                <i className="fas fa-arrow-down"></i>
                              </button>
                              <button
                                className="btn btn-outline-danger"
                                onClick={() => removeListColumn(index)}
                              >
                                <i className="fas fa-trash"></i>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'detail' && (
                <div>
                  <h5>Detail Layout</h5>
                  {layout.layouts.detail?.rows.map((row: any, rowIndex: number) => (
                    <div key={rowIndex} className="row mb-3 border-bottom pb-3">
                      {row.cells.map((cell: any, cellIndex: number) => (
                        <div key={cellIndex} className="col-md-6">
                          <div className="card">
                            <div className="card-body d-flex justify-content-between align-items-center">
                              <code>{cell.name}</code>
                              <button
                                className="btn btn-sm btn-outline-danger"
                                onClick={() => removeDetailField(rowIndex, cellIndex)}
                              >
                                <i className="fas fa-trash"></i>
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'edit' && (
                <div className="alert alert-info">
                  <i className="fas fa-info-circle me-2"></i>
                  Edit layout uses the same structure as detail layout. Customize detail layout to affect edit view.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-md-3">
          <div className="card">
            <div className="card-header">
              <h6 className="mb-0">Available Fields</h6>
            </div>
            <div className="card-body">
              <div className="list-group">
                {availableFields.map(field => (
                  <button
                    key={field}
                    className="list-group-item list-group-item-action"
                    onClick={() => {
                      if (activeTab === 'list') {
                        addListColumn(field);
                      } else if (activeTab === 'detail') {
                        addDetailField(field);
                      }
                    }}
                  >
                    <i className="fas fa-plus me-2"></i>
                    {field}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LayoutManager;
