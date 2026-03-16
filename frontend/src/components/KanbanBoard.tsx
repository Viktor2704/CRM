import { useState, useCallback, type DragEvent } from 'react';
import { MoreVertical, Plus } from 'lucide-react';
import type { KanbanColumn } from '@/types/filters';

interface KanbanBoardProps<T> {
  columns: KanbanColumn[];
  onItemMove: (itemId: string, fromColumn: string, toColumn: string) => void;
  onItemClick?: (item: T) => void;
  onAddItem?: (columnId: string) => void;
  renderItem: (item: T) => React.ReactNode;
  groupField: string;
}

export default function KanbanBoard<T extends { id: string; [key: string]: unknown }>({
  columns,
  onItemMove,
  onItemClick,
  onAddItem,
  renderItem,
}: KanbanBoardProps<T>) {
  const [draggedItem, setDraggedItem] = useState<{ id: string; columnId: string } | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const handleDragStart = useCallback((e: DragEvent, itemId: string, columnId: string) => {
    setDraggedItem({ id: itemId, columnId });
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent, targetColumnId: string) => {
      e.preventDefault();
      setDragOverColumn(null);

      if (draggedItem && draggedItem.columnId !== targetColumnId) {
        onItemMove(draggedItem.id, draggedItem.columnId, targetColumnId);
      }
      setDraggedItem(null);
    },
    [draggedItem, onItemMove]
  );

  const handleDragEnd = useCallback(() => {
    setDraggedItem(null);
    setDragOverColumn(null);
  }, []);

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 sm:gap-4 snap-x snap-mandatory sm:snap-none">
      {columns.map((column) => {
        const isDragOver = dragOverColumn === column.id;
        const columnColor = column.color || 'bg-slate-100 dark:bg-slate-800';

        return (
          <div
            key={column.id}
            className={`flex-shrink-0 w-[85vw] xs:w-[80vw] sm:w-80 snap-center bg-slate-50 dark:bg-slate-900 rounded-lg border-2 transition-colors ${
              isDragOver
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-slate-200 dark:border-slate-700'
            }`}
            onDragOver={(e) => handleDragOver(e, column.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, column.id)}
          >
            <div className={`px-4 py-3 rounded-t-lg ${columnColor}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-900 dark:text-white">{column.title}</h3>
                  <span className="px-2 py-0.5 text-xs font-medium bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full">
                    {column.items.length}
                  </span>
                </div>
                <button className="p-1 hover:bg-white/50 dark:hover:bg-slate-700/50 rounded transition-colors">
                  <MoreVertical className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                </button>
              </div>
            </div>

            <div className="p-3 space-y-2 min-h-[200px] max-h-[calc(100vh-300px)] overflow-y-auto">
              {column.items.map((item) => {
                const typedItem = item as T;
                const isDragging = draggedItem?.id === typedItem.id;

                return (
                  <div
                    key={typedItem.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, typedItem.id, column.id)}
                    onDragEnd={handleDragEnd}
                    onClick={() => onItemClick?.(typedItem)}
                    className={`bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-3 cursor-move hover:shadow-md transition-all ${
                      isDragging ? 'opacity-50 scale-95' : 'opacity-100 scale-100'
                    }`}
                  >
                    {renderItem(typedItem)}
                  </div>
                );
              })}

              {column.items.length === 0 && (
                <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-sm">
                  Нет элементов
                </div>
              )}
            </div>

            {onAddItem && (
              <div className="p-3 border-t border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => onAddItem(column.id)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Добавить
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
