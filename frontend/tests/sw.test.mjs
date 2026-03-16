import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serviceWorkerPath = path.resolve(__dirname, '../public/sw.js');

const createHeaders = (entries = {}) => {
  const normalized = new Map(
    Object.entries(entries).map(([key, value]) => [key.toLowerCase(), String(value)])
  );

  return {
    get(name) {
      return normalized.get(String(name).toLowerCase()) ?? null;
    },
  };
};

const createResponse = ({ status = 200, headers = {}, body = 'ok' } = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: createHeaders(headers),
  body,
  clone() {
    return createResponse({ status, headers, body });
  },
});

const createRequest = (url, overrides = {}) => ({
  url,
  method: 'GET',
  mode: 'same-origin',
  ...overrides,
});

const createFetchEvent = (request) => {
  let responsePromise = null;
  let responded = false;

  return {
    request,
    get responded() {
      return responded;
    },
    get responsePromise() {
      return responsePromise;
    },
    respondWith(promiseLike) {
      responded = true;
      responsePromise = Promise.resolve(promiseLike);
    },
  };
};

const loadServiceWorker = async ({ fetchImpl, cachedResponses = {} } = {}) => {
  const source = await readFile(serviceWorkerPath, 'utf8');
  const listeners = new Map();
  const puts = [];
  const fetchCalls = [];
  const cacheEntries = new Map(Object.entries(cachedResponses));

  const cache = {
    async addAll(assets) {
      for (const asset of assets) {
        cacheEntries.set(asset, createResponse());
      }
    },
    async put(request, response) {
      const key = typeof request === 'string' ? request : request.url;
      puts.push(key);
      cacheEntries.set(key, response);
    },
  };

  const context = {
    URL,
    caches: {
      async open() {
        return cache;
      },
      async match(request) {
        const key = typeof request === 'string' ? request : request.url;
        return cacheEntries.get(key) ?? null;
      },
      async keys() {
        return ['legacy-cache'];
      },
      async delete() {
        return true;
      },
    },
    fetch: async (request) => {
      fetchCalls.push(typeof request === 'string' ? request : request.url);
      return fetchImpl ? fetchImpl(request) : createResponse();
    },
    self: {
      location: { origin: 'https://example.test' },
      clients: { claim() {} },
      skipWaiting() {},
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
    },
  };

  vm.runInNewContext(source, context, { filename: serviceWorkerPath });

  return {
    fetchCalls,
    listeners,
    puts,
  };
};

test('service worker bypasses legacy protected upload URLs', async () => {
  const harness = await loadServiceWorker();
  const request = createRequest('https://example.test/uploads/2026/03/private.pdf');
  const event = createFetchEvent(request);

  harness.listeners.get('fetch')(event);

  assert.equal(event.responded, false);
  assert.deepEqual(harness.fetchCalls, []);
  assert.deepEqual(harness.puts, []);
});

test('service worker does not cache responses marked as private', async () => {
  const harness = await loadServiceWorker({
    fetchImpl: async () =>
      createResponse({
        headers: {
          'cache-control': 'private, max-age=3600',
        },
      }),
  });
  const request = createRequest('https://example.test/assets/app.js');
  const event = createFetchEvent(request);

  harness.listeners.get('fetch')(event);
  await event.responsePromise;

  assert.equal(event.responded, true);
  assert.deepEqual(harness.fetchCalls, ['https://example.test/assets/app.js']);
  assert.deepEqual(harness.puts, []);
});

test('service worker caches public runtime assets', async () => {
  const harness = await loadServiceWorker({
    fetchImpl: async () =>
      createResponse({
        headers: {
          'cache-control': 'public, max-age=31536000',
        },
      }),
  });
  const request = createRequest('https://example.test/assets/app.js');
  const event = createFetchEvent(request);

  harness.listeners.get('fetch')(event);
  await event.responsePromise;

  assert.equal(event.responded, true);
  assert.deepEqual(harness.puts, ['https://example.test/assets/app.js']);
});

test('service worker caches navigation shell but not attachments', async () => {
  const harness = await loadServiceWorker({
    fetchImpl: async () => createResponse(),
  });
  const request = createRequest('https://example.test/projects?focus=123', {
    mode: 'navigate',
  });
  const event = createFetchEvent(request);

  harness.listeners.get('fetch')(event);
  await event.responsePromise;

  assert.equal(event.responded, true);
  assert.deepEqual(harness.puts, ['https://example.test/projects?focus=123']);
});
