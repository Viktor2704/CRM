export const USER_ROLES = [
    'admin',
    'manager',
    'dispatcher',
    'curator',
    'executor',
    'installer',
    'client_manager',
    'client_user',
    'user',
];
export const USER_STATUSES = ['active', 'invited', 'blocked', 'deactivated'];
export const INTERNAL_GLOBAL_ROLES_ARRAY = ['admin', 'manager', 'curator', 'dispatcher'];
export const INTERNAL_GLOBAL_ROLES = new Set(INTERNAL_GLOBAL_ROLES_ARRAY);
export const INTERNAL_ASSIGNED_ROLES = new Set(['executor']);
export const CONTRACTOR_ROLES = new Set<string>();
export const CLIENT_ROLES = new Set(['installer', 'client_manager', 'client_user', 'user']);
export const INTERNAL_ROLES = new Set([...INTERNAL_GLOBAL_ROLES, ...INTERNAL_ASSIGNED_ROLES]);
export const EXTERNAL_ROLES = new Set([...CONTRACTOR_ROLES, ...CLIENT_ROLES]);
export const LEGACY_EXTERNAL_ROLES = new Set(['user']);
export const roleRequiresCounterparty = (role) => CLIENT_ROLES.has(role) || CONTRACTOR_ROLES.has(role);
export const roleRequiresTenantCounterparty = (role) => CLIENT_ROLES.has(role);
export const roleRequiresContractorCounterparty = (role) => CONTRACTOR_ROLES.has(role);
export const roleAllowsGlobalBinding = (role) => INTERNAL_GLOBAL_ROLES.has(role);
