import { appConfig } from '../config.js';
import { createOpaqueToken, signAccessToken } from '../security.js';

export const localMockAuthEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.LOCAL_MOCK_AUTH ?? '').trim().toLowerCase());
export const localMockUsers = [
    {
        id: 'local-admin-1',
        fullName: 'Local Admin',
        email: 'admin@novinzhstroy.ru',
        role: 'admin',
        status: 'active',
    },
    {
        id: 'local-manager-1',
        fullName: 'Local Manager',
        email: 'manager@novinzhstroy.ru',
        role: 'manager',
        status: 'active',
    },
    {
        id: 'local-dispatcher-1',
        fullName: 'Local Dispatcher',
        email: 'dispatch@novinzhstroy.ru',
        role: 'dispatcher',
        status: 'active',
    },
    {
        id: 'local-executor-1',
        fullName: 'Local Executor',
        email: 'ivan@tech.ru',
        role: 'executor',
        status: 'active',
    },
    {
        id: 'local-client-mgr-1',
        fullName: 'Local Client Manager',
        email: 'client@company.ru',
        role: 'client_manager',
        status: 'active',
        bindings: { counterpartyId: 'mock-tenant-1' },
    },
    {
        id: 'local-client-user-1',
        fullName: 'Local Client User',
        email: 'user@company.ru',
        role: 'client_user',
        status: 'active',
        bindings: { counterpartyId: 'mock-tenant-1' },
    },
    {
        id: 'local-invited-1',
        fullName: 'Invited User',
        email: 'invited@test.ru',
        role: 'executor',
        status: 'invited',
    },
    {
        id: 'local-blocked-1',
        fullName: 'Blocked User',
        email: 'blocked@test.ru',
        role: 'user',
        status: 'blocked',
    },
];
export const localMockUsersByEmail = new Map(localMockUsers.map((user) => [user.email.toLowerCase(), user]));
export const localMockRefreshTokens = new Map();
export const localMockTenants = [
    {
        id: 'mock-tenant-1',
        name: 'ООО Ромашка',
        brandName: 'Ромашка',
        inn: '7701234567',
        contacts: [
            {
                id: 'c1',
                fullName: 'Иванов И.И.',
                position: 'Директор',
                email: 'ivanov@romashka.ru',
                phone: '+79001234567',
            },
        ],
    },
    {
        id: 'mock-tenant-2',
        name: 'ООО Василёк',
        brandName: 'Василёк',
        inn: '7709876543',
        contacts: [],
    },
];
export const localMockDirections = [
    {
        id: 'mock-dir-1',
        name: 'Северное направление',
        address: 'г. Москва, ул. Северная, 10',
        tenantId: 'mock-tenant-1',
        tenantName: 'Ромашка',
        description: 'Обслуживание северного района',
        createdById: 'local-admin-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
    {
        id: 'mock-dir-2',
        name: 'Южное направление',
        address: 'г. Москва, ул. Южная, 5',
        tenantId: 'mock-tenant-2',
        tenantName: 'Василёк',
        description: '',
        createdById: 'local-admin-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
];
export const localMockMaintenanceItems = [
    {
        id: 'mock-mi-1',
        directionId: 'mock-dir-1',
        positionNumber: '1',
        name: 'Кинотеатр "Времена Года"',
        address: '5 этаж, пом. I',
        legalEntity: 'ООО "ВГ СИНЕМА"',
        contractNumber: '№48ОНИС/10-25',
        systems: {
            aps: true,
            soue: true,
            aupt: true,
            vpv: true,
            fireExtinguishers: true,
            exitSigns: true,
            gas: false,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
    {
        id: 'mock-mi-2',
        directionId: 'mock-dir-1',
        positionNumber: '2',
        name: 'RosesLace',
        address: '1 этаж, секция 4',
        legalEntity: 'Розеслейс',
        contractNumber: '№49ОНИС/11-25',
        systems: {
            aps: true,
            soue: true,
            aupt: false,
            vpv: false,
            fireExtinguishers: true,
            exitSigns: true,
            gas: false,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
];
export const localMockStaffRoles = new Set(['admin', 'manager', 'curator', 'dispatcher', 'executor']);
export const localMockClientRoles = new Set(['client_manager', 'client_user', 'user']);
export const toLocalMockApiUser = (user) => {
    return {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone ?? null,
        role: user.role,
        status: user.status ?? 'active',
        bindings: user.bindings ?? {},
        createdAt: user.createdAt ?? '2026-02-22T00:00:00.000Z',
    };
};
export const createLocalMockSession = (user) => {
    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    const refreshToken = createOpaqueToken();
    const ttlMs = Math.max(1, appConfig.refreshTokenTtlDays) * 24 * 60 * 60 * 1000;
    localMockRefreshTokens.set(refreshToken, {
        userId: user.id,
        role: user.role,
        expiresAt: Date.now() + ttlMs,
    });
    return {
        accessToken,
        expiresIn: appConfig.accessTokenTtlSeconds,
        refreshToken,
        user: toLocalMockApiUser(user),
    };
};
