import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../src/errors.js';
import { parseDataUrlPayload as parseDataUrlPayloadHelper } from '../src/helpers/fileHelpers.js';
import { isUuidValue, normalizeText } from '../src/helpers/normalize.js';
import { registerAccessRequestRoutes } from '../src/routes/accessRequests.js';

const ids = {
  admin: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  user: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  otherUser: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  request: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

const createResponse = () => ({
  statusCode: 200,
  body: undefined as any,
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
});

const createRouteHarness = (
  dbQuery: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>,
  overrides: Partial<Record<string, any>> = {},
) => {
  const handlers = new Map<string, (request: any, response: any) => Promise<void>>();
  const app = {
    get(path: string, ...routeHandlers: Array<(request: any, response: any) => Promise<void>>) {
      handlers.set(`GET ${path}`, routeHandlers.at(-1)!);
    },
    post(path: string, ...routeHandlers: Array<(request: any, response: any) => Promise<void>>) {
      handlers.set(`POST ${path}`, routeHandlers.at(-1)!);
    },
    patch(path: string, ...routeHandlers: Array<(request: any, response: any) => Promise<void>>) {
      handlers.set(`PATCH ${path}`, routeHandlers.at(-1)!);
    },
    delete(path: string, ...routeHandlers: Array<(request: any, response: any) => Promise<void>>) {
      handlers.set(`DELETE ${path}`, routeHandlers.at(-1)!);
    },
  };

  registerAccessRequestRoutes({
    app,
    localMockAuthEnabled: true,
    requireAuth: (_request: any, _response: any, next: () => void) => next(),
    asyncHandler: <T extends (request: any, response: any) => Promise<void>>(handler: T) => handler,
    ensureAccessRequestSchema: async () => {},
    ApiError,
    dbQuery,
    normalizeText,
    isUuidValue,
    parseUuidPath: (value: string) => value,
    getAdminManagerIds: async () => [],
    pushInAppNotification: async () => {},
    canSendEmails: () => false,
    sendSystemEventNotice: async () => {},
    storeFile: async () => {
      throw new Error('storeFile should not be used in route authorization tests');
    },
    parseDataUrlPayload: () => {
      throw new Error('parseDataUrlPayload should not be used in route authorization tests');
    },
    buildFileUrl: () => '/api/uploads/test-file.txt',
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

test('GET /access-requests scopes non-admin users to their own requests', async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const harness = createRouteHarness(async (text, values = []) => {
    queries.push({ text, values });
    return {
      rows: [{
        id: ids.request,
        title: 'Scoped request',
        object_name: 'Object',
        direction_id: null,
        file_id: null,
        file_name: null,
        file_url: 'https://example.test/uploads/probe.txt',
        expires_at: '2099-12-31',
        status: 'active',
        created_by_id: ids.user,
        created_at: '2099-01-01T00:00:00.000Z',
      }],
    };
  });

  const response = createResponse();
  await harness.getHandler('GET', '/access-requests')({
    authUser: { id: ids.user, role: 'user' },
    query: {},
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /created_by_id = \$1::uuid/);
  assert.deepEqual(queries[0].values, [ids.user]);
  assert.equal(response.body.items.length, 1);
  assert.equal(response.body.items[0].fileUrl, '/api/uploads/probe.txt');
});

test('GET /access-requests allows admin-like roles to list every request', async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const harness = createRouteHarness(async (text, values = []) => {
    queries.push({ text, values });
    return { rows: [] };
  });

  const response = createResponse();
  await harness.getHandler('GET', '/access-requests')({
    authUser: { id: ids.admin, role: 'manager' },
    query: { status: 'active' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0].text, /created_by_id =/);
  assert.deepEqual(queries[0].values, ['active']);
});

test('GET /access-requests rejects malformed non-admin actors', async () => {
  const harness = createRouteHarness(async () => ({ rows: [] }));
  const response = createResponse();

  await assert.rejects(
    harness.getHandler('GET', '/access-requests')({
      authUser: { id: 'not-a-uuid', role: 'user' },
      query: {},
    }, response),
    (error: any) => error instanceof ApiError && error.status === 401 && error.code === 'UNAUTHORIZED',
  );
});

test('POST /access-requests stores and returns a protected relative fileUrl', async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const harness = createRouteHarness(
    async (text, values = []) => {
      queries.push({ text, values });
      return {
        rows: [{
          id: ids.request,
          title: 'Scoped request',
          object_name: 'Object',
          expires_at: '2099-12-31',
          status: 'active',
          created_at: '2099-01-01T00:00:00.000Z',
        }],
      };
    },
    {
      parseDataUrlPayload: () => ({
        fileName: 'probe.txt',
        mimeType: 'text/plain',
        content: Buffer.from('probe'),
      }),
      storeFile: async () => ({
        id: 'file-123',
        fileName: 'probe.txt',
        storageKey: 'requests/probe.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        uploadedAt: '2099-01-01T00:00:00.000Z',
      }),
    },
  );
  const response = createResponse();

  await harness.getHandler('POST', '/access-requests')({
    authUser: { id: ids.user, role: 'user' },
    body: {
      title: 'Scoped request',
      objectName: 'Object',
      expiresAt: '2099-12-31',
      fileDataUrl: 'data:text/plain;base64,cHJvYmU=',
      fileName: 'probe.txt',
    },
  }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /INSERT INTO access_requests/i);
  assert.equal(queries[0].values[5], '/api/uploads/requests/probe.txt');
  assert.equal(response.body.fileId, 'file-123');
  assert.equal(response.body.fileName, 'probe.txt');
  assert.equal(response.body.fileUrl, '/api/uploads/requests/probe.txt');
});

test('POST /access-requests rejects active web document attachments before storage', async () => {
  const harness = createRouteHarness(async () => {
    throw new Error('dbQuery should not be called for blocked uploads');
  }, {
    parseDataUrlPayload: parseDataUrlPayloadHelper,
    storeFile: async () => {
      throw new Error('storeFile should not be called for blocked uploads');
    },
  });

  for (const attachment of [
    {
      fileName: 'briefing.html',
      fileDataUrl: 'data:text/plain;base64,cHJvYmU=',
    },
    {
      fileName: 'vector.svg',
      fileDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    },
  ]) {
    await assert.rejects(
      harness.getHandler('POST', '/access-requests')({
        authUser: { id: ids.user, role: 'user' },
        body: {
          title: 'Scoped request',
          objectName: 'Object',
          expiresAt: '2099-12-31',
          ...attachment,
        },
      }, createResponse()),
      (error: any) => error instanceof ApiError && error.status === 415 && error.code === 'FILE_TYPE_NOT_ALLOWED',
    );
  }
});

test('PATCH /access-requests/:id keeps status changes restricted to admin-like roles', async () => {
  const harness = createRouteHarness(async () => ({ rows: [] }));
  const response = createResponse();

  await assert.rejects(
    harness.getHandler('PATCH', '/access-requests/:id')({
      authUser: { id: ids.user, role: 'user' },
      params: { id: ids.request },
      body: { status: 'closed' },
    }, response),
    (error: any) => error instanceof ApiError && error.status === 403 && error.code === 'FORBIDDEN',
  );
});

test('PATCH /access-requests/:id returns 404 when the request does not exist', async () => {
  const harness = createRouteHarness(async () => ({ rows: [] }));
  const response = createResponse();

  await assert.rejects(
    harness.getHandler('PATCH', '/access-requests/:id')({
      authUser: { id: ids.admin, role: 'admin' },
      params: { id: ids.request },
      body: { status: 'closed' },
    }, response),
    (error: any) => error instanceof ApiError && error.status === 404 && error.code === 'ACCESS_REQUEST_NOT_FOUND',
  );
});

test('DELETE /access-requests/:id denies non-owner users', async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const harness = createRouteHarness(async (text, values = []) => {
    queries.push({ text, values });
    if (/SELECT created_by_id::text as created_by_id FROM access_requests/i.test(text)) {
      return { rows: [{ created_by_id: ids.otherUser }] };
    }
    return { rows: [] };
  });
  const response = createResponse();

  await assert.rejects(
    harness.getHandler('DELETE', '/access-requests/:id')({
      authUser: { id: ids.user, role: 'user' },
      params: { id: ids.request },
    }, response),
    (error: any) => error instanceof ApiError && error.status === 403 && error.code === 'FORBIDDEN',
  );

  assert.equal(queries.length, 1);
});

test('DELETE /access-requests/:id allows creators to delete their own requests', async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const harness = createRouteHarness(async (text, values = []) => {
    queries.push({ text, values });
    if (/SELECT created_by_id::text as created_by_id FROM access_requests/i.test(text)) {
      return { rows: [{ created_by_id: ids.user }] };
    }
    return { rows: [] };
  });
  const response = createResponse();

  await harness.getHandler('DELETE', '/access-requests/:id')({
    authUser: { id: ids.user, role: 'user' },
    params: { id: ids.request },
  }, response);

  assert.equal(response.statusCode, 204);
  assert.equal(queries.length, 2);
  assert.match(queries[1].text, /UPDATE access_requests SET deleted_at=now\(\) WHERE id=\$1::uuid/i);
});

test('expiry scheduler sends system event notices with body payload', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalSetInterval = globalThis.setInterval;
  const timeoutCallbacks: Array<() => void> = [];
  const intervalCallbacks: Array<() => void> = [];
  const sentPayloads: Array<Record<string, unknown>> = [];
  let queryStep = 0;
  let resolveEmailSent: (() => void) | null = null;
  const emailSent = new Promise<void>((resolve) => {
    resolveEmailSent = resolve;
  });

  globalThis.setTimeout = (((callback: () => void) => {
    timeoutCallbacks.push(callback);
    return { ref() { return this; }, unref() { return this; } } as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
  globalThis.setInterval = (((callback: () => void) => {
    intervalCallbacks.push(callback);
    return { ref() { return this; }, unref() { return this; } } as ReturnType<typeof setInterval>;
  }) as typeof setInterval);

  try {
    createRouteHarness(async (text) => {
      queryStep += 1;
      if (queryStep === 1) {
        assert.match(text, /SELECT id::text, title, object_name, expires_at, created_by_id::text/i);
        return {
          rows: [{
            id: ids.request,
            title: 'Scoped request',
            object_name: 'Object',
            expires_at: '2099-12-31',
            created_by_id: ids.user,
          }],
        };
      }
      if (queryStep === 2) {
        assert.match(text, /SELECT email FROM app_users WHERE role IN \('admin','manager'\)/i);
        return { rows: [{ email: 'manager@example.com' }] };
      }
      if (queryStep === 3) {
        assert.match(text, /UPDATE access_requests SET notified_24h=true WHERE id=\$1::uuid/i);
        return { rows: [] };
      }
      throw new Error(`Unexpected query #${queryStep}: ${text}`);
    }, {
      localMockAuthEnabled: false,
      canSendEmails: () => true,
      sendSystemEventNotice: async (payload: Record<string, unknown>) => {
        sentPayloads.push(payload);
        resolveEmailSent?.();
      },
    });

    assert.equal(timeoutCallbacks.length, 1);
    assert.equal(intervalCallbacks.length, 1);

    timeoutCallbacks[0]();
    await emailSent;

    assert.equal(sentPayloads.length, 1);
    assert.deepEqual(sentPayloads[0], {
      to: 'manager@example.com',
      subject: 'Заявка на доступ истекает: Scoped request',
      body: 'Заявка на доступ "Scoped request" по объекту "Object" истекает 2099-12-31.\n\nПожалуйста, продлите или закройте заявку в системе.',
    });
    assert.equal('text' in sentPayloads[0], false);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.setInterval = originalSetInterval;
  }
});
