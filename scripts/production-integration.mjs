const baseUrl = new URL(process.argv[2] || 'http://127.0.0.1:8080');
const password = process.env.SMOKE_APP_PASSWORD || '';
const breakGuardToken = process.env.SMOKE_BREAK_GUARD_TOKEN || '';

if (!password || !breakGuardToken) throw new Error('Smoke credentials are required');

async function request(pathname, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    redirect: 'manual',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

const login = await fetch(new URL('/login', baseUrl), {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ password }),
});
if (login.status !== 302) throw new Error(`Authenticated login failed: ${login.status}`);
const cookie = login.headers.get('set-cookie')?.split(';')[0] || '';
if (!cookie) throw new Error('Authenticated login did not return a session cookie');

const title = `deployment-smoke-${Date.now()}`;
const dueDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const saved = await request('/api/tasks/save', {
  method: 'POST',
  cookie,
  body: { title, dueDate, urgency: 'low' },
});
if (saved.status !== 200 || !(Number(JSON.parse(saved.body)) > 0)) throw new Error(`Task write failed: ${saved.status}`);

const dashboard = await request('/api/dashboard', { cookie });
if (dashboard.status !== 200 || !JSON.parse(dashboard.body).visibleTasks.some((task) => task.title === title)) {
  throw new Error(`Task readback failed: ${dashboard.status}`);
}

const eventId = `deployment_break_guard_${Date.now()}`;
const breakOptions = {
  method: 'POST',
  body: { eventId, eventType: 'break_started', source: 'deployment-smoke' },
  headers: { 'x-break-guard-token': breakGuardToken },
};
const firstEvent = JSON.parse((await request('/api/break-guard/events', breakOptions)).body);
const secondEvent = JSON.parse((await request('/api/break-guard/events', breakOptions)).body);
if (firstEvent.event?.duplicate !== false || secondEvent.event?.duplicate !== true) throw new Error('Break Guard event idempotency failed');

if ((await request('/api/library/books', { cookie })).status !== 410) throw new Error('Retired library route is not closed');
if ((await request('/api/market-copilot', { cookie })).status !== 410) throw new Error('Retired finance route is not closed');

console.log(JSON.stringify({
  ok: true,
  baseUrl: baseUrl.origin,
  checks: ['authenticated-login', 'task-write-readback', 'break-guard-idempotency', 'retired-route-boundaries'],
}));
