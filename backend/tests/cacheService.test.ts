import { describe, it } from 'node:test';
import assert from 'node:assert';
import { cacheService, CacheKeys, withCache, invalidateCache } from '../src/services/cacheService.js';

describe('CacheService', () => {
  it('should set and get cache values', async () => {
    await cacheService.set('test-key', { data: 'test' }, 60);
    const value = await cacheService.get('test-key');
    assert.deepStrictEqual(value, { data: 'test' });
  });

  it('should return null for expired cache', async () => {
    await cacheService.set('expire-key', { data: 'test' }, 0);
    await new Promise(resolve => setTimeout(resolve, 100));
    const value = await cacheService.get('expire-key');
    assert.strictEqual(value, null);
  });

  it('should delete cache by key', async () => {
    await cacheService.set('delete-key', { data: 'test' }, 60);
    await cacheService.delete('delete-key');
    const value = await cacheService.get('delete-key');
    assert.strictEqual(value, null);
  });

  it('should delete cache by pattern', async () => {
    await cacheService.set('pattern:1', { data: 'test1' }, 60);
    await cacheService.set('pattern:2', { data: 'test2' }, 60);
    await cacheService.set('other:1', { data: 'test3' }, 60);

    await cacheService.deletePattern('pattern:*');

    const value1 = await cacheService.get('pattern:1');
    const value2 = await cacheService.get('pattern:2');
    const value3 = await cacheService.get('other:1');

    assert.strictEqual(value1, null);
    assert.strictEqual(value2, null);
    assert.deepStrictEqual(value3, { data: 'test3' });
  });

  it('should work with withCache helper', async () => {
    let callCount = 0;
    const fetchFn = async () => {
      callCount++;
      return { data: 'fetched' };
    };

    const result1 = await withCache('cache-helper', 60, fetchFn);
    const result2 = await withCache('cache-helper', 60, fetchFn);

    assert.deepStrictEqual(result1, { data: 'fetched' });
    assert.deepStrictEqual(result2, { data: 'fetched' });
    assert.strictEqual(callCount, 1); // Should only call once
  });

  it('should generate correct cache keys', () => {
    assert.strictEqual(CacheKeys.tenant('123'), 'tenant:123');
    assert.strictEqual(CacheKeys.user('456'), 'user:456');
    assert.strictEqual(CacheKeys.tenantList(1, 20), 'tenants:list:1:20');
  });

  it('should invalidate related caches', async () => {
    await cacheService.set(CacheKeys.tenant('123'), { name: 'Test' }, 60);
    await cacheService.set(CacheKeys.tenantList(1, 20), [{ id: '123' }], 60);

    await invalidateCache.tenant('123');

    const tenant = await cacheService.get(CacheKeys.tenant('123'));
    const list = await cacheService.get(CacheKeys.tenantList(1, 20));

    assert.strictEqual(tenant, null);
    assert.strictEqual(list, null);
  });
});
