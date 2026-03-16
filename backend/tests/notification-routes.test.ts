import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../src/errors.js';
import { mapNotificationRow } from '../src/helpers/mappers.js';
import { isUuidValue, normalizeText } from '../src/helpers/normalize.js';
import { registerNotificationRoutes } from '../src/routes/notifications.js';

const ids = {
  user: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  notification: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};

let streamAuthTestDepsPromise: Promise<{
  appConfig: any;
  localMockRefreshTokens: Map<string, any>;
  localMockUsers: any[];
  resolveStreamAuthUser: (request: any, options?: { requireAdminLike: boolean }) => Promise<{ id: string; role: string }>;
}> | null = null;

const loadStreamAuthTestDeps = async () => {
  if (!streamAuthTestDepsPromise) {
    const originalSetInterval = globalThis.setInterval;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousJwtAccessSecret = process.env.JWT_ACCESS_SECRET;
    const previousLocalMockAuth = process.env.LOCAL_MOCK_AUTH;

    process.env.DATABASE_URL ??= 'postgres://postgres:postgres@127.0.0.1:5432/novinzhstroy';
    process.env.JWT_ACCESS_SECRET ??= 'notification-stream-test-secret';
    process.env.LOCAL_MOCK_AUTH = 'true';
    globalThis.setInterval = (((_callback: () => void) => {
      return { ref() { return this; }, unref() { return this; } } as ReturnType<typeof setInterval>;
    }) as typeof setInterval);

    streamAuthTestDepsPromise = Promise.all([
      import('../src/app.js'),
      import('../src/config.js'),
      import('../src/helpers/mockData.js'),
    ]).then(([appModule, configModule, mockDataModule]) => ({
      appConfig: configModule.appConfig,
      localMockRefreshTokens: mockDataModule.localMockRefreshTokens,
      localMockUsers: mockDataModule.localMockUsers,
      resolveStreamAuthUser: appModule.resolveStreamAuthUser,
    })).finally(() => {
      globalThis.setInterval = originalSetInterval;
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
      if (previousJwtAccessSecret === undefined) {
        delete process.env.JWT_ACCESS_SECRET;
      } else {
        process.env.JWT_ACCESS_SECRET = previousJwtAccessSecret;
      }
      if (previousLocalMockAuth === undefined) {
        delete process.env.LOCAL_MOCK_AUTH;
      } else {
        process.env.LOCAL_MOCK_AUTH = previousLocalMockAuth;
      }
    });
  }

  return streamAuthTestDepsPromise;
};

const createResponse = () => ({
  statusCode: 200,
  body: undefined as any,
  headers: {} as Record<string, string>,
  writes: [] as string[],
  flushed: false,
  writableEnded: false,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(payload: unknown) {
    this.body = payload;
    return this;
  },
  send(payload?: unknown) {
    this.body = payload;
    return this;
  },
  setHeader(name: string, value: unknown) {
    this.headers[String(name).toLowerCase()] = String(value);
    return this;
  },
  flushHeaders() {
    this.flushed = true;
  },
  write(chunk: string) {
    this.writes.push(String(chunk));
    return true;
  },
});

const createRouteHarness = (
  dbQuery: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>,
  overrides: Partial<Record<string, any>> = {},
) => {
  const handlers = new Map<string, (request: any, response: any) => Promise<void>>();
  const register = (method: string, path: string | string[], routeHandlers: Array<(request: any, response: any) => Promise<void>>) => {
    for (const candidatePath of Array.isArray(path) ? path : [path]) {
      handlers.set(`${method} ${candidatePath}`, routeHandlers.at(-1)!);
    }
  };
  const app = {
    get(path: string | string[], ...routeHandlers: Array<(request: any, response: any) => Promise<void>>) {
      register('GET', path, routeHandlers);
    },
    post(path: string | string[], ...routeHandlers: Array<(request: any, response: any) => Promise<void>>) {
      register('POST', path, routeHandlers);
    },
    patch(path: string | string[], ...routeHandlers: Array<(request: any, response: any) => Promise<void>>) {
      register('PATCH', path, routeHandlers);
    },
  };

  registerNotificationRoutes({
    app,
    requireAuth: (_request: any, _response: any, next: () => void) => next(),
    requireAdminLike: (_request: any, _response: any, next: () => void) => next(),
    asyncHandler: <T extends (request: any, response: any) => Promise<void>>(handler: T) => handler,
    ensureNotificationSchema: async () => {},
    ApiError,
    dbQuery,
    normalizeText,
    isUuidValue,
    parseUuidPath: (value: string) => value,
    parsePositiveInt: (value: unknown, options: { defaultValue: number }) => {
      const parsed = Number.parseInt(String(value ?? ''), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : options.defaultValue;
    },
    mapNotificationRow,
    projectNotificationStrictAccess: true,
    projectDataLookupMode: 'main_db_only',
    hasProjectScopeDatabase: false,
    allowedTicketNotifierRoles: new Set(['admin', 'manager']),
    projectEventRequireComment: new Set<string>(),
    projectEventRequireQuestions: new Set<string>(),
    projectEventRequireResolution: new Set<string>(),
    ticketClientEventSchema: { parse: (value: unknown) => value },
    validateProjectEventPayload: () => {},
    resolveProjectIdFromNotificationPayload: () => ids.notification,
    ensureInstallationProjectExists: async () => {},
    ensureActorHasProjectAccess: async () => {},
    loadProjectTenantId: async () => ids.user,
    resolveRecipientForNotification: async () => ({ email: 'user@example.test' }),
    sendTicketClientNotification: async () => ({ status: 'accepted' }),
    sendTenantEventNotification: async () => ({ status: 'accepted' }),
    resolveStreamAuthUser: async () => ({ id: ids.user, role: 'executor' }),
    subscribeNotificationEvent: () => () => {},
    publishNotificationEvent: () => {},
    ...overrides,
  });

  return {
    getHandler(method: string, path: string) {
      const handler = handlers.get(`${method} ${path}`);
      assert.ok(handler, `handler ${method} ${path} should be registered`);
      return handler!;
    },
  };
};

test('GET /notifications/stream returns an SSE stream and forwards notification events', async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const timerRefs: unknown[] = [];
  let subscriptionListener: ((payload: unknown) => void) | null = null;
  let unsubscribed = false;

  globalThis.setInterval = (((callback: () => void) => {
    timerRefs.push(callback);
    return { ref() { return this; }, unref() { return this; } } as ReturnType<typeof setInterval>;
  }) as typeof setInterval);
  globalThis.clearInterval = (((_handle: unknown) => {}) as typeof clearInterval);

  try {
    const harness = createRouteHarness(async (text) => {
      assert.match(text, /select count\(\*\)::int as count/i);
      return { rows: [{ count: 3 }] };
    }, {
      subscribeNotificationEvent: (userId: string, listener: (payload: unknown) => void) => {
        assert.equal(userId, ids.user);
        subscriptionListener = listener;
        return () => {
          unsubscribed = true;
        };
      },
    });
    const response = createResponse();
    const requestEvents = new Map<string, () => void>();

    await harness.getHandler('GET', '/notifications/stream')({
      authUser: { id: ids.user, role: 'executor' },
      on(event: string, handler: () => void) {
        requestEvents.set(event, handler);
      },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'text/event-stream; charset=utf-8');
    assert.equal(response.headers['cache-control'], 'no-cache, no-transform');
    assert.equal(response.headers.connection, 'keep-alive');
    assert.equal(response.headers['x-accel-buffering'], 'no');
    assert.equal(response.flushed, true);
    assert.match(response.writes.join(''), /event: ready/);
    assert.match(response.writes.join(''), /"unreadCount":3/);
    assert.equal(timerRefs.length, 1);
    assert.ok(subscriptionListener, 'stream listener should be registered');

    subscriptionListener?.({
      userId: ids.user,
      action: 'created',
      notification: { id: ids.notification },
    });

    assert.match(response.writes.join(''), /event: notification_changed/);
    assert.match(response.writes.join(''), new RegExp(ids.notification));

    requestEvents.get('close')?.();
    assert.equal(unsubscribed, true);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('GET /notifications/stream accepts refresh-cookie auth for credentialed EventSource requests', async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const timerRefs: unknown[] = [];
  const requestEvents = new Map<string, () => void>();
  let subscriptionListener: ((payload: unknown) => void) | null = null;
  let unsubscribed = false;

  globalThis.setInterval = (((callback: () => void) => {
    timerRefs.push(callback);
    return { ref() { return this; }, unref() { return this; } } as ReturnType<typeof setInterval>;
  }) as typeof setInterval);
  globalThis.clearInterval = (((_handle: unknown) => {}) as typeof clearInterval);

  const { appConfig, localMockRefreshTokens, localMockUsers, resolveStreamAuthUser } = await loadStreamAuthTestDeps();
  const refreshToken = 'sse-cookie-auth-token';
  const tempUser = {
    id: ids.user,
    fullName: 'SSE Cookie User',
    email: 'sse-cookie@example.test',
    role: 'executor',
    status: 'active',
  };

  localMockUsers.push(tempUser);
  localMockRefreshTokens.set(refreshToken, {
    userId: ids.user,
    role: 'executor',
    expiresAt: Date.now() + 60_000,
  });

  try {
    const harness = createRouteHarness(async (text) => {
      assert.match(text, /select count\(\*\)::int as count/i);
      return { rows: [{ count: 2 }] };
    }, {
      resolveStreamAuthUser,
      subscribeNotificationEvent: (userId: string, listener: (payload: unknown) => void) => {
        assert.equal(userId, ids.user);
        subscriptionListener = listener;
        return () => {
          unsubscribed = true;
        };
      },
    });
    const response = createResponse();

    await harness.getHandler('GET', '/notifications/stream')({
      cookies: {
        [appConfig.refreshCookieName]: refreshToken,
      },
      get(_name: string) {
        return undefined;
      },
      on(event: string, handler: () => void) {
        requestEvents.set(event, handler);
      },
      query: {},
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'text/event-stream; charset=utf-8');
    assert.equal(response.flushed, true);
    assert.match(response.writes.join(''), /event: ready/);
    assert.match(response.writes.join(''), /"unreadCount":2/);
    assert.equal(timerRefs.length, 1);
    assert.ok(subscriptionListener, 'stream listener should be registered');

    subscriptionListener?.({
      userId: ids.user,
      action: 'created',
      notification: { id: ids.notification },
    });

    assert.match(response.writes.join(''), /event: notification_changed/);
    assert.match(response.writes.join(''), new RegExp(ids.notification));

    requestEvents.get('close')?.();
    assert.equal(unsubscribed, true);
  } finally {
    localMockRefreshTokens.delete(refreshToken);
    const userIndex = localMockUsers.indexOf(tempUser);
    if (userIndex >= 0) {
      localMockUsers.splice(userIndex, 1);
    }
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('GET /notifications/stream rejects query-string accessToken auth fallback', async () => {
  const { resolveStreamAuthUser } = await loadStreamAuthTestDeps();
  const harness = createRouteHarness(async () => {
    assert.fail('dbQuery should not run when stream auth fails');
    return { rows: [] };
  }, {
    resolveStreamAuthUser,
  });
  const response = createResponse();

  await assert.rejects(harness.getHandler('GET', '/notifications/stream')({
    cookies: {},
    get(_name: string) {
      return undefined;
    },
    on(_event: string, _handler: () => void) {},
    query: {
      accessToken: 'query-string-access-token',
    },
  }, response), (error: any) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    assert.equal(error.code, 'UNAUTHORIZED');
    assert.equal(error.message, 'Authentication is required');
    return true;
  });

  assert.equal(response.flushed, false);
  assert.equal(response.writes.length, 0);
});

test('POST /notifications/read-all publishes a read_all invalidation when rows change', async () => {
  const publishedPayloads: any[] = [];
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const harness = createRouteHarness(async (text, values = []) => {
    queries.push({ text, values });
    return {
      rows: [{ id: ids.notification }],
    };
  }, {
    publishNotificationEvent: (payload: unknown) => {
      publishedPayloads.push(payload);
    },
  });
  const response = createResponse();

  await harness.getHandler('POST', '/notifications/read-all')({
    authUser: { id: ids.user, role: 'executor' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /returning id::text as id/i);
  assert.deepEqual(publishedPayloads, [{
    userId: ids.user,
    action: 'read_all',
    notificationIds: [ids.notification],
    timestamp: publishedPayloads[0].timestamp,
  }]);
  assert.ok(typeof publishedPayloads[0]?.timestamp === 'string');
});

test('PATCH /notifications/:notificationId/read publishes the updated notification', async () => {
  const publishedPayloads: any[] = [];
  const harness = createRouteHarness(async (_text, values = []) => {
    assert.deepEqual(values, [ids.notification, ids.user]);
    return {
      rows: [{
        id: ids.notification,
        user_id: ids.user,
        event_type: 'service_request_created',
        title: 'Новая заявка',
        body: 'Описание',
        entity_type: 'service_request',
        entity_id: 'request-1',
        is_read: true,
        created_at: '2026-03-07T09:30:00.000Z',
      }],
    };
  }, {
    publishNotificationEvent: (payload: unknown) => {
      publishedPayloads.push(payload);
    },
  });
  const response = createResponse();

  await harness.getHandler('PATCH', '/notifications/:notificationId/read')({
    authUser: { id: ids.user, role: 'executor' },
    params: { notificationId: ids.notification },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.id, ids.notification);
  assert.deepEqual(publishedPayloads, [{
    userId: ids.user,
    action: 'read',
    notification: response.body,
    timestamp: publishedPayloads[0].timestamp,
  }]);
  assert.ok(typeof publishedPayloads[0]?.timestamp === 'string');
});
