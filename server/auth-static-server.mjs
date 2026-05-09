import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
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
const loginAttemptsFile = join(dataDir, 'login-attempts.json');
const port = Number(process.env.PORT || 8080);
const appPassword = process.env.APP_PASSWORD;
const readOnlyPassword = process.env.READONLY_PASSWORD || '123';
const cookieSecret = process.env.COOKIE_SECRET || randomBytes(32).toString('hex');
const cookieName = 'exam_planner_session';
const entitySchemaVersion = 1;
const loginFailureLimit = 3;
const loginLockMs = 30 * 60 * 1000;
const loginFailureDelayMinMs = 1000;
const loginFailureDelaySpreadMs = 1000;

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
let reportTimerStarted = false;
let dataRevision = 0;
let dashboardPayloadCache = null;
let statisticsSummaryCache = null;
let loginAttempts = loadLoginAttempts();

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

function parseDateString(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateString(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysISO(value, days) {
  const date = parseDateString(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateString(date);
}

function startOfWeekISO(value) {
  const date = parseDateString(value);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return formatDateString(date);
}

function endOfWeekISO(value) {
  return addDaysISO(startOfWeekISO(value), 6);
}

function startOfMonthISO(value) {
  return `${value.slice(0, 7)}-01`;
}

function endOfMonthISO(value) {
  const [year, month] = value.split('-').map(Number);
  return formatDateString(new Date(Date.UTC(year, month, 0)));
}

function previousWeekPeriod(today = todayISO()) {
  const currentWeekStart = startOfWeekISO(today);
  const end = addDaysISO(currentWeekStart, -1);
  return { periodStart: startOfWeekISO(end), periodEnd: end };
}

function previousMonthPeriod(today = todayISO()) {
  const [year, month] = today.split('-').map(Number);
  const previousMonthEnd = formatDateString(new Date(Date.UTC(year, month - 1, 0)));
  return { periodStart: startOfMonthISO(previousMonthEnd), periodEnd: previousMonthEnd };
}

function currentPeriod(kind, today = todayISO()) {
  if (kind === 'monthly') return { periodStart: startOfMonthISO(today), periodEnd: endOfMonthISO(today) };
  return { periodStart: startOfWeekISO(today), periodEnd: endOfWeekISO(today) };
}

function previousPeriod(kind, today = todayISO()) {
  return kind === 'monthly' ? previousMonthPeriod(today) : previousWeekPeriod(today);
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

function sqlValue(value) {
  if (value === undefined || value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return sqlString(value);
}

function runSqliteFile(databaseFile, script, { maxBuffer = 128 * 1024 * 1024 } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const result = spawnSync('sqlite3', [databaseFile], {
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

function runSqlite(script, { maxBuffer = 128 * 1024 * 1024 } = {}) {
  return runSqliteFile(sqliteFile, script, { maxBuffer });
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

function createStructuredTables() {
  runSqlite(`CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  type TEXT NOT NULL DEFAULT '考研',
  notes TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS daily_reviews (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL DEFAULT '',
  wins TEXT NOT NULL DEFAULT '',
  problems TEXT NOT NULL DEFAULT '',
  tomorrow_plan TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 6,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS study_projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2563eb',
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS study_time_records (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  project_name_snapshot TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0 CHECK (minutes >= 0),
  note TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(date, project_id)
);
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2563eb',
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS mock_exam_records (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  subject_name_snapshot TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  full_score REAL NOT NULL DEFAULT 100 CHECK (full_score > 0),
  paper_name TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  wrong_count INTEGER NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
  note TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS short_term_tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'medium',
  is_completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS water_intake_records (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  cups INTEGER NOT NULL DEFAULT 0 CHECK (cups >= 0),
  cup_ml INTEGER NOT NULL DEFAULT 500 CHECK (cup_ml > 0),
  target_cups INTEGER NOT NULL DEFAULT 6 CHECK (target_cups > 0),
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS confusing_words_backup (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL DEFAULT 1,
  exported_at TEXT,
  backed_up_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS learning_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('weekly', 'monthly')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_daily_reviews_date ON daily_reviews(date);
CREATE INDEX IF NOT EXISTS idx_study_time_records_date ON study_time_records(date);
CREATE INDEX IF NOT EXISTS idx_study_time_records_project ON study_time_records(project_id);
CREATE INDEX IF NOT EXISTS idx_study_time_records_project_date ON study_time_records(project_id, date);
CREATE INDEX IF NOT EXISTS idx_study_time_records_date_project_name ON study_time_records(date, project_name_snapshot);
CREATE INDEX IF NOT EXISTS idx_goals_active_deadline ON goals(is_active, deadline);
CREATE INDEX IF NOT EXISTS idx_study_projects_active_sort ON study_projects(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_subjects_active_sort ON subjects(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_mock_exam_records_date_id ON mock_exam_records(date, id);
CREATE INDEX IF NOT EXISTS idx_mock_exam_records_subject_date ON mock_exam_records(subject_id, date);
CREATE INDEX IF NOT EXISTS idx_mock_exam_records_subject_date_id ON mock_exam_records(subject_id, date, id);
CREATE INDEX IF NOT EXISTS idx_short_term_tasks_due_date ON short_term_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_short_term_tasks_visible ON short_term_tasks(is_completed, urgency, due_date);
CREATE INDEX IF NOT EXISTS idx_water_intake_records_date ON water_intake_records(date);
CREATE INDEX IF NOT EXISTS idx_learning_reports_period ON learning_reports(kind, period_start, period_end);`);
}

function insertRowsSql(table, columns, rows) {
  if (!rows.length) return '';
  const values = rows
    .map((row) => `(${columns.map((column) => sqlValue(row[column])).join(', ')})`)
    .join(',\n');
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values};`;
}

function writeStateToTables(state) {
  const normalized = normalizeState(state);
  const timestamp = nowISO();
  const scripts = [
    'BEGIN;',
    'DELETE FROM goals;',
    'DELETE FROM daily_reviews;',
    'DELETE FROM study_projects;',
    'DELETE FROM study_time_records;',
    'DELETE FROM subjects;',
    'DELETE FROM mock_exam_records;',
    'DELETE FROM short_term_tasks;',
    'DELETE FROM water_intake_records;',
    'DELETE FROM confusing_words_backup;',
  ];

  scripts.push(insertRowsSql('goals', ['id', 'name', 'description', 'deadline', 'is_active', 'type', 'notes', 'schema_version', 'created_at', 'updated_at'], normalized.goals.map((item, index) => ({
    id: Number(item.id || index + 1),
    name: item.name || '',
    description: item.description || '',
    deadline: item.deadline || todayISO(),
    is_active: Boolean(item.isActive),
    type: item.type || '考研',
    notes: item.notes || '',
    schema_version: Number(item.schemaVersion || entitySchemaVersion),
    created_at: item.createdAt || timestamp,
    updated_at: item.updatedAt || timestamp,
  }))));
  scripts.push(insertRowsSql('daily_reviews', ['id', 'date', 'summary', 'wins', 'problems', 'tomorrow_plan', 'score', 'schema_version', 'created_at', 'updated_at'], normalized.dailyReviews.map((item, index) => ({
    id: Number(item.id || index + 1),
    date: item.date || todayISO(),
    summary: item.summary || '',
    wins: item.wins || '',
    problems: item.problems || '',
    tomorrow_plan: item.tomorrowPlan || '',
    score: Math.max(1, Math.min(10, Number(item.score || 6))),
    schema_version: Number(item.schemaVersion || entitySchemaVersion),
    created_at: item.createdAt || timestamp,
    updated_at: item.updatedAt || timestamp,
  }))));
  scripts.push(insertRowsSql('study_projects', ['id', 'name', 'color', 'is_active', 'sort_order', 'schema_version', 'created_at', 'updated_at'], normalized.studyProjects.map((item, index) => ({
    id: Number(item.id || index + 1),
    name: item.name || '',
    color: item.color || projectColors[index % projectColors.length],
    is_active: item.isActive !== false,
    sort_order: Number(item.sortOrder || index + 1),
    schema_version: Number(item.schemaVersion || entitySchemaVersion),
    created_at: item.createdAt || timestamp,
    updated_at: item.updatedAt || timestamp,
  }))));
  scripts.push(insertRowsSql('study_time_records', ['id', 'date', 'project_id', 'project_name_snapshot', 'minutes', 'note', 'schema_version', 'created_at', 'updated_at'], normalized.studyTimeRecords.map((item, index) => ({
    id: Number(item.id || index + 1),
    date: item.date || todayISO(),
    project_id: Number(item.projectId || 0),
    project_name_snapshot: item.projectNameSnapshot || '',
    minutes: Math.max(0, Number(item.minutes || 0)),
    note: item.note || '',
    schema_version: Number(item.schemaVersion || entitySchemaVersion),
    created_at: item.createdAt || timestamp,
    updated_at: item.updatedAt || timestamp,
  }))));
  scripts.push(insertRowsSql('subjects', ['id', 'name', 'color', 'is_active', 'sort_order', 'schema_version', 'created_at', 'updated_at'], normalized.subjects.map((item, index) => ({
    id: Number(item.id || index + 1),
    name: item.name || '',
    color: item.color || subjectColors[index % subjectColors.length],
    is_active: item.isActive !== false,
    sort_order: Number(item.sortOrder || index + 1),
    schema_version: Number(item.schemaVersion || entitySchemaVersion),
    created_at: item.createdAt || timestamp,
    updated_at: item.updatedAt || timestamp,
  }))));
  scripts.push(insertRowsSql('mock_exam_records', ['id', 'date', 'subject_id', 'subject_name_snapshot', 'score', 'full_score', 'paper_name', 'duration_minutes', 'wrong_count', 'note', 'schema_version', 'created_at', 'updated_at'], normalized.mockExamRecords.map((item, index) => ({
    id: Number(item.id || index + 1),
    date: item.date || todayISO(),
    subject_id: Number(item.subjectId || 0),
    subject_name_snapshot: item.subjectNameSnapshot || '',
    score: Number(item.score || 0),
    full_score: Math.max(1, Number(item.fullScore || 100)),
    paper_name: item.paperName || '',
    duration_minutes: Math.max(0, Number(item.durationMinutes || 0)),
    wrong_count: Math.max(0, Number(item.wrongCount || 0)),
    note: item.note || '',
    schema_version: Number(item.schemaVersion || entitySchemaVersion),
    created_at: item.createdAt || timestamp,
    updated_at: item.updatedAt || timestamp,
  }))));
  scripts.push(insertRowsSql('short_term_tasks', ['id', 'title', 'due_date', 'urgency', 'is_completed', 'completed_at', 'note', 'schema_version', 'created_at', 'updated_at'], normalized.shortTermTasks.map((item, index) => ({
    id: Number(item.id || index + 1),
    title: item.title || '',
    due_date: item.dueDate || todayISO(),
    urgency: item.urgency || 'medium',
    is_completed: Boolean(item.isCompleted),
    completed_at: item.completedAt || null,
    note: item.note || '',
    schema_version: Number(item.schemaVersion || entitySchemaVersion),
    created_at: item.createdAt || timestamp,
    updated_at: item.updatedAt || timestamp,
  }))));
  scripts.push(insertRowsSql('water_intake_records', ['id', 'date', 'cups', 'cup_ml', 'target_cups', 'schema_version', 'created_at', 'updated_at'], normalized.waterIntakeRecords.map((item, index) => ({
    id: Number(item.id || index + 1),
    date: item.date || todayISO(),
    cups: Math.max(0, Number(item.cups || 0)),
    cup_ml: Math.max(1, Number(item.cupMl || 500)),
    target_cups: Math.max(1, Number(item.targetCups || 6)),
    schema_version: Number(item.schemaVersion || entitySchemaVersion),
    created_at: item.createdAt || timestamp,
    updated_at: item.updatedAt || timestamp,
  }))));
  if (normalized.confusingWordsBackup) {
    const payload = {
      ...normalized.confusingWordsBackup,
      groups: Array.isArray(normalized.confusingWordsBackup.groups) ? normalized.confusingWordsBackup.groups : [],
    };
    scripts.push(insertRowsSql('confusing_words_backup', ['id', 'schema_version', 'exported_at', 'backed_up_at', 'payload_json'], [{
      id: 1,
      schema_version: Number(payload.schemaVersion || entitySchemaVersion),
      exported_at: payload.exportedAt || timestamp,
      backed_up_at: payload.backedUpAt || timestamp,
      payload_json: JSON.stringify(payload),
    }]));
  }
  scripts.push(`INSERT INTO app_state (id, state_json, updated_at)
VALUES (1, ${sqlString(JSON.stringify(normalized))}, datetime('now'))
ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at;`);
  scripts.push('COMMIT;');
  runSqlite(scripts.filter(Boolean).join('\n'), { maxBuffer: 128 * 1024 * 1024 });
}

function readStateFromTables() {
  const goals = sqliteJson(`SELECT id, name, description, deadline, is_active AS isActive, type, notes,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM goals ORDER BY id;`).map((item) => ({ ...item, isActive: Boolean(item.isActive) }));
  const dailyReviews = sqliteJson(`SELECT id, date, summary, wins, problems, tomorrow_plan AS tomorrowPlan, score,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM daily_reviews ORDER BY date DESC;`).map(normalizeReview);
  const studyProjects = sqliteJson(`SELECT id, name, color, is_active AS isActive, sort_order AS sortOrder,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM study_projects ORDER BY sort_order, id;`).map((item) => ({ ...item, isActive: Boolean(item.isActive) }));
  const studyTimeRecords = sqliteJson(`SELECT id, date, project_id AS projectId, project_name_snapshot AS projectNameSnapshot, minutes, note,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM study_time_records ORDER BY date DESC, project_id;`);
  const subjects = sqliteJson(`SELECT id, name, color, is_active AS isActive, sort_order AS sortOrder,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM subjects ORDER BY sort_order, id;`).map((item) => ({ ...item, isActive: Boolean(item.isActive) }));
  const mockExamRecords = sqliteJson(`SELECT id, date, subject_id AS subjectId, subject_name_snapshot AS subjectNameSnapshot, score, full_score AS fullScore,
paper_name AS paperName, duration_minutes AS durationMinutes, wrong_count AS wrongCount, note,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM mock_exam_records ORDER BY date DESC, id DESC;`);
  const shortTermTasks = sqliteJson(`SELECT id, title, due_date AS dueDate, urgency, is_completed AS isCompleted, completed_at AS completedAt, note,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM short_term_tasks ORDER BY due_date, id;`).map((item) => ({ ...item, isCompleted: Boolean(item.isCompleted), completedAt: item.completedAt || undefined }));
  const waterIntakeRecords = sqliteJson(`SELECT id, date, cups, cup_ml AS cupMl, target_cups AS targetCups,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM water_intake_records ORDER BY date DESC;`);
  const confusingRows = sqliteJson('SELECT payload_json AS payloadJson FROM confusing_words_backup WHERE id = 1 LIMIT 1;');
  const confusingWordsBackup = confusingRows[0]?.payloadJson ? JSON.parse(confusingRows[0].payloadJson) : null;
  return normalizeState({ goals, dailyReviews, studyProjects, studyTimeRecords, subjects, mockExamRecords, shortTermTasks, waterIntakeRecords, confusingWordsBackup });
}

function readLegacyStateForMigration() {
  const stateCount = Number(sqliteScalar('SELECT COUNT(*) FROM app_state WHERE id = 1;') || 0);
  if (stateCount) return readStateFromSqlite();
  if (existsSync(legacyDataFile)) return normalizeState(JSON.parse(readFileSync(legacyDataFile, 'utf8')));
  return baseState();
}

function minutesText(minutes) {
  const value = Math.max(0, Number(minutes || 0));
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (hours && rest) return `${hours} 小时 ${rest} 分钟`;
  if (hours) return `${hours} 小时`;
  return `${rest} 分钟`;
}

function dateRange(start, end) {
  const days = [];
  for (let current = start; current <= end; current = addDaysISO(current, 1)) {
    days.push(current);
  }
  return days;
}

function compactText(value = '', maxLength = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function buildReportTitle(kind, periodStart, periodEnd) {
  const label = kind === 'monthly' ? '月报' : '周报';
  return `${periodStart} 至 ${periodEnd} 学习${label}`;
}

function buildLearningReport(kind, periodStart, periodEnd, trigger = 'auto') {
  const dailyRows = sqliteJson(`SELECT date, COALESCE(SUM(minutes), 0) AS minutes
FROM study_time_records
WHERE date BETWEEN ${sqlString(periodStart)} AND ${sqlString(periodEnd)}
GROUP BY date
ORDER BY date;`);
  const dailyMap = new Map(dailyRows.map((item) => [item.date, Number(item.minutes || 0)]));
  const dailyTotals = dateRange(periodStart, periodEnd).map((date) => ({ date, minutes: dailyMap.get(date) || 0 }));
  const projectTotals = sqliteJson(`SELECT project_name_snapshot AS name, COALESCE(SUM(minutes), 0) AS minutes
FROM study_time_records
WHERE date BETWEEN ${sqlString(periodStart)} AND ${sqlString(periodEnd)}
GROUP BY project_name_snapshot
HAVING minutes > 0
ORDER BY minutes DESC, name
LIMIT 12;`);
  const reviews = sqliteJson(`SELECT date, score, summary, wins, problems, tomorrow_plan AS tomorrowPlan
FROM daily_reviews
WHERE date BETWEEN ${sqlString(periodStart)} AND ${sqlString(periodEnd)}
ORDER BY date;`);
  const exams = sqliteJson(`SELECT date, subject_name_snapshot AS subjectName, score, full_score AS fullScore, paper_name AS paperName
FROM mock_exam_records
WHERE date BETWEEN ${sqlString(periodStart)} AND ${sqlString(periodEnd)}
ORDER BY date DESC, id DESC;`);
  const taskStats = sqliteJson(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END), 0) AS completed
FROM short_term_tasks
WHERE due_date BETWEEN ${sqlString(periodStart)} AND ${sqlString(periodEnd)};`)[0] || { total: 0, completed: 0 };
  const waterStats = sqliteJson(`SELECT COALESCE(SUM(cups), 0) AS cups, COALESCE(SUM(cups * cup_ml), 0) AS ml
FROM water_intake_records
WHERE date BETWEEN ${sqlString(periodStart)} AND ${sqlString(periodEnd)};`)[0] || { cups: 0, ml: 0 };
  const totalMinutes = dailyTotals.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const studyDays = dailyTotals.filter((item) => Number(item.minutes || 0) > 0).length;
  const averageDailyMinutes = dailyTotals.length ? Math.round(totalMinutes / dailyTotals.length) : 0;
  const averageStudyDayMinutes = studyDays ? Math.round(totalMinutes / studyDays) : 0;
  const averageReviewScore = reviews.length
    ? Math.round((reviews.reduce((sum, item) => sum + Number(item.score || 0), 0) / reviews.length) * 10) / 10
    : null;
  const completedTasks = Number(taskStats.completed || 0);
  const totalTasks = Number(taskStats.total || 0);
  const taskCompletionRate = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : null;
  const topProject = projectTotals[0] || null;
  const bestReview = reviews.length ? reviews.reduce((best, item) => Number(item.score || 0) > Number(best.score || 0) ? item : best, reviews[0]) : null;
  const lowestReview = reviews.length ? reviews.reduce((low, item) => Number(item.score || 0) < Number(low.score || 0) ? item : low, reviews[0]) : null;
  const highlights = [
    totalMinutes > 0 ? `累计学习 ${minutesText(totalMinutes)}，覆盖 ${studyDays} 天。` : '本周期还没有学习时间记录。',
    topProject ? `投入最多的是「${topProject.name}」，共 ${minutesText(topProject.minutes)}。` : '',
    averageReviewScore ? `完成 ${reviews.length} 篇复盘，平均评分 ${averageReviewScore}/10。` : '本周期没有复盘记录。',
    totalTasks ? `短期目标完成 ${completedTasks}/${totalTasks}，完成率 ${taskCompletionRate}%。` : '',
    exams.length ? `记录 ${exams.length} 次模考，最近一次是 ${exams[0].subjectName} ${exams[0].score}/${exams[0].fullScore}。` : '',
  ].filter(Boolean);
  const suggestions = [];
  if (totalMinutes === 0) suggestions.push('先恢复最小学习闭环：每天至少记录一个项目的学习时间。');
  if (reviews.length < Math.min(3, dailyTotals.length)) suggestions.push('复盘密度偏低，可以把每日复盘压缩到 5 分钟，先保持连续。');
  if (taskCompletionRate !== null && taskCompletionRate < 60) suggestions.push('短期目标完成率偏低，下一周期建议减少同时推进的目标数量。');
  if (topProject && totalMinutes > 0 && Number(topProject.minutes) / totalMinutes > 0.7) suggestions.push('学习投入集中度较高，注意给薄弱科目保留固定时间块。');
  if (!suggestions.length) suggestions.push('节奏比较稳，下一周期继续保持记录、复盘和任务闭环。');

  return {
    kind,
    title: buildReportTitle(kind, periodStart, periodEnd),
    periodStart,
    periodEnd,
    generatedAt: nowISO(),
    trigger,
    summary: {
      totalMinutes,
      studyDays,
      averageDailyMinutes,
      averageStudyDayMinutes,
      reviewCount: reviews.length,
      averageReviewScore,
      completedTasks,
      totalTasks,
      taskCompletionRate,
      waterCups: Number(waterStats.cups || 0),
      waterMl: Number(waterStats.ml || 0),
      examsCount: exams.length,
      topProject: topProject ? { name: topProject.name, minutes: Number(topProject.minutes || 0) } : null,
      bestReview: bestReview ? { date: bestReview.date, score: bestReview.score, summary: compactText(bestReview.summary) } : null,
      lowestReview: lowestReview ? { date: lowestReview.date, score: lowestReview.score, problems: compactText(lowestReview.problems) } : null,
    },
    highlights,
    suggestions,
    dailyTotals,
    projectTotals: projectTotals.map((item) => ({ name: item.name, minutes: Number(item.minutes || 0) })),
    reviews: reviews.map((item) => ({
      date: item.date,
      score: item.score,
      summary: item.summary || '',
      wins: item.wins || '',
      problems: item.problems || '',
      tomorrowPlan: item.tomorrowPlan || '',
    })),
    exams,
  };
}

function saveLearningReport(report) {
  runSqlite(`INSERT INTO learning_reports (kind, period_start, period_end, title, payload_json, generated_at, updated_at)
VALUES (${sqlString(report.kind)}, ${sqlString(report.periodStart)}, ${sqlString(report.periodEnd)}, ${sqlString(report.title)}, ${sqlString(JSON.stringify(report))}, ${sqlString(report.generatedAt)}, datetime('now'))
ON CONFLICT(kind, period_start, period_end) DO UPDATE SET
  title = excluded.title,
  payload_json = excluded.payload_json,
  generated_at = excluded.generated_at,
  updated_at = excluded.updated_at;`);
  return report;
}

function generateLearningReport(kind, periodStart, periodEnd, trigger = 'manual') {
  if (!['weekly', 'monthly'].includes(kind)) throw new Error('Invalid report kind');
  return saveLearningReport(buildLearningReport(kind, periodStart, periodEnd, trigger));
}

function reportExists(kind, periodStart, periodEnd) {
  return Number(sqliteScalar(`SELECT COUNT(*) FROM learning_reports
WHERE kind = ${sqlString(kind)} AND period_start = ${sqlString(periodStart)} AND period_end = ${sqlString(periodEnd)};`) || 0) > 0;
}

function ensureAutomaticReports() {
  const today = todayISO();
  for (const kind of ['weekly', 'monthly']) {
    const { periodStart, periodEnd } = previousPeriod(kind, today);
    if (!reportExists(kind, periodStart, periodEnd)) {
      generateLearningReport(kind, periodStart, periodEnd, 'auto');
    }
  }
  runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_report_check_at', ${sqlString(nowISO())}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
}

function listLearningReports() {
  const rows = sqliteJson(`SELECT id, kind, period_start AS periodStart, period_end AS periodEnd, title, payload_json AS payloadJson,
generated_at AS generatedAt, updated_at AS updatedAt
FROM learning_reports
ORDER BY period_end DESC, kind DESC
LIMIT 24;`);
  return rows.map((row) => ({ id: row.id, ...JSON.parse(row.payloadJson), generatedAt: row.generatedAt, updatedAt: row.updatedAt }));
}

function createBackupFile(kind = 'manual', note = '') {
  mkdirSync(backupsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, `-${Date.now() % 1000}Z`);
  const filePath = join(backupsDir, `exam-planner-${kind}-${timestamp}.sqlite`);
  runSqlite('PRAGMA wal_checkpoint(TRUNCATE);');
  if (existsSync(filePath)) unlinkSync(filePath);
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

function backupFileToRecord(fileName) {
  const filePath = join(backupsDir, fileName);
  const stats = statSync(filePath);
  const match = fileName.match(/^exam-planner-([a-z-]+)-(.+)\.sqlite$/);
  return {
    fileName,
    kind: match?.[1] || 'unknown',
    createdAt: stats.mtime.toISOString(),
    sizeBytes: stats.size,
  };
}

function listBackupFiles() {
  if (!existsSync(backupsDir)) return [];
  return readdirSync(backupsDir)
    .filter((name) => /^exam-planner-[a-z-]+-.+\.sqlite$/.test(name))
    .map(backupFileToRecord)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function restoreBackupFile(fileName) {
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName || '')) {
    throw new Error('Invalid backup file name');
  }
  const sourceFile = join(backupsDir, fileName);
  if (!existsSync(sourceFile) || !sourceFile.startsWith(backupsDir)) {
    throw new Error('Backup file not found');
  }
  const integrity = runSqliteFile(sourceFile, 'PRAGMA integrity_check;').trim();
  if (integrity !== 'ok') {
    throw new Error(`Backup integrity check failed: ${integrity}`);
  }

  const safetyBackup = createBackupFile('pre-restore', `automatic safety backup before restoring ${fileName}`);
  runSqlite('PRAGMA wal_checkpoint(TRUNCATE);');
  copyFileSync(sourceFile, sqliteFile);
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${sqliteFile}${suffix}`;
    if (existsSync(sidecar)) unlinkSync(sidecar);
  }
  sqliteReady = false;
  dictionaryIndexChecked = false;
  ensureSqliteStore();
  runSqlite(`INSERT INTO backup_log (kind, file_path, created_at, note)
VALUES ('restore', ${sqlString(sourceFile)}, datetime('now'), ${sqlString(`restored from ${fileName}; safety backup ${safetyBackup.filePath}`)});`);
  return { restoredFrom: fileName, safetyBackup };
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
  const backups = listBackupFiles();
  const backupRows = sqliteJson(`SELECT kind, file_path AS filePath, created_at AS createdAt, note
FROM backup_log
ORDER BY datetime(created_at) DESC
LIMIT 1;`);
  const dictionaryCount = Number(sqliteScalar('SELECT COUNT(*) FROM dictionary_entries;') || 0);
  const lastWeeklyBackupAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_weekly_backup_at' LIMIT 1;");
  const dictionaryIndexedAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'dictionary_indexed_at' LIMIT 1;");
  return {
    storage: 'sqlite-tables',
    sqliteFile,
    sqliteSizeBytes: existsSync(sqliteFile) ? statSync(sqliteFile).size : 0,
    backupCount: backups.length,
    backups,
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
  createStructuredTables();

  const stateCount = Number(sqliteScalar('SELECT COUNT(*) FROM app_state WHERE id = 1;') || 0);
  if (!stateCount && existsSync(legacyDataFile)) {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const legacyBackupDir = join(backupsDir, `auto-pre-sqlite-${timestamp}`);
    mkdirSync(legacyBackupDir, { recursive: true });
    writeFileSync(join(legacyBackupDir, 'db.json'), readFileSync(legacyDataFile));
    writeStateToSqlite(JSON.parse(readFileSync(legacyDataFile, 'utf8')));
  } else if (!stateCount) {
    writeStateToSqlite(baseState());
  }

  const structuredVersion = Number(sqliteScalar("SELECT value FROM app_metadata WHERE key = 'structured_schema_version' LIMIT 1;") || 0);
  if (structuredVersion < 1) {
    createBackupFile('pre-tables', 'automatic backup before structured table migration');
    writeStateToTables(readLegacyStateForMigration());
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('structured_schema_version', '1', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  }
  if (structuredVersion < 2) {
    createBackupFile('pre-reports', 'automatic backup before learning reports migration');
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('structured_schema_version', '2', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  }

  runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('storage_backend', 'sqlite-tables', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  sqliteReady = true;
  ensureWeeklyBackup();
  ensureDictionaryIndex();
  ensureAutomaticReports();
  if (!reportTimerStarted) {
    setInterval(() => {
      ensureWeeklyBackup();
      ensureAutomaticReports();
    }, 6 * 60 * 60 * 1000).unref();
    reportTimerStarted = true;
  }
}

function readState() {
  ensureSqliteStore();
  return readStateFromTables();
}

function writeState(state) {
  ensureSqliteStore();
  writeStateToTables(state);
  tableChanged();
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

function nextTableId(table) {
  return Number(sqliteScalar(`SELECT COALESCE(MAX(id), 0) + 1 FROM ${table};`) || 1);
}

function tableChanged() {
  dataRevision += 1;
  dashboardPayloadCache = null;
  statisticsSummaryCache = null;
  runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('data_updated_at', ${sqlString(nowISO())}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
}

function saveGoalSql(payload) {
  const timestamp = nowISO();
  if (payload.isActive) {
    runSqlite(`UPDATE goals SET is_active = 0, updated_at = ${sqlString(timestamp)} WHERE id <> ${sqlValue(Number(payload.id || 0))};`);
  }
  if (payload.id && Number(sqliteScalar(`SELECT COUNT(*) FROM goals WHERE id = ${sqlValue(Number(payload.id))};`) || 0)) {
    runSqlite(`UPDATE goals SET
name = ${sqlValue(payload.name)},
description = ${sqlValue(payload.description || '')},
deadline = ${sqlValue(payload.deadline || todayISO())},
is_active = ${sqlValue(Boolean(payload.isActive))},
type = ${sqlValue(payload.type || '考研')},
notes = ${sqlValue(payload.notes || '')},
updated_at = ${sqlValue(timestamp)}
WHERE id = ${sqlValue(Number(payload.id))};`);
    tableChanged();
    return Number(payload.id);
  }
  const id = nextTableId('goals');
  runSqlite(`INSERT INTO goals (id, name, description, deadline, is_active, type, notes, schema_version, created_at, updated_at)
VALUES (${id}, ${sqlValue(payload.name || '')}, ${sqlValue(payload.description || '')}, ${sqlValue(payload.deadline || todayISO())}, ${sqlValue(payload.isActive !== false)}, ${sqlValue(payload.type || '考研')}, ${sqlValue(payload.notes || '')}, ${entitySchemaVersion}, ${sqlValue(timestamp)}, ${sqlValue(timestamp)});`);
  tableChanged();
  return id;
}

function saveProjectSql(payload) {
  const timestamp = nowISO();
  if (payload.id && Number(sqliteScalar(`SELECT COUNT(*) FROM study_projects WHERE id = ${sqlValue(Number(payload.id))};`) || 0)) {
    runSqlite(`UPDATE study_projects SET
name = ${sqlValue(payload.name || '')},
color = ${sqlValue(payload.color || '#2563eb')},
is_active = ${sqlValue(payload.isActive !== false)},
sort_order = ${sqlValue(Number(payload.sortOrder || 0))},
updated_at = ${sqlValue(timestamp)}
WHERE id = ${sqlValue(Number(payload.id))};`);
    tableChanged();
    return Number(payload.id);
  }
  const id = nextTableId('study_projects');
  const sortOrder = Number(payload.sortOrder || sqliteScalar('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM study_projects;') || id);
  runSqlite(`INSERT INTO study_projects (id, name, color, is_active, sort_order, schema_version, created_at, updated_at)
VALUES (${id}, ${sqlValue(payload.name || '')}, ${sqlValue(payload.color || '#2563eb')}, 1, ${sqlValue(sortOrder)}, ${entitySchemaVersion}, ${sqlValue(timestamp)}, ${sqlValue(timestamp)});`);
  tableChanged();
  return id;
}

function saveSubjectSql(payload) {
  const timestamp = nowISO();
  if (payload.id && Number(sqliteScalar(`SELECT COUNT(*) FROM subjects WHERE id = ${sqlValue(Number(payload.id))};`) || 0)) {
    runSqlite(`UPDATE subjects SET
name = ${sqlValue(payload.name || '')},
color = ${sqlValue(payload.color || '#2563eb')},
is_active = ${sqlValue(payload.isActive !== false)},
sort_order = ${sqlValue(Number(payload.sortOrder || 0))},
updated_at = ${sqlValue(timestamp)}
WHERE id = ${sqlValue(Number(payload.id))};`);
    tableChanged();
    return Number(payload.id);
  }
  const id = nextTableId('subjects');
  const sortOrder = Number(payload.sortOrder || sqliteScalar('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM subjects;') || id);
  runSqlite(`INSERT INTO subjects (id, name, color, is_active, sort_order, schema_version, created_at, updated_at)
VALUES (${id}, ${sqlValue(payload.name || '')}, ${sqlValue(payload.color || '#2563eb')}, 1, ${sqlValue(sortOrder)}, ${entitySchemaVersion}, ${sqlValue(timestamp)}, ${sqlValue(timestamp)});`);
  tableChanged();
  return id;
}

function saveExamSql(payload) {
  const timestamp = nowISO();
  const id = payload.id && Number(sqliteScalar(`SELECT COUNT(*) FROM mock_exam_records WHERE id = ${sqlValue(Number(payload.id))};`) || 0)
    ? Number(payload.id)
    : nextTableId('mock_exam_records');
  const fields = {
    date: payload.date || todayISO(),
    subjectId: Number(payload.subjectId || 0),
    subjectNameSnapshot: payload.subjectNameSnapshot || '',
    score: Number(payload.score || 0),
    fullScore: Math.max(1, Number(payload.fullScore || 100)),
    paperName: payload.paperName || '',
    durationMinutes: Math.max(0, Number(payload.durationMinutes || 0)),
    wrongCount: Math.max(0, Number(payload.wrongCount || 0)),
    note: payload.note || '',
  };
  runSqlite(`INSERT INTO mock_exam_records (id, date, subject_id, subject_name_snapshot, score, full_score, paper_name, duration_minutes, wrong_count, note, schema_version, created_at, updated_at)
VALUES (${id}, ${sqlValue(fields.date)}, ${sqlValue(fields.subjectId)}, ${sqlValue(fields.subjectNameSnapshot)}, ${sqlValue(fields.score)}, ${sqlValue(fields.fullScore)}, ${sqlValue(fields.paperName)}, ${sqlValue(fields.durationMinutes)}, ${sqlValue(fields.wrongCount)}, ${sqlValue(fields.note)}, ${entitySchemaVersion}, ${sqlValue(timestamp)}, ${sqlValue(timestamp)})
ON CONFLICT(id) DO UPDATE SET
date = excluded.date,
subject_id = excluded.subject_id,
subject_name_snapshot = excluded.subject_name_snapshot,
score = excluded.score,
full_score = excluded.full_score,
paper_name = excluded.paper_name,
duration_minutes = excluded.duration_minutes,
wrong_count = excluded.wrong_count,
note = excluded.note,
updated_at = excluded.updated_at;`);
  tableChanged();
  return id;
}

function saveTaskSql(payload) {
  const timestamp = nowISO();
  const id = payload.id && Number(sqliteScalar(`SELECT COUNT(*) FROM short_term_tasks WHERE id = ${sqlValue(Number(payload.id))};`) || 0)
    ? Number(payload.id)
    : nextTableId('short_term_tasks');
  runSqlite(`INSERT INTO short_term_tasks (id, title, due_date, urgency, is_completed, completed_at, note, schema_version, created_at, updated_at)
VALUES (${id}, ${sqlValue(payload.title || '')}, ${sqlValue(payload.dueDate || todayISO())}, ${sqlValue(payload.urgency || 'medium')}, ${sqlValue(Boolean(payload.isCompleted))}, ${sqlValue(payload.completedAt || null)}, ${sqlValue(payload.note || '')}, ${entitySchemaVersion}, ${sqlValue(timestamp)}, ${sqlValue(timestamp)})
ON CONFLICT(id) DO UPDATE SET
title = excluded.title,
due_date = excluded.due_date,
urgency = excluded.urgency,
is_completed = excluded.is_completed,
completed_at = excluded.completed_at,
note = excluded.note,
updated_at = excluded.updated_at;`);
  tableChanged();
  return id;
}

function upsertReviewSql(payload) {
  const timestamp = nowISO();
  const review = normalizeReview(payload);
  const id = payload.id || Number(sqliteScalar(`SELECT id FROM daily_reviews WHERE date = ${sqlValue(payload.date || todayISO())} LIMIT 1;`) || 0) || nextTableId('daily_reviews');
  runSqlite(`INSERT INTO daily_reviews (id, date, summary, wins, problems, tomorrow_plan, score, schema_version, created_at, updated_at)
VALUES (${sqlValue(id)}, ${sqlValue(payload.date || todayISO())}, ${sqlValue(review.summary || '')}, ${sqlValue(review.wins || '')}, ${sqlValue(review.problems || '')}, ${sqlValue(review.tomorrowPlan || '')}, ${sqlValue(Math.max(1, Math.min(10, Number(review.score || 6))))}, ${entitySchemaVersion}, ${sqlValue(timestamp)}, ${sqlValue(timestamp)})
ON CONFLICT(date) DO UPDATE SET
summary = excluded.summary,
wins = excluded.wins,
problems = excluded.problems,
tomorrow_plan = excluded.tomorrow_plan,
score = excluded.score,
updated_at = excluded.updated_at;`);
  tableChanged();
  return id;
}

function saveDayRecordsSql(date, records = []) {
  const timestamp = nowISO();
  const statements = ['BEGIN;'];
  let nextRecordId = nextTableId('study_time_records');
  for (const record of records) {
    const existingId = Number(sqliteScalar(`SELECT id FROM study_time_records WHERE date = ${sqlValue(date)} AND project_id = ${sqlValue(Number(record.projectId || 0))} LIMIT 1;`) || 0);
    const id = existingId || nextRecordId++;
    statements.push(`INSERT INTO study_time_records (id, date, project_id, project_name_snapshot, minutes, note, schema_version, created_at, updated_at)
VALUES (${id}, ${sqlValue(date)}, ${sqlValue(Number(record.projectId || 0))}, ${sqlValue(record.projectNameSnapshot || '')}, ${sqlValue(Math.max(0, Number(record.minutes || 0)))}, ${sqlValue(record.note || '')}, ${entitySchemaVersion}, ${sqlValue(timestamp)}, ${sqlValue(timestamp)})
ON CONFLICT(date, project_id) DO UPDATE SET
project_name_snapshot = excluded.project_name_snapshot,
minutes = excluded.minutes,
note = excluded.note,
updated_at = excluded.updated_at;`);
  }
  statements.push('COMMIT;');
  runSqlite(statements.join('\n'));
  tableChanged();
}

function saveWaterSql(payload) {
  const timestamp = nowISO();
  const date = payload.date || todayISO();
  const id = Number(sqliteScalar(`SELECT id FROM water_intake_records WHERE date = ${sqlValue(date)} LIMIT 1;`) || 0) || nextTableId('water_intake_records');
  runSqlite(`INSERT INTO water_intake_records (id, date, cups, cup_ml, target_cups, schema_version, created_at, updated_at)
VALUES (${id}, ${sqlValue(date)}, ${sqlValue(Math.max(0, Number(payload.cups || 0)))}, ${sqlValue(Math.max(1, Number(payload.cupMl || 500)))}, ${sqlValue(Math.max(1, Number(payload.targetCups || 6)))}, ${entitySchemaVersion}, ${sqlValue(timestamp)}, ${sqlValue(timestamp)})
ON CONFLICT(date) DO UPDATE SET
cups = excluded.cups,
cup_ml = excluded.cup_ml,
target_cups = excluded.target_cups,
updated_at = excluded.updated_at;`);
  tableChanged();
}

function getLastNDaysTotals(days, endDate = todayISO()) {
  const startDate = addDaysISO(endDate, -(days - 1));
  const rows = sqliteJson(`SELECT date, COALESCE(SUM(minutes), 0) AS minutes
FROM study_time_records
WHERE date BETWEEN ${sqlString(startDate)} AND ${sqlString(endDate)}
GROUP BY date;`);
  const map = new Map(rows.map((row) => [row.date, Number(row.minutes || 0)]));
  return dateRange(startDate, endDate).map((date) => ({ date, minutes: map.get(date) || 0 }));
}

function getProjectTotals(startDate, endDate) {
  return sqliteJson(`SELECT project_name_snapshot AS name, COALESCE(SUM(minutes), 0) AS minutes
FROM study_time_records
WHERE date BETWEEN ${sqlString(startDate)} AND ${sqlString(endDate)}
GROUP BY project_name_snapshot
HAVING minutes > 0
ORDER BY minutes DESC, name;`).map((row) => ({ name: row.name, minutes: Number(row.minutes || 0) }));
}

function getDashboardPayload(sessionRole) {
  const cacheDate = todayISO();
  if (dashboardPayloadCache?.revision === dataRevision && dashboardPayloadCache.date === cacheDate) {
    return { ...dashboardPayloadCache.payload, readOnly: sessionRole === 'read' };
  }
  const today = cacheDate;
  const yesterday = addDaysISO(today, -1);
  const activeGoal = sqliteJson(`SELECT id, name, description, deadline, is_active AS isActive, type, notes,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM goals WHERE is_active = 1 ORDER BY id LIMIT 1;`).map((goal) => ({ ...goal, isActive: Boolean(goal.isActive) }))[0] || null;
  const todayTotal = Number(sqliteScalar(`SELECT COALESCE(SUM(minutes), 0) FROM study_time_records WHERE date = ${sqlString(today)};`) || 0);
  const distribution = sqliteJson(`SELECT project_name_snapshot AS name, COALESCE(SUM(minutes), 0) AS value
FROM study_time_records
WHERE date = ${sqlString(today)}
GROUP BY project_name_snapshot
HAVING value > 0
ORDER BY value DESC;`).map((row) => ({ name: row.name, value: Number(row.value || 0) }));
  const trend = getLastNDaysTotals(7, today);
  const latestExam = sqliteJson(`SELECT id, date, subject_id AS subjectId, subject_name_snapshot AS subjectNameSnapshot, score, full_score AS fullScore,
paper_name AS paperName, duration_minutes AS durationMinutes, wrong_count AS wrongCount, note,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM mock_exam_records ORDER BY date DESC, id DESC LIMIT 1;`)[0] || null;
  const reviews = sqliteJson(`SELECT id, date, summary, wins, problems, tomorrow_plan AS tomorrowPlan, score,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM daily_reviews WHERE date IN (${sqlString(today)}, ${sqlString(yesterday)});`).map(normalizeReview);
  const visibleTasks = sqliteJson(`SELECT id, title, due_date AS dueDate, urgency, is_completed AS isCompleted, completed_at AS completedAt, note,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM short_term_tasks
WHERE is_completed = 0 OR date(completed_at) = date(${sqlString(today)})
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date, id;`).map((task) => ({ ...task, isCompleted: Boolean(task.isCompleted), completedAt: task.completedAt || undefined }));
  const waterRecord = sqliteJson(`SELECT id, date, cups, cup_ml AS cupMl, target_cups AS targetCups,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM water_intake_records WHERE date = ${sqlString(today)} LIMIT 1;`)[0] || null;

  const payload = {
    activeGoal,
    today,
    todayTotal,
    distribution,
    trend,
    latestExam,
    todayReview: reviews.find((review) => review.date === today) || null,
    yesterdayReview: reviews.find((review) => review.date === yesterday) || null,
    visibleTasks,
    todayWaterRecord: waterRecord,
  };
  dashboardPayloadCache = { revision: dataRevision, date: today, payload };
  return { ...payload, readOnly: sessionRole === 'read' };
}

function getStatisticsSummary() {
  const cacheDate = todayISO();
  if (statisticsSummaryCache?.revision === dataRevision && statisticsSummaryCache.date === cacheDate) {
    return statisticsSummaryCache.payload;
  }
  const today = cacheDate;
  const todayTotal = Number(sqliteScalar(`SELECT COALESCE(SUM(minutes), 0) FROM study_time_records WHERE date = ${sqlString(today)};`) || 0);
  const distribution = sqliteJson(`SELECT project_name_snapshot AS name, COALESCE(SUM(minutes), 0) AS value
FROM study_time_records
WHERE date = ${sqlString(today)}
GROUP BY project_name_snapshot
HAVING value > 0
ORDER BY value DESC;`).map((row) => ({ name: row.name, value: Number(row.value || 0) }));
  const last7 = getLastNDaysTotals(7, today);
  const last30 = getProjectTotals(addDaysISO(today, -29), today);
  const payload = { today, todayTotal, distribution, last7, last30 };
  statisticsSummaryCache = { revision: dataRevision, date: today, payload };
  return payload;
}

function queryLimit(searchParams, defaultLimit = 20, maxLimit = 100) {
  const value = searchParams.get('limit');
  if (!value) return null;
  return Math.max(1, Math.min(maxLimit, Number(value) || defaultLimit));
}

function queryOffset(searchParams) {
  return Math.max(0, Number(searchParams.get('offset') || 0) || 0);
}

function getGoalsList(sessionRole) {
  const items = sqliteJson(`SELECT id, name, description, deadline, is_active AS isActive, type, notes,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM goals
ORDER BY created_at DESC, id DESC;`).map((goal) => ({ ...goal, isActive: Boolean(goal.isActive) }));
  return { items, readOnly: sessionRole === 'read' };
}

function getProjectsList(sessionRole) {
  const items = sqliteJson(`SELECT id, name, color, is_active AS isActive, sort_order AS sortOrder,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM study_projects
ORDER BY sort_order, id;`).map((project) => ({ ...project, isActive: Boolean(project.isActive) }));
  return { items, readOnly: sessionRole === 'read' };
}

function getSubjectsList(sessionRole) {
  const items = sqliteJson(`SELECT id, name, color, is_active AS isActive, sort_order AS sortOrder,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM subjects
ORDER BY sort_order, id;`).map((subject) => ({ ...subject, isActive: Boolean(subject.isActive) }));
  return { items, readOnly: sessionRole === 'read' };
}

function selectExamRecord(whereClause, orderClause = 'ORDER BY date DESC, id DESC', suffix = '') {
  return sqliteJson(`SELECT id, date, subject_id AS subjectId, subject_name_snapshot AS subjectNameSnapshot, score, full_score AS fullScore,
paper_name AS paperName, duration_minutes AS durationMinutes, wrong_count AS wrongCount, note,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM mock_exam_records
${whereClause}
${orderClause}
${suffix};`);
}

function getMockExamList(requestUrl, sessionRole) {
  const subjectIdParam = requestUrl.searchParams.get('subjectId') || 'all';
  const subjectId = subjectIdParam === 'all' ? null : Number(subjectIdParam);
  const whereClause = subjectId ? `WHERE subject_id = ${sqlValue(subjectId)}` : '';
  const limit = queryLimit(requestUrl.searchParams, 20, 100) ?? 20;
  const offset = queryOffset(requestUrl.searchParams);
  const total = Number(sqliteScalar(`SELECT COUNT(*) FROM mock_exam_records ${whereClause};`) || 0);
  const exams = selectExamRecord(whereClause, 'ORDER BY date DESC, id DESC', `LIMIT ${limit} OFFSET ${offset}`);
  const latest = selectExamRecord(whereClause, 'ORDER BY date DESC, id DESC', 'LIMIT 1')[0] || null;
  const statsRow = sqliteJson(`SELECT MAX(score) AS highest, ROUND(AVG(score), 1) AS average, MIN(score) AS lowest
FROM mock_exam_records ${whereClause};`)[0] || {};
  const trend = selectExamRecord(whereClause, 'ORDER BY date DESC, id DESC', 'LIMIT 80')
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.id || 0) - Number(b.id || 0))
    .map((exam) => ({ date: exam.date, score: Number(exam.score || 0) }));
  return {
    exams,
    total,
    limit,
    offset,
    stats: {
      latest,
      highest: statsRow.highest == null ? null : Number(statsRow.highest),
      average: statsRow.average == null ? null : Number(statsRow.average),
      lowest: statsRow.lowest == null ? null : Number(statsRow.lowest),
    },
    trend,
    readOnly: sessionRole === 'read',
  };
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

function loadLoginAttempts() {
  try {
    if (!existsSync(loginAttemptsFile)) return {};
    const parsed = JSON.parse(readFileSync(loginAttemptsFile, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLoginAttempts() {
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(loginAttemptsFile, JSON.stringify(loginAttempts, null, 2), 'utf8');
  } catch {
    // Login attempt persistence is defensive; a write failure should not block the app.
  }
}

function pruneLoginAttempts(now = Date.now()) {
  let changed = false;
  for (const [ip, entry] of Object.entries(loginAttempts)) {
    const lastFailedAt = Number(entry.lastFailedAt || 0);
    const lockedUntil = Number(entry.lockedUntil || 0);
    if (lockedUntil <= now && lastFailedAt && now - lastFailedAt > 24 * 60 * 60 * 1000) {
      delete loginAttempts[ip];
      changed = true;
    }
  }
  if (changed) saveLoginAttempts();
}

function getClientIp(req) {
  const realIp = Array.isArray(req.headers['x-real-ip']) ? req.headers['x-real-ip'][0] : req.headers['x-real-ip'];
  const forwardedFor = Array.isArray(req.headers['x-forwarded-for']) ? req.headers['x-forwarded-for'][0] : req.headers['x-forwarded-for'];
  const rawIp = String(realIp || forwardedFor?.split(',')[0] || req.socket.remoteAddress || 'unknown').trim();
  return rawIp.replace(/^::ffff:/, '');
}

function getLoginLock(ip) {
  const now = Date.now();
  const entry = loginAttempts[ip];
  if (!entry) return null;
  const lockedUntil = Number(entry.lockedUntil || 0);
  if (lockedUntil > now) {
    return { lockedUntil, remainingMs: lockedUntil - now };
  }
  if (lockedUntil) {
    delete loginAttempts[ip];
    saveLoginAttempts();
  }
  return null;
}

function recordLoginSuccess(ip) {
  if (loginAttempts[ip]) {
    delete loginAttempts[ip];
    saveLoginAttempts();
  }
}

function recordLoginFailure(ip) {
  pruneLoginAttempts();
  const now = Date.now();
  const entry = loginAttempts[ip] || { failures: 0, lastFailedAt: 0, lockedUntil: 0 };
  const failures = Number(entry.failures || 0) + 1;
  const lockedUntil = failures >= loginFailureLimit ? now + loginLockMs : 0;
  loginAttempts[ip] = { failures, lastFailedAt: now, lockedUntil };
  saveLoginAttempts();
  return loginAttempts[ip];
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function loginFailureDelay() {
  return sleep(loginFailureDelayMinMs + Math.floor(Math.random() * loginFailureDelaySpreadMs));
}

function lockMessage(remainingMs) {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `登录失败次数过多，已临时锁定。请 ${minutes} 分钟后再试。`;
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

async function readJsonBody(req) {
  const body = await readBody(req);
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error('Invalid JSON body');
    error.statusCode = 400;
    throw error;
  }
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
    const body = await readJsonBody(req);
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
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
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

  if (req.url === '/api/backups/restore' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = restoreBackupFile(body.fileName);
    sendJson(res, { ok: true, ...result });
    return;
  }

  if (req.url === '/api/goals' && req.method === 'GET') {
    ensureSqliteStore();
    sendJson(res, getGoalsList(sessionRole));
    return;
  }

  if (req.url === '/api/projects' && req.method === 'GET') {
    ensureSqliteStore();
    sendJson(res, getProjectsList(sessionRole));
    return;
  }

  if (req.url === '/api/subjects' && req.method === 'GET') {
    ensureSqliteStore();
    sendJson(res, getSubjectsList(sessionRole));
    return;
  }

  if (req.url === '/api/dashboard' && req.method === 'GET') {
    ensureSqliteStore();
    sendJson(res, getDashboardPayload(sessionRole));
    return;
  }

  if (req.url?.startsWith('/api/reviews') && req.method === 'GET') {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const from = requestUrl.searchParams.get('from') || '1900-01-01';
    const to = requestUrl.searchParams.get('to') || '2999-12-31';
    const limit = queryLimit(requestUrl.searchParams, 20, 100);
    const offset = queryOffset(requestUrl.searchParams);
    const total = Number(sqliteScalar(`SELECT COUNT(*) FROM daily_reviews
WHERE date BETWEEN ${sqlString(from)} AND ${sqlString(to)};`) || 0);
    const paging = limit ? `LIMIT ${limit} OFFSET ${offset}` : '';
    const reviews = sqliteJson(`SELECT id, date, summary, wins, problems, tomorrow_plan AS tomorrowPlan, score,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM daily_reviews
WHERE date BETWEEN ${sqlString(from)} AND ${sqlString(to)}
ORDER BY date DESC
${paging};`).map(normalizeReview);
    sendJson(res, { reviews, total, limit, offset, readOnly: sessionRole === 'read' });
    return;
  }

  if (req.url?.startsWith('/api/study-records') && req.method === 'GET') {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const date = requestUrl.searchParams.get('date') || todayISO();
    const records = sqliteJson(`SELECT id, date, project_id AS projectId, project_name_snapshot AS projectNameSnapshot, minutes, note,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM study_time_records
WHERE date = ${sqlString(date)}
ORDER BY project_id;`);
    sendJson(res, { records, readOnly: sessionRole === 'read' });
    return;
  }

  if (req.url?.startsWith('/api/mock-exams') && req.method === 'GET') {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    sendJson(res, getMockExamList(requestUrl, sessionRole));
    return;
  }

  if (req.url === '/api/statistics/summary' && req.method === 'GET') {
    ensureSqliteStore();
    sendJson(res, getStatisticsSummary());
    return;
  }

  if (req.url?.startsWith('/api/reports') && req.method === 'GET') {
    ensureSqliteStore();
    ensureAutomaticReports();
    sendJson(res, { reports: listLearningReports() });
    return;
  }

  if (req.url === '/api/reports/generate' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const kind = body.kind === 'monthly' ? 'monthly' : 'weekly';
    const period = body.period === 'previous' ? previousPeriod(kind) : currentPeriod(kind);
    const report = generateLearningReport(kind, body.periodStart || period.periodStart, body.periodEnd || period.periodEnd, 'manual');
    sendJson(res, { ok: true, report });
    return;
  }

  const body = req.method === 'POST' ? await readJsonBody(req) : {};
  const timestamp = nowISO();

  if (req.url === '/api/reset' && req.method === 'POST') {
    writeState(baseState());
    sendJson(res, { ok: true });
    return;
  }

  const directRoutes = {
    '/api/goals/save': () => saveGoalSql(body),
    '/api/projects/save': () => saveProjectSql(body),
    '/api/subjects/save': () => saveSubjectSql(body),
    '/api/exams/save': () => saveExamSql(body),
    '/api/tasks/save': () => saveTaskSql(body),
  };

  if (req.method === 'POST' && directRoutes[req.url]) {
    sendJson(res, directRoutes[req.url]());
    return;
  }

  if (req.url === '/api/goals/activate' && req.method === 'POST') {
    runSqlite(`UPDATE goals SET is_active = CASE WHEN id = ${sqlValue(Number(body.id))} THEN 1 ELSE 0 END, updated_at = ${sqlValue(timestamp)};`);
    tableChanged();
    sendJson(res, { ok: true });
    return;
  }

  if (req.url === '/api/water/save' && req.method === 'POST') {
    saveWaterSql(body);
    sendJson(res, { ok: true });
    return;
  }

  if (req.url === '/api/goals/remove' && req.method === 'POST') runSqlite(`DELETE FROM goals WHERE id = ${sqlValue(Number(body.id))};`);
  else if (req.url === '/api/projects/remove' && req.method === 'POST') runSqlite(`UPDATE study_projects SET is_active = 0, updated_at = ${sqlValue(timestamp)} WHERE id = ${sqlValue(Number(body.id))};`);
  else if (req.url === '/api/subjects/remove' && req.method === 'POST') runSqlite(`UPDATE subjects SET is_active = 0, updated_at = ${sqlValue(timestamp)} WHERE id = ${sqlValue(Number(body.id))};`);
  else if (req.url === '/api/exams/remove' && req.method === 'POST') runSqlite(`DELETE FROM mock_exam_records WHERE id = ${sqlValue(Number(body.id))};`);
  else if (req.url === '/api/tasks/remove' && req.method === 'POST') runSqlite(`DELETE FROM short_term_tasks WHERE id = ${sqlValue(Number(body.id))};`);
  else if (req.url === '/api/tasks/toggle' && req.method === 'POST') runSqlite(`UPDATE short_term_tasks SET is_completed = ${sqlValue(Boolean(body.completed))}, completed_at = ${sqlValue(body.completed ? timestamp : null)}, updated_at = ${sqlValue(timestamp)} WHERE id = ${sqlValue(Number(body.id))};`);
  else if (req.url === '/api/reviews/upsert' && req.method === 'POST') {
    sendJson(res, upsertReviewSql(body));
    return;
  } else if (req.url === '/api/study-records/save-day' && req.method === 'POST') {
    saveDayRecordsSql(body.date || todayISO(), body.records || []);
    sendJson(res, { ok: true });
    return;
  } else if (req.method === 'POST' && req.url !== '/api/reset') {
    sendJson(res, { error: 'Not found' }, 404);
    return;
  }

  if (req.method === 'POST') {
    tableChanged();
    sendJson(res, { ok: true });
    return;
  }

  const state = readState();

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

  sendJson(res, { error: 'Not found' }, 404);
}

createServer(async (req, res) => {
  if (req.url === '/login' && req.method === 'POST') {
    const clientIp = getClientIp(req);
    const params = new URLSearchParams(await readBody(req));
    const locked = getLoginLock(clientIp);
    if (locked) {
      await loginFailureDelay();
      sendHtml(res, loginPage(lockMessage(locked.remainingMs)), 429);
      return;
    }
    const password = params.get('password');
    const role = password === appPassword ? 'write' : password === readOnlyPassword ? 'read' : '';
    if (role) {
      recordLoginSuccess(clientIp);
      res.writeHead(302, {
        location: '/',
        'set-cookie': `${cookieName}=${encodeURIComponent(createSessionValue(role))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
      });
      res.end();
      return;
    }
    const attempt = recordLoginFailure(clientIp);
    await loginFailureDelay();
    if (attempt.lockedUntil && attempt.lockedUntil > Date.now()) {
      sendHtml(res, loginPage(lockMessage(attempt.lockedUntil - Date.now())), 429);
      return;
    }
    const remainingAttempts = Math.max(0, loginFailureLimit - Number(attempt.failures || 0));
    sendHtml(res, loginPage(`密码不正确，请重试。剩余 ${remainingAttempts} 次后将锁定 30 分钟。`), 401);
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.url?.startsWith('/api/')) {
    try {
      await handleApi(req, res);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) {
        sendJson(res, { error: error.message || 'Server error' }, error.statusCode || 500);
      } else {
        res.end();
      }
    }
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
