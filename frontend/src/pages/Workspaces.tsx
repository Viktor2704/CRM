import React, { useState, useEffect } from 'react';
import axios from 'axios';
import WorkspaceBuilder from '../components/WorkspaceBuilder';

interface Workspace {
  id: string;
  name: string;
  description?: string;
  type: 'personal' | 'team' | 'role_based';
  is_default: boolean;
  layout: any;
  created_at: string;
}

export default function Workspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [templates, setTemplates] = useState<Workspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWorkspaces();
    loadTemplates();
  }, []);

  const loadWorkspaces = async () => {
    try {
      const response = await axios.get('/api/workspaces');
      setWorkspaces(response.data.workspaces);
    } catch (err) {
      console.error('Failed to load workspaces:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const response = await axios.get('/api/workspaces/templates');
      setTemplates(response.data.templates);
    } catch (err) {
      console.error('Failed to load templates:', err);
    }
  };

  const createWorkspace = async (data: any) => {
    try {
      const response = await axios.post('/api/workspaces', data);
      setWorkspaces([...workspaces, response.data.workspace]);
      setShowCreateModal(false);
    } catch (err) {
      console.error('Failed to create workspace:', err);
    }
  };

  const cloneFromTemplate = async (templateId: string, name: string) => {
    try {
      const response = await axios.post('/api/workspaces/clone', {
        template_id: templateId,
        name,
      });
      setWorkspaces([...workspaces, response.data.workspace]);
    } catch (err) {
      console.error('Failed to clone workspace:', err);
    }
  };

  const deleteWorkspace = async (workspaceId: string) => {
    if (!confirm('Вы уверены, что хотите удалить это рабочее пространство?')) return;

    try {
      await axios.delete(`/api/workspaces/${workspaceId}`);
      setWorkspaces(workspaces.filter(w => w.id !== workspaceId));
      if (selectedWorkspace?.id === workspaceId) {
        setSelectedWorkspace(null);
        setShowBuilder(false);
      }
    } catch (err) {
      console.error('Failed to delete workspace:', err);
    }
  };

  const setAsDefault = async (workspaceId: string) => {
    try {
      await axios.post(`/api/workspaces/${workspaceId}/set-default`);
      setWorkspaces(workspaces.map(w => ({
        ...w,
        is_default: w.id === workspaceId,
      })));
    } catch (err) {
      console.error('Failed to set default workspace:', err);
    }
  };

  const saveLayout = async (layout: any) => {
    if (!selectedWorkspace) return;

    try {
      await axios.put(`/api/workspaces/${selectedWorkspace.id}`, { layout });
      setWorkspaces(workspaces.map(w =>
        w.id === selectedWorkspace.id ? { ...w, layout } : w
      ));
      alert('Макет сохранен успешно!');
    } catch (err) {
      console.error('Failed to save layout:', err);
      alert('Не удалось сохранить макет');
    }
  };

  if (loading) {
    return <div className="loading">Загрузка...</div>;
  }

  if (showBuilder && selectedWorkspace) {
    return (
      <div className="workspace-page">
        <div className="page-header">
          <button onClick={() => setShowBuilder(false)} className="back-btn">
            ← Назад к списку
          </button>
          <h1>{selectedWorkspace.name}</h1>
        </div>
        <WorkspaceBuilder
          workspaceId={selectedWorkspace.id}
          initialLayout={selectedWorkspace.layout}
          onSave={saveLayout}
        />
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <div className="page-header">
        <h1>Рабочие пространства</h1>
        <button onClick={() => setShowCreateModal(true)} className="btn btn-primary">
          + Создать пространство
        </button>
      </div>

      <div className="workspaces-grid">
        {workspaces.map((workspace) => (
          <div key={workspace.id} className="workspace-card">
            <div className="card-header">
              <h3>{workspace.name}</h3>
              {workspace.is_default && <span className="default-badge">По умолчанию</span>}
            </div>
            {workspace.description && (
              <p className="card-description">{workspace.description}</p>
            )}
            <div className="card-meta">
              <span className="workspace-type">
                {workspace.type === 'personal' ? '👤 Личное' :
                 workspace.type === 'team' ? '👥 Командное' : '🎭 Ролевое'}
              </span>
            </div>
            <div className="card-actions">
              <button
                onClick={() => {
                  setSelectedWorkspace(workspace);
                  setShowBuilder(true);
                }}
                className="btn btn-secondary"
              >
                Редактировать
              </button>
              {!workspace.is_default && (
                <button
                  onClick={() => setAsDefault(workspace.id)}
                  className="btn btn-link"
                >
                  Сделать основным
                </button>
              )}
              <button
                onClick={() => deleteWorkspace(workspace.id)}
                className="btn btn-danger"
              >
                Удалить
              </button>
            </div>
          </div>
        ))}
      </div>

      {templates.length > 0 && (
        <div className="templates-section">
          <h2>Шаблоны</h2>
          <div className="templates-grid">
            {templates.map((template) => (
              <div key={template.id} className="template-card">
                <h3>{template.name}</h3>
                {template.description && <p>{template.description}</p>}
                <button
                  onClick={() => {
                    const name = prompt('Название нового пространства:', template.name);
                    if (name) cloneFromTemplate(template.id, name);
                  }}
                  className="btn btn-secondary"
                >
                  Использовать шаблон
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreateModal && (
        <CreateWorkspaceModal
          onClose={() => setShowCreateModal(false)}
          onCreate={createWorkspace}
        />
      )}

      <style>{`
        .workspace-page {
          padding: 2rem;
          max-width: 1400px;
          margin: 0 auto;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
        }

        .page-header h1 {
          margin: 0;
          font-size: 2rem;
          font-weight: 700;
        }

        .back-btn {
          background: none;
          border: none;
          font-size: 1rem;
          cursor: pointer;
          color: #3b82f6;
          padding: 0.5rem;
        }

        .workspaces-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 1.5rem;
          margin-bottom: 3rem;
        }

        .workspace-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          padding: 1.5rem;
          transition: box-shadow 0.2s;
        }

        .workspace-card:hover {
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }

        .card-header h3 {
          margin: 0;
          font-size: 1.25rem;
          font-weight: 600;
        }

        .default-badge {
          background: #10b981;
          color: white;
          padding: 0.25rem 0.5rem;
          border-radius: 0.25rem;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .card-description {
          color: #6b7280;
          margin-bottom: 1rem;
        }

        .card-meta {
          margin-bottom: 1rem;
        }

        .workspace-type {
          font-size: 0.875rem;
          color: #6b7280;
        }

        .card-actions {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .templates-section {
          margin-top: 3rem;
        }

        .templates-section h2 {
          margin-bottom: 1rem;
          font-size: 1.5rem;
          font-weight: 600;
        }

        .templates-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 1rem;
        }

        .template-card {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          padding: 1rem;
        }

        .template-card h3 {
          margin: 0 0 0.5rem 0;
          font-size: 1rem;
          font-weight: 600;
        }

        .template-card p {
          color: #6b7280;
          font-size: 0.875rem;
          margin-bottom: 1rem;
        }

        .btn {
          padding: 0.5rem 1rem;
          border-radius: 0.375rem;
          border: none;
          cursor: pointer;
          font-weight: 500;
          transition: all 0.2s;
        }

        .btn-primary {
          background: #3b82f6;
          color: white;
        }

        .btn-primary:hover {
          background: #2563eb;
        }

        .btn-secondary {
          background: #f3f4f6;
          color: #374151;
        }

        .btn-secondary:hover {
          background: #e5e7eb;
        }

        .btn-link {
          background: none;
          color: #3b82f6;
          padding: 0.5rem;
        }

        .btn-link:hover {
          text-decoration: underline;
        }

        .btn-danger {
          background: #fee2e2;
          color: #dc2626;
        }

        .btn-danger:hover {
          background: #fecaca;
        }

        .loading {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 400px;
          color: #6b7280;
        }
      `}</style>
    </div>
  );
}

function CreateWorkspaceModal({ onClose, onCreate }: any) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: 'personal' as 'personal' | 'team' | 'role_based',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(formData);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Создать рабочее пространство</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Название</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="form-control"
            />
          </div>
          <div className="form-group">
            <label>Описание</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="form-control"
              rows={3}
            />
          </div>
          <div className="form-group">
            <label>Тип</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
              className="form-control"
            >
              <option value="personal">Личное</option>
              <option value="team">Командное</option>
              <option value="role_based">Ролевое</option>
            </select>
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Отмена
            </button>
            <button type="submit" className="btn btn-primary">
              Создать
            </button>
          </div>
        </form>

        <style>{`
          .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
          }

          .modal-content {
            background: white;
            border-radius: 0.5rem;
            padding: 2rem;
            max-width: 500px;
            width: 90%;
          }

          .modal-content h2 {
            margin: 0 0 1.5rem 0;
            font-size: 1.5rem;
            font-weight: 600;
          }

          .form-group {
            margin-bottom: 1rem;
          }

          .form-group label {
            display: block;
            margin-bottom: 0.25rem;
            font-weight: 500;
          }

          .form-control {
            width: 100%;
            padding: 0.5rem;
            border: 1px solid #e5e7eb;
            border-radius: 0.375rem;
          }

          .modal-actions {
            display: flex;
            gap: 0.5rem;
            justify-content: flex-end;
            margin-top: 1.5rem;
          }

          .btn {
            padding: 0.5rem 1rem;
            border-radius: 0.375rem;
            border: none;
            cursor: pointer;
            font-weight: 500;
          }

          .btn-primary {
            background: #3b82f6;
            color: white;
          }

          .btn-secondary {
            background: #f3f4f6;
            color: #374151;
          }
        `}</style>
      </div>
    </div>
  );
}
