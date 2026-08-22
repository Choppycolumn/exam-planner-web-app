import { chmodSync, existsSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { createPrivilegedProxyService } from './privileged/proxy-service.mjs';

const socketPath = process.env.PRIVILEGED_HELPER_SOCKET || '/run/exam-planner/privileged.sock';
const proxy = createPrivilegedProxyService();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      text += chunk;
      if (Buffer.byteLength(text) > 9 * 1024 * 1024) reject(Object.assign(new Error('request too large'), { statusCode: 413 }));
    });
    req.on('end', () => { try { resolve(text ? JSON.parse(text) : {}); } catch { reject(Object.assign(new Error('invalid JSON'), { statusCode: 400 })); } });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    if (req.url === '/health' && req.method === 'GET') return json(res, 200, { ok: true });
    if (req.url === '/v1/proxy' && req.method === 'GET') return json(res, 200, await proxy.status());
    if (req.url === '/v1/proxy/subscription' && req.method === 'POST') return json(res, 200, await proxy.save(await readBody(req)));
    if (req.url === '/v1/proxy/import' && req.method === 'POST') return json(res, 200, await proxy.importProvider(await readBody(req)));
    if (req.url === '/v1/proxy/select' && req.method === 'POST') return json(res, 200, await proxy.select(await readBody(req)));
    if (req.url === '/v1/proxy/test' && req.method === 'POST') return json(res, 200, await proxy.test());
    return json(res, 404, { error: 'not found' });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || 'privileged operation failed' });
  }
});

if (existsSync(socketPath)) unlinkSync(socketPath);
server.listen(socketPath, () => chmodSync(socketPath, 0o660));
const close = () => server.close(() => process.exit(0));
process.on('SIGTERM', close);
process.on('SIGINT', close);
