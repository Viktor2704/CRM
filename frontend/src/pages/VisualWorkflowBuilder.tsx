import { useState, useEffect } from 'react';
import { Plus, Trash2, Settings, AlertCircle, CheckCircle, ArrowRight } from 'lucide-react';
import { api } from '../api/client';

interface WorkflowNode {
  id: string;
  nodeType: string;
  nodeName: string;
  positionX: number;
  positionY: number;
  configuration: Record<string, any>;
  executionOrder: number;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  templateConfig: Record<string, any>;
  usageCount: number;
  tags: string[];
}

interface WorkflowMetric {
  date: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  avgExecutionTimeMs: number;
}

interface WorkflowAlert {
  id: string;
  workflowId: string;
  workflowName: string | null;
  executionId: string;
  alertType: string;
  severity: string;
  message: string;
  isAcknowledged: boolean;
  createdAt: string | null;
}

const nodeTypeLabels: Record<string, string> = {
  send_email: 'Отправить Email',
  create_record: 'Создать запись',
  update_field: 'Обновить поле',
  call_api: 'Вызвать API',
  run_script: 'Выполнить скрипт',
  condition: 'Условие',
  delay: 'Задержка',
  branch: 'Ветвление',
};

const nodeTypeIcons: Record<string, string> = {
  send_email: '📧',
  create_record: '➕',
  update_field: '✏️',
  call_api: '🔗',
  run_script: '⚙️',
  condition: '❓',
  delay: '⏱️',
  branch: '🔀',
};

const VisualWorkflowBuilder: React.FC<{ workflowId: string }> = ({ workflowId }) => {
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [metrics, setMetrics] = useState<WorkflowMetric[]>([]);
  const [alerts, setAlerts] = useState<WorkflowAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [_selectedNode, setSelectedNode] = useState<WorkflowNode | null>(null);
  const [showNodeConfig, setShowNodeConfig] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [activeTab, setActiveTab] = useState<'builder' | 'metrics' | 'alerts'>('builder');

  const [nodeConfig, setNodeConfig] = useState({
    nodeType: 'send_email',
    nodeName: '',
    configuration: {} as Record<string, any>,
  });

  useEffect(() => {
    loadNodes();
    loadTemplates();
    loadMetrics();
    loadAlerts();
  }, [workflowId]);

  const loadNodes = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/workflows/${workflowId}/nodes`) as { items: WorkflowNode[] };
      setNodes(response.items || []);
    } catch (error) {
      console.error('Failed to load workflow nodes:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const response = await api.get('/workflow-templates?isPublic=true') as { items: WorkflowTemplate[] };
      setTemplates(response.items || []);
    } catch (error) {
      console.error('Failed to load templates:', error);
    }
  };

  const loadMetrics = async () => {
    try {
      const response = await api.get(`/workflows/${workflowId}/metrics?days=30`) as { items: WorkflowMetric[] };
      setMetrics(response.items || []);
    } catch (error) {
      console.error('Failed to load metrics:', error);
    }
  };

  const loadAlerts = async () => {
    try {
      const response = await api.get(`/workflow-alerts?workflowId=${workflowId}&isAcknowledged=false`) as { items: WorkflowAlert[] };
      setAlerts(response.items || []);
    } catch (error) {
      console.error('Failed to load alerts:', error);
    }
  };

  const handleAddNode = async () => {
    try {
      const newNode = {
        nodeType: nodeConfig.nodeType,
        nodeName: nodeConfig.nodeName || nodeTypeLabels[nodeConfig.nodeType],
        positionX: 100 + (nodes.length * 200),
        positionY: 100,
        configuration: nodeConfig.configuration,
        executionOrder: nodes.length,
      };

      await api.post(`/workflows/${workflowId}/nodes`, newNode);
      await loadNodes();
      setShowNodeConfig(false);
      setNodeConfig({ nodeType: 'send_email', nodeName: '', configuration: {} });
    } catch (error) {
      console.error('Failed to add node:', error);
      alert('Ошибка при добавлении узла');
    }
  };

  const _handleUpdateNode = async (nodeId: string, updates: Partial<WorkflowNode>) => {
    try {
      await api.patch(`/workflows/${workflowId}/nodes/${nodeId}`, updates);
      await loadNodes();
    } catch (error) {
      console.error('Failed to update node:', error);
      alert('Ошибка при обновлении узла');
    }
  };

  const handleDeleteNode = async (nodeId: string) => {
    if (!confirm('Удалить этот узел?')) return;

    try {
      await api.delete(`/workflows/${workflowId}/nodes/${nodeId}`);
      await loadNodes();
    } catch (error) {
      console.error('Failed to delete node:', error);
      alert('Ошибка при удалении узла');
    }
  };

  const handleAcknowledgeAlert = async (alertId: string) => {
    try {
      await api.post(`/workflow-alerts/${alertId}/acknowledge`, {});
      await loadAlerts();
    } catch (error) {
      console.error('Failed to acknowledge alert:', error);
    }
  };

  const handleCreateFromTemplate = async (templateId: string) => {
    const workflowName = prompt('Введите название workflow:');
    if (!workflowName) return;

    const entityType = prompt('Введите тип сущности (access_request, service_request, project):');
    if (!entityType) return;

    try {
      await api.post(`/workflow-templates/${templateId}/create`, {
        workflowName,
        entityType,
      });
      alert('Workflow создан из шаблона');
      setShowTemplates(false);
    } catch (error) {
      console.error('Failed to create from template:', error);
      alert('Ошибка при создании workflow');
    }
  };

  const renderNodeConfigForm = () => {
    const nodeType = nodeConfig.nodeType;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <h3 className="text-lg font-semibold mb-4">Добавить узел</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Тип узла</label>
              <select
                value={nodeConfig.nodeType}
                onChange={(e) => setNodeConfig({ ...nodeConfig, nodeType: e.target.value, configuration: {} })}
                className="w-full border rounded px-3 py-2"
              >
                {Object.entries(nodeTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {nodeTypeIcons[value]} {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Название узла</label>
              <input
                type="text"
                value={nodeConfig.nodeName}
                onChange={(e) => setNodeConfig({ ...nodeConfig, nodeName: e.target.value })}
                placeholder={nodeTypeLabels[nodeType]}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            {nodeType === 'send_email' && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Получатели</label>
                  <input
                    type="text"
                    placeholder="admin, manager, creator"
                    onChange={(e) => setNodeConfig({
                      ...nodeConfig,
                      configuration: { ...nodeConfig.configuration, recipients: e.target.value.split(',').map(r => r.trim()) }
                    })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Тема</label>
                  <input
                    type="text"
                    placeholder="{{entity.title}}"
                    onChange={(e) => setNodeConfig({
                      ...nodeConfig,
                      configuration: { ...nodeConfig.configuration, subject: e.target.value }
                    })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Сообщение</label>
                  <textarea
                    placeholder="{{entity.description}}"
                    onChange={(e) => setNodeConfig({
                      ...nodeConfig,
                      configuration: { ...nodeConfig.configuration, body: e.target.value }
                    })}
                    className="w-full border rounded px-3 py-2"
                    rows={4}
                  />
                </div>
              </>
            )}

            {nodeType === 'update_field' && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Поле</label>
                  <input
                    type="text"
                    placeholder="status"
                    onChange={(e) => setNodeConfig({
                      ...nodeConfig,
                      configuration: { ...nodeConfig.configuration, field: e.target.value }
                    })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Значение</label>
                  <input
                    type="text"
                    placeholder="completed"
                    onChange={(e) => setNodeConfig({
                      ...nodeConfig,
                      configuration: { ...nodeConfig.configuration, value: e.target.value }
                    })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
              </>
            )}

            {nodeType === 'call_api' && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Метод</label>
                  <select
                    onChange={(e) => setNodeConfig({
                      ...nodeConfig,
                      configuration: { ...nodeConfig.configuration, method: e.target.value }
                    })}
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">URL</label>
                  <input
                    type="text"
                    placeholder="https://api.example.com/endpoint"
                    onChange={(e) => setNodeConfig({
                      ...nodeConfig,
                      configuration: { ...nodeConfig.configuration, url: e.target.value }
                    })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
              </>
            )}

            {nodeType === 'condition' && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Поле</label>
                  <input
                    type="text"
                    placeholder="status"
                    onChange={(e) => setNodeConfig({
                      ...nodeConfig,
                      configuration: { ...nodeConfig.configuration, field: e.target.value }
                    })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Оператор</label>
                  <select
                    onChange={(e) => setNodeConfig({
                      ...nodeConfig,
                      configuration: { ...nodeConfig.configuration, operator: e.target.value }
                    })}
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="equals">Равно</option>
                    <option value="not_equals">Не равно</option>
                    <option value="contains">Содержит</option>
                    <option value="greater_than">Больше</option>
                    <option value="less_than">Меньше</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Значение</label>
                  <input
                    type="text"
                    onChange={(e) => setNodeConfig({
                      ...nodeConfig,
                      configuration: { ...nodeConfig.configuration, value: e.target.value }
                    })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
              </>
            )}

            {nodeType === 'delay' && (
              <div>
                <label className="block text-sm font-medium mb-1">Задержка (мс)</label>
                <input
                  type="number"
                  placeholder="1000"
                  onChange={(e) => setNodeConfig({
                    ...nodeConfig,
                    configuration: { ...nodeConfig.configuration, duration: parseInt(e.target.value) }
                  })}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-6">
            <button
              onClick={handleAddNode}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              Добавить
            </button>
            <button
              onClick={() => setShowNodeConfig(false)}
              className="flex-1 bg-gray-200 px-4 py-2 rounded hover:bg-gray-300"
            >
              Отмена
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderBuilder = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Визуальный редактор</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setShowTemplates(true)}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
          >
            <Settings size={16} />
            Шаблоны
          </button>
          <button
            onClick={() => setShowNodeConfig(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            <Plus size={16} />
            Добавить узел
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">Загрузка...</div>
      ) : nodes.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          Нет узлов. Добавьте первый узел или используйте шаблон.
        </div>
      ) : (
        <div className="border rounded-lg p-4 bg-gray-50 min-h-[400px] relative">
          {nodes.map((node, index) => (
            <div key={node.id} className="inline-block">
              <div className="bg-white border-2 border-blue-500 rounded-lg p-4 shadow-md w-64">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{nodeTypeIcons[node.nodeType]}</span>
                    <span className="font-semibold text-sm">{node.nodeName}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteNode(node.id)}
                    className="text-red-600 hover:text-red-800"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="text-xs text-gray-600">
                  {nodeTypeLabels[node.nodeType]}
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  Порядок: {node.executionOrder + 1}
                </div>
              </div>
              {index < nodes.length - 1 && (
                <div className="inline-block mx-4 text-gray-400">
                  <ArrowRight size={24} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderMetrics = () => {
    const totalExecutions = metrics.reduce((sum, m) => sum + m.totalExecutions, 0);
    const successfulExecutions = metrics.reduce((sum, m) => sum + m.successfulExecutions, 0);
    const failedExecutions = metrics.reduce((sum, m) => sum + m.failedExecutions, 0);
    const successRate = totalExecutions > 0 ? ((successfulExecutions / totalExecutions) * 100).toFixed(1) : '0';

    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Метрики выполнения</h3>

        <div className="grid grid-cols-4 gap-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-sm text-gray-600">Всего выполнений</div>
            <div className="text-2xl font-bold text-blue-600">{totalExecutions}</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="text-sm text-gray-600">Успешных</div>
            <div className="text-2xl font-bold text-green-600">{successfulExecutions}</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="text-sm text-gray-600">Ошибок</div>
            <div className="text-2xl font-bold text-red-600">{failedExecutions}</div>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="text-sm text-gray-600">Успешность</div>
            <div className="text-2xl font-bold text-purple-600">{successRate}%</div>
          </div>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-sm font-medium">Дата</th>
                <th className="px-4 py-2 text-left text-sm font-medium">Выполнений</th>
                <th className="px-4 py-2 text-left text-sm font-medium">Успешных</th>
                <th className="px-4 py-2 text-left text-sm font-medium">Ошибок</th>
                <th className="px-4 py-2 text-left text-sm font-medium">Ср. время (мс)</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric, index) => (
                <tr key={index} className="border-t">
                  <td className="px-4 py-2 text-sm">{metric.date}</td>
                  <td className="px-4 py-2 text-sm">{metric.totalExecutions}</td>
                  <td className="px-4 py-2 text-sm text-green-600">{metric.successfulExecutions}</td>
                  <td className="px-4 py-2 text-sm text-red-600">{metric.failedExecutions}</td>
                  <td className="px-4 py-2 text-sm">{metric.avgExecutionTimeMs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderAlerts = () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Оповещения</h3>

      {alerts.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <CheckCircle size={48} className="mx-auto mb-2 text-green-500" />
          Нет активных оповещений
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`border rounded-lg p-4 ${
                alert.severity === 'high' || alert.severity === 'critical'
                  ? 'bg-red-50 border-red-200'
                  : 'bg-yellow-50 border-yellow-200'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <AlertCircle
                    size={20}
                    className={alert.severity === 'high' || alert.severity === 'critical' ? 'text-red-600' : 'text-yellow-600'}
                  />
                  <div>
                    <div className="font-medium">{alert.message}</div>
                    <div className="text-sm text-gray-600 mt-1">
                      {alert.createdAt && new Date(alert.createdAt).toLocaleString('ru-RU')}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleAcknowledgeAlert(alert.id)}
                  className="text-sm px-3 py-1 bg-white border rounded hover:bg-gray-50"
                >
                  Подтвердить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderTemplates = () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">Шаблоны Workflow</h3>

        <div className="grid grid-cols-2 gap-4">
          {templates.map((template) => (
            <div key={template.id} className="border rounded-lg p-4 hover:border-blue-500 cursor-pointer">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{template.icon}</span>
                  <div>
                    <div className="font-semibold">{template.name}</div>
                    <div className="text-xs text-gray-500">{template.category}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  Использований: {template.usageCount}
                </div>
              </div>
              <div className="text-sm text-gray-600 mb-3">{template.description}</div>
              <div className="flex flex-wrap gap-1 mb-3">
                {template.tags.map((tag, index) => (
                  <span key={index} className="text-xs bg-gray-100 px-2 py-1 rounded">
                    {tag}
                  </span>
                ))}
              </div>
              <button
                onClick={() => handleCreateFromTemplate(template.id)}
                className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm"
              >
                Использовать шаблон
              </button>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <button
            onClick={() => setShowTemplates(false)}
            className="w-full bg-gray-200 px-4 py-2 rounded hover:bg-gray-300"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex gap-4 border-b">
          <button
            onClick={() => setActiveTab('builder')}
            className={`px-4 py-2 ${activeTab === 'builder' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600'}`}
          >
            Редактор
          </button>
          <button
            onClick={() => setActiveTab('metrics')}
            className={`px-4 py-2 ${activeTab === 'metrics' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600'}`}
          >
            Метрики
          </button>
          <button
            onClick={() => setActiveTab('alerts')}
            className={`px-4 py-2 flex items-center gap-2 ${activeTab === 'alerts' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600'}`}
          >
            Оповещения
            {alerts.length > 0 && (
              <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                {alerts.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {activeTab === 'builder' && renderBuilder()}
      {activeTab === 'metrics' && renderMetrics()}
      {activeTab === 'alerts' && renderAlerts()}

      {showNodeConfig && renderNodeConfigForm()}
      {showTemplates && renderTemplates()}
    </div>
  );
};

export default VisualWorkflowBuilder;
