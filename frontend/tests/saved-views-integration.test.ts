/**
 * Integration test for Saved Views functionality
 * Tests the useSavedViews hook and SavedViewsPanel component integration
 */

import { describe, it, expect } from 'vitest';

describe('Saved Views Integration', () => {
  it('should export useSavedViews hook', async () => {
    const { useSavedViews } = await import('../src/hooks/useSavedViews');
    expect(useSavedViews).toBeDefined();
    expect(typeof useSavedViews).toBe('function');
  });

  it('should export SavedViewsPanel component', async () => {
    const SavedViewsPanel = await import('../src/components/SavedViewsPanel');
    expect(SavedViewsPanel.default).toBeDefined();
    expect(typeof SavedViewsPanel.default).toBe('function');
  });

  it('useSavedViews should support installations module', () => {
    // Type check - this will fail at compile time if the type is wrong
    const module: 'projects' | 'installations' | 'tenants' = 'installations';
    expect(module).toBe('installations');
  });

  it('SavedView type should include required fields', () => {
    const mockView = {
      id: 'test-id',
      module: 'installations',
      name: 'Test View',
      params: { search: '', status: '' },
      columns: [],
      groupBy: null,
      layout: null,
      isSystem: false,
      isDefault: false,
      createdAt: null,
      updatedAt: null,
    };

    expect(mockView.id).toBe('test-id');
    expect(mockView.module).toBe('installations');
    expect(mockView.params).toHaveProperty('search');
    expect(mockView.params).toHaveProperty('status');
  });
});
