import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Play, Pause, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../api/client';

interface WorkflowRule {
  id: string;
  name: string;
  description: string;
  entityType: string;
  triggerType: string;
  triggerConfig: Record<string, any>;
  conditions: Array<{ field: string; operator: string; value: any }>;
  actions: Array<{ type: string; channels: string[]; recipients: string[]; template: any }>;
  isActive: boolean;
  priority: number;
  createdAt: string | null;
  updatedAt: string | null;
}

interface WorkflowExecution {
  id: string;
  ruleId: string;
  ruleName: string | null;
  entityType: string;
  entityId: string;
  triggerType: string;
  status: string;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
}

const entityTypeLabels: Record<string, string> = {
  access_request: 'Заявки на доступ',
  service_request: 'Сервисные заявки',
  maintenance_plan: 'Планы ТО',
  project: 'Проекты',
};

const triggerTypeLabels: Record<string, string> = {
  creation: 'Создание',
  status_change: 'Изменение статуса',
  deadline: 'Приближение срока',
  expiry_24h: 'За 24 часа до истечения',
  expired: 'Истёк срок',
  scheduled: 'По расписанию',
};

const operatorLabels: Record<string, string> = {
  equals: 'Равно',
  not_equals: 'Не равно',
  contains: 'Содержит',
  in: 'В списке',
  not_in: 'Не в списке',
  greater_than: 'Больше',
  less_than: 'Меньше',
  is_null: 'Пусто',
  is_not_null: 'Не пусто',
};

const WorkflowAutomation: React.FC = () => {
  const [rules, setRules] = useState<WorkflowRule[]>([]);
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedRule, setSelectedRule] = useState<WorkflowRule | null>(null);
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'rules' | 'executions'>('rules');

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    entityType: 'access_request',
    triggerType: 'creation',
    triggerConfig: {},
    conditions: [] as Array<{ field: string; operator: string; value: any }>,
    actions: [] as Array<{ type: string; channels: string[]; recipients: string[]; template: any }>,
    isActive: true,
    priority: 0,
  });

  useEffect(() => {
    loadRules();
    loadExecutions();
  }, []);

  const loadRules = async () => {
    try {
      setLoading(true);
      const response = await api.get('/workflow-rules') as { items: WorkflowRule[] };
      setRules(response.items || []);
    } catch (error) {
      console.error('Failed to load workflow rules:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadExecutions = async () => {
    try {
      const response = await api.get('/workflow-executions?limit=50') as { items: WorkflowExecution[] };
      setExecutions(response.items || []);
    } catch (error) {
      console.error('Failed to load workflow executions:', error);
    }
  };

  const handleCreate = async () => {
    try {
      await api.post('/workflow-rules', formData);
      setShowCreateModal(false);
      resetForm();
      loadRules();
    } catch (error) {
      console.error('Failed to create workflow rule:', error);
      alert('Ошибка при создании правила');
    }
  };

  const handleUpdate = async () => {
    if (!selectedRule) return;
    try {
      await api.patch(`/workflow-rules/${selectedRule.id}`, formData);
      setShowEditModal(false);
      setSelectedRule(null);
      resetForm();
      loadRules();
    } catch (error) {
      console.error('Failed to update workflow rule:', error);
      alert('Ошибка при обновлении правила');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить это правило?')) return;
    try {
      await api.delete(`/workflow-rules/${id}`);
      loadRules();
    } catch (error) {
      console.error('Failed to delete workflow rule:', error);
      alert('Ошибка при удалении правила');
    }
  };

  const handleToggleActive = async (rule: WorkflowRule) => {
    try {
      await api.patch(`/workflow-rules/${rule.id}`, { isActive: !rule.isActive });
      loadRules();
    } catch (error) {
      console.error('Failed to toggle rule:', error);
      alert('Ошибка при изменении статуса правила');
    }
  };

  const openEditModal = (rule: WorkflowRule) => {
    setSelectedRule(rule);
    setFormData({
      name: rule.name,
      description: rule.description,
      entityType: rule.entityType,
      triggerType: rule.triggerType,
      triggerConfig: rule.triggerConfig,
      conditions: rule.conditions,
      actions: rule.actions,
      isActive: rule.isActive,
      priority: rule.priority,
    });
    setShowEditModal(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      entityType: 'access_request',
      triggerType: 'creation',
      triggerConfig: {},
      conditions: [],
      actions: [],
      isActive: true,
      priority: 0,
    });
  };

  const addCondition = () => {
    setFormData({
      ...formData,
      conditions: [...formData.conditions, { field: 'status', operator: 'equals', value: '' }],
    });
  };

  const updateCondition = (index: number, field: string, value: any) => {
    const newConditions = [...formData.conditions];
    newConditions[index] = { ...newConditions[index], [field]: value };
    setFormData({ ...formData, conditions: newConditions });
  };

  const removeCondition = (index: number) => {
    setFormData({
      ...formData,
      conditions: formData.conditions.filter((_, i) => i !== index),
    });
  };

  const addAction = () => {
    setFormData({
      ...formData,
      actions: [
        ...formData.actions,
        {
          type: 'notification',
          channels: ['in_app'],
          recipients: ['admin'],
          template: { title: '', body: '' },
        },
      ],
    });
  };

  const updateAction = (index: number, field: string, value: any) => {
    const newActions = [...formData.actions];
    newActions[index] = { ...newActions[index], [field]: value };
    setFormData({ ...formData, actions: newActions });
  };

  const removeAction = (index: number) => {
    setFormData({
      ...formData,
      actions: formData.actions.filter((_, i) => i !== index),
    });
  };

  const toggleChannel = (actionIndex: number, channel: string) => {
    const action = formData.actions[actionIndex];
    const channels = action.channels || [];
    const newChannels = channels.includes(channel)
      ? channels.filter(c => c !== channel)
      : [...channels, channel];
    updateAction(actionIndex, 'channels', newChannels);
  };

  const toggleRecipient = (actionIndex: number, recipient: string) => {
    const action = formData.actions[actionIndex];
    const recipients = action.recipients || [];
    const newRecipients = recipients.includes(recipient)
      ? recipients.filter(r => r !== recipient)
      : [...recipients, recipient];
    updateAction(actionIndex, 'recipients', newRecipients);
  };

  const renderRuleBuilder = () => (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-1">Название</label>
        <input
          type="text"
          value={formData.name}
          onChange={e => setFormData({ ...formData, name: e.target.value })}
          className="w-full px-3 py-2 border rounded"
          placeholder="Напоминание об истечении доступа"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Описание</label>
        <textarea
          value={formData.description}
          onChange={e => setFormData({ ...formData, description: e.target.value })}
          className="w-full px-3 py-2 border rounded"
          rows={2}
          placeholder="Отправляет уведомление за 24 часа до истечения срока"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Тип сущности</label>
          <select
            value={formData.entityType}
            onChange={e => setFormData({ ...formData, entityType: e.target.value })}
            className="w-full px-3 py-2 border rounded"
          >
            {Object.entries(entityTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Триггер</label>
          <select
            value={formData.triggerType}
            onChange={e => setFormData({ ...formData, triggerType: e.target.value })}
            className="w-full px-3 py-2 border rounded"
          >
            {Object.entries(triggerTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="block text-sm font-medium">Условия</label>
          <button
            type="button"
            onClick={addCondition}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            + Добавить условие
          </button>
        </div>
        {formData.conditions.map((condition, index) => (
          <div key={index} className="flex gap-2 mb-2">
            <input
              type="text"
              value={condition.field}
              onChange={e => updateCondition(index, 'field', e.target.value)}
              className="flex-1 px-3 py-2 border rounded"
              placeholder="Поле (status, priority)"
            />
            <select
              value={condition.operator}
              onChange={e => updateCondition(index, 'operator', e.target.value)}
              className="px-3 py-2 border rounded"
            >
              {Object.entries(operatorLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <input
              type="text"
              value={condition.value}
              onChange={e => updateCondition(index, 'value', e.target.value)}
              className="flex-1 px-3 py-2 border rounded"
              placeholder="Значение"
            />
            <button
              type="button"
              onClick={() => removeCondition(index)}
              className="px-3 py-2 text-red-600 hover:text-red-700"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="block text-sm font-medium">Действия</label>
          <button
            type="button"
            onClick={addAction}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            + Добавить действие
          </button>
        </div>
        {formData.actions.map((action, index) => (
          <div key={index} className="border rounded p-4 mb-3">
            <div className="flex justify-between items-start mb-3">
              <span className="font-medium">Уведомление</span>
              <button
                type="button"
                onClick={() => removeAction(index)}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 size={16} />
              </button>
            </div>

            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">Каналы</label>
              <div className="flex gap-3">
                {['in_app', 'email', 'telegram'].map(channel => (
                  <label key={channel} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={(action.channels || []).includes(channel)}
                      onChange={() => toggleChannel(index, channel)}
                      className="mr-2"
                    />
                    {channel === 'in_app' ? 'В приложении' : channel === 'email' ? 'Email' : 'Telegram'}
                  </label>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">Получатели</label>
              <div className="flex gap-3">
                {['admin', 'manager', 'creator', 'executors'].map(recipient => (
                  <label key={recipient} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={(action.recipients || []).includes(recipient)}
                      onChange={() => toggleRecipient(index, recipient)}
                      className="mr-2"
                    />
                    {recipient === 'admin' ? 'Админы' : recipient === 'manager' ? 'Менеджеры' : recipient === 'creator' ? 'Создатель' : 'Исполнители'}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <input
                type="text"
                value={action.template?.title || ''}
                onChange={e => updateAction(index, 'template', { ...action.template, title: e.target.value })}
                className="px-3 py-2 border rounded"
                placeholder="Заголовок уведомления"
              />
              <textarea
                value={action.template?.body || ''}
                onChange={e => updateAction(index, 'template', { ...action.template, body: e.target.value })}
                className="px-3 py-2 border rounded"
                rows={2}
                placeholder="Текст уведомления"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Приоритет</label>
          <input
            type="number"
            value={formData.priority}
            onChange={e => setFormData({ ...formData, priority: Number(e.target.value) })}
            className="w-full px-3 py-2 border rounded"
          />
        </div>

        <div className="flex items-center">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.isActive}
              onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
              className="mr-2"
            />
            <span className="text-sm font-medium">Активно</span>
          </label>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return <div className="p-6">Загрузка...</div>;
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Автоматизация рабочих процессов</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          <Plus size={20} />
          Создать правило
        </button>
      </div>

      <div className="mb-6 border-b">
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('rules')}
            className={`px-4 py-2 border-b-2 ${activeTab === 'rules' ? 'border-blue-600 text-blue-600' : 'border-transparent'}`}
          >
            Правила ({rules.length})
          </button>
          <button
            onClick={() => setActiveTab('executions')}
            className={`px-4 py-2 border-b-2 ${activeTab === 'executions' ? 'border-blue-600 text-blue-600' : 'border-transparent'}`}
          >
            История выполнения ({executions.length})
          </button>
        </div>
      </div>

      {activeTab === 'rules' && (
        <div className="space-y-4">
          {rules.map(rule => (
            <div key={rule.id} className="border rounded-lg p-4 bg-white">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold">{rule.name}</h3>
                    <span className={`px-2 py-1 text-xs rounded ${rule.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                      {rule.isActive ? 'Активно' : 'Неактивно'}
                    </span>
                    <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                      {entityTypeLabels[rule.entityType] || rule.entityType}
                    </span>
                    <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded">
                      {triggerTypeLabels[rule.triggerType] || rule.triggerType}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{rule.description}</p>
                  <div className="text-xs text-gray-500">
                    Условий: {rule.conditions.length} | Действий: {rule.actions.length} | Приоритет: {rule.priority}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleToggleActive(rule)}
                    className="p-2 text-gray-600 hover:text-gray-800"
                    title={rule.isActive ? 'Деактивировать' : 'Активировать'}
                  >
                    {rule.isActive ? <Pause size={18} /> : <Play size={18} />}
                  </button>
                  <button
                    onClick={() => openEditModal(rule)}
                    className="p-2 text-blue-600 hover:text-blue-800"
                    title="Редактировать"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    className="p-2 text-red-600 hover:text-red-800"
                    title="Удалить"
                  >
                    <Trash2 size={18} />
                  </button>
                  <button
                    onClick={() => setExpandedRule(expandedRule === rule.id ? null : rule.id)}
                    className="p-2 text-gray-600 hover:text-gray-800"
                  >
                    {expandedRule === rule.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                </div>
              </div>

              {expandedRule === rule.id && (
                <div className="mt-4 pt-4 border-t space-y-3">
                  {rule.conditions.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-2">Условия:</h4>
                      <div className="space-y-1">
                        {rule.conditions.map((cond, idx) => (
                          <div key={idx} className="text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded">
                            {cond.field} {operatorLabels[cond.operator] || cond.operator} {JSON.stringify(cond.value)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {rule.actions.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-2">Действия:</h4>
                      <div className="space-y-2">
                        {rule.actions.map((action, idx) => (
                          <div key={idx} className="text-sm bg-blue-50 px-3 py-2 rounded">
                            <div className="font-medium">Уведомление</div>
                            <div className="text-gray-700">
                              Каналы: {(action.channels || []).join(', ')} | Получатели: {(action.recipients || []).join(', ')}
                            </div>
                            {action.template?.title && <div className="text-gray-600 mt-1">"{action.template.title}"</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {rules.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              Нет правил автоматизации. Создайте первое правило.
            </div>
          )}
        </div>
      )}

      {activeTab === 'executions' && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Правило</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Сущность</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Триггер</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Статус</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Время</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {executions.map(exec => (
                <tr key={exec.id}>
                  <td className="px-4 py-3 text-sm">{exec.ruleName || exec.ruleId}</td>
                  <td className="px-4 py-3 text-sm">
                    {entityTypeLabels[exec.entityType] || exec.entityType}
                    <div className="text-xs text-gray-500">{exec.entityId.slice(0, 8)}</div>
                  </td>
                  <td className="px-4 py-3 text-sm">{triggerTypeLabels[exec.triggerType] || exec.triggerType}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded ${
                      exec.status === 'completed' ? 'bg-green-100 text-green-800' :
                      exec.status === 'failed' ? 'bg-red-100 text-red-800' :
                      exec.status === 'running' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {exec.status}
                    </span>
                    {exec.errorMessage && (
                      <div className="text-xs text-red-600 mt-1">{exec.errorMessage}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {exec.createdAt ? new Date(exec.createdAt).toLocaleString('ru-RU') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {executions.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              Нет записей о выполнении
            </div>
          )}
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-xl font-bold mb-4">Создать правило автоматизации</h2>
              {renderRuleBuilder()}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    resetForm();
                  }}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Отмена
                </button>
                <button
                  onClick={handleCreate}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Создать
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-xl font-bold mb-4">Редактировать правило</h2>
              {renderRuleBuilder()}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    setSelectedRule(null);
                    resetForm();
                  }}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Отмена
                </button>
                <button
                  onClick={handleUpdate}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowAutomation;
