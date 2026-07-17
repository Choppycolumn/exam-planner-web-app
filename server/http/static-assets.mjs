import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

export const defaultMimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export function createStaticAssetServer({ root, mimeTypes = defaultMimeTypes }) {
  return function serveStatic(req, res) {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const decodedPath = decodeURIComponent(requestUrl.pathname);
    let filePath = normalize(join(root, decodedPath));
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const isAssetPath = decodedPath.startsWith('/assets/');
    if (isAssetPath && !existsSync(filePath)) {
      res.writeHead(404, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end('Not found');
      return;
    }
    if (!existsSync(filePath) || decodedPath.endsWith('/')) {
      filePath = join(root, 'index.html');
    }
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const fileName = filePath.split(/[\\/]/).pop() || '';
    const shouldRevalidate = filePath.endsWith('index.html') || fileName === 'service-worker.js' || fileName.endsWith('.webmanifest');
    res.writeHead(200, {
      'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'cache-control': shouldRevalidate ? 'no-cache' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    createReadStream(filePath).pipe(res);
  };
}
