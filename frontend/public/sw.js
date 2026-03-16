const CACHE_NAME = 'novinzhstroy-v4-20260312-mobile-optimized';
const STATIC_ASSETS = ['/', '/manifest.json', '/icons/icon.svg'];
const PUBLIC_RUNTIME_PATH_PREFIXES = ['/assets/', '/icons/', '/tinymce/'];
const PROTECTED_PATH_PREFIXES = ['/api/uploads', '/uploads'];

const hasPathPrefix = (pathname, prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`);

const isProtectedPath = (pathname) =>
  PROTECTED_PATH_PREFIXES.some((prefix) => hasPathPrefix(pathname, prefix));

const isPublicRuntimeAssetPath = (pathname) =>
  pathname === '/manifest.json' ||
  PUBLIC_RUNTIME_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

const isSameOrigin = (url) => url.origin === self.location.origin;

const isCacheableResponse = (request, url, response) => {
  if (!response || !response.ok || !isSameOrigin(url) || isProtectedPath(url.pathname)) {
    return false;
  }

  const cacheControl = (response.headers.get('cache-control') || '').toLowerCase();
  if (cacheControl.includes('private')) {
    return false;
  }

  const contentDisposition = (response.headers.get('content-disposition') || '').toLowerCase();
  if (contentDisposition.includes('attachment')) {
    return false;
  }

  return request.mode === 'navigate' || isPublicRuntimeAssetPath(url.pathname);
};

const cacheResponse = async (request, url, response) => {
  if (!isCacheableResponse(request, url, response)) {
    return response;
  }

  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API calls — network only
  if (!isSameOrigin(url) || url.pathname.startsWith('/api/') || isProtectedPath(url.pathname)) {
    return;
  }

  // HTML navigation — prefer fresh network, fallback to cache only on failure.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => cacheResponse(request, url, response))
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  if (!isPublicRuntimeAssetPath(url.pathname)) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => cacheResponse(request, url, response))
      .catch(() => caches.match(request))
  );
});

// Push notification support
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Новинжстрой';
  const options = {
    body: data.body || 'Новое уведомление',
    icon: '/icons/icon.svg',
    badge: '/icons/icon.svg',
    data: data.url || '/',
    tag: data.tag || 'notification',
    requireInteraction: data.requireInteraction || false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data || '/')
  );
});
