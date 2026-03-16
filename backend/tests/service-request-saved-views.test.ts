import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../src/errors.js';
import { resetLocalMockSavedViews } from '../src/helpers/savedViews.js';
import { serviceRequestSavedViewConfig } from '../src/helpers/serviceRequestHelpers.js';
import {
    createLocalMockSavedView,
    deleteLocalMockSavedView,
    listLocalMockSavedViews,
    updateLocalMockSavedView,
} from '../src/helpers/savedViews.js';

const createIdFactory = (prefix: string) => {
    let index = 0;
    return () => `${prefix}-${++index}`;
};

test('service-requests saved views: system default includes all filter params', () => {
    resetLocalMockSavedViews();
    const result = listLocalMockSavedViews({
        actorUserId: 'test-user-1',
        config: serviceRequestSavedViewConfig,
    });

    assert.equal(result.defaultViewId, 'service-requests-system-default');
    assert.equal(result.items[0].id, 'service-requests-system-default');
    assert.equal(result.items[0].params.search, '');
    assert.equal(result.items[0].params.status, '');
    assert.equal(result.items[0].params.priority, '');
    assert.equal(result.items[0].params.executor, '');
    assert.equal(result.items[0].params.sort, 'updated_at');
    assert.equal(result.items[0].params.order, 'desc');
    assert.equal(result.items[0].isDefault, true);
});

test('service-requests saved views: create with priority and executor filters', () => {
    resetLocalMockSavedViews();
    const createResult = createLocalMockSavedView({
        actorUserId: 'test-user-1',
        config: serviceRequestSavedViewConfig,
        input: {
            name: 'Критические заявки',
            params: {
                priority: 'critical',
                status: 'in_progress',
            },
            isDefault: true,
        },
        createId: createIdFactory('view'),
    });

    assert.equal(createResult.item.name, 'Критические заявки');
    assert.equal(createResult.item.params.priority, 'critical');
    assert.equal(createResult.item.params.status, 'in_progress');
    assert.equal(createResult.item.params.executor, '');
    assert.equal(createResult.item.isDefault, true);
    assert.equal(createResult.defaultViewId, createResult.item.id);
});

test('service-requests saved views: update with executor filter', () => {
    resetLocalMockSavedViews();
    const createResult = createLocalMockSavedView({
        actorUserId: 'test-user-1',
        config: serviceRequestSavedViewConfig,
        input: {
            name: 'Мои заявки',
            params: { status: 'assigned' },
        },
        createId: createIdFactory('view'),
    });

    const updateResult = updateLocalMockSavedView({
        actorUserId: 'test-user-1',
        config: serviceRequestSavedViewConfig,
        viewId: createResult.item.id,
        input: {
            params: {
                executor: 'executor-uuid-123',
            },
        },
    });

    assert.equal(updateResult.item.params.status, 'assigned');
    assert.equal(updateResult.item.params.executor, 'executor-uuid-123');
});

test('service-requests saved views: delete custom view', () => {
    resetLocalMockSavedViews();
    const createResult = createLocalMockSavedView({
        actorUserId: 'test-user-1',
        config: serviceRequestSavedViewConfig,
        input: {
            name: 'Временный вид',
            params: { priority: 'high' },
        },
        createId: createIdFactory('view'),
    });

    deleteLocalMockSavedView({
        actorUserId: 'test-user-1',
        config: serviceRequestSavedViewConfig,
        viewId: createResult.item.id,
    });

    const listResult = listLocalMockSavedViews({
        actorUserId: 'test-user-1',
        config: serviceRequestSavedViewConfig,
    });

    assert.equal(listResult.items.length, 1);
    assert.equal(listResult.items[0].id, 'service-requests-system-default');
});

test('service-requests saved views: validate status filter', () => {
    resetLocalMockSavedViews();
    assert.throws(() => {
        createLocalMockSavedView({
            actorUserId: 'test-user-1',
            config: serviceRequestSavedViewConfig,
            input: {
                name: 'Invalid status',
                params: { status: 'invalid_status' },
            },
            createId: createIdFactory('view'),
        });
    }, (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 422);
        assert.match(error.message, /unsupported value/i);
        return true;
    });
});

test('service-requests saved views: validate priority filter', () => {
    resetLocalMockSavedViews();
    assert.throws(() => {
        createLocalMockSavedView({
            actorUserId: 'test-user-1',
            config: serviceRequestSavedViewConfig,
            input: {
                name: 'Invalid priority',
                params: { priority: 'super_urgent' },
            },
            createId: createIdFactory('view'),
        });
    }, (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 422);
        assert.match(error.message, /unsupported value/i);
        return true;
    });
});

test('service-requests saved views: system view cannot be deleted', () => {
    resetLocalMockSavedViews();
    assert.throws(() => {
        deleteLocalMockSavedView({
            actorUserId: 'test-user-1',
            config: serviceRequestSavedViewConfig,
            viewId: 'service-requests-system-default',
        });
    }, (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 422);
        assert.match(error.message, /system view cannot be deleted/i);
        return true;
    });
});

test('service-requests saved views: multiple filters combined', () => {
    resetLocalMockSavedViews();
    const createResult = createLocalMockSavedView({
        actorUserId: 'test-user-1',
        config: serviceRequestSavedViewConfig,
        input: {
            name: 'Комплексный фильтр',
            params: {
                search: 'протечка',
                status: 'on_site',
                priority: 'high',
                executor: 'exec-123',
            },
        },
        createId: createIdFactory('view'),
    });

    assert.equal(createResult.item.params.search, 'протечка');
    assert.equal(createResult.item.params.status, 'on_site');
    assert.equal(createResult.item.params.priority, 'high');
    assert.equal(createResult.item.params.executor, 'exec-123');
});
