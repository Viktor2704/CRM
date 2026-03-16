import { useState, useEffect, useCallback } from 'react';
import { Filter, LayoutGrid, List, Save, X } from 'lucide-react';
import AdvancedFilterBuilder from '@/components/AdvancedFilterBuilder';
import KanbanBoard from '@/components/KanbanBoard';
import BulkOperations from '@/components/BulkOperations';
import Modal from '@/components/Modal';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { useAdvancedFilters } from '@/hooks/useAdvancedFilters';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { FieldType, type KanbanColumn } from '@/types/filters';

interface ServiceRequest {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  type: string;
  systemType?: string;
  createdAt: string;
  [key: string]: unknown;
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  triage: 'Сортировка',
  assigned: 'Назначена',
  in_progress: 'В работе',
  on_site: 'На объекте',
  review: 'На проверке',
  done: 'Выполнена',
  closed: 'Закрыта',
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Критический',
  high: 'Высоки��',
  medium: 'Средний',
  low: 'Низкий',
};

const FIELD_DEFINITIONS = [
  {
    name: 'status',
    label: 'Статус',
    type: FieldType.SELECT,
    options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
  },
  {
    name: 'priority',
    label: 'Приоритет',
    type: FieldType.SELECT,
    options: Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label })),
  },
  {
    name: 'type',
    label: 'Тип',
    type: FieldType.SELECT,
    options: [
      { value: 'emergency', label: 'Аварийная' },
      { value: 'operation', label: 'Эксплуатация' },
      { value: 'maintenance_planned', label: 'Плановое ТО' },
    ],
  },
  { name: 'title', label: 'Название', type: FieldType.TEXT },
  { name: 'createdAt', label: 'Дата создания', type: FieldType.DATE },
];

export default function AdvancedFilteringDemo() {
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [showFilterBuilder, setShowFilterBuilder] = useState(false);
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetDescription, setPresetDescription] = useState('');
  const [_isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();

  const {
    filterGroup,
    setFilterGroup,
    presets,
    savePreset,
    loadPreset,
    deletePreset,
    clearFilters,
  } = useAdvancedFilters({
    entityType: 'service_request',
    onFilterChange: (group) => {
      loadRequests(group);
    },
  });

  const {
    selectedItems,
    toggleItem,
    toggleAll,
    clearSelection,
    isSelected,
    isAllSelected,
  } = useBulkSelection<ServiceRequest>();

  const loadRequests = useCallback(async (filterGroupParam = filterGroup) => {
    setIsLoading(true);
    try {
      const body = filterGroupParam ? { filterGroup: filterGroupParam } : {};
      const response = await api.post('/service-requests/filter', body) as any;
      setRequests(response.items || []);
    } catch (error) {
      showToast('Ошибка загрузки заявок', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [filterGroup, showToast]);

  useEffect(() => {
    loadRequests();
  }, []);

  const handleSavePreset = async () => {
    try {
      await savePreset(presetName, presetDescription);
      showToast('Фильтр сохранен', 'success');
      setShowSavePreset(false);
      setPresetName('');
      setPresetDescription('');
    } catch (error) {
      showToast('Ошибка сохранения фильтра', 'error');
    }
  };

  const _handleDeletePreset = async (presetId: string) => {
    try {
      await deletePreset(presetId);
      showToast('Фильтр удален', 'success');
    } catch (error) {
      showToast('Ошибка удаления фильтра', 'error');
    }
  };

  const handleBulkUpdate = async (updates: Record<string, unknown>) => {
    try {
      await api.post('/service-requests/bulk', {
        action: 'update',
        selectedIds: Array.from(selectedItems.map((i) => i.id)),
        data: updates,
      });
      showToast('Заявки обновлены', 'success');
      loadRequests();
    } catch (error) {
      showToast('Ошибка обновления заявок', 'error');
    }
  };

  const handleBulkDelete = async () => {
    try {
      await api.post('/service-requests/bulk', {
        action: 'delete',
        selectedIds: Array.from(selectedItems.map((i) => i.id)),
      });
      showToast('Заявки удалены', 'success');
      loadRequests();
    } catch (error) {
      showToast('Ошибка удаления заявок', 'error');
    }
  };

  const handleBulkExport = async () => {
    try {
      const response = await api.post('/service-requests/bulk', {
        action: 'export',
        selectedIds: Array.from(selectedItems.map((i) => i.id)),
      }) as any;
      // Convert to CSV and download
      const csv = convertToCSV(response.data);
      downloadCSV(csv, 'service-requests.csv');
      showToast('Экспорт завершен', 'success');
    } catch (error) {
      showToast('Ошибка экспорта', 'error');
    }
  };

  const getKanbanColumns = (): KanbanColumn[] => {
    const statusGroups = Object.entries(STATUS_LABELS).map(([value, label]) => ({
      id: value,
      title: label,
      value,
      items: requests.filter((r) => r.status === value),
    }));
    return statusGroups;
  };

  const handleItemMove = async (itemId: string, _fromColumn: string, toColumn: string) => {
    try {
      await api.put(`/api/service-requests/${itemId}`, { status: toColumn });
      showToast('Статус обновлен', 'success');
      loadRequests();
    } catch (error) {
      showToast('Ошибка обновления статуса', 'error');
    }
  };

  const renderKanbanItem = (item: ServiceRequest) => (
    <div className="space-y-2">
      <h4 className="font-medium text-sm text-slate-900 dark:text-white">{item.title}</h4>
      <div className="flex items-center gap-2">
        <span className="px-2 py-0.5 text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded">
          {PRIORITY_LABELS[item.priority] || item.priority}
        </span>
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Расширенная фильтрация и группировка
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('table')}
            className={`p-2 rounded-lg transition-colors ${
              viewMode === 'table'
                ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <List className="w-5 h-5" />
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={`p-2 rounded-lg transition-colors ${
              viewMode === 'kanban'
                ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <LayoutGrid className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={() => setShowFilterBuilder(!showFilterBuilder)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Filter className="w-4 h-4" />
          {showFilterBuilder ? 'Скрыть фильтры' : 'Показать фильтры'}
        </button>

        {filterGroup && (
          <>
            <button
              onClick={() => setShowSavePreset(true)}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Save className="w-4 h-4" />
              Сохранить фильтр
            </button>
            <button
              onClick={clearFilters}
              className="flex items-center gap-2 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors"
            >
              <X className="w-4 h-4" />
              Очистить
            </button>
          </>
        )}

        {presets.length > 0 && (
          <select
            onChange={(e) => e.target.value && loadPreset(e.target.value)}
            className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
          >
            <option value="">Выберите фильтр...</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name} {preset.isSystem ? '(Системный)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {showFilterBuilder && (
        <AdvancedFilterBuilder
          fields={FIELD_DEFINITIONS}
          filterGroup={filterGroup || { id: '1', operator: 'and' as any, conditions: [], groups: [] }}
          onChange={setFilterGroup}
          onClose={() => setShowFilterBuilder(false)}
        />
      )}

      {viewMode === 'table' ? (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow border border-slate-200 dark:border-slate-700">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={isAllSelected(requests)}
                    onChange={() => toggleAll(requests)}
                    className="rounded border-slate-300 dark:border-slate-600"
                  />
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white">
                  Название
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white">
                  Статус
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white">
                  Приоритет
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white">
                  Дата
                </th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr
                  key={request.id}
                  className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isSelected(request.id)}
                      onChange={() => toggleItem(request)}
                      className="rounded border-slate-300 dark:border-slate-600"
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-900 dark:text-white">{request.title}</td>
                  <td className="px-4 py-3 text-sm">{STATUS_LABELS[request.status]}</td>
                  <td className="px-4 py-3 text-sm">{PRIORITY_LABELS[request.priority]}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
                    {new Date(request.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <KanbanBoard<ServiceRequest>
          columns={getKanbanColumns()}
          onItemMove={handleItemMove}
          renderItem={renderKanbanItem}
          groupField="status"
        />
      )}

      <BulkOperations
        selectedItems={selectedItems}
        onClearSelection={clearSelection}
        onBulkUpdate={handleBulkUpdate}
        onBulkDelete={handleBulkDelete}
        onBulkExport={handleBulkExport}
        availableFields={FIELD_DEFINITIONS}
      />

      {showSavePreset && (
        <Modal isOpen onClose={() => setShowSavePreset(false)} title="Сохранить фильтр">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Название
              </label>
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                placeholder="Мой фильтр"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Описание
              </label>
              <textarea
                value={presetDescription}
                onChange={(e) => setPresetDescription(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                rows={3}
                placeholder="Описание фильтра..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSavePreset(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleSavePreset}
                disabled={!presetName}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
              >
                Сохранить
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function convertToCSV(data: any[]): string {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const rows = data.map((row) => headers.map((h) => JSON.stringify(row[h] || '')).join(','));
  return [headers.join(','), ...rows].join('\n');
}

function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
