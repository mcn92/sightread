const CACHE_VERSION = 'sightread-m1-sw-v1';
const APP_CACHE = `${CACHE_VERSION}:app`;
const PACK_CACHE = `${CACHE_VERSION}:packs`;
const CORE_ASSETS = ['/', '/index.html', '/web-tree-sitter.wasm'];
const PACK_PREFIX = '/packs/py/v0/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => !name.startsWith(CACHE_VERSION)).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, APP_CACHE, '/index.html'));
    return;
  }

  if (url.pathname.startsWith(PACK_PREFIX)) {
    event.respondWith(cacheFirst(request, PACK_CACHE));
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.wasm')) {
    event.respondWith(cacheFirst(request, APP_CACHE));
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(networkFirst(request, APP_CACHE, '/index.html'));
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  await cacheIfOk(cache, request, response);
  return response;
}

async function networkFirst(request, cacheName, fallbackPath) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    await cacheIfOk(cache, request, response);
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match(fallbackPath)) || Response.error();
  }
}

async function cacheIfOk(cache, request, response) {
  if (response.ok) {
    await cache.put(request, response.clone());
  }
}
