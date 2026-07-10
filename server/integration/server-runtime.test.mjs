import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const sqliteAvailable = spawnSync('sqlite3', ['--version'], { encoding: 'utf8' }).status === 0;
const suite = sqliteAvailable ? describe : describe.skip;

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

function request(baseUrl, pathname, { method = 'GET', body, cookie, headers = {} } = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method,
    redirect: 'manual',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => ({ status: response.status, text: await response.text(), headers: response.headers }));
}

suite('production server runtime', () => {
  let child;
  let temporary;
  let baseUrl;
  let cookie;

  beforeAll(async () => {
    temporary = mkdtempSync(join(tmpdir(), 'exam-planner-runtime-'));
    const staticRoot = join(temporary, 'dist');
    mkdirSync(join(staticRoot, 'assets'), { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>');
    writeFileSync(join(staticRoot, 'assets', 'app.js'), 'console.log("runtime fixture")');
    writeFileSync(join(staticRoot, 'manifest.webmanifest'), JSON.stringify({ name: 'Exam Planner' }));
    writeFileSync(join(staticRoot, 'service-worker.js'), 'self.addEventListener("install",()=>{})');
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [resolve('server/auth-static-server.mjs')], {
      cwd: resolve('.'),
      env: {
        ...process.env,
        PORT: String(port), DATA_DIR: join(temporary, 'data'), STATIC_ROOT: staticRoot, SERVICE_ROLE: 'web',
        APP_PASSWORD: 'runtime-test-password', READONLY_PASSWORD: 'runtime-read-password', COOKIE_SECRET: 'runtime-test-cookie-secret-0000000000000000',
        BREAK_GUARD_TOKEN: 'runtime-break-guard-token', ENABLE_RETIRED_MARKET_COPILOT: '0', ENABLE_RETIRED_LIBRARY: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        const ready = await request(baseUrl, '/ready');
        if (ready.status === 200) break;
      } catch {}
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
    const ready = await request(baseUrl, '/ready');
    if (ready.status !== 200) throw new Error(`server did not become ready: ${ready.text}`);
    const login = await fetch(`${baseUrl}/login`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=runtime-test-password',
    });
    cookie = login.headers.get('set-cookie')?.split(';')[0] || '';
  }, 30_000);

  afterAll(async () => {
    if (child && !child.killed) {
      child.kill('SIGTERM');
      await new Promise((resolveWait) => child.once('exit', resolveWait));
    }
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  });

  it('serves health, readiness, login shell and auth boundary', async () => {
    expect((await request(baseUrl, '/health')).status).toBe(200);
    expect(JSON.parse((await request(baseUrl, '/ready')).text).ok).toBe(true);
    expect((await request(baseUrl, '/')).text).toContain('type="password"');
    expect((await request(baseUrl, '/api/state')).status).toBe(401);
  });

  it('persists a task through the real HTTP and SQLite stack', async () => {
    const saved = await request(baseUrl, '/api/tasks/save', { method: 'POST', cookie, body: { title: 'runtime smoke task', dueDate: '2026-07-10', urgency: 'medium' } });
    expect(saved.status).toBe(200);
    expect(Number(JSON.parse(saved.text))).toBeGreaterThan(0);
    const dashboard = JSON.parse((await request(baseUrl, '/api/dashboard', { cookie })).text);
    expect(dashboard.visibleTasks.some((task) => task.title === 'runtime smoke task')).toBe(true);
  });

  it('deduplicates Break Guard events and retires removed modules', async () => {
    const event = { eventId: 'runtime_event_12345', eventType: 'unfocused', overdueSeconds: 300 };
    const options = { method: 'POST', body: event, headers: { 'x-break-guard-token': 'runtime-break-guard-token' } };
    expect(JSON.parse((await request(baseUrl, '/api/break-guard/events', options)).text).event.duplicate).toBe(false);
    expect(JSON.parse((await request(baseUrl, '/api/break-guard/events', options)).text).event.duplicate).toBe(true);
    expect((await request(baseUrl, '/api/library/books', { cookie })).status).toBe(410);
    expect((await request(baseUrl, '/api/market-copilot', { cookie })).status).toBe(410);
  });
});
