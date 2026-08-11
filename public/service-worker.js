const CACHE_PREFIX = 'exam-planner-';
const ASSET_CACHE_NAME = `${CACHE_PREFIX}assets-v9`;
const PUBLIC_CACHE_NAME = `${CACHE_PREFIX}public-v9`;
const NAVIGATION_CACHE_NAME = `${CACHE_PREFIX}navigation-v9`;
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

function isHtmlResponse(response) {
  return response.ok && (response.headers.get('content-type') || '').toLowerCase().includes('text/html');
}

async function fetchWithTimeout(request, timeoutMs = 6000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function navigationResponse(request) {
  try {
    const response = await fetchWithTimeout(request);
    if (response.status >= 500) throw new Error(`navigation failed with HTTP ${response.status}`);
    if (isHtmlResponse(response)) {
      const cache = await caches.open(NAVIGATION_CACHE_NAME);
      await cache.put('/', response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match('/');
    if (cached && isHtmlResponse(cached)) return cached;
    return new Response(
      `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="theme-color" content="#eaf2ff">
    <title>网站暂时无法连接</title>
    <style>
      *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font-family:"Microsoft YaHei UI","Segoe UI",sans-serif;color:#102038;background:linear-gradient(145deg,#f8fbff,#dceaff)}main{width:min(440px,100%);padding:30px;border:1px solid rgba(255,255,255,.9);border-radius:28px;background:rgba(255,255,255,.72);box-shadow:0 24px 70px rgba(61,92,135,.2);backdrop-filter:blur(24px) saturate(150%)}.dot{width:12px;height:12px;border-radius:50%;background:#ff9f0a;box-shadow:0 0 0 7px rgba(255,159,10,.13)}h1{margin:22px 0 10px;font-size:25px}p{margin:0;color:#5d6d84;line-height:1.75}button{width:100%;height:48px;margin-top:24px;border:1px solid rgba(255,255,255,.9);border-radius:24px;color:#fff;background:#0a84ff;font:700 15px inherit;cursor:pointer;box-shadow:0 10px 24px rgba(10,132,255,.24)}small{display:block;margin-top:16px;color:#8492a6;text-align:center}@media(prefers-color-scheme:dark){body{color:#f8fafc;background:linear-gradient(145deg,#0a1220,#17243a)}main{border-color:#40516a;background:rgba(23,34,54,.86);box-shadow:0 24px 70px rgba(0,0,0,.45)}p,small{color:#aebdd1}}
    </style>
  </head>
  <body>
    <main>
      <div class="dot"></div>
      <h1>网站暂时无法连接</h1>
      <p>服务器或网络正在恢复。页面会每 8 秒自动重试，恢复后会自动进入网站，不需要反复刷新。</p>
      <button type="button" onclick="location.reload()">立即重试</button>
      <small id="status">正在等待服务器恢复…</small>
    </main>
    <script>
      const retry = async () => {
        try {
          const response = await fetch('/health', { cache: 'no-store' });
          if (response.ok) location.reload();
        } catch {}
      };
      setInterval(retry, 8000);
      retry();
    </script>
  </body>
</html>`,
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
    );
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PUBLIC_CACHE_NAME)
      .then((cache) => cache.addAll([...PUBLIC_PATHS]))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && ![ASSET_CACHE_NAME, PUBLIC_CACHE_NAME, NAVIGATION_CACHE_NAME].includes(key))
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
    event.respondWith(navigationResponse(request));
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
