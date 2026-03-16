import { logger } from '../logger.js';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class InMemoryCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { data: value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async deletePattern(pattern: string): Promise<void> {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    if (keysToDelete.length > 0) {
      logger.info(`Cache cleanup: removed ${keysToDelete.length} expired entries`);
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
  }

  getStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// Singleton instance
export const cacheService = new InMemoryCache();

// Cache key builders
export const CacheKeys = {
  tenant: (id: string) => `tenant:${id}`,
  tenantList: (page: number, limit: number) => `tenants:list:${page}:${limit}`,
  user: (id: string) => `user:${id}`,
  userList: (page: number, limit: number) => `users:list:${page}:${limit}`,
  maintenanceItem: (id: string) => `maintenance_item:${id}`,
  maintenanceItemsByTenant: (tenantId: string) => `maintenance_items:tenant:${tenantId}`,
  serviceRequest: (id: string) => `service_request:${id}`,
  serviceRequestsList: (page: number, limit: number, status?: string) =>
    `service_requests:list:${page}:${limit}:${status || 'all'}`,
  dashboardStats: (userId: string) => `dashboard:stats:${userId}`,
  dashboardOverdue: () => `dashboard:overdue`,
  dashboardUpcoming: () => `dashboard:upcoming`,
  project: (id: string) => `project:${id}`,
  projectsList: (page: number, limit: number) => `projects:list:${page}:${limit}`,
};

// Cache invalidation helpers
export const invalidateCache = {
  tenant: async (id: string) => {
    await cacheService.delete(CacheKeys.tenant(id));
    await cacheService.deletePattern('tenants:list:*');
    await cacheService.deletePattern(`maintenance_items:tenant:${id}`);
  },
  user: async (id: string) => {
    await cacheService.delete(CacheKeys.user(id));
    await cacheService.deletePattern('users:list:*');
  },
  maintenanceItem: async (id: string, tenantId?: string) => {
    await cacheService.delete(CacheKeys.maintenanceItem(id));
    if (tenantId) {
      await cacheService.delete(CacheKeys.maintenanceItemsByTenant(tenantId));
    }
  },
  serviceRequest: async (id: string) => {
    await cacheService.delete(CacheKeys.serviceRequest(id));
    await cacheService.deletePattern('service_requests:list:*');
    await cacheService.deletePattern('dashboard:*');
  },
  project: async (id: string) => {
    await cacheService.delete(CacheKeys.project(id));
    await cacheService.deletePattern('projects:list:*');
    await cacheService.deletePattern('dashboard:*');
  },
  dashboard: async () => {
    await cacheService.deletePattern('dashboard:*');
  },
};

// Wrapper for cached queries
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  const cached = await cacheService.get<T>(key);
  if (cached !== null) {
    return cached;
  }

  const data = await fetchFn();
  await cacheService.set(key, data, ttlSeconds);
  return data;
}
