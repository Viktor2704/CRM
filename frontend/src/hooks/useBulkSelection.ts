import { useState, useCallback } from 'react';

interface UseBulkSelectionReturn<T> {
  selectedItems: T[];
  selectedIds: Set<string>;
  toggleItem: (item: T) => void;
  toggleAll: (items: T[]) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;
  isAllSelected: (items: T[]) => boolean;
}

export function useBulkSelection<T extends { id: string }>(): UseBulkSelectionReturn<T> {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<T[]>([]);

  const toggleItem = useCallback((item: T) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });

    setSelectedItems((prev) => {
      const exists = prev.find((i) => i.id === item.id);
      if (exists) {
        return prev.filter((i) => i.id !== item.id);
      } else {
        return [...prev, item];
      }
    });
  }, []);

  const toggleAll = useCallback((items: T[]) => {
    setSelectedIds((prev) => {
      const allSelected = items.every((item) => prev.has(item.id));
      if (allSelected) {
        return new Set();
      } else {
        return new Set(items.map((item) => item.id));
      }
    });

    setSelectedItems((prev) => {
      const allSelected = items.every((item) => prev.find((i) => i.id === item.id));
      if (allSelected) {
        return [];
      } else {
        return [...items];
      }
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedItems([]);
  }, []);

  const isSelected = useCallback(
    (id: string) => {
      return selectedIds.has(id);
    },
    [selectedIds]
  );

  const isAllSelected = useCallback(
    (items: T[]) => {
      return items.length > 0 && items.every((item) => selectedIds.has(item.id));
    },
    [selectedIds]
  );

  return {
    selectedItems,
    selectedIds,
    toggleItem,
    toggleAll,
    clearSelection,
    isSelected,
    isAllSelected,
  };
}
