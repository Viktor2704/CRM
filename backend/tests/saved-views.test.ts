import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listLocalMockSavedViews,
  createLocalMockSavedView,
  updateLocalMockSavedView,
  deleteLocalMockSavedView,
  resetLocalMockSavedViews,
  normalizeSavedViewOrder,
} from '../src/helpers/savedViews.js';

const actorUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const createTestConfig = () => ({
  module: 'test_module',
  systemViewId: 'system',
  systemViewName: 'All Items',
  defaultParams: { status: 'active' },
  mergeParams: (defaults: any, overrides: any) => ({ ...defaults, ...overrides }),
});

test.afterEach(() => {
  resetLocalMockSavedViews();
});

test('listLocalMockSavedViews returns system view when no custom views exist', () => {
  const config = createTestConfig();
  const result = listLocalMockSavedViews({ actorUserId, config });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'system');
  assert.equal(result.items[0].name, 'All Items');
  assert.equal(result.items[0].isSystem, true);
  assert.equal(result.items[0].isDefault, true);
  assert.equal(result.defaultViewId, 'system');
  assert.equal(result.systemViewId, 'system');
});

test('createLocalMockSavedView adds a new view with all fields', () => {
  const config = createTestConfig();
  const input = {
    name: 'My Custom View',
    params: { status: 'pending', priority: 'high' },
    columns: ['name', 'status', 'priority'],
    groupBy: 'status',
    layout: 'board',
    isDefault: false,
  };

  const result = createLocalMockSavedView({ actorUserId, config, input });

  assert.ok(result.item.id);
  assert.equal(result.item.name, 'My Custom View');
  assert.deepEqual(result.item.params, { status: 'pending', priority: 'high' });
  assert.deepEqual(result.item.columns, ['name', 'status', 'priority']);
  assert.equal(result.item.groupBy, 'status');
  assert.equal(result.item.layout, 'board');
  assert.equal(result.item.isDefault, false);
  assert.ok(result.item.createdAt);
  assert.ok(result.item.updatedAt);
});

test('createLocalMockSavedView sets view as default when isDefault is true', () => {
  const config = createTestConfig();
  const input = {
    name: 'Default View',
    isDefault: true,
  };

  const result = createLocalMockSavedView({ actorUserId, config, input });

  assert.equal(result.item.isDefault, true);
  assert.equal(result.defaultViewId, result.item.id);

  const list = listLocalMockSavedViews({ actorUserId, config });
  assert.equal(list.defaultViewId, result.item.id);
  assert.equal(list.items[0].isDefault, false); // system view
  assert.equal(list.items[1].isDefault, true); // custom view
});

test('createLocalMockSavedView merges params with defaults', () => {
  const config = createTestConfig();
  const input = {
    name: 'Partial Params',
    params: { priority: 'high' },
  };

  const result = createLocalMockSavedView({ actorUserId, config, input });

  assert.deepEqual(result.item.params, { status: 'active', priority: 'high' });
});

test('createLocalMockSavedView uses default params when params not provided', () => {
  const config = createTestConfig();
  const input = {
    name: 'No Params',
  };

  const result = createLocalMockSavedView({ actorUserId, config, input });

  assert.deepEqual(result.item.params, { status: 'active' });
});

test('createLocalMockSavedView normalizes columns array', () => {
  const config = createTestConfig();
  const input = {
    name: 'Columns Test',
    columns: ['name', 'status', 'name', '', 'priority', null, 'status'],
  };

  const result = createLocalMockSavedView({ actorUserId, config, input });

  assert.deepEqual(result.item.columns, ['name', 'status', 'priority']);
});

test('createLocalMockSavedView throws error when name is missing', () => {
  const config = createTestConfig();
  const input = { name: '' };

  assert.throws(
    () => createLocalMockSavedView({ actorUserId, config, input }),
    { message: /name is required/i }
  );
});

test('createLocalMockSavedView throws error when name exceeds 120 characters', () => {
  const config = createTestConfig();
  const input = { name: 'a'.repeat(121) };

  assert.throws(
    () => createLocalMockSavedView({ actorUserId, config, input }),
    { message: /name must be <= 120 characters/i }
  );
});

test('createLocalMockSavedView throws error when columns exceed limit', () => {
  const config = createTestConfig();
  const input = {
    name: 'Too Many Columns',
    columns: Array.from({ length: 51 }, (_, i) => `col${i}`),
  };

  assert.throws(
    () => createLocalMockSavedView({ actorUserId, config, input }),
    { message: /columns can contain up to 50 values/i }
  );
});

test('createLocalMockSavedView throws error when reaching view limit', () => {
  const config = createTestConfig();

  for (let i = 0; i < 50; i++) {
    createLocalMockSavedView({ actorUserId, config, input: { name: `View ${i}` } });
  }

  assert.throws(
    () => createLocalMockSavedView({ actorUserId, config, input: { name: 'View 51' } }),
    { message: /saved views limit reached/i }
  );
});

test('updateLocalMockSavedView updates view fields', () => {
  const config = createTestConfig();
  const created = createLocalMockSavedView({
    actorUserId,
    config,
    input: { name: 'Original', columns: ['name'], groupBy: 'status' },
  });

  const updated = updateLocalMockSavedView({
    actorUserId,
    config,
    viewId: created.item.id,
    input: { name: 'Updated', columns: ['name', 'priority'], groupBy: null },
  });

  assert.equal(updated.item.name, 'Updated');
  assert.deepEqual(updated.item.columns, ['name', 'priority']);
  assert.equal(updated.item.groupBy, null);
  assert.equal(updated.item.createdAt, created.item.createdAt);
  // updatedAt should be set (may be same as createdAt if test runs very fast)
  assert.ok(updated.item.updatedAt);
});

test('updateLocalMockSavedView can set view as default', () => {
  const config = createTestConfig();
  const view1 = createLocalMockSavedView({ actorUserId, config, input: { name: 'View 1', isDefault: true } });
  const view2 = createLocalMockSavedView({ actorUserId, config, input: { name: 'View 2' } });

  const updated = updateLocalMockSavedView({
    actorUserId,
    config,
    viewId: view2.item.id,
    input: { isDefault: true },
  });

  assert.equal(updated.item.isDefault, true);
  assert.equal(updated.defaultViewId, view2.item.id);

  const list = listLocalMockSavedViews({ actorUserId, config });
  const view1InList = list.items.find((v) => v.id === view1.item.id);
  const view2InList = list.items.find((v) => v.id === view2.item.id);
  assert.equal(view1InList?.isDefault, false);
  assert.equal(view2InList?.isDefault, true);
});

test('updateLocalMockSavedView can unset default view', () => {
  const config = createTestConfig();
  const view = createLocalMockSavedView({ actorUserId, config, input: { name: 'View', isDefault: true } });

  const updated = updateLocalMockSavedView({
    actorUserId,
    config,
    viewId: view.item.id,
    input: { isDefault: false },
  });

  assert.equal(updated.item.isDefault, false);
  // When unsetting default, it should revert to system view
  const list = listLocalMockSavedViews({ actorUserId, config });
  assert.equal(list.defaultViewId, 'system');
});

test('updateLocalMockSavedView throws error when updating system view', () => {
  const config = createTestConfig();

  assert.throws(
    () => updateLocalMockSavedView({ actorUserId, config, viewId: 'system', input: { name: 'Modified' } }),
    { message: /system view cannot be modified/i }
  );
});

test('updateLocalMockSavedView throws error when view not found', () => {
  const config = createTestConfig();

  assert.throws(
    () => updateLocalMockSavedView({ actorUserId, config, viewId: 'nonexistent', input: { name: 'Test' } }),
    { message: /Saved view not found/i }
  );
});

test('deleteLocalMockSavedView removes view', () => {
  const config = createTestConfig();
  const view = createLocalMockSavedView({ actorUserId, config, input: { name: 'To Delete' } });

  deleteLocalMockSavedView({ actorUserId, config, viewId: view.item.id });

  const list = listLocalMockSavedViews({ actorUserId, config });
  assert.equal(list.items.length, 1); // only system view
  assert.equal(list.items[0].id, 'system');
});

test('deleteLocalMockSavedView resets default when deleting default view', () => {
  const config = createTestConfig();
  const view = createLocalMockSavedView({ actorUserId, config, input: { name: 'Default', isDefault: true } });

  deleteLocalMockSavedView({ actorUserId, config, viewId: view.item.id });

  const list = listLocalMockSavedViews({ actorUserId, config });
  assert.equal(list.defaultViewId, 'system');
});

test('deleteLocalMockSavedView throws error when deleting system view', () => {
  const config = createTestConfig();

  assert.throws(
    () => deleteLocalMockSavedView({ actorUserId, config, viewId: 'system' }),
    { message: /system view cannot be deleted/i }
  );
});

test('deleteLocalMockSavedView throws error when view not found', () => {
  const config = createTestConfig();

  assert.throws(
    () => deleteLocalMockSavedView({ actorUserId, config, viewId: 'nonexistent' }),
    { message: /Saved view not found/i }
  );
});

test('normalizeSavedViewOrder returns valid order values', () => {
  assert.equal(normalizeSavedViewOrder('asc'), 'asc');
  assert.equal(normalizeSavedViewOrder('desc'), 'desc');
  assert.equal(normalizeSavedViewOrder('ASC'), 'asc');
  assert.equal(normalizeSavedViewOrder('DESC'), 'desc');
  assert.equal(normalizeSavedViewOrder(''), 'desc');
  assert.equal(normalizeSavedViewOrder(null), 'desc');
});

test('normalizeSavedViewOrder throws error for invalid values', () => {
  assert.throws(
    () => normalizeSavedViewOrder('invalid'),
    { message: /order contains unsupported value/i }
  );
});

test('saved views are isolated per user', () => {
  const config = createTestConfig();
  const user1 = 'user1111-1111-4111-8111-111111111111';
  const user2 = 'user2222-2222-4222-8222-222222222222';

  createLocalMockSavedView({ actorUserId: user1, config, input: { name: 'User 1 View' } });
  createLocalMockSavedView({ actorUserId: user2, config, input: { name: 'User 2 View' } });

  const list1 = listLocalMockSavedViews({ actorUserId: user1, config });
  const list2 = listLocalMockSavedViews({ actorUserId: user2, config });

  assert.equal(list1.items.length, 2); // system + 1 custom
  assert.equal(list2.items.length, 2); // system + 1 custom
  assert.equal(list1.items[1].name, 'User 1 View');
  assert.equal(list2.items[1].name, 'User 2 View');
});

test('saved views are isolated per module', () => {
  const config1 = { ...createTestConfig(), module: 'module1' };
  const config2 = { ...createTestConfig(), module: 'module2' };

  createLocalMockSavedView({ actorUserId, config: config1, input: { name: 'Module 1 View' } });
  createLocalMockSavedView({ actorUserId, config: config2, input: { name: 'Module 2 View' } });

  const list1 = listLocalMockSavedViews({ actorUserId, config: config1 });
  const list2 = listLocalMockSavedViews({ actorUserId, config: config2 });

  assert.equal(list1.items.length, 2);
  assert.equal(list2.items.length, 2);
  assert.equal(list1.items[1].name, 'Module 1 View');
  assert.equal(list2.items[1].name, 'Module 2 View');
});

test('createLocalMockSavedView throws error when actorUserId is missing', () => {
  const config = createTestConfig();

  assert.throws(
    () => createLocalMockSavedView({ actorUserId: '', config, input: { name: 'Test' } }),
    { message: /Authentication is required/i }
  );
});

test('layout validation accepts valid values', () => {
  const config = createTestConfig();

  const list = createLocalMockSavedView({ actorUserId, config, input: { name: 'List', layout: 'list' } });
  const board = createLocalMockSavedView({ actorUserId, config, input: { name: 'Board', layout: 'board' } });

  assert.equal(list.item.layout, 'list');
  assert.equal(board.item.layout, 'board');
});

test('layout validation throws error for invalid values', () => {
  const config = createTestConfig();

  assert.throws(
    () => createLocalMockSavedView({ actorUserId, config, input: { name: 'Test', layout: 'invalid' } }),
    { message: /layout contains unsupported value/i }
  );
});
