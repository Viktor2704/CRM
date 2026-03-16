import { useState, useEffect, useCallback } from 'react';
import { api } from '@/api/client';

export interface SavedView {
  id: string;
  name: string;
  params: Record<string, any>;
  isDefault?: boolean;
  isSystem?: boolean;
}

interface UseSavedViewsReturn {
  views: SavedView[];
  defaultViewId: string | null;
  systemViewId: string | null;
  loading: boolean;
  createView: (name: string, params: Record<string, any>) => Promise<void>;
  updateView: (id: string, updates: Partial<SavedView>) => Promise<void>;
  deleteView: (id: string) => Promise<void>;
  loadViews: () => Promise<void>;
}

export function useSavedViews(entityType: string): UseSavedViewsReturn {
  const [views, setViews] = useState<SavedView[]>([]);
  const [defaultViewId, setDefaultViewId] = useState<string | null>(null);
  const [systemViewId, setSystemViewId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadViews = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getT<{ views: SavedView[] }>(`/saved-views?entityType=${entityType}`);
      const viewsList = response.views || [];
      setViews(viewsList);

      const defaultView = viewsList.find((v) => v.isDefault);
      const systemView = viewsList.find((v) => v.isSystem);

      setDefaultViewId(defaultView?.id || null);
      setSystemViewId(systemView?.id || null);
    } catch (error) {
      console.error('Failed to load saved views:', error);
      setViews([]);
    } finally {
      setLoading(false);
    }
  }, [entityType]);

  useEffect(() => {
    void loadViews();
  }, [loadViews]);

  const createView = useCallback(
    async (name: string, params: Record<string, any>) => {
      await api.postT('/saved-views', {
        name,
        entityType,
        params,
      });
      await loadViews();
    },
    [entityType, loadViews]
  );

  const updateView = useCallback(
    async (id: string, updates: Partial<SavedView>) => {
      await api.patchT(`/saved-views/${id}`, updates);
      await loadViews();
    },
    [loadViews]
  );

  const deleteView = useCallback(
    async (id: string) => {
      await api.delT(`/saved-views/${id}`);
      await loadViews();
    },
    [loadViews]
  );

  return {
    views,
    defaultViewId,
    systemViewId,
    loading,
    createView,
    updateView,
    deleteView,
    loadViews,
  };
}
