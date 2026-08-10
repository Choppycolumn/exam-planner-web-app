const baseUrl = new URL(process.argv[2] || 'http://127.0.0.1:8080');
const password = process.env.SMOKE_APP_PASSWORD || '';
const breakGuardToken = process.env.SMOKE_BREAK_GUARD_TOKEN || '';
const requestTimeoutMs = Math.max(1_000, Number(process.env.SMOKE_REQUEST_TIMEOUT_MS || 20_000));

if (!password || !breakGuardToken) throw new Error('Smoke credentials are required');

async function request(pathname, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: {
      connection: 'close',
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
  signal: AbortSignal.timeout(requestTimeoutMs),
  headers: { connection: 'close', 'content-type': 'application/x-www-form-urlencoded' },
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

const projectsResponse = await request('/api/projects', { cookie });
const focusProject = JSON.parse(projectsResponse.body).items?.find((project) => project.isActive);
if (projectsResponse.status !== 200 || !focusProject?.id) throw new Error('Focus timer project lookup failed');
const focusStamp = Date.now();
const correctionSessionId = `deployment_correction_${focusStamp}`;
const completedStudy = await request('/api/break-guard/events', {
  method: 'POST',
  headers: { 'x-break-guard-token': breakGuardToken },
  body: {
    eventId: `${correctionSessionId}_completed`,
    eventType: 'class_completed',
    payload: { sessionId: correctionSessionId, sessionDate: dueDate, projectId: focusProject.id, durationSeconds: 3000, sessionSequence: 1 },
  },
});
if (completedStudy.status !== 200) throw new Error(`Break Guard study completion failed: ${completedStudy.status}`);
const correctionBody = {
  eventId: `${correctionSessionId}_corrected`,
  eventType: 'study_session_corrected',
  payload: { sessionId: correctionSessionId, sessionDate: dueDate, projectId: focusProject.id, previousDurationSeconds: 3000, durationSeconds: 1800, sessionSequence: 1 },
};
const correctedStudy = await request('/api/break-guard/events', {
  method: 'POST', headers: { 'x-break-guard-token': breakGuardToken }, body: correctionBody,
});
const replayedCorrection = await request('/api/break-guard/events', {
  method: 'POST', headers: { 'x-break-guard-token': breakGuardToken }, body: correctionBody,
});
const correctedRecords = JSON.parse((await request(`/api/study-records?date=${dueDate}`, { cookie })).body).records || [];
const correctedRecord = correctedRecords.find((record) => Number(record.projectId) === Number(focusProject.id));
if (
  correctedStudy.status !== 200
  || JSON.parse(replayedCorrection.body).event?.duplicate !== true
  || Number(correctedRecord?.minutes) !== 30
) {
  throw new Error('Break Guard study correction or idempotency failed');
}
const focusSessionId = `deployment_focus_${focusStamp}`;
const focusStarted = await request('/api/focus-timer/action', {
  method: 'POST',
  cookie,
  body: {
    action: 'start_focus',
    operationId: `deployment_focus_start_${focusStamp}`,
    sessionId: focusSessionId,
    projectId: focusProject.id,
    occurredAt: new Date(focusStamp - 2 * 60_000).toISOString(),
  },
});
if (focusStarted.status !== 200 || JSON.parse(focusStarted.body).dashboard?.state?.mode !== 'focus') {
  throw new Error(`Focus timer start failed: ${focusStarted.status}`);
}
const finishFocusBody = {
  action: 'complete_focus',
  operationId: `deployment_focus_finish_${focusStamp}`,
  sessionId: focusSessionId,
  occurredAt: new Date(focusStamp).toISOString(),
};
const focusFinished = await request('/api/focus-timer/action', { method: 'POST', cookie, body: finishFocusBody });
const focusReplayed = await request('/api/focus-timer/action', { method: 'POST', cookie, body: finishFocusBody });
const focusDashboard = JSON.parse(focusFinished.body).dashboard;
if (
  focusFinished.status !== 200
  || focusDashboard?.state?.mode !== 'break'
  || focusDashboard?.summary?.sessionCount !== 1
  || JSON.parse(focusReplayed.body).duplicate !== true
) {
  throw new Error('Focus timer completion or idempotency failed');
}

if ((await request('/api/library/books', { cookie })).status !== 410) throw new Error('Retired library route is not closed');
if ((await request('/api/market-copilot', { cookie })).status !== 410) throw new Error('Retired finance route is not closed');

console.log(JSON.stringify({
  ok: true,
  baseUrl: baseUrl.origin,
  checks: ['authenticated-login', 'task-write-readback', 'break-guard-idempotency', 'break-guard-study-correction', 'focus-timer-write-readback', 'focus-timer-idempotency', 'retired-route-boundaries'],
}));
