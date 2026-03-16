import { useState, useCallback, useEffect } from 'react';
import { api } from '@/api/client';
import type { FilterGroup, FilterPreset } from '@/types/filters';
import { LogicalOperator } from '@/types/filters';

interface UseAdvancedFiltersOptions {
  entityType: string;
  onFilterChange?: (filterGroup: FilterGroup | undefined) => void;
}

interface UseAdvancedFiltersReturn {
  filterGroup: FilterGroup | undefined;
  setFilterGroup: (group: FilterGroup | undefined) => void;
  presets: FilterPreset[];
  loadPresets: () => Promise<void>;
  savePreset: (name: string, description?: string, isShared?: boolean) => Promise<void>;
  loadPreset: (presetId: string) => void;
  deletePreset: (presetId: string) => Promise<void>;
  clearFilters: () => void;
  isLoading: boolean;
}

const _createDefaultFilterGroup = (): FilterGroup => ({
  id: Math.random().toString(36).substring(2, 11),
  operator: LogicalOperator.AND,
  conditions: [],
  groups: [],
});

export function useAdvancedFilters({
  entityType,
  onFilterChange,
}: UseAdvancedFiltersOptions): UseAdvancedFiltersReturn {
  const [filterGroup, setFilterGroupState] = useState<FilterGroup | undefined>();
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const setFilterGroup = useCallback(
    (group: FilterGroup | undefined) => {
      setFilterGroupState(group);
      onFilterChange?.(group);
    },
    [onFilterChange]
  );

  const loadPresets = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.get<{ items: FilterPreset[] }>(`/api/filter-presets?entityType=${entityType}`);
      setPresets(data?.items || []);
    } catch (error) {
      console.error('Failed to load filter presets:', error);
    } finally {
      setIsLoading(false);
    }
  }, [entityType]);

  const savePreset = useCallback(
    async (name: string, description?: string, isShared: boolean = false) => {
      if (!filterGroup) return;

      setIsLoading(true);
      try {
        await api.post('/filter-presets', {
          name,
          description,
          filterGroup,
          isShared,
          entityType,
        });
        await loadPresets();
      } catch (error) {
        console.error('Failed to save filter preset:', error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [filterGroup, entityType, loadPresets]
  );

  const loadPreset = useCallback(
    (presetId: string) => {
      const preset = presets.find((p) => p.id === presetId);
      if (preset) {
        setFilterGroup(preset.filterGroup);
      }
    },
    [presets, setFilterGroup]
  );

  const deletePreset = useCallback(
    async (presetId: string) => {
      setIsLoading(true);
      try {
        await api.delete(`/api/filter-presets/${presetId}`);
        await loadPresets();
      } catch (error) {
        console.error('Failed to delete filter preset:', error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [loadPresets]
  );

  const clearFilters = useCallback(() => {
    setFilterGroup(undefined);
  }, [setFilterGroup]);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  return {
    filterGroup,
    setFilterGroup,
    presets,
    loadPresets,
    savePreset,
    loadPreset,
    deletePreset,
    clearFilters,
    isLoading,
  };
}
