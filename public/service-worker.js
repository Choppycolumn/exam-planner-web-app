const CACHE_PREFIX = 'exam-planner-';
const ASSET_CACHE_NAME = `${CACHE_PREFIX}assets-v7`;
const PUBLIC_CACHE_NAME = `${CACHE_PREFIX}public-v7`;
const PUBLIC_PATHS = new Set([
  '/manifest.webmanifest',
  '/app-icon.svg',
  '/favicon.svg',
  '/assets/pwa-icon-192.png',
  '/assets/pwa-icon-512.png',
]);

function contentTypeMatches(request, response) {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const destination = request.destination;
  if (destination === 'script') return contentType.includes('javascript');
  if (destination === 'style') return contentType.includes('text/css');
  if (destination === 'image') return contentType.startsWith('image/');
  if (destination === 'font') return contentType.startsWith('font/') || contentType.includes('application/font');
  if (new URL(request.url).pathname.endsWith('.webmanifest')) return contentType.includes('json');
  return false;
}

async function cacheValidatedResponse(cacheName, request, response) {
  if (response.ok && contentTypeMatches(request, response)) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(ASSET_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached && contentTypeMatches(request, cached)) return cached;
  if (cached) await cache.delete(request);
  return cacheValidatedResponse(ASSET_CACHE_NAME, request, await fetch(request));
}

async function networkFirstPublicAsset(request) {
  try {
    return await cacheValidatedResponse(PUBLIC_CACHE_NAME, request, await fetch(request));
  } catch (error) {
    const cached = await caches.match(request);
    if (cached && contentTypeMatches(request, cached)) return cached;
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && ![ASSET_CACHE_NAME, PUBLIC_CACHE_NAME].includes(key))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/health') || url.pathname.startsWith('/ready')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => new Response(
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title></head><body><main><h1>Offline</h1><p>Reconnect and refresh this page.</p></main></body></html>',
        { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
      )),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirstAsset(request));
    return;
  }

  if (PUBLIC_PATHS.has(url.pathname)) {
    event.respondWith(networkFirstPublicAsset(request));
  }
});
