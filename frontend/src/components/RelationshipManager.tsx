import { useState, useEffect } from 'react';
import { Link, Plus, Trash2, Network } from 'lucide-react';
import { api } from '@/api/client';

interface Relationship {
  id: string;
  sourceEntityType: string;
  sourceEntityId: string;
  targetEntityType: string;
  targetEntityId: string;
  relationshipType: string;
  relationshipStrength: number;
  isBidirectional: boolean;
  metadata?: Record<string, any>;
  createdAt: string;
}

interface RelationshipType {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  isBidirectional: boolean;
  defaultStrength: number;
  icon?: string;
  color?: string;
}

interface RelationshipManagerProps {
  entityType: string;
  entityId: string;
  onRelationshipChange?: () => void;
}

export default function RelationshipManager({
  entityType,
  entityId,
  onRelationshipChange,
}: RelationshipManagerProps) {
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [relationshipTypes, setRelationshipTypes] = useState<RelationshipType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRelationship, setNewRelationship] = useState({
    targetEntityType: '',
    targetEntityId: '',
    relationshipType: '',
    relationshipStrength: 50,
  });

  useEffect(() => {
    fetchRelationships();
    fetchRelationshipTypes();
  }, [entityType, entityId]);

  const fetchRelationships = async () => {
    try {
      setLoading(true);
      const data = await api.get(`/relationships/${entityType}/${entityId}`) as any;
      setRelationships(data.relationships);
    } catch (error) {
      console.error('Failed to fetch relationships:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchRelationshipTypes = async () => {
    try {
      const data = await api.get('/relationship-types') as any;
      setRelationshipTypes(data.types);
    } catch (error) {
      console.error('Failed to fetch relationship types:', error);
    }
  };

  const createRelationship = async () => {
    try {
      await api.post('/relationships', {
        sourceEntityType: entityType,
        sourceEntityId: entityId,
        ...newRelationship,
      });

      setShowAddForm(false);
      setNewRelationship({
        targetEntityType: '',
        targetEntityId: '',
        relationshipType: '',
        relationshipStrength: 50,
      });
      fetchRelationships();
      onRelationshipChange?.();
    } catch (error) {
      console.error('Failed to create relationship:', error);
    }
  };

  const deleteRelationship = async (relationshipId: string) => {
    if (!confirm('Удалить связь?')) return;

    try {
      await api.delete(`/relationships/${relationshipId}`);

      fetchRelationships();
      onRelationshipChange?.();
    } catch (error) {
      console.error('Failed to delete relationship:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Связи</h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          <Plus size={16} />
          Добавить связь
        </button>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <h4 className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">Новая связь</h4>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Тип связи</label>
              <select
                value={newRelationship.relationshipType}
                onChange={(e) =>
                  setNewRelationship({ ...newRelationship, relationshipType: e.target.value })
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="">Выберите тип</option>
                {relationshipTypes.map((type) => (
                  <option key={type.id} value={type.name}>
                    {type.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Тип объекта</label>
              <input
                type="text"
                value={newRelationship.targetEntityType}
                onChange={(e) =>
                  setNewRelationship({ ...newRelationship, targetEntityType: e.target.value })
                }
                placeholder="service_request, project, etc."
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">ID объекта</label>
              <input
                type="text"
                value={newRelationship.targetEntityId}
                onChange={(e) =>
                  setNewRelationship({ ...newRelationship, targetEntityId: e.target.value })
                }
                placeholder="UUID объекта"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">
                Сила связи: {newRelationship.relationshipStrength}
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={newRelationship.relationshipStrength}
                onChange={(e) =>
                  setNewRelationship({
                    ...newRelationship,
                    relationshipStrength: parseInt(e.target.value),
                  })
                }
                className="w-full"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={createRelationship}
                disabled={
                  !newRelationship.relationshipType ||
                  !newRelationship.targetEntityType ||
                  !newRelationship.targetEntityId
                }
                className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
              >
                Создать
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Relationships List */}
      {relationships.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-800">
          <Network size={48} className="mb-3 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Нет связей</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">Добавьте связь с другими объектами</p>
        </div>
      ) : (
        <div className="space-y-2">
          {relationships.map((rel) => {
            const isOutgoing =
              rel.sourceEntityType === entityType && rel.sourceEntityId === entityId;
            const relatedType = isOutgoing ? rel.targetEntityType : rel.sourceEntityType;
            const relatedId = isOutgoing ? rel.targetEntityId : rel.sourceEntityId;

            return (
              <div
                key={rel.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/30">
                    <Link size={18} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {rel.relationshipType.replace(/_/g, ' ')}
                      {rel.isBidirectional && ' ↔'}
                      {!rel.isBidirectional && (isOutgoing ? ' →' : ' ←')}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {relatedType}: {relatedId.substring(0, 8)}...
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-xs text-slate-500">
                    Сила: {rel.relationshipStrength}
                  </div>
                  <button
                    onClick={() => deleteRelationship(rel.id)}
                    className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                    title="Удалить"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
