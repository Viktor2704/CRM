/**
 * Normalize API responses that may return data as array or as { items, data, ... } wrapper.
 */
export const normalizeList = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['items', 'requests', 'users', 'tenants', 'directions', 'maintenanceItems', 'data']) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
  }
  return [];
};
