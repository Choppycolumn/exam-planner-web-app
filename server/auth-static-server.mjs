import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const dataDir = resolve(fileURLToPath(new URL('../data', import.meta.url)));
const dataFile = join(dataDir, 'db.json');
const dictionaryFile = join(dataDir, 'ecdict.csv');
const port = Number(process.env.PORT || 8080);
const appPassword = process.env.APP_PASSWORD;
const cookieSecret = process.env.COOKIE_SECRET || randomBytes(32).toString('hex');
const cookieName = 'exam_planner_session';
const entitySchemaVersion = 1;

if (!appPassword) {
  throw new Error('APP_PASSWORD is required');
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const projectColors = ['#2563eb', '#16a34a', '#f97316', '#9333ea', '#dc2626', '#0f766e', '#ca8a04', '#64748b'];
const subjectColors = ['#2563eb', '#16a34a', '#9333ea', '#dc2626'];
const dictionaryCache = new Map();

function nowISO() {
  return new Date().toISOString();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addYearISO() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

function baseState() {
  const timestamp = nowISO();
  return {
    goals: [{
      id: 1,
      name: '我的考研目标',
      description: '坚持长期复习，稳定提高分数',
      deadline: addYearISO(),
      isActive: true,
      type: '考研',
      notes: '',
      schemaVersion: entitySchemaVersion,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    dailyReviews: [],
    studyProjects: ['高等数学', '线性代数', '概率论', '英语单词', '英语阅读', '专业课', '政治', '复盘总结'].map((name, index) => ({
      id: index + 1,
      name,
      color: projectColors[index % projectColors.length],
      isActive: true,
      sortOrder: index + 1,
      schemaVersion: entitySchemaVersion,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
    studyTimeRecords: [],
    subjects: ['数学', '英语', '政治', '专业课'].map((name, index) => ({
      id: index + 1,
      name,
      color: subjectColors[index % subjectColors.length],
      isActive: true,
      sortOrder: index + 1,
      schemaVersion: entitySchemaVersion,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
    mockExamRecords: [],
    shortTermTasks: [],
    waterIntakeRecords: [],
    confusingWordsBackup: null,
  };
}

function ensureDataFile() {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(dataFile)) {
    writeState(baseState());
  }
}

function readState() {
  ensureDataFile();
  const parsed = JSON.parse(readFileSync(dataFile, 'utf8'));
  return { ...baseState(), ...parsed };
}

function writeState(state) {
  mkdirSync(dataDir, { recursive: true });
  const temp = `${dataFile}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(temp, dataFile);
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id || 0)), 0) + 1;
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-backup-password',
  });
  res.end(JSON.stringify(data));
}

function cleanChineseDefinition(value = '') {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('[网络]'))
    .join('；')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDictionaryEntry(fields) {
    const [word, phonetic, definition, translation, partOfSpeech] = fields;
    const key = word?.trim().toLowerCase();
    const chineseDefinition = cleanChineseDefinition(translation);
  if (!key || !chineseDefinition) return null;
  return {
      word: key,
      phonetic: phonetic || '',
      englishDefinition: definition || '',
      chineseDefinition,
      partOfSpeech: partOfSpeech || '',
  };
}

function findDictionaryEntry(targetWord) {
  const key = targetWord.trim().toLowerCase();
  if (dictionaryCache.has(key)) return dictionaryCache.get(key);
  if (!existsSync(dictionaryFile)) return null;

  const text = readFileSync(dictionaryFile, 'utf8');
  let row = [];
  let field = '';
  let quoted = false;
  let isHeader = true;

  const finishRow = () => {
    if (isHeader) {
      isHeader = false;
      return null;
    }
    const entry = buildDictionaryEntry(row);
    if (entry?.word === key) {
      dictionaryCache.set(key, entry);
      return entry;
    }
    return null;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      const found = finishRow();
      if (found) return found;
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }
  if (field || row.length) {
    row.push(field);
    const found = finishRow();
    if (found) return found;
  }
  dictionaryCache.set(key, null);
  return null;
}

function applySave(items, payload, createDefaults) {
  const timestamp = nowISO();
  if (payload.id) {
    const index = items.findIndex((item) => item.id === Number(payload.id));
    if (index >= 0) {
      items[index] = { ...items[index], ...payload, updatedAt: timestamp };
      return items[index].id;
    }
  }
  const next = {
    id: nextId(items),
    schemaVersion: entitySchemaVersion,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...createDefaults(payload),
    ...payload,
  };
  items.push(next);
  return next.id;
}

function normalizeReview(review) {
  if (typeof review.score === 'number') return review;
  if (typeof review.statusScore === 'number' && typeof review.satisfactionScore === 'number') {
    return { ...review, score: Math.round(((review.statusScore + review.satisfactionScore) / 10) * 10) };
  }
  return { ...review, score: 6 };
}

function sign(value) {
  return createHmac('sha256', cookieSecret).update(value).digest('hex');
}

function createSessionValue() {
  const payload = `ok.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

function isValidSession(cookieHeader = '') {
  const cookies = Object.fromEntries(cookieHeader.split(';').map((item) => {
    const [key, ...rest] = item.trim().split('=');
    return [key, decodeURIComponent(rest.join('='))];
  }));
  const value = cookies[cookieName];
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = sign(payload);
  try {
    return timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected));
  } catch {
    return false;
  }
}

function loginPage(error = '') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>考研计划管理</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8fb;color:#111827;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{width:min(420px,calc(100vw - 32px));border:1px solid #e5e7eb;border-radius:12px;background:#fff;padding:28px;box-shadow:0 18px 50px rgba(15,23,42,.08)}
    h1{margin:0;font-size:22px}p{color:#64748b;line-height:1.7}label{display:block;margin:20px 0 8px;font-size:13px;font-weight:700;color:#475569}
    input{width:100%;box-sizing:border-box;border:1px solid #d9dee8;border-radius:8px;padding:12px;font:inherit;outline:none}
    input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
    button{width:100%;margin-top:14px;border:0;border-radius:8px;background:#2563eb;color:white;padding:12px;font-weight:700;cursor:pointer}
    .error{margin-top:12px;color:#be123c;background:#fff1f2;border:1px solid #fecaca;border-radius:8px;padding:10px;font-size:14px}
  </style>
</head>
<body>
  <main>
    <h1>考研计划管理</h1>
    <p>请输入访问密码进入你的学习管理面板。</p>
    <form method="post" action="/login">
      <label for="password">访问密码</label>
      <input id="password" name="password" type="password" autofocus autocomplete="current-password" />
      <button type="submit">进入网站</button>
    </form>
    ${error ? `<div class="error">${error}</div>` : ''}
  </main>
</body>
</html>`;
}

function readBody(req) {
  return new Promise((resolveBody) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 16) req.destroy();
    });
    req.on('end', () => resolveBody(body));
  });
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const decodedPath = decodeURIComponent(requestUrl.pathname);
  let filePath = normalize(join(root, decodedPath));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
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
  res.writeHead(200, {
    'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream',
    'cache-control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(res);
}

async function handleApi(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, { ok: true });
    return;
  }

  if (req.url === '/api/import' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    if (body.password !== appPassword) {
      sendJson(res, { error: 'Invalid password' }, 401);
      return;
    }
    const imported = body.state || {};
    const next = {
      ...baseState(),
      goals: Array.isArray(imported.goals) ? imported.goals : [],
      dailyReviews: Array.isArray(imported.dailyReviews) ? imported.dailyReviews.map(normalizeReview) : [],
      studyProjects: Array.isArray(imported.studyProjects) ? imported.studyProjects : [],
      studyTimeRecords: Array.isArray(imported.studyTimeRecords) ? imported.studyTimeRecords : [],
      subjects: Array.isArray(imported.subjects) ? imported.subjects : [],
      mockExamRecords: Array.isArray(imported.mockExamRecords) ? imported.mockExamRecords : [],
      shortTermTasks: Array.isArray(imported.shortTermTasks) ? imported.shortTermTasks : [],
      waterIntakeRecords: Array.isArray(imported.waterIntakeRecords) ? imported.waterIntakeRecords : [],
      confusingWordsBackup: imported.confusingWordsBackup || null,
    };
    writeState(next);
    sendJson(res, { ok: true });
    return;
  }

  if (req.url?.startsWith('/api/dictionary/lookup') && req.method === 'GET') {
    const requestUrl = new URL(req.url, 'http://localhost');
    const word = requestUrl.searchParams.get('word')?.trim().toLowerCase() || '';
    if (!word) {
      sendJson(res, { error: 'Missing word' }, 400);
      return;
    }
    const entry = findDictionaryEntry(word);
    if (!entry) {
      sendJson(res, { error: 'Not found' }, 404);
      return;
    }
    sendJson(res, entry);
    return;
  }

  if (req.url === '/api/confusing-words/backup') {
    const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {};
    const hasBackupAccess = isValidSession(req.headers.cookie) || body.password === appPassword || req.headers['x-backup-password'] === appPassword;
    if (!hasBackupAccess) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return;
    }
    const state = readState();
    if (req.method === 'GET') {
      sendJson(res, state.confusingWordsBackup || null);
      return;
    }
    if (req.method === 'POST') {
      const timestamp = nowISO();
      state.confusingWordsBackup = {
        schemaVersion: Number(body.schemaVersion || 1),
        exportedAt: body.exportedAt || timestamp,
        backedUpAt: timestamp,
        groups: Array.isArray(body.groups) ? body.groups : [],
      };
      writeState(state);
      sendJson(res, { ok: true, backedUpAt: timestamp });
      return;
    }
  }

  if (!isValidSession(req.headers.cookie)) {
    sendJson(res, { error: 'Unauthorized' }, 401);
    return;
  }

  const state = readState();
  const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {};
  const timestamp = nowISO();

  if (req.url === '/api/state' && req.method === 'GET') {
    const normalized = {
      ...state,
      dailyReviews: state.dailyReviews.map(normalizeReview),
      waterIntakeRecords: Array.isArray(state.waterIntakeRecords) ? state.waterIntakeRecords : [],
    };
    sendJson(res, normalized);
    return;
  }

  if (req.url === '/api/reset' && req.method === 'POST') {
    writeState(baseState());
    sendJson(res, { ok: true });
    return;
  }

  const routes = {
    '/api/goals/save': () => {
      if (body.isActive) state.goals = state.goals.map((goal) => goal.id !== body.id ? { ...goal, isActive: false, updatedAt: timestamp } : goal);
      return applySave(state.goals, body, () => ({ name: '', description: '', deadline: todayISO(), isActive: true, type: '考研', notes: '' }));
    },
    '/api/projects/save': () => applySave(state.studyProjects, body, () => ({ name: '', color: '#2563eb', isActive: true, sortOrder: state.studyProjects.length + 1 })),
    '/api/subjects/save': () => applySave(state.subjects, body, () => ({ name: '', color: '#2563eb', isActive: true, sortOrder: state.subjects.length + 1 })),
    '/api/exams/save': () => applySave(state.mockExamRecords, body, () => ({ date: todayISO(), score: 0, fullScore: 100, paperName: '', durationMinutes: 0, wrongCount: 0, note: '' })),
    '/api/tasks/save': () => applySave(state.shortTermTasks, body, () => ({ title: '', dueDate: todayISO(), urgency: 'medium', isCompleted: false, completedAt: undefined, note: '' })),
  };

  if (req.method === 'POST' && routes[req.url]) {
    const id = routes[req.url]();
    writeState(state);
    sendJson(res, id);
    return;
  }

  if (req.url === '/api/goals/activate' && req.method === 'POST') {
    state.goals = state.goals.map((goal) => ({ ...goal, isActive: goal.id === Number(body.id), updatedAt: timestamp }));
    writeState(state);
    sendJson(res, { ok: true });
    return;
  }

  if (req.url === '/api/water/save' && req.method === 'POST') {
    const records = Array.isArray(state.waterIntakeRecords) ? state.waterIntakeRecords : [];
    const date = body.date || todayISO();
    const existingIndex = records.findIndex((item) => item.date === date);
    const payload = {
      date,
      cups: Math.max(0, Number(body.cups || 0)),
      cupMl: Math.max(1, Number(body.cupMl || 500)),
      targetCups: Math.max(1, Number(body.targetCups || 7)),
      updatedAt: timestamp,
    };
    if (existingIndex >= 0) records[existingIndex] = { ...records[existingIndex], ...payload };
    else records.push({ id: nextId(records), schemaVersion: entitySchemaVersion, createdAt: timestamp, ...payload });
    state.waterIntakeRecords = records;
    writeState(state);
    sendJson(res, { ok: true });
    return;
  }

  if (req.url === '/api/goals/remove' && req.method === 'POST') state.goals = state.goals.filter((item) => item.id !== Number(body.id));
  else if (req.url === '/api/projects/remove' && req.method === 'POST') state.studyProjects = state.studyProjects.map((item) => item.id === Number(body.id) ? { ...item, isActive: false, updatedAt: timestamp } : item);
  else if (req.url === '/api/subjects/remove' && req.method === 'POST') state.subjects = state.subjects.map((item) => item.id === Number(body.id) ? { ...item, isActive: false, updatedAt: timestamp } : item);
  else if (req.url === '/api/exams/remove' && req.method === 'POST') state.mockExamRecords = state.mockExamRecords.filter((item) => item.id !== Number(body.id));
  else if (req.url === '/api/tasks/remove' && req.method === 'POST') state.shortTermTasks = state.shortTermTasks.filter((item) => item.id !== Number(body.id));
  else if (req.url === '/api/tasks/toggle' && req.method === 'POST') state.shortTermTasks = state.shortTermTasks.map((item) => item.id === Number(body.id) ? { ...item, isCompleted: Boolean(body.completed), completedAt: body.completed ? timestamp : undefined, updatedAt: timestamp } : item);
  else if (req.url === '/api/reviews/upsert' && req.method === 'POST') {
    const existingIndex = state.dailyReviews.findIndex((review) => review.date === body.date);
    if (existingIndex >= 0) {
      state.dailyReviews[existingIndex] = normalizeReview({ ...state.dailyReviews[existingIndex], ...body, updatedAt: timestamp });
      writeState(state);
      sendJson(res, state.dailyReviews[existingIndex].id);
      return;
    }
    const id = applySave(state.dailyReviews, normalizeReview(body), () => ({ date: todayISO(), summary: '', wins: '', problems: '', tomorrowPlan: '', score: 6 }));
    writeState(state);
    sendJson(res, id);
    return;
  } else if (req.url === '/api/study-records/save-day' && req.method === 'POST') {
    for (const record of body.records || []) {
      const existingIndex = state.studyTimeRecords.findIndex((item) => item.date === body.date && item.projectId === record.projectId);
      const payload = { ...record, date: body.date, minutes: Math.max(0, Number(record.minutes || 0)), note: record.note || '', updatedAt: timestamp };
      if (existingIndex >= 0) state.studyTimeRecords[existingIndex] = { ...state.studyTimeRecords[existingIndex], ...payload };
      else state.studyTimeRecords.push({ id: nextId(state.studyTimeRecords), schemaVersion: entitySchemaVersion, createdAt: timestamp, ...payload });
    }
    writeState(state);
    sendJson(res, { ok: true });
    return;
  } else {
    sendJson(res, { error: 'Not found' }, 404);
    return;
  }

  writeState(state);
  sendJson(res, { ok: true });
}

createServer(async (req, res) => {
  if (req.url === '/login' && req.method === 'POST') {
    const params = new URLSearchParams(await readBody(req));
    if (params.get('password') === appPassword) {
      res.writeHead(302, {
        location: '/',
        'set-cookie': `${cookieName}=${encodeURIComponent(createSessionValue())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
      });
      res.end();
      return;
    }
    sendHtml(res, loginPage('密码不正确，请重试。'), 401);
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.url?.startsWith('/api/')) {
    await handleApi(req, res);
    return;
  }

  if (!isValidSession(req.headers.cookie)) {
    sendHtml(res, loginPage());
    return;
  }

  serveStatic(req, res);
}).listen(port, '127.0.0.1', () => {
  console.log(`Exam planner server listening on http://127.0.0.1:${port}`);
});
