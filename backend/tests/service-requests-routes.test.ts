import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../src/errors.js';
import {
  maintenancePlanManageRoles,
  projectAdminRoles,
  projectClientRoles,
  projectOpsRoles,
  serviceRequestManageRoles,
  serviceRequestViewRoles,
} from '../src/helpers/roles.js';
import { isUuidValue, normalizeText } from '../src/helpers/normalize.js';
import { registerMockServiceRequestRoutes, registerServiceRequestRoutes } from '../src/routes/serviceRequests.js';
import { INTERNAL_GLOBAL_ROLES } from '../src/types.js';

const ids = {
  manager: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  request: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};

const serviceRequestTypes = new Set(['emergency', 'maintenance_planned', 'operation', 'general']);

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

const createAppHarness = () => {
  const handlers = new Map<string, (request: any, response: any) => Promise<void> | void>();
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

  return {
    app,
    getHandler(method: string, path: string) {
      const handler = handlers.get(`${method} ${path}`);
      assert.ok(handler, `handler ${method} ${path} should be registered`);
      return handler!;
    },
  };
};

const registerMockHarness = () => {
  const harness = createAppHarness();
  registerMockServiceRequestRoutes({
    app: harness.app,
    requireAuth: (_request: any, _response: any, next: () => void) => next(),
    ApiError,
    randomUUID: () => 'mock-random-uuid',
    normalizeText,
    internalGlobalRoles: INTERNAL_GLOBAL_ROLES,
    serviceRequestManageRoles,
    serviceRequestViewRoles,
    maintenancePlanManageRoles,
    projectAdminRoles,
    projectClientRoles,
    projectOpsRoles,
    getLocalMockBodyObject: (body: unknown) => (body && typeof body === 'object' ? body : {}),
    localMockUsers: [
      { id: 'local-admin-1', role: 'admin', fullName: 'Admin User' },
      { id: 'local-dispatcher-1', role: 'dispatcher', fullName: 'Dispatcher User' },
      { id: 'local-executor-1', role: 'executor', fullName: 'Executor User' },
    ],
    localMockNotifications: [],
    localMockMaintenanceItems: [],
    serviceRequestTypes,
  });
  return harness;
};

const registerDbHarness = (dbQuery: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>) => {
  const harness = createAppHarness();
  registerServiceRequestRoutes({
    app: harness.app,
    requireAuth: (_request: any, _response: any, next: () => void) => next(),
    asyncHandler: <T extends (request: any, response: any) => Promise<void>>(handler: T) => handler,
    ensureServiceRequestSchema: async () => {},
    ensureNotificationSchema: async () => {},
    ensureDirectionSchema: async () => {},
    ensureMaintenanceItemSchema: async () => {},
    ApiError,
    dbQuery,
    withTx: async (callback: any) => callback({ query: dbQuery }),
    normalizeText,
    isUuidValue,
    parseUuidPath: (value: string) => value,
    serviceRequestManageRoles,
    serviceRequestViewRoles,
    internalGlobalRoles: INTERNAL_GLOBAL_ROLES,
    serviceRequestTypes,
    mapServiceRequestRow: (row: any) => row,
    projectAdminRoles,
    projectOpsRoles,
    projectClientRoles,
    dispatchServiceRequestCreationNotifications: async () => {},
    sendServiceRequestEmail: async () => {},
    canSendEmails: () => false,
    sendSystemEventNotice: async () => {},
    sendProjectNotificationBestEffort: async () => {},
    pushProjectInAppNotification: async () => {},
    getAdminManagerIds: async () => [],
    pushInAppNotification: async () => {},
    pushTelegramNotification: async () => {},
    logger: { info() {}, warn() {}, error() {} },
    serializeError: (error: any) => ({ message: String(error?.message ?? error) }),
    randomUUID: () => 'route-test-uuid',
    callLLM: async () => ({}),
    callLLMWithFallback: async () => ({}),
    aiRequestSuggestSystemPrompt: '',
    aiSimilarRequestSystemPrompt: '',
    parseAiJson: () => ({}),
    emptyAiSuggestionResponse: {},
    buildAiSuggestionResponse: () => ({}),
    normalizeAiSystemType: (value: string) => value,
    aiSimilarityValues: [],
    parsePositiveInt: (value: unknown, options: { defaultValue: number }) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) ? parsed : options.defaultValue;
    },
    parseDateOnlyValue: (value: unknown) => normalizeText(value),
    toCsvCell: (value: unknown) => String(value ?? ''),
  });
  return harness;
};

test('mock PATCH /service-requests/:requestId/status rejects unsupported terminal jumps', async () => {
  const harness = registerMockHarness();
  const response = createResponse();

  assert.throws(
    () => harness.getHandler('PATCH', '/service-requests/:requestId/status')({
      authUser: { id: 'local-dispatcher-1', role: 'dispatcher' },
      params: { requestId: 'mock-req-1' },
      body: { status: 'closed' },
    }, response),
    (error: any) => error instanceof ApiError && error.status === 422 && error.code === 'INVALID_TRANSITION',
  );
});

test('db PATCH /service-requests/:requestId/status rejects unsupported terminal jumps before update', async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const harness = registerDbHarness(async (text, values = []) => {
    queries.push({ text, values });
    if (/select \*/i.test(text) && /from requests r/i.test(text)) {
      return {
        rows: [{
          id: ids.request,
          status: 'assigned',
        }],
      };
    }
    if (/update requests/i.test(text)) {
      throw new Error('status update should not run for an invalid transition');
    }
    return { rows: [] };
  });
  const response = createResponse();

  await assert.rejects(
    harness.getHandler('PATCH', '/service-requests/:requestId/status')({
      authUser: { id: ids.manager, role: 'manager' },
      params: { requestId: ids.request },
      body: { status: 'closed' },
    }, response),
    (error: any) => error instanceof ApiError && error.status === 422 && error.code === 'INVALID_TRANSITION',
  );

  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /from requests r/i);
});
