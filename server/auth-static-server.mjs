import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const dataDir = resolve(fileURLToPath(new URL('../data', import.meta.url)));
const legacyDataFile = join(dataDir, 'db.json');
const sqliteFile = join(dataDir, 'exam-planner.sqlite');
const backupsDir = join(dataDir, 'backups');
const dictionaryFile = join(dataDir, 'ecdict.csv');
const port = Number(process.env.PORT || 8080);
const appPassword = process.env.APP_PASSWORD;
const readOnlyPassword = process.env.READONLY_PASSWORD || '123';
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
let sqliteReady = false;
let dictionaryIndexChecked = false;

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

function normalizeState(state = {}) {
  return {
    ...baseState(),
    ...state,
    goals: Array.isArray(state.goals) ? state.goals : [],
    dailyReviews: Array.isArray(state.dailyReviews) ? state.dailyReviews.map(normalizeReview) : [],
    studyProjects: Array.isArray(state.studyProjects) ? state.studyProjects : [],
    studyTimeRecords: Array.isArray(state.studyTimeRecords) ? state.studyTimeRecords : [],
    subjects: Array.isArray(state.subjects) ? state.subjects : [],
    mockExamRecords: Array.isArray(state.mockExamRecords) ? state.mockExamRecords : [],
    shortTermTasks: Array.isArray(state.shortTermTasks) ? state.shortTermTasks : [],
    waterIntakeRecords: Array.isArray(state.waterIntakeRecords) ? state.waterIntakeRecords : [],
    confusingWordsBackup: state.confusingWordsBackup || null,
  };
}

function sqlitePath(value) {
  return `'${String(value).replace(/\\/g, '/').replace(/'/g, "''")}'`;
}

function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function runSqlite(script, { maxBuffer = 128 * 1024 * 1024 } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const result = spawnSync('sqlite3', [sqliteFile], {
    input: script,
    encoding: 'utf8',
    maxBuffer,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`sqlite3 failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function sqliteScalar(sql) {
  return runSqlite(`.headers off\n.mode list\n${sql}\n`).trim();
}

function sqliteJson(sql) {
  const output = runSqlite(`.mode json\n${sql}\n`).trim();
  return output ? JSON.parse(output) : [];
}

function writeStateToSqlite(state) {
  const tempFile = join(dataDir, `.state-write-${process.pid}-${Date.now()}.json`);
  writeFileSync(tempFile, JSON.stringify(normalizeState(state), null, 2), 'utf8');
  try {
    runSqlite(`BEGIN;
INSERT INTO app_state (id, state_json, updated_at)
VALUES (1, CAST(readfile(${sqlitePath(tempFile)}) AS TEXT), datetime('now'))
ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at;
COMMIT;`);
  } finally {
    if (existsSync(tempFile)) unlinkSync(tempFile);
  }
}

function readStateFromSqlite() {
  const rows = sqliteJson('SELECT state_json FROM app_state WHERE id = 1 LIMIT 1;');
  return normalizeState(rows[0]?.state_json ? JSON.parse(rows[0].state_json) : {});
}

function createBackupFile(kind = 'manual', note = '') {
  mkdirSync(backupsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const filePath = join(backupsDir, `exam-planner-${kind}-${timestamp}.sqlite`);
  runSqlite(`VACUUM INTO ${sqlitePath(filePath)};`);
  runSqlite(`INSERT INTO backup_log (kind, file_path, created_at, note)
VALUES (${sqlString(kind)}, ${sqlString(filePath)}, datetime('now'), ${sqlString(note)});`);
  if (kind === 'weekly') {
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_weekly_backup_at', ${sqlString(nowISO())}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  }
  return { kind, filePath, createdAt: nowISO() };
}

function cleanupWeeklyBackups(keepCount = 12) {
  if (!existsSync(backupsDir)) return;
  const weeklyBackups = readdirSync(backupsDir)
    .filter((name) => /^exam-planner-weekly-.*\.sqlite$/.test(name))
    .sort()
    .reverse();
  for (const name of weeklyBackups.slice(keepCount)) {
    try {
      unlinkSync(join(backupsDir, name));
    } catch {
      // A stale backup failing to delete should not block the app.
    }
  }
}

function ensureWeeklyBackup() {
  const lastBackupAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_weekly_backup_at' LIMIT 1;");
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
  if (!lastBackupAt || Date.now() - new Date(lastBackupAt).getTime() >= oneWeekMs) {
    createBackupFile('weekly', 'automatic weekly backup');
    cleanupWeeklyBackups();
  }
}

function getBackupStatus() {
  ensureSqliteStore();
  const backupRows = sqliteJson(`SELECT kind, file_path AS filePath, created_at AS createdAt, note
FROM backup_log
ORDER BY datetime(created_at) DESC
LIMIT 1;`);
  const backupCount = Number(sqliteScalar('SELECT COUNT(*) FROM backup_log;') || 0);
  const dictionaryCount = Number(sqliteScalar('SELECT COUNT(*) FROM dictionary_entries;') || 0);
  const lastWeeklyBackupAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_weekly_backup_at' LIMIT 1;");
  const dictionaryIndexedAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'dictionary_indexed_at' LIMIT 1;");
  return {
    storage: 'sqlite',
    sqliteFile,
    sqliteSizeBytes: existsSync(sqliteFile) ? statSync(sqliteFile).size : 0,
    backupCount,
    lastBackup: backupRows[0] || null,
    lastWeeklyBackupAt: lastWeeklyBackupAt || null,
    dictionaryCount,
    dictionaryIndexedAt: dictionaryIndexedAt || null,
  };
}

function ensureSqliteStore() {
  if (sqliteReady) return;
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(backupsDir, { recursive: true });
  const versionCheck = spawnSync('sqlite3', ['--version'], { encoding: 'utf8' });
  if (versionCheck.error || versionCheck.status !== 0) {
    throw new Error('sqlite3 is required on the server. Install it with: apt install sqlite3');
  }

  runSqlite(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dictionary_entries (
  word TEXT PRIMARY KEY,
  phonetic TEXT,
  english_definition TEXT,
  chinese_definition TEXT,
  part_of_speech TEXT,
  tag TEXT,
  frequency INTEGER,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS backup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_backup_log_created_at ON backup_log(created_at);
CREATE INDEX IF NOT EXISTS idx_dictionary_entries_frequency ON dictionary_entries(frequency);`);

  const stateCount = Number(sqliteScalar('SELECT COUNT(*) FROM app_state WHERE id = 1;') || 0);
  if (!stateCount) {
    let initialState = baseState();
    if (existsSync(legacyDataFile)) {
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      const legacyBackupDir = join(backupsDir, `auto-pre-sqlite-${timestamp}`);
      mkdirSync(legacyBackupDir, { recursive: true });
      writeFileSync(join(legacyBackupDir, 'db.json'), readFileSync(legacyDataFile));
      initialState = JSON.parse(readFileSync(legacyDataFile, 'utf8'));
    }
    writeStateToSqlite(initialState);
  }

  runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('storage_backend', 'sqlite', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  sqliteReady = true;
  ensureWeeklyBackup();
  ensureDictionaryIndex();
  setInterval(ensureWeeklyBackup, 6 * 60 * 60 * 1000).unref();
}

function readState() {
  ensureSqliteStore();
  return readStateFromSqlite();
}

function writeState(state) {
  ensureSqliteStore();
  writeStateToSqlite(state);
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

function ensureDictionaryIndex() {
  if (dictionaryIndexChecked) return;
  dictionaryIndexChecked = true;
  if (!existsSync(dictionaryFile)) return;

  const sourceStats = statSync(dictionaryFile);
  const signature = `${sourceStats.size}:${Math.round(sourceStats.mtimeMs)}`;
  const indexedSignature = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'dictionary_source_signature' LIMIT 1;");
  const indexedCount = Number(sqliteScalar('SELECT COUNT(*) FROM dictionary_entries;') || 0);
  if (indexedSignature === signature && indexedCount > 0) return;

  dictionaryCache.clear();
  runSqlite(`DROP TABLE IF EXISTS dictionary_import;
CREATE TABLE dictionary_import (
  word TEXT,
  phonetic TEXT,
  definition TEXT,
  translation TEXT,
  pos TEXT,
  collins TEXT,
  oxford TEXT,
  tag TEXT,
  bnc TEXT,
  frq TEXT,
  exchange TEXT,
  detail TEXT,
  audio TEXT
);
.mode csv
.import --skip 1 ${sqlitePath(dictionaryFile)} dictionary_import
BEGIN;
DELETE FROM dictionary_entries;
INSERT OR REPLACE INTO dictionary_entries (
  word,
  phonetic,
  english_definition,
  chinese_definition,
  part_of_speech,
  tag,
  frequency,
  updated_at
)
SELECT
  lower(trim(word)),
  phonetic,
  definition,
  translation,
  pos,
  tag,
  CAST(frq AS INTEGER),
  datetime('now')
FROM dictionary_import
WHERE trim(word) <> '' AND trim(translation) <> '';
DROP TABLE dictionary_import;
INSERT INTO app_metadata (key, value, updated_at)
VALUES ('dictionary_source_signature', ${sqlString(signature)}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
INSERT INTO app_metadata (key, value, updated_at)
VALUES ('dictionary_indexed_at', ${sqlString(nowISO())}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
COMMIT;`, { maxBuffer: 256 * 1024 * 1024 });
}

function findDictionaryEntry(targetWord) {
  ensureSqliteStore();
  const key = targetWord.trim().toLowerCase();
  if (dictionaryCache.has(key)) return dictionaryCache.get(key);
  if (!key) return null;

  const rows = sqliteJson(`SELECT word, phonetic, english_definition, chinese_definition, part_of_speech
FROM dictionary_entries
WHERE word = ${sqlString(key)}
LIMIT 1;`);
  const row = rows[0];
  if (!row) {
    dictionaryCache.set(key, null);
    return null;
  }
  const entry = buildDictionaryEntry([
    row.word,
    row.phonetic,
    row.english_definition,
    row.chinese_definition,
    row.part_of_speech,
  ]);
  const result = entry ? { ...entry, source: 'local-ecdict-sqlite' } : null;
  dictionaryCache.set(key, result);
  return result;
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

function createSessionValue(role = 'write') {
  const payload = `${role}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

function getSessionRole(cookieHeader = '') {
  const cookies = Object.fromEntries(cookieHeader.split(';').map((item) => {
    const [key, ...rest] = item.trim().split('=');
    return [key, decodeURIComponent(rest.join('='))];
  }));
  const value = cookies[cookieName];
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = sign(payload);
  try {
    if (!timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected))) return null;
    return parts[0] === 'read' ? 'read' : 'write';
  } catch {
    return null;
  }
}

function isValidSession(cookieHeader = '') {
  return Boolean(getSessionRole(cookieHeader));
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
    const sessionRole = getSessionRole(req.headers.cookie);
    const hasBackupAccess = sessionRole || body.password === appPassword || req.headers['x-backup-password'] === appPassword;
    if (!hasBackupAccess) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return;
    }
    const state = readState();
    if (req.method === 'GET') {
      sendJson(res, state.confusingWordsBackup || null);
      return;
    }
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read only mode' }, 403);
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

  const sessionRole = getSessionRole(req.headers.cookie);
  if (!sessionRole) {
    sendJson(res, { error: 'Unauthorized' }, 401);
    return;
  }
  if (req.method !== 'GET' && sessionRole === 'read') {
    sendJson(res, { error: 'Read only mode' }, 403);
    return;
  }

  if (req.url === '/api/backups/status' && req.method === 'GET') {
    sendJson(res, getBackupStatus());
    return;
  }

  if (req.url === '/api/backups/run' && req.method === 'POST') {
    ensureSqliteStore();
    const backup = createBackupFile('manual', 'manual backup from settings page');
    sendJson(res, { ok: true, backup });
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
      readOnly: sessionRole === 'read',
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
    const password = params.get('password');
    const role = password === appPassword ? 'write' : password === readOnlyPassword ? 'read' : '';
    if (role) {
      res.writeHead(302, {
        location: '/',
        'set-cookie': `${cookieName}=${encodeURIComponent(createSessionValue(role))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
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
