import { useAuth } from '@/auth/AuthContext';
import { UserRole } from '@/types';

const MANAGE_ROLES = new Set<string>([
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.CURATOR,
  UserRole.DISPATCHER,
]);

export function usePermissions() {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const canManage = MANAGE_ROLES.has(role);
  const isAdmin = role === UserRole.ADMIN;
  const isAdminOrManager = role === UserRole.ADMIN || role === UserRole.MANAGER;
  return { canManage, isAdmin, isAdminOrManager, role };
}
