export enum UserRole {
  ADMIN = 'admin',
  MANAGER = 'manager',
  CURATOR = 'curator',
  DISPATCHER = 'dispatcher',
  EXECUTOR = 'executor',
  INSTALLER = 'installer',
  CLIENT_MANAGER = 'client_manager',
  CLIENT_USER = 'client_user',
  USER = 'user',
}

export enum UserStatus {
  ACTIVE = 'active',
  INVITED = 'invited',
  BLOCKED = 'blocked',
  DEACTIVATED = 'deactivated',
}

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  phone?: string;
  avatarUrl?: string;
  telegramId?: string;
  companyName?: string | null;
  createdAt: string;
  bindings?: {
    counterpartyId?: string | null;
    directionIds?: string[];
    isGlobal?: boolean;
  };
}

export enum SystemType {
  APS = 'aps',
  SOUE = 'soue',
  AUPT = 'aupt',
  VPV = 'vpv',
  FIRE_EXTINGUISHERS = 'fireExtinguishers',
  EXIT_SIGNS = 'exitSigns',
  GAS = 'gas',
  SKUD = 'skud',
  SKS = 'sks',
  SVN = 'svn',
  ASUTP = 'asutp',
  SOTS = 'sots',
}

export const SYSTEM_LABELS: Record<SystemType, string> = {
  [SystemType.APS]: 'АПС',
  [SystemType.SOUE]: 'СОУЭ',
  [SystemType.AUPT]: 'АУПТ',
  [SystemType.VPV]: 'ВПВ',
  [SystemType.FIRE_EXTINGUISHERS]: 'Огнетушители',
  [SystemType.EXIT_SIGNS]: 'Табло ВЫХОД',
  [SystemType.GAS]: 'Газ',
  [SystemType.SKUD]: 'СКУД',
  [SystemType.SKS]: 'СКС',
  [SystemType.SVN]: 'СВН',
  [SystemType.ASUTP]: 'АСУ ТП',
  [SystemType.SOTS]: 'СОТС',
};

export interface Direction {
  id: string;
  name: string;
  address: string;
  tenantId?: string;
  tenantName?: string;
}

export type PartialRecord<K extends keyof any, V> = Partial<Record<K, V>>;

export interface MaintenanceItem {
  id: string;
  directionId: string;
  positionNumber: string;
  name: string;
  address?: string;
  legalEntity?: string;
  contractNumber?: string;
  tenantId?: string | null;
  managerId?: string | null;
  managerName?: string | null;
  systems: PartialRecord<SystemType, boolean>;
}

export interface Tenant {
  id: string;
  name: string;
  brandName?: string;
  inn?: string;
  email?: string;
  phone?: string;
  type?: 'tenant' | 'contractor';
}

export interface AppNotification {
  id: string;
  eventType: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  isRead: boolean;
  createdAt: string;
}

export enum ContractType {
  LEASE = 'lease',
  MAINTENANCE = 'maintenance',
  SUPPLY = 'supply',
  SERVICE = 'service',
}

export enum ContractStatus {
  ACTIVE = 'active',
  DRAFT = 'draft',
  EXPIRED = 'expired',
  TERMINATED = 'terminated',
}

export interface Contract {
  id: string;
  number: string;
  type: ContractType;
  directionId?: string;
  tenantId?: string;
  contractorId?: string;
  startDate: string;
  endDate: string;
  status: ContractStatus;
  description?: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
  expiresIn?: number;
}

export interface ApiListResponse<T> {
  items: T[];
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
}
