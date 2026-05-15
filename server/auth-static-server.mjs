import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os';

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const dataDir = resolve(fileURLToPath(new URL('../data', import.meta.url)));
const legacyDataFile = join(dataDir, 'db.json');
const sqliteFile = join(dataDir, 'exam-planner.sqlite');
const backupsDir = join(dataDir, 'backups');
const dictionaryFile = join(dataDir, 'ecdict.csv');
const loginAttemptsFile = join(dataDir, 'login-attempts.json');
const embeddingWorkerFile = join(resolve(fileURLToPath(new URL('.', import.meta.url))), 'embedding_worker.py');
const embeddingCacheDir = process.env.EMBEDDING_CACHE_DIR || join(dataDir, 'embedding-models');
const smallEmbeddingModelName = process.env.EMBEDDING_MODEL_NAME || 'BAAI/bge-small-zh-v1.5';
const largeEmbeddingModelName = process.env.LARGE_EMBEDDING_MODEL_NAME || 'intfloat/multilingual-e5-large';
const port = Number(process.env.PORT || 8080);
const appPassword = process.env.APP_PASSWORD;
const readOnlyPassword = process.env.READONLY_PASSWORD || '123';
const cookieSecret = process.env.COOKIE_SECRET || randomBytes(32).toString('hex');
const cookieName = 'exam_planner_session';
const entitySchemaVersion = 1;
const studyTargetMinutesKey = 'study_target_minutes';
const dailyBriefSettingsKey = 'daily_brief_settings_json';
const dailyBriefNewsCooldownKey = 'daily_brief_news_cooldown_until';
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
  '.webmanifest': 'application/manifest+json; charset=utf-8',
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
let nightlyErrorThemeTimerStarted = false;
let dailyBriefTimerStarted = false;
let dailyBriefTimer = null;
let errorThemeBatchJob = null;
let nextNightlyErrorThemeAt = null;
let nextDailyBriefAt = null;
let dataRevision = 0;
let dashboardPayloadCache = null;
let statisticsSummaryCache = null;
let loginAttempts = loadLoginAttempts();

function nowISO() {
  return new Date().toISOString();
}

function localDateISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayISO() {
  return localDateISO();
}

function addYearISO() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return localDateISO(date);
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
CREATE TABLE IF NOT EXISTS study_daily_summaries (
  date TEXT PRIMARY KEY,
  total_minutes INTEGER NOT NULL DEFAULT 0,
  record_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS study_project_daily_summaries (
  date TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  project_name_snapshot TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0,
  record_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(date, project_id, project_name_snapshot)
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
CREATE TABLE IF NOT EXISTS daily_briefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  emailed_at TEXT,
  email_error TEXT NOT NULL DEFAULT '',
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS error_theme_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'local-model-batch',
  model_name TEXT NOT NULL DEFAULT 'local-review-topic-v1',
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  review_count INTEGER NOT NULL DEFAULT 0,
  occurrence_count INTEGER NOT NULL DEFAULT 0,
  theme_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL,
  completed_at TEXT,
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS error_themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_label TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  first_seen_at TEXT,
  last_seen_at TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 0,
  review_day_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS error_theme_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_id INTEGER NOT NULL,
  batch_id INTEGER NOT NULL,
  review_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  field TEXT NOT NULL,
  evidence TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.6,
  source TEXT NOT NULL DEFAULT 'local-model-batch',
  created_at TEXT NOT NULL,
  UNIQUE(theme_id, review_id, field, evidence)
);
CREATE TABLE IF NOT EXISTS review_sentence_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  field TEXT NOT NULL,
  sentence TEXT NOT NULL,
  sentence_hash TEXT NOT NULL,
  model_name TEXT NOT NULL,
  backend TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(sentence_hash, model_name)
);
CREATE TABLE IF NOT EXISTS error_theme_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sentence_hash TEXT NOT NULL,
  sentence TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'relabel',
  target_theme_key TEXT,
  target_label TEXT,
  source_theme_key TEXT,
  source_label TEXT,
  review_id INTEGER,
  date TEXT,
  field TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(sentence_hash, action, target_theme_key)
);
CREATE INDEX IF NOT EXISTS idx_daily_reviews_date ON daily_reviews(date);
CREATE INDEX IF NOT EXISTS idx_study_time_records_date ON study_time_records(date);
CREATE INDEX IF NOT EXISTS idx_study_time_records_project ON study_time_records(project_id);
CREATE INDEX IF NOT EXISTS idx_study_time_records_project_date ON study_time_records(project_id, date);
CREATE INDEX IF NOT EXISTS idx_study_time_records_date_project_name ON study_time_records(date, project_name_snapshot);
CREATE INDEX IF NOT EXISTS idx_study_daily_summaries_date ON study_daily_summaries(date);
CREATE INDEX IF NOT EXISTS idx_study_project_daily_summaries_date ON study_project_daily_summaries(date);
CREATE INDEX IF NOT EXISTS idx_study_project_daily_summaries_name_date ON study_project_daily_summaries(project_name_snapshot, date);
CREATE INDEX IF NOT EXISTS idx_goals_active_deadline ON goals(is_active, deadline);
CREATE INDEX IF NOT EXISTS idx_study_projects_active_sort ON study_projects(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_subjects_active_sort ON subjects(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_mock_exam_records_date_id ON mock_exam_records(date, id);
CREATE INDEX IF NOT EXISTS idx_mock_exam_records_subject_date ON mock_exam_records(subject_id, date);
CREATE INDEX IF NOT EXISTS idx_mock_exam_records_subject_date_id ON mock_exam_records(subject_id, date, id);
CREATE INDEX IF NOT EXISTS idx_short_term_tasks_due_date ON short_term_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_short_term_tasks_visible ON short_term_tasks(is_completed, urgency, due_date);
CREATE INDEX IF NOT EXISTS idx_water_intake_records_date ON water_intake_records(date);
CREATE INDEX IF NOT EXISTS idx_learning_reports_period ON learning_reports(kind, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_daily_briefs_date ON daily_briefs(date);
CREATE INDEX IF NOT EXISTS idx_error_theme_batches_period ON error_theme_batches(period_start, period_end, created_at);
CREATE INDEX IF NOT EXISTS idx_error_theme_occurrences_date ON error_theme_occurrences(date);
CREATE INDEX IF NOT EXISTS idx_error_theme_occurrences_theme_date ON error_theme_occurrences(theme_id, date);
CREATE INDEX IF NOT EXISTS idx_error_theme_occurrences_batch ON error_theme_occurrences(batch_id);
CREATE INDEX IF NOT EXISTS idx_review_sentence_embeddings_date ON review_sentence_embeddings(date);
CREATE INDEX IF NOT EXISTS idx_review_sentence_embeddings_hash_model ON review_sentence_embeddings(sentence_hash, model_name);
CREATE INDEX IF NOT EXISTS idx_error_theme_corrections_hash ON error_theme_corrections(sentence_hash);
CREATE INDEX IF NOT EXISTS idx_error_theme_corrections_target ON error_theme_corrections(target_theme_key);`);
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
    'DELETE FROM study_daily_summaries;',
    'DELETE FROM study_project_daily_summaries;',
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
  rebuildStudySummaries();
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

const reviewProblemThemes = [
  {
    id: 'attention',
    label: '注意力分散 / 拖延',
    keywords: ['拖延', '拖拉', '分心', '走神', '浮躁', '静不下心', '手机', '短视频', '娱乐', '娱乐时间', '摸鱼', '专注度', '注意力', '控制不住', '微信', '小红书', '抖音', '视频号', 'b站', 'B站', 'bilibili', '刷视频', '刷手机', '刷了'],
  },
  {
    id: 'english-reading',
    label: '英语阅读问题',
    keywords: ['英语阅读', '阅读理解', '真题阅读', '长难句', '读不懂', '正确率', '准确率', '阅读错', '阅读速度', '英语真题'],
  },
  {
    id: 'professional-course',
    label: '专业课推进偏慢',
    keywords: ['专业课', '进度慢', '进度较慢', '进度有点慢', '听课', '章节', '课程', '信号与系统', '背诵慢'],
  },
  {
    id: 'math-errors',
    label: '数学错题 / 概念计算',
    keywords: ['数学错', '高数错', '线代错', '线性代数错', '概率错', '错题', '错太多', '做错', '算错', '计算错误', '计算失误', '公式', '概念', '题错', '不会做', '不会算'],
  },
  {
    id: 'planning',
    label: '计划执行 / 时间安排',
    keywords: ['计划', '安排', '时间不够', '没完成', '未完成', '没看', '没学', '没做', '没复习', '没开始', '没推进', '没碰', '赶不上', '效率', '效率低', '效率低下', '效率不高', '执行', '任务', '拖到'],
  },
  {
    id: 'energy',
    label: '作息精力状态',
    keywords: ['困', '睡眠', '熬夜', '起晚', '疲惫', '累', '状态差', '精力', '头疼', '生病', '晚睡'],
  },
  {
    id: 'exam-assignment',
    label: '考试作业压力',
    keywords: ['考试', '作业', '报告', '论文', '实验', 'ddl', '截止', '结课', '复习不过来'],
  },
  {
    id: 'review-gap',
    label: '复盘记录缺失 / 反馈不足',
    keywords: ['没复盘', '复盘少', '总结少', '没有总结', '没有记录', '忘记记录', '记录少'],
  },
];

const reviewProblemFields = [
  { key: 'problems', label: '今日问题' },
  { key: 'summary', label: '今日总结' },
  { key: 'tomorrowPlan', label: '明日计划' },
];

function getErrorThemeOptions() {
  return reviewProblemThemes.map((theme) => ({ id: theme.id, label: theme.label }));
}

function themeOptionById(themeId) {
  return getErrorThemeOptions().find((theme) => theme.id === themeId) || null;
}

function textIncludesKeyword(text, keywords) {
  const normalized = String(text || '').toLowerCase();
  return keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase()));
}

function matchedProblemExample(review, theme) {
  for (const field of reviewProblemFields) {
    const text = review[field.key] || '';
    if (text && textIncludesKeyword(text, theme.keywords)) {
      return { date: review.date, field: field.label, text: compactText(text, 80) };
    }
  }
  return null;
}

function buildReviewProblemSummary(reviews, limit = 6) {
  return reviewProblemThemes
    .map((theme) => {
      const dates = new Set();
      const examples = [];
      for (const review of reviews) {
        const example = matchedProblemExample(review, theme);
        if (!example) continue;
        dates.add(review.date);
        if (examples.length < 3) examples.push(example);
      }
      const sortedDates = Array.from(dates).sort();
      return {
        id: theme.id,
        label: theme.label,
        count: sortedDates.length,
        dates: sortedDates,
        keywords: theme.keywords,
        examples,
      };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return (b.dates[b.dates.length - 1] || '').localeCompare(a.dates[a.dates.length - 1] || '');
    })
    .slice(0, limit);
}

function splitReviewSentences(text) {
  return String(text || '')
    .split(/[。！？!?；;，,、\s\n\r]+/)
    .map((item) => compactText(item, 120))
    .filter((item) => item.length >= 2);
}

function keywordMatches(text, keywords) {
  const normalized = String(text || '').toLowerCase();
  return keywords.filter((keyword) => normalized.includes(String(keyword).toLowerCase()));
}

function looksLikeResolvedStatement(text, keyword) {
  const normalized = String(text || '').toLowerCase();
  const normalizedKeyword = String(keyword).toLowerCase();
  const index = normalized.indexOf(normalizedKeyword);
  if (index < 0) return false;
  const prefix = normalized.slice(Math.max(0, index - 5), index);
  return /(没有|沒|未|不再|无|避免了|克服了|减少了|改善了)/.test(prefix);
}

function classifyReviewSegment(segment, fieldKey) {
  const normalizedSegment = String(segment || '');
  const planningTheme = reviewProblemThemes.find((theme) => theme.id === 'planning');
  if (planningTheme && isStudyNotDoneSegment(normalizedSegment)) {
    const fieldWeight = fieldKey === 'problems' ? 0.16 : fieldKey === 'tomorrowPlan' ? 0.08 : 0;
    return { theme: planningTheme, confidence: Math.min(0.96, 0.78 + fieldWeight), matchedKeywords: ['没看'] };
  }
  const candidates = [];
  for (const theme of reviewProblemThemes) {
    if (theme.id === 'math-errors' && !isMathErrorSegment(normalizedSegment)) continue;
    const matches = keywordMatches(segment, theme.keywords)
      .filter((keyword) => !looksLikeResolvedStatement(segment, keyword));
    if (!matches.length) continue;
    const fieldWeight = fieldKey === 'problems' ? 0.16 : fieldKey === 'tomorrowPlan' ? 0.08 : 0;
    const confidence = Math.min(0.96, Math.round((0.5 + fieldWeight + matches.length * 0.12) * 100) / 100);
    candidates.push({ theme, confidence, matchedKeywords: matches });
  }
  return candidates.sort((a, b) => b.confidence - a.confidence)[0] || null;
}

function sentenceHash(text) {
  return createHash('sha256').update(String(text || '')).digest('hex');
}

function segmentKey(segment) {
  return `${segment.reviewId}|${segment.field}|${segment.sentenceHash}`;
}

function extractReviewProblemSegments(reviews) {
  const fields = reviewProblemFields;
  const segments = [];
  for (const review of reviews) {
    for (const field of fields) {
      for (const sentence of splitReviewSentences(review[field.key])) {
        segments.push({
          reviewId: Number(review.id),
          date: review.date,
          fieldKey: field.key,
          field: field.label,
          sentence,
          sentenceHash: sentenceHash(sentence),
        });
      }
    }
  }
  return segments;
}

function hasProblemCue(segment, fieldKey) {
  if (fieldKey === 'problems') return true;
  const text = String(segment || '');
  const negativeCue = /(问题|错误|错|慢|拖|没|未|不足|不会|不懂|卡住|卡了|低下|不高|较差|太差|难|困|熬夜|分心|走神|注意力|不集中|不太集中|集中不了|浮躁|静不下心|没啥状态|状态不好|状态差|抖音|微信|小红书|视频号|刷视频|刷手机|效率低|效率低下|效率不高)/;
  if (fieldKey === 'tomorrowPlan') {
    return negativeCue.test(text) || /(卸载|关闭|限制).*(抖音|微信|小红书|视频号|手机)/.test(text);
  }
  return negativeCue.test(text);
}

function isStudyNotDoneSegment(segment) {
  const text = String(segment || '');
  const subjectPattern = /(高数|高等数学|线代|线性代数|概率|数学|英语阅读|阅读|专业课|政治|单词|真题|错题|课程)/;
  const notDonePattern = /(没看|没学|没做|没复习|没开始|没推进|没碰|没刷|没练|未看|未学|未做|未复习|未开始|未推进)/;
  return (subjectPattern.test(text) && notDonePattern.test(text)) || /(又没看|还是没看|还没看|没怎么看|没来得及看)/.test(text);
}

function isMathErrorSegment(segment) {
  const text = String(segment || '');
  const mathSubjectPattern = /(数学|高数|高等数学|线代|线性代数|概率)/;
  const mathErrorPattern = /(错|计算|算错|公式|概念|题|不会做|不会算|证明|推导)/;
  return /(计算错误|计算失误|错题|错太多|题错|算错)/.test(text) || (mathSubjectPattern.test(text) && mathErrorPattern.test(text));
}

function isClearlyPositiveSegment(segment, fieldKey) {
  if (fieldKey === 'problems') return false;
  const text = String(segment || '');
  const positiveCue = /(有进步|明显进步|做得不错|比较顺利|完成了|已完成|保持|稳定|掌握|按计划|效率提高|状态不错)/;
  return positiveCue.test(text) && !hasProblemCue(text, fieldKey);
}

function extractRuleProblemCandidates(reviews, skippedSegmentKeys = new Set()) {
  const candidates = [];
  for (const review of reviews) {
    for (const field of reviewProblemFields) {
      for (const sentence of splitReviewSentences(review[field.key])) {
        const key = segmentKey({ reviewId: Number(review.id), field: field.label, sentenceHash: sentenceHash(sentence) });
        if (skippedSegmentKeys.has(key)) continue;
        if (!hasProblemCue(sentence, field.key)) continue;
        if (isClearlyPositiveSegment(sentence, field.key)) continue;
        const matched = classifyReviewSegment(sentence, field.key);
        if (!matched) continue;
        candidates.push({
          reviewId: Number(review.id),
          date: review.date,
          themeId: matched.theme.id,
          label: matched.theme.label,
          field: field.label,
          evidence: sentence,
          confidence: matched.confidence,
          source: 'local-rule-batch',
        });
      }
    }
  }
  return candidates;
}

function resolveEmbeddingPython() {
  const serverDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
  const candidates = [
    process.env.EMBEDDING_PYTHON,
    join(serverDir, '.venv', 'bin', 'python'),
    join(serverDir, '.venv', 'Scripts', 'python.exe'),
    'python3',
    'python',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

function normalizeEmbeddingModelProfile(profile) {
  return profile === 'small' ? 'small' : 'large';
}

function embeddingModelNameForProfile(profile) {
  return normalizeEmbeddingModelProfile(profile) === 'small' ? smallEmbeddingModelName : largeEmbeddingModelName;
}

function getEmbeddingStatus(profile = 'large') {
  const modelProfile = normalizeEmbeddingModelProfile(profile);
  const modelName = embeddingModelNameForProfile(modelProfile);
  const python = resolveEmbeddingPython();
  const baseStatus = {
    available: false,
    backend: 'unavailable',
    modelName,
    modelProfile,
    smallModelName: smallEmbeddingModelName,
    largeModelName: largeEmbeddingModelName,
    nightlyModelProfile: 'rules',
    manualModelProfile: 'rules',
    cacheDir: embeddingCacheDir,
    workerFile: embeddingWorkerFile,
    python,
    error: '',
  };
  if (!python) return { ...baseStatus, error: 'Python executable not found' };
  if (!existsSync(embeddingWorkerFile)) return { ...baseStatus, error: 'embedding_worker.py not found' };
  const result = spawnSync(python, ['-c', 'import fastembed; print("fastembed")'], { encoding: 'utf8', timeout: 10000 });
  if (result.error) return { ...baseStatus, error: result.error.message };
  if (result.status !== 0) return { ...baseStatus, error: result.stderr || result.stdout || 'fastembed import failed' };
  return { ...baseStatus, available: true, backend: 'fastembed', error: '' };
}

function runEmbeddingWorker(texts, modelName = largeEmbeddingModelName) {
  const python = resolveEmbeddingPython();
  if (!python) throw new Error('Python executable not found');
  if (!existsSync(embeddingWorkerFile)) throw new Error('embedding_worker.py not found');
  const maxBuffer = 96 * 1024 * 1024;
  return new Promise((resolveWorker, rejectWorker) => {
    const command = process.platform === 'win32' ? python : 'nice';
    const args = process.platform === 'win32' ? [embeddingWorkerFile] : ['-n', '10', python, embeddingWorkerFile];
    const child = spawn(command, args, {
      env: {
        ...process.env,
        HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com',
        EMBEDDING_MODEL_NAME: modelName,
        EMBEDDING_CACHE_DIR: embeddingCacheDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      fail(new Error('embedding worker timed out'));
      child.kill('SIGKILL');
    }, 45 * 60 * 1000);

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectWorker(error);
    }

    function appendStdout(chunk) {
      stdout += chunk.toString('utf8');
      if (stdout.length > maxBuffer) {
        fail(new Error('embedding worker stdout exceeded limit'));
        child.kill('SIGKILL');
      }
    }

    function appendStderr(chunk) {
      stderr += chunk.toString('utf8');
      if (stderr.length > maxBuffer) {
        fail(new Error('embedding worker stderr exceeded limit'));
        child.kill('SIGKILL');
      }
    }

    child.stdout.on('data', appendStdout);
    child.stderr.on('data', appendStderr);
    child.on('error', fail);
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        rejectWorker(new Error(stderr || stdout || `embedding worker failed${signal ? `: ${signal}` : ''}`));
        return;
      }
      try {
        const payload = JSON.parse(stdout || '{}');
        if (!payload.ok) throw new Error(payload.error || 'embedding worker unavailable');
        resolveWorker(payload);
      } catch (error) {
        rejectWorker(error);
      }
    });
    child.stdin.end(JSON.stringify({ texts, modelName, cacheDir: embeddingCacheDir }));
  });
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const av = Number(a[index] || 0);
    const bv = Number(b[index] || 0);
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function storeSentenceEmbeddings(segments, vectors, backend, modelName, dimensions, timestamp) {
  segments.forEach((segment, index) => {
    const vector = vectors[index];
    if (!vector) return;
    runSqlite(`INSERT OR IGNORE INTO review_sentence_embeddings (review_id, date, field, sentence, sentence_hash, model_name, backend, vector_json, dimensions, created_at)
VALUES (${sqlValue(segment.reviewId)}, ${sqlString(segment.date)}, ${sqlString(segment.field)}, ${sqlString(segment.sentence)}, ${sqlString(segment.sentenceHash)}, ${sqlString(modelName)}, ${sqlString(backend)}, ${sqlString(JSON.stringify(vector))}, ${sqlValue(dimensions)}, ${sqlString(timestamp)});`);
  });
}

function themeSeedText(theme) {
  return `${theme.label}。典型表现：${theme.keywords.join('、')}`;
}

function semanticThresholdForField(fieldKey, hasCue) {
  if (fieldKey === 'problems') return hasCue ? 0.68 : 0.76;
  if (fieldKey === 'tomorrowPlan') return hasCue ? 0.74 : 0.82;
  return hasCue ? 0.78 : 0.86;
}

async function extractEmbeddingProblemCandidates(reviews, timestamp, skippedSegmentKeys = new Set(), modelProfile = 'large') {
  const selectedProfile = normalizeEmbeddingModelProfile(modelProfile);
  const requestedModelName = embeddingModelNameForProfile(selectedProfile);
  const segments = extractReviewProblemSegments(reviews);
  if (!segments.length) {
    return { candidates: [], modelName: requestedModelName, modelProfile: selectedProfile, source: 'local-embedding-batch', backend: 'fastembed', dimensions: 0, embeddedSentenceCount: 0 };
  }
  const seedTexts = reviewProblemThemes.map(themeSeedText);
  const workerResult = await runEmbeddingWorker([...segments.map((item) => item.sentence), ...seedTexts], requestedModelName);
  const vectors = workerResult.embeddings || [];
  const segmentVectors = vectors.slice(0, segments.length);
  const seedVectors = vectors.slice(segments.length);
  const modelName = workerResult.modelName || requestedModelName;
  const backend = workerResult.backend || 'fastembed';
  const dimensions = Number(workerResult.dimensions || segmentVectors[0]?.length || 0);
  storeSentenceEmbeddings(segments, segmentVectors, backend, modelName, dimensions, timestamp);

  const candidates = [];
  segments.forEach((segment, index) => {
    const vector = segmentVectors[index];
    if (!vector) return;
    if (skippedSegmentKeys.has(segmentKey(segment))) return;
    if (!hasProblemCue(segment.sentence, segment.fieldKey)) return;
    if (isClearlyPositiveSegment(segment.sentence, segment.fieldKey)) return;
    if (classifyReviewSegment(segment.sentence, segment.fieldKey)) return;
    let best = null;
    let secondBest = null;
    seedVectors.forEach((seedVector, seedIndex) => {
      const similarity = cosineSimilarity(vector, seedVector);
      if (!best || similarity > best.similarity) {
        secondBest = best;
        best = { similarity, theme: reviewProblemThemes[seedIndex] };
      } else if (!secondBest || similarity > secondBest.similarity) {
        secondBest = { similarity, theme: reviewProblemThemes[seedIndex] };
      }
    });
    if (!best) return;
    const cue = hasProblemCue(segment.sentence, segment.fieldKey);
    const threshold = semanticThresholdForField(segment.fieldKey, cue);
    if (best.similarity < threshold) return;
    if (secondBest && best.similarity - secondBest.similarity < 0.035) return;
    candidates.push({
      reviewId: segment.reviewId,
      date: segment.date,
      themeId: best.theme.id,
      label: best.theme.label,
      field: segment.field,
      evidence: segment.sentence,
      confidence: Math.min(0.97, Math.max(0.55, Math.round(best.similarity * 100) / 100)),
      source: 'local-embedding-batch',
    });
  });
  return { candidates, modelName, modelProfile: selectedProfile, source: 'local-embedding-batch', backend, dimensions, embeddedSentenceCount: segments.length };
}

function mergeProblemCandidates(primary, secondary) {
  const seen = new Set();
  const merged = [];
  for (const candidate of [...primary, ...secondary]) {
    const key = `${candidate.themeId}|${candidate.reviewId}|${String(candidate.evidence || '').replace(/\s+/g, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
  }
  return merged;
}

function loadErrorThemeCorrections() {
  return sqliteJson(`SELECT id, sentence_hash AS sentenceHash, sentence, action, target_theme_key AS targetThemeKey,
target_label AS targetLabel, source_theme_key AS sourceThemeKey, source_label AS sourceLabel, review_id AS reviewId, date, field
FROM error_theme_corrections
ORDER BY updated_at DESC, created_at DESC, id DESC;`);
}

function correctionMatchesSegment(correction, segment) {
  if (correction.sentenceHash === segment.sentenceHash) return true;
  const correctionText = String(correction.sentence || '').replace(/\s+/g, '');
  const segmentText = String(segment.sentence || '').replace(/\s+/g, '');
  return correctionText.length >= 4 && segmentText.length >= 4 && (correctionText.includes(segmentText) || segmentText.includes(correctionText));
}

function extractCorrectionProblemCandidates(reviews, corrections) {
  const candidates = [];
  const handledSegmentKeys = new Set();
  const segments = extractReviewProblemSegments(reviews);
  for (const segment of segments) {
    const correction = corrections.find((item) => correctionMatchesSegment(item, segment));
    if (!correction) continue;
    handledSegmentKeys.add(segmentKey(segment));
    if (correction.action === 'ignore') continue;
    const target = themeOptionById(correction.targetThemeKey);
    if (!target) continue;
    candidates.push({
      reviewId: segment.reviewId,
      date: segment.date,
      themeId: target.id,
      label: target.label,
      field: segment.field,
      evidence: segment.sentence,
      confidence: 0.99,
      source: 'local-correction-sample',
    });
  }
  return { candidates, handledSegmentKeys };
}

function candidateRank(candidate) {
  const fieldRank = candidate.field === '今日问题' ? 30 : candidate.field === '明日计划' ? 20 : 10;
  const sourceRank = candidate.source === 'local-rule-batch' ? 3 : 1;
  return fieldRank + sourceRank + Number(candidate.confidence || 0);
}

function dedupeProblemCandidates(candidates) {
  const grouped = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.themeId}|${candidate.reviewId}`;
    const current = grouped.get(key);
    if (!current || candidateRank(candidate) > candidateRank(current)) {
      grouped.set(key, candidate);
    }
  }
  return Array.from(grouped.values());
}

function clearGeneratedErrorThemeOccurrences(periodStart, periodEnd) {
  runSqlite(`DELETE FROM error_theme_occurrences
WHERE date BETWEEN ${sqlString(periodStart)} AND ${sqlString(periodEnd)}
  AND source IN ('local-embedding-batch', 'local-rule-batch', 'local-model-batch', 'local-correction-sample');`);
}

function upsertErrorTheme(themeId, label, timestamp) {
  runSqlite(`INSERT INTO error_themes (normalized_label, label, created_at, updated_at)
VALUES (${sqlString(themeId)}, ${sqlString(label)}, ${sqlString(timestamp)}, ${sqlString(timestamp)})
ON CONFLICT(normalized_label) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at;`);
  return Number(sqliteScalar(`SELECT id FROM error_themes WHERE normalized_label = ${sqlString(themeId)} LIMIT 1;`) || 0);
}

function refreshErrorThemeStats() {
  runSqlite(`UPDATE error_themes
SET
  occurrence_count = (SELECT COUNT(*) FROM error_theme_occurrences WHERE theme_id = error_themes.id),
  review_day_count = (SELECT COUNT(DISTINCT date) FROM error_theme_occurrences WHERE theme_id = error_themes.id),
  first_seen_at = (SELECT MIN(date) FROM error_theme_occurrences WHERE theme_id = error_themes.id),
  last_seen_at = (SELECT MAX(date) FROM error_theme_occurrences WHERE theme_id = error_themes.id),
  updated_at = ${sqlString(nowISO())};`);
}

function saveErrorThemeCorrection(payload) {
  ensureSqliteStore();
  const timestamp = nowISO();
  const occurrenceId = Number(payload.occurrenceId || 0);
  const occurrence = occurrenceId
    ? sqliteJson(`SELECT o.id, o.review_id AS reviewId, o.date, o.field, o.evidence, o.theme_id AS themeId,
t.normalized_label AS sourceThemeKey, t.label AS sourceLabel
FROM error_theme_occurrences o
JOIN error_themes t ON t.id = o.theme_id
WHERE o.id = ${sqlValue(occurrenceId)}
LIMIT 1;`)[0]
    : null;
  const sentence = String(payload.sentence || occurrence?.evidence || '').trim();
  if (!sentence) throw new Error('Missing correction sentence');
  const action = payload.action === 'ignore' ? 'ignore' : 'relabel';
  const target = action === 'relabel' ? themeOptionById(payload.targetThemeKey) : null;
  if (action === 'relabel' && !target) throw new Error('Invalid target theme');
  const hash = sentenceHash(sentence);
  runSqlite(`INSERT INTO error_theme_corrections (sentence_hash, sentence, action, target_theme_key, target_label, source_theme_key, source_label, review_id, date, field, created_at, updated_at)
VALUES (${sqlString(hash)}, ${sqlString(sentence)}, ${sqlString(action)}, ${sqlValue(target?.id || null)}, ${sqlValue(target?.label || null)}, ${sqlValue(payload.sourceThemeKey || occurrence?.sourceThemeKey || null)}, ${sqlValue(payload.sourceLabel || occurrence?.sourceLabel || null)}, ${sqlValue(Number(payload.reviewId || occurrence?.reviewId || 0) || null)}, ${sqlValue(payload.date || occurrence?.date || null)}, ${sqlValue(payload.field || occurrence?.field || null)}, ${sqlString(timestamp)}, ${sqlString(timestamp)})
ON CONFLICT(sentence_hash, action, target_theme_key) DO UPDATE SET
  sentence = excluded.sentence,
  source_theme_key = excluded.source_theme_key,
  source_label = excluded.source_label,
  review_id = excluded.review_id,
  date = excluded.date,
  field = excluded.field,
  updated_at = excluded.updated_at;`);

  if (occurrenceId && action === 'ignore') {
    runSqlite(`DELETE FROM error_theme_occurrences WHERE id = ${sqlValue(occurrenceId)};`);
  } else if (occurrenceId && target) {
    const targetThemeId = upsertErrorTheme(target.id, target.label, timestamp);
    runSqlite(`UPDATE error_theme_occurrences
SET theme_id = ${sqlValue(targetThemeId)}, confidence = 0.99, source = 'local-correction-sample', created_at = ${sqlString(timestamp)}
WHERE id = ${sqlValue(occurrenceId)};`);
  }
  refreshErrorThemeStats();
  return {
    ok: true,
    correction: {
      sentenceHash: hash,
      sentence,
      action,
      targetThemeKey: target?.id || null,
      targetLabel: target?.label || null,
    },
  };
}

function insertErrorThemeBatch({ periodStart, periodEnd, reviewCount, occurrenceCount, themeCount, timestamp, completedAt = timestamp, source, modelName, note, status = 'completed' }) {
  runSqlite(`INSERT INTO error_theme_batches (source, model_name, period_start, period_end, review_count, occurrence_count, theme_count, status, created_at, completed_at, note)
VALUES (${sqlString(source)}, ${sqlString(modelName)}, ${sqlString(periodStart)}, ${sqlString(periodEnd)}, ${sqlValue(reviewCount)}, ${sqlValue(occurrenceCount)}, ${sqlValue(themeCount)}, ${sqlString(status)}, ${sqlString(timestamp)}, ${sqlValue(completedAt)}, ${sqlString(note)});`);
  return Number(sqliteScalar(`SELECT id FROM error_theme_batches WHERE created_at = ${sqlString(timestamp)} ORDER BY id DESC LIMIT 1;`) || 0);
}

function recordFailedErrorThemeBatch({ periodStart, periodEnd, modelName, note }) {
  const timestamp = nowISO();
  const reviewCount = Number(sqliteScalar(`SELECT COUNT(*) FROM daily_reviews WHERE date BETWEEN ${sqlString(periodStart)} AND ${sqlString(periodEnd)};`) || 0);
  return insertErrorThemeBatch({
    periodStart,
    periodEnd,
    reviewCount,
    occurrenceCount: 0,
    themeCount: 0,
    timestamp,
    completedAt: timestamp,
    source: 'local-embedding-batch',
    modelName,
    note,
    status: 'failed',
  });
}

async function runErrorThemeBatch(periodStart = '1900-01-01', periodEnd = todayISO(), options = {}) {
  ensureSqliteStore();
  const timestamp = nowISO();
  const from = periodStart || '1900-01-01';
  const to = periodEnd || todayISO();
  const modelProfile = normalizeEmbeddingModelProfile(options.modelProfile);
  const reviews = sqliteJson(`SELECT id, date, summary, wins, problems, tomorrow_plan AS tomorrowPlan
FROM daily_reviews
WHERE date BETWEEN ${sqlString(from)} AND ${sqlString(to)}
ORDER BY date;`);
  const corrections = loadErrorThemeCorrections();
  const correctionResult = extractCorrectionProblemCandidates(reviews, corrections);
  let embeddingMeta = null;
  let candidates = correctionResult.candidates;
  if (options.mode === 'rules') {
    candidates = mergeProblemCandidates(correctionResult.candidates, extractRuleProblemCandidates(reviews, correctionResult.handledSegmentKeys));
  } else {
    embeddingMeta = await extractEmbeddingProblemCandidates(reviews, timestamp, correctionResult.handledSegmentKeys, modelProfile);
    const ruleCandidates = extractRuleProblemCandidates(reviews, correctionResult.handledSegmentKeys);
    candidates = mergeProblemCandidates(correctionResult.candidates, mergeProblemCandidates(embeddingMeta.candidates, ruleCandidates));
  }
  const rawCandidateCount = candidates.length;
  candidates = dedupeProblemCandidates(candidates);
  clearGeneratedErrorThemeOccurrences(from, to);
  const batchSource = embeddingMeta && !embeddingMeta.error ? 'local-embedding-batch' : 'local-rule-batch';
  const modelName = embeddingMeta && !embeddingMeta.error ? embeddingMeta.modelName : 'local-review-topic-v1';
  const triggerLabel = options.trigger || 'manual';
  const note = options.mode === 'rules'
    ? `${triggerLabel} rule batch classification; embedding model skipped`
    : `${triggerLabel} local batch classification; profile=${modelProfile}; backend=${embeddingMeta?.backend || 'rules'}; dimensions=${embeddingMeta?.dimensions || 0}`;
  const themeKeys = new Set(candidates.map((item) => item.themeId));
  const batchId = insertErrorThemeBatch({
    periodStart: from,
    periodEnd: to,
    reviewCount: reviews.length,
    occurrenceCount: candidates.length,
    themeCount: themeKeys.size,
    timestamp,
    source: batchSource,
    modelName,
    note,
  });
  const themeIdMap = new Map();
  for (const candidate of candidates) {
    if (!themeIdMap.has(candidate.themeId)) {
      themeIdMap.set(candidate.themeId, upsertErrorTheme(candidate.themeId, candidate.label, timestamp));
    }
    const themeRowId = themeIdMap.get(candidate.themeId);
    runSqlite(`INSERT OR IGNORE INTO error_theme_occurrences (theme_id, batch_id, review_id, date, field, evidence, confidence, source, created_at)
VALUES (${sqlValue(themeRowId)}, ${sqlValue(batchId)}, ${sqlValue(candidate.reviewId)}, ${sqlString(candidate.date)}, ${sqlString(candidate.field)}, ${sqlString(candidate.evidence)}, ${sqlValue(candidate.confidence)}, ${sqlString(candidate.source || batchSource)}, ${sqlString(timestamp)});`);
  }
  refreshErrorThemeStats();
  return {
    batchId,
    periodStart: from,
    periodEnd: to,
    reviewCount: reviews.length,
    occurrenceCount: candidates.length,
    rawCandidateCount,
    deduplicatedCount: Math.max(0, rawCandidateCount - candidates.length),
    themeCount: themeKeys.size,
    modelName,
    modelProfile: options.mode === 'rules' ? 'rules' : modelProfile,
    source: batchSource,
    backend: embeddingMeta?.backend || 'rules',
    dimensions: embeddingMeta?.dimensions || 0,
    embeddedSentenceCount: embeddingMeta?.embeddedSentenceCount || 0,
    fallbackReason: embeddingMeta?.error || '',
    completedAt: timestamp,
  };
}

function currentErrorThemeJobSnapshot() {
  return errorThemeBatchJob ? { ...errorThemeBatchJob } : null;
}

function refreshCurrentReportsAfterBatch(trigger = 'manual') {
  try {
    for (const kind of ['weekly', 'monthly']) {
      for (const period of [previousPeriod(kind), currentPeriod(kind)]) {
        generateLearningReport(kind, period.periodStart, period.periodEnd, trigger);
      }
    }
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_report_precomputed_at', ${sqlString(nowISO())}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  } catch (error) {
    console.error('[reports] refresh after error theme batch failed:', error);
  }
}

function startErrorThemeBatchJob({ periodStart = '1900-01-01', periodEnd = todayISO(), mode = 'rules', trigger = 'manual', modelProfile = 'large' } = {}) {
  if (errorThemeBatchJob?.status === 'running' || errorThemeBatchJob?.status === 'queued') {
    return { started: false, job: currentErrorThemeJobSnapshot() };
  }
  const selectedProfile = normalizeEmbeddingModelProfile(modelProfile);
  const selectedModelName = embeddingModelNameForProfile(selectedProfile);
  const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  errorThemeBatchJob = {
    id: jobId,
    status: 'queued',
    periodStart,
    periodEnd,
    mode,
    trigger,
    modelProfile: mode === 'rules' ? 'rules' : selectedProfile,
    modelName: mode === 'rules' ? 'local-review-topic-v1' : selectedModelName,
    startedAt: nowISO(),
    completedAt: null,
    result: null,
    error: '',
  };
  setTimeout(async () => {
    if (!errorThemeBatchJob || errorThemeBatchJob.id !== jobId) return;
    errorThemeBatchJob = { ...errorThemeBatchJob, status: 'running' };
    try {
      const result = await runErrorThemeBatch(periodStart, periodEnd, { mode, modelProfile: selectedProfile, trigger });
      refreshCurrentReportsAfterBatch(trigger === 'nightly' ? 'auto' : 'manual');
      errorThemeBatchJob = {
        ...errorThemeBatchJob,
        status: 'completed',
        completedAt: nowISO(),
        result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      try {
        recordFailedErrorThemeBatch({
          periodStart,
          periodEnd,
          modelName: mode === 'rules' ? 'local-review-topic-v1' : selectedModelName,
          note: mode === 'rules'
            ? `${trigger} rule batch failed; error=${errorMessage}`
            : `${trigger} embedding failed; no rule fallback was written; profile=${selectedProfile}; error=${errorMessage}`,
        });
      } catch (recordError) {
        console.error('[error-themes] failed to persist failed batch:', recordError);
      }
      errorThemeBatchJob = {
        ...errorThemeBatchJob,
        status: 'failed',
        completedAt: nowISO(),
        error: errorMessage,
      };
    }
  }, 50).unref();
  return { started: true, job: currentErrorThemeJobSnapshot() };
}

function nextChinaThreeAMDelay() {
  const now = new Date();
  const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const targetChina = new Date(Date.UTC(
    chinaNow.getUTCFullYear(),
    chinaNow.getUTCMonth(),
    chinaNow.getUTCDate(),
    3,
    0,
    0,
    0,
  ));
  if (chinaNow >= targetChina) targetChina.setUTCDate(targetChina.getUTCDate() + 1);
  const targetUtcMs = targetChina.getTime() - 8 * 60 * 60 * 1000;
  nextNightlyErrorThemeAt = new Date(targetUtcMs).toISOString();
  return Math.max(60 * 1000, targetUtcMs - now.getTime());
}

function scheduleNightlyErrorThemeBatch() {
  const delay = nextChinaThreeAMDelay();
  setTimeout(() => {
    startErrorThemeBatchJob({ periodStart: '1900-01-01', periodEnd: todayISO(), mode: 'rules', trigger: 'nightly' });
    scheduleNightlyErrorThemeBatch();
  }, delay).unref();
}

function defaultDailyBriefSettings() {
  return {
    enabled: true,
    generateTime: '07:00',
    cityName: '北京',
    latitude: 39.9042,
    longitude: 116.4074,
    newsTopicsText: '考研\n人工智能\n半导体\n宏观经济',
    marketSymbolsText: '上证指数|000001.SS\n深证成指|399001.SZ\n创业板指|399006.SZ\n纳斯达克|^IXIC\n标普500|^GSPC\nBTC|BTC-USD',
    email: {
      enabled: false,
      host: '',
      port: 465,
      secureMode: 'ssl',
      username: '',
      password: '',
      from: '',
      to: '',
      subjectPrefix: 'Exam Planner 今日简报',
    },
  };
}

function normalizeDailyBriefSettings(input = {}, previous = null) {
  const defaults = defaultDailyBriefSettings();
  const previousEmail = previous?.email || {};
  const emailInput = input.email || {};
  const requestedPassword = typeof emailInput.password === 'string' ? emailInput.password : '';
  const preservedPassword = requestedPassword.trim() ? requestedPassword : previousEmail.password || '';
  const secureMode = ['ssl', 'starttls', 'none'].includes(emailInput.secureMode) ? emailInput.secureMode : defaults.email.secureMode;
  return {
    enabled: input.enabled !== false,
    generateTime: /^\d{2}:\d{2}$/.test(input.generateTime || '') ? input.generateTime : defaults.generateTime,
    cityName: String(input.cityName || defaults.cityName).trim() || defaults.cityName,
    latitude: Number.isFinite(Number(input.latitude)) ? Number(input.latitude) : defaults.latitude,
    longitude: Number.isFinite(Number(input.longitude)) ? Number(input.longitude) : defaults.longitude,
    newsTopicsText: String(input.newsTopicsText ?? defaults.newsTopicsText),
    marketSymbolsText: String(input.marketSymbolsText ?? defaults.marketSymbolsText),
    email: {
      enabled: Boolean(emailInput.enabled),
      host: String(emailInput.host || previousEmail.host || '').trim(),
      port: Math.max(1, Math.min(65535, Number(emailInput.port || previousEmail.port || defaults.email.port))),
      secureMode,
      username: String(emailInput.username || previousEmail.username || '').trim(),
      password: preservedPassword,
      from: String(emailInput.from || previousEmail.from || '').trim(),
      to: String(emailInput.to || previousEmail.to || '').trim(),
      subjectPrefix: String(emailInput.subjectPrefix || previousEmail.subjectPrefix || defaults.email.subjectPrefix).trim() || defaults.email.subjectPrefix,
    },
  };
}

function publicDailyBriefSettings(settings) {
  return {
    ...settings,
    email: {
      ...settings.email,
      password: '',
      hasPassword: Boolean(settings.email.password),
    },
    nextDailyBriefAt,
  };
}

function getDailyBriefSettings({ includeSecret = false } = {}) {
  let parsed = {};
  try {
    const raw = sqliteScalar(`SELECT value FROM app_metadata WHERE key = ${sqlString(dailyBriefSettingsKey)} LIMIT 1;`);
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  const settings = normalizeDailyBriefSettings(parsed);
  return includeSecret ? settings : publicDailyBriefSettings(settings);
}

function saveDailyBriefSettings(input = {}) {
  const previous = getDailyBriefSettings({ includeSecret: true });
  const settings = normalizeDailyBriefSettings(input, previous);
  runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES (${sqlString(dailyBriefSettingsKey)}, ${sqlString(JSON.stringify(settings))}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  scheduleDailyBrief();
  return publicDailyBriefSettings(settings);
}

function splitLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseMarketSymbols(value) {
  return splitLines(value).map((line) => {
    const [name, symbol] = line.includes('|') ? line.split('|').map((item) => item.trim()) : [line.trim(), line.trim()];
    return { name: name || symbol, symbol: symbol || name };
  }).filter((item) => item.symbol);
}

async function fetchJsonWithTimeout(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'exam-planner-brief/1.0' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function fetchJsonWithCurl(url, timeoutSeconds = 9) {
  const result = spawnSync('curl', ['-fsSL', '--max-time', String(timeoutSeconds), url], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `curl exited ${result.status}`);
  return JSON.parse(result.stdout);
}

async function fetchTextWithTimeout(url, timeoutMs = 9000, headers = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'exam-planner-brief/1.0', ...headers },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

function weatherCodeText(code) {
  const labels = {
    0: '晴',
    1: '基本晴朗',
    2: '局部多云',
    3: '多云',
    45: '雾',
    48: '雾凇',
    51: '小毛毛雨',
    53: '毛毛雨',
    55: '较强毛毛雨',
    61: '小雨',
    63: '中雨',
    65: '大雨',
    71: '小雪',
    73: '中雪',
    75: '大雪',
    80: '阵雨',
    81: '较强阵雨',
    82: '强阵雨',
    95: '雷暴',
  };
  return labels[Number(code)] || '天气数据已获取';
}

async function getBriefWeather(settings) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(settings.latitude)}&longitude=${encodeURIComponent(settings.longitude)}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FShanghai&forecast_days=1`;
  try {
    const data = await fetchJsonWithTimeout(url);
    const current = data.current || {};
    const daily = data.daily || {};
    return {
      ok: true,
      cityName: settings.cityName,
      temperature: Number(current.temperature_2m ?? 0),
      humidity: Number(current.relative_humidity_2m ?? 0),
      windSpeed: Number(current.wind_speed_10m ?? 0),
      precipitation: Number(current.precipitation ?? 0),
      weatherCode: Number(current.weather_code ?? 0),
      condition: weatherCodeText(current.weather_code),
      maxTemperature: Number(daily.temperature_2m_max?.[0] ?? current.temperature_2m ?? 0),
      minTemperature: Number(daily.temperature_2m_min?.[0] ?? current.temperature_2m ?? 0),
      precipitationProbability: Number(daily.precipitation_probability_max?.[0] ?? 0),
    };
  } catch (error) {
    return { ok: false, cityName: settings.cityName, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getBriefMarket(symbolItem) {
  const fromCrypto = await getCryptoMarket(symbolItem);
  if (fromCrypto) return fromCrypto;
  const fromWscn = await getWscnMarket(symbolItem);
  if (fromWscn) return fromWscn;
  const fromTradingView = await getTradingViewMarket(symbolItem);
  if (fromTradingView) return fromTradingView;
  const fromEastMoney = await getEastMoneyMarket(symbolItem);
  if (fromEastMoney) return fromEastMoney;
  const fromSina = await getSinaMarket(symbolItem);
  if (fromSina) return fromSina;
  const fromStooq = await getStooqMarket(symbolItem);
  if (fromStooq) return fromStooq;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbolItem.symbol)}?range=5d&interval=1d`;
  try {
    const data = await fetchJsonWithTimeout(url);
    const result = data.chart?.result?.[0];
    if (!result) throw new Error('empty market response');
    const meta = result.meta || {};
    const closes = (result.indicators?.quote?.[0]?.close || []).filter((value) => typeof value === 'number');
    const current = Number(meta.regularMarketPrice ?? closes.at(-1) ?? 0);
    const previous = Number(meta.chartPreviousClose ?? closes.at(-2) ?? current);
    const change = Number((current - previous).toFixed(2));
    const changePercent = previous ? Number(((change / previous) * 100).toFixed(2)) : 0;
    return {
      ok: true,
      name: symbolItem.name,
      symbol: symbolItem.symbol,
      price: current,
      change,
      changePercent,
      currency: meta.currency || '',
    };
  } catch (error) {
    return {
      ok: false,
      name: symbolItem.name,
      symbol: symbolItem.symbol,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const cryptoIdMap = {
  BTC: 'bitcoin',
  BITCOIN: 'bitcoin',
  ETH: 'ethereum',
  ETHER: 'ethereum',
  BNB: 'binancecoin',
  SOL: 'solana',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  TON: 'the-open-network',
  LINK: 'chainlink',
  DOT: 'polkadot',
  TRX: 'tron',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
};

function cryptoSymbolKey(symbol) {
  const value = String(symbol || '').toUpperCase().trim();
  return value
    .replace(/[-_/]?(USD|USDT|USDC|CNY|CNH)$/i, '')
    .replace(/[^A-Z0-9]/g, '');
}

async function getCryptoMarket(symbolItem) {
  const key = cryptoSymbolKey(symbolItem.symbol);
  const id = cryptoIdMap[key];
  if (!id) return null;
  const fromCryptoCompare = await getCryptoCompareMarket(symbolItem, key);
  if (fromCryptoCompare) return fromCryptoCompare;
  try {
    const data = await fetchJsonWithTimeout(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true`, 9000);
    const quote = data[id] || {};
    const price = Number(quote.usd || 0);
    const changePercent = Number(quote.usd_24h_change || 0);
    if (!Number.isFinite(price) || !price) throw new Error('empty coingecko response');
    return {
      ok: true,
      name: symbolItem.name || key,
      symbol: symbolItem.symbol,
      price: Number(price.toFixed(price >= 100 ? 2 : 4)),
      change: null,
      changePercent: Number(changePercent.toFixed(2)),
      currency: 'USD',
    };
  } catch {
    return null;
  }
}

async function getCryptoCompareMarket(symbolItem, key) {
  try {
    const data = await fetchJsonWithTimeout(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${encodeURIComponent(key)}&tsyms=USD`, 9000);
    const quote = data.RAW?.[key]?.USD;
    if (!quote) throw new Error('empty cryptocompare response');
    const price = Number(quote.PRICE || 0);
    const changePercent = Number(quote.CHANGEPCT24HOUR ?? quote.CHANGEPCTDAY ?? 0);
    const change = Number(quote.CHANGE24HOUR ?? quote.CHANGEDAY ?? 0);
    if (!Number.isFinite(price) || !price) throw new Error('empty cryptocompare price');
    return {
      ok: true,
      name: symbolItem.name || key,
      symbol: symbolItem.symbol,
      price: Number(price.toFixed(price >= 100 ? 2 : 4)),
      change: Number(change.toFixed(price >= 100 ? 2 : 4)),
      changePercent: Number(changePercent.toFixed(2)),
      currency: 'USD',
    };
  } catch {
    try {
      const data = fetchJsonWithCurl(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${encodeURIComponent(key)}&tsyms=USD`, 9);
      const quote = data.RAW?.[key]?.USD;
      const price = Number(quote?.PRICE || 0);
      if (!Number.isFinite(price) || !price) return null;
      const changePercent = Number(quote.CHANGEPCT24HOUR ?? quote.CHANGEPCTDAY ?? 0);
      const change = Number(quote.CHANGE24HOUR ?? quote.CHANGEDAY ?? 0);
      return {
        ok: true,
        name: symbolItem.name || key,
        symbol: symbolItem.symbol,
        price: Number(price.toFixed(price >= 100 ? 2 : 4)),
        change: Number(change.toFixed(price >= 100 ? 2 : 4)),
        changePercent: Number(changePercent.toFixed(2)),
        currency: 'USD',
      };
    } catch {
      return null;
    }
  }
}

async function getWscnMarket(symbolItem) {
  const value = String(symbolItem.symbol || '').toUpperCase();
  if (!/^\d{6}\.(SS|SH|SZ)$/.test(value)) return null;
  try {
    const normalized = value.replace(/\.SH$/, '.SS');
    const url = `https://api-ddc-wscn.awtmt.com/market/real?fields=prod_name,last_px,px_change,px_change_rate&prod_code=${encodeURIComponent(normalized)}`;
    const data = await fetchJsonWithTimeout(url, 9000);
    const item = data.data?.snapshot?.[normalized];
    if (!Array.isArray(item)) throw new Error('empty wscn market response');
    const current = Number(item[1] || 0);
    const change = Number(item[2] || 0);
    const changePercent = Number(item[3] || 0);
    if (!Number.isFinite(current) || !current) throw new Error('empty wscn market price');
    return {
      ok: true,
      name: symbolItem.name || item[0] || symbolItem.symbol,
      symbol: symbolItem.symbol,
      price: Number(current.toFixed(2)),
      change: Number(change.toFixed(2)),
      changePercent: Number(changePercent.toFixed(2)),
      currency: 'CNY',
    };
  } catch {
    return null;
  }
}

function tradingViewTicker(symbol) {
  const value = String(symbol || '').toUpperCase().trim();
  const map = {
    '^VN30': 'HOSE:VN30',
    VN30: 'HOSE:VN30',
    'VN30.VN': 'HOSE:VN30',
    '^VNI': 'HOSE:VNINDEX',
    VNINDEX: 'HOSE:VNINDEX',
  };
  if (map[value]) return map[value];
  if (/^[A-Z]+:[A-Z0-9._-]+$/.test(value)) return value;
  return '';
}

async function getTradingViewMarket(symbolItem) {
  const ticker = tradingViewTicker(symbolItem.symbol);
  if (!ticker) return null;
  try {
    const response = await fetch('https://scanner.tradingview.com/vietnam/scan', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'exam-planner-brief/1.0',
      },
      body: JSON.stringify({
        symbols: { tickers: [ticker], query: { types: [] } },
        columns: ['name', 'close', 'change', 'change_abs'],
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const row = data.data?.[0]?.d;
    if (!Array.isArray(row)) throw new Error('empty tradingview response');
    const price = Number(row[1] || 0);
    const changePercent = Number(row[2] || 0);
    const change = Number(row[3] || 0);
    if (!Number.isFinite(price) || !price) throw new Error('empty tradingview price');
    return {
      ok: true,
      name: symbolItem.name || row[0] || symbolItem.symbol,
      symbol: symbolItem.symbol,
      price: Number(price.toFixed(2)),
      change: Number(change.toFixed(2)),
      changePercent: Number(changePercent.toFixed(2)),
      currency: 'VND',
    };
  } catch {
    return null;
  }
}

function eastMoneySecId(symbol) {
  const value = String(symbol || '').toUpperCase();
  if (/^\d{6}\.(SS|SH)$/.test(value)) return `1.${value.slice(0, 6)}`;
  if (/^\d{6}\.SZ$/.test(value)) return `0.${value.slice(0, 6)}`;
  return '';
}

async function getEastMoneyMarket(symbolItem) {
  const secId = eastMoneySecId(symbolItem.symbol);
  if (!secId) return null;
  try {
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(secId)}&fields=f43,f57,f58,f169,f170`;
    let data;
    try {
      data = await fetchJsonWithTimeout(url, 9000);
    } catch {
      data = fetchJsonWithCurl(url, 9);
    }
    const quote = data.data || {};
    const current = Number(quote.f43 || 0) / 100;
    const change = Number(quote.f169 || 0) / 100;
    const changePercent = Number(quote.f170 || 0) / 100;
    if (!Number.isFinite(current) || !current) throw new Error('empty eastmoney market response');
    return {
      ok: true,
      name: symbolItem.name || quote.f58 || symbolItem.symbol,
      symbol: symbolItem.symbol,
      price: Number(current.toFixed(2)),
      change: Number(change.toFixed(2)),
      changePercent: Number(changePercent.toFixed(2)),
      currency: 'CNY',
    };
  } catch {
    return null;
  }
}

function sinaMarketCode(symbol) {
  const value = String(symbol || '').toUpperCase();
  if (/^\d{6}\.SS$/.test(value)) return `sh${value.slice(0, 6)}`;
  if (/^\d{6}\.SZ$/.test(value)) return `sz${value.slice(0, 6)}`;
  return '';
}

async function getSinaMarket(symbolItem) {
  const code = sinaMarketCode(symbolItem.symbol);
  if (!code) return null;
  try {
    const text = await fetchTextWithTimeout(`https://hq.sinajs.cn/list=${code}`, 9000, { referer: 'https://finance.sina.com.cn' });
    const match = text.match(/="([^"]*)"/);
    const fields = match?.[1]?.split(',') || [];
    const previous = Number(fields[2] || 0);
    const current = Number(fields[3] || 0);
    if (!Number.isFinite(current) || !current) throw new Error('empty sina market response');
    const change = Number((current - previous).toFixed(2));
    const changePercent = previous ? Number(((change / previous) * 100).toFixed(2)) : 0;
    return {
      ok: true,
      name: ['^VN30', 'VN30', 'VN30.VN'].includes(String(symbolItem.symbol || '').toUpperCase().trim())
        ? `${symbolItem.name} (VNM ETF proxy)`
        : symbolItem.name,
      symbol: symbolItem.symbol,
      price: Number(current.toFixed(2)),
      change,
      changePercent,
      currency: 'CNY',
    };
  } catch {
    return null;
  }
}

function stooqMarketSymbol(symbol) {
  const map = {
    '^GSPC': '^spx',
    '^IXIC': '^ndq',
    '^DJI': '^dji',
    '^N225': '^nkx',
    '^NIKKEI': '^nkx',
    '^HSI': '^hsi',
    '^VN30': 'vnm.us',
    VN30: 'vnm.us',
    'VN30.VN': 'vnm.us',
    'BTC-USD': 'btcusd',
    BTC: 'btcusd',
    ETH: 'ethusd',
    'ETH-USD': 'ethusd',
  };
  const value = String(symbol || '').toUpperCase().trim();
  if (map[value]) return map[value];
  if (/^[A-Z]{1,5}$/.test(value)) return `${value.toLowerCase()}.us`;
  if (/^[A-Z]{1,5}\.US$/.test(value)) return value.toLowerCase();
  if (/^\d{4,5}\.HK$/.test(value)) return value.toLowerCase();
  return '';
}

async function getStooqMarket(symbolItem) {
  const symbol = stooqMarketSymbol(symbolItem.symbol);
  if (!symbol) return null;
  try {
    const text = await fetchTextWithTimeout(`https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`, 9000);
    const lines = text.trim().split(/\r?\n/);
    const fields = lines[1]?.split(',') || [];
    const open = Number(fields[3] || 0);
    const current = Number(fields[6] || 0);
    if (!Number.isFinite(current) || !current) throw new Error('empty stooq market response');
    const change = Number((current - open).toFixed(2));
    const changePercent = open ? Number(((change / open) * 100).toFixed(2)) : 0;
    return {
      ok: true,
      name: ['^VN30', 'VN30', 'VN30.VN'].includes(String(symbolItem.symbol || '').toUpperCase().trim())
        ? `${symbolItem.name} (VNM ETF proxy)`
        : symbolItem.name,
      symbol: symbolItem.symbol,
      price: Number(current.toFixed(2)),
      change,
      changePercent,
      currency: symbol === 'vnm.us' || symbolItem.symbol === 'BTC-USD' ? 'USD' : '',
    };
  } catch {
    return null;
  }
}

async function getBriefNews(topic) {
  const query = encodeURIComponent(`${topic} sourceCountry:CH OR sourceCountry:US`);
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=ArtList&maxrecords=5&format=json&sort=HybridRel&timespan=24h`;
  try {
    const data = await fetchJsonWithTimeout(url);
    const articles = Array.isArray(data.articles) ? data.articles : [];
    return {
      topic,
      ok: true,
      articles: articles.slice(0, 5).map((article) => ({
        title: article.title || '未命名新闻',
        url: article.url || '',
        source: article.domain || article.sourceCountry || '',
        seenAt: article.seendate || '',
      })),
    };
  } catch (error) {
    return { topic, ok: false, articles: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function gdeltTopicQuery(topic) {
  const text = String(topic || '').trim();
  if (!text) return '';
  return /[\s:]/.test(text) ? `"${text.replace(/"/g, '')}"` : text;
}

function normalizeNewsArticle(article) {
  return {
    title: article.title || '未命名新闻',
    url: article.url || '',
    source: article.domain || article.sourceCountry || '',
    seenAt: article.seendate || '',
  };
}

function articleMatchesTopic(article, topic) {
  const haystack = `${article.title || ''} ${article.url || ''} ${article.domain || ''}`.toLowerCase();
  return haystack.includes(String(topic || '').trim().toLowerCase());
}

async function getBriefNewsBatch(topics) {
  const normalizedTopics = topics.map((topic) => String(topic || '').trim()).filter(Boolean);
  if (!normalizedTopics.length) return [];
  const cooldownUntil = sqliteScalar(`SELECT value FROM app_metadata WHERE key = ${sqlString(dailyBriefNewsCooldownKey)} LIMIT 1;`);
  if (cooldownUntil && new Date(cooldownUntil).getTime() > Date.now()) {
    return normalizedTopics.map((topic) => ({ topic, ok: false, articles: [], error: `news source cooling down until ${cooldownUntil}` }));
  }
  const queryText = `(${normalizedTopics.map(gdeltTopicQuery).filter(Boolean).join(' OR ')})`;
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(queryText)}&mode=ArtList&maxrecords=50&format=json&sort=HybridRel&timespan=24h`;
  try {
    const data = await fetchJsonWithTimeout(url, 12000);
    const rawArticles = Array.isArray(data.articles) ? data.articles : [];
    runSqlite(`DELETE FROM app_metadata WHERE key = ${sqlString(dailyBriefNewsCooldownKey)};`);
    const usedUrls = new Set();
    return normalizedTopics.map((topic) => {
      let matches = rawArticles.filter((article) => articleMatchesTopic(article, topic));
      if (!matches.length) {
        matches = rawArticles.filter((article) => !usedUrls.has(article.url)).slice(0, 3);
      }
      const articles = [];
      for (const article of matches) {
        if (!article.url || usedUrls.has(article.url)) continue;
        usedUrls.add(article.url);
        articles.push(normalizeNewsArticle(article));
        if (articles.length >= 5) break;
      }
      return { topic, ok: true, articles };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('429')) {
      const cooldown = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES (${sqlString(dailyBriefNewsCooldownKey)}, ${sqlString(cooldown)}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
    }
    return normalizedTopics.map((topic) => ({ topic, ok: false, articles: [], error: message }));
  }
}

function getDailyBriefLearningSummary(date) {
  const yesterday = addDaysISO(date, -1);
  const activeGoal = sqliteJson(`SELECT name, deadline FROM goals WHERE is_active = 1 ORDER BY id LIMIT 1;`)[0] || null;
  const yesterdayReview = sqliteJson(`SELECT date, summary, wins, problems, tomorrow_plan AS tomorrowPlan, score
FROM daily_reviews WHERE date = ${sqlString(yesterday)} LIMIT 1;`).map(normalizeReview)[0] || null;
  const todayTasks = sqliteJson(`SELECT id, title, due_date AS dueDate, urgency, is_completed AS isCompleted
FROM short_term_tasks
WHERE due_date <= ${sqlString(date)} AND is_completed = 0
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date, id
LIMIT 8;`).map((task) => ({ ...task, isCompleted: Boolean(task.isCompleted) }));
  const latestExam = sqliteJson(`SELECT date, subject_name_snapshot AS subjectName, score, full_score AS fullScore, paper_name AS paperName
FROM mock_exam_records ORDER BY date DESC, id DESC LIMIT 1;`)[0] || null;
  const yesterdayMinutes = Number(sqliteScalar(`SELECT COALESCE(total_minutes, 0) FROM study_daily_summaries WHERE date = ${sqlString(yesterday)};`) || 0);
  const last7Minutes = Number(sqliteScalar(`SELECT COALESCE(SUM(total_minutes), 0) FROM study_daily_summaries WHERE date BETWEEN ${sqlString(addDaysISO(date, -6))} AND ${sqlString(date)};`) || 0);
  return {
    activeGoal: activeGoal ? {
      name: activeGoal.name,
      deadline: activeGoal.deadline,
      daysLeft: Math.max(0, Math.ceil((parseDateString(activeGoal.deadline).getTime() - parseDateString(date).getTime()) / (24 * 60 * 60 * 1000))),
    } : null,
    yesterday,
    yesterdayMinutes,
    last7Minutes,
    yesterdayReview,
    todayTasks,
    latestExam,
    topErrorThemes: getErrorThemePeriodSummary(addDaysISO(date, -6), date, 5),
  };
}

function dailyBriefTitle(date) {
  return `${date} 晨间简报`;
}

function dailyBriefRowToObject(row) {
  if (!row) return null;
  let payload = {};
  try {
    payload = row.payloadJson ? JSON.parse(row.payloadJson) : {};
  } catch {
    payload = {};
  }
  return {
    id: Number(row.id),
    date: row.date,
    title: row.title,
    status: row.status,
    emailedAt: row.emailedAt || null,
    emailError: row.emailError || '',
    generatedAt: row.generatedAt,
    updatedAt: row.updatedAt,
    payload,
  };
}

function getDailyBriefByDate(date = todayISO()) {
  const row = sqliteJson(`SELECT id, date, title, payload_json AS payloadJson, status, emailed_at AS emailedAt,
email_error AS emailError, generated_at AS generatedAt, updated_at AS updatedAt
FROM daily_briefs WHERE date = ${sqlString(date)} LIMIT 1;`)[0];
  return dailyBriefRowToObject(row);
}

function getLatestDailyBriefSummary() {
  const row = sqliteJson(`SELECT id, date, title, payload_json AS payloadJson, status, emailed_at AS emailedAt,
email_error AS emailError, generated_at AS generatedAt, updated_at AS updatedAt
FROM daily_briefs ORDER BY date DESC, id DESC LIMIT 1;`)[0];
  return dailyBriefRowToObject(row);
}

function listDailyBriefs(limit = 30) {
  return sqliteJson(`SELECT id, date, title, payload_json AS payloadJson, status, emailed_at AS emailedAt,
email_error AS emailError, generated_at AS generatedAt, updated_at AS updatedAt
FROM daily_briefs ORDER BY date DESC, id DESC LIMIT ${Math.max(1, Math.min(100, Number(limit) || 30))};`).map(dailyBriefRowToObject);
}

async function generateDailyBrief({ date = todayISO(), trigger = 'manual', sendEmail = false } = {}) {
  const settings = getDailyBriefSettings({ includeSecret: true });
  const generatedAt = nowISO();
  const topics = splitLines(settings.newsTopicsText).slice(0, 8);
  const marketSymbols = parseMarketSymbols(settings.marketSymbolsText).slice(0, 12);
  const [weather, markets, newsResult] = await Promise.all([
    getBriefWeather(settings),
    Promise.all(marketSymbols.map(getBriefMarket)),
    getBriefNewsBatch(topics),
  ]);
  let news = newsResult;
  if (news.every((topic) => !topic.ok || !topic.articles?.length)) {
    const previous = getLatestDailyBriefSummary();
    const previousNews = previous?.payload?.news;
    if (Array.isArray(previousNews) && previousNews.some((topic) => topic.articles?.length)) {
      news = topics.map((topic) => {
        const matched = previousNews.find((item) => item.topic === topic);
        return matched?.articles?.length ? { ...matched, reusedFromPrevious: true } : newsResult.find((item) => item.topic === topic) || { topic, ok: false, articles: [], error: 'news source unavailable' };
      });
    }
  }
  const payload = {
    date,
    title: dailyBriefTitle(date),
    generatedAt,
    trigger,
    weather,
    markets,
    news,
    learning: getDailyBriefLearningSummary(date),
  };

  let emailedAt = null;
  let emailError = '';
  if (sendEmail || (trigger === 'auto' && settings.email.enabled)) {
    if (!settings.email.enabled) {
      emailError = '邮件推送未启用';
    } else {
      try {
        await sendDailyBriefEmail(payload, settings.email);
        emailedAt = nowISO();
      } catch (error) {
        emailError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  runSqlite(`INSERT INTO daily_briefs (date, title, payload_json, status, emailed_at, email_error, generated_at, updated_at)
VALUES (${sqlString(date)}, ${sqlString(payload.title)}, ${sqlString(JSON.stringify(payload))}, 'completed', ${sqlValue(emailedAt)}, ${sqlString(emailError)}, ${sqlString(generatedAt)}, ${sqlString(nowISO())})
ON CONFLICT(date) DO UPDATE SET
  title = excluded.title,
  payload_json = excluded.payload_json,
  status = excluded.status,
  emailed_at = COALESCE(excluded.emailed_at, daily_briefs.emailed_at),
  email_error = excluded.email_error,
  generated_at = excluded.generated_at,
  updated_at = excluded.updated_at;`);
  tableChanged();
  return getDailyBriefByDate(date);
}

function nextChinaWallClockDelay(timeText = '07:00') {
  const [hourRaw, minuteRaw] = String(timeText).split(':').map(Number);
  const hour = Math.max(0, Math.min(23, Number.isFinite(hourRaw) ? hourRaw : 7));
  const minute = Math.max(0, Math.min(59, Number.isFinite(minuteRaw) ? minuteRaw : 0));
  const now = new Date();
  const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const targetChina = new Date(Date.UTC(
    chinaNow.getUTCFullYear(),
    chinaNow.getUTCMonth(),
    chinaNow.getUTCDate(),
    hour,
    minute,
    0,
    0,
  ));
  if (chinaNow >= targetChina) targetChina.setUTCDate(targetChina.getUTCDate() + 1);
  const targetUtcMs = targetChina.getTime() - 8 * 60 * 60 * 1000;
  nextDailyBriefAt = new Date(targetUtcMs).toISOString();
  return Math.max(60 * 1000, targetUtcMs - now.getTime());
}

function scheduleDailyBrief() {
  const settings = getDailyBriefSettings({ includeSecret: true });
  if (dailyBriefTimer) clearTimeout(dailyBriefTimer);
  const delay = nextChinaWallClockDelay(settings.generateTime);
  dailyBriefTimer = setTimeout(async () => {
    try {
      if (getDailyBriefSettings({ includeSecret: true }).enabled) {
        await generateDailyBrief({ date: todayISO(), trigger: 'auto', sendEmail: true });
      }
    } catch (error) {
      console.error('[daily-brief] automatic brief failed:', error);
    } finally {
      scheduleDailyBrief();
    }
  }, delay);
  dailyBriefTimer.unref?.();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function encodeMailHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value), 'utf8').toString('base64')}?=`;
}

function dailyBriefHtml(payload) {
  const weather = payload.weather || {};
  const markets = payload.markets || [];
  const news = payload.news || [];
  const learning = payload.learning || {};
  const taskItems = (learning.todayTasks || []).map((task) => `<li>${escapeHtml(task.title)} <span style="color:#64748b">(${escapeHtml(task.urgency)} / ${escapeHtml(task.dueDate)})</span></li>`).join('');
  const marketRows = markets.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.symbol)}</td><td>${item.ok ? escapeHtml(item.price) : '失败'}</td><td style="color:${Number(item.changePercent || 0) >= 0 ? '#16a34a' : '#dc2626'}">${item.ok ? `${escapeHtml(item.changePercent)}%` : escapeHtml(item.error || '')}</td></tr>`).join('');
  const newsBlocks = news.map((topic) => `<h3>${escapeHtml(topic.topic)}</h3><ul>${(topic.articles || []).map((article) => `<li><a href="${escapeHtml(article.url)}">${escapeHtml(article.title)}</a> <span style="color:#64748b">${escapeHtml(article.source)}</span></li>`).join('') || '<li>暂无结果</li>'}</ul>`).join('');
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;line-height:1.6">
  <h1>${escapeHtml(payload.title)}</h1>
  <p style="color:#64748b">生成时间：${escapeHtml(new Date(payload.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))}</p>
  <h2>天气</h2>
  <p>${escapeHtml(weather.cityName || '')}：${weather.ok ? `${escapeHtml(weather.condition)}，${escapeHtml(weather.temperature)}℃，${escapeHtml(weather.minTemperature)}-${escapeHtml(weather.maxTemperature)}℃，降水概率 ${escapeHtml(weather.precipitationProbability)}%` : `获取失败：${escapeHtml(weather.error || '')}`}</p>
  <h2>学习提醒</h2>
  <p>昨日学习：${Math.round(Number(learning.yesterdayMinutes || 0) / 60 * 10) / 10} 小时；近 7 天累计：${Math.round(Number(learning.last7Minutes || 0) / 60 * 10) / 10} 小时。</p>
  ${learning.yesterdayReview ? `<p><strong>昨日问题：</strong>${escapeHtml(learning.yesterdayReview.problems || '未填写')}</p>` : '<p>昨日尚未填写复盘。</p>'}
  ${taskItems ? `<p><strong>今日待推进：</strong></p><ul>${taskItems}</ul>` : '<p>今日暂无到期短期目标。</p>'}
  <h2>指数与资产</h2>
  <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;border-color:#e2e8f0"><thead><tr><th>名称</th><th>代码</th><th>最新</th><th>涨跌</th></tr></thead><tbody>${marketRows || '<tr><td colspan="4">暂无配置</td></tr>'}</tbody></table>
  <h2>关注话题</h2>
  ${newsBlocks || '<p>暂无关注话题。</p>'}
</body></html>`;
}

function smtpReadResponse(socket, state) {
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      state.buffer += chunk.toString('utf8');
      const lines = state.buffer.split(/\r?\n/);
      const lastComplete = state.buffer.endsWith('\n') ? lines : lines.slice(0, -1);
      const doneLine = lastComplete.find((line) => /^\d{3} /.test(line));
      if (!doneLine) return;
      socket.off('data', onData);
      socket.off('error', onError);
      state.buffer = '';
      const code = Number(doneLine.slice(0, 3));
      if (code >= 400) reject(new Error(`SMTP ${doneLine}`));
      else resolve({ code, text: lastComplete.join('\n') });
    };
    const onError = (error) => {
      socket.off('data', onData);
      reject(error);
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

async function smtpSendLine(socket, state, line) {
  socket.write(`${line}\r\n`);
  return smtpReadResponse(socket, state);
}

async function sendDailyBriefEmail(payload, emailSettings) {
  const recipients = String(emailSettings.to || '').split(/[;,]/).map((item) => item.trim()).filter(Boolean);
  if (!emailSettings.host || !emailSettings.from || !recipients.length) {
    throw new Error('SMTP host/from/to 未完整配置');
  }
  let socket = await new Promise((resolve, reject) => {
    const connector = emailSettings.secureMode === 'ssl'
      ? tlsConnect({ host: emailSettings.host, port: emailSettings.port, servername: emailSettings.host }, () => resolve(connector))
      : netConnect({ host: emailSettings.host, port: emailSettings.port }, () => resolve(connector));
    connector.setTimeout(15000, () => reject(new Error('SMTP connection timeout')));
    connector.once('error', reject);
  });
  const state = { buffer: '' };
  try {
    await smtpReadResponse(socket, state);
    await smtpSendLine(socket, state, `EHLO ${emailSettings.host}`);
    if (emailSettings.secureMode === 'starttls') {
      await smtpSendLine(socket, state, 'STARTTLS');
      socket = tlsConnect({ socket, servername: emailSettings.host });
      await new Promise((resolve, reject) => {
        socket.once('secureConnect', resolve);
        socket.once('error', reject);
      });
      state.buffer = '';
      await smtpSendLine(socket, state, `EHLO ${emailSettings.host}`);
    }
    if (emailSettings.username) {
      await smtpSendLine(socket, state, 'AUTH LOGIN');
      await smtpSendLine(socket, state, Buffer.from(emailSettings.username, 'utf8').toString('base64'));
      await smtpSendLine(socket, state, Buffer.from(emailSettings.password || '', 'utf8').toString('base64'));
    }
    await smtpSendLine(socket, state, `MAIL FROM:<${emailSettings.from}>`);
    for (const recipient of recipients) {
      await smtpSendLine(socket, state, `RCPT TO:<${recipient}>`);
    }
    await smtpSendLine(socket, state, 'DATA');
    const subject = `${emailSettings.subjectPrefix || 'Exam Planner 今日简报'} - ${payload.date}`;
    const html = dailyBriefHtml(payload);
    const message = [
      `From: ${emailSettings.from}`,
      `To: ${recipients.join(', ')}`,
      `Subject: ${encodeMailHeader(subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      html,
    ].join('\r\n').replace(/\r\n\./g, '\r\n..');
    socket.write(`${message}\r\n.\r\n`);
    await smtpReadResponse(socket, state);
    await smtpSendLine(socket, state, 'QUIT').catch(() => undefined);
  } finally {
    socket.end();
  }
}

function getErrorThemePeriodSummary(periodStart, periodEnd, limit = 6) {
  const themes = sqliteJson(`SELECT t.id, t.normalized_label AS normalizedLabel, t.label, COUNT(o.id) AS count, COUNT(DISTINCT o.date) AS days
FROM error_themes t
JOIN error_theme_occurrences o ON o.theme_id = t.id
WHERE o.date BETWEEN ${sqlString(periodStart)} AND ${sqlString(periodEnd)}
GROUP BY t.id
ORDER BY days DESC, count DESC, MAX(o.date) DESC, t.label
LIMIT ${Number(limit)};`);
  return themes.map((theme) => {
    const dates = sqliteJson(`SELECT DISTINCT date FROM error_theme_occurrences
WHERE theme_id = ${sqlValue(theme.id)} AND date BETWEEN ${sqlString(periodStart)} AND ${sqlString(periodEnd)}
ORDER BY date;`).map((item) => item.date);
    const examples = sqliteJson(`SELECT date, field, evidence AS text FROM error_theme_occurrences
WHERE theme_id = ${sqlValue(theme.id)} AND date BETWEEN ${sqlString(periodStart)} AND ${sqlString(periodEnd)}
ORDER BY date DESC, confidence DESC, id DESC
LIMIT 3;`);
    return {
      id: theme.normalizedLabel,
      label: theme.label,
      count: Number(theme.days || 0),
      dates,
      keywords: reviewProblemThemes.find((item) => item.id === theme.normalizedLabel)?.keywords || [],
      examples,
    };
  });
}

function getErrorThemeAnalysis(periodStart = '1900-01-01', periodEnd = todayISO()) {
  ensureSqliteStore();
  const from = periodStart || '1900-01-01';
  const to = periodEnd || todayISO();
  const latestBatch = sqliteJson(`SELECT id, source, model_name AS modelName, period_start AS periodStart, period_end AS periodEnd,
review_count AS reviewCount, occurrence_count AS occurrenceCount, theme_count AS themeCount, status, created_at AS createdAt, completed_at AS completedAt, note
FROM error_theme_batches
ORDER BY created_at DESC, id DESC
LIMIT 1;`)[0] || null;
  const themes = sqliteJson(`SELECT t.id, t.normalized_label AS normalizedLabel, t.label,
COUNT(o.id) AS occurrenceCount,
COUNT(DISTINCT o.date) AS reviewDayCount,
ROUND(AVG(o.confidence), 2) AS averageConfidence,
MIN(o.date) AS firstSeenAt,
MAX(o.date) AS lastSeenAt
FROM error_themes t
JOIN error_theme_occurrences o ON o.theme_id = t.id
WHERE o.date BETWEEN ${sqlString(from)} AND ${sqlString(to)}
GROUP BY t.id
ORDER BY reviewDayCount DESC, occurrenceCount DESC, lastSeenAt DESC, t.label
LIMIT 12;`);
  const enrichedThemes = themes.map((theme) => ({
    id: Number(theme.id),
    normalizedLabel: theme.normalizedLabel,
    label: theme.label,
    occurrenceCount: Number(theme.occurrenceCount || 0),
    reviewDayCount: Number(theme.reviewDayCount || 0),
    averageConfidence: Number(theme.averageConfidence || 0),
    firstSeenAt: theme.firstSeenAt,
    lastSeenAt: theme.lastSeenAt,
    examples: sqliteJson(`SELECT id AS occurrenceId, date, field, evidence, confidence, source FROM error_theme_occurrences
WHERE theme_id = ${sqlValue(theme.id)} AND date BETWEEN ${sqlString(from)} AND ${sqlString(to)}
ORDER BY date DESC, confidence DESC, id DESC
LIMIT 3;`),
  }));
  const timeline = sqliteJson(`SELECT date, COUNT(*) AS count
FROM error_theme_occurrences
WHERE date BETWEEN ${sqlString(from)} AND ${sqlString(to)}
GROUP BY date
ORDER BY date;`).map((item) => ({ date: item.date, count: Number(item.count || 0) }));
  const totals = sqliteJson(`SELECT COUNT(*) AS occurrenceCount, COUNT(DISTINCT theme_id) AS themeCount, COUNT(DISTINCT date) AS reviewDayCount
FROM error_theme_occurrences
WHERE date BETWEEN ${sqlString(from)} AND ${sqlString(to)};`)[0] || { occurrenceCount: 0, themeCount: 0, reviewDayCount: 0 };
  return {
    periodStart: from,
    periodEnd: to,
    latestBatch,
    summary: {
      occurrenceCount: Number(totals.occurrenceCount || 0),
      themeCount: Number(totals.themeCount || 0),
      reviewDayCount: Number(totals.reviewDayCount || 0),
      topTheme: enrichedThemes[0] || null,
    },
    themes: enrichedThemes,
    timeline,
  };
}

function getErrorThemeDetail(themeId, periodStart = '1900-01-01', periodEnd = todayISO()) {
  ensureSqliteStore();
  const id = Number(themeId || 0);
  const from = periodStart || '1900-01-01';
  const to = periodEnd || todayISO();
  const theme = sqliteJson(`SELECT id, normalized_label AS normalizedLabel, label, occurrence_count AS occurrenceCount,
review_day_count AS reviewDayCount, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
FROM error_themes
WHERE id = ${sqlValue(id)}
LIMIT 1;`)[0] || null;
  if (!theme) return null;
  const occurrences = sqliteJson(`SELECT o.id AS occurrenceId, o.date, o.field, o.evidence, o.confidence, o.source, o.review_id AS reviewId,
r.summary, r.wins, r.problems, r.tomorrow_plan AS tomorrowPlan, r.score
FROM error_theme_occurrences o
LEFT JOIN daily_reviews r ON r.id = o.review_id
WHERE o.theme_id = ${sqlValue(id)} AND o.date BETWEEN ${sqlString(from)} AND ${sqlString(to)}
ORDER BY o.date DESC, o.confidence DESC, o.id DESC;`);
  const timeline = sqliteJson(`SELECT date, COUNT(*) AS count
FROM error_theme_occurrences
WHERE theme_id = ${sqlValue(id)} AND date BETWEEN ${sqlString(from)} AND ${sqlString(to)}
GROUP BY date
ORDER BY date;`).map((item) => ({ date: item.date, count: Number(item.count || 0) }));
  const byField = sqliteJson(`SELECT field, COUNT(*) AS count
FROM error_theme_occurrences
WHERE theme_id = ${sqlValue(id)} AND date BETWEEN ${sqlString(from)} AND ${sqlString(to)}
GROUP BY field
ORDER BY count DESC, field;`).map((item) => ({ field: item.field, count: Number(item.count || 0) }));
  const repeatedWeeks = sqliteJson(`SELECT strftime('%Y-W%W', date) AS week, COUNT(*) AS count, MIN(date) AS startDate, MAX(date) AS endDate
FROM error_theme_occurrences
WHERE theme_id = ${sqlValue(id)} AND date BETWEEN ${sqlString(from)} AND ${sqlString(to)}
GROUP BY week
HAVING count >= 3
ORDER BY week DESC;`).map((item) => ({ ...item, count: Number(item.count || 0) }));
  return {
    theme,
    periodStart: from,
    periodEnd: to,
    occurrences,
    timeline,
    byField,
    repeatedWeeks,
  };
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
  const themeLibraryProblems = getErrorThemePeriodSummary(periodStart, periodEnd);
  const commonProblems = themeLibraryProblems.length ? themeLibraryProblems : buildReviewProblemSummary(reviews);

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
    commonProblems,
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

function nextWeeklyBackupAt() {
  const lastWeeklyBackupAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_weekly_backup_at' LIMIT 1;");
  if (!lastWeeklyBackupAt) return nowISO();
  const next = new Date(new Date(lastWeeklyBackupAt).getTime() + 7 * 24 * 60 * 60 * 1000);
  return next.toISOString();
}

function getDiskStatus() {
  const result = spawnSync('df', ['-k', dataDir], { encoding: 'utf8', timeout: 3000 });
  if (result.status !== 0 || !result.stdout) return null;
  const lines = result.stdout.trim().split('\n');
  const row = lines[lines.length - 1]?.split(/\s+/);
  if (!row || row.length < 6) return null;
  const totalKb = Number(row[1] || 0);
  const usedKb = Number(row[2] || 0);
  const availableKb = Number(row[3] || 0);
  return {
    totalBytes: totalKb * 1024,
    usedBytes: usedKb * 1024,
    availableBytes: availableKb * 1024,
    usedPercent: row[4] || '',
    mount: row.slice(5).join(' '),
  };
}

function getRuntimeStatus() {
  const memory = process.memoryUsage();
  return {
    uptimeSeconds: Math.round(uptime()),
    processUptimeSeconds: Math.round(process.uptime()),
    cpuCount: cpus().length,
    loadAverage: loadavg(),
    memory: {
      totalBytes: totalmem(),
      freeBytes: freemem(),
      processRssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
    },
    disk: getDiskStatus(),
    nodeVersion: process.version,
  };
}

function getTaskCenterStatus() {
  ensureSqliteStore();
  const reports = listLearningReports();
  const latestWeeklyReport = reports.find((report) => report.kind === 'weekly') || null;
  const latestMonthlyReport = reports.find((report) => report.kind === 'monthly') || null;
  const latestBatch = sqliteJson(`SELECT id, source, model_name AS modelName, period_start AS periodStart, period_end AS periodEnd,
review_count AS reviewCount, occurrence_count AS occurrenceCount, theme_count AS themeCount, status, created_at AS createdAt, completed_at AS completedAt, note
FROM error_theme_batches
ORDER BY created_at DESC, id DESC
LIMIT 1;`)[0] || null;
  const corrections = sqliteJson(`SELECT COUNT(*) AS count, MAX(updated_at) AS lastUpdatedAt FROM error_theme_corrections;`)[0] || { count: 0, lastUpdatedAt: null };
  const embeddingRows = Number(sqliteScalar('SELECT COUNT(*) FROM review_sentence_embeddings;') || 0);
  const reviewRows = Number(sqliteScalar('SELECT COUNT(*) FROM daily_reviews;') || 0);
  const studyRows = Number(sqliteScalar('SELECT COUNT(*) FROM study_time_records;') || 0);
  return {
    generatedAt: nowISO(),
    backup: {
      ...getBackupStatus(),
      nextWeeklyBackupAt: nextWeeklyBackupAt(),
    },
    reports: {
      count: reports.length,
      latestWeeklyReport,
      latestMonthlyReport,
      lastReportCheckAt: sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_report_check_at' LIMIT 1;") || null,
    },
    dailyBrief: {
      latest: getLatestDailyBriefSummary(),
      nextDailyBriefAt,
      emailEnabled: Boolean(getDailyBriefSettings({ includeSecret: true }).email.enabled),
    },
    errorThemes: {
      job: currentErrorThemeJobSnapshot(),
      latestBatch,
      nextNightlyBatchAt: nextNightlyErrorThemeAt,
      correctionCount: Number(corrections.count || 0),
      lastCorrectionAt: corrections.lastUpdatedAt || null,
    },
    embedding: { ...getEmbeddingStatus(), embeddingRows },
    data: {
      reviews: reviewRows,
      studyTimeRecords: studyRows,
      revision: dataRevision,
    },
    runtime: getRuntimeStatus(),
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
  if (structuredVersion < 3) {
    createBackupFile('pre-error-themes', 'automatic backup before error theme library migration');
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('structured_schema_version', '3', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  }
  if (structuredVersion < 4) {
    createBackupFile('pre-embeddings', 'automatic backup before local embedding tables migration');
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('structured_schema_version', '4', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  }
  if (structuredVersion < 5) {
    createBackupFile('pre-error-corrections', 'automatic backup before error correction samples migration');
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('structured_schema_version', '5', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  }
  if (structuredVersion < 6) {
    createBackupFile('pre-study-summaries', 'automatic backup before materialized study summary migration');
    rebuildStudySummaries();
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('structured_schema_version', '6', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  }
  if (structuredVersion < 7) {
    createBackupFile('pre-daily-briefs', 'automatic backup before daily brief migration');
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('structured_schema_version', '7', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  }

  runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('storage_backend', 'sqlite-tables', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  sqliteReady = true;
  ensureWeeklyBackup();
  ensureDictionaryIndex();
  ensureStudySummariesReady();
  if (!Number(sqliteScalar('SELECT COUNT(*) FROM learning_reports;') || 0)) {
    ensureAutomaticReports();
  }
  if (!reportTimerStarted) {
    setInterval(() => {
      ensureWeeklyBackup();
    }, 6 * 60 * 60 * 1000).unref();
    reportTimerStarted = true;
  }
  if (!nightlyErrorThemeTimerStarted) {
    scheduleNightlyErrorThemeBatch();
    nightlyErrorThemeTimerStarted = true;
  }
  if (!dailyBriefTimerStarted) {
    scheduleDailyBrief();
    dailyBriefTimerStarted = true;
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

function rebuildStudySummaries() {
  const timestamp = nowISO();
  runSqlite(`BEGIN;
DELETE FROM study_daily_summaries;
DELETE FROM study_project_daily_summaries;
INSERT INTO study_daily_summaries (date, total_minutes, record_count, updated_at)
SELECT date, COALESCE(SUM(minutes), 0), COUNT(*), ${sqlString(timestamp)}
FROM study_time_records
GROUP BY date;
INSERT INTO study_project_daily_summaries (date, project_id, project_name_snapshot, minutes, record_count, updated_at)
SELECT date, project_id, project_name_snapshot, COALESCE(SUM(minutes), 0), COUNT(*), ${sqlString(timestamp)}
FROM study_time_records
GROUP BY date, project_id, project_name_snapshot;
INSERT INTO app_metadata (key, value, updated_at)
VALUES ('study_summaries_rebuilt_at', ${sqlString(timestamp)}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
COMMIT;`);
}

function refreshStudySummariesForDate(date) {
  const targetDate = date || todayISO();
  const timestamp = nowISO();
  runSqlite(`BEGIN;
DELETE FROM study_daily_summaries WHERE date = ${sqlString(targetDate)};
DELETE FROM study_project_daily_summaries WHERE date = ${sqlString(targetDate)};
INSERT INTO study_daily_summaries (date, total_minutes, record_count, updated_at)
SELECT date, COALESCE(SUM(minutes), 0), COUNT(*), ${sqlString(timestamp)}
FROM study_time_records
WHERE date = ${sqlString(targetDate)}
GROUP BY date;
INSERT INTO study_project_daily_summaries (date, project_id, project_name_snapshot, minutes, record_count, updated_at)
SELECT date, project_id, project_name_snapshot, COALESCE(SUM(minutes), 0), COUNT(*), ${sqlString(timestamp)}
FROM study_time_records
WHERE date = ${sqlString(targetDate)}
GROUP BY date, project_id, project_name_snapshot;
INSERT INTO app_metadata (key, value, updated_at)
VALUES ('study_summaries_rebuilt_at', ${sqlString(timestamp)}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
COMMIT;`);
}

function ensureStudySummariesReady() {
  const recordCount = Number(sqliteScalar('SELECT COUNT(*) FROM study_time_records;') || 0);
  const summaryCount = Number(sqliteScalar('SELECT COUNT(*) FROM study_daily_summaries;') || 0);
  const rebuiltAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'study_summaries_rebuilt_at' LIMIT 1;");
  if (recordCount && (!summaryCount || !rebuiltAt)) rebuildStudySummaries();
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
  refreshStudySummariesForDate(date);
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

function getStudyTargetMinutes() {
  return Math.max(0, Number(sqliteScalar(`SELECT value FROM app_metadata WHERE key = ${sqlString(studyTargetMinutesKey)} LIMIT 1;`) || 0) || 0);
}

function saveStudyTargetMinutes(payload) {
  const hours = Number(payload.targetHours ?? 0);
  const explicitMinutes = Number(payload.targetMinutes ?? NaN);
  const minutes = Number.isFinite(explicitMinutes)
    ? Math.max(0, Math.round(explicitMinutes))
    : Math.max(0, Math.round(hours * 60));
  runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES (${sqlString(studyTargetMinutesKey)}, ${sqlString(String(minutes))}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  tableChanged();
  return { targetMinutes: minutes, targetHours: Math.round((minutes / 60) * 10) / 10 };
}

function getLastNDaysTotals(days, endDate = todayISO()) {
  const startDate = addDaysISO(endDate, -(days - 1));
  const rows = sqliteJson(`SELECT date, total_minutes AS minutes
FROM study_daily_summaries
WHERE date BETWEEN ${sqlString(startDate)} AND ${sqlString(endDate)}
ORDER BY date;`);
  const map = new Map(rows.map((row) => [row.date, Number(row.minutes || 0)]));
  return dateRange(startDate, endDate).map((date) => ({ date, minutes: map.get(date) || 0 }));
}

function getProjectTotals(startDate, endDate) {
  return sqliteJson(`SELECT project_name_snapshot AS name, COALESCE(SUM(minutes), 0) AS minutes
FROM study_project_daily_summaries
WHERE date BETWEEN ${sqlString(startDate)} AND ${sqlString(endDate)}
GROUP BY project_name_snapshot
HAVING minutes > 0
ORDER BY minutes DESC, name;`).map((row) => ({ name: row.name, minutes: Number(row.minutes || 0) }));
}

function getProjectDistributionForDate(date) {
  return sqliteJson(`SELECT project_name_snapshot AS name, COALESCE(SUM(minutes), 0) AS value
FROM study_project_daily_summaries
WHERE date = ${sqlString(date)}
GROUP BY project_name_snapshot
HAVING value > 0
ORDER BY value DESC;`).map((row) => ({ name: row.name, value: Number(row.value || 0) }));
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
  const todayTotal = Number(sqliteScalar(`SELECT COALESCE(total_minutes, 0) FROM study_daily_summaries WHERE date = ${sqlString(today)};`) || 0);
  const totalStudyMinutes = Number(sqliteScalar('SELECT COALESCE(SUM(total_minutes), 0) FROM study_daily_summaries;') || 0);
  const studyTargetMinutes = getStudyTargetMinutes();
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
  const todayBrief = getDailyBriefByDate(today) || getLatestDailyBriefSummary();

  const payload = {
    activeGoal,
    today,
    todayTotal,
    totalStudyMinutes,
    studyTargetMinutes,
    latestExam,
    todayReview: reviews.find((review) => review.date === today) || null,
    yesterdayReview: reviews.find((review) => review.date === yesterday) || null,
    visibleTasks,
    todayWaterRecord: waterRecord,
    todayBrief,
  };
  dashboardPayloadCache = { revision: dataRevision, date: today, payload };
  return { ...payload, readOnly: sessionRole === 'read' };
}

function getDashboardChartsPayload() {
  const today = todayISO();
  return {
    today,
    distribution: getProjectDistributionForDate(today),
    trend: getLastNDaysTotals(7, today),
  };
}

function getStatisticsSummary() {
  const cacheDate = todayISO();
  if (statisticsSummaryCache?.revision === dataRevision && statisticsSummaryCache.date === cacheDate) {
    return statisticsSummaryCache.payload;
  }
  const today = cacheDate;
  const todayTotal = Number(sqliteScalar(`SELECT COALESCE(total_minutes, 0) FROM study_daily_summaries WHERE date = ${sqlString(today)};`) || 0);
  const distribution = getProjectDistributionForDate(today);
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
  const fileName = filePath.split(/[\\/]/).pop() || '';
  const shouldRevalidate = filePath.endsWith('index.html') || fileName === 'service-worker.js' || fileName.endsWith('.webmanifest');
  res.writeHead(200, {
    'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream',
    'cache-control': shouldRevalidate ? 'no-cache' : 'public, max-age=31536000, immutable',
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

  if (req.url === '/api/tasks/status' && req.method === 'GET') {
    sendJson(res, { ...getTaskCenterStatus(), readOnly: sessionRole === 'read' });
    return;
  }

  if (req.url?.startsWith('/api/briefs') && req.method === 'GET') {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    if (requestUrl.pathname === '/api/briefs/settings') {
      sendJson(res, { settings: getDailyBriefSettings(), readOnly: sessionRole === 'read' });
      return;
    }
    if (requestUrl.pathname === '/api/briefs/today') {
      sendJson(res, { brief: getDailyBriefByDate(todayISO()), latest: getLatestDailyBriefSummary(), readOnly: sessionRole === 'read' });
      return;
    }
    if (requestUrl.pathname === '/api/briefs') {
      sendJson(res, { briefs: listDailyBriefs(queryLimit(requestUrl.searchParams, 30, 100) ?? 30), readOnly: sessionRole === 'read' });
      return;
    }
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

  if (req.url === '/api/settings/study-target' && req.method === 'GET') {
    ensureSqliteStore();
    const targetMinutes = getStudyTargetMinutes();
    sendJson(res, { targetMinutes, targetHours: Math.round((targetMinutes / 60) * 10) / 10, readOnly: sessionRole === 'read' });
    return;
  }

  if (req.url === '/api/dashboard/charts' && req.method === 'GET') {
    ensureSqliteStore();
    sendJson(res, getDashboardChartsPayload());
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

  if (req.url === '/api/error-themes/embedding/status' && req.method === 'GET') {
    ensureSqliteStore();
    const embeddingRows = Number(sqliteScalar('SELECT COUNT(*) FROM review_sentence_embeddings;') || 0);
    sendJson(res, { ...getEmbeddingStatus(), embeddingRows, readOnly: sessionRole === 'read' });
    return;
  }

  if (req.url === '/api/error-themes/options' && req.method === 'GET') {
    ensureSqliteStore();
    sendJson(res, { themes: getErrorThemeOptions(), readOnly: sessionRole === 'read' });
    return;
  }

  if (req.url?.startsWith('/api/error-themes/analysis') && req.method === 'GET') {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const from = requestUrl.searchParams.get('from') || '1900-01-01';
    const to = requestUrl.searchParams.get('to') || todayISO();
    sendJson(res, { ...getErrorThemeAnalysis(from, to), readOnly: sessionRole === 'read' });
    return;
  }

  if (req.url?.startsWith('/api/error-themes/detail') && req.method === 'GET') {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const themeId = requestUrl.searchParams.get('themeId');
    const from = requestUrl.searchParams.get('from') || '1900-01-01';
    const to = requestUrl.searchParams.get('to') || todayISO();
    const detail = getErrorThemeDetail(themeId, from, to);
    if (!detail) {
      sendJson(res, { error: 'Not found' }, 404);
      return;
    }
    sendJson(res, { ...detail, readOnly: sessionRole === 'read' });
    return;
  }

  if (req.url === '/api/error-themes/batch/status' && req.method === 'GET') {
    ensureSqliteStore();
    sendJson(res, { job: currentErrorThemeJobSnapshot(), readOnly: sessionRole === 'read' });
    return;
  }

  if (req.url === '/api/error-themes/batch/run' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const periodStart = body.from || '1900-01-01';
    const periodEnd = body.to || todayISO();
    const result = startErrorThemeBatchJob({
      periodStart,
      periodEnd,
      mode: body.mode === 'embedding' ? 'embedding' : 'rules',
      trigger: 'manual',
      modelProfile: body.modelProfile === 'small' ? 'small' : 'large',
    });
    sendJson(res, { ok: true, ...result });
    return;
  }

  if (req.url === '/api/error-themes/corrections/save' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = saveErrorThemeCorrection(body);
    sendJson(res, { ...result, analysis: getErrorThemeAnalysis(body.from || '1900-01-01', body.to || todayISO()) });
    return;
  }

  if (req.url?.startsWith('/api/reports') && req.method === 'GET') {
    ensureSqliteStore();
    sendJson(res, { reports: listLearningReports() });
    return;
  }

  if (req.url === '/api/reports/generate' && req.method === 'POST') {
    ensureSqliteStore();
    const body = await readJsonBody(req);
    const kind = body.kind === 'monthly' ? 'monthly' : 'weekly';
    const period = body.period === 'previous' ? previousPeriod(kind) : currentPeriod(kind);
    const report = generateLearningReport(kind, body.periodStart || period.periodStart, body.periodEnd || period.periodEnd, 'manual');
    sendJson(res, { ok: true, report });
    return;
  }

  if (req.url === '/api/briefs/settings' && req.method === 'POST') {
    ensureSqliteStore();
    const body = await readJsonBody(req);
    sendJson(res, { settings: saveDailyBriefSettings(body), readOnly: false });
    return;
  }

  if (req.url === '/api/briefs/generate' && req.method === 'POST') {
    ensureSqliteStore();
    const body = await readJsonBody(req);
    const brief = await generateDailyBrief({
      date: body.date || todayISO(),
      trigger: 'manual',
      sendEmail: Boolean(body.sendEmail),
    });
    sendJson(res, { ok: true, brief });
    return;
  }

  if (req.url === '/api/briefs/send-latest' && req.method === 'POST') {
    ensureSqliteStore();
    const settings = getDailyBriefSettings({ includeSecret: true });
    const latest = getLatestDailyBriefSummary();
    if (!latest) {
      sendJson(res, { error: 'No daily brief to send' }, 404);
      return;
    }
    await sendDailyBriefEmail(latest.payload, settings.email);
    const timestamp = nowISO();
    runSqlite(`UPDATE daily_briefs SET emailed_at = ${sqlString(timestamp)}, email_error = '', updated_at = ${sqlString(timestamp)} WHERE id = ${sqlValue(latest.id)};`);
    tableChanged();
    sendJson(res, { ok: true, brief: getDailyBriefByDate(latest.date) });
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

  if (req.url === '/api/settings/study-target' && req.method === 'POST') {
    sendJson(res, saveStudyTargetMinutes(body));
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

  const requestPath = new URL(req.url || '/', 'http://localhost').pathname;
  if (['/manifest.webmanifest', '/service-worker.js', '/app-icon.svg', '/favicon.svg', '/icons.svg'].includes(requestPath)) {
    serveStatic(req, res);
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
