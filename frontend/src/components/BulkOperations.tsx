import { useState, useCallback } from 'react';
import { Check, Download, Trash2, UserCheck, X } from 'lucide-react';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';

interface BulkOperationsProps<T> {
  selectedItems: T[];
  onClearSelection: () => void;
  onBulkUpdate?: (updates: Record<string, unknown>) => Promise<void>;
  onBulkDelete?: () => Promise<void>;
  onBulkExport?: () => Promise<void>;
  onBulkAssign?: (assigneeIds: string[]) => Promise<void>;
  availableFields?: { name: string; label: string; type: string; options?: { value: string; label: string }[] }[];
  availableUsers?: { id: string; fullName: string }[];
}

export default function BulkOperations<T extends { id: string }>({
  selectedItems,
  onClearSelection,
  onBulkUpdate,
  onBulkDelete,
  onBulkExport,
  onBulkAssign,
  availableFields = [],
  availableUsers = [],
}: BulkOperationsProps<T>) {
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [updateData, setUpdateData] = useState<Record<string, unknown>>({});
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleBulkUpdate = useCallback(async () => {
    if (!onBulkUpdate) return;
    setIsProcessing(true);
    try {
      await onBulkUpdate(updateData);
      setShowUpdateModal(false);
      setUpdateData({});
      onClearSelection();
    } finally {
      setIsProcessing(false);
    }
  }, [onBulkUpdate, updateData, onClearSelection]);

  const handleBulkDelete = useCallback(async () => {
    if (!onBulkDelete) return;
    setIsProcessing(true);
    try {
      await onBulkDelete();
      setShowDeleteConfirm(false);
      onClearSelection();
    } finally {
      setIsProcessing(false);
    }
  }, [onBulkDelete, onClearSelection]);

  const handleBulkExport = useCallback(async () => {
    if (!onBulkExport) return;
    setIsProcessing(true);
    try {
      await onBulkExport();
    } finally {
      setIsProcessing(false);
    }
  }, [onBulkExport]);

  const handleBulkAssign = useCallback(async () => {
    if (!onBulkAssign) return;
    setIsProcessing(true);
    try {
      await onBulkAssign(selectedAssignees);
      setShowAssignModal(false);
      setSelectedAssignees([]);
      onClearSelection();
    } finally {
      setIsProcessing(false);
    }
  }, [onBulkAssign, selectedAssignees, onClearSelection]);

  if (selectedItems.length === 0) return null;

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-2xl border border-slate-200 dark:border-slate-700 px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                {selectedItems.length}
              </div>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Выбрано элементов
              </span>
            </div>

            <div className="h-6 w-px bg-slate-300 dark:bg-slate-600" />

            <div className="flex items-center gap-2">
              {onBulkUpdate && (
                <button
                  onClick={() => setShowUpdateModal(true)}
                  disabled={isProcessing}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  Обновить
                </button>
              )}

              {onBulkAssign && availableUsers.length > 0 && (
                <button
                  onClick={() => setShowAssignModal(true)}
                  disabled={isProcessing}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors disabled:opacity-50"
                >
                  <UserCheck className="w-4 h-4" />
                  Назначить
                </button>
              )}

              {onBulkExport && (
                <button
                  onClick={handleBulkExport}
                  disabled={isProcessing}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  Экспорт
                </button>
              )}

              {onBulkDelete && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isProcessing}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  Удалить
                </button>
              )}

              <button
                onClick={onClearSelection}
                disabled={isProcessing}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {showUpdateModal && (
        <Modal isOpen onClose={() => setShowUpdateModal(false)} title="Массовое обновление">
          <div className="space-y-4">
            {availableFields.map((field) => (
              <div key={field.name}>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {field.label}
                </label>
                {field.type === 'select' && field.options ? (
                  <select
                    value={(updateData[field.name] as string) || ''}
                    onChange={(e) => setUpdateData({ ...updateData, [field.name]: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                  >
                    <option value="">Не изменять</option>
                    {field.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                    value={(updateData[field.name] as string) || ''}
                    onChange={(e) => setUpdateData({ ...updateData, [field.name]: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                    placeholder="Не изменять"
                  />
                )}
              </div>
            ))}

            <div className="flex justify-end gap-2 pt-4">
              <button
                onClick={() => setShowUpdateModal(false)}
                disabled={isProcessing}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleBulkUpdate}
                disabled={isProcessing || Object.keys(updateData).length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {isProcessing ? 'Обновление...' : 'Обновить'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showAssignModal && (
        <Modal isOpen onClose={() => setShowAssignModal(false)} title="Назначить исполнителей">
          <div className="space-y-4">
            <div className="max-h-64 overflow-y-auto space-y-2">
              {availableUsers.map((user) => (
                <label key={user.id} className="flex items-center gap-2 p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedAssignees.includes(user.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedAssignees([...selectedAssignees, user.id]);
                      } else {
                        setSelectedAssignees(selectedAssignees.filter((id) => id !== user.id));
                      }
                    }}
                    className="rounded border-slate-300 dark:border-slate-600"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">{user.fullName}</span>
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <button
                onClick={() => setShowAssignModal(false)}
                disabled={isProcessing}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleBulkAssign}
                disabled={isProcessing || selectedAssignees.length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {isProcessing ? 'Назначение...' : 'Назначить'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showDeleteConfirm && (
        <ConfirmDialog
          isOpen
          title="Подтверждение удаления"
          message={`Вы уверены, что хотите удалить ${selectedItems.length} элементов? Это действие нельзя отменить.`}
          confirmLabel="Удалить"
          onConfirm={handleBulkDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          confirmColor="red"
        />
      )}
    </>
  );
}
