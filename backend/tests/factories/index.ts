import { randomUUID } from 'crypto';

export interface UserFactory {
  id?: string;
  email?: string;
  fullName?: string;
  role?: string;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const createUser = (overrides: UserFactory = {}): any => {
  const id = overrides.id || randomUUID();
  const now = new Date();

  return {
    id,
    email: overrides.email || `user-${id.slice(0, 8)}@example.com`,
    fullName: overrides.fullName || `Test User ${id.slice(0, 8)}`,
    role: overrides.role || 'user',
    status: overrides.status || 'active',
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$test',
    mustChangePassword: false,
    projectId: null,
  };
};

export const createAdmin = (overrides: UserFactory = {}): any => {
  return createUser({ ...overrides, role: 'admin' });
};

export const createManager = (overrides: UserFactory = {}): any => {
  return createUser({ ...overrides, role: 'manager' });
};

export const createDispatcher = (overrides: UserFactory = {}): any => {
  return createUser({ ...overrides, role: 'dispatcher' });
};

export const createExecutor = (overrides: UserFactory = {}): any => {
  return createUser({ ...overrides, role: 'executor' });
};

export interface ServiceRequestFactory {
  id?: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  type?: string;
  createdById?: string;
  assignedToId?: string | null;
  projectId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export const createServiceRequest = (overrides: ServiceRequestFactory = {}): any => {
  const id = overrides.id || randomUUID();
  const now = new Date();

  return {
    id,
    title: overrides.title || `Service Request ${id.slice(0, 8)}`,
    description: overrides.description || 'Test service request description',
    status: overrides.status || 'new',
    priority: overrides.priority || 'medium',
    type: overrides.type || 'general',
    createdById: overrides.createdById || randomUUID(),
    assignedToId: overrides.assignedToId || null,
    projectId: overrides.projectId || null,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    scheduledFor: null,
    completedAt: null,
    address: '123 Test St',
    contactName: 'Test Contact',
    contactPhone: '+1234567890',
  };
};

export interface ProjectFactory {
  id?: string;
  name?: string;
  address?: string;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const createProject = (overrides: ProjectFactory = {}): any => {
  const id = overrides.id || randomUUID();
  const now = new Date();

  return {
    id,
    name: overrides.name || `Project ${id.slice(0, 8)}`,
    address: overrides.address || '123 Project Ave',
    status: overrides.status || 'active',
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    description: 'Test project description',
    clientName: 'Test Client',
    clientPhone: '+1234567890',
  };
};

export interface InstallationFactory {
  id?: string;
  name?: string;
  projectId?: string;
  type?: string;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const createInstallation = (overrides: InstallationFactory = {}): any => {
  const id = overrides.id || randomUUID();
  const now = new Date();

  return {
    id,
    name: overrides.name || `Installation ${id.slice(0, 8)}`,
    projectId: overrides.projectId || randomUUID(),
    type: overrides.type || 'fire_alarm',
    status: overrides.status || 'active',
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    location: 'Building A, Floor 1',
    serialNumber: `SN-${id.slice(0, 8)}`,
  };
};

export interface TenantFactory {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
  projectId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const createTenant = (overrides: TenantFactory = {}): any => {
  const id = overrides.id || randomUUID();
  const now = new Date();

  return {
    id,
    name: overrides.name || `Tenant ${id.slice(0, 8)}`,
    email: overrides.email || `tenant-${id.slice(0, 8)}@example.com`,
    phone: overrides.phone || '+1234567890',
    projectId: overrides.projectId || randomUUID(),
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    address: '456 Tenant Rd',
    contactPerson: 'Test Contact',
  };
};
