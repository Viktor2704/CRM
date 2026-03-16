import assert from 'node:assert/strict';

import { canActorAccessAccessRequest } from '../src/helpers/accessRequestAccess.js';
import { canActorAccessStoredFile, registerUploadedFile } from '../src/helpers/fileAccess.js';
import { appendMaintenancePlanScopeCondition } from '../src/helpers/calendarAccess.js';
import { canActorAccessDirection } from '../src/helpers/directionAccess.js';
import { filterNotificationRecipientIdsByEntityScope } from '../src/helpers/notificationRecipientScope.js';
import { requireAdminLike, requireTenantPageAccess, requireUserPageAccess } from '../src/middleware/auth.js';
import { canExportDirections } from '../src/routes/directions.js';
import { canExportInstallations } from '../src/routes/installations.js';
import { canExportMaintenanceItems } from '../src/routes/maintenanceItems.js';
import { canExportMaintenancePlans } from '../src/routes/maintenancePlans.js';
import { canExportProjects } from '../src/routes/projects.js';
import { canExportServiceRequests } from '../src/routes/serviceRequests.js';
import {
  loadProjectTenantId,
  resolveRecipientForNotification,
  resolveRecipientFromCounterpartyId,
} from '../src/services/notificationAccessService.js';

const ids = {
  tenantA: '11111111-1111-4111-8111-111111111111',
  tenantB: '22222222-2222-4222-8222-222222222222',
  tenantC: '33333333-3333-4333-8333-333333333333',
  admin: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  executorAssigned: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  executorUnassigned: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  clientManagerA: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  installerA: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  clientManagerB: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  installerB: '99999999-9999-4999-8999-999999999999',
  installerOnlyC: 'abababab-abab-4bab-8bab-abababababab',
  requestA: '12121212-1212-4212-8212-121212121212',
  requestB: '34343434-3434-4434-8434-343434343434',
  projectA: '78787878-7878-4878-8878-787878787878',
  installationA: '68686868-6868-4868-8868-686868686868',
  directionA: '45454545-4545-4454-8454-454545454545',
  directionB: '67676767-6767-4767-8767-676767676767',
  planA: '89898989-8989-4898-8898-898989898989',
  accessRequestA: '90909090-9090-4090-8090-909090909090',
  accessRequestB: '91919191-9191-4191-8191-919191919191',
  orphanFile: '56565656-5656-4565-8565-565656565656',
};

const users = [
  { id: ids.admin, role: 'admin', email: 'admin@example.com', fullName: 'Admin', counterpartyId: '' },
  { id: ids.executorAssigned, role: 'executor', email: 'exec.a@example.com', fullName: 'Executor A', counterpartyId: '' },
  { id: ids.executorUnassigned, role: 'executor', email: 'exec.b@example.com', fullName: 'Executor B', counterpartyId: '' },
  { id: ids.clientManagerA, role: 'client_manager', email: 'client.a@example.com', fullName: 'Client A', counterpartyId: ids.tenantA },
  { id: ids.installerA, role: 'installer', email: 'installer.a@example.com', fullName: 'Installer A', counterpartyId: ids.tenantA },
  { id: ids.clientManagerB, role: 'client_manager', email: 'client.b@example.com', fullName: 'Client B', counterpartyId: ids.tenantB },
  { id: ids.installerB, role: 'installer', email: 'installer.b@example.com', fullName: 'Installer B', counterpartyId: ids.tenantB },
  { id: ids.installerOnlyC, role: 'installer', email: 'installer.c@example.com', fullName: 'Installer C', counterpartyId: ids.tenantC },
];

const tenants = [
  { id: ids.tenantA, tenant_name: 'Tenant A', contacts: [{ email: 'contact.a@example.com', fullName: 'Contact A' }] },
  { id: ids.tenantB, tenant_name: 'Tenant B', contacts: [{ email: 'contact.b@example.com', fullName: 'Contact B' }] },
  { id: ids.tenantC, tenant_name: 'Tenant C', contacts: [] },
];

const directions = [
  { id: ids.directionA, tenantId: ids.tenantA, deletedAt: null },
  { id: ids.directionB, tenantId: ids.tenantB, deletedAt: null },
];

const maintenancePlans = [
  {
    id: ids.planA,
    isActive: true,
    directionId: ids.directionA,
    defaultExecutorIds: [ids.executorAssigned],
  },
];

const requests = [
  {
    id: ids.requestA,
    type: 'service_request',
    isProject: false,
    tenantId: ids.tenantA,
    directionId: ids.directionA,
    createdById: ids.clientManagerA,
    curatorId: '',
    executorIds: [ids.executorAssigned],
    files: [{ url: '/api/uploads/requests/tenant-a.pdf', name: 'tenant-a.pdf' }],
  },
  {
    id: ids.requestB,
    type: 'service_request',
    isProject: false,
    tenantId: ids.tenantB,
    directionId: ids.directionB,
    createdById: ids.clientManagerB,
    curatorId: '',
    executorIds: [],
    files: [{ url: '/api/uploads/requests/tenant-b.pdf', name: 'tenant-b.pdf' }],
  },
  {
    id: ids.projectA,
    type: 'project',
    isProject: true,
    tenantId: ids.tenantA,
    directionId: ids.directionA,
    createdById: ids.clientManagerA,
    curatorId: '',
    executorIds: [ids.executorAssigned],
    files: [],
  },
  {
    id: ids.installationA,
    type: 'installation',
    isProject: false,
    tenantId: ids.tenantA,
    directionId: ids.directionA,
    createdById: ids.clientManagerA,
    curatorId: '',
    executorIds: [ids.executorAssigned],
    files: [],
  },
];

const procurementItems = [
  {
    installationId: ids.installationA,
    files: [{ url: '/api/uploads/procurement/tenant-a-proc.pdf', name: 'tenant-a-proc.pdf' }],
  },
];

const accessRequests = [
  {
    id: ids.accessRequestA,
    createdById: ids.clientManagerA,
  },
  {
    id: ids.accessRequestB,
    createdById: ids.clientManagerB,
  },
];

const uploadedFiles = new Map<string, { uploadedById: string }>();

const normalize = (value: unknown) => String(value ?? '').trim();
const compactSql = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

const sortClientRecipients = (items: typeof users) => {
  const rank = new Map([
    ['client_manager', 0],
    ['client_user', 1],
    ['user', 2],
    ['installer', 2],
  ]);
  return [...items].sort((left, right) => {
    const leftRank = rank.get(left.role) ?? 9;
    const rightRank = rank.get(right.role) ?? 9;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.id.localeCompare(right.id);
  });
};

const expectMiddlewareAllows = (middleware: (request: any, response: any, next: () => void) => void, role: string, message: string) => {
  let nextCalled = false;
  middleware({ authUser: { role } }, {}, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true, message);
};

const expectMiddlewareDenies = (middleware: (request: any, response: any, next: () => void) => void, role: string, message: string) => {
  assert.throws(
    () => middleware({ authUser: { role } }, {}, () => {}),
    (error: any) => error?.code === 'FORBIDDEN',
    message,
  );
};

const queryFn = async (text: string, values: unknown[] = []) => {
  const sql = compactSql(text);

  if (
    sql.startsWith('create table if not exists uploaded_files') ||
    sql.startsWith('create index if not exists uploaded_files_uploaded_by_idx') ||
    sql.startsWith('create index if not exists idx_app_notifications') ||
    sql.startsWith('alter table app_notification_digest_queue') ||
    sql.startsWith('create table if not exists app_notification_') ||
    sql.startsWith('create index if not exists idx_app_notification_')
  ) {
    return { rows: [] };
  }

  if (sql.startsWith('insert into uploaded_files(')) {
    uploadedFiles.set(normalize(values[1]), { uploadedById: normalize(values[5]) });
    return { rows: [] };
  }

  if (sql.includes('from uploaded_files') && sql.includes('where storage_key = $1::text')) {
    const row = uploadedFiles.get(normalize(values[0]));
    return { rows: row ? [{ uploaded_by_id: row.uploadedById }] : [] };
  }

  if (sql.includes('from app_user_bindings') && sql.includes('where user_id = $1::uuid')) {
    const user = users.find((item) => item.id === normalize(values[0]));
    return { rows: user && user.counterpartyId ? [{ counterparty_id: user.counterpartyId }] : [] };
  }

  if (sql.includes('from app_users') && sql.includes('where id = any($1::uuid[])') && sql.includes('role::text as role')) {
    const idsToLoad = Array.isArray(values[0]) ? values[0].map((item) => normalize(item)) : [];
    return {
      rows: users
        .filter((item) => idsToLoad.includes(item.id))
        .map((item) => ({ id: item.id, role: item.role })),
    };
  }

  if (sql.includes('from app_users') && sql.includes('where id = any($1::uuid[])') && sql.includes('coalesce(trim(email), \'\') <> \'\'')) {
    const idsToLoad = Array.isArray(values[0]) ? values[0].map((item) => normalize(item)) : [];
    return {
      rows: users
        .filter((item) => idsToLoad.includes(item.id))
        .map((item) => ({
          id: item.id,
          user_id: item.id,
          email: item.email,
          full_name: item.fullName,
          role: item.role,
        })),
    };
  }

  if (sql.includes('from app_users u') && sql.includes('join app_user_bindings ub on ub.user_id = u.id') && sql.includes('where u.id = $1::uuid') && sql.includes('ub.counterparty_id = $2::uuid')) {
    const userId = normalize(values[0]);
    const counterpartyId = normalize(values[1]);
    const user = users.find((item) => item.id === userId && item.counterpartyId === counterpartyId);
    const tenant = tenants.find((item) => item.id === counterpartyId);
    return {
      rows: user ? [{
        email: user.email,
        full_name: user.fullName,
        tenant_name: tenant?.tenant_name ?? '',
      }] : [],
    };
  }

  if (sql.includes('from app_users u') && sql.includes('join app_user_bindings ub on ub.user_id = u.id') && sql.includes('lower(trim(u.email)) = $2')) {
    const counterpartyId = normalize(values[0]);
    const email = normalize(values[1]).toLowerCase();
    const tenant = tenants.find((item) => item.id === counterpartyId);
    const user = users.find((item) => item.counterpartyId === counterpartyId && item.email === email);
    return {
      rows: user ? [{
        email: user.email,
        full_name: user.fullName,
        tenant_name: tenant?.tenant_name ?? '',
      }] : [],
    };
  }

  if (sql.includes('from app_users u') && sql.includes('join app_user_bindings ub on ub.user_id = u.id') && sql.includes('where ub.counterparty_id = $1::uuid') && sql.includes('u.role::text = any($2::text[])')) {
    const counterpartyId = normalize(values[0]);
    const allowedRoles = Array.isArray(values[1]) ? values[1].map((item) => normalize(item)) : [];
    const tenant = tenants.find((item) => item.id === counterpartyId);
    const rows = sortClientRecipients(users.filter((item) => item.counterpartyId === counterpartyId && allowedRoles.includes(item.role)))
      .map((item) => ({
        email: item.email,
        full_name: item.fullName,
        tenant_name: tenant?.tenant_name ?? '',
      }));
    return { rows };
  }

  if (sql.includes('from app_users u') && sql.includes('where u.id = $1::uuid') && sql.includes('coalesce(trim(u.email), \'\') <> \'\'')) {
    const user = users.find((item) => item.id === normalize(values[0]));
    return {
      rows: user ? [{ email: user.email, full_name: user.fullName }] : [],
    };
  }

  if (sql.includes('from tenants t') && sql.includes('where t.id = $1::uuid')) {
    const tenant = tenants.find((item) => item.id === normalize(values[0]));
    return {
      rows: tenant ? [{ tenant_name: tenant.tenant_name, contacts: tenant.contacts }] : [],
    };
  }

  if (sql.startsWith('select 1 from directions d') && sql.includes('limit 1')) {
    const direction = directions.find((item) => item.id === normalize(values[0]) && item.deletedAt == null);
    if (!direction) {
      return { rows: [] };
    }
    if (values.length === 1) {
      return { rows: [{ ok: 1 }] };
    }
    if (sql.includes('d.tenant_id = $2::text')) {
      return { rows: direction.tenantId === normalize(values[1]) ? [{ ok: 1 }] : [] };
    }
    const actorId = normalize(values[1]);
    const allowed = requests.some((item) => item.directionId === direction.id && (
      item.createdById === actorId ||
      item.curatorId === actorId ||
      item.executorIds.includes(actorId)
    ));
    return { rows: allowed ? [{ ok: 1 }] : [] };
  }

  if (sql.includes('select tenant_id::text as tenant_id from requests where id = $1::uuid')) {
    const request = requests.find((item) => item.id === normalize(values[0]));
    return { rows: request ? [{ tenant_id: request.tenantId }] : [] };
  }

  if (sql.startsWith('select 1 from maintenance_plans mp') && sql.includes('limit 1')) {
    const plan = maintenancePlans.find((item) => item.id === normalize(values[0]) && item.isActive);
    if (!plan) {
      return { rows: [] };
    }
    if (sql.includes('false')) {
      return { rows: [] };
    }
    if (values.length === 1) {
      return { rows: [{ ok: 1 }] };
    }
    const actorId = normalize(values[1]);
    return { rows: plan.defaultExecutorIds.includes(actorId) ? [{ ok: 1 }] : [] };
  }

  if (sql.includes('from requests') && sql.includes('coalesce(files, \'[]\'::jsonb)::text like')) {
    const needle = normalize(values[0]).replace(/%/g, '');
    return {
      rows: requests
        .filter((item) => JSON.stringify(item.files ?? []).includes(needle))
        .map((item) => ({
          id: item.id,
          type: item.type === 'installation' ? 'installation' : item.type,
          is_project: item.isProject,
          files: item.files ?? [],
          resolution_files: [],
        })),
    };
  }

  if (sql.includes('from request_comments c')) {
    return { rows: [] };
  }

  if (sql.includes('from project_chat_messages pcm')) {
    return { rows: [] };
  }

  if (sql.includes('from installation_procurement_items')) {
    const needle = normalize(values[0]).replace(/%/g, '');
    return {
      rows: procurementItems
        .filter((item) => JSON.stringify(item.files ?? []).includes(needle))
        .map((item) => ({
          installation_id: item.installationId,
          files: item.files ?? [],
        })),
    };
  }

  if (sql.includes('from access_requests')) {
    const accessRequest = accessRequests.find((item) => item.id === normalize(values[0]));
    if (!accessRequest) {
      return { rows: [] };
    }
    return {
      rows: accessRequest.createdById === normalize(values[1]) ? [{ ok: 1 }] : [],
    };
  }

  if (sql.includes('from requests r') && sql.includes('limit 1')) {
    const request = requests.find((item) => item.id === normalize(values[0]));
    if (!request) {
      return { rows: [] };
    }
    if (sql.includes("r.type <> 'installation'") && request.type === 'installation') {
      return { rows: [] };
    }
    if (sql.includes("r.type = 'installation'") && request.type !== 'installation') {
      return { rows: [] };
    }
    if (sql.includes('coalesce(r.is_project, false) = true') && request.isProject !== true) {
      return { rows: [] };
    }
    if (sql.includes('coalesce(r.is_project, false) = false') && request.isProject === true) {
      return { rows: [] };
    }
    if (values.length === 1) {
      return { rows: [{ ok: 1 }] };
    }
    if (sql.includes('r.tenant_id = $2::text')) {
      return { rows: request.tenantId === normalize(values[1]) ? [{ ok: 1 }] : [] };
    }
    const actorId = normalize(values[1]);
    const allowed =
      request.createdById === actorId ||
      request.curatorId === actorId ||
      request.executorIds.includes(actorId);
    return { rows: allowed ? [{ ok: 1 }] : [] };
  }

  throw new Error(`Unhandled query in RBAC regression script: ${text}`);
};

const run = async () => {
  expectMiddlewareAllows(requireUserPageAccess, 'admin', 'admin should access user registry');
  expectMiddlewareAllows(requireUserPageAccess, 'dispatcher', 'dispatcher should access user registry');
  expectMiddlewareAllows(requireTenantPageAccess, 'curator', 'curator should access tenant registry');
  expectMiddlewareAllows(requireAdminLike, 'manager', 'manager should keep admin-like mutate access');
  expectMiddlewareDenies(requireUserPageAccess, 'executor', 'executor must not access user registry');
  expectMiddlewareDenies(requireTenantPageAccess, 'installer', 'installer must not access tenant registry');
  expectMiddlewareDenies(requireAdminLike, 'dispatcher', 'dispatcher must not regain admin-like mutate access');
  assert.equal(
    canExportDirections('dispatcher', new Set(['admin', 'manager', 'curator', 'dispatcher'])),
    true,
    'dispatcher should keep direction export access'
  );
  assert.equal(
    canExportDirections('executor', new Set(['admin', 'manager', 'curator', 'dispatcher'])),
    false,
    'executor must not export directions'
  );
  assert.equal(
    canExportProjects('curator', new Set(['admin', 'manager', 'curator', 'dispatcher'])),
    true,
    'curator should keep project export access'
  );
  assert.equal(
    canExportProjects('installer', new Set(['admin', 'manager', 'curator', 'dispatcher'])),
    false,
    'installer must not export projects'
  );
  assert.equal(
    canExportInstallations('dispatcher', new Set(['admin', 'manager', 'curator', 'dispatcher'])),
    true,
    'dispatcher should keep installation export access'
  );
  assert.equal(
    canExportInstallations('executor', new Set(['admin', 'manager', 'curator', 'dispatcher'])),
    false,
    'executor must not export installations'
  );
  assert.equal(
    canExportServiceRequests('dispatcher', new Set(['admin', 'manager', 'curator', 'dispatcher'])),
    true,
    'dispatcher should keep service request export access'
  );
  assert.equal(
    canExportServiceRequests('executor', new Set(['admin', 'manager', 'curator', 'dispatcher'])),
    false,
    'executor must not export service requests'
  );
  assert.equal(
    canExportMaintenancePlans('curator', new Set(['admin', 'manager', 'curator', 'dispatcher'])),
    true,
    'curator should keep maintenance plan export access'
  );
  assert.equal(
    canExportMaintenancePlans('installer', new Set(['admin', 'manager', 'curator', 'dispatcher'])),
    false,
    'installer must not export maintenance plans'
  );
  assert.equal(
    canExportMaintenanceItems('dispatcher', new Set(['admin', 'manager', 'curator', 'dispatcher'])),
    true,
    'dispatcher should keep maintenance item export access'
  );
  assert.equal(
    canExportMaintenanceItems('installer', new Set(['admin', 'manager', 'curator', 'dispatcher'])),
    false,
    'installer must not export maintenance items'
  );

  const tenantDirectionAccess = await canActorAccessDirection({
    actorUserId: ids.installerA,
    actorRole: 'installer',
    directionId: ids.directionA,
    queryFn,
  });
  assert.equal(tenantDirectionAccess, true, 'tenant A installer should access own direction for calendar exports');

  const foreignDirectionAccess = await canActorAccessDirection({
    actorUserId: ids.installerB,
    actorRole: 'installer',
    directionId: ids.directionA,
    queryFn,
  });
  assert.equal(foreignDirectionAccess, false, 'tenant B installer must not access tenant A direction for calendar exports');

  const maintenancePlanConditions = [
    `mp.id = $1::uuid`,
    `mp.is_active = true`,
  ];
  const maintenancePlanValues: unknown[] = [ids.planA];
  appendMaintenancePlanScopeCondition({
    actorUserId: ids.installerA,
    actorRole: 'installer',
    conditions: maintenancePlanConditions,
    values: maintenancePlanValues,
  });
  const hiddenPlanResult = await queryFn(`select 1
    from maintenance_plans mp
    where ${maintenancePlanConditions.join(' and ')}
    limit 1`, maintenancePlanValues);
  assert.equal(hiddenPlanResult.rows.length, 0, 'client-scoped roles must not see maintenance plans in calendar scope');

  const executorPlanConditions = [
    `mp.id = $1::uuid`,
    `mp.is_active = true`,
  ];
  const executorPlanValues: unknown[] = [ids.planA];
  appendMaintenancePlanScopeCondition({
    actorUserId: ids.executorAssigned,
    actorRole: 'executor',
    conditions: executorPlanConditions,
    values: executorPlanValues,
  });
  const executorPlanResult = await queryFn(`select 1
    from maintenance_plans mp
    where ${executorPlanConditions.join(' and ')}
    limit 1`, executorPlanValues);
  assert.equal(executorPlanResult.rows.length, 1, 'assigned executor should keep maintenance plan visibility in calendar scope');

  const serviceRequestRecipients = await filterNotificationRecipientIdsByEntityScope({
    recipientIds: [
      ids.admin,
      ids.executorAssigned,
      ids.executorUnassigned,
      ids.installerA,
      ids.installerB,
    ],
    entityType: 'service_request',
    entityId: ids.requestA,
    queryFn,
  });
  assert.deepEqual(
    serviceRequestRecipients.sort(),
    [ids.admin, ids.executorAssigned, ids.installerA].sort(),
    'service_request scope should keep only admin, assigned executor, and tenant A client'
  );

  const tenantRecipients = await filterNotificationRecipientIdsByEntityScope({
    recipientIds: [ids.admin, ids.installerA, ids.installerB],
    entityType: 'tenant',
    entityId: ids.tenantA,
    queryFn,
  });
  assert.deepEqual(
    tenantRecipients.sort(),
    [ids.admin, ids.installerA].sort(),
    'tenant scope should keep only admin and bound tenant client'
  );

  const internalOnlyRecipients = await filterNotificationRecipientIdsByEntityScope({
    recipientIds: [ids.admin, ids.executorAssigned, ids.clientManagerA, ids.installerA],
    entityType: 'maintenance_plan',
    entityId: 'plan-1',
    queryFn,
  });
  assert.deepEqual(
    internalOnlyRecipients.sort(),
    [ids.admin, ids.executorAssigned].sort(),
    'internal-only notification entities must exclude client-scoped roles'
  );

  assert.equal(
    await canActorAccessAccessRequest({
      actorUserId: ids.admin,
      actorRole: 'admin',
      accessRequestId: ids.accessRequestA,
      queryFn,
    }),
    true,
    'admin should access any access request'
  );

  assert.equal(
    await canActorAccessAccessRequest({
      actorUserId: ids.clientManagerA,
      actorRole: 'client_manager',
      accessRequestId: ids.accessRequestA,
      queryFn,
    }),
    true,
    'request creator should access their own access request'
  );

  assert.equal(
    await canActorAccessAccessRequest({
      actorUserId: ids.clientManagerA,
      actorRole: 'client_manager',
      accessRequestId: ids.accessRequestB,
      queryFn,
    }),
    false,
    'non-owner should not access another access request'
  );

  const installerFallbackRecipient = await resolveRecipientFromCounterpartyId(ids.tenantC, queryFn);
  assert.equal(
    installerFallbackRecipient?.email,
    'installer.c@example.com',
    'tenant recipient resolution should include installer when it is the only client-scoped user'
  );

  const scopedRecipient = await resolveRecipientForNotification({
    recipient: {
      userId: ids.clientManagerA,
      email: 'client.a@example.com',
    },
    meta: {
      clientId: ids.tenantA,
      counterpartyId: ids.tenantA,
    },
  }, queryFn);
  assert.equal(scopedRecipient.email, 'client.a@example.com', 'scoped user recipient should resolve exact bound client');

  const projectTenantId = await loadProjectTenantId(ids.projectA, queryFn);
  assert.equal(projectTenantId, ids.tenantA, 'project tenant resolver should return tenant bound to project');

  const crossTenantRecipient = await resolveRecipientForNotification({
    recipient: {
      userId: ids.clientManagerB,
      email: 'client.b@example.com',
    },
    meta: {
      clientId: projectTenantId,
      counterpartyId: projectTenantId,
    },
  }, queryFn);
  assert.equal(crossTenantRecipient.email, 'client.a@example.com', 'cross-tenant recipient must not resolve to foreign tenant email');

  const tenantFileAccess = await canActorAccessStoredFile({
    storageKey: 'requests/tenant-a.pdf',
    actorUserId: ids.installerA,
    actorRole: 'installer',
    queryFn,
  });
  assert.equal(tenantFileAccess, true, 'tenant A installer should access own request file');

  const procurementTenantFileAccess = await canActorAccessStoredFile({
    storageKey: 'procurement/tenant-a-proc.pdf',
    actorUserId: ids.installerA,
    actorRole: 'installer',
    queryFn,
  });
  assert.equal(procurementTenantFileAccess, true, 'tenant A installer should access own procurement file');

  const procurementExecutorFileAccess = await canActorAccessStoredFile({
    storageKey: 'procurement/tenant-a-proc.pdf',
    actorUserId: ids.executorAssigned,
    actorRole: 'executor',
    queryFn,
  });
  assert.equal(procurementExecutorFileAccess, true, 'assigned executor should access installation procurement file');

  const foreignTenantFileAccess = await canActorAccessStoredFile({
    storageKey: 'requests/tenant-a.pdf',
    actorUserId: ids.installerB,
    actorRole: 'installer',
    queryFn,
  });
  assert.equal(foreignTenantFileAccess, false, 'tenant B installer must not access tenant A file');

  const foreignProcurementFileAccess = await canActorAccessStoredFile({
    storageKey: 'procurement/tenant-a-proc.pdf',
    actorUserId: ids.installerB,
    actorRole: 'installer',
    queryFn,
  });
  assert.equal(foreignProcurementFileAccess, false, 'tenant B installer must not access tenant A procurement file');

  await registerUploadedFile({
    fileId: ids.orphanFile,
    storageKey: 'uploads/orphan.txt',
    fileName: 'orphan.txt',
    mimeType: 'text/plain',
    sizeBytes: 12,
    uploadedById: ids.executorAssigned,
    queryFn,
  });

  const uploaderAccess = await canActorAccessStoredFile({
    storageKey: 'uploads/orphan.txt',
    actorUserId: ids.executorAssigned,
    actorRole: 'executor',
    queryFn,
  });
  assert.equal(uploaderAccess, true, 'uploader should access own unbound file');

  const foreignUploaderAccess = await canActorAccessStoredFile({
    storageKey: 'uploads/orphan.txt',
    actorUserId: ids.executorUnassigned,
    actorRole: 'executor',
    queryFn,
  });
  assert.equal(foreignUploaderAccess, false, 'another executor must not access foreign unbound file');

  console.log('RBAC regression checks passed');
};

run().catch((error) => {
  console.error('RBAC regression checks failed');
  console.error(error);
  process.exit(1);
});
