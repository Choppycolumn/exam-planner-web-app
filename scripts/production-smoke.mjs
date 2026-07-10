import { request } from 'node:http';
import { request as secureRequest } from 'node:https';

const baseUrl = new URL(process.argv[2] || 'http://127.0.0.1:8080');

function send(pathname, { method = 'GET', body = '', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const transport = url.protocol === 'https:' ? secureRequest : request;
    const req = transport(url, { method, headers, timeout: 8_000, rejectUnauthorized: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout: ${pathname}`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const get = (pathname) => send(pathname);

const health = await get('/health');
if (health.status !== 200 || health.body.trim() !== 'ok') throw new Error(`Health failed: ${health.status}`);
const readiness = await get('/ready');
const readinessBody = JSON.parse(readiness.body || '{}');
if (readiness.status !== 200 || readinessBody.ok !== true) throw new Error(`Readiness failed: ${readiness.status} ${readiness.body}`);
const home = await get('/');
if (home.status !== 200 || !home.body.includes('input') || !home.body.includes('password')) throw new Error(`Login page failed: ${home.status}`);
const manifest = await get('/manifest.webmanifest');
if (manifest.status !== 200 || !manifest.body.includes('Exam Planner')) throw new Error(`Manifest failed: ${manifest.status}`);
const unauthorized = await get('/api/state');
if (unauthorized.status !== 401) throw new Error(`Auth boundary failed: ${unauthorized.status}`);
const checks = ['health', 'readiness', 'login-page', 'manifest', 'auth-boundary'];
if (process.env.CHECK_EMPTY_LOGIN === '1') {
  const emptyLogin = await send('/login', {
    method: 'POST',
    body: 'password=',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '9' },
  });
  if (emptyLogin.status !== 401) throw new Error(`Empty password boundary failed: ${emptyLogin.status}`);
  checks.push('empty-password-boundary');
}
console.log(JSON.stringify({ ok: true, baseUrl: baseUrl.origin, checks }));
