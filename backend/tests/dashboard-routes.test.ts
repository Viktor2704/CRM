import assert from 'node:assert/strict';
import test from 'node:test';

import { registerDashboardRoutes } from '../src/routes/dashboard.js';
import { cacheService } from '../src/services/cacheService.js';

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
) => {
  const handlers = new Map<string, (request: any, response: any) => Promise<void>>();
  const app = {
    get(path: string, ...routeHandlers: Array<(request: any, response: any) => Promise<void>>) {
      handlers.set(`GET ${path}`, routeHandlers.at(-1)!);
    },
  };

  registerDashboardRoutes({
    app,
    requireAuth: (_request: any, _response: any, next: () => void) => next(),
    asyncHandler: <T extends (request: any, response: any) => Promise<void>>(handler: T) => handler,
    dbQuery,
    ApiError: class ApiError extends Error {},
  });

  return {
    getHandler(path: string) {
      const handler = handlers.get(`GET ${path}`);
      assert.ok(handler, `handler GET ${path} should be registered`);
      return handler!;
    },
  };
};

const addDays = (dateOnly: string, days: number) =>
  new Date(new Date(dateOnly).getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

test.afterEach(async () => {
  await cacheService.clear();
});

test.after(() => {
  cacheService.destroy();
});

test('GET /dashboard/recent-activity uses entity_activity_log current columns and preserves payload keys', async () => {
  let capturedQuery = '';
  const harness = createRouteHarness(async (text) => {
    capturedQuery = text;
    return {
      rows: [{
        id: 'activity-1',
        activity_type: 'created',
        title: 'Новая заявка',
        description: '',
        entity_type: 'service_request',
        entity_id: 'request-1',
        actor_name: '',
        created_at: '2026-03-13T09:00:00.000Z',
      }],
    };
  });
  const response = createResponse();

  await harness.getHandler('/dashboard/recent-activity')({
    authUser: { id: 'user-1', role: 'manager' },
  }, response);

  assert.match(capturedQuery, /from entity_activity_log/i);
  assert.match(capturedQuery, /activity_type/i);
  assert.match(capturedQuery, /actor_name/i);
  assert.match(capturedQuery, /title/i);
  assert.doesNotMatch(capturedQuery, /event_type/i);
  assert.doesNotMatch(capturedQuery, /user_name/i);
  assert.doesNotMatch(capturedQuery, /deleted_at/i);
  assert.deepEqual(response.body, {
    items: [{
      id: 'activity-1',
      eventType: 'created',
      description: 'Новая заявка',
      entityType: 'service_request',
      entityId: 'request-1',
      userName: 'Система',
      createdAt: '2026-03-13T09:00:00.000Z',
    }],
  });
});

test('GET /dashboard/quick-stats scopes request counts and reads users from app_users without soft-delete assumptions', async () => {
  const queries: string[] = [];
  const harness = createRouteHarness(async (text) => {
    queries.push(text);

    if (/from requests/i.test(text) && /coalesce\(is_project, false\) = true/i.test(text)) {
      return { rows: [{ total: '4', active: '3' }] };
    }

    if (/from requests/i.test(text) && /type <> 'installation'/i.test(text)) {
      return { rows: [{ total: '9', open: '5' }] };
    }

    if (/from requests/i.test(text) && /type = 'installation'/i.test(text) && /coalesce\(is_project, false\) = false/i.test(text)) {
      return { rows: [{ total: '6', completed: '2' }] };
    }

    if (/from app_users/i.test(text)) {
      return { rows: [{ total: '11', active: '7' }] };
    }

    throw new Error(`Unexpected query: ${text}`);
  });
  const response = createResponse();

  await harness.getHandler('/dashboard/quick-stats')({
    authUser: { id: 'quick-stats-user', role: 'manager' },
  }, response);

  assert.equal(queries.length, 4);

  const projectsQuery = queries.find((text) => /coalesce\(is_project, false\) = true/i.test(text));
  const requestsQuery = queries.find((text) => /type <> 'installation'/i.test(text));
  const installationsQuery = queries.find((text) => /type = 'installation'/i.test(text) && /coalesce\(is_project, false\) = false/i.test(text));
  const usersQuery = queries.find((text) => /from app_users/i.test(text));

  assert.ok(projectsQuery);
  assert.ok(requestsQuery);
  assert.ok(installationsQuery);
  assert.ok(usersQuery);

  assert.match(projectsQuery, /deleted_at is null/i);
  assert.match(requestsQuery, /deleted_at is null/i);
  assert.match(installationsQuery, /deleted_at is null/i);
  assert.doesNotMatch(usersQuery, /deleted_at/i);

  assert.deepEqual(response.body, {
    totalProjects: 4,
    activeProjects: 3,
    totalRequests: 9,
    openRequests: 5,
    totalInstallations: 6,
    completedInstallations: 2,
    totalUsers: 11,
    activeUsers: 7,
  });
});

test('GET /dashboard/service-requests keeps service-request scoping on requests', async () => {
  let capturedQuery = '';
  const harness = createRouteHarness(async (text) => {
    capturedQuery = text;
    return {
      rows: [{
        id: 'request-1',
        title: '',
        priority: null,
        status: null,
        created_at: '2026-03-13T08:00:00.000Z',
      }],
    };
  });
  const response = createResponse();

  await harness.getHandler('/dashboard/service-requests')({
    authUser: { id: 'user-1', role: 'manager' },
  }, response);

  assert.match(capturedQuery, /from requests/i);
  assert.match(capturedQuery, /type <> 'installation'/i);
  assert.match(capturedQuery, /deleted_at is null/i);
  assert.doesNotMatch(capturedQuery, /from service_requests/i);
  assert.deepEqual(response.body, {
    items: [{
      id: 'request-1',
      title: 'Заявка request-1',
      priority: 'medium',
      status: 'new',
      createdAt: '2026-03-13T08:00:00.000Z',
    }],
  });
});

test('GET /dashboard/overdue keeps service-request scoping on requests', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const overdueDate = addDays(today, -2);
  let capturedQuery = '';
  let capturedValues: unknown[] = [];
  const harness = createRouteHarness(async (text, values = []) => {
    capturedQuery = text;
    capturedValues = values;
    return {
      rows: [{
        id: 'request-2',
        title: 'Просроченная заявка',
        due_date: overdueDate,
        type: 'service_request',
      }],
    };
  });
  const response = createResponse();

  await harness.getHandler('/dashboard/overdue')({
    authUser: { id: 'user-1', role: 'manager' },
  }, response);

  assert.match(capturedQuery, /from requests/i);
  assert.match(capturedQuery, /type <> 'installation'/i);
  assert.match(capturedQuery, /deleted_at is null/i);
  assert.equal(capturedValues[0], today);
  assert.deepEqual(response.body, {
    items: [{
      id: 'request-2',
      title: 'Просроченная заявка',
      type: 'service_request',
      dueDate: overdueDate,
      daysOverdue: 2,
    }],
  });
});

test('GET /dashboard/upcoming-deadlines keeps service-request scoping on requests', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const deadlineDate = addDays(today, 3);
  let capturedQuery = '';
  let capturedValues: unknown[] = [];
  const harness = createRouteHarness(async (text, values = []) => {
    capturedQuery = text;
    capturedValues = values;
    return {
      rows: [{
        id: 'request-3',
        title: 'Ближайшая заявка',
        due_date: deadlineDate,
        type: 'service_request',
      }],
    };
  });
  const response = createResponse();

  await harness.getHandler('/dashboard/upcoming-deadlines')({
    authUser: { id: 'user-1', role: 'manager' },
  }, response);

  assert.match(capturedQuery, /from requests/i);
  assert.match(capturedQuery, /type <> 'installation'/i);
  assert.match(capturedQuery, /deleted_at is null/i);
  assert.equal(capturedValues[0], today);
  assert.equal(capturedValues[1], addDays(today, 7));
  assert.deepEqual(response.body, {
    items: [{
      id: 'request-3',
      title: 'Ближайшая заявка',
      type: 'service_request',
      dueDate: deadlineDate,
      daysUntil: 3,
    }],
  });
});
