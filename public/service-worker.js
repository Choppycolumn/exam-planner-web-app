const CACHE_NAME = 'exam-planner-shell-v6';
const ASSET_CACHE_NAME = 'exam-planner-assets-v6';
const APP_SHELL = ['/', '/manifest.webmanifest', '/app-icon.svg', '/assets/pwa-icon-192.png', '/assets/pwa-icon-512.png', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => ![CACHE_NAME, ASSET_CACHE_NAME].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/health')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request).then((response) => {
        if (response.ok && ['script', 'style', 'image', 'font'].includes(request.destination)) {
          const copy = response.clone();
          caches.open(ASSET_CACHE_NAME).then((cache) => cache.put(request, copy));
        } else if (response.ok && request.destination === 'manifest') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
      return cached || fetched;
    }),
  );
});
