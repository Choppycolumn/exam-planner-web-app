import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const suite = describe;

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
  let childOutput = '';

  beforeAll(async () => {
    temporary = mkdtempSync(join(tmpdir(), 'exam-planner-runtime-'));
    const staticRoot = join(temporary, 'dist');
    mkdirSync(join(staticRoot, 'assets'), { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Exam Planner Runtime Fixture</title></head><body><div id="root">runtime fixture</div><script type="module" src="/assets/app.js"></script></body></html>');
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
        APP_PASSWORD: 'runtime-test-password', READONLY_PASSWORD: 'runtime-read-password', COOKIE_SECRET: 'runtime-test-cookie-secret-0000000000000000', MAX_USERS: '5',
        BREAK_GUARD_TOKEN: 'runtime-break-guard-token', ENABLE_RETIRED_MARKET_COPILOT: '0', ENABLE_RETIRED_LIBRARY: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { childOutput += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { childOutput += chunk.toString('utf8'); });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      try {
        const ready = await request(baseUrl, '/ready');
        if (ready.status === 200) break;
      } catch {}
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
    let ready;
    try {
      ready = await request(baseUrl, '/ready');
    } catch (error) {
      throw new Error(`server did not become ready: ${error.message}\n${childOutput}`);
    }
    if (ready.status !== 200) throw new Error(`server did not become ready: ${ready.text}\n${childOutput}`);
    const login = await fetch(`${baseUrl}/login`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=runtime-test-password',
    });
    cookie = login.headers.get('set-cookie')?.split(';')[0] || '';
  }, 30_000);

  afterAll(async () => {
    if (child && child.exitCode === null && !child.killed) {
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
    const unauthenticatedAsset = await request(baseUrl, '/assets/app.js');
    expect(unauthenticatedAsset.status).toBe(401);
    expect(unauthenticatedAsset.headers.get('content-type')).toContain('text/plain');
    expect(unauthenticatedAsset.text).not.toContain('<!doctype html>');
    const authenticatedAsset = await request(baseUrl, '/assets/app.js', { cookie });
    expect(authenticatedAsset.status).toBe(200);
    expect(authenticatedAsset.headers.get('content-type')).toContain('text/javascript');
    const missingAsset = await request(baseUrl, '/assets/missing-build.js', { cookie });
    expect(missingAsset.status).toBe(404);
    expect(missingAsset.text).not.toContain('<!doctype html>');
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

  it('creates invited members with isolated data and shared study comparison', async () => {
    const loginPage = await request(baseUrl, '/');
    expect(loginPage.text).toContain('使用邀请码创建学习空间');
    const firstInvite = JSON.parse((await request(baseUrl, '/api/users/invites', {
      method: 'POST', cookie, body: { displayName: '学习伙伴', expiresInHours: 24 },
    })).text).invite;
    const registration = await fetch(`${baseUrl}/register-invite`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ inviteToken: firstInvite.token, displayName: '学习伙伴', password: 'learner-runtime-password', confirmPassword: 'learner-runtime-password' }),
    });
    expect(registration.status).toBe(302);
    expect(registration.headers.get('location')).toBe('/');
    const learnerCookie = registration.headers.get('set-cookie')?.split(';')[0] || '';

    const session = JSON.parse((await request(baseUrl, '/api/session', { cookie: learnerCookie })).text);
    expect(session).toMatchObject({ userId: 2, accountType: 'learner', userRole: 'member', userCount: 2, maxUsers: 5, canAddUser: true });
    expect(session.capabilities).toContain('study.use');
    expect(session.capabilities).not.toContain('operations.manage');
    expect((await request(baseUrl, '/api/notifications/center', { cookie: learnerCookie })).status).toBe(403);
    expect((await request(baseUrl, '/api/tasks/status', { cookie: learnerCookie })).status).toBe(403);
    expect((await request(baseUrl, '/api/settings/mihomo', { cookie: learnerCookie })).status).toBe(403);
    expect((await request(baseUrl, '/api/break-guard/config', { cookie: learnerCookie })).status).toBe(403);
    expect((await request(baseUrl, '/api/import', { method: 'POST', cookie: learnerCookie, body: { state: {} } })).status).toBe(401);
    const projects = JSON.parse((await request(baseUrl, '/api/projects', { cookie: learnerCookie })).text).items;
    expect(projects.length).toBeGreaterThan(0);

    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    const saved = await request(baseUrl, '/api/study-records/save-day', {
      method: 'POST',
      cookie: learnerCookie,
      body: { date, records: [{ projectId: projects[0].id, projectNameSnapshot: projects[0].name, minutes: 55, note: 'learner fixture' }] },
    });
    expect(saved.status).toBe(200);
    const learnerRecords = JSON.parse((await request(baseUrl, `/api/study-records?date=${date}`, { cookie: learnerCookie })).text).records;
    const adminRecords = JSON.parse((await request(baseUrl, `/api/study-records?date=${date}`, { cookie })).text).records;
    expect(learnerRecords).toEqual([expect.objectContaining({ minutes: 55, note: 'learner fixture' })]);
    expect(adminRecords.some((record) => record.note === 'learner fixture')).toBe(false);

    const learnerGoalId = Number(JSON.parse((await request(baseUrl, '/api/goals/save', {
      method: 'POST', cookie: learnerCookie, body: { name: '学习伙伴目标', deadline: '2026-12-20', isActive: true },
    })).text));
    const learnerSubjectId = Number(JSON.parse((await request(baseUrl, '/api/subjects/save', {
      method: 'POST', cookie: learnerCookie, body: { name: '学习伙伴自设科目', color: '#0ea5e9' },
    })).text));
    await request(baseUrl, '/api/exams/save', {
      method: 'POST', cookie: learnerCookie, body: { date, subjectId: learnerSubjectId, subjectNameSnapshot: '学习伙伴自设科目', score: 88, fullScore: 100, paperName: '独立模考' },
    });
    await request(baseUrl, '/api/tasks/save', {
      method: 'POST', cookie: learnerCookie, body: { title: '学习伙伴任务', dueDate: date, dueTime: '20:00', reminderEnabled: true },
    });
    await request(baseUrl, '/api/water/save', { method: 'POST', cookie: learnerCookie, body: { date, cups: 3, cupMl: 500, targetCups: 6 } });
    await request(baseUrl, '/api/reviews/upsert', { method: 'POST', cookie: learnerCookie, body: { date, summary: '学习伙伴复盘', score: 7 } });
    await request(baseUrl, '/api/problem-inbox/save', { method: 'POST', cookie: learnerCookie, body: { date, text: '学习伙伴独立问题' } });

    await request(baseUrl, '/api/water/save', { method: 'POST', cookie, body: { date, cups: 5, cupMl: 500, targetCups: 6 } });
    await request(baseUrl, '/api/reviews/upsert', { method: 'POST', cookie, body: { date, summary: '主账户复盘', score: 9 } });

    const learnerDashboard = JSON.parse((await request(baseUrl, '/api/dashboard', { cookie: learnerCookie })).text);
    const adminDashboard = JSON.parse((await request(baseUrl, '/api/dashboard', { cookie })).text);
    expect(learnerDashboard).toMatchObject({ activeGoal: { id: learnerGoalId, name: '学习伙伴目标' }, todayReview: { summary: '学习伙伴复盘' }, todayWaterRecord: { cups: 3 }, todayBrief: null });
    expect(learnerDashboard.visibleTasks).toEqual(expect.arrayContaining([expect.objectContaining({ title: '学习伙伴任务', reminderEnabled: false })]));
    expect(learnerDashboard.breakGuard).toBeUndefined();
    expect(adminDashboard.todayReview.summary).toBe('主账户复盘');
    expect(adminDashboard.todayWaterRecord.cups).toBe(5);
    expect(adminDashboard.visibleTasks.some((task) => task.title === '学习伙伴任务')).toBe(false);

    expect(JSON.parse((await request(baseUrl, '/api/goals', { cookie })).text).items.some((item) => item.name === '学习伙伴目标')).toBe(false);
    expect(JSON.parse((await request(baseUrl, '/api/subjects', { cookie: learnerCookie })).text).items).toEqual(expect.arrayContaining([expect.objectContaining({ name: '学习伙伴自设科目' })]));
    expect(JSON.parse((await request(baseUrl, '/api/subjects', { cookie })).text).items.some((item) => item.name === '学习伙伴自设科目')).toBe(false);
    expect(JSON.parse((await request(baseUrl, '/api/mock-exams', { cookie: learnerCookie })).text).exams).toEqual(expect.arrayContaining([expect.objectContaining({ paperName: '独立模考' })]));
    expect(JSON.parse((await request(baseUrl, '/api/reviews', { cookie: learnerCookie })).text).reviews).toEqual(expect.arrayContaining([expect.objectContaining({ summary: '学习伙伴复盘' })]));
    expect(JSON.parse((await request(baseUrl, '/api/reviews', { cookie })).text).reviews.some((item) => item.summary === '学习伙伴复盘')).toBe(false);
    expect(JSON.parse((await request(baseUrl, '/api/problem-inbox?status=all', { cookie: learnerCookie })).text).items).toEqual(expect.arrayContaining([expect.objectContaining({ text: '学习伙伴独立问题' })]));

    const calendar = JSON.parse((await request(baseUrl, `/api/calendar?from=${date}&to=${date}`, { cookie: learnerCookie })).text);
    expect(calendar.events.some((event) => event.type === 'study' && event.value === 55)).toBe(true);
    expect(calendar.events.some((event) => event.type === 'notification')).toBe(false);

    const learnerWords = { schemaVersion: 1, exportedAt: new Date().toISOString(), groups: [{ id: 'learner-words', title: 'private words', words: [] }] };
    expect((await request(baseUrl, '/api/confusing-words/backup', { method: 'POST', cookie: learnerCookie, body: learnerWords })).status).toBe(200);
    expect(JSON.parse((await request(baseUrl, '/api/confusing-words/backup', { cookie: learnerCookie })).text).groups[0].id).toBe('learner-words');
    expect(JSON.parse((await request(baseUrl, '/api/confusing-words/backup', { cookie })).text)).toBeNull();

    const generatedReport = await request(baseUrl, '/api/reports/generate', {
      method: 'POST', cookie: learnerCookie, body: { kind: 'weekly', periodStart: date, periodEnd: date },
    });
    expect(generatedReport.status).toBe(200);
    expect(JSON.parse(generatedReport.text).report.reviews).toEqual(expect.arrayContaining([expect.objectContaining({ summary: '学习伙伴复盘' })]));
    expect(JSON.stringify(JSON.parse((await request(baseUrl, '/api/reports', { cookie })).text))).not.toContain('学习伙伴复盘');

    const comparison = JSON.parse((await request(baseUrl, '/api/study-comparison?days=7', { cookie: learnerCookie })).text);
    expect(comparison.accounts).toHaveLength(2);
    expect(comparison.maxUsers).toBe(5);
    expect(comparison.accounts.find((account) => account.userId === 2)).toEqual(expect.objectContaining({ todayMinutes: 55 }));

    const sqlite = new DatabaseSync(join(temporary, 'data', 'exam-planner.sqlite'), { readOnly: true });
    const storedHash = sqlite.prepare('SELECT password_hash AS passwordHash FROM user_accounts WHERE id=2').get().passwordHash;
    expect(storedHash).not.toContain('learner-runtime-password');
    expect(sqlite.prepare("SELECT reminder_enabled AS reminderEnabled FROM short_term_tasks WHERE user_id=2 AND title='学习伙伴任务'").get().reminderEnabled).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM learning_reports WHERE user_id=2').get().count).toBe(1);
    sqlite.close();

    const secondInvite = JSON.parse((await request(baseUrl, '/api/users/invites', {
      method: 'POST', cookie, body: { displayName: '学习伙伴 2', expiresInHours: 24 },
    })).text).invite;
    const secondRegistration = await fetch(`${baseUrl}/register-invite`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ inviteToken: secondInvite.token, displayName: '学习伙伴 2', password: 'third-runtime-password', confirmPassword: 'third-runtime-password' }),
    });
    expect(secondRegistration.status).toBe(302);
    const thirdUserCookie = secondRegistration.headers.get('set-cookie')?.split(';')[0] || '';
    const thirdUserSession = JSON.parse((await request(baseUrl, '/api/session', { cookie: thirdUserCookie })).text);
    expect(thirdUserSession).toMatchObject({ userId: 3, displayName: '学习伙伴 2', accountType: 'learner', userRole: 'member', userCount: 3, maxUsers: 5, canAddUser: true });
    expect(thirdUserSession.capabilities).not.toContain('operations.manage');
    expect((await request(baseUrl, '/api/settings/mihomo', { cookie: thirdUserCookie })).status).toBe(403);
    expect((await request(baseUrl, '/api/tasks/status', { cookie: thirdUserCookie })).status).toBe(403);

    const thirdProjects = JSON.parse((await request(baseUrl, '/api/projects', { cookie: thirdUserCookie })).text).items;
    expect(thirdProjects.length).toBeGreaterThan(0);
    expect(thirdProjects.some((project) => projects.some((learnerProject) => learnerProject.id === project.id))).toBe(false);
    await request(baseUrl, '/api/study-records/save-day', {
      method: 'POST',
      cookie: thirdUserCookie,
      body: { date, records: [{ projectId: thirdProjects[0].id, projectNameSnapshot: thirdProjects[0].name, minutes: 35, note: 'third learner fixture' }] },
    });
    const thirdSubjectId = Number(JSON.parse((await request(baseUrl, '/api/subjects/save', {
      method: 'POST', cookie: thirdUserCookie, body: { name: '第三用户独立科目', color: '#8b5cf6' },
    })).text));
    expect(thirdSubjectId).toBeGreaterThan(0);
    const thirdRecords = JSON.parse((await request(baseUrl, `/api/study-records?date=${date}`, { cookie: thirdUserCookie })).text).records;
    const secondUserRecordsAfterThird = JSON.parse((await request(baseUrl, `/api/study-records?date=${date}`, { cookie: learnerCookie })).text).records;
    expect(thirdRecords).toEqual([expect.objectContaining({ minutes: 35, note: 'third learner fixture' })]);
    expect(secondUserRecordsAfterThird.some((record) => record.note === 'third learner fixture')).toBe(false);
    expect(JSON.parse((await request(baseUrl, '/api/subjects', { cookie: learnerCookie })).text).items.some((item) => item.name === '第三用户独立科目')).toBe(false);
    expect(JSON.parse((await request(baseUrl, '/api/subjects', { cookie })).text).items.some((item) => item.name === '第三用户独立科目')).toBe(false);

    const threeUserComparison = JSON.parse((await request(baseUrl, '/api/study-comparison?days=7', { cookie: thirdUserCookie })).text);
    expect(threeUserComparison.accounts).toHaveLength(3);
    expect(threeUserComparison.accounts.find((account) => account.userId === 2)).toEqual(expect.objectContaining({ todayMinutes: 55 }));
    expect(threeUserComparison.accounts.find((account) => account.userId === 3)).toEqual(expect.objectContaining({ todayMinutes: 35 }));

    const userManagement = JSON.parse((await request(baseUrl, '/api/users', { cookie })).text);
    expect(userManagement.users).toHaveLength(3);
    expect(userManagement.users.every((account) => !('passwordHash' in account))).toBe(true);
    expect((await request(baseUrl, '/api/users', { cookie: learnerCookie })).status).toBe(403);

    const fourthInvite = JSON.parse((await request(baseUrl, '/api/users/invites', { method: 'POST', cookie, body: { displayName: '第四位' } })).text).invite;
    const fourthRegistration = await fetch(`${baseUrl}/register-invite`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ inviteToken: fourthInvite.token, displayName: '第四位', password: 'fourth-runtime-password', confirmPassword: 'fourth-runtime-password' }),
    });
    expect(fourthRegistration.status).toBe(302);
    expect(JSON.parse((await request(baseUrl, '/api/session', { cookie: fourthRegistration.headers.get('set-cookie')?.split(';')[0] || '' })).text)).toMatchObject({ userId: 4, maxUsers: 5 });

    const importedOwnerState = {
      goals: [],
      dailyReviews: [],
      studyProjects: [{ id: 1, name: '管理员导入项目', color: '#2563eb', isActive: true, sortOrder: 1 }],
      studyTimeRecords: [{ id: 1, date, projectId: 1, projectNameSnapshot: '管理员导入项目', minutes: 25, note: 'owner import fixture' }],
      subjects: [],
      mockExamRecords: [],
      shortTermTasks: [],
      waterIntakeRecords: [],
    };
    expect((await request(baseUrl, '/api/import', {
      method: 'POST',
      cookie,
      body: { state: importedOwnerState },
    })).status).toBe(200);
    expect(JSON.parse((await request(baseUrl, `/api/study-records?date=${date}`, { cookie })).text).records)
      .toEqual([expect.objectContaining({ minutes: 25, note: 'owner import fixture' })]);
    expect(JSON.parse((await request(baseUrl, `/api/study-records?date=${date}`, { cookie: learnerCookie })).text).records)
      .toEqual([expect.objectContaining({ minutes: 55, note: 'learner fixture' })]);
    expect(JSON.parse((await request(baseUrl, `/api/study-records?date=${date}`, { cookie: thirdUserCookie })).text).records)
      .toEqual([expect.objectContaining({ minutes: 35, note: 'third learner fixture' })]);
  });

});
