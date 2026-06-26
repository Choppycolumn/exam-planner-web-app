import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os';
import { setDefaultResultOrder } from 'node:dns';
import { createSqliteRepository } from './modules/sqlite-repository.mjs';
import { createTaskRunsRepository } from './modules/task-runs-repository.mjs';
import { createOpsRepository } from './modules/ops-repository.mjs';
import { createExternalApiClient } from './modules/external-api-client.mjs';
import { parseWorldPeRatio, scoreIndexPurchaseAssessment } from './modules/index-assessment.mjs';
import { summarizeHealth } from './modules/health-status.mjs';
import { resolveBackupPath } from './modules/backup-validation.mjs';
import { queryLimit, queryOffset } from './modules/api-helpers.mjs';
import { isTelegramAuthorized, readTelegramConfig, saveTelegramConfig, telegramConfigStatus, telegramConfirmKeyboard, telegramTaskKeyboard, telegramUpdateContext } from './modules/telegram-bot.mjs';
import { createNotificationRepository } from './modules/notification-repository.mjs';
import { createNotificationQueue } from './modules/notification-queue.mjs';
import { createCalendarRepository } from './modules/calendar-repository.mjs';
import { notificationChannelReadiness, resolveProactiveDispatch } from './modules/notification-dispatcher.mjs';
import { runSqlMigrations } from './modules/migration-runner.mjs';
import { clawbotHelpText, parseClawbotCommand } from './modules/clawbot-command-parser.mjs';
import { createMarketCopilotRepository } from './modules/market-copilot-repository.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const dataDir = resolve(fileURLToPath(new URL('../data', import.meta.url)));
const legacyDataFile = join(dataDir, 'db.json');
const sqliteFile = join(dataDir, 'exam-planner.sqlite');
const backupsDir = join(dataDir, 'backups');
const libraryDir = join(dataDir, 'library');
const libraryFilesDir = join(libraryDir, 'files');
const migrationsDir = resolve(fileURLToPath(new URL('./migrations', import.meta.url)));
const dictionaryFile = join(dataDir, 'ecdict.csv');
const loginAttemptsFile = join(dataDir, 'login-attempts.json');
const proxySettingsEnvFile = process.env.PROXY_SETTINGS_ENV_FILE || (process.platform === 'win32' ? join(dataDir, 'proxy.env') : '/etc/exam-planner/proxy.env');
const telegramEnvFile = process.env.TELEGRAM_ENV_FILE || (process.platform === 'win32' ? join(dataDir, 'telegram.env') : '/etc/exam-planner/telegram.env');
const embeddingWorkerFile = join(resolve(fileURLToPath(new URL('.', import.meta.url))), 'embedding_worker.py');
const openClawWeixinSenderFile = join(resolve(fileURLToPath(new URL('.', import.meta.url))), 'openclaw-weixin-send.mjs');
const embeddingCacheDir = process.env.EMBEDDING_CACHE_DIR || join(dataDir, 'embedding-models');
const smallEmbeddingModelName = process.env.EMBEDDING_MODEL_NAME || 'BAAI/bge-small-zh-v1.5';
const largeEmbeddingModelName = process.env.LARGE_EMBEDDING_MODEL_NAME || 'intfloat/multilingual-e5-large';
const port = Number(process.env.PORT || 8080);
const appPassword = process.env.APP_PASSWORD;
const readOnlyPassword = process.env.READONLY_PASSWORD || '123';
const cookieSecret = process.env.COOKIE_SECRET || randomBytes(32).toString('hex');
const cookieName = 'exam_planner_session';
const corsOrigin = process.env.CORS_ORIGIN || '*';
const secureCookie = process.env.COOKIE_SECURE === '1';
const clawbotSecret = process.env.CLAWBOT_SECRET || '';
const clawbotWebhookUrl = process.env.CLAWBOT_WEBHOOK_URL || '';
const openClawChannel = process.env.OPENCLAW_CLAWBOT_CHANNEL || 'openclaw-weixin';
const openClawAccountDir = process.env.OPENCLAW_ACCOUNT_DIR || '/root/.openclaw/openclaw-weixin/accounts';
const openClawNpmProjectsDir = process.env.OPENCLAW_NPM_PROJECTS_DIR || '/root/.openclaw/npm/projects';
const openClawAccountId = process.env.OPENCLAW_CLAWBOT_ACCOUNT || process.env.OPENCLAW_WEIXIN_ACCOUNT_ID || '';
const openClawTarget = process.env.OPENCLAW_CLAWBOT_TARGET || '';
const openClawCli = process.env.OPENCLAW_CLI || (existsSync('/opt/node22/bin/openclaw') ? '/opt/node22/bin/openclaw' : 'openclaw');
const requestLogSlowMs = Number(process.env.REQUEST_LOG_SLOW_MS || 1500);
const jsonBodyMaxBytes = Number(process.env.JSON_BODY_MAX_BYTES || 10 * 1024 * 1024);
const libraryUploadMaxBytes = Number(process.env.LIBRARY_UPLOAD_MAX_BYTES || 350 * 1024 * 1024);
const minFreeDiskBytes = Number(process.env.MIN_FREE_DISK_BYTES || 512 * 1024 * 1024);
const entitySchemaVersion = 1;
const studyTargetMinutesKey = 'study_target_minutes';
const dailyBriefSettingsKey = 'daily_brief_settings_json';
const loginFailureLimit = 3;
const loginLockMs = 30 * 60 * 1000;
const loginFailureDelayMinMs = 1000;
const loginFailureDelaySpreadMs = 1000;
const sqliteRepository = createSqliteRepository({ sqliteFile, dataDir });
const taskRunsRepository = createTaskRunsRepository(sqliteRepository);
const opsRepository = createOpsRepository(sqliteRepository);
const externalApiClient = createExternalApiClient();
const notificationRepository = createNotificationRepository(sqliteRepository);
const marketCopilotRepository = createMarketCopilotRepository(sqliteRepository, {
  externalApiClient,
  notifyEvent: (payload) => notifyEvent(payload),
  log: (level, event, detail) => logStructured(level, event, detail),
});
const notificationQueue = createNotificationQueue({
  repository: notificationRepository,
  sendProactive: (text, delivery) => sendProactiveNotification(text, delivery),
  notifyEvent: (payload) => notifyEvent(payload),
  log: (level, event, detail) => logStructured(level, event, detail),
});
const telegramOpsConfirmations = new Map();
const calendarRepository = createCalendarRepository(sqliteRepository);

if (!appPassword) {
  throw new Error('APP_PASSWORD is required');
}

try {
  setDefaultResultOrder('ipv4first');
} catch {
  // Older Node runtimes can ignore this; curl fallback below also forces IPv4.
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const projectColors = ['#2563eb', '#16a34a', '#f97316', '#9333ea', '#dc2626', '#0f766e', '#ca8a04', '#64748b'];
const subjectColors = ['#2563eb', '#16a34a', '#9333ea', '#dc2626'];
const dictionaryCache = new Map();
let sqliteReady = false;
let dictionaryIndexChecked = false;
let reportTimerStarted = false;
let nightlyErrorThemeTimerStarted = false;
let dailyBriefTimerStarted = false;
let maintenanceTimerStarted = false;
let dailyBriefTimer = null;
let taskReminderTimerStarted = false;
let taskReminderTimer = null;
let notificationQueueTimerStarted = false;
let notificationQueueTimer = null;
let marketCopilotTimerStarted = false;
let backupVerificationCache = null;
let errorThemeBatchJob = null;
let shuttingDown = false;
let nextNightlyErrorThemeAt = null;
let nextDailyBriefAt = null;
let nextMaintenanceAt = null;
let nextTaskReminderScanAt = null;
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

function normalizeTaskDueTime(value) {
  const text = String(value || '').trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeReminderSentOffsets(value) {
  let items = value;
  if (typeof value === 'string') {
    try {
      items = JSON.parse(value || '[]');
    } catch {
      items = [];
    }
  }
  if (!Array.isArray(items)) return [];
  return Array.from(new Set(items.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item <= 30 * 24 * 60))).sort((a, b) => a - b);
}

function normalizeTaskRow(item = {}) {
  const dueTime = normalizeTaskDueTime(item.dueTime);
  return {
    ...item,
    dueTime,
    isCompleted: Boolean(item.isCompleted),
    completedAt: item.completedAt || undefined,
    reminderEnabled: Boolean(item.reminderEnabled) && Boolean(dueTime),
    reminderSentOffsets: normalizeReminderSentOffsets(item.reminderSentOffsets),
    reminderLastSentAt: item.reminderLastSentAt || undefined,
  };
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

function runSqliteTransaction(statements = []) {
  const body = Array.isArray(statements) ? statements.join('\n') : String(statements || '');
  return runSqlite(`BEGIN IMMEDIATE;\n${body}\nCOMMIT;`);
}

function getAppConfigSnapshot() {
  return {
    port,
    dataDir,
    sqliteFile,
    backupsDir,
    libraryDir,
    requestLogSlowMs,
    jsonBodyMaxBytes,
    libraryUploadMaxBytes,
    minFreeDiskBytes,
    corsOrigin,
    secureCookie,
    embeddingCacheDir,
    smallEmbeddingModelName,
    largeEmbeddingModelName,
  };
}

function validateStartupConfig() {
  const problems = [];
  if (readOnlyPassword === '123') problems.push('READONLY_PASSWORD is using the unsafe default value');
  if (!cookieSecret || cookieSecret.length < 32) problems.push('COOKIE_SECRET should be at least 32 characters');
  if (!Number.isFinite(port) || port <= 0 || port > 65535) problems.push('PORT must be a valid TCP port');
  if (!Number.isFinite(jsonBodyMaxBytes) || jsonBodyMaxBytes < 1024) problems.push('JSON_BODY_MAX_BYTES is too small');
  if (!Number.isFinite(libraryUploadMaxBytes) || libraryUploadMaxBytes < jsonBodyMaxBytes) problems.push('LIBRARY_UPLOAD_MAX_BYTES should be >= JSON_BODY_MAX_BYTES');
  if (!Number.isFinite(minFreeDiskBytes) || minFreeDiskBytes < 0) problems.push('MIN_FREE_DISK_BYTES must be non-negative');
  if (problems.length) {
    console.warn(JSON.stringify({ level: 'warn', event: 'startup_config_warnings', problems }));
  }
  return problems;
}

function assertDiskSpace(minBytes = minFreeDiskBytes) {
  const disk = getDiskStatus();
  if (disk && disk.availableBytes < minBytes) {
    const error = new Error(`Insufficient disk space: ${disk.availableBytes} bytes available`);
    error.statusCode = 507;
    throw error;
  }
  return disk;
}

function redactSecretText(value = '') {
  const text = String(value);
  const barkKey = String(process.env.BARK_DEVICE_KEY || '').trim();
  return (barkKey ? text.replaceAll(barkKey, '[redacted-bark-device-key]') : text)
    .replace(/(password|passwd|token|secret|cookie|authorization)(=|:)\s*[^,\s;]+/gi, '$1$2 [redacted]')
    .replace(/exam_planner_session=[^;\s]+/gi, 'exam_planner_session=[redacted]')
    .replace(/APP_PASSWORD=[^,\s;]+/gi, 'APP_PASSWORD=[redacted]')
    .slice(0, 1000);
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
  due_time TEXT NOT NULL DEFAULT '',
  urgency TEXT NOT NULL DEFAULT 'medium',
  is_completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  reminder_enabled INTEGER NOT NULL DEFAULT 0,
  reminder_sent_offsets TEXT NOT NULL DEFAULT '[]',
  reminder_last_sent_at TEXT,
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
CREATE TABLE IF NOT EXISTS confusing_words_backup_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  exported_at TEXT,
  backed_up_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'sync',
  group_count INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
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
CREATE TABLE IF NOT EXISTS problem_inbox_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS visit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  role TEXT NOT NULL DEFAULT '',
  client_hash TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_name TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  error TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  actor_role TEXT NOT NULL DEFAULT '',
  client_hash TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS precomputed_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  source_updated_at TEXT,
  computed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS library_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '未分类',
  tags_json TEXT NOT NULL DEFAULT '[]',
  original_file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  text_status TEXT NOT NULL DEFAULT 'pending',
  text_error TEXT NOT NULL DEFAULT '',
  page_count INTEGER,
  chapter_count INTEGER,
  progress_percent REAL NOT NULL DEFAULT 0,
  last_locator TEXT NOT NULL DEFAULT '',
  last_opened_at TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS library_text_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  locator TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(book_id, chunk_index)
);
CREATE VIRTUAL TABLE IF NOT EXISTS library_text_fts USING fts5(book_id UNINDEXED, chunk_id UNINDEXED, title, text);
CREATE TABLE IF NOT EXISTS library_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  locator TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS library_bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  page_number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS library_reading_progress (
  book_id INTEGER PRIMARY KEY,
  locator TEXT NOT NULL DEFAULT '',
  progress_percent REAL NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS idx_confusing_words_versions_created ON confusing_words_backup_versions(created_at);
CREATE INDEX IF NOT EXISTS idx_confusing_words_versions_hash ON confusing_words_backup_versions(payload_hash);
CREATE INDEX IF NOT EXISTS idx_learning_reports_period ON learning_reports(kind, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_daily_briefs_date ON daily_briefs(date);
CREATE INDEX IF NOT EXISTS idx_problem_inbox_date_status ON problem_inbox_items(date, status);
CREATE INDEX IF NOT EXISTS idx_problem_inbox_status_updated ON problem_inbox_items(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_visit_events_created_at ON visit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_visit_events_path_created_at ON visit_events(path, created_at);
CREATE INDEX IF NOT EXISTS idx_task_runs_name_started ON task_runs(task_name, started_at);
CREATE INDEX IF NOT EXISTS idx_task_runs_status_started ON task_runs(status, started_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_action_created ON audit_events(action, created_at);
CREATE INDEX IF NOT EXISTS idx_api_request_log_path_created ON api_request_log(path, created_at);
CREATE INDEX IF NOT EXISTS idx_precomputed_cache_computed_at ON precomputed_cache(computed_at);
CREATE INDEX IF NOT EXISTS idx_library_books_updated ON library_books(is_archived, updated_at);
CREATE INDEX IF NOT EXISTS idx_library_books_category ON library_books(category, updated_at);
CREATE INDEX IF NOT EXISTS idx_library_text_chunks_book ON library_text_chunks(book_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_library_notes_book ON library_notes(book_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_library_bookmarks_book ON library_bookmarks(book_id, page_number, updated_at);
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
    'DELETE FROM problem_inbox_items;',
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
  scripts.push(insertRowsSql('short_term_tasks', ['id', 'title', 'due_date', 'due_time', 'urgency', 'is_completed', 'completed_at', 'reminder_enabled', 'reminder_sent_offsets', 'reminder_last_sent_at', 'note', 'schema_version', 'created_at', 'updated_at'], normalized.shortTermTasks.map((item, index) => ({
    id: Number(item.id || index + 1),
    title: item.title || '',
    due_date: item.dueDate || todayISO(),
    due_time: normalizeTaskDueTime(item.dueTime),
    urgency: item.urgency || 'medium',
    is_completed: Boolean(item.isCompleted),
    completed_at: item.completedAt || null,
    reminder_enabled: item.reminderEnabled ?? Boolean(normalizeTaskDueTime(item.dueTime)),
    reminder_sent_offsets: JSON.stringify(normalizeReminderSentOffsets(item.reminderSentOffsets)),
    reminder_last_sent_at: item.reminderLastSentAt || null,
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
  const shortTermTasks = sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency, is_completed AS isCompleted, completed_at AS completedAt,
reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt, note,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM short_term_tasks ORDER BY due_date, due_time, id;`).map(normalizeTaskRow);
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
    keywords: ['英语阅读', '阅读理解', '真题阅读', '长难句', '英语读不懂', '阅读读不懂', '阅读正确率', '英语正确率', '阅读准确率', '阅读错', '阅读速度', '英语真题', '英语一阅读'],
  },
  {
    id: 'professional-course',
    label: '专业课推进偏慢',
    keywords: ['专业课', '专业课进度慢', '专业课进度较慢', '专业课没看', '专业课没学', '专业课听课', '信号与系统', '通信原理', '数据结构', '操作系统', '计算机网络', '计算机组成', '计组', '408'],
  },
  {
    id: 'math-errors',
    label: '数学错题 / 概念计算',
    keywords: ['数学错', '高数错', '线代错', '线性代数错', '概率错', '错题', '错太多', '做错', '算错', '计算错误', '计算失误', '公式', '概念', '题错', '不会做', '不会算'],
  },
  {
    id: 'method-review',
    label: '复习方法 / 错题闭环',
    keywords: ['复习不到位', '没有复习', '没复习', '二刷', '回顾少', '整理少', '错题整理', '错题没整理', '笔记没整理', '知识点不熟', '框架不清', '方法不对', '只听课不练题', '只看不练'],
  },
  {
    id: 'memory-recall',
    label: '记忆背诵 / 回忆不足',
    keywords: ['背不下来', '背不完', '没背', '没记住', '记不住', '忘得快', '回忆不出来', '默写错', '单词忘', '单词没背', '背诵慢'],
  },
  {
    id: 'planning',
    label: '计划执行 / 时间安排',
    keywords: ['计划', '安排', '时间不够', '没完成', '未完成', '没看', '没学', '没做', '没复习', '没开始', '没推进', '没碰', '没刷', '没练', '没整理', '赶不上', '效率低', '效率低下', '效率不高', '执行', '任务', '拖到', '来不及'],
  },
  {
    id: 'energy',
    label: '作息精力状态',
    keywords: ['困', '睡眠', '熬夜', '起晚', '疲惫', '累', '状态差', '精力', '头疼', '生病', '晚睡', '犯困', '没精神'],
  },
  {
    id: 'emotion-pressure',
    label: '情绪压力 / 心态波动',
    keywords: ['焦虑', '压力大', '烦躁', '心态崩', '崩溃', '沮丧', '自责', '急躁', '慌', '怕来不及', '心态不好'],
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
    for (const sentence of splitReviewSentences(text)) {
      const matched = classifyReviewSegment(sentence, field.key);
      if (matched?.theme.id === theme.id) {
        return { date: review.date, field: field.label, text: compactText(sentence, 80) };
      }
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
    if (theme.id === 'english-reading' && !isEnglishReadingSegment(normalizedSegment)) continue;
    if (theme.id === 'professional-course' && !isProfessionalCourseSegment(normalizedSegment)) continue;
    if (theme.id === 'method-review' && !isLearningMethodSegment(normalizedSegment)) continue;
    if (theme.id === 'memory-recall' && !isMemoryRecallSegment(normalizedSegment)) continue;
    if (theme.id === 'planning' && !isPlanningSegment(normalizedSegment)) continue;
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
  const negativeCue = /(问题|错误|错|慢|拖|没|未|不足|不会|不懂|卡住|卡了|低下|不高|较差|太差|难|困|熬夜|分心|走神|不集中|不太集中|集中不了|浮躁|静不下心|没啥状态|状态不好|状态差|抖音|微信|小红书|视频号|刷视频|刷手机|效率低|效率低下|效率不高)/;
  if (fieldKey === 'tomorrowPlan') {
    return negativeCue.test(text) || /(卸载|关闭|限制).*(抖音|微信|小红书|视频号|手机)/.test(text);
  }
  return negativeCue.test(text);
}

function isStudyNotDoneSegment(segment) {
  const text = String(segment || '');
  const subjectPattern = /(高数|高等数学|线代|线性代数|概率|数学|英语阅读|阅读|专业课|政治|单词|真题|错题|课程|章节|知识点|笔记|背诵)/;
  const notDonePattern = /(没看|没学|没做|没复习|没开始|没推进|没碰|没刷|没练|没背|没记|没整理|未看|未学|未做|未复习|未开始|未推进|未整理)/;
  return (subjectPattern.test(text) && notDonePattern.test(text)) || /(又没看|还是没看|还没看|没怎么看|没来得及看)/.test(text);
}

function isEnglishReadingSegment(segment) {
  const text = String(segment || '');
  return /(英语|英一|英语一|阅读理解|真题阅读|长难句)/.test(text) && /(阅读|长难句|读不懂|正确率|准确率|错|速度|真题)/.test(text);
}

function isProfessionalCourseSegment(segment) {
  const text = String(segment || '');
  return /(专业课|信号与系统|通信原理|数据结构|操作系统|计算机网络|计算机组成|计组|408)/.test(text);
}

function isMathErrorSegment(segment) {
  const text = String(segment || '');
  const mathSubjectPattern = /(数学|高数|高等数学|线代|线性代数|概率)/;
  const mathErrorPattern = /(错|计算|算错|公式|概念|题|不会做|不会算|证明|推导)/;
  return /(计算错误|计算失误|错题|错太多|题错|算错)/.test(text) || (mathSubjectPattern.test(text) && mathErrorPattern.test(text));
}

function isLearningMethodSegment(segment) {
  const text = String(segment || '');
  if (isMathErrorSegment(text)) return false;
  return /(复习|回顾|整理|错题|笔记|知识点|框架|方法|二刷|闭环|只听课|只看不练|只听不练)/.test(text)
    && /(不到位|不熟|不清|不对|少|没|未|忘|漏|断|弱|低|慢)/.test(text);
}

function isMemoryRecallSegment(segment) {
  const text = String(segment || '');
  return /(背|记|忘|回忆|默写|单词|词汇)/.test(text) && /(不下来|不完|不住|忘|慢|错|少|没|未)/.test(text);
}

function isPlanningSegment(segment) {
  const text = String(segment || '');
  return isStudyNotDoneSegment(text) || /(计划|安排|时间|没完成|未完成|赶不上|来不及|效率低|效率低下|效率不高|执行|任务|拖到|拖延)/.test(text);
}

function isClearlyPositiveSegment(segment, fieldKey) {
  if (fieldKey === 'problems') return false;
  const text = String(segment || '');
  const positiveCue = /(有进步|明显进步|做得不错|比较顺利|完成了|已完成|保持|稳定|掌握|按计划|效率提高|状态不错|注意力还好|专注度还好|效率还行|状态还行|状态可以|还算顺利)/;
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
  const inboxItems = sqliteJson(`SELECT id, date, text
FROM problem_inbox_items
WHERE status = 'open' AND date BETWEEN ${sqlString(from)} AND ${sqlString(to)}
ORDER BY date, id;`);
  const inboxReviews = inboxItems.map((item) => ({
    id: -Math.abs(Number(item.id)),
    date: item.date,
    summary: '',
    wins: '',
    problems: item.text,
    tomorrowPlan: '',
  }));
  const reviewSources = [...reviews, ...inboxReviews];
  const corrections = loadErrorThemeCorrections();
  const correctionResult = extractCorrectionProblemCandidates(reviewSources, corrections);
  let embeddingMeta = null;
  let candidates = correctionResult.candidates;
  if (options.mode === 'rules') {
    candidates = mergeProblemCandidates(correctionResult.candidates, extractRuleProblemCandidates(reviewSources, correctionResult.handledSegmentKeys));
  } else {
    embeddingMeta = await extractEmbeddingProblemCandidates(reviewSources, timestamp, correctionResult.handledSegmentKeys, modelProfile);
    const ruleCandidates = extractRuleProblemCandidates(reviewSources, correctionResult.handledSegmentKeys);
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
    reviewCount: reviewSources.length,
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
    reviewCount: reviewSources.length,
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
      const task = await runExclusiveTask('error-theme-batch', trigger, async () => {
        const batchResult = await runErrorThemeBatch(periodStart, periodEnd, { mode, modelProfile: selectedProfile, trigger });
        refreshCurrentReportsAfterBatch(trigger === 'nightly' ? 'auto' : 'manual');
        return batchResult;
      }, { timeoutMs: 45 * 60 * 1000, metadata: { periodStart, periodEnd, mode, modelProfile: selectedProfile } });
      const result = task.result;
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
    generateTime: '08:00',
    cityName: '北京',
    latitude: 39.9042,
    longitude: 116.4074,
    marketSymbolsText: '上证指数|000001.SS\n深证成指|399001.SZ\n创业板指|399006.SZ\n纳斯达克|^IXIC\n标普500|^GSPC\nBTC|BTC-USD',
    wechat: {
      enabled: true,
    },
    taskReminders: {
      enabled: true,
      count: 1,
      offsetsMinutes: [60],
    },
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

function normalizeTaskReminderSettings(input = {}, previous = null) {
  const defaults = defaultDailyBriefSettings().taskReminders;
  const previousSettings = previous?.taskReminders || {};
  const enabled = Boolean(input.enabled ?? previousSettings.enabled ?? defaults.enabled);
  const rawOffsets = Array.isArray(input.offsetsMinutes) ? input.offsetsMinutes : previousSettings.offsetsMinutes || defaults.offsetsMinutes;
  const offsets = Array.from(new Set(rawOffsets
    .map((item) => Math.round(Number(item)))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 30 * 24 * 60)))
    .sort((a, b) => b - a)
    .slice(0, 5);
  const requestedCount = Math.round(Number(input.count ?? previousSettings.count ?? (offsets.length || defaults.count)));
  const nextOffsets = offsets.length ? offsets : defaults.offsetsMinutes;
  const count = Math.max(1, Math.min(5, nextOffsets.length, Number.isFinite(requestedCount) ? requestedCount : defaults.count));
  return {
    enabled,
    count,
    offsetsMinutes: nextOffsets.slice(0, count),
  };
}

function normalizeDailyBriefSettings(input = {}, previous = null) {
  const defaults = defaultDailyBriefSettings();
  const previousEmail = previous?.email || {};
  const emailInput = input.email || {};
  const previousWechat = previous?.wechat || {};
  const wechatInput = input.wechat || {};
  const requestedPassword = typeof emailInput.password === 'string' ? emailInput.password : '';
  const preservedPassword = requestedPassword.trim() ? requestedPassword : previousEmail.password || '';
  const secureMode = ['ssl', 'starttls', 'none'].includes(emailInput.secureMode) ? emailInput.secureMode : defaults.email.secureMode;
  return {
    enabled: input.enabled !== false,
    generateTime: /^\d{2}:\d{2}$/.test(input.generateTime || '') ? input.generateTime : defaults.generateTime,
    cityName: String(input.cityName || defaults.cityName).trim() || defaults.cityName,
    latitude: Number.isFinite(Number(input.latitude)) ? Number(input.latitude) : defaults.latitude,
    longitude: Number.isFinite(Number(input.longitude)) ? Number(input.longitude) : defaults.longitude,
    marketSymbolsText: String(input.marketSymbolsText ?? defaults.marketSymbolsText),
    wechat: {
      enabled: Boolean(wechatInput.enabled ?? previousWechat.enabled ?? defaults.wechat.enabled),
    },
    taskReminders: normalizeTaskReminderSettings(input.taskReminders || {}, previous),
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
  const result = spawnSync('curl', ['-4', '-fsSL', '-A', 'exam-planner-brief/1.0', '--retry', '2', '--retry-delay', '1', '--retry-all-errors', '--max-time', String(timeoutSeconds), url], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `curl exited ${result.status}`);
  return JSON.parse(result.stdout);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJsonWithFallback(url, timeoutMs = 9000) {
  const errors = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchJsonWithTimeout(url, timeoutMs);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      if (attempt === 0) await wait(600);
    }
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return fetchJsonWithCurl(url, Math.max(5, Math.ceil(timeoutMs / 1000)));
    } catch (error) {
      errors.push(`curl fallback: ${error instanceof Error ? error.message : String(error)}`);
      if (attempt === 0) await wait(600);
    }
  }
  throw new Error(errors.join('; '));
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

function fetchTextWithCurl(url, timeoutSeconds = 9) {
  const result = spawnSync('curl', ['-4', '-fsSL', '-A', 'exam-planner-brief/1.0', '--retry', '1', '--retry-delay', '1', '--retry-all-errors', '--max-time', String(timeoutSeconds), url], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `curl exited ${result.status}`);
  return result.stdout;
}

function fetchTextWithProxyCurl(url, timeoutSeconds = 45) {
  const result = spawnSync('curl', ['-4', '-fsSL', '--compressed', '--proxy', 'http://127.0.0.1:7890', '-A', 'exam-planner-brief/1.0', '--retry', '1', '--retry-delay', '1', '--retry-all-errors', '--max-time', String(timeoutSeconds), url], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `proxy curl exited ${result.status}`);
  return result.stdout;
}

async function fetchTextWithFallback(url, timeoutMs = 9000, headers = {}) {
  const errors = [];
  try {
    return await fetchTextWithTimeout(url, timeoutMs, headers);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  try {
    return fetchTextWithCurl(url, Math.max(5, Math.ceil(timeoutMs / 1000)));
  } catch (error) {
    errors.push(`curl fallback: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(errors.join('; '));
}

function parsePublicFundF10(code, text) {
  const rowMatch = String(text).match(/<tbody><tr><td>(\d{4}-\d{2}-\d{2})<\/td><td class='tor bold'>([0-9.]+)<\/td><td class='tor bold'>([0-9.]*)<\/td>/);
  if (!rowMatch) throw new Error('EastMoney F10 returned no net-value row');
  const price = Number(rowMatch[2]);
  if (!Number.isFinite(price) || price <= 0) throw new Error('EastMoney F10 returned invalid price');
  return {
    code,
    price,
    priceDate: rowMatch[1],
    source: '东方财富 F10 历史净值',
    provider: 'eastmoney-fund',
    raw: { cumulativeNetValue: rowMatch[3] || '', sourceKind: 'eastmoney-f10' },
  };
}

function dateBefore(dateText, days) {
  const date = new Date(`${dateText}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function parsePublicFundGz(code, text) {
  const match = String(text).match(/jsonpgz\((.*)\);?$/);
  if (!match || !match[1]) throw new Error('fundgz returned invalid JSONP');
  const payload = JSON.parse(match[1]);
  const price = Number(payload.dwjz || payload.gsz || 0);
  if (!payload.fundcode || !Number.isFinite(price) || price <= 0) throw new Error('fundgz returned no net value');
  return {
    code,
    name: payload.name || '',
    price,
    priceDate: payload.jzrq || String(payload.gztime || '').slice(0, 10) || todayISO(),
    source: '天天基金公开净值',
    provider: 'eastmoney-fund',
    raw: { ...payload, sourceKind: 'fundgz' },
  };
}

function parsePublicFundSearchProfile(code, payload) {
  const rows = Array.isArray(payload?.Datas) ? payload.Datas : [];
  const row = rows.find((item) => String(item?.CODE || item?._id || item?.BACKCODE || '') === code) ?? rows[0];
  if (!row) throw new Error('fund search returned no match');
  const base = row.FundBaseInfo && typeof row.FundBaseInfo === 'object' ? row.FundBaseInfo : {};
  const price = Number(base.DWJZ || 0);
  const minSubscription = Number(base.MINSG);
  return {
    code,
    name: String(row.NAME || base.SHORTNAME || ''),
    fundCompany: String(base.JJGS || ''),
    fundType: String(base.FTYPE || ''),
    minSubscription: Number.isFinite(minSubscription) ? minSubscription : null,
    isBuy: base.ISBUY == null ? null : String(base.ISBUY),
    price: Number.isFinite(price) && price > 0 ? price : null,
    priceDate: String(base.FSRQ || ''),
    source: '东方财富基金搜索公开资料',
    provider: 'eastmoney-fund',
    raw: {
      sourceKind: 'eastmoney-fund-search',
      category: row.CATEGORYDESC || row.CATEGORY || '',
      fundBaseInfo: base,
    },
  };
}

async function getPublicFundProfile(code) {
  const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(code)}`;
  return parsePublicFundSearchProfile(code, await fetchJsonWithTimeout(url, 4500));
}

function mergePublicFundProfile(quote, profile) {
  if (!profile) return quote;
  return {
    ...quote,
    name: quote.name || profile.name || '',
    fundCompany: profile.fundCompany || quote.fundCompany || '',
    fundType: profile.fundType || quote.fundType || '',
    minSubscription: profile.minSubscription ?? quote.minSubscription ?? null,
    isBuy: profile.isBuy ?? quote.isBuy ?? null,
    raw: { ...(quote.raw || {}), profile: profile.raw || profile },
  };
}

function quoteFromPublicFundProfile(profile) {
  if (!profile?.price) throw new Error('fund search returned no usable net value');
  return {
    code: profile.code,
    name: profile.name || '',
    fundCompany: profile.fundCompany || '',
    fundType: profile.fundType || '',
    minSubscription: profile.minSubscription ?? null,
    isBuy: profile.isBuy ?? null,
    price: profile.price,
    priceDate: profile.priceDate || todayISO(),
    source: profile.source,
    provider: 'eastmoney-fund',
    raw: profile.raw,
  };
}

async function getPublicFundQuote(code, dateText = '', includeProfile = false) {
  const normalizedCode = String(code || '').trim();
  if (!/^\d{6}$/.test(normalizedCode)) {
    const error = new Error('Invalid fund code');
    error.statusCode = 400;
    throw error;
  }
  const normalizedDate = String(dateText || '').trim();
  if (normalizedDate && !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
    const error = new Error('Invalid fund quote date');
    error.statusCode = 400;
    throw error;
  }
  const errors = [];
  let profile = null;
  if (includeProfile) {
    try {
      profile = await getPublicFundProfile(normalizedCode);
    } catch (error) {
      errors.push(`profile: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const sdate = normalizedDate ? dateBefore(normalizedDate, 20) : '';
  const edate = normalizedDate || '';
  const f10Url = `https://fundf10.eastmoney.com/F10DataApi.aspx?type=lsjz&code=${encodeURIComponent(normalizedCode)}&page=1&per=${normalizedDate ? 20 : 1}&sdate=${encodeURIComponent(sdate)}&edate=${encodeURIComponent(edate)}&rt=${Date.now()}`;
  try {
    const quote = parsePublicFundF10(normalizedCode, await fetchTextWithFallback(f10Url, 7000, { referer: 'https://fundf10.eastmoney.com/' }));
    try {
      const gzUrl = `https://fundgz.1234567.com.cn/js/${encodeURIComponent(normalizedCode)}.js?rt=${Date.now()}`;
      const gz = parsePublicFundGz(normalizedCode, await fetchTextWithFallback(gzUrl, 3500, { referer: 'https://fund.eastmoney.com/' }));
      return mergePublicFundProfile({ ...quote, name: gz.name || quote.name || '', raw: { ...quote.raw, latestPublicName: gz.name || '' } }, profile);
    } catch {
      return mergePublicFundProfile(quote, profile);
    }
  } catch (error) {
    errors.push(`F10: ${error instanceof Error ? error.message : String(error)}`);
  }
  const gzUrl = `https://fundgz.1234567.com.cn/js/${encodeURIComponent(normalizedCode)}.js?rt=${Date.now()}`;
  try {
    return mergePublicFundProfile(parsePublicFundGz(normalizedCode, await fetchTextWithFallback(gzUrl, 7000, { referer: 'https://fund.eastmoney.com/' })), profile);
  } catch (error) {
    errors.push(`fundgz: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!profile) {
    try {
      profile = await getPublicFundProfile(normalizedCode);
    } catch (error) {
      errors.push(`profile: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (profile?.price) return quoteFromPublicFundProfile(profile);
  const error = new Error(errors.join('; '));
  error.statusCode = 502;
  throw error;
}

async function getPublicUsdCnyQuote() {
  const data = await fetchJsonWithFallback('https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY', 7000);
  const rate = Number(data?.rates?.CNY || 0);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('USD/CNY rate is empty');
  return {
    rate,
    source: 'Frankfurter / ECB reference rates',
    provider: 'frankfurter-fx',
    asOfDate: data.date || todayISO(),
  };
}

async function getPublicStablecoinRates() {
  let source = 'CoinGecko Simple Price';
  let usdtCny = 0;
  let usdcCny = 0;
  try {
    const data = await fetchJsonWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=tether,usd-coin&vs_currencies=usd,cny', 3500);
    usdtCny = Number(data?.tether?.cny || 0);
    usdcCny = Number(data?.['usd-coin']?.cny || 0);
  } catch (error) {
    const usdCny = await getPublicUsdCnyQuote();
    usdtCny = usdCny.rate;
    usdcCny = usdCny.rate;
    source = `USD/CNY fallback for stablecoins (CoinGecko unavailable: ${error instanceof Error ? error.message : String(error)})`;
  }
  if (!Number.isFinite(usdtCny) || usdtCny <= 0 || !Number.isFinite(usdcCny) || usdcCny <= 0) {
    const usdCny = await getPublicUsdCnyQuote();
    usdtCny = usdCny.rate;
    usdcCny = usdCny.rate;
    source = 'USD/CNY fallback for stablecoins';
  }
  return {
    rates: {
      'USDT/CNY': usdtCny,
      'USDC/CNY': usdcCny,
    },
    source,
    provider: 'coingecko-stablecoin',
    asOfDate: todayISO(),
  };
}

const proxySettingsEnvKeys = [
  'MIHOMO_CONTROLLER_SECRET',
  'MIHOMO_SUBSCRIPTION_URL',
  'MIHOMO_SELECTED_PROXY',
  'MIHOMO_PROVIDER_MODE',
];

function parseProxySettingsEnvText(text = '') {
  const values = {};
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match || !proxySettingsEnvKeys.includes(match[1])) return;
    let value = match[2] || '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  });
  return values;
}

function readProxySettingsEnvValues() {
  try {
    if (!existsSync(proxySettingsEnvFile)) return {};
    return parseProxySettingsEnvText(readFileSync(proxySettingsEnvFile, 'utf8'));
  } catch (error) {
    logStructured('warn', 'proxy_settings_env_read_failed', { error: redactSecretText(error.message || String(error)) });
    return {};
  }
}

function proxySettingsCurrentValues() {
  const fileValues = readProxySettingsEnvValues();
  return {
    MIHOMO_CONTROLLER_SECRET: String(process.env.MIHOMO_CONTROLLER_SECRET || fileValues.MIHOMO_CONTROLLER_SECRET || ''),
    MIHOMO_SUBSCRIPTION_URL: String(process.env.MIHOMO_SUBSCRIPTION_URL || fileValues.MIHOMO_SUBSCRIPTION_URL || ''),
    MIHOMO_SELECTED_PROXY: String(process.env.MIHOMO_SELECTED_PROXY || fileValues.MIHOMO_SELECTED_PROXY || ''),
    MIHOMO_PROVIDER_MODE: String(process.env.MIHOMO_PROVIDER_MODE || fileValues.MIHOMO_PROVIDER_MODE || ''),
  };
}

function escapeProxySettingsEnvValue(value = '') {
  const text = String(value || '');
  if (/^[A-Za-z0-9_./:=+\-@]*$/.test(text)) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`;
}

function writeProxySettingsEnvValues(values) {
  mkdirSync(dirname(proxySettingsEnvFile), { recursive: true });
  const text = [
    '# Exam Planner Mihomo proxy settings.',
    `MIHOMO_CONTROLLER_SECRET=${escapeProxySettingsEnvValue(values.MIHOMO_CONTROLLER_SECRET)}`,
    `MIHOMO_SUBSCRIPTION_URL=${escapeProxySettingsEnvValue(values.MIHOMO_SUBSCRIPTION_URL)}`,
    `MIHOMO_SELECTED_PROXY=${escapeProxySettingsEnvValue(values.MIHOMO_SELECTED_PROXY)}`,
    `MIHOMO_PROVIDER_MODE=${escapeProxySettingsEnvValue(values.MIHOMO_PROVIDER_MODE)}`,
    '',
  ].join('\n');
  writeFileSync(proxySettingsEnvFile, text, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(proxySettingsEnvFile, 0o600);
  } catch {
    // Windows local development can ignore chmod.
  }
}

function applyProxySettingsProcessEnvValues(values) {
  proxySettingsEnvKeys.forEach((key) => {
    if (values[key]) process.env[key] = values[key];
    else delete process.env[key];
  });
}

const mihomoBinary = process.platform === 'win32' ? '' : '/usr/local/bin/mihomo';
const mihomoConfigDir = process.platform === 'win32' ? join(dataDir, 'mihomo') : '/etc/mihomo';
const mihomoConfigFile = join(mihomoConfigDir, 'config.yaml');
const mihomoProviderDir = process.platform === 'win32' ? join(dataDir, 'mihomo-providers') : '/etc/mihomo/proxy-providers';
const mihomoProviderFile = join(mihomoProviderDir, 'subscription.yaml');
const mihomoProxyUrl = 'http://127.0.0.1:7890';
const mihomoControllerUrl = 'http://127.0.0.1:9097';

function yamlDouble(value = '') {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function maskMihomoSubscriptionUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return { configured: false, label: '' };
  try {
    const url = new URL(raw);
    return { configured: true, label: `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}，尾号 ${raw.slice(-4)}` };
  } catch {
    return { configured: true, label: `已保存，尾号 ${raw.slice(-4)}` };
  }
}

function sanitizeMihomoSubscriptionUrl(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  let url;
  try {
    url = new URL(text);
  } catch {
    const error = new Error('订阅链接格式不正确');
    error.statusCode = 400;
    throw error;
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    const error = new Error('订阅链接仅支持 http:// 或 https://');
    error.statusCode = 400;
    throw error;
  }
  return url.toString();
}

function ensureMihomoSecret(values) {
  if (values.MIHOMO_CONTROLLER_SECRET) return values.MIHOMO_CONTROLLER_SECRET;
  values.MIHOMO_CONTROLLER_SECRET = randomBytes(24).toString('hex');
  return values.MIHOMO_CONTROLLER_SECRET;
}

function buildMihomoConfig(values) {
  const subscriptionUrl = String(values.MIHOMO_SUBSCRIPTION_URL || '').trim();
  const secret = ensureMihomoSecret(values);
  const providerPath = mihomoProviderFile.replace(/\\/g, '/');
  const providerMode = String(values.MIHOMO_PROVIDER_MODE || '').trim() === 'file' ? 'file' : 'http';
  const useFileProvider = providerMode === 'file' && existsSync(mihomoProviderFile);
  const useHttpProvider = Boolean(subscriptionUrl) && !useFileProvider;
  const useProvider = useFileProvider || useHttpProvider;
  const providerBlock = useProvider ? [
    'proxy-providers:',
    '  subscription:',
    `    type: ${useFileProvider ? 'file' : 'http'}`,
    ...(useHttpProvider ? [
      `    url: ${yamlDouble(subscriptionUrl)}`,
      '    interval: 3600',
    ] : []),
    `    path: ${yamlDouble(providerPath)}`,
    '    health-check:',
    '      enable: true',
    '      interval: 600',
    '      url: https://www.gstatic.com/generate_204',
  ] : ['proxies: []'];
  const groupBlock = useProvider ? [
    'proxy-groups:',
    '  - name: SELECT',
    '    type: select',
    '    proxies:',
    '      - DIRECT',
    '    use:',
    '      - subscription',
  ] : [
    'proxy-groups:',
    '  - name: SELECT',
    '    type: select',
    '    proxies:',
    '      - DIRECT',
  ];
  return [
    'mixed-port: 7890',
    'allow-lan: false',
    'bind-address: 127.0.0.1',
    'mode: rule',
    'log-level: info',
    'profile:',
    '  store-selected: true',
    'external-controller: 127.0.0.1:9097',
    `secret: ${yamlDouble(secret)}`,
    ...providerBlock,
    ...groupBlock,
    'rules:',
    '  - DOMAIN-SUFFIX,worldperatio.com,SELECT',
    '  - DOMAIN-SUFFIX,api.telegram.org,SELECT',
    '  - DOMAIN-SUFFIX,gstatic.com,SELECT',
    '  - MATCH,DIRECT',
    '',
  ].join('\n');
}

function writeMihomoConfig(values) {
  ensureMihomoSecret(values);
  mkdirSync(mihomoConfigDir, { recursive: true });
  mkdirSync(mihomoProviderDir, { recursive: true });
  writeFileSync(mihomoConfigFile, buildMihomoConfig(values), { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(mihomoConfigFile, 0o600);
  } catch {
    // Windows local development can ignore chmod.
  }
}

function normalizeMihomoProviderContent(value = '') {
  const text = String(value || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  if (!text) {
    const error = new Error('订阅内容为空');
    error.statusCode = 400;
    throw error;
  }
  if (Buffer.byteLength(text, 'utf8') > 8 * 1024 * 1024) {
    const error = new Error('订阅内容过大，请使用较小的 Clash/Mihomo 配置');
    error.statusCode = 413;
    throw error;
  }
  if (!/^proxies\s*:/m.test(text)) {
    const error = new Error('订阅内容不是 Clash/Mihomo YAML（未找到 proxies 字段），请使用 Clash/Mihomo 配置订阅或转换后的内容');
    error.statusCode = 400;
    throw error;
  }
  return `${text}\n`;
}

function writeMihomoProviderContent(value = '') {
  mkdirSync(mihomoProviderDir, { recursive: true });
  writeFileSync(mihomoProviderFile, normalizeMihomoProviderContent(value), { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(mihomoProviderFile, 0o600);
  } catch {
    // Windows local development can ignore chmod.
  }
}

function removeMihomoProviderContent() {
  try {
    if (existsSync(mihomoProviderFile)) unlinkSync(mihomoProviderFile);
  } catch (error) {
    logStructured('warn', 'mihomo_provider_remove_failed', { error: redactSecretText(error.message || String(error)) });
  }
}

function runCommand(command, args = [], timeout = 15_000) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout });
  return {
    ok: result.status === 0,
    code: result.status ?? -1,
    stdout: String(result.stdout || '').trim(),
    stderr: redactSecretText(String(result.stderr || '').trim()),
  };
}

function restartMihomoService() {
  if (process.platform === 'win32') return { ok: false, message: '本地 Windows 环境未安装 mihomo systemd 服务' };
  const result = runCommand('systemctl', ['restart', 'mihomo.service'], 30_000);
  if (!result.ok) return { ok: false, message: result.stderr || result.stdout || 'mihomo 重启失败' };
  const active = runCommand('systemctl', ['is-active', 'mihomo.service'], 10_000);
  return { ok: active.ok, message: active.stdout || active.stderr || 'mihomo 状态未知' };
}

async function mihomoControllerRequest(pathname, options = {}) {
  const values = proxySettingsCurrentValues();
  const secret = values.MIHOMO_CONTROLLER_SECRET;
  if (!secret) throw new Error('mihomo 控制密钥未配置');
  const response = await fetch(`${mihomoControllerUrl}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs || 8000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`mihomo controller HTTP ${response.status}: ${text.slice(0, 200)}`);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function mihomoServiceStatus() {
  const installed = Boolean(mihomoBinary && existsSync(mihomoBinary));
  const activeResult = process.platform === 'win32' ? { ok: false, stdout: '' } : runCommand('systemctl', ['is-active', 'mihomo.service'], 10_000);
  const versionResult = installed ? runCommand(mihomoBinary, ['-v'], 10_000) : { ok: false, stdout: '' };
  return {
    installed,
    active: activeResult.stdout === 'active',
    version: versionResult.stdout.split(/\r?\n/)[0] || '',
  };
}

async function getMihomoSettings() {
  const values = proxySettingsCurrentValues();
  const subscription = maskMihomoSubscriptionUrl(values.MIHOMO_SUBSCRIPTION_URL);
  const service = mihomoServiceStatus();
  let controllerOk = false;
  let current = '';
  let nodes = [];
  let error = '';
  try {
    const payload = await mihomoControllerRequest('/proxies');
    const proxies = payload.proxies && typeof payload.proxies === 'object' ? payload.proxies : {};
    const group = proxies.SELECT || proxies.GLOBAL || {};
    const all = Array.isArray(group.all) ? group.all : [];
    current = String(group.now || values.MIHOMO_SELECTED_PROXY || '');
    nodes = all.map((name) => {
      const proxy = proxies[name] || {};
      const history = Array.isArray(proxy.history) ? proxy.history : [];
      const latest = history.at(-1) || {};
      return {
        name,
        type: String(proxy.type || ''),
        udp: Boolean(proxy.udp),
        delay: typeof latest.delay === 'number' ? latest.delay : null,
        alive: latest.meanDelay !== undefined || latest.delay !== undefined ? latest.delay !== 0 : null,
      };
    });
    controllerOk = true;
  } catch (controllerError) {
    error = redactSecretText(controllerError instanceof Error ? controllerError.message : String(controllerError));
  }
  return {
    ok: true,
    ...service,
    controllerOk,
    controllerUrl: mihomoControllerUrl,
    localProxyUrl: mihomoProxyUrl,
    subscriptionConfigured: subscription.configured,
    subscriptionLabel: subscription.label,
    providerMode: values.MIHOMO_PROVIDER_MODE === 'file' ? 'file' : subscription.configured ? 'http' : '',
    current,
    nodes,
    error,
  };
}

async function saveMihomoSubscriptionSettings(input = {}) {
  const values = proxySettingsCurrentValues();
  ensureMihomoSecret(values);
  if (input.clearSubscription) {
    values.MIHOMO_SUBSCRIPTION_URL = '';
    values.MIHOMO_SELECTED_PROXY = '';
    values.MIHOMO_PROVIDER_MODE = '';
    removeMihomoProviderContent();
  }
  if (typeof input.subscriptionUrl === 'string' && input.subscriptionUrl.trim()) {
    values.MIHOMO_SUBSCRIPTION_URL = sanitizeMihomoSubscriptionUrl(input.subscriptionUrl);
    values.MIHOMO_PROVIDER_MODE = 'http';
    removeMihomoProviderContent();
  }
  writeMihomoConfig(values);
  writeProxySettingsEnvValues(values);
  applyProxySettingsProcessEnvValues(values);
  const restart = restartMihomoService();
  await wait(800);
  const status = await getMihomoSettings();
  return { ...status, restarted: restart.ok, message: restart.message, updatedAt: nowISO() };
}

async function importMihomoProviderSettings(input = {}) {
  const content = typeof input.subscriptionContent === 'string' ? input.subscriptionContent : input.content;
  writeMihomoProviderContent(content);
  const values = proxySettingsCurrentValues();
  ensureMihomoSecret(values);
  values.MIHOMO_PROVIDER_MODE = 'file';
  writeMihomoConfig(values);
  writeProxySettingsEnvValues(values);
  applyProxySettingsProcessEnvValues(values);
  const restart = restartMihomoService();
  await wait(800);
  const status = await getMihomoSettings();
  return { ...status, restarted: restart.ok, message: restart.message, imported: true, updatedAt: nowISO() };
}

async function selectMihomoProxy(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) {
    const error = new Error('请选择一个节点');
    error.statusCode = 400;
    throw error;
  }
  await mihomoControllerRequest('/proxies/SELECT', { method: 'PUT', body: { name }, timeoutMs: 10_000 });
  const values = proxySettingsCurrentValues();
  values.MIHOMO_SELECTED_PROXY = name;
  writeProxySettingsEnvValues(values);
  applyProxySettingsProcessEnvValues(values);
  const status = await getMihomoSettings();
  return { ...status, selected: name, updatedAt: nowISO() };
}

async function testMihomoProxy() {
  const { ProxyAgent } = require('undici');
  const dispatcher = new ProxyAgent(mihomoProxyUrl);
  const targets = [
    { id: 'brief-pe', label: '简报 PE 数据源', url: 'https://www.worldperatio.com/' },
    { id: 'telegram', label: 'Telegram API', url: 'https://api.telegram.org/' },
  ];
  const results = [];
  for (const target of targets) {
    const startedAt = Date.now();
    try {
      const response = await fetch(target.url, {
        dispatcher,
        signal: AbortSignal.timeout(15_000),
        headers: { 'user-agent': 'exam-planner-mihomo-test/1.0' },
      });
      const text = await response.text();
      results.push({
        id: target.id,
        label: target.label,
        ok: response.ok,
        status: response.status,
        durationMs: Date.now() - startedAt,
        sample: text.slice(0, 120),
      });
    } catch (error) {
      results.push({
        id: target.id,
        label: target.label,
        ok: false,
        status: 0,
        durationMs: Date.now() - startedAt,
        error: redactSecretText(error instanceof Error ? error.message : String(error)),
      });
    }
  }
  return { ok: results.every((result) => result.ok), testedAt: nowISO(), results };
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

async function getBriefWeatherBackup(settings, fallbackReason) {
  const url = `https://wttr.in/~${encodeURIComponent(settings.latitude)},${encodeURIComponent(settings.longitude)}?format=j1`;
  const data = await fetchJsonWithFallback(url, 10000);
  const current = data.current_condition?.[0] || {};
  const todayForecast = data.weather?.[0] || {};
  const hourly = todayForecast.hourly?.[0] || {};
  return {
    ok: true,
    cityName: settings.cityName,
    temperature: Number(current.temp_C ?? 0),
    humidity: Number(current.humidity ?? 0),
    windSpeed: Number(current.windspeedKmph ?? 0),
    precipitation: Number(current.precipMM ?? 0),
    weatherCode: Number(current.weatherCode ?? 0),
    condition: current.weatherDesc?.[0]?.value?.trim() || '天气数据已获取',
    maxTemperature: Number(todayForecast.maxtempC ?? current.temp_C ?? 0),
    minTemperature: Number(todayForecast.mintempC ?? current.temp_C ?? 0),
    precipitationProbability: Number(hourly.chanceofrain ?? 0),
    source: 'wttr.in',
    fallbackReason,
  };
}

async function getBriefWeather(settings) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(settings.latitude)}&longitude=${encodeURIComponent(settings.longitude)}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FShanghai&forecast_days=1`;
  try {
    const data = await fetchJsonWithFallback(url);
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
      source: 'open-meteo',
    };
  } catch (error) {
    const primaryMessage = error instanceof Error ? error.message : String(error);
    try {
      return await getBriefWeatherBackup(settings, primaryMessage);
    } catch (backupError) {
      const backupMessage = backupError instanceof Error ? backupError.message : String(backupError);
      return { ok: false, cityName: settings.cityName, error: `${primaryMessage}; wttr fallback: ${backupMessage}` };
    }
  }
}

async function getBriefMarket(symbolItem) {
  const fromCrypto = await getCryptoMarket(symbolItem);
  if (fromCrypto) return fromCrypto;
  const fromWscn = await getWscnMarket(symbolItem);
  if (fromWscn) return fromWscn;
  const fromEastMoney = await getEastMoneyMarket(symbolItem);
  if (fromEastMoney) return fromEastMoney;
  const fromTradingView = await getTradingViewMarket(symbolItem);
  if (fromTradingView) return fromTradingView;
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

async function getIndexPurchaseAssessment({ name, symbol, slug }) {
  try {
    const url = `https://worldperatio.com/index/${slug}/`;
    let result;
    try {
      result = await externalApiClient.text(url, {
        timeoutMs: 20000,
        retries: 1,
        freshMs: 60 * 60 * 1000,
        staleMs: 24 * 60 * 60 * 1000,
        cacheKey: `pe:${slug}`,
      });
    } catch {
      result = { value: fetchTextWithProxyCurl(url, 45), cacheStatus: 'proxy', fetchedAt: nowISO() };
    }
    const metrics = parseWorldPeRatio(result.value);
    return {
      ok: true,
      name,
      symbol,
      asOf: metrics.asOf,
      source: 'World P/E Ratio',
      cacheStatus: result.cacheStatus,
      fetchedAt: result.fetchedAt,
      ...metrics,
      ...scoreIndexPurchaseAssessment(metrics),
    };
  } catch (error) {
    return { ok: false, name, symbol, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getIndexPurchaseAssessments() {
  const items = await Promise.all([
    getIndexPurchaseAssessment({ name: '纳指 100', symbol: '^NDX', slug: 'nasdaq-100' }),
    getIndexPurchaseAssessment({ name: '标普 500', symbol: '^GSPC', slug: 'sp-500' }),
  ]);
  return {
    methodology: '基于当前 PE 的近 5 年与近 10 年历史百分位，以及价格相对 50/200 日均线的位置进行平滑评分。',
    disclaimer: '仅作为长期定投节奏参考，不构成投资建议；避免一次性重仓，并结合自身现金流与风险承受能力。',
    items,
  };
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
  const globalMap = {
    '^IXIC': '100.NDX',
    '^NDX': '100.NDX',
    NDX: '100.NDX',
    '^GSPC': '100.SPX',
    '^SPX': '100.SPX',
    SPX: '100.SPX',
    '^N225': '100.N225',
    '^NIKKEI': '100.N225',
    NIKKEI: '100.N225',
    '^HSI': '100.HSI',
    HSI: '100.HSI',
    '^VN30': '100.VNINDEX',
    VN30: '100.VNINDEX',
    'VN30.VN': '100.VNINDEX',
    '^VNI': '100.VNINDEX',
    VNINDEX: '100.VNINDEX',
  };
  if (globalMap[value]) return globalMap[value];
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
    const isVietnamProxy = ['^VN30', 'VN30', 'VN30.VN'].includes(String(symbolItem.symbol || '').toUpperCase().trim());
    return {
      ok: true,
      name: isVietnamProxy
        ? `${symbolItem.name || '越南VN30'} (VNINDEX proxy)`
        : symbolItem.name || quote.f58 || symbolItem.symbol,
      symbol: symbolItem.symbol,
      price: Number(current.toFixed(2)),
      change: Number(change.toFixed(2)),
      changePercent: Number(changePercent.toFixed(2)),
      currency: /^\d{6}\.(SS|SH|SZ)$/i.test(String(symbolItem.symbol || '')) ? 'CNY' : '',
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

function getDailyBriefLearningSummary(date) {
  const yesterday = addDaysISO(date, -1);
  const activeGoal = sqliteJson(`SELECT name, deadline FROM goals WHERE is_active = 1 ORDER BY id LIMIT 1;`)[0] || null;
  const yesterdayReview = sqliteJson(`SELECT date, summary, wins, problems, tomorrow_plan AS tomorrowPlan, score
FROM daily_reviews WHERE date = ${sqlString(yesterday)} LIMIT 1;`).map(normalizeReview)[0] || null;
  const todayTasks = sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency, is_completed AS isCompleted,
reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt
FROM short_term_tasks
WHERE due_date <= ${sqlString(date)} AND is_completed = 0
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date, due_time, id
LIMIT 8;`).map(normalizeTaskRow);
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

async function generateDailyBrief({ date = todayISO(), trigger = 'manual', sendEmail = false, sendWechat = false } = {}) {
  const settings = getDailyBriefSettings({ includeSecret: true });
  const generatedAt = nowISO();
  const marketSymbols = parseMarketSymbols(settings.marketSymbolsText).slice(0, 12);
  const [weather, markets, indexPurchaseAssessment] = await Promise.all([
    getBriefWeather(settings),
    Promise.all(marketSymbols.map(getBriefMarket)),
    getIndexPurchaseAssessments(),
  ]);
  const payload = {
    date,
    title: dailyBriefTitle(date),
    generatedAt,
    trigger,
    weather,
    markets,
    indexPurchaseAssessment,
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
  let wechatDelivery = null;
  let wechatError = '';

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
  const brief = getDailyBriefByDate(date);
  if (sendWechat || (trigger === 'auto' && settings.wechat.enabled)) {
    const digest = buildClawbotDailyDigest(date);
    wechatDelivery = queueProactiveNotification({
      eventKey: `brief:${date}`,
      source: 'brief',
      title: payload.title,
      content: '每日简报已进入微信主动推送队列。',
      text: digest.text,
      payload: { date, trigger },
    });
    logStructured('info', 'daily_brief_wechat_queued', {
      date,
      trigger,
      deliveryId: wechatDelivery.deliveryId,
    });
  }
  const warningText = [emailError ? `邮件推送失败：${emailError}` : '', wechatError ? `微信推送失败：${wechatError}` : ''].filter(Boolean).join('；');
  notifyEvent({
    eventKey: `brief:${date}`,
    source: 'brief',
    severity: warningText ? 'warning' : 'info',
    title: payload.title,
    content: warningText ? `每日简报已生成，但${warningText}` : '每日简报已生成，可在通知中心查看。',
    payload: {
      date,
      trigger,
      emailedAt,
      emailError,
      wechatPushed: Boolean(wechatDelivery?.ok),
      wechatError,
      wechatDelivery: wechatDelivery ? {
        method: wechatDelivery.method || '',
        channel: wechatDelivery.channel || '',
        messageId: wechatDelivery.messageId || null,
        response: wechatDelivery.response || null,
      } : null,
    },
  });
  return brief;
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
        await runExclusiveTask('daily-brief', 'auto', () => generateDailyBrief({ date: todayISO(), trigger: 'auto', sendEmail: true, sendWechat: true }), { timeoutMs: 4 * 60 * 1000 });
      }
    } catch (error) {
      logStructured('error', 'daily_brief_failed', { error: redactSecretText(error.message || String(error)) });
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

function dailyBriefStudyPushHtml(learning = {}) {
  const tasks = Array.isArray(learning.todayTasks) ? learning.todayTasks : [];
  const themes = Array.isArray(learning.topErrorThemes) ? learning.topErrorThemes : [];
  const yesterdayMinutes = Number(learning.yesterdayMinutes || 0);
  const items = [];
  if (learning.activeGoal?.daysLeft != null) {
    items.push(`距离「${learning.activeGoal.name}」还有 ${learning.activeGoal.daysLeft} 天，今天至少完成一个能推进长期目标的硬任务。`);
  }
  if (learning.yesterdayReview?.tomorrowPlan) {
    items.push(`优先执行昨日写给今天的计划：${compactText(learning.yesterdayReview.tomorrowPlan, 90)}`);
  }
  if (tasks.length) {
    items.push(`今天有 ${tasks.length} 个待推进短期目标，先从最紧急的一项开始，不要等到晚上再补。`);
  }
  if (yesterdayMinutes < 180) {
    items.push('昨日学习时长偏少，今天先用一个 30 分钟启动块把状态拉起来。');
  } else {
    items.push(`昨日已学习 ${minutesText(yesterdayMinutes)}，今天的重点是延续节奏，而不是重新找感觉。`);
  }
  if (themes[0]) {
    items.push(`近期高频问题是「${themes[0].label}」，今天学习时专门留意这个坑，结束后在复盘里写清楚是否改善。`);
  }
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function dailyBriefHtml(payload) {
  const weather = payload.weather || {};
  const markets = payload.markets || [];
  const indexPurchaseAssessment = payload.indexPurchaseAssessment || {};
  const assessmentRows = (indexPurchaseAssessment.items || []).map((item) => item.ok
    ? `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.signal)}</td><td>${escapeHtml(item.pe)}（5 年 ${escapeHtml(item.pePercentile5)}% / 10 年 ${escapeHtml(item.pePercentile10)}%）</td><td>${escapeHtml(item.sma50Margin)}% / ${escapeHtml(item.sma200Margin)}%</td><td>${escapeHtml(item.intensity)}</td></tr>`
    : `<tr><td>${escapeHtml(item.name)}</td><td colspan="4">评估失败：${escapeHtml(item.error || '')}</td></tr>`).join('');
  const learning = payload.learning || {};
  const taskItems = (learning.todayTasks || []).map((task) => `<li>${escapeHtml(task.title)} <span style="color:#64748b">(${escapeHtml(task.urgency)} / ${escapeHtml(task.dueTime ? `${task.dueDate} ${task.dueTime}` : task.dueDate)})</span></li>`).join('');
  const marketRows = markets.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.symbol)}</td><td>${item.ok ? escapeHtml(item.price) : '失败'}</td><td style="color:${Number(item.changePercent || 0) >= 0 ? '#16a34a' : '#dc2626'}">${item.ok ? `${escapeHtml(item.changePercent)}%` : escapeHtml(item.error || '')}</td></tr>`).join('');
  const studyPush = dailyBriefStudyPushHtml(learning);
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;line-height:1.6">
  <h1>${escapeHtml(payload.title)}</h1>
  <p style="color:#64748b">生成时间：${escapeHtml(new Date(payload.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))}</p>
  <h2>天气</h2>
  <p>${escapeHtml(weather.cityName || '')}：${weather.ok ? `${escapeHtml(weather.condition)}，${escapeHtml(weather.temperature)}℃，${escapeHtml(weather.minTemperature)}-${escapeHtml(weather.maxTemperature)}℃，降水概率 ${escapeHtml(weather.precipitationProbability)}%` : `获取失败：${escapeHtml(weather.error || '')}`}</p>
  <h2>学习提醒</h2>
  <p>昨日学习：${Math.round(Number(learning.yesterdayMinutes || 0) / 60 * 10) / 10} 小时；近 7 天累计：${Math.round(Number(learning.last7Minutes || 0) / 60 * 10) / 10} 小时。</p>
  <h2>今日学习督促</h2>
  ${studyPush}
  ${learning.yesterdayReview ? `<p><strong>昨日问题：</strong>${escapeHtml(learning.yesterdayReview.problems || '未填写')}</p>` : '<p>昨日尚未填写复盘。</p>'}
  ${taskItems ? `<p><strong>今日待推进：</strong></p><ul>${taskItems}</ul>` : '<p>今日暂无到期短期目标。</p>'}
  <h2>指数与资产</h2>
  <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;border-color:#e2e8f0"><thead><tr><th>名称</th><th>代码</th><th>最新</th><th>涨跌</th></tr></thead><tbody>${marketRows || '<tr><td colspan="4">暂无配置</td></tr>'}</tbody></table>
  <h2>纳指 100 / 标普 500 定投评估</h2>
  <p>${escapeHtml(indexPurchaseAssessment.methodology || '')}</p>
  <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;border-color:#e2e8f0"><thead><tr><th>指数</th><th>结论</th><th>PE</th><th>距 50/200 日均线</th><th>定投强度参考</th></tr></thead><tbody>${assessmentRows || '<tr><td colspan="5">暂无评估数据</td></tr>'}</tbody></table>
  <p style="color:#64748b">${escapeHtml(indexPurchaseAssessment.disclaimer || '')}</p>
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

function getCachedErrorThemeAnalysis(periodStart = '1900-01-01', periodEnd = todayISO()) {
  const from = periodStart || '1900-01-01';
  const to = periodEnd || todayISO();
  const cacheKey = `error-themes:${from}:${to}`;
  const cached = getPrecomputedCache(cacheKey);
  if (cached) return cached;
  return setPrecomputedCache(cacheKey, getErrorThemeAnalysis(from, to));
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
  notifyEvent({
    eventKey: `report:${report.kind}:${report.periodStart}:${report.periodEnd}`,
    source: 'report',
    severity: 'info',
    title: report.title,
    content: `${report.periodStart} 至 ${report.periodEnd} 的${report.kind === 'monthly' ? '月报' : '周报'}已生成。`,
    payload: { kind: report.kind, periodStart: report.periodStart, periodEnd: report.periodEnd, trigger: report.trigger },
  });
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

function ensureAutomaticReports({ includeCurrent = true } = {}) {
  const today = todayISO();
  for (const kind of ['weekly', 'monthly']) {
    const periods = [previousPeriod(kind, today)];
    if (includeCurrent) periods.push(currentPeriod(kind, today));
    for (const { periodStart, periodEnd } of periods) {
      if (includeCurrent || !reportExists(kind, periodStart, periodEnd)) {
        generateLearningReport(kind, periodStart, periodEnd, 'auto');
      }
    }
  }
  runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_report_check_at', ${sqlString(nowISO())}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
}

async function precomputeNightlyArtifacts(trigger = 'nightly') {
  const today = todayISO();
  const timestamp = nowISO();
  try {
    await runErrorThemeBatch('1900-01-01', today, { mode: 'rules', modelProfile: 'rules' });
    ensureAutomaticReports({ includeCurrent: true });
    for (const days of [7, 30, 90]) {
      const from = days === 90 ? '1900-01-01' : addDaysISO(today, -(days - 1));
      setPrecomputedCache(`error-themes:${from}:${today}`, getErrorThemeAnalysis(from, today));
    }
    setPrecomputedCache(`review-trend:30:${today}`, getReviewTrendPayload(30, today));
    setPrecomputedCache(`review-trend:90:${today}`, getReviewTrendPayload(90, today));
    setPrecomputedCache(`dashboard-error-wall:${today}`, { items: getErrorThemeWall(12, 90, today) });
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_precompute_at', ${sqlString(timestamp)}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_precompute_trigger', ${sqlString(trigger)}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_precompute_error', '', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
    return { ok: true, ranAt: timestamp };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_precompute_error', ${sqlString(message)}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
    return { ok: false, ranAt: timestamp, error: message };
  }
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
  assertDiskSpace();
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, `-${Date.now() % 1000}Z`);
  const filePath = join(backupsDir, `exam-planner-${kind}-${timestamp}.sqlite`);
  let libraryArchivePath = null;
  runSqlite('PRAGMA wal_checkpoint(TRUNCATE);');
  if (existsSync(filePath)) unlinkSync(filePath);
  runSqlite(`VACUUM INTO ${sqlitePath(filePath)};`);
  const integrity = runSqliteFile(filePath, 'PRAGMA integrity_check;').trim();
  if (integrity !== 'ok') {
    try {
      unlinkSync(filePath);
    } catch {
      // Ignore cleanup failure; the integrity error below is the useful signal.
    }
    throw new Error(`Backup integrity check failed: ${integrity}`);
  }
  if (existsSync(libraryFilesDir)) {
    libraryArchivePath = join(backupsDir, `exam-planner-${kind}-${timestamp}-library.tar.gz`);
    const archiveResult = spawnSync('tar', ['-czf', libraryArchivePath, '-C', libraryDir, 'files'], { encoding: 'utf8', timeout: 5 * 60 * 1000 });
    if (archiveResult.status !== 0) {
      libraryArchivePath = null;
    }
  }
  runSqlite(`INSERT INTO backup_log (kind, file_path, created_at, note)
VALUES (${sqlString(kind)}, ${sqlString(filePath)}, datetime('now'), ${sqlString(note)});`);
  backupVerificationCache = { ok: true, checkedAt: nowISO(), fileName: filePath.split(/[\\/]/).pop() || '', integrity: 'ok' };
  if (kind === 'weekly') {
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_weekly_backup_at', ${sqlString(nowISO())}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  }
  if (kind === 'daily') {
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_daily_backup_at', ${sqlString(nowISO())}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  }
  return { kind, filePath, libraryArchivePath, createdAt: nowISO() };
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
  const sourceFile = resolveBackupPath(backupsDir, fileName);
  if (!existsSync(sourceFile)) {
    throw new Error('Backup file not found');
  }
  const integrity = runSqliteFile(sourceFile, 'PRAGMA integrity_check;').trim();
  if (integrity !== 'ok') {
    throw new Error(`Backup integrity check failed: ${integrity}`);
  }

  const safetyBackup = createBackupFile('pre-restore', `automatic safety backup before restoring ${fileName}`);
  runSqlite('PRAGMA wal_checkpoint(TRUNCATE);');
  copyFileSync(sourceFile, sqliteFile);
  const libraryArchivePath = join(backupsDir, fileName.replace(/\.sqlite$/, '-library.tar.gz'));
  if (existsSync(libraryArchivePath) && libraryArchivePath.startsWith(backupsDir)) {
    if (existsSync(libraryFilesDir)) rmSync(libraryFilesDir, { recursive: true, force: true });
    mkdirSync(libraryDir, { recursive: true });
    const restoreArchive = spawnSync('tar', ['-xzf', libraryArchivePath, '-C', libraryDir], { encoding: 'utf8', timeout: 5 * 60 * 1000 });
    if (restoreArchive.status !== 0) {
      throw new Error(`Library archive restore failed: ${restoreArchive.stderr || restoreArchive.stdout}`);
    }
  }
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

function cleanupDailyBackups(keepCount = 14) {
  if (!existsSync(backupsDir)) return;
  const dailyBackups = readdirSync(backupsDir)
    .filter((name) => /^exam-planner-daily-.*\.sqlite$/.test(name))
    .sort()
    .reverse();
  for (const name of dailyBackups.slice(keepCount)) {
    try {
      unlinkSync(join(backupsDir, name));
    } catch {
      // A stale backup failing to delete should not block the app.
    }
  }
}

function ensureDailyBackup() {
  const lastBackupAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_daily_backup_at' LIMIT 1;");
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (!lastBackupAt || Date.now() - new Date(lastBackupAt).getTime() >= oneDayMs) {
    createBackupFile('daily', 'automatic daily backup');
    cleanupDailyBackups();
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

function latestBackupVerification(backups = [], { force = false } = {}) {
  const latest = backups.find((backup) => backup.kind === 'manual' || backup.kind === 'daily' || backup.kind === 'weekly') || backups[0];
  if (!latest) return { ok: false, checkedAt: nowISO(), fileName: '', integrity: 'missing' };
  const cacheFreshMs = 6 * 60 * 60 * 1000;
  if (!force && backupVerificationCache?.fileName === latest.fileName && Date.now() - new Date(backupVerificationCache.checkedAt).getTime() < cacheFreshMs) {
    return backupVerificationCache;
  }
  if (!force) return backupVerificationCache?.fileName === latest.fileName ? backupVerificationCache : { ok: null, checkedAt: '', fileName: latest.fileName, integrity: 'not_checked' };
  try {
    const integrity = runSqliteFile(join(backupsDir, latest.fileName), 'PRAGMA integrity_check;').trim();
    backupVerificationCache = { ok: integrity === 'ok', checkedAt: nowISO(), fileName: latest.fileName, integrity };
    return backupVerificationCache;
  } catch (error) {
    backupVerificationCache = { ok: false, checkedAt: nowISO(), fileName: latest.fileName, integrity: redactSecretText(error.message || String(error)) };
    return backupVerificationCache;
  }
}

function getBackupStatus({ verifyLatest = false } = {}) {
  ensureSqliteStore();
  const backups = listBackupFiles();
  const backupRows = sqliteJson(`SELECT kind, file_path AS filePath, created_at AS createdAt, note
FROM backup_log
ORDER BY datetime(created_at) DESC
LIMIT 1;`);
  const dictionaryCount = Number(sqliteScalar('SELECT COUNT(*) FROM dictionary_entries;') || 0);
  const lastWeeklyBackupAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_weekly_backup_at' LIMIT 1;");
  const lastDailyBackupAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_daily_backup_at' LIMIT 1;");
  const dictionaryIndexedAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'dictionary_indexed_at' LIMIT 1;");
  return {
    storage: 'sqlite-tables',
    sqliteFile,
    sqliteSizeBytes: existsSync(sqliteFile) ? statSync(sqliteFile).size : 0,
    backupCount: backups.length,
    backups,
    lastBackup: backupRows[0] || null,
    latestVerification: latestBackupVerification(backups, { force: verifyLatest }),
    lastDailyBackupAt: lastDailyBackupAt || null,
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

function nextDailyBackupAt() {
  const lastDailyBackupAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_daily_backup_at' LIMIT 1;");
  if (!lastDailyBackupAt) return nowISO();
  const next = new Date(new Date(lastDailyBackupAt).getTime() + 24 * 60 * 60 * 1000);
  return next.toISOString();
}

function chinaWallClockDelay(timeText = '03:20') {
  const [hourText, minuteText] = String(timeText || '03:20').split(':');
  const hour = Math.max(0, Math.min(23, Number(hourText) || 3));
  const minute = Math.max(0, Math.min(59, Number(minuteText) || 20));
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
  return { delay: Math.max(60 * 1000, targetUtcMs - now.getTime()), nextAt: new Date(targetUtcMs).toISOString() };
}

function runSqliteMaintenance(kind = 'manual') {
  ensureSqliteStore();
  const ranAt = nowISO();
  try {
    runSqlite(`DELETE FROM visit_events WHERE substr(created_at, 1, 10) < ${sqlString(addDaysISO(todayISO(), -180))};`);
    runSqlite('PRAGMA optimize;\nANALYZE;');
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_sqlite_maintenance_at', ${sqlString(ranAt)}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_sqlite_maintenance_kind', ${sqlString(kind)}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_sqlite_maintenance_error', '', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
    return { ok: true, ranAt, kind };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_sqlite_maintenance_error', ${sqlString(message)}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
    return { ok: false, ranAt, kind, error: message };
  }
}

function scheduleDailyMaintenance() {
  const { delay, nextAt } = chinaWallClockDelay('03:20');
  nextMaintenanceAt = nextAt;
  setTimeout(async () => {
    try {
      await runExclusiveTask('nightly-maintenance', 'nightly', async () => {
        ensureDailyBackup();
        ensureWeeklyBackup();
        await precomputeNightlyArtifacts('nightly');
        runSqliteMaintenance('nightly');
        getDashboardPayload('write');
        getStatisticsSummary();
        return { ok: true };
      }, { timeoutMs: 30 * 60 * 1000 });
    } catch (error) {
      logStructured('error', 'nightly_maintenance_failed', { error: redactSecretText(error.message || String(error)) });
    } finally {
      scheduleDailyMaintenance();
    }
  }, delay).unref();
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

function getHealthPayload() {
  const checks = [];
  let ok = true;
  const addCheck = (name, status, detail = {}) => {
    if (status !== 'ok') ok = false;
    checks.push({ name, status, ...detail });
  };
  try {
    ensureSqliteStore();
    const probe = sqliteScalar('SELECT 1;');
    addCheck('sqlite', Number(probe) === 1 ? 'ok' : 'error', { probe: Number(probe) });
  } catch (error) {
    addCheck('sqlite', 'error', { error: redactSecretText(error.message || String(error)) });
  }
  try {
    const disk = getDiskStatus();
    addCheck('disk', !disk || disk.availableBytes >= minFreeDiskBytes ? 'ok' : 'warn', { disk });
  } catch (error) {
    addCheck('disk', 'error', { error: redactSecretText(error.message || String(error)) });
  }
  try {
    const backup = getBackupStatus();
    const backupStatus = !backup.lastBackup || backup.latestVerification?.ok === false ? 'warn' : 'ok';
    addCheck('backup', backupStatus, {
      backupCount: backup.backupCount,
      lastBackupAt: backup.lastBackup?.createdAt ?? null,
      latestVerification: backup.latestVerification,
    });
  } catch (error) {
    addCheck('backup', 'error', { error: redactSecretText(error.message || String(error)) });
  }
  addCheck('tasks', activeTaskLocks.size ? 'warn' : 'ok', { active: Array.from(activeTaskLocks) });
  const externalApis = externalApiClient.status();
  addCheck('external-api', externalApis.openCircuits.length ? 'warn' : 'ok', {
    openCircuitCount: externalApis.openCircuits.length,
  });
  const unified = summarizeHealth(checks.map((check) => ({
    id: check.name,
    title: check.name,
    status: check.status === 'error' ? 'failed' : check.status === 'warn' ? 'degraded' : 'normal',
    action: check.status === 'ok' ? '' : `检查 ${check.name} 状态并处理异常。`,
  })));
  return {
    ok,
    status: ok ? 'ok' : 'degraded',
    unified,
    generatedAt: nowISO(),
    version: process.env.npm_package_version || '0.0.0',
    runtime: getRuntimeStatus(),
    externalApis,
    checks,
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
  const lastMaintenanceAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_sqlite_maintenance_at' LIMIT 1;") || null;
  const lastMaintenanceKind = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_sqlite_maintenance_kind' LIMIT 1;") || null;
  const lastMaintenanceError = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_sqlite_maintenance_error' LIMIT 1;") || '';
  const lastPrecomputeAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_precompute_at' LIMIT 1;") || null;
  const lastPrecomputeTrigger = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_precompute_trigger' LIMIT 1;") || null;
  const lastPrecomputeError = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_precompute_error' LIMIT 1;") || '';
  const taskMetrics = (() => {
    try {
      return taskRunsRepository.getMetrics();
    } catch {
      return { total: 0, running: 0, completed: 0, failed: 0, last24h: 0, averageDurationMs: null, maxDurationMs: null, byName: [] };
    }
  })();
  return {
    generatedAt: nowISO(),
    backup: {
      ...getBackupStatus(),
      nextDailyBackupAt: nextDailyBackupAt(),
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
      taskReminders: getDailyBriefSettings({ includeSecret: true }).taskReminders,
      nextTaskReminderScanAt,
    },
    errorThemes: {
      job: currentErrorThemeJobSnapshot(),
      latestBatch,
      nextNightlyBatchAt: nextNightlyErrorThemeAt,
      correctionCount: Number(corrections.count || 0),
      lastCorrectionAt: corrections.lastUpdatedAt || null,
    },
    embedding: { ...getEmbeddingStatus(), embeddingRows },
    maintenance: {
      lastAt: lastMaintenanceAt,
      lastKind: lastMaintenanceKind,
      lastError: lastMaintenanceError,
      nextMaintenanceAt,
      lastPrecomputeAt,
      lastPrecomputeTrigger,
      lastPrecomputeError,
    },
    data: {
      reviews: reviewRows,
      studyTimeRecords: studyRows,
      revision: dataRevision,
    },
    tasks: {
      active: Array.from(activeTaskLocks),
      latestRuns: lastTaskRuns(12),
      metrics: taskMetrics,
    },
    runtime: getRuntimeStatus(),
    unifiedHealth: getHealthPayload().unified,
    externalApis: externalApiClient.status(),
  };
}

function runStructuredMigrations() {
  const currentVersion = Number(sqliteScalar("SELECT value FROM app_metadata WHERE key = 'structured_schema_version' LIMIT 1;") || 0);
  const applied = runSqlMigrations({
    sqlite: sqliteRepository,
    migrationsDir,
    currentVersion,
    setVersion: (version) => runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('structured_schema_version', ${sqlString(String(version))}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`),
  });
  if (applied.length) {
    logStructured('info', 'sqlite_migrations_applied', { applied });
  }
}

function ensureTaskReminderColumns() {
  const existing = new Set(sqliteJson('PRAGMA table_info(short_term_tasks);').map((column) => column.name));
  const columns = [
    ['due_time', "TEXT NOT NULL DEFAULT ''"],
    ['reminder_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['reminder_sent_offsets', "TEXT NOT NULL DEFAULT '[]'"],
    ['reminder_last_sent_at', 'TEXT'],
  ];
  for (const [name, definition] of columns) {
    if (!existing.has(name)) runSqlite(`ALTER TABLE short_term_tasks ADD COLUMN ${name} ${definition};`);
  }
  runSqlite('CREATE INDEX IF NOT EXISTS idx_short_term_tasks_due_time ON short_term_tasks(is_completed, due_date, due_time);');
}

function notifyEvent(payload) {
  try {
    notificationRepository.upsertEvent(payload);
  } catch (error) {
    logStructured('warn', 'notification_event_failed', { error: redactSecretText(error.message || String(error)), eventKey: payload?.eventKey });
  }
}

function getNotificationCenterPayload(sessionRole, { status = 'all' } = {}) {
  ensureSqliteStore();
  const wechatClawbot = resolveOpenClawWechatConfig();
  const storedChannels = notificationRepository.listChannels();
  const channels = storedChannels.some((channel) => channel.channelKey === 'clawbot_weixin') ? storedChannels : [
    ...storedChannels,
    {
      id: 0,
      channelKey: 'clawbot_weixin',
      type: 'clawbot_weixin',
      name: '微信 ClawBot',
      enabled: wechatClawbot.enabled && wechatClawbot.configured,
      config: { scheduleTime: wechatClawbot.scheduleTime },
      createdAt: nowISO(),
      updatedAt: nowISO(),
    },
  ];
  return {
    generatedAt: nowISO(),
    channels,
    channelReadiness: channels.map((channel) => ({
      channelKey: channel.channelKey,
      type: channel.type,
      ...notificationChannelReadiness(channel),
    })),
    events: notificationRepository.listEvents({ status, limit: 80 }),
    deliveries: notificationRepository.listDeliveries(80),
    metrics: notificationRepository.metrics(),
    wechatClawbot,
    bark: resolveBarkConfig(),
    telegram: telegramConfigStatus(readTelegramConfig(telegramEnvFile)),
    notificationSemantics: {
      reply: '收到微信指令后在同一会话中即时回复，不进入主动通知队列。',
      proactive: '日报、待办提醒和测试消息先进入持久化队列，失败后自动重试并站内兜底。',
    },
    readOnly: sessionRole === 'read',
    channelPlan: {
      clawbotWeixin: {
        enabled: wechatClawbot.enabled && wechatClawbot.configured,
        requiredEnv: ['OPENCLAW_CLAWBOT_CHANNEL', 'OPENCLAW_CLAWBOT_ACCOUNT', 'OPENCLAW_CLAWBOT_TARGET'],
        method: 'openclaw message send via local OpenClaw gateway',
      },
      bark: {
        enabled: Boolean(process.env.BARK_DEVICE_KEY),
        requiredEnv: ['BARK_DEVICE_KEY'],
        method: 'POST Bark API V2 /push',
      },
      telegram: {
        enabled: telegramConfigStatus(readTelegramConfig(telegramEnvFile)).configured,
        requiredEnv: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_ALLOWED_USER_ID'],
        method: 'POST https://api.telegram.org/bot<token>/sendMessage',
      },
      wecomWebhook: {
        enabled: Boolean(process.env.WECOM_WEBHOOK_URL),
        requiredEnv: ['WECOM_WEBHOOK_URL'],
        method: 'POST webhook URL with msgtype text/markdown',
      },
      genericWebhook: {
        enabled: Boolean(process.env.NOTIFICATION_WEBHOOK_URL),
        requiredEnv: ['NOTIFICATION_WEBHOOK_URL'],
        method: 'POST JSON payload for claw or other relay services',
      },
    },
  };
}

function getCalendarPayload(sessionRole, { from, to } = {}) {
  ensureSqliteStore();
  return {
    generatedAt: nowISO(),
    from,
    to,
    events: calendarRepository.getEvents({ from, to }),
    readOnly: sessionRole === 'read',
  };
}

function collectOperationalNotifications() {
  try {
    const status = getHealthPayload();
    const disk = status.checks?.find?.((check) => check.name === 'disk')?.detail?.disk;
    if (disk && disk.availableBytes < minFreeDiskBytes) {
      notifyEvent({
        eventKey: `ops:disk:${todayISO()}`,
        source: 'ops',
        severity: 'warning',
        title: '服务器磁盘空间预警',
        content: `可用空间低于阈值，当前剩余 ${Math.round(disk.availableBytes / 1024 / 1024)} MB。`,
        payload: { disk },
      });
    }
    const taskMetrics = taskRunsRepository.getMetrics();
    if (taskMetrics.failed > 0) {
      notifyEvent({
        eventKey: `ops:task-failed:${todayISO()}`,
        source: 'ops',
        severity: 'warning',
        title: '后台任务存在失败记录',
        content: `任务中心累计失败 ${taskMetrics.failed} 次，建议查看后台任务控制台。`,
        payload: { metrics: taskMetrics },
      });
    }
    const apiMetrics = opsRepository.getApiMetrics?.();
    if (apiMetrics?.serverErrors > 0) {
      notifyEvent({
        eventKey: `ops:api-error:${todayISO()}`,
        source: 'ops',
        severity: 'warning',
        title: '接口错误需要关注',
        content: `请求日志中存在 ${apiMetrics.serverErrors} 个服务端错误。`,
        payload: { apiMetrics },
      });
    }
  } catch (error) {
    logStructured('warn', 'collect_operational_notifications_failed', { error: redactSecretText(error.message || String(error)) });
  }
}

function marketCopilotNewYorkParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}`,
  };
}

function marketCopilotSlotForTime(time) {
  if (time === '09:05') return { reportType: 'preopen', marketStatus: '盘前' };
  if (time === '09:35') return { reportType: 'open-5m', marketStatus: '开盘后 5 分钟' };
  if (time === '09:45') return { reportType: 'open-15m', marketStatus: '开盘后 15 分钟' };
  if (time === '10:00') return { reportType: 'open-30m', marketStatus: '开盘后 30 分钟' };
  if (time === '16:15') return { reportType: 'postclose', marketStatus: '收盘后' };
  return null;
}

async function runMarketCopilotScheduleTick() {
  try {
    ensureSqliteStore();
    const ny = marketCopilotNewYorkParts();
    const slot = marketCopilotSlotForTime(ny.time);
    if (!slot) return;
    const session = marketCopilotRepository.marketSessionForDate(ny.date);
    if (!session.isTradingDay) return;
    const reportKey = `${ny.date}-${slot.reportType}`;
    if (marketCopilotRepository.getReportByKey(reportKey)) return;
    await marketCopilotRepository.refreshMarketData();
    marketCopilotRepository.generateReport({ ...slot, reportKey });
  } catch (error) {
    logStructured('warn', 'market_copilot_schedule_failed', { error: redactSecretText(error.message || String(error)) });
  }
}

function startMarketCopilotScheduler() {
  if (marketCopilotTimerStarted) return;
  marketCopilotTimerStarted = true;
  setInterval(() => void runMarketCopilotScheduleTick(), 60 * 1000);
  setTimeout(() => void runMarketCopilotScheduleTick(), 15 * 1000);
}

function ensureSqliteStore() {
  if (sqliteReady) return;
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(backupsDir, { recursive: true });
  mkdirSync(libraryFilesDir, { recursive: true });
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
  seedCurrentConfusingWordsBackupVersionIfNeeded();

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
  if (structuredVersion < 8) {
    createBackupFile('pre-problem-inbox', 'automatic backup before problem inbox migration');
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('structured_schema_version', '8', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  }
  if (structuredVersion < 9) {
    createBackupFile('pre-precomputed-cache', 'automatic backup before precomputed cache migration');
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('structured_schema_version', '9', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  }
  if (structuredVersion < 10) {
    createBackupFile('pre-library', 'automatic backup before library migration');
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('structured_schema_version', '10', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  }
  if (structuredVersion < 11) {
    createBackupFile('pre-library-bookmarks', 'automatic backup before library bookmarks migration');
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('structured_schema_version', '11', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  }
  if (structuredVersion < 12) {
    createBackupFile('pre-visit-events', 'automatic backup before visit statistics migration');
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('structured_schema_version', '12', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  }
  if (structuredVersion < 13) {
    createBackupFile('pre-observability', 'automatic backup before task, audit and request log migration');
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('structured_schema_version', '13', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  }
  runStructuredMigrations();
  ensureTaskReminderColumns();
  if (!Number(sqliteScalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'instruments';") || 0)) {
    runSqlite(readFileSync(join(migrationsDir, '019_market_copilot_v1.sql'), 'utf8'));
  }
  if (!Number(sqliteScalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'investment_accounts';") || 0)) {
    runSqlite(readFileSync(join(migrationsDir, '020_market_copilot_ledger_refactor.sql'), 'utf8'));
  }
  marketCopilotRepository.seedIfEmpty();

  runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('storage_backend', 'sqlite-tables', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
  sqliteReady = true;
  ensureDailyBackup();
  ensureWeeklyBackup();
  ensureDictionaryIndex();
  ensureStudySummariesReady();
  if (!Number(sqliteScalar('SELECT COUNT(*) FROM learning_reports;') || 0)) {
    ensureAutomaticReports();
  }
  if (!reportTimerStarted) {
    setInterval(() => {
      ensureDailyBackup();
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
  if (!maintenanceTimerStarted) {
    scheduleDailyMaintenance();
    maintenanceTimerStarted = true;
  }
  if (!taskReminderTimerStarted) {
    scheduleTaskReminderScan();
    taskReminderTimerStarted = true;
  }
  if (!notificationQueueTimerStarted) {
    scheduleNotificationQueue();
    notificationQueueTimerStarted = true;
  }
  startMarketCopilotScheduler();
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

function countConfusingWordsGroups(groups = []) {
  const safeGroups = Array.isArray(groups) ? groups : [];
  return {
    groupCount: safeGroups.length,
    wordCount: safeGroups.reduce((sum, group) => sum + (Array.isArray(group?.words) ? group.words.length : 0), 0),
  };
}

function normalizeConfusingWordsPayload(input = {}, timestamp = nowISO()) {
  const groups = Array.isArray(input.groups) ? input.groups : [];
  return {
    schemaVersion: Number(input.schemaVersion || entitySchemaVersion),
    exportedAt: input.exportedAt || timestamp,
    backedUpAt: input.backedUpAt || timestamp,
    groups,
  };
}

function hashConfusingWordsPayload(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function summarizeConfusingWordsPayload(payload) {
  const counts = countConfusingWordsGroups(payload?.groups);
  const payloadText = JSON.stringify(payload || {});
  return {
    ...counts,
    payloadBytes: Buffer.byteLength(payloadText, 'utf8'),
    payloadHash: hashConfusingWordsPayload(payload || {}),
  };
}

function readConfusingWordsBackupPayload() {
  const rows = sqliteJson('SELECT payload_json AS payloadJson FROM confusing_words_backup WHERE id = 1 LIMIT 1;');
  if (!rows[0]?.payloadJson) return null;
  try {
    return JSON.parse(rows[0].payloadJson);
  } catch {
    return null;
  }
}

function insertConfusingWordsBackupVersion(payload, source = 'sync') {
  if (!payload) return null;
  const timestamp = nowISO();
  const summary = summarizeConfusingWordsPayload(payload);
  const latestHash = sqliteScalar('SELECT payload_hash FROM confusing_words_backup_versions ORDER BY created_at DESC, id DESC LIMIT 1;');
  if (latestHash === summary.payloadHash) return { skipped: true, ...summary };
  runSqlite(`INSERT INTO confusing_words_backup_versions (
  schema_version, exported_at, backed_up_at, payload_json, source, group_count, word_count, payload_hash, created_at
) VALUES (
  ${sqlString(String(payload.schemaVersion || entitySchemaVersion))},
  ${sqlString(payload.exportedAt || timestamp)},
  ${sqlString(payload.backedUpAt || timestamp)},
  ${sqlString(JSON.stringify(payload))},
  ${sqlString(source)},
  ${summary.groupCount},
  ${summary.wordCount},
  ${sqlString(summary.payloadHash)},
  ${sqlString(timestamp)}
);`);
  runSqlite(`DELETE FROM confusing_words_backup_versions
WHERE id NOT IN (
  SELECT id FROM confusing_words_backup_versions ORDER BY created_at DESC, id DESC LIMIT 80
);`);
  return { skipped: false, ...summary };
}

function saveConfusingWordsBackupPayload(payload, source = 'sync') {
  ensureSqliteStore();
  const timestamp = nowISO();
  const normalized = normalizeConfusingWordsPayload(payload, timestamp);
  const summary = summarizeConfusingWordsPayload(normalized);
  const current = readConfusingWordsBackupPayload();
  if (current) insertConfusingWordsBackupVersion(current, 'before-' + source);
  insertConfusingWordsBackupVersion(normalized, source);
  runSqlite(`INSERT INTO confusing_words_backup (id, schema_version, exported_at, backed_up_at, payload_json)
VALUES (1, ${Number(normalized.schemaVersion || entitySchemaVersion)}, ${sqlString(normalized.exportedAt)}, ${sqlString(normalized.backedUpAt)}, ${sqlString(JSON.stringify(normalized))})
ON CONFLICT(id) DO UPDATE SET
  schema_version = excluded.schema_version,
  exported_at = excluded.exported_at,
  backed_up_at = excluded.backed_up_at,
  payload_json = excluded.payload_json;`);
  runSqlite(`INSERT INTO app_state (id, state_json, updated_at)
VALUES (1, ${sqlString(JSON.stringify(readStateFromTables()))}, datetime('now'))
ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at;`);
  tableChanged();
  return { payload: normalized, summary };
}

function listConfusingWordsBackupVersions(limit = 20) {
  ensureSqliteStore();
  const safeLimit = Math.max(1, Math.min(80, Number(limit) || 20));
  return sqliteJson(`SELECT id, schema_version AS schemaVersion, exported_at AS exportedAt,
backed_up_at AS backedUpAt, source, group_count AS groupCount, word_count AS wordCount,
length(payload_json) AS payloadBytes, payload_hash AS payloadHash, created_at AS createdAt
FROM confusing_words_backup_versions
ORDER BY created_at DESC, id DESC
LIMIT ${safeLimit};`).map((item) => ({
    ...item,
    groupCount: Number(item.groupCount || 0),
    wordCount: Number(item.wordCount || 0),
    payloadBytes: Number(item.payloadBytes || 0),
    payloadHash: String(item.payloadHash || '').slice(0, 12),
  }));
}

function seedCurrentConfusingWordsBackupVersionIfNeeded() {
  const current = readConfusingWordsBackupPayload();
  if (!current) return;
  const versionCount = Number(sqliteScalar('SELECT COUNT(*) FROM confusing_words_backup_versions;') || 0);
  if (versionCount > 0) return;
  insertConfusingWordsBackupVersion(current, 'current-seed');
}

function sendJson(res, data, status = 200) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-backup-password,x-clawbot-secret,authorization',
  };
  if (corsOrigin) {
    headers['access-control-allow-origin'] = corsOrigin;
    headers.vary = 'Origin';
  }
  res.writeHead(status, headers);
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

function sourceUpdatedAt() {
  return sqliteScalar("SELECT value FROM app_metadata WHERE key = 'data_updated_at' LIMIT 1;") || '';
}

function setPrecomputedCache(cacheKey, payload) {
  const timestamp = nowISO();
  runSqlite(`INSERT INTO precomputed_cache (cache_key, payload_json, source_updated_at, computed_at)
VALUES (${sqlString(cacheKey)}, ${sqlString(JSON.stringify(payload))}, ${sqlString(sourceUpdatedAt())}, ${sqlString(timestamp)})
ON CONFLICT(cache_key) DO UPDATE SET
  payload_json = excluded.payload_json,
  source_updated_at = excluded.source_updated_at,
  computed_at = excluded.computed_at;`);
  return { ...payload, precomputedAt: timestamp };
}

function getPrecomputedCache(cacheKey, maxAgeMs = 24 * 60 * 60 * 1000) {
  const row = sqliteJson(`SELECT payload_json AS payloadJson, source_updated_at AS sourceUpdatedAt, computed_at AS computedAt
FROM precomputed_cache
WHERE cache_key = ${sqlString(cacheKey)}
LIMIT 1;`)[0];
  if (!row?.payloadJson) return null;
  if (maxAgeMs && Date.now() - new Date(row.computedAt).getTime() > maxAgeMs) return null;
  const currentSource = sourceUpdatedAt();
  if (currentSource && row.sourceUpdatedAt && new Date(row.sourceUpdatedAt).getTime() < new Date(currentSource).getTime()) return null;
  return { ...JSON.parse(row.payloadJson), precomputedAt: row.computedAt };
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
  const existing = sqliteJson(`SELECT due_date AS dueDate, due_time AS dueTime, reminder_sent_offsets AS reminderSentOffsets
FROM short_term_tasks WHERE id = ${sqlValue(id)} LIMIT 1;`).map(normalizeTaskRow)[0] || null;
  const dueDate = payload.dueDate || todayISO();
  const dueTime = normalizeTaskDueTime(payload.dueTime);
  const timeChanged = existing && (existing.dueDate !== dueDate || existing.dueTime !== dueTime);
  const reminderEnabled = Boolean(payload.reminderEnabled ?? dueTime) && Boolean(dueTime);
  const sentOffsets = timeChanged ? [] : normalizeReminderSentOffsets(payload.reminderSentOffsets ?? existing?.reminderSentOffsets);
  const reminderLastSentAt = timeChanged ? null : payload.reminderLastSentAt || existing?.reminderLastSentAt || null;
  runSqlite(`INSERT INTO short_term_tasks (id, title, due_date, due_time, urgency, is_completed, completed_at, reminder_enabled, reminder_sent_offsets, reminder_last_sent_at, note, schema_version, created_at, updated_at)
VALUES (${id}, ${sqlValue(payload.title || '')}, ${sqlValue(dueDate)}, ${sqlValue(dueTime)}, ${sqlValue(payload.urgency || 'medium')}, ${sqlValue(Boolean(payload.isCompleted))}, ${sqlValue(payload.completedAt || null)}, ${sqlValue(reminderEnabled)}, ${sqlValue(JSON.stringify(sentOffsets))}, ${sqlValue(reminderLastSentAt)}, ${sqlValue(payload.note || '')}, ${entitySchemaVersion}, ${sqlValue(timestamp)}, ${sqlValue(timestamp)})
ON CONFLICT(id) DO UPDATE SET
title = excluded.title,
due_date = excluded.due_date,
due_time = excluded.due_time,
urgency = excluded.urgency,
is_completed = excluded.is_completed,
completed_at = excluded.completed_at,
reminder_enabled = excluded.reminder_enabled,
reminder_sent_offsets = excluded.reminder_sent_offsets,
reminder_last_sent_at = excluded.reminder_last_sent_at,
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

function problemInboxRowToObject(row) {
  return {
    id: Number(row.id),
    date: row.date,
    text: row.text,
    status: row.status,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt || null,
  };
}

function listProblemInboxItems({ limit = 12, status = 'all', from = '1900-01-01', to = '2999-12-31' } = {}) {
  const statusClause = status === 'open' || status === 'resolved' ? `AND status = ${sqlString(status)}` : '';
  return sqliteJson(`SELECT id, date, text, status, source, created_at AS createdAt, updated_at AS updatedAt, resolved_at AS resolvedAt
FROM problem_inbox_items
WHERE date BETWEEN ${sqlString(from)} AND ${sqlString(to)}
${statusClause}
ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, date DESC, updated_at DESC, id DESC
LIMIT ${Math.max(1, Math.min(100, Number(limit) || 12))};`).map(problemInboxRowToObject);
}

function saveProblemInboxItem(payload) {
  const text = String(payload.text || '').trim();
  if (!text) throw new Error('Problem inbox text is required');
  const timestamp = nowISO();
  const id = payload.id && Number(sqliteScalar(`SELECT COUNT(*) FROM problem_inbox_items WHERE id = ${sqlValue(Number(payload.id))};`) || 0)
    ? Number(payload.id)
    : nextTableId('problem_inbox_items');
  runSqlite(`INSERT INTO problem_inbox_items (id, date, text, status, source, created_at, updated_at, resolved_at)
VALUES (${sqlValue(id)}, ${sqlValue(payload.date || todayISO())}, ${sqlValue(text)}, ${sqlValue(payload.status || 'open')}, ${sqlValue(payload.source || 'manual')}, ${sqlValue(timestamp)}, ${sqlValue(timestamp)}, ${sqlValue(payload.resolvedAt || null)})
ON CONFLICT(id) DO UPDATE SET
date = excluded.date,
text = excluded.text,
status = excluded.status,
source = excluded.source,
updated_at = excluded.updated_at,
resolved_at = excluded.resolved_at;`);
  tableChanged();
  return id;
}

function setProblemInboxStatus(id, status) {
  const nextStatus = status === 'resolved' ? 'resolved' : 'open';
  const timestamp = nowISO();
  runSqlite(`UPDATE problem_inbox_items
SET status = ${sqlString(nextStatus)}, updated_at = ${sqlString(timestamp)}, resolved_at = ${sqlValue(nextStatus === 'resolved' ? timestamp : null)}
WHERE id = ${sqlValue(Number(id))};`);
  tableChanged();
}

function deleteProblemInboxItem(id) {
  runSqlite(`DELETE FROM problem_inbox_items WHERE id = ${sqlValue(Number(id))};`);
  tableChanged();
}

function resolveProblemInboxForDate(date = todayISO()) {
  const timestamp = nowISO();
  runSqlite(`UPDATE problem_inbox_items
SET status = 'resolved', updated_at = ${sqlString(timestamp)}, resolved_at = ${sqlString(timestamp)}
WHERE date = ${sqlString(date)} AND status = 'open';`);
  tableChanged();
  return { ok: true, resolvedAt: timestamp };
}

function parseTags(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || '')
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function safeFileName(value = 'book') {
  return String(value)
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'book';
}

function libraryFileType(fileName = '') {
  const ext = extname(fileName).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.epub') return 'epub';
  if (ext === '.txt') return 'txt';
  if (ext === '.md' || ext === '.markdown') return 'md';
  return '';
}

function libraryMimeType(fileType) {
  if (fileType === 'pdf') return 'application/pdf';
  if (fileType === 'epub') return 'application/epub+zip';
  if (fileType === 'md') return 'text/markdown; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

function libraryBookRowToObject(row) {
  let tags = [];
  try {
    tags = JSON.parse(row.tagsJson || '[]');
  } catch {
    tags = [];
  }
  return {
    id: Number(row.id),
    title: row.title,
    author: row.author || '',
    category: row.category || '未分类',
    tags,
    originalFileName: row.originalFileName,
    fileType: row.fileType,
    mimeType: row.mimeType,
    fileSize: Number(row.fileSize || 0),
    textStatus: row.textStatus,
    textError: row.textError || '',
    pageCount: row.pageCount === null || row.pageCount === undefined ? null : Number(row.pageCount),
    chapterCount: row.chapterCount === null || row.chapterCount === undefined ? null : Number(row.chapterCount),
    progressPercent: Number(row.progressPercent || 0),
    lastLocator: row.lastLocator || '',
    lastOpenedAt: row.lastOpenedAt || null,
    isFavorite: Boolean(row.isFavorite),
    isArchived: Boolean(row.isArchived),
    schemaVersion: Number(row.schemaVersion || entitySchemaVersion),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function getLibraryBookById(id) {
  const row = sqliteJson(`SELECT id, title, author, category, tags_json AS tagsJson, original_file_name AS originalFileName,
file_type AS fileType, mime_type AS mimeType, file_size AS fileSize, text_status AS textStatus, text_error AS textError,
page_count AS pageCount, chapter_count AS chapterCount, progress_percent AS progressPercent, last_locator AS lastLocator,
last_opened_at AS lastOpenedAt, is_favorite AS isFavorite, is_archived AS isArchived, schema_version AS schemaVersion,
created_at AS createdAt, updated_at AS updatedAt
FROM library_books WHERE id = ${sqlValue(Number(id))} LIMIT 1;`)[0];
  return row ? libraryBookRowToObject(row) : null;
}

function getLibraryStoragePath(id) {
  const row = sqliteJson(`SELECT storage_path AS storagePath FROM library_books WHERE id = ${sqlValue(Number(id))} LIMIT 1;`)[0];
  if (!row?.storagePath) return '';
  const resolved = resolve(row.storagePath);
  return resolved.startsWith(resolve(libraryFilesDir)) ? resolved : '';
}

function listLibraryBooks({ search = '', category = '', sort = 'recent', includeArchived = false } = {}, sessionRole = 'write') {
  const clauses = includeArchived ? ['1=1'] : ['is_archived = 0'];
  if (category) clauses.push(`category = ${sqlString(category)}`);
  if (search) {
    const like = `%${String(search).replace(/[%_]/g, '')}%`;
    clauses.push(`(title LIKE ${sqlString(like)} OR author LIKE ${sqlString(like)} OR original_file_name LIKE ${sqlString(like)} OR tags_json LIKE ${sqlString(like)})`);
  }
  const orderBy = sort === 'title'
    ? 'title COLLATE NOCASE ASC'
    : sort === 'uploaded'
      ? 'created_at DESC, id DESC'
      : sort === 'progress'
        ? 'progress_percent DESC, updated_at DESC'
        : 'COALESCE(last_opened_at, updated_at) DESC, updated_at DESC';
  const items = sqliteJson(`SELECT id, title, author, category, tags_json AS tagsJson, original_file_name AS originalFileName,
file_type AS fileType, mime_type AS mimeType, file_size AS fileSize, text_status AS textStatus, text_error AS textError,
page_count AS pageCount, chapter_count AS chapterCount, progress_percent AS progressPercent, last_locator AS lastLocator,
last_opened_at AS lastOpenedAt, is_favorite AS isFavorite, is_archived AS isArchived, schema_version AS schemaVersion,
created_at AS createdAt, updated_at AS updatedAt
FROM library_books
WHERE ${clauses.join(' AND ')}
ORDER BY ${orderBy};`).map(libraryBookRowToObject);
  const categories = sqliteJson(`SELECT category, COUNT(*) AS count FROM library_books WHERE is_archived = 0 GROUP BY category ORDER BY category;`)
    .map((item) => ({ category: item.category || '未分类', count: Number(item.count || 0) }));
  return { items, categories, readOnly: sessionRole === 'read' };
}

function getLibraryBookDetail(id, sessionRole = 'write') {
  const book = getLibraryBookById(id);
  if (!book) return null;
  const notes = sqliteJson(`SELECT id, book_id AS bookId, locator, title, content, created_at AS createdAt, updated_at AS updatedAt
FROM library_notes
WHERE book_id = ${sqlValue(Number(id))}
ORDER BY updated_at DESC, id DESC;`);
  const bookmarks = sqliteJson(`SELECT id, book_id AS bookId, page_number AS pageNumber, title, note, created_at AS createdAt, updated_at AS updatedAt
FROM library_bookmarks
WHERE book_id = ${sqlValue(Number(id))}
ORDER BY page_number ASC, updated_at DESC;`);
  const chunkCount = Number(sqliteScalar(`SELECT COUNT(*) FROM library_text_chunks WHERE book_id = ${sqlValue(Number(id))};`) || 0);
  return { book, notes, bookmarks, chunkCount, readOnly: sessionRole === 'read' };
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTextChunks(text, chunkSize = 3000) {
  const clean = String(text || '').replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n').trim();
  if (!clean) return [];
  const chunks = [];
  for (let index = 0; index < clean.length && chunks.length < 3000; index += chunkSize) {
    chunks.push(clean.slice(index, index + chunkSize));
  }
  return chunks;
}

function extractPdfText(filePath) {
  let pageCount = null;
  const infoResult = spawnSync('pdfinfo', [filePath], { encoding: 'utf8', timeout: 15000 });
  const match = infoResult.stdout?.match(/^Pages:\s+(\d+)/m);
  if (match) pageCount = Number(match[1]);
  const textResult = spawnSync('pdftotext', ['-layout', filePath, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  if (textResult.status !== 0) {
    throw new Error(textResult.stderr || 'pdftotext failed');
  }
  return { text: textResult.stdout, pageCount, chapterCount: null };
}

function extractEpubText(filePath) {
  const listResult = spawnSync('unzip', ['-Z1', filePath], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30000 });
  if (listResult.status !== 0) throw new Error(listResult.stderr || 'unzip unavailable');
  const entries = listResult.stdout.split(/\r?\n/)
    .filter((name) => /\.(xhtml|html|htm|txt)$/i.test(name))
    .filter((name) => !/META-INF/i.test(name))
    .slice(0, 800);
  const texts = [];
  for (const entry of entries) {
    const result = spawnSync('unzip', ['-p', filePath, entry], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
    if (result.status === 0 && result.stdout) texts.push(stripHtml(result.stdout));
  }
  return { text: texts.join('\n\n'), pageCount: null, chapterCount: entries.length };
}

function extractLibraryText(filePath, fileType) {
  if (fileType === 'txt' || fileType === 'md') {
    return { text: readFileSync(filePath, 'utf8'), pageCount: null, chapterCount: null };
  }
  if (fileType === 'pdf') return extractPdfText(filePath);
  if (fileType === 'epub') return extractEpubText(filePath);
  return { text: '', pageCount: null, chapterCount: null };
}

function indexLibraryBookText(bookId) {
  const book = getLibraryBookById(bookId);
  const filePath = getLibraryStoragePath(bookId);
  if (!book || !filePath || !existsSync(filePath)) return;
  const timestamp = nowISO();
  try {
    runSqlite(`UPDATE library_books SET text_status = 'processing', text_error = '', updated_at = ${sqlString(timestamp)} WHERE id = ${sqlValue(bookId)};`);
    const extracted = extractLibraryText(filePath, book.fileType);
    const chunks = splitTextChunks(extracted.text);
    const statements = [
      'BEGIN;',
      `DELETE FROM library_text_chunks WHERE book_id = ${sqlValue(bookId)};`,
      `DELETE FROM library_text_fts WHERE book_id = ${sqlValue(bookId)};`,
    ];
    chunks.forEach((text, index) => {
      const locator = book.fileType === 'pdf' ? `chunk:${index + 1}` : `section:${index + 1}`;
      statements.push(`INSERT INTO library_text_chunks (book_id, chunk_index, locator, title, text, created_at)
VALUES (${sqlValue(bookId)}, ${sqlValue(index)}, ${sqlString(locator)}, ${sqlString(`片段 ${index + 1}`)}, ${sqlString(text)}, ${sqlString(timestamp)});`);
    });
    statements.push('COMMIT;');
    runSqlite(statements.join('\n'), { maxBuffer: 128 * 1024 * 1024 });
    const rows = sqliteJson(`SELECT id, chunk_index AS chunkIndex, title, text FROM library_text_chunks WHERE book_id = ${sqlValue(bookId)} ORDER BY chunk_index;`);
    const ftsStatements = ['BEGIN;'];
    rows.forEach((row) => {
      ftsStatements.push(`INSERT INTO library_text_fts (book_id, chunk_id, title, text)
VALUES (${sqlValue(bookId)}, ${sqlValue(Number(row.id))}, ${sqlString(row.title || '')}, ${sqlString(row.text || '')});`);
    });
    ftsStatements.push('COMMIT;');
    runSqlite(ftsStatements.join('\n'), { maxBuffer: 128 * 1024 * 1024 });
    runSqlite(`UPDATE library_books
SET text_status = ${sqlString(chunks.length ? 'ready' : 'empty')},
    text_error = '',
    page_count = ${sqlValue(extracted.pageCount)},
    chapter_count = ${sqlValue(extracted.chapterCount)},
    updated_at = ${sqlString(nowISO())}
WHERE id = ${sqlValue(bookId)};`);
  } catch (error) {
    runSqlite(`UPDATE library_books
SET text_status = 'failed',
    text_error = ${sqlString(error instanceof Error ? error.message : String(error))},
    updated_at = ${sqlString(nowISO())}
WHERE id = ${sqlValue(bookId)};`);
  }
}

function getLibraryText(bookId, { offset = 0, limit = 80 } = {}) {
  const rows = sqliteJson(`SELECT id, book_id AS bookId, chunk_index AS chunkIndex, locator, title, text, created_at AS createdAt
FROM library_text_chunks
WHERE book_id = ${sqlValue(Number(bookId))}
ORDER BY chunk_index
LIMIT ${Math.max(1, Math.min(300, Number(limit) || 80))} OFFSET ${Math.max(0, Number(offset) || 0)};`);
  const total = Number(sqliteScalar(`SELECT COUNT(*) FROM library_text_chunks WHERE book_id = ${sqlValue(Number(bookId))};`) || 0);
  return { chunks: rows, total, limit: Math.max(1, Math.min(300, Number(limit) || 80)), offset: Math.max(0, Number(offset) || 0) };
}

function saveLibraryMetadata(payload) {
  const book = getLibraryBookById(payload.id);
  if (!book) throw new Error('Library book not found');
  const timestamp = nowISO();
  runSqlite(`UPDATE library_books SET
title = ${sqlString(String(payload.title || book.title).trim() || book.title)},
author = ${sqlString(String(payload.author ?? book.author).trim())},
category = ${sqlString(String(payload.category || book.category || '未分类').trim())},
tags_json = ${sqlString(JSON.stringify(parseTags(payload.tags ?? book.tags)))},
is_favorite = ${sqlValue(Boolean(payload.isFavorite))},
is_archived = ${sqlValue(Boolean(payload.isArchived))},
updated_at = ${sqlString(timestamp)}
WHERE id = ${sqlValue(Number(payload.id))};`);
  tableChanged();
  return getLibraryBookById(payload.id);
}

function saveLibraryProgress(payload) {
  const bookId = Number(payload.bookId || payload.id || 0);
  if (!bookId) throw new Error('Missing book id');
  const locator = String(payload.locator || '');
  const percent = Math.max(0, Math.min(100, Number(payload.progressPercent || 0)));
  const timestamp = nowISO();
  runSqlite(`INSERT INTO library_reading_progress (book_id, locator, progress_percent, updated_at)
VALUES (${sqlValue(bookId)}, ${sqlString(locator)}, ${sqlValue(percent)}, ${sqlString(timestamp)})
ON CONFLICT(book_id) DO UPDATE SET locator = excluded.locator, progress_percent = excluded.progress_percent, updated_at = excluded.updated_at;
UPDATE library_books
SET last_locator = ${sqlString(locator)},
    progress_percent = ${sqlValue(percent)},
    last_opened_at = ${sqlString(timestamp)},
    updated_at = ${sqlString(timestamp)}
WHERE id = ${sqlValue(bookId)};`);
  tableChanged();
  return { ok: true, updatedAt: timestamp };
}

function saveLibraryNote(payload) {
  const bookId = Number(payload.bookId || 0);
  const content = String(payload.content || '').trim();
  if (!bookId || !content) throw new Error('Missing note content');
  const timestamp = nowISO();
  const id = payload.id && Number(sqliteScalar(`SELECT COUNT(*) FROM library_notes WHERE id = ${sqlValue(Number(payload.id))};`) || 0)
    ? Number(payload.id)
    : nextTableId('library_notes');
  runSqlite(`INSERT INTO library_notes (id, book_id, locator, title, content, created_at, updated_at)
VALUES (${sqlValue(id)}, ${sqlValue(bookId)}, ${sqlString(payload.locator || '')}, ${sqlString(payload.title || '')}, ${sqlString(content)}, ${sqlString(timestamp)}, ${sqlString(timestamp)})
ON CONFLICT(id) DO UPDATE SET
locator = excluded.locator,
title = excluded.title,
content = excluded.content,
updated_at = excluded.updated_at;`);
  tableChanged();
  return { ok: true, id };
}

function saveLibraryBookmark(payload) {
  const bookId = Number(payload.bookId || 0);
  const pageNumber = Math.max(1, Math.round(Number(payload.pageNumber || 1)));
  if (!bookId) throw new Error('Missing book id');
  if (!getLibraryBookById(bookId)) throw new Error('Book not found');
  const timestamp = nowISO();
  const id = payload.id && Number(sqliteScalar(`SELECT COUNT(*) FROM library_bookmarks WHERE id = ${sqlValue(Number(payload.id))};`) || 0)
    ? Number(payload.id)
    : nextTableId('library_bookmarks');
  runSqlite(`INSERT INTO library_bookmarks (id, book_id, page_number, title, note, created_at, updated_at)
VALUES (${sqlValue(id)}, ${sqlValue(bookId)}, ${sqlValue(pageNumber)}, ${sqlString(payload.title || '')}, ${sqlString(payload.note || '')}, ${sqlString(timestamp)}, ${sqlString(timestamp)})
ON CONFLICT(id) DO UPDATE SET
page_number = excluded.page_number,
title = excluded.title,
note = excluded.note,
updated_at = excluded.updated_at;`);
  tableChanged();
  return { ok: true, id };
}

function deleteLibraryBookmark(id) {
  runSqlite(`DELETE FROM library_bookmarks WHERE id = ${sqlValue(Number(id))};`);
  tableChanged();
  return { ok: true };
}

function deleteLibraryBook(id) {
  const filePath = getLibraryStoragePath(id);
  runSqlite(`BEGIN;
DELETE FROM library_text_chunks WHERE book_id = ${sqlValue(Number(id))};
DELETE FROM library_text_fts WHERE book_id = ${sqlValue(Number(id))};
DELETE FROM library_notes WHERE book_id = ${sqlValue(Number(id))};
DELETE FROM library_bookmarks WHERE book_id = ${sqlValue(Number(id))};
DELETE FROM library_reading_progress WHERE book_id = ${sqlValue(Number(id))};
DELETE FROM library_books WHERE id = ${sqlValue(Number(id))};
COMMIT;`);
  if (filePath && existsSync(filePath)) {
    try { unlinkSync(filePath); } catch { /* keep DB delete from being blocked by file cleanup */ }
  }
  tableChanged();
}

function searchLibrary(query, sessionRole = 'write') {
  const q = String(query || '').trim();
  if (!q) return { results: [], readOnly: sessionRole === 'read' };
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const byMeta = sqliteJson(`SELECT id, title, author, category, tags_json AS tagsJson, original_file_name AS originalFileName,
file_type AS fileType, mime_type AS mimeType, file_size AS fileSize, text_status AS textStatus, text_error AS textError,
page_count AS pageCount, chapter_count AS chapterCount, progress_percent AS progressPercent, last_locator AS lastLocator,
last_opened_at AS lastOpenedAt, is_favorite AS isFavorite, is_archived AS isArchived, schema_version AS schemaVersion,
created_at AS createdAt, updated_at AS updatedAt,
'metadata' AS matchType, '' AS snippet, '' AS locator
FROM library_books
WHERE is_archived = 0 AND (title LIKE ${sqlString(like)} OR author LIKE ${sqlString(like)} OR original_file_name LIKE ${sqlString(like)} OR tags_json LIKE ${sqlString(like)})
LIMIT 30;`);
  const escapedFts = q.replace(/"/g, '""');
  let byText = [];
  try {
    byText = sqliteJson(`SELECT b.id, b.title, b.author, b.category, b.tags_json AS tagsJson, b.original_file_name AS originalFileName,
b.file_type AS fileType, b.mime_type AS mimeType, b.file_size AS fileSize, b.text_status AS textStatus, b.text_error AS textError,
b.page_count AS pageCount, b.chapter_count AS chapterCount, b.progress_percent AS progressPercent, b.last_locator AS lastLocator,
b.last_opened_at AS lastOpenedAt, b.is_favorite AS isFavorite, b.is_archived AS isArchived, b.schema_version AS schemaVersion,
b.created_at AS createdAt, b.updated_at AS updatedAt,
'text' AS matchType, snippet(library_text_fts, 3, '[', ']', '...', 24) AS snippet, c.locator
FROM library_text_fts
JOIN library_text_chunks c ON c.id = library_text_fts.chunk_id
JOIN library_books b ON b.id = library_text_fts.book_id
WHERE library_text_fts MATCH ${sqlString(`"${escapedFts}"`)} AND b.is_archived = 0
LIMIT 50;`);
  } catch {
    byText = [];
  }
  const byNotes = sqliteJson(`SELECT b.id, b.title, b.author, b.category, b.tags_json AS tagsJson, b.original_file_name AS originalFileName,
b.file_type AS fileType, b.mime_type AS mimeType, b.file_size AS fileSize, b.text_status AS textStatus, b.text_error AS textError,
b.page_count AS pageCount, b.chapter_count AS chapterCount, b.progress_percent AS progressPercent, b.last_locator AS lastLocator,
b.last_opened_at AS lastOpenedAt, b.is_favorite AS isFavorite, b.is_archived AS isArchived, b.schema_version AS schemaVersion,
b.created_at AS createdAt, b.updated_at AS updatedAt,
'note' AS matchType, n.content AS snippet, n.locator
FROM library_notes n
JOIN library_books b ON b.id = n.book_id
WHERE b.is_archived = 0 AND (n.content LIKE ${sqlString(like)} OR n.title LIKE ${sqlString(like)})
LIMIT 30;`);
  const seen = new Set();
  const results = [...byMeta, ...byText, ...byNotes].filter((row) => {
    const key = `${row.id}-${row.matchType}-${row.locator}-${row.snippet}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((row) => ({ book: libraryBookRowToObject(row), matchType: row.matchType, snippet: row.snippet || '', locator: row.locator || '' }));
  return { results, readOnly: sessionRole === 'read' };
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

function getActivityCalendar(days = 84, endDate = todayISO()) {
  const startDate = addDaysISO(endDate, -(days - 1));
  const totals = sqliteJson(`SELECT date, total_minutes AS minutes
FROM study_daily_summaries
WHERE date BETWEEN ${sqlString(startDate)} AND ${sqlString(endDate)};`);
  const reviews = sqliteJson(`SELECT date, score FROM daily_reviews WHERE date BETWEEN ${sqlString(startDate)} AND ${sqlString(endDate)};`);
  const water = sqliteJson(`SELECT date, cups, target_cups AS targetCups FROM water_intake_records WHERE date BETWEEN ${sqlString(startDate)} AND ${sqlString(endDate)};`);
  const taskRows = sqliteJson(`SELECT due_date AS date, COUNT(*) AS total,
COALESCE(SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END), 0) AS completed
FROM short_term_tasks
WHERE due_date BETWEEN ${sqlString(startDate)} AND ${sqlString(endDate)}
GROUP BY due_date;`);
  const totalMap = new Map(totals.map((item) => [item.date, Number(item.minutes || 0)]));
  const reviewMap = new Map(reviews.map((item) => [item.date, Number(item.score || 0)]));
  const waterMap = new Map(water.map((item) => [item.date, { cups: Number(item.cups || 0), targetCups: Number(item.targetCups || 6) }]));
  const taskMap = new Map(taskRows.map((item) => [item.date, { total: Number(item.total || 0), completed: Number(item.completed || 0) }]));
  return dateRange(startDate, endDate).map((date) => {
    const waterItem = waterMap.get(date) || { cups: 0, targetCups: 6 };
    const taskItem = taskMap.get(date) || { total: 0, completed: 0 };
    return {
      date,
      minutes: totalMap.get(date) || 0,
      reviewScore: reviewMap.get(date) || null,
      hasReview: reviewMap.has(date),
      waterCups: waterItem.cups,
      waterTargetCups: waterItem.targetCups,
      taskTotal: taskItem.total,
      taskCompleted: taskItem.completed,
    };
  });
}

function getReviewTrendPayload(days = 30, endDate = todayISO()) {
  const safeDays = Math.max(7, Math.min(120, Number(days) || 30));
  const startDate = addDaysISO(endDate, -(safeDays - 1));
  const rows = sqliteJson(`SELECT date, score
FROM daily_reviews
WHERE date BETWEEN ${sqlString(startDate)} AND ${sqlString(endDate)}
ORDER BY date;`).map((item) => ({ date: item.date, score: Number(item.score || 0) }));
  const scoreMap = new Map(rows.map((item) => [item.date, item.score]));
  return {
    periodStart: startDate,
    periodEnd: endDate,
    days: safeDays,
    trend: dateRange(startDate, endDate).map((date) => ({ date, score: scoreMap.get(date) || null })),
  };
}

function getCachedReviewTrend(days = 30, endDate = todayISO()) {
  const cacheKey = `review-trend:${days}:${endDate}`;
  const cached = getPrecomputedCache(cacheKey);
  if (cached) return cached;
  return setPrecomputedCache(cacheKey, getReviewTrendPayload(days, endDate));
}

function getErrorThemeWall(limit = 12, days = 90, endDate = todayISO()) {
  const startDate = addDaysISO(endDate, -(Math.max(7, Number(days) || 90) - 1));
  return sqliteJson(`SELECT t.id, t.normalized_label AS normalizedLabel, t.label,
COUNT(o.id) AS occurrenceCount,
COUNT(DISTINCT o.date) AS reviewDayCount,
MAX(o.date) AS lastSeenAt
FROM error_themes t
JOIN error_theme_occurrences o ON o.theme_id = t.id
WHERE o.date BETWEEN ${sqlString(startDate)} AND ${sqlString(endDate)}
GROUP BY t.id, t.normalized_label, t.label
ORDER BY occurrenceCount DESC, reviewDayCount DESC, lastSeenAt DESC
LIMIT ${Math.max(1, Math.min(30, Number(limit) || 12))};`).map((item) => ({
    id: Number(item.id),
    normalizedLabel: item.normalizedLabel,
    label: item.label,
    occurrenceCount: Number(item.occurrenceCount || 0),
    reviewDayCount: Number(item.reviewDayCount || 0),
    lastSeenAt: item.lastSeenAt || '',
  }));
}

function getReviewPrefill(date = todayISO(), sessionRole = 'write') {
  const totalMinutes = Number(sqliteScalar(`SELECT COALESCE(total_minutes, 0) FROM study_daily_summaries WHERE date = ${sqlString(date)};`) || 0);
  const topProject = sqliteJson(`SELECT project_name_snapshot AS name, minutes
FROM study_project_daily_summaries
WHERE date = ${sqlString(date)}
ORDER BY minutes DESC, project_name_snapshot
LIMIT 1;`).map((item) => ({ name: item.name, minutes: Number(item.minutes || 0) }))[0] || null;
  const unfinishedTasks = sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency,
reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt
FROM short_term_tasks
WHERE due_date <= ${sqlString(date)} AND is_completed = 0
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date, due_time, id
LIMIT 6;`).map(normalizeTaskRow);
  const water = sqliteJson(`SELECT cups, cup_ml AS cupMl, target_cups AS targetCups
FROM water_intake_records WHERE date = ${sqlString(date)} LIMIT 1;`)[0] || { cups: 0, cupMl: 500, targetCups: 6 };
  const inboxItems = listProblemInboxItems({ status: 'open', from: date, to: date, limit: 6 });
  const previousReview = sqliteJson(`SELECT tomorrow_plan AS tomorrowPlan
FROM daily_reviews WHERE date = ${sqlString(addDaysISO(date, -1))} LIMIT 1;`)[0] || null;
  const suggestedSummary = [
    totalMinutes ? `今日学习 ${minutesText(totalMinutes)}。` : '今日还没有记录学习时间。',
    topProject ? `投入最多的是「${topProject.name}」${minutesText(topProject.minutes)}。` : '',
    unfinishedTasks.length ? `仍有 ${unfinishedTasks.length} 个短期目标未完成。` : '短期目标没有明显积压。',
    `喝水 ${Number(water.cups || 0)}/${Number(water.targetCups || 6)} 杯。`,
  ].filter(Boolean).join('\n');
  const suggestedProblems = [
    ...inboxItems.map((item) => `- ${item.text}`),
    unfinishedTasks.length ? `- 未完成任务：${unfinishedTasks.map((item) => item.title).join('；')}` : '',
  ].filter(Boolean).join('\n');
  return {
    date,
    totalMinutes,
    topProject,
    unfinishedTasks,
    water: { cups: Number(water.cups || 0), cupMl: Number(water.cupMl || 500), targetCups: Number(water.targetCups || 6) },
    problemInboxItems: inboxItems,
    previousTomorrowPlan: previousReview?.tomorrowPlan || '',
    suggestedSummary,
    suggestedProblems,
    readOnly: sessionRole === 'read',
  };
}

function countdownStage(activeGoal, date = todayISO()) {
  if (!activeGoal?.deadline) return { label: '未设定阶段', tone: 'slate', hint: '设置长期目标后自动判断备考阶段。' };
  const daysLeft = Math.max(0, Math.ceil((parseDateString(activeGoal.deadline).getTime() - parseDateString(date).getTime()) / (24 * 60 * 60 * 1000)));
  if (daysLeft <= 30) return { label: '冲刺期', tone: 'rose', hint: '优先真题复盘、错题回炉和作息稳定。' };
  if (daysLeft <= 100) return { label: '真题期', tone: 'amber', hint: '保持真题节奏，按周复盘薄弱科目。' };
  if (daysLeft <= 220) return { label: '强化期', tone: 'blue', hint: '重点放在题型熟练度、错题闭环和专项突破。' };
  return { label: '基础期', tone: 'emerald', hint: '稳住基础概念、教材/课程推进和每日记录。' };
}

function stageChecklist(stageLabel) {
  if (stageLabel === '冲刺期') return ['先处理最近真题错因', '安排一轮限时训练', '睡前复盘明日科目顺序'];
  if (stageLabel === '真题期') return ['完成一段真题或套卷复盘', '把错因写进问题 Inbox', '留出薄弱科目固定时间'];
  if (stageLabel === '强化期') return ['推进一个专项题型', '复看昨日错题', '把任务拆到 45 分钟内'];
  if (stageLabel === '基础期') return ['先完成基础知识推进', '记录一个学习时间块', '晚上用 5 分钟复盘'];
  return ['确认长期目标日期', '添加今天最小任务', '完成一次短学习块'];
}

function getDashboardReminders({ today, todayTotal, visibleTasks, waterRecord, todayReview }) {
  const reminders = [];
  if (!todayReview) reminders.push({ id: 'review', tone: 'amber', title: '今天还没复盘', detail: '睡前留 5 分钟写下今天的问题和明日计划。' });
  const last7 = getLastNDaysTotals(7, today);
  const previousStudyDays = last7.slice(0, -1).filter((item) => item.minutes > 0);
  const average = previousStudyDays.length ? Math.round(previousStudyDays.reduce((sum, item) => sum + item.minutes, 0) / previousStudyDays.length) : 0;
  if (average && todayTotal < average * 0.6) reminders.push({ id: 'study-low', tone: 'rose', title: '今日学习时长偏低', detail: `低于近 7 天学习日均值 ${minutesText(average)}，先补一个短时段。` });
  const tomorrow = addDaysISO(today, 1);
  const dueTomorrow = visibleTasks.filter((task) => !task.isCompleted && task.dueDate <= tomorrow);
  if (dueTomorrow.length) reminders.push({ id: 'task-due', tone: 'blue', title: '近期目标快到期', detail: `${dueTomorrow.length} 个短期目标在明天前到期。` });
  const cups = Number(waterRecord?.cups || 0);
  const targetCups = Number(waterRecord?.targetCups || 6);
  if (cups < targetCups) reminders.push({ id: 'water', tone: cups ? 'amber' : 'rose', title: '喝水未达标', detail: `今日 ${cups}/${targetCups} 杯，离目标还差 ${Math.max(0, targetCups - cups)} 杯。` });
  return reminders.slice(0, 5);
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
  const visibleTasks = sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency, is_completed AS isCompleted, completed_at AS completedAt,
reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt, note,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM short_term_tasks
WHERE is_completed = 0 OR date(completed_at) = date(${sqlString(today)})
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date, due_time, id;`).map(normalizeTaskRow);
  const waterRecord = sqliteJson(`SELECT id, date, cups, cup_ml AS cupMl, target_cups AS targetCups,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM water_intake_records WHERE date = ${sqlString(today)} LIMIT 1;`)[0] || null;
  const todayBrief = getDailyBriefByDate(today) || getLatestDailyBriefSummary();
  const stage = countdownStage(activeGoal, today);
  const daysLeft = activeGoal ? Math.max(1, Math.ceil((parseDateString(activeGoal.deadline).getTime() - parseDateString(today).getTime()) / (24 * 60 * 60 * 1000))) : 0;
  const remainingStudyMinutes = Math.max(0, studyTargetMinutes - totalStudyMinutes);
  const dailyTargetMinutes = daysLeft ? Math.ceil(remainingStudyMinutes / daysLeft) : 0;
  const primaryTask = visibleTasks.find((task) => !task.isCompleted) || null;
  const startupPlan = {
    stage,
    primaryTask,
    dailyTargetMinutes,
    checklist: stageChecklist(stage.label),
    firstSession: primaryTask
      ? `先推进「${primaryTask.title}」25-45 分钟`
      : todayTotal
        ? '今天已经启动，继续保持一个完整学习块'
        : '先开始一个 25 分钟低阻力学习块',
  };
  const reminders = getDashboardReminders({ today, todayTotal, visibleTasks, waterRecord, todayReview: reviews.find((review) => review.date === today) || null });
  const activityCalendar = getActivityCalendar(84, today);
  const errorThemeWall = (getPrecomputedCache(`dashboard-error-wall:${today}`)?.items || getErrorThemeWall(10, 90, today)).slice(0, 10);

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
    startupPlan,
    reminders,
    activityCalendar,
    errorThemeWall,
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

function getLearningProgressPayload(sessionRole = 'write') {
  ensureSqliteStore();
  const today = todayISO();
  const start30 = addDaysISO(today, -29);
  const start7 = addDaysISO(today, -6);
  const previous7Start = addDaysISO(today, -13);
  const previous7End = addDaysISO(today, -7);
  const targetMinutes = getStudyTargetMinutes();
  const dailyRows = sqliteJson(`SELECT s.date, COALESCE(s.total_minutes, 0) AS minutes, r.score AS reviewScore
FROM study_daily_summaries s
LEFT JOIN daily_reviews r ON r.date = s.date
WHERE s.date BETWEEN ${sqlString(start30)} AND ${sqlString(today)}
ORDER BY s.date ASC;`);
  const dailyByDate = new Map(dailyRows.map((row) => [row.date, row]));
  const daily = dateRange(start30, today).map((date) => {
    const row = dailyByDate.get(date) || {};
    const minutes = Number(row.minutes || 0);
    const reviewScore = row.reviewScore === undefined || row.reviewScore === null ? null : Number(row.reviewScore);
    return { date, minutes, reviewScore, targetMinutes, hitTarget: targetMinutes > 0 && minutes >= targetMinutes };
  });
  const current7Minutes = daily.filter((day) => day.date >= start7).reduce((sum, day) => sum + day.minutes, 0);
  const previous7Minutes = Number(sqliteScalar(`SELECT COALESCE(SUM(minutes), 0) FROM study_time_records WHERE date BETWEEN ${sqlString(previous7Start)} AND ${sqlString(previous7End)};`) || 0);
  const reviewStats = sqliteJson(`SELECT COUNT(*) AS count, AVG(score) AS averageScore FROM daily_reviews WHERE date BETWEEN ${sqlString(start30)} AND ${sqlString(today)};`)[0] || {};
  const taskStats = sqliteJson(`SELECT COUNT(*) AS total, SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) AS completed
FROM short_term_tasks
WHERE due_date BETWEEN ${sqlString(start30)} AND ${sqlString(today)};`)[0] || {};
  const projectTotals = getProjectTotals(start30, today);
  let studyStreakDays = 0;
  for (let offset = 0; offset < 365; offset += 1) {
    const date = addDaysISO(today, -offset);
    const minutes = Number(sqliteScalar(`SELECT COALESCE(total_minutes, 0) FROM study_daily_summaries WHERE date = ${sqlString(date)};`) || 0);
    if (minutes <= 0) break;
    studyStreakDays += 1;
  }
  const completedTasks = Number(taskStats.completed || 0);
  const totalTasks = Number(taskStats.total || 0);
  return {
    summary: {
      today,
      current7Minutes,
      previous7Minutes,
      current30Minutes: daily.reduce((sum, day) => sum + day.minutes, 0),
      studyStreakDays,
      targetHitDays: daily.filter((day) => day.hitTarget).length,
      targetDays: daily.length,
      averageReviewScore: reviewStats.averageScore === null || reviewStats.averageScore === undefined ? null : Math.round(Number(reviewStats.averageScore) * 10) / 10,
      reviewCount: Number(reviewStats.count || 0),
      completedTasks,
      totalTasks,
      taskCompletionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : null,
      topProject: projectTotals[0] || null,
    },
    daily,
    projectTotals,
    reviewTrend: daily.map((day) => ({ date: day.date, score: day.reviewScore })),
    readOnly: sessionRole === 'read',
  };
}

function momentumLabel(current, previous) {
  if (current > previous * 1.08) return 'up';
  if (current < previous * 0.92) return 'down';
  return 'flat';
}

function getProjectProgressPayload(sessionRole = 'write') {
  ensureSqliteStore();
  const today = todayISO();
  const start30 = addDaysISO(today, -29);
  const start7 = addDaysISO(today, -6);
  const previous7Start = addDaysISO(today, -13);
  const previous7End = addDaysISO(today, -7);
  const projects = sqliteJson(`SELECT id, name, color, is_active AS isActive, sort_order AS sortOrder
FROM study_projects
ORDER BY is_active DESC, sort_order ASC, id ASC;`);
  const totals = sqliteJson(`SELECT project_id AS projectId,
SUM(minutes) AS totalMinutes,
SUM(CASE WHEN date BETWEEN ${sqlString(start30)} AND ${sqlString(today)} THEN minutes ELSE 0 END) AS last30Minutes,
SUM(CASE WHEN date BETWEEN ${sqlString(start7)} AND ${sqlString(today)} THEN minutes ELSE 0 END) AS last7Minutes,
SUM(CASE WHEN date BETWEEN ${sqlString(previous7Start)} AND ${sqlString(previous7End)} THEN minutes ELSE 0 END) AS previous7Minutes,
MAX(date) AS lastStudiedAt,
COUNT(*) AS recordCount
FROM study_time_records
GROUP BY project_id;`);
  const totalByProject = new Map(totals.map((row) => [Number(row.projectId), row]));
  const last30Total = totals.reduce((sum, row) => sum + Number(row.last30Minutes || 0), 0);
  const items = projects.map((project) => {
    const row = totalByProject.get(Number(project.id)) || {};
    const last30Minutes = Number(row.last30Minutes || 0);
    return {
      id: Number(project.id),
      name: project.name,
      color: project.color,
      isActive: Boolean(project.isActive),
      totalMinutes: Number(row.totalMinutes || 0),
      last30Minutes,
      last7Minutes: Number(row.last7Minutes || 0),
      lastStudiedAt: row.lastStudiedAt || null,
      recordCount: Number(row.recordCount || 0),
      sharePercent: last30Total ? Math.round((last30Minutes / last30Total) * 100) : 0,
      momentum: momentumLabel(Number(row.last7Minutes || 0), Number(row.previous7Minutes || 0)),
    };
  });
  const daily = getLastNDaysTotals(30, today);
  const totalMinutes = items.reduce((sum, item) => sum + item.totalMinutes, 0);
  const topProject = items.length
    ? items.map((item) => ({ name: item.name, minutes: item.last30Minutes })).sort((a, b) => b.minutes - a.minutes)[0]
    : null;
  return {
    generatedAt: nowISO(),
    items,
    totals: {
      totalMinutes,
      activeProjects: items.filter((item) => item.isActive).length,
      inactiveProjects: items.filter((item) => !item.isActive).length,
      topProject: topProject && topProject.minutes > 0 ? topProject : null,
    },
    daily,
    readOnly: sessionRole === 'read',
  };
}

function shouldRecordVisit(req) {
  if (req.method !== 'GET') return false;
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (pathname === '/login' || pathname === '/health' || pathname.startsWith('/api/')) return false;
  if (['/manifest.webmanifest', '/service-worker.js', '/app-icon.svg', '/favicon.svg', '/icons.svg'].includes(pathname)) return false;
  return !extname(pathname);
}

function recordVisitEvent(req, role = 'write') {
  if (!shouldRecordVisit(req)) return;
  try {
    ensureSqliteStore();
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 240);
    const clientHash = createHash('sha256').update(`${getClientIp(req)}|${userAgent}`).digest('hex').slice(0, 24);
    runSqlite(`INSERT INTO visit_events (path, method, role, client_hash, user_agent, created_at)
VALUES (${sqlString(requestUrl.pathname)}, ${sqlString(req.method || 'GET')}, ${sqlString(role)}, ${sqlString(clientHash)}, ${sqlString(userAgent)}, ${sqlString(nowISO())});`);
  } catch (error) {
    console.warn('visit event skipped:', error.message || error);
  }
}

function getVisitStatsPayload(sessionRole = 'write') {
  ensureSqliteStore();
  const today = todayISO();
  const start14 = addDaysISO(today, -13);
  const start7 = addDaysISO(today, -6);
  const dailyRows = sqliteJson(`SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS visits, COUNT(DISTINCT client_hash) AS uniqueVisitors
FROM visit_events
WHERE substr(created_at, 1, 10) BETWEEN ${sqlString(start14)} AND ${sqlString(today)}
GROUP BY substr(created_at, 1, 10)
ORDER BY date ASC;`);
  const byDate = new Map(dailyRows.map((row) => [row.date, row]));
  const daily = dateRange(start14, today).map((date) => ({
    date,
    visits: Number(byDate.get(date)?.visits || 0),
    uniqueVisitors: Number(byDate.get(date)?.uniqueVisitors || 0),
  }));
  const total = Number(sqliteScalar('SELECT COUNT(*) FROM visit_events;') || 0);
  const todayCount = Number(sqliteScalar(`SELECT COUNT(*) FROM visit_events WHERE substr(created_at, 1, 10) = ${sqlString(today)};`) || 0);
  const last7 = Number(sqliteScalar(`SELECT COUNT(*) FROM visit_events WHERE substr(created_at, 1, 10) BETWEEN ${sqlString(start7)} AND ${sqlString(today)};`) || 0);
  const uniqueVisitors7 = Number(sqliteScalar(`SELECT COUNT(DISTINCT client_hash) FROM visit_events WHERE substr(created_at, 1, 10) BETWEEN ${sqlString(start7)} AND ${sqlString(today)};`) || 0);
  const topPaths = sqliteJson(`SELECT path, COUNT(*) AS visits
FROM visit_events
WHERE substr(created_at, 1, 10) BETWEEN ${sqlString(start14)} AND ${sqlString(today)}
GROUP BY path
ORDER BY visits DESC, path ASC
LIMIT 8;`).map((row) => ({ path: row.path, visits: Number(row.visits || 0) }));
  const latest = sqliteJson(`SELECT path, role, user_agent AS userAgent, created_at AS createdAt
FROM visit_events
ORDER BY created_at DESC
LIMIT 12;`).map((row) => ({ path: row.path, role: row.role, userAgent: compactText(row.userAgent || '', 90), createdAt: row.createdAt }));
  return { generatedAt: nowISO(), total, today: todayCount, last7, uniqueVisitors7, daily, topPaths, latest, readOnly: sessionRole === 'read' };
}

function redactLogLine(line = '') {
  return String(line)
    .replace(/(password|passwd|token|secret|cookie|authorization)(=|:)\s*[^,\s;]+/gi, '$1$2 [redacted]')
    .replace(/exam_planner_session=[^;\s]+/gi, 'exam_planner_session=[redacted]')
    .replace(/APP_PASSWORD=[^,\s;]+/gi, 'APP_PASSWORD=[redacted]')
    .slice(0, 500);
}

function summarizeLogLines(name, lines, error = '') {
  const cleanLines = lines.filter(Boolean).slice(-80).map(redactLogLine);
  const errorCount = cleanLines.filter((line) => /error|failed|exception|fatal/i.test(line)).length;
  const warningCount = cleanLines.filter((line) => /warn|warning|deprecated/i.test(line)).length;
  return {
    name,
    available: !error,
    error: error || undefined,
    errorCount,
    warningCount,
    action: error
      ? '检查日志读取权限或对应服务状态'
      : errorCount
        ? '检查近期错误并确认核心功能是否受影响'
        : '',
    observation: !error && !errorCount && warningCount ? '发现少量 warning，暂列观察，不触发处理项' : '',
  };
}

function readTailFile(filePath, maxLines = 80) {
  if (!existsSync(filePath)) return { lines: [], error: 'file not found' };
  const text = readFileSync(filePath, 'utf8');
  return { lines: text.split(/\r?\n/).slice(-maxLines), error: '' };
}

function getOpsLogSummaryPayload(sessionRole = 'write') {
  ensureSqliteStore();
  const sources = [];
  const journal = spawnSync('journalctl', ['-u', 'exam-planner', '-n', '120', '--no-pager'], { encoding: 'utf8', timeout: 5000, maxBuffer: 512 * 1024 });
  if (journal.error || journal.status !== 0) {
    sources.push(summarizeLogLines('systemd:exam-planner', [], journal.error?.message || journal.stderr || 'journalctl unavailable'));
  } else {
    sources.push(summarizeLogLines('systemd:exam-planner', journal.stdout.split(/\r?\n/)));
  }
  for (const [name, filePath] of [['nginx:access', '/var/log/nginx/access.log'], ['nginx:error', '/var/log/nginx/error.log']]) {
    try {
      const result = readTailFile(filePath);
      sources.push(summarizeLogLines(name, result.lines, result.error));
    } catch (error) {
      sources.push(summarizeLogLines(name, [], error.message || String(error)));
    }
  }
  const auditEvents = opsRepository.listAuditEvents(12);
  const slowApi = opsRepository.listSlowApi(12);
  const apiMetrics = opsRepository.getApiMetrics();
  return { generatedAt: nowISO(), sources, auditEvents, slowApi, apiMetrics, readOnly: sessionRole === 'read' };
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

function clientHashForRequest(req) {
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 240);
  return createHash('sha256').update(`${getClientIp(req)}|${userAgent}`).digest('hex').slice(0, 24);
}

function logStructured(level, event, fields = {}) {
  const payload = { level, event, at: nowISO(), ...fields };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function writeAuditEvent({ action, req = null, actorRole = '', detail = {} }) {
  try {
    ensureSqliteStore();
    runSqlite(`INSERT INTO audit_events (action, actor_role, client_hash, detail_json, created_at)
VALUES (${sqlString(action)}, ${sqlString(actorRole || (req ? getSessionRole(req.headers.cookie) || '' : 'system'))}, ${sqlString(req ? clientHashForRequest(req) : 'system')}, ${sqlString(JSON.stringify(detail || {}))}, ${sqlString(nowISO())});`);
  } catch (error) {
    logStructured('warn', 'audit_write_failed', { action, error: redactSecretText(error.message || String(error)) });
  }
}

function writeApiRequestLog({ req, statusCode, durationMs, role = '', error = '' }) {
  if (durationMs < requestLogSlowMs && statusCode < 500 && !error) return;
  try {
    ensureSqliteStore();
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    runSqlite(`INSERT INTO api_request_log (method, path, status_code, duration_ms, role, error, created_at)
VALUES (${sqlString(req.method || 'GET')}, ${sqlString(pathname)}, ${sqlValue(statusCode)}, ${sqlValue(Math.round(durationMs))}, ${sqlString(role || '')}, ${sqlString(redactSecretText(error))}, ${sqlString(nowISO())});`);
  } catch (logError) {
    logStructured('warn', 'api_request_log_failed', { error: redactSecretText(logError.message || String(logError)) });
  }
}

const activeTaskLocks = new Set();

function lastTaskRuns(limit = 12) {
  try {
    return taskRunsRepository.listLatest(limit);
  } catch {
    return [];
  }
}

async function runExclusiveTask(taskName, trigger, taskFn, { timeoutMs = 15 * 60 * 1000, metadata = {} } = {}) {
  ensureSqliteStore();
  if (activeTaskLocks.has(taskName)) {
    return { ok: false, skipped: true, reason: 'already running', taskName };
  }
  activeTaskLocks.add(taskName);
  const startedAt = nowISO();
  const startedMs = Date.now();
  const taskId = Number(sqliteScalar(`INSERT INTO task_runs (task_name, trigger, status, started_at, metadata_json)
VALUES (${sqlString(taskName)}, ${sqlString(trigger)}, 'running', ${sqlString(startedAt)}, ${sqlString(JSON.stringify(metadata || {}))})
RETURNING id;`) || 0);
  let timeoutId;
  try {
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`${taskName} timed out after ${timeoutMs}ms`)), timeoutMs);
      timeoutId.unref?.();
    });
    const result = await Promise.race([Promise.resolve().then(taskFn), timeout]);
    const durationMs = Date.now() - startedMs;
    runSqlite(`UPDATE task_runs SET status = 'completed', finished_at = ${sqlString(nowISO())}, duration_ms = ${sqlValue(durationMs)}, metadata_json = ${sqlString(JSON.stringify({ ...(metadata || {}), result: result ?? null }))}
WHERE id = ${sqlValue(taskId)};`);
    return { ok: true, taskName, taskId, durationMs, result };
  } catch (error) {
    const durationMs = Date.now() - startedMs;
    const message = redactSecretText(error.message || String(error));
    runSqlite(`UPDATE task_runs SET status = 'failed', finished_at = ${sqlString(nowISO())}, duration_ms = ${sqlValue(durationMs)}, error = ${sqlString(message)}
WHERE id = ${sqlValue(taskId)};`);
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    activeTaskLocks.delete(taskName);
  }
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

function readBody(req, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    let body = '';
    let size = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        if (!rejected) {
          rejected = true;
          const error = new Error('Request body is too large');
          error.statusCode = 413;
          rejectBody(error);
        }
        return;
      }
      if (!rejected) body += chunk.toString('utf8');
    });
    req.on('error', (error) => {
      if (!rejected) {
        rejected = true;
        rejectBody(error);
      }
    });
    req.on('end', () => {
      if (!rejected) resolveBody(body);
    });
  });
}

async function readJsonBody(req) {
  const body = await readBody(req, jsonBodyMaxBytes);
  if (!body) return {};
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    const error = new Error('Invalid JSON body');
    error.statusCode = 400;
    throw error;
  }
  if (parsed !== null && typeof parsed === 'object') return parsed;
  const error = new Error('JSON body must be an object or array');
  error.statusCode = 400;
  throw error;
}

function readRawBody(req, maxBytes = libraryUploadMaxBytes) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        rejected = true;
        const error = new Error('Uploaded file is too large');
        error.statusCode = 413;
        rejectBody(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (error) => {
      if (!rejected) rejectBody(error);
    });
    req.on('end', () => {
      if (!rejected) resolveBody(Buffer.concat(chunks, size));
    });
  });
}

function parseMultipartForm(buffer, contentType = '') {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    const error = new Error('Missing multipart boundary');
    error.statusCode = 400;
    throw error;
  }
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const fields = {};
  const files = {};
  let cursor = 0;

  while (cursor < buffer.length) {
    const boundaryIndex = buffer.indexOf(boundary, cursor);
    if (boundaryIndex < 0) break;
    cursor = boundaryIndex + boundary.length;
    if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) break;
    if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) cursor += 2;

    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd < 0) break;
    const headerText = buffer.slice(cursor, headerEnd).toString('utf8');
    const disposition = headerText.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || '';
    const name = disposition.match(/name="([^"]+)"/i)?.[1] || '';
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1] || '';
    const partContentType = headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || 'application/octet-stream';
    const partStart = headerEnd + 4;
    const nextBoundary = buffer.indexOf(boundary, partStart);
    if (!name || nextBoundary < 0) break;
    let partEnd = nextBoundary;
    if (buffer[partEnd - 2] === 13 && buffer[partEnd - 1] === 10) partEnd -= 2;
    const data = buffer.slice(partStart, partEnd);
    if (filename) {
      files[name] = { filename, contentType: partContentType, data };
    } else {
      fields[name] = data.toString('utf8');
    }
    cursor = nextBoundary;
  }

  return { fields, files };
}

function uploadLibraryBookFromMultipart(fields, files) {
  const file = files.file || files.book || Object.values(files)[0];
  if (!file?.data?.length) {
    const error = new Error('Missing upload file');
    error.statusCode = 400;
    throw error;
  }
  const fileType = libraryFileType(file.filename);
  if (!fileType) {
    const error = new Error('Only pdf, epub, txt and md files are supported');
    error.statusCode = 400;
    throw error;
  }
  ensureSqliteStore();
  const timestamp = nowISO();
  const id = nextTableId('library_books');
  const originalFileName = safeFileName(file.filename || `book.${fileType}`);
  const title = String(fields.title || originalFileName.replace(/\.[^.]+$/, '') || '未命名资料').trim();
  const author = String(fields.author || '').trim();
  const category = String(fields.category || '未分类').trim() || '未分类';
  const tags = parseTags(fields.tags || '');
  const mimeType = file.contentType && file.contentType !== 'application/octet-stream' ? file.contentType : libraryMimeType(fileType);
  const bookDir = join(libraryFilesDir, `book-${id}`);
  mkdirSync(bookDir, { recursive: true });
  const storagePath = join(bookDir, `original.${fileType}`);
  writeFileSync(storagePath, file.data);
  runSqlite(`INSERT INTO library_books (
  id, title, author, category, tags_json, original_file_name, file_type, mime_type, file_size, storage_path,
  text_status, text_error, progress_percent, last_locator, is_favorite, is_archived, schema_version, created_at, updated_at
) VALUES (
  ${sqlValue(id)}, ${sqlString(title)}, ${sqlString(author)}, ${sqlString(category)}, ${sqlString(JSON.stringify(tags))},
  ${sqlString(originalFileName)}, ${sqlString(fileType)}, ${sqlString(mimeType)}, ${sqlValue(file.data.length)},
  ${sqlString(storagePath)}, 'pending', '', 0, '', 0, 0, ${sqlValue(entitySchemaVersion)}, ${sqlString(timestamp)}, ${sqlString(timestamp)}
);`);
  tableChanged();
  const timer = setTimeout(() => indexLibraryBookText(id), 80);
  if (typeof timer.unref === 'function') timer.unref();
  return getLibraryBookDetail(id);
}

function serveLibraryFile(req, res, id, sessionRole = 'write') {
  ensureSqliteStore();
  const book = getLibraryBookById(id);
  const filePath = getLibraryStoragePath(id);
  if (!book || !filePath || !existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  if (sessionRole !== 'read') {
    saveLibraryProgress({ bookId: id, locator: book.lastLocator || '', progressPercent: book.progressPercent || 0 });
  }
  const stat = statSync(filePath);
  const range = req.headers.range;
  const headers = {
    'content-type': book.mimeType || libraryMimeType(book.fileType),
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=3600',
  };
  if (range) {
    const match = String(range).match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || end < start) {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${stat.size}`,
    });
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': stat.size });
  createReadStream(filePath).pipe(res);
}

function headerString(req, name) {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function isObjectPayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function safeSecretEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function clawbotRequestSecret(req, requestUrl, body = {}) {
  const auth = headerString(req, 'authorization');
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  return String(
    headerString(req, 'x-clawbot-secret') ||
    bearer ||
    requestUrl.searchParams.get('secret') ||
    (isObjectPayload(body) ? body.secret || body.token : '') ||
    '',
  ).trim();
}

function validateClawbotAccess(req, requestUrl, body = {}) {
  if (!clawbotSecret) {
    return { ok: false, status: 503, error: 'ClawBot adapter is disabled. Set CLAWBOT_SECRET first.' };
  }
  if (!safeSecretEqual(clawbotRequestSecret(req, requestUrl, body), clawbotSecret)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}

function extractClawbotMessage(body, requestUrl) {
  const queryMessage = requestUrl.searchParams.get('text') || requestUrl.searchParams.get('message') || '';
  if (queryMessage) return queryMessage;
  if (typeof body === 'string') return body;
  if (!isObjectPayload(body)) return '';
  for (const key of ['text', 'content', 'message', 'msg', 'rawMessage']) {
    if (typeof body[key] === 'string' && body[key].trim()) return body[key];
  }
  for (const key of ['data', 'event', 'payload']) {
    const nested = body[key];
    if (!isObjectPayload(nested)) continue;
    for (const nestedKey of ['text', 'content', 'message', 'msg', 'rawMessage']) {
      if (typeof nested[nestedKey] === 'string' && nested[nestedKey].trim()) return nested[nestedKey];
    }
  }
  return '';
}

function normalizeClawbotDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : todayISO();
}

function clawbotMinutesText(minutes) {
  const value = Math.max(0, Number(minutes || 0));
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (hours && rest) return `${hours} 小时 ${rest} 分钟`;
  if (hours) return `${hours} 小时`;
  return `${rest} 分钟`;
}

function normalizeClawbotTask(row) {
  const task = normalizeTaskRow(row);
  return {
    id: Number(row.id),
    title: task.title,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    urgency: task.urgency || 'medium',
    isCompleted: task.isCompleted,
    completedAt: task.completedAt || null,
    reminderEnabled: task.reminderEnabled,
    reminderSentOffsets: task.reminderSentOffsets,
    reminderLastSentAt: task.reminderLastSentAt || null,
    note: task.note || '',
  };
}

function clawbotUrgencyLabel(urgency) {
  if (urgency === 'high') return '高';
  if (urgency === 'low') return '低';
  return '中';
}

function taskLetterLabel(index) {
  const value = Math.max(0, Number(index) || 0);
  return String.fromCharCode(65 + (value % 26));
}

function taskLabelIndex(value) {
  const text = String(value || '').trim();
  if (!/^[A-Z]$/i.test(text)) return null;
  return text.toUpperCase().charCodeAt(0) - 65;
}

function formatClawbotTask(task, index = 0) {
  const prefix = index >= 0 ? `${taskLetterLabel(index)}. ` : '';
  const status = task.isCompleted ? '已完成' : task.dueDate < todayISO() ? '逾期' : '未完成';
  const due = task.dueTime ? `${task.dueDate} ${task.dueTime}` : task.dueDate;
  return `${prefix}${task.title}｜${due}｜${clawbotUrgencyLabel(task.urgency)}｜${status}`;
}

function taskSearchPattern(keyword) {
  const cleaned = String(keyword || '').replace(/[%_]/g, '').trim().slice(0, 80);
  return cleaned ? `%${cleaned}%` : '';
}

function listClawbotTasks({ range = 'today', date = todayISO(), limit = 30 } = {}) {
  ensureSqliteStore();
  const endDate = range === 'week' ? endOfWeekISO(date) : date;
  return sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency, is_completed AS isCompleted,
completed_at AS completedAt, reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt, note
FROM short_term_tasks
WHERE is_completed = 0 AND due_date <= ${sqlString(endDate)}
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date, due_time, id
LIMIT ${Math.max(1, Math.min(50, Number(limit) || 30))};`).map(normalizeClawbotTask);
}

function listClawbotLabelTasks({ limit = 26 } = {}) {
  ensureSqliteStore();
  return sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency, is_completed AS isCompleted,
completed_at AS completedAt, reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt, note
FROM short_term_tasks
WHERE is_completed = 0
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date, due_time, id
LIMIT ${Math.max(1, Math.min(26, Number(limit) || 26))};`).map(normalizeClawbotTask);
}

function findClawbotTasks(keyword, { includeCompleted = false, limit = 6 } = {}) {
  ensureSqliteStore();
  const text = String(keyword || '').trim();
  if (!text) return [];
  const statusClause = includeCompleted ? '' : 'AND is_completed = 0';
  const labelIndex = taskLabelIndex(text);
  if (labelIndex !== null) {
    const labeled = listClawbotLabelTasks({ limit: 26 })[labelIndex];
    return labeled ? [labeled] : [];
  }
  const id = text.match(/^#?(\d+)$/)?.[1];
  if (id) {
    return sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency, is_completed AS isCompleted,
completed_at AS completedAt, reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt, note
FROM short_term_tasks
WHERE id = ${sqlValue(Number(id))} ${statusClause}
LIMIT 1;`).map(normalizeClawbotTask);
  }
  const pattern = taskSearchPattern(text);
  if (!pattern) return [];
  return sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency, is_completed AS isCompleted,
completed_at AS completedAt, reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt, note
FROM short_term_tasks
WHERE title LIKE ${sqlString(pattern)} ${statusClause}
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date, due_time, id
LIMIT ${Math.max(1, Math.min(20, Number(limit) || 6))};`).map(normalizeClawbotTask);
}

function buildClawbotTaskListReply(range, tasks) {
  const title = range === 'week' ? '本周未完成待办' : '今日未完成待办';
  if (!tasks.length) return `${title}：暂无。`;
  return `${title}：\n${tasks.map((task, index) => formatClawbotTask(task, index)).join('\n')}`;
}

function clawbotSection(title, lines = []) {
  const items = lines.filter(Boolean);
  return items.length ? [`【${title}】`, ...items] : [];
}

function buildClawbotBriefReply(brief, notificationMetrics = { open: 0, warnings: 0, critical: 0 }) {
  if (!brief?.payload) return '简报：暂未生成。';
  const payload = brief.payload;
  const weather = payload.weather || {};
  const learning = payload.learning || {};
  const markets = Array.isArray(payload.markets) ? payload.markets : [];
  const indexPurchaseAssessment = payload.indexPurchaseAssessment || {};
  const tasks = Array.isArray(learning.todayTasks) ? learning.todayTasks : [];
  const weatherLine = weather.ok
    ? `${weather.cityName || ''}：${weather.condition || ''}，${weather.temperature ?? '--'}℃，${weather.minTemperature ?? '--'}-${weather.maxTemperature ?? '--'}℃，降水概率 ${weather.precipitationProbability ?? 0}%`
    : `天气获取失败：${weather.error || '未知错误'}`;
  const learningLines = [
    `昨日学习：${clawbotMinutesText(learning.yesterdayMinutes || 0)}`,
    `近 7 天累计：${clawbotMinutesText(learning.last7Minutes || 0)}`,
    learning.activeGoal ? `目标：${learning.activeGoal.name}，剩余 ${learning.activeGoal.daysLeft} 天` : '目标：暂无启用中的长期目标',
    learning.yesterdayReview?.problems ? `昨日问题：${compactText(learning.yesterdayReview.problems, 120)}` : '',
  ];
  const taskLines = tasks.length
    ? tasks.map((task, index) => `${taskLetterLabel(index)}. ${task.title}｜${task.dueTime ? `${task.dueDate} ${task.dueTime}` : task.dueDate}｜${clawbotUrgencyLabel(task.urgency)}`)
    : ['今天没有到期待办。'];
  const marketLines = markets.length
    ? markets.map((item) => item.ok
      ? `- ${item.name}：${item.price}（${item.changePercent ?? 0}%）`
      : `- ${item.name}：更新失败 ${item.error || ''}`)
    : ['暂无指数配置。'];
  const assessmentLines = Array.isArray(indexPurchaseAssessment.items) && indexPurchaseAssessment.items.length
    ? indexPurchaseAssessment.items.map((item) => item.ok
      ? `- ${item.name}：${item.signal}｜PE ${item.pe}（5 年百分位 ${item.pePercentile5}% / 10 年 ${item.pePercentile10}%）｜距 50/200 日均线 ${item.sma50Margin}%/${item.sma200Margin}%｜${item.intensity}`
      : `- ${item.name}：评估失败 ${item.error || ''}`)
    : ['暂无定投评估数据。'];
  const notificationLines = notificationMetrics.open
    ? [`待处理 ${notificationMetrics.open} 条，其中 warning ${notificationMetrics.warnings}，critical ${notificationMetrics.critical}`]
    : ['暂无待处理通知。'];
  const lines = [
    `${payload.title}`,
    `生成时间：${new Date(payload.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    '',
    ...clawbotSection('天气', [weatherLine]),
    '',
    ...clawbotSection('学习', learningLines),
    '',
    ...clawbotSection('今日待办', taskLines),
    '',
    ...clawbotSection('指数', marketLines),
    '',
    ...clawbotSection('美股指数定投评估', [
      ...assessmentLines,
      indexPurchaseAssessment.disclaimer || '',
    ]),
    '',
    ...clawbotSection('通知', notificationLines),
    '',
    '可回复：待办 明天 高 背单词 / 完成 背单词 / 今日待办 / 帮助',
  ];
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildClawbotDailyDigest(date = todayISO()) {
  ensureSqliteStore();
  const taskList = listClawbotTasks({ range: 'today', date, limit: 8 });
  const latestBrief = getDailyBriefByDate(date) || getLatestDailyBriefSummary();
  const notificationMetrics = notificationRepository.metrics();
  let brief = latestBrief;
  if (brief?.payload && date === todayISO()) {
    brief = {
      ...brief,
      payload: {
        ...brief.payload,
        learning: {
          ...(brief.payload.learning || {}),
          todayTasks: taskList.map((task) => ({
            id: task.id,
            title: task.title,
            dueDate: task.dueDate,
            dueTime: task.dueTime,
            urgency: task.urgency,
            isCompleted: Boolean(task.isCompleted),
          })),
        },
      },
    };
  }
  const text = brief ? buildClawbotBriefReply(brief, notificationMetrics) : '简报：暂未生成。';
  return { date, text, tasks: taskList, notificationMetrics, brief };
}

function ambiguousClawbotReply(action, matches) {
  return `找到多个可${action}的待办，请说得更具体，或使用 #ID：\n${matches.map((task, index) => `#${task.id} ${formatClawbotTask(task, index)}`).join('\n')}`;
}

async function executeClawbotCommand(command, req) {
  if (command.type === 'help') return { ok: true, reply: clawbotHelpText, command };
  if (command.type === 'unknown') return { ok: false, reply: `${command.help}\n\n未识别原因：${command.reason}`, command };
  if (command.type === 'daily_digest') {
    const digest = buildClawbotDailyDigest(todayISO());
    return { ok: true, reply: digest.text, digest, command };
  }
  if (command.type === 'list_tasks') {
    const tasks = listClawbotTasks({ range: command.range, date: todayISO() });
    return { ok: true, reply: buildClawbotTaskListReply(command.range, tasks), tasks, command };
  }
  if (command.type === 'create_task') {
    const id = saveTaskSql({
      title: command.title,
      dueDate: command.dueDate,
      urgency: command.urgency,
      note: 'Created by ClawBot rule command',
      isCompleted: false,
      dueTime: command.dueTime,
      reminderEnabled: Boolean(command.dueTime),
    });
    writeAuditEvent({ action: 'clawbot_task_create', req, actorRole: 'clawbot', detail: { id, dueDate: command.dueDate, dueTime: command.dueTime, urgency: command.urgency } });
    const due = command.dueTime ? `${command.dueDate} ${command.dueTime}` : command.dueDate;
    return {
      ok: true,
      reply: `已添加待办：#${id} ${command.title}｜${due}｜${clawbotUrgencyLabel(command.urgency)}`,
      task: { id, title: command.title, dueDate: command.dueDate, dueTime: command.dueTime, urgency: command.urgency },
      command,
    };
  }
  if (command.type === 'complete_task') {
    const matches = findClawbotTasks(command.keyword);
    if (!matches.length) return { ok: false, reply: `没有找到未完成待办：${command.keyword}`, command };
    if (matches.length > 1) return { ok: false, reply: ambiguousClawbotReply('完成', matches), matches, command };
    const task = matches[0];
    const timestamp = nowISO();
    runSqlite(`UPDATE short_term_tasks
SET is_completed = 1, completed_at = ${sqlString(timestamp)}, updated_at = ${sqlString(timestamp)}
WHERE id = ${sqlValue(task.id)};`);
    tableChanged();
    writeAuditEvent({ action: 'clawbot_task_complete', req, actorRole: 'clawbot', detail: { id: task.id } });
    return { ok: true, reply: `已完成待办：#${task.id} ${task.title}`, task: { ...task, isCompleted: true, completedAt: timestamp }, command };
  }
  if (command.type === 'delete_task') {
    const matches = findClawbotTasks(command.keyword, { includeCompleted: true });
    if (!matches.length) return { ok: false, reply: `没有找到待办：${command.keyword}`, command };
    if (matches.length > 1) return { ok: false, reply: ambiguousClawbotReply('删除', matches), matches, command };
    const task = matches[0];
    runSqlite(`DELETE FROM short_term_tasks WHERE id = ${sqlValue(task.id)};`);
    tableChanged();
    writeAuditEvent({ action: 'clawbot_task_delete', req, actorRole: 'clawbot', detail: { id: task.id } });
    return { ok: true, reply: `已删除待办：#${task.id} ${task.title}`, task, command };
  }
  return { ok: false, reply: clawbotHelpText, command };
}

function readJsonFileSafe(filePath, fallback = null) {
  try {
    if (!filePath || !existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function findNestedStringByKey(value, preferredKeys) {
  if (!value || typeof value !== 'object') return '';
  const normalizedKeys = new Set(preferredKeys.map((key) => key.toLowerCase()));
  for (const [key, nested] of Object.entries(value)) {
    if (normalizedKeys.has(key.toLowerCase()) && typeof nested === 'string' && nested.trim()) {
      return nested.trim();
    }
  }
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') {
      const result = findNestedStringByKey(nested, preferredKeys);
      if (result) return result;
    }
  }
  return '';
}

function detectOpenClawAccountId() {
  if (openClawAccountId) return openClawAccountId;
  try {
    if (!existsSync(openClawAccountDir)) return '';
    const files = readdirSync(openClawAccountDir)
      .filter((file) => file.endsWith('.json') && !file.includes('context-token'))
      .sort((left, right) => Number(right.includes('-im-bot')) - Number(left.includes('-im-bot')) || left.localeCompare(right));
    return files[0]?.replace(/\.json$/i, '') || '';
  } catch {
    return '';
  }
}

function resolveOpenClawWechatConfig({ includeSecret = false } = {}) {
  const accountId = detectOpenClawAccountId();
  const accountPath = accountId ? join(openClawAccountDir, `${accountId}.json`) : '';
  const contextPath = accountId ? join(openClawAccountDir, `${accountId}.context-tokens.json`) : '';
  const account = readJsonFileSafe(accountPath, {});
  const contextTokens = readJsonFileSafe(contextPath, {});
  const contextKeys = contextTokens && typeof contextTokens === 'object' && !Array.isArray(contextTokens) ? Object.keys(contextTokens) : [];
  const target = openClawTarget
    || contextKeys.find((key) => key && !key.startsWith('_'))
    || findNestedStringByKey(account, ['userId', 'wxid', 'openId', 'openid', 'target', 'fromUserName', 'userName', 'username']) || '';
  const contextEntry = target && isObjectPayload(contextTokens) ? contextTokens[target] : null;
  const contextToken = (typeof contextEntry === 'string' ? contextEntry : '')
    || findNestedStringByKey(contextEntry, ['contextToken', 'token'])
    || findNestedStringByKey(contextTokens, ['contextToken']);
  const status = {
    enabled: Boolean(getDailyBriefSettings({ includeSecret: true }).wechat.enabled),
    configured: Boolean(accountId && target && contextToken),
    channel: openClawChannel,
    accountId,
    accountDirExists: existsSync(openClawAccountDir),
    accountFileExists: Boolean(accountPath && existsSync(accountPath)),
    targetConfigured: Boolean(target),
    hasContextToken: Boolean(contextToken),
    cli: openClawCli,
    nextPushAt: nextDailyBriefAt,
    scheduleTime: getDailyBriefSettings({ includeSecret: true }).generateTime,
  };
  return includeSecret ? {
    ...status,
    target,
    contextToken,
    accountToken: account.token || '',
    baseUrl: account.baseUrl || 'https://ilinkai.weixin.qq.com',
  } : status;
}

let openClawWeixinSendModulePath = '';

function detectOpenClawWeixinSendModulePath() {
  if (openClawWeixinSendModulePath && existsSync(openClawWeixinSendModulePath)) return openClawWeixinSendModulePath;
  if (!existsSync(openClawNpmProjectsDir)) return '';
  for (const project of readdirSync(openClawNpmProjectsDir)) {
    const candidate = join(openClawNpmProjectsDir, project, 'node_modules', '@tencent-weixin', 'openclaw-weixin', 'dist', 'src', 'messaging', 'send.js');
    if (existsSync(candidate)) {
      openClawWeixinSendModulePath = candidate;
      return candidate;
    }
  }
  return '';
}

async function sendOpenClawWechatDirect(config, text) {
  const modulePath = detectOpenClawWeixinSendModulePath();
  if (!modulePath || !config.accountToken) throw new Error('OpenClaw Weixin direct sender is unavailable');
  return new Promise((resolveSend, rejectSend) => {
    const child = spawn('/opt/node22/bin/node', [openClawWeixinSenderFile], {
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, result = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectSend(error);
      else resolveSend(result);
    };
    const timer = setTimeout(() => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      finish(new Error('OpenClaw Weixin direct sender timed out'));
    }, 25_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 64 * 1024) stdout = stdout.slice(-64 * 1024);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-64 * 1024);
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code !== 0) {
        finish(new Error(redactSecretText(stderr || stdout || `direct sender exited with code ${code}`)));
        return;
      }
      try {
        finish(null, JSON.parse(stdout || '{}'));
      } catch {
        finish(new Error('OpenClaw Weixin direct sender returned invalid JSON'));
      }
    });
    child.stdin.end(JSON.stringify({
      modulePath,
      to: config.target,
      text: String(text || '').slice(0, 3500),
      baseUrl: config.baseUrl,
      token: config.accountToken,
      contextToken: config.contextToken,
    }));
  });
}

function runOpenClawCli(args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolveCli) => {
    const child = spawn(openClawCli, args, {
      env: {
        ...process.env,
        PATH: `/opt/node22/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
      },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveCli({
        ...result,
        stdout: redactSecretText(stdout).slice(0, 2000),
        stderr: redactSecretText(stderr).slice(0, 2000),
      });
    };
    const timer = setTimeout(() => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      finish({ ok: false, code: -1, error: 'openclaw message send timed out' });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 1024 * 1024) stdout = stdout.slice(-1024 * 1024);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 1024 * 1024) stderr = stderr.slice(-1024 * 1024);
    });
    child.on('error', (error) => finish({ ok: false, code: -1, error: redactSecretText(error.message || String(error)) }));
    child.on('close', (code) => finish({ ok: code === 0, code, error: code === 0 ? '' : redactSecretText(stderr || stdout || `openclaw exited with code ${code}`) }));
  });
}

async function sendOpenClawWechatMessage(text) {
  const config = resolveOpenClawWechatConfig({ includeSecret: true });
  if (!config.configured) {
    return {
      ok: false,
      method: 'openclaw-weixin',
      error: 'OpenClaw Weixin account, target or context token is not available',
      status: {
        accountId: config.accountId,
        accountDirExists: config.accountDirExists,
        accountFileExists: config.accountFileExists,
        targetConfigured: config.targetConfigured,
        hasContextToken: config.hasContextToken,
      },
    };
  }
  try {
    const result = await sendOpenClawWechatDirect(config, text);
    return {
      ok: true,
      method: 'openclaw-weixin-direct',
      channel: config.channel,
      accountId: config.accountId,
      messageId: result?.messageId || null,
      response: {
        action: 'send',
        channel: config.channel,
        dryRun: false,
        handledBy: 'openclaw-weixin-plugin',
        messageId: result?.messageId || null,
      },
      error: '',
    };
  } catch (error) {
    return {
      ok: false,
      method: 'openclaw-weixin-direct',
      channel: config.channel,
      accountId: config.accountId,
      messageId: null,
      response: null,
      error: redactSecretText(error.message || String(error)),
    };
  }
}

async function sendProactiveClawbotText(text) {
  const openClawStatus = resolveOpenClawWechatConfig({ includeSecret: true });
  if (openClawStatus.configured) return sendOpenClawWechatMessage(text);
  if (clawbotWebhookUrl) return postClawbotWebhook(text);
  return { ok: false, method: 'none', error: 'No ClawBot push channel is configured', status: resolveOpenClawWechatConfig() };
}

function resolveBarkConfig({ includeSecret = false } = {}) {
  const rawServerUrl = String(process.env.BARK_SERVER_URL || 'https://api.day.app').trim().replace(/\/+$/, '');
  const serverUrl = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(rawServerUrl) ? rawServerUrl : 'https://api.day.app';
  const deviceKey = String(process.env.BARK_DEVICE_KEY || '').trim();
  return {
    enabled: Boolean(deviceKey),
    configured: Boolean(deviceKey),
    serverUrl,
    deviceKeyMasked: deviceKey ? `${deviceKey.slice(0, 4)}...${deviceKey.slice(-4)}` : '',
    ...(includeSecret ? { deviceKey } : {}),
  };
}

function barkLevel({ source = '', severity = 'info' } = {}) {
  if (severity === 'critical') return 'critical';
  if (source === 'task' || source === 'ops' || severity === 'warning') return 'timeSensitive';
  if (source === 'brief' || source === 'report') return 'passive';
  return 'active';
}

async function sendBarkNotification(text, delivery) {
  const config = resolveBarkConfig({ includeSecret: true });
  if (!config.configured) return { ok: false, method: 'bark', error: 'Bark is not configured' };
  const payload = delivery?.payload || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${config.serverUrl}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        device_key: config.deviceKey,
        title: String(payload.title || 'Exam Planner').slice(0, 120),
        body: String(text || payload.content || '').slice(0, 4000),
        group: `exam-planner-${String(payload.source || 'system').slice(0, 40)}`,
        level: barkLevel(payload),
        isArchive: '1',
      }),
      signal: controller.signal,
    });
    const responseText = await response.text();
    let responseJson = {};
    try {
      responseJson = responseText ? JSON.parse(responseText) : {};
    } catch {
      responseJson = {};
    }
    if (!response.ok || (responseJson.code && Number(responseJson.code) !== 200)) {
      throw new Error(`Bark HTTP ${response.status}: ${String(responseJson.message || responseText).slice(0, 200)}`);
    }
    return { ok: true, method: 'bark', channel: 'bark_default', response: { code: responseJson.code || response.status } };
  } catch (error) {
    return { ok: false, method: 'bark', channel: 'bark_default', error: redactSecretText(error.message || String(error)) };
  } finally {
    clearTimeout(timer);
  }
}

function applyTelegramProcessEnv(config) {
  Object.entries(config).forEach(([key, value]) => {
    if (value) process.env[key] = value;
    else delete process.env[key];
  });
}

async function telegramApi(method, body = {}, { config = readTelegramConfig(telegramEnvFile), timeoutMs = 15_000 } = {}) {
  if (!config.TELEGRAM_BOT_TOKEN) throw new Error('Telegram Bot Token is not configured');
  const { ProxyAgent } = require('undici');
  const dispatcher = new ProxyAgent(mihomoProxyUrl);
  const response = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    dispatcher,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(`Telegram ${method} failed: ${payload.description || response.status}`);
  return payload.result;
}

async function sendTelegramMessage(text, { chatId, replyMarkup, disableNotification = false } = {}) {
  const config = readTelegramConfig(telegramEnvFile);
  const targetChatId = String(chatId || config.TELEGRAM_CHAT_ID || '');
  if (!targetChatId) throw new Error('Telegram Chat ID is not configured');
  return telegramApi('sendMessage', {
    chat_id: targetChatId,
    text: String(text || '').slice(0, 4096),
    disable_notification: disableNotification,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  }, { config });
}

async function sendTelegramNotification(text, delivery) {
  try {
    await sendTelegramMessage(text, { disableNotification: delivery?.payload?.severity === 'info' });
    return { ok: true, method: 'telegram', channel: 'telegram_default' };
  } catch (error) {
    return { ok: false, method: 'telegram', channel: 'telegram_default', error: redactSecretText(error.message || String(error)) };
  }
}

async function sendProactiveNotification(text, delivery) {
  const plan = resolveProactiveDispatch(delivery, notificationRepository.listChannels(), process.env);
  if (plan.kind === 'bark') return sendBarkNotification(text, delivery);
  if (plan.kind === 'telegram') return sendTelegramNotification(text, delivery);
  if (plan.kind === 'clawbot_weixin') return sendProactiveClawbotText(text);
  return { ok: false, method: plan.kind, channel: plan.channelKey, error: `Unsupported notification channel: ${plan.type || plan.channelKey}` };
}

function queueProactiveNotification({ eventKey, source, severity = 'info', title, content, text, payload = {}, channelKeys = null }) {
  const telegramReady = telegramConfigStatus(readTelegramConfig(telegramEnvFile)).configured;
  const channels = channelKeys || [
    'clawbot_weixin',
    ...(resolveBarkConfig().configured ? ['bark_default'] : []),
    ...(telegramReady ? ['telegram_default'] : []),
  ];
  const deliveries = channels.map((channelKey) => notificationQueue.enqueueProactive({
    eventKey,
    source,
    severity,
    title,
    content,
    text,
    payload,
    channelKey,
  }));
  setImmediate(() => notificationQueue.processDue().catch((error) => {
    logStructured('warn', 'notification_queue_kick_failed', { error: redactSecretText(error.message || String(error)) });
  }));
  return {
    ok: true,
    queued: true,
    mode: 'proactive',
    deliveryId: deliveries[0]?.id || null,
    deliveries: deliveries.map((delivery) => ({ id: delivery.id, channelKey: delivery.channelKey, status: delivery.status })),
    status: deliveries[0]?.status || 'queued',
  };
}

function scheduleNotificationQueue() {
  if (notificationQueueTimer) clearInterval(notificationQueueTimer);
  const scan = () => notificationQueue.processDue().catch((error) => {
    logStructured('warn', 'notification_queue_scan_failed', { error: redactSecretText(error.message || String(error)) });
  });
  scan();
  notificationQueueTimer = setInterval(scan, 30 * 1000);
  notificationQueueTimer.unref?.();
}

async function postClawbotWebhook(text) {
  if (!clawbotWebhookUrl) {
    return { ok: false, error: 'CLAWBOT_WEBHOOK_URL is not configured' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(clawbotWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'exam-planner-clawbot',
        text,
        content: text,
        message: text,
      }),
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`Webhook returned ${response.status}: ${responseText.slice(0, 300)}`);
    return { ok: true, status: response.status, response: responseText.slice(0, 500) };
  } catch (error) {
    return { ok: false, error: redactSecretText(error.message || String(error)) };
  } finally {
    clearTimeout(timer);
  }
}

function chinaDateISO(date = new Date()) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function chinaWallClockUtcMs(dateValue, timeValue) {
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || '')) ? String(dateValue) : '';
  const dueTime = normalizeTaskDueTime(timeValue);
  if (!dueDate || !dueTime) return null;
  const [year, month, day] = dueDate.split('-').map(Number);
  const [hour, minute] = dueTime.split(':').map(Number);
  return Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0);
}

function formatReminderLead(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value >= 60) {
    const hours = Math.floor(value / 60);
    const rest = value % 60;
    return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
  }
  return `${value} 分钟`;
}

function taskCompletionHint(taskId) {
  const tasks = listClawbotLabelTasks({ limit: 26 });
  const index = tasks.findIndex((task) => Number(task.id) === Number(taskId));
  if (index >= 0) return { label: taskLetterLabel(index), command: `完成${taskLetterLabel(index)}` };
  return { label: `#${taskId}`, command: `完成#${taskId}` };
}

function buildTaskReminderText(task, offsetMinutes, dueAtMs) {
  const hint = taskCompletionHint(task.id);
  const due = `${task.dueDate} ${task.dueTime}`;
  const remaining = Math.max(0, Math.round((dueAtMs - Date.now()) / 60000));
  return [
    '【待办提醒】',
    `${hint.label}. ${task.title}`,
    `时间：${due}`,
    `优先级：${clawbotUrgencyLabel(task.urgency)}`,
    `提醒：提前 ${formatReminderLead(offsetMinutes)}，距离开始约 ${formatReminderLead(remaining)}`,
    '',
    `可回复：${hint.command} / 今日待办`,
  ].join('\n');
}

function listTimedReminderTasks(scanDate) {
  const maxForwardDays = 35;
  return sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency, is_completed AS isCompleted,
completed_at AS completedAt, reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt, note
FROM short_term_tasks
WHERE is_completed = 0
  AND reminder_enabled = 1
  AND due_time <> ''
  AND due_date >= ${sqlString(scanDate)}
  AND due_date <= ${sqlString(addDaysISO(scanDate, maxForwardDays))}
ORDER BY due_date, due_time, id;`).map(normalizeClawbotTask);
}

async function processTaskReminders() {
  ensureSqliteStore();
  const settings = getDailyBriefSettings({ includeSecret: true }).taskReminders;
  if (!settings?.enabled) return { ok: true, sent: 0, skipped: 'disabled' };
  const offsets = normalizeTaskReminderSettings(settings).offsetsMinutes;
  if (!offsets.length) return { ok: true, sent: 0, skipped: 'no_offsets' };
  const nowMs = Date.now();
  const scanDate = chinaDateISO(new Date(nowMs - Math.max(...offsets) * 60 * 1000));
  const tasks = listTimedReminderTasks(scanDate);
  let sent = 0;
  for (const task of tasks) {
    const dueAtMs = chinaWallClockUtcMs(task.dueDate, task.dueTime);
    if (!dueAtMs || nowMs >= dueAtMs) continue;
    const sentOffsets = normalizeReminderSentOffsets(task.reminderSentOffsets);
    const dueOffsets = offsets
      .filter((offset) => !sentOffsets.includes(offset))
      .filter((offset) => nowMs >= dueAtMs - offset * 60 * 1000)
      .sort((a, b) => a - b);
    const offset = dueOffsets[0];
    if (typeof offset !== 'number') continue;
    const delivery = queueProactiveNotification({
      eventKey: `task-reminder:${task.id}:${offset}:${task.dueDate}`,
      source: 'task',
      title: `待办提醒：${task.title}`,
      content: `待办提醒已进入微信主动推送队列，提前 ${offset} 分钟提醒。`,
      text: buildTaskReminderText(task, offset, dueAtMs),
      payload: { taskId: task.id, offset, dueDate: task.dueDate, dueTime: task.dueTime },
    });
    const timestamp = nowISO();
    const nextOffsets = normalizeReminderSentOffsets([...sentOffsets, offset]);
    runSqlite(`UPDATE short_term_tasks
SET reminder_sent_offsets = ${sqlString(JSON.stringify(nextOffsets))},
    reminder_last_sent_at = ${sqlString(timestamp)},
    updated_at = ${sqlString(timestamp)}
WHERE id = ${sqlValue(task.id)};`);
    tableChanged();
    sent += 1;
    logStructured('info', 'task_reminder_queued', { taskId: task.id, offset, deliveryId: delivery.deliveryId });
  }
  return { ok: true, sent };
}

function scheduleTaskReminderScan() {
  if (taskReminderTimer) clearInterval(taskReminderTimer);
  const scan = () => {
    nextTaskReminderScanAt = new Date(Date.now() + 60 * 1000).toISOString();
    processTaskReminders().catch((error) => {
      logStructured('error', 'task_reminder_scan_failed', { error: redactSecretText(error.message || String(error)) });
    });
  };
  nextTaskReminderScanAt = new Date(Date.now() + 60 * 1000).toISOString();
  setTimeout(scan, 5000).unref?.();
  taskReminderTimer = setInterval(scan, 60 * 1000);
  taskReminderTimer.unref?.();
}

async function handleClawbotApi(req, res) {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const body = req.method === 'GET' ? {} : await readJsonBody(req);
  const access = validateClawbotAccess(req, requestUrl, body);
  if (!access.ok) {
    sendJson(res, { ok: false, error: access.error }, access.status);
    return;
  }

  if (requestUrl.pathname === '/api/clawbot/status' && req.method === 'GET') {
    const openClawStatus = resolveOpenClawWechatConfig();
    sendJson(res, {
      ok: true,
      enabled: true,
      webhookConfigured: Boolean(clawbotWebhookUrl),
      openClawConfigured: openClawStatus.configured,
      pushConfigured: Boolean(clawbotWebhookUrl || openClawStatus.configured),
      openClaw: openClawStatus,
      commands: ['待办', '完成', '删除待办', '今日待办', '本周待办', '每日简报', '帮助'],
    });
    return;
  }

  if (requestUrl.pathname === '/api/clawbot/help' && ['GET', 'POST'].includes(req.method || 'GET')) {
    sendJson(res, { ok: true, reply: clawbotHelpText });
    return;
  }

  if (requestUrl.pathname === '/api/clawbot/daily-digest' && ['GET', 'POST'].includes(req.method || 'GET')) {
    const date = normalizeClawbotDate(requestUrl.searchParams.get('date') || (isObjectPayload(body) ? body.date : ''));
    const digest = buildClawbotDailyDigest(date);
    sendJson(res, { ok: true, reply: digest.text, digest });
    return;
  }

  if (requestUrl.pathname === '/api/clawbot/push-daily' && req.method === 'POST') {
    const date = normalizeClawbotDate(isObjectPayload(body) ? body.date : '');
    const digest = buildClawbotDailyDigest(date);
    const delivery = queueProactiveNotification({
      eventKey: `brief-manual-push:${date}:${Date.now()}`,
      source: 'brief',
      title: `${date} 每日简报主动推送`,
      content: '每日简报已进入微信主动推送队列。',
      text: digest.text,
      payload: { date, trigger: 'clawbot_api' },
    });
    writeAuditEvent({ action: 'clawbot_daily_push', req, actorRole: 'clawbot', detail: { date, ok: delivery.ok } });
    sendJson(res, { ok: delivery.ok, reply: digest.text, digest, delivery }, delivery.ok ? 200 : 502);
    return;
  }

  if (requestUrl.pathname === '/api/clawbot/message' && req.method === 'POST') {
    const message = extractClawbotMessage(body, requestUrl);
    const command = parseClawbotCommand(message, { today: todayISO() });
    const result = await executeClawbotCommand(command, req);
    sendJson(res, result, result.ok ? 200 : 400);
    return;
  }

  sendJson(res, { ok: false, error: 'Not found' }, 404);
}

function telegramHelpText() {
  return [
    'Telegram 助手命令：',
    '/today - 今日待办',
    '/week - 本周待办',
    '/todo 明天 15:30 高 背单词 - 创建待办',
    '/brief - 最新简报',
    '/health - 系统健康结论',
    '/backup - 创建备份（二次确认）',
    '/maintenance - SQLite 维护（二次确认）',
    '/resendbrief - 重发最新简报（二次确认）',
  ].join('\n');
}

function telegramCommandText(text = '') {
  const value = String(text).trim();
  if (/^\/(?:start|help)(?:@\w+)?$/i.test(value)) return '帮助';
  if (/^\/today(?:@\w+)?$/i.test(value)) return '今日待办';
  if (/^\/week(?:@\w+)?$/i.test(value)) return '本周待办';
  if (/^\/brief(?:@\w+)?$/i.test(value)) return '每日简报';
  const todo = value.match(/^\/todo(?:@\w+)?\s+(.+)$/is);
  return todo ? `待办 ${todo[1]}` : value;
}

function telegramHealthText() {
  const health = getHealthPayload();
  const status = health.unified.status === 'normal' ? '正常' : health.unified.status === 'degraded' ? '降级' : '故障';
  const actions = health.unified.actions.length ? health.unified.actions.map((item) => `- ${item.action}`).join('\n') : '无需处理';
  return `系统健康：${status}\n${health.unified.summary}\n\n处理建议：\n${actions}`;
}

async function executeTelegramOps(action, req) {
  if (action === 'backup') {
    const backup = createBackupFile('telegram-manual', 'manual backup from Telegram');
    writeAuditEvent({ action: 'telegram_backup', req, actorRole: 'telegram', detail: { createdAt: backup.createdAt } });
    return `备份完成：${backup.createdAt}`;
  }
  if (action === 'maintenance') {
    const result = await runSqliteMaintenance('telegram');
    writeAuditEvent({ action: 'telegram_sqlite_maintenance', req, actorRole: 'telegram', detail: { ok: result.ok } });
    return result.ok ? `SQLite 维护完成：${result.ranAt}` : `SQLite 维护失败：${result.error || '未知错误'}`;
  }
  if (action === 'resendbrief') {
    const digest = buildClawbotDailyDigest(todayISO());
    await sendTelegramMessage(digest.text);
    writeAuditEvent({ action: 'telegram_brief_resend', req, actorRole: 'telegram', detail: { date: digest.date } });
    return '最新简报已重发。';
  }
  return '未知运维操作。';
}

async function handleTelegramUpdate(update, req) {
  const config = readTelegramConfig(telegramEnvFile);
  const context = telegramUpdateContext(update);
  if (!isTelegramAuthorized(context, config)) {
    logStructured('warn', 'telegram_unauthorized_update', { userId: context.userId, chatId: context.chatId });
    return;
  }
  if (context.callbackId) {
    await telegramApi('answerCallbackQuery', { callback_query_id: context.callbackId }).catch(() => {});
    const complete = context.callbackData.match(/^task:complete:(\d+)$/);
    const delay = context.callbackData.match(/^task:delay:(\d+)$/);
    const confirm = context.callbackData.match(/^ops:confirm:(backup|maintenance|resendbrief):([A-Za-z0-9_-]+)$/);
    if (complete) {
      const command = parseClawbotCommand(`完成 #${complete[1]}`, { today: todayISO() });
      const result = await executeClawbotCommand(command, req);
      await sendTelegramMessage(result.reply, { chatId: context.chatId });
      return;
    }
    if (delay) {
      const task = findClawbotTasks(`#${delay[1]}`)[0];
      if (!task) return sendTelegramMessage('待办不存在或已完成。', { chatId: context.chatId });
      const nextDate = addDaysISO(task.dueDate, 1);
      runSqlite(`UPDATE short_term_tasks SET due_date = ${sqlString(nextDate)}, updated_at = ${sqlString(nowISO())} WHERE id = ${sqlValue(task.id)};`);
      tableChanged();
      writeAuditEvent({ action: 'telegram_task_delay', req, actorRole: 'telegram', detail: { id: task.id, dueDate: nextDate } });
      await sendTelegramMessage(`已延期一天：#${task.id} ${task.title}｜${nextDate}`, { chatId: context.chatId });
      return;
    }
    if (confirm) {
      const pending = telegramOpsConfirmations.get(confirm[2]);
      telegramOpsConfirmations.delete(confirm[2]);
      if (!pending || pending.action !== confirm[1] || pending.userId !== context.userId || pending.expiresAt < Date.now()) {
        await sendTelegramMessage('确认已失效，请重新发送运维命令。', { chatId: context.chatId });
        return;
      }
      await sendTelegramMessage(await executeTelegramOps(confirm[1], req), { chatId: context.chatId });
      return;
    }
    if (context.callbackData === 'ops:cancel') await sendTelegramMessage('已取消。', { chatId: context.chatId });
    return;
  }

  const raw = String(context.text || '').trim();
  if (!raw) return;
  if (/^\/health(?:@\w+)?$/i.test(raw)) return sendTelegramMessage(telegramHealthText(), { chatId: context.chatId });
  const ops = raw.match(/^\/(backup|maintenance|resendbrief)(?:@\w+)?$/i);
  if (ops) {
    const action = ops[1].toLowerCase();
    const token = randomBytes(9).toString('base64url');
    telegramOpsConfirmations.set(token, { action, userId: context.userId, expiresAt: Date.now() + 5 * 60_000 });
    return sendTelegramMessage(`即将执行：${action}。确认按钮 5 分钟内有效且只能使用一次。`, { chatId: context.chatId, replyMarkup: telegramConfirmKeyboard(action, token) });
  }
  if (/^\/(?:start|help)(?:@\w+)?$/i.test(raw)) return sendTelegramMessage(telegramHelpText(), { chatId: context.chatId });

  const command = parseClawbotCommand(telegramCommandText(raw), { today: todayISO() });
  const result = await executeClawbotCommand(command, req);
  const tasks = result.tasks || (result.task && !result.task.isCompleted ? [result.task] : []);
  await sendTelegramMessage(result.reply, { chatId: context.chatId, replyMarkup: tasks.length ? telegramTaskKeyboard(tasks) : undefined });
}

async function handleTelegramWebhook(req, res) {
  const config = readTelegramConfig(telegramEnvFile);
  if (!config.TELEGRAM_WEBHOOK_SECRET || req.headers['x-telegram-bot-api-secret-token'] !== config.TELEGRAM_WEBHOOK_SECRET) {
    sendJson(res, { ok: false }, 403);
    return;
  }
  const update = await readJsonBody(req);
  await handleTelegramUpdate(update, req);
  sendJson(res, { ok: true });
}

function saveTelegramSettings(input = {}) {
  const current = readTelegramConfig(telegramEnvFile);
  const webhookUrl = String(input.webhookUrl || '').trim();
  if (webhookUrl && !/^https:\/\//i.test(webhookUrl)) {
    const error = new Error('Telegram Webhook 必须使用 HTTPS');
    error.statusCode = 400;
    throw error;
  }
  const config = saveTelegramConfig(telegramEnvFile, current, input);
  applyTelegramProcessEnv(config);
  return telegramConfigStatus(config);
}

async function registerTelegramWebhook() {
  const config = readTelegramConfig(telegramEnvFile);
  const status = telegramConfigStatus(config);
  if (!status.configured || !config.TELEGRAM_WEBHOOK_URL || !config.TELEGRAM_WEBHOOK_SECRET) throw new Error('请先配置 Token、Chat ID、授权用户和 Webhook URL');
  const url = `${config.TELEGRAM_WEBHOOK_URL.replace(/\/+$/, '')}/api/telegram/webhook`;
  await telegramApi('setWebhook', {
    url,
    secret_token: config.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  }, { config });
  await telegramApi('setMyCommands', { commands: [
    { command: 'today', description: '查看今日待办' },
    { command: 'week', description: '查看本周待办' },
    { command: 'brief', description: '查看最新简报' },
    { command: 'health', description: '查看系统健康' },
    { command: 'backup', description: '创建服务器备份' },
    { command: 'maintenance', description: '执行 SQLite 维护' },
  ] }, { config });
  return { ...status, registered: true, bot: await telegramApi('getMe', {}, { config }) };
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
    writeAuditEvent({ action: 'state_import', req, actorRole: 'password-import', detail: { goals: next.goals.length, reviews: next.dailyReviews.length } });
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

  if (req.url?.startsWith('/api/confusing-words/backup/versions')) {
    const requestUrl = new URL(req.url, 'http://localhost');
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    const sessionRole = getSessionRole(req.headers.cookie);
    const hasBackupAccess = sessionRole || body.password === appPassword || req.headers['x-backup-password'] === appPassword;
    if (!hasBackupAccess) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return;
    }
    const parts = requestUrl.pathname.split('/').filter(Boolean);
    const versionId = Number(parts[4] || 0);
    if (req.method === 'GET' && versionId) {
      const rows = sqliteJson(`SELECT payload_json AS payloadJson FROM confusing_words_backup_versions WHERE id = ${versionId} LIMIT 1;`);
      if (!rows[0]?.payloadJson) {
        sendJson(res, { error: 'Version not found' }, 404);
        return;
      }
      sendJson(res, JSON.parse(rows[0].payloadJson));
      return;
    }
    if (req.method === 'GET') {
      sendJson(res, { items: listConfusingWordsBackupVersions(Number(requestUrl.searchParams.get('limit') || 24)) });
      return;
    }
  }

  if (req.url === '/api/confusing-words/backup/restore' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const sessionRole = getSessionRole(req.headers.cookie);
    const hasBackupAccess = sessionRole || body.password === appPassword || req.headers['x-backup-password'] === appPassword;
    if (!hasBackupAccess) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return;
    }
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read only mode' }, 403);
      return;
    }
    const versionId = Number(body.versionId || 0);
    const rows = sqliteJson(`SELECT payload_json AS payloadJson FROM confusing_words_backup_versions WHERE id = ${versionId} LIMIT 1;`);
    if (!rows[0]?.payloadJson) {
      sendJson(res, { error: 'Version not found' }, 404);
      return;
    }
    const restored = normalizeConfusingWordsPayload(JSON.parse(rows[0].payloadJson), nowISO());
    const result = saveConfusingWordsBackupPayload({ ...restored, backedUpAt: nowISO() }, 'restore');
    sendJson(res, { ok: true, backedUpAt: result.payload.backedUpAt, ...result.summary });
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
      const currentSummary = summarizeConfusingWordsPayload(state.confusingWordsBackup || {});
      const nextPayload = normalizeConfusingWordsPayload({ ...body, backedUpAt: timestamp }, timestamp);
      const nextSummary = summarizeConfusingWordsPayload(nextPayload);
      if (!body.force && currentSummary.wordCount > nextSummary.wordCount && currentSummary.wordCount - nextSummary.wordCount >= 3) {
        sendJson(res, {
          error: 'Refusing to overwrite larger server backup without force',
          conflict: true,
          server: currentSummary,
          incoming: nextSummary,
        }, 409);
        return;
      }
      const result = saveConfusingWordsBackupPayload(nextPayload, body.source || 'sync');
      sendJson(res, { ok: true, backedUpAt: result.payload.backedUpAt, ...result.summary });
      return;
    }
  }

  if (req.url?.startsWith('/api/clawbot/')) {
    await handleClawbotApi(req, res);
    return;
  }

  if (req.url === '/api/telegram/webhook' && req.method === 'POST') {
    await handleTelegramWebhook(req, res);
    return;
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

  if (req.url === '/api/settings/mihomo' && req.method === 'GET') {
    if (sessionRole !== 'write') {
      sendJson(res, { error: 'Mihomo settings require write session' }, 403);
      return;
    }
    sendJson(res, await getMihomoSettings());
    return;
  }

  if (req.url === '/api/settings/mihomo/subscription' && req.method === 'POST') {
    if (sessionRole !== 'write') {
      sendJson(res, { error: 'Mihomo settings require write session' }, 403);
      return;
    }
    const body = await readJsonBody(req);
    const result = await saveMihomoSubscriptionSettings(body);
    writeAuditEvent({
      action: 'mihomo_subscription_save',
      req,
      actorRole: sessionRole,
      detail: { subscriptionConfigured: result.subscriptionConfigured, nodeCount: result.nodes.length, restarted: result.restarted },
    });
    sendJson(res, result);
    return;
  }

  if (req.url === '/api/settings/mihomo/import' && req.method === 'POST') {
    if (sessionRole !== 'write') {
      sendJson(res, { error: 'Mihomo settings require write session' }, 403);
      return;
    }
    const body = await readJsonBody(req);
    const result = await importMihomoProviderSettings(body);
    writeAuditEvent({
      action: 'mihomo_provider_import',
      req,
      actorRole: sessionRole,
      detail: { nodeCount: result.nodes.length, restarted: result.restarted },
    });
    sendJson(res, result);
    return;
  }

  if (req.url === '/api/settings/mihomo/select' && req.method === 'POST') {
    if (sessionRole !== 'write') {
      sendJson(res, { error: 'Mihomo settings require write session' }, 403);
      return;
    }
    const body = await readJsonBody(req);
    const result = await selectMihomoProxy(body);
    writeAuditEvent({ action: 'mihomo_proxy_select', req, actorRole: sessionRole, detail: { selected: result.selected } });
    sendJson(res, result);
    return;
  }

  if (req.url === '/api/settings/mihomo/test' && req.method === 'POST') {
    if (sessionRole !== 'write') {
      sendJson(res, { error: 'Mihomo settings require write session' }, 403);
      return;
    }
    const result = await testMihomoProxy();
    writeAuditEvent({ action: 'mihomo_proxy_test', req, actorRole: sessionRole, detail: { ok: result.ok } });
    sendJson(res, result);
    return;
  }

  if (req.url === '/api/backups/status' && req.method === 'GET') {
    sendJson(res, getBackupStatus({ verifyLatest: true }));
    return;
  }

  if (req.url === '/api/backups/run' && req.method === 'POST') {
    const task = await runExclusiveTask('manual-backup', 'manual', () => createBackupFile('manual', 'manual backup from settings page'), { timeoutMs: 10 * 60 * 1000 });
    writeAuditEvent({ action: 'backup_create', req, actorRole: sessionRole, detail: { filePath: task.result?.filePath, kind: task.result?.kind } });
    sendJson(res, { ok: true, backup: task.result, task: { id: task.taskId, durationMs: task.durationMs } });
    return;
  }

  if (req.url === '/api/backups/restore' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = restoreBackupFile(body.fileName);
    writeAuditEvent({ action: 'backup_restore', req, actorRole: sessionRole, detail: { fileName: body.fileName, safetyBackup: result.safetyBackup?.filePath } });
    sendJson(res, { ok: true, ...result });
    return;
  }

  if (req.url === '/api/tasks/status' && req.method === 'GET') {
    collectOperationalNotifications();
    sendJson(res, { ...getTaskCenterStatus(), readOnly: sessionRole === 'read' });
    return;
  }

  if (req.url === '/api/learning-progress' && req.method === 'GET') {
    sendJson(res, getLearningProgressPayload(sessionRole));
    return;
  }

  if (req.url === '/api/project-progress' && req.method === 'GET') {
    sendJson(res, getProjectProgressPayload(sessionRole));
    return;
  }

  if (req.url === '/api/visits/summary' && req.method === 'GET') {
    sendJson(res, getVisitStatsPayload(sessionRole));
    return;
  }

  if (req.url === '/api/ops/logs/summary' && req.method === 'GET') {
    collectOperationalNotifications();
    sendJson(res, getOpsLogSummaryPayload(sessionRole));
    return;
  }

  if (req.url?.startsWith('/api/notifications') && req.method === 'GET') {
    const requestUrl = new URL(req.url, 'http://localhost');
    if (requestUrl.pathname === '/api/notifications/center') {
      sendJson(res, getNotificationCenterPayload(sessionRole, { status: requestUrl.searchParams.get('status') || 'all' }));
      return;
    }
  }

  if (req.url === '/api/notifications/ack' && req.method === 'POST') {
    const body = await readJsonBody(req);
    notificationRepository.acknowledge(body.id);
    sendJson(res, { ok: true, center: getNotificationCenterPayload(sessionRole) });
    return;
  }

  if (req.url === '/api/notifications/retry-delivery' && req.method === 'POST') {
    const body = await readJsonBody(req);
    notificationRepository.requeueDelivery(body.id);
    setImmediate(() => notificationQueue.processDue().catch((error) => {
      logStructured('warn', 'notification_retry_kick_failed', { error: redactSecretText(error.message || String(error)) });
    }));
    writeAuditEvent({ action: 'notification_delivery_retry', req, actorRole: sessionRole, detail: { id: Number(body.id || 0) } });
    sendJson(res, { ok: true, center: getNotificationCenterPayload(sessionRole) });
    return;
  }

  if (req.url === '/api/notifications/wechat/test' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const body = await readJsonBody(req);
    const digest = buildClawbotDailyDigest(todayISO());
    const message = String(body.message || digest.text);
    const delivery = queueProactiveNotification({
      eventKey: `clawbot:test:${Date.now()}`,
      source: 'clawbot',
      title: '微信 ClawBot 测试推送',
      content: '测试消息已进入主动推送队列。',
      text: message,
      payload: { requestedBy: sessionRole },
      channelKeys: ['clawbot_weixin'],
    });
    notifyEvent({
      eventKey: `clawbot:test:${todayISO()}`,
      source: 'clawbot',
      severity: 'info',
      title: '微信 ClawBot 测试推送',
      content: '测试消息已进入主动推送队列；发送失败时将自动重试并在站内兜底。',
      payload: { ok: true, queued: true, deliveryId: delivery.deliveryId, notificationMode: 'proactive' },
    });
    writeAuditEvent({ action: 'notifications_wechat_test', req, actorRole: sessionRole, detail: { ok: true, queued: true, deliveryId: delivery.deliveryId } });
    sendJson(res, { ok: true, digest, delivery, center: getNotificationCenterPayload(sessionRole) }, 202);
    return;
  }

  if (req.url === '/api/notifications/bark/test' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    if (!resolveBarkConfig().configured) {
      sendJson(res, { error: 'Bark is not configured' }, 409);
      return;
    }
    const body = await readJsonBody(req);
    const message = String(body.message || 'Bark 通知通道已接入 Exam Planner。');
    const delivery = queueProactiveNotification({
      eventKey: `bark:test:${Date.now()}`,
      source: 'test',
      title: 'Exam Planner Bark 测试',
      content: 'Bark 测试消息已进入主动推送队列。',
      text: message,
      payload: { requestedBy: sessionRole },
      channelKeys: ['bark_default'],
    });
    writeAuditEvent({ action: 'notifications_bark_test', req, actorRole: sessionRole, detail: { queued: true, deliveryId: delivery.deliveryId } });
    sendJson(res, { ok: true, delivery, center: getNotificationCenterPayload(sessionRole) }, 202);
    return;
  }

  if (req.url === '/api/notifications/telegram/settings' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const telegram = saveTelegramSettings(body);
    writeAuditEvent({ action: 'notifications_telegram_settings', req, actorRole: sessionRole, detail: { configured: telegram.configured, webhookConfigured: telegram.webhookConfigured } });
    sendJson(res, { ok: true, telegram, center: getNotificationCenterPayload(sessionRole) });
    return;
  }

  if (req.url === '/api/notifications/telegram/register' && req.method === 'POST') {
    const telegram = await registerTelegramWebhook();
    writeAuditEvent({ action: 'notifications_telegram_register', req, actorRole: sessionRole, detail: { registered: true } });
    sendJson(res, { ok: true, telegram, center: getNotificationCenterPayload(sessionRole) });
    return;
  }

  if (req.url === '/api/notifications/telegram/test' && req.method === 'POST') {
    const result = await sendTelegramNotification('Telegram 通知通道已接入 Exam Planner。', { payload: { severity: 'info' } });
    writeAuditEvent({ action: 'notifications_telegram_test', req, actorRole: sessionRole, detail: { ok: result.ok } });
    sendJson(res, { ok: result.ok, result, center: getNotificationCenterPayload(sessionRole) }, result.ok ? 200 : 502);
    return;
  }

  if (req.url === '/api/notifications/wechat/settings' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const body = await readJsonBody(req);
    const current = getDailyBriefSettings({ includeSecret: true });
    const generateTime = /^\d{2}:\d{2}$/.test(body.generateTime || '') ? body.generateTime : current.generateTime;
    const settings = saveDailyBriefSettings({
      ...current,
      generateTime,
      wechat: { enabled: body.enabled !== false },
    });
    writeAuditEvent({ action: 'notifications_wechat_settings', req, actorRole: sessionRole, detail: { enabled: settings.wechat.enabled, generateTime: settings.generateTime } });
    sendJson(res, { ok: true, settings, center: getNotificationCenterPayload(sessionRole) });
    return;
  }

  if (req.url?.startsWith('/api/calendar') && req.method === 'GET') {
    const requestUrl = new URL(req.url, 'http://localhost');
    sendJson(res, getCalendarPayload(sessionRole, {
      from: requestUrl.searchParams.get('from') || undefined,
      to: requestUrl.searchParams.get('to') || undefined,
    }));
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

  if (req.url?.startsWith('/api/problem-inbox') && req.method === 'GET') {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const status = requestUrl.searchParams.get('status') || 'open';
    const from = requestUrl.searchParams.get('from') || '1900-01-01';
    const to = requestUrl.searchParams.get('to') || '2999-12-31';
    const limit = queryLimit(requestUrl.searchParams, 12, 100) ?? 12;
    sendJson(res, { items: listProblemInboxItems({ limit, status, from, to }), readOnly: sessionRole === 'read' });
    return;
  }

  if (req.url?.startsWith('/api/reviews/prefill') && req.method === 'GET') {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    sendJson(res, getReviewPrefill(requestUrl.searchParams.get('date') || todayISO(), sessionRole));
    return;
  }

  if (req.url?.startsWith('/api/reviews/trend') && req.method === 'GET') {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const days = Math.max(7, Math.min(120, Number(requestUrl.searchParams.get('days') || 30)));
    sendJson(res, { ...getCachedReviewTrend(days, todayISO()), readOnly: sessionRole === 'read' });
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
    sendJson(res, { ...getCachedErrorThemeAnalysis(from, to), readOnly: sessionRole === 'read' });
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

  if (req.url?.startsWith('/api/library')) {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const pathname = requestUrl.pathname;

    if (pathname === '/api/library/books' && req.method === 'GET') {
      sendJson(res, listLibraryBooks({
        search: requestUrl.searchParams.get('search') || '',
        category: requestUrl.searchParams.get('category') || '',
        sort: requestUrl.searchParams.get('sort') || 'recent',
        includeArchived: requestUrl.searchParams.get('archived') === '1',
      }, sessionRole));
      return;
    }

    if (pathname === '/api/library/search' && req.method === 'GET') {
      sendJson(res, searchLibrary(requestUrl.searchParams.get('q') || '', sessionRole));
      return;
    }

    const textMatch = pathname.match(/^\/api\/library\/books\/(\d+)\/text$/);
    if (textMatch && req.method === 'GET') {
      sendJson(res, getLibraryText(Number(textMatch[1]), {
        offset: requestUrl.searchParams.get('offset') || 0,
        limit: requestUrl.searchParams.get('limit') || 80,
      }));
      return;
    }

    const fileMatch = pathname.match(/^\/api\/library\/books\/(\d+)\/file$/);
    if (fileMatch && req.method === 'GET') {
      serveLibraryFile(req, res, Number(fileMatch[1]), sessionRole);
      return;
    }

    const detailMatch = pathname.match(/^\/api\/library\/books\/(\d+)$/);
    if (detailMatch && req.method === 'GET') {
      const detail = getLibraryBookDetail(Number(detailMatch[1]), sessionRole);
      if (!detail) {
        sendJson(res, { error: 'Not found' }, 404);
        return;
      }
      sendJson(res, detail);
      return;
    }

    if (pathname === '/api/library/upload' && req.method === 'POST') {
      assertDiskSpace();
      const rawBody = await readRawBody(req);
      const form = parseMultipartForm(rawBody, String(req.headers['content-type'] || ''));
      sendJson(res, { ok: true, detail: uploadLibraryBookFromMultipart(form.fields, form.files) });
      return;
    }

    if (pathname === '/api/library/books/save' && req.method === 'POST') {
      sendJson(res, { ok: true, book: saveLibraryMetadata(await readJsonBody(req)) });
      return;
    }

    if (pathname === '/api/library/books/remove' && req.method === 'POST') {
      const body = await readJsonBody(req);
      deleteLibraryBook(body.id);
      sendJson(res, { ok: true });
      return;
    }

    if (pathname === '/api/library/progress' && req.method === 'POST') {
      sendJson(res, saveLibraryProgress(await readJsonBody(req)));
      return;
    }

    if (pathname === '/api/library/notes/save' && req.method === 'POST') {
      sendJson(res, saveLibraryNote(await readJsonBody(req)));
      return;
    }

    if (pathname === '/api/library/bookmarks/save' && req.method === 'POST') {
      sendJson(res, saveLibraryBookmark(await readJsonBody(req)));
      return;
    }

    if (pathname === '/api/library/bookmarks/remove' && req.method === 'POST') {
      const body = await readJsonBody(req);
      sendJson(res, deleteLibraryBookmark(body.id));
      return;
    }
  }

  if (req.url === '/api/reports/generate' && req.method === 'POST') {
    ensureSqliteStore();
    const body = await readJsonBody(req);
    const kind = body.kind === 'monthly' ? 'monthly' : 'weekly';
    const period = body.period === 'previous' ? previousPeriod(kind) : currentPeriod(kind);
    const task = await runExclusiveTask(`report-${kind}-${body.periodStart || period.periodStart}-${body.periodEnd || period.periodEnd}`, 'manual', () =>
      generateLearningReport(kind, body.periodStart || period.periodStart, body.periodEnd || period.periodEnd, 'manual'), { timeoutMs: 3 * 60 * 1000 });
    sendJson(res, { ok: true, report: task.result, task: { id: task.taskId, durationMs: task.durationMs } });
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
    const task = await runExclusiveTask('daily-brief', 'manual', () => generateDailyBrief({
      date: body.date || todayISO(),
      trigger: 'manual',
      sendEmail: Boolean(body.sendEmail),
      sendWechat: Boolean(body.sendWechat),
    }), { timeoutMs: 4 * 60 * 1000 });
    sendJson(res, { ok: true, brief: task.result, task: { id: task.taskId, durationMs: task.durationMs } });
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
  const apiPathname = new URL(req.url || '/', 'http://localhost').pathname;

  if (apiPathname === '/api/market-copilot' && req.method === 'GET') {
    sendJson(res, { ...marketCopilotRepository.dashboard(), readOnly: sessionRole === 'read' });
    return;
  }

  if (apiPathname === '/api/market-copilot/refresh' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const result = await marketCopilotRepository.refreshMarketData();
    sendJson(res, { ok: true, result, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/report/generate' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const report = marketCopilotRepository.generateReport({
      reportType: body.reportType || 'manual',
      marketStatus: body.marketStatus || '手动生成',
    });
    sendJson(res, { ok: true, report, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/prompt/generate' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const report = marketCopilotRepository.generateReport({
      reportType: body.reportType || 'research_prompt',
    });
    sendJson(res, { ok: true, report, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/transactions' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const id = marketCopilotRepository.saveTransaction(body);
    tableChanged();
    sendJson(res, { ok: true, id, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/transactions/update' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const id = marketCopilotRepository.updateTransaction(body.id, body.transaction || body, { reason: body.reason || '页面编辑' });
    tableChanged();
    sendJson(res, { ok: true, id, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/transactions/delete' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const count = marketCopilotRepository.softDeleteTransaction(body.id, body.reason || '页面删除');
    tableChanged();
    sendJson(res, { ok: true, count, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/transactions/restore' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const count = marketCopilotRepository.restoreTransaction(body.id, body.reason || '页面恢复');
    tableChanged();
    sendJson(res, { ok: true, count, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/transactions/void' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const result = marketCopilotRepository.voidTransaction(body.id, body.reason || '页面冲销');
    tableChanged();
    sendJson(res, { ok: true, result, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/transactions/permanent-delete' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const id = marketCopilotRepository.permanentDeleteTransaction(body.id, body.reason || '页面永久删除');
    tableChanged();
    sendJson(res, { ok: true, id, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/manual-price' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const price = marketCopilotRepository.saveManualPrice(body.symbol || 'rQQQ', body.price);
    sendJson(res, { ok: true, price, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/day-order-plans' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const plan = marketCopilotRepository.saveOrderPlan(body);
    sendJson(res, { ok: true, plan, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/day-order-plans/update' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const plan = marketCopilotRepository.updateOrderPlan(body.id, body.plan || body);
    sendJson(res, { ok: true, plan, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/day-order-plans/delete' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const id = marketCopilotRepository.deleteOrderPlan(body.id);
    sendJson(res, { ok: true, id, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/day-order-plans/duplicate' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const plan = marketCopilotRepository.duplicateOrderPlan(body.id);
    sendJson(res, { ok: true, plan, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/day-order-plans/convert' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const result = marketCopilotRepository.convertOrderPlanToTransaction(body.id, body.transaction || {});
    tableChanged();
    sendJson(res, { ok: true, result, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/reconciliation' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const id = marketCopilotRepository.saveReconciliation(body);
    sendJson(res, { ok: true, id, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/reconciliation/delete' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const id = marketCopilotRepository.deleteReconciliation(body.id);
    sendJson(res, { ok: true, id, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/free-cash/set' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const result = marketCopilotRepository.setFreeCashBalance(body);
    tableChanged();
    sendJson(res, { ok: true, result, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/import/dry-run' && req.method === 'POST') {
    const result = marketCopilotRepository.dryRunImport(body.csvText || body.text || '');
    sendJson(res, { ok: true, result });
    return;
  }

  if (apiPathname === '/api/market-copilot/import/commit' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const result = marketCopilotRepository.commitImport(body.csvText || body.text || '');
    tableChanged();
    sendJson(res, { ok: true, result, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/migration/mark' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    const transaction = marketCopilotRepository.markMigration(body.id, body.state || 'active');
    tableChanged();
    sendJson(res, { ok: true, transaction, dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (apiPathname === '/api/market-copilot/macro-events' && req.method === 'POST') {
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read-only mode' }, 403);
      return;
    }
    sendJson(res, { ok: true, disabled: true, message: '外部宏观日历采集已停用；请在 ChatGPT 研究提示词中联网核验。', dashboard: marketCopilotRepository.dashboard() });
    return;
  }

  if (req.url === '/api/maintenance/sqlite' && req.method === 'POST') {
    const task = await runExclusiveTask('sqlite-maintenance', 'manual', () => runSqliteMaintenance('manual'), { timeoutMs: 10 * 60 * 1000 });
    sendJson(res, task.result);
    return;
  }

  if (req.url === '/api/maintenance/precompute' && req.method === 'POST') {
    const task = await runExclusiveTask('precompute', 'manual', () => precomputeNightlyArtifacts('manual'), { timeoutMs: 30 * 60 * 1000 });
    sendJson(res, task.result);
    return;
  }

  if (req.url === '/api/reset' && req.method === 'POST') {
    writeState(baseState());
    writeAuditEvent({ action: 'state_reset', req, actorRole: sessionRole });
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

  if (req.url === '/api/problem-inbox/save' && req.method === 'POST') {
    const id = saveProblemInboxItem(body);
    sendJson(res, { ok: true, id, item: listProblemInboxItems({ status: 'all', limit: 1, from: body.date || '1900-01-01', to: body.date || '2999-12-31' }).find((item) => item.id === id) || null });
    return;
  }

  if (req.url === '/api/problem-inbox/status' && req.method === 'POST') {
    setProblemInboxStatus(body.id, body.status);
    sendJson(res, { ok: true });
    return;
  }

  if (req.url === '/api/problem-inbox/remove' && req.method === 'POST') {
    deleteProblemInboxItem(body.id);
    sendJson(res, { ok: true });
    return;
  }

  if (req.url === '/api/problem-inbox/resolve-date' && req.method === 'POST') {
    sendJson(res, resolveProblemInboxForDate(body.date || todayISO()));
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

validateStartupConfig();

const httpServer = createServer(async (req, res) => {
  if (shuttingDown) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'connection': 'close' });
    res.end('server shutting down');
    return;
  }

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
        'set-cookie': `${cookieName}=${encodeURIComponent(createSessionValue(role))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secureCookie ? '; Secure' : ''}`,
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

  if (req.url?.startsWith('/health')) {
    const requestUrl = new URL(req.url || '/health', 'http://localhost');
    if (requestUrl.searchParams.get('full') === '1') {
      const payload = getHealthPayload();
      sendJson(res, payload, payload.ok ? 200 : 503);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }

  if (req.url?.startsWith('/api/')) {
    const startedAt = Date.now();
    const sessionRole = getSessionRole(req.headers.cookie) || '';
    let statusCode = 200;
    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = (status, ...args) => {
      statusCode = Number(status) || statusCode;
      return originalWriteHead(status, ...args);
    };
    try {
      await handleApi(req, res);
    } catch (error) {
      logStructured('error', 'api_error', {
        method: req.method,
        path: new URL(req.url || '/', 'http://localhost').pathname,
        error: redactSecretText(error.message || String(error)),
      });
      if (!res.headersSent) {
        statusCode = error.statusCode || 500;
        sendJson(res, { error: error.message || 'Server error' }, error.statusCode || 500);
      } else {
        res.end();
      }
    } finally {
      const durationMs = Date.now() - startedAt;
      writeApiRequestLog({ req, statusCode, durationMs, role: sessionRole });
      if (durationMs >= requestLogSlowMs) {
        logStructured('warn', 'slow_api_request', {
          method: req.method,
          path: new URL(req.url || '/', 'http://localhost').pathname,
          statusCode,
          durationMs,
        });
      }
    }
    return;
  }

  const requestPath = new URL(req.url || '/', 'http://localhost').pathname;
  if (['/manifest.webmanifest', '/service-worker.js', '/app-icon.svg', '/favicon.svg', '/icons.svg'].includes(requestPath)) {
    serveStatic(req, res);
    return;
  }

  const pageSessionRole = getSessionRole(req.headers.cookie);
  if (!pageSessionRole) {
    sendHtml(res, loginPage());
    return;
  }

  recordVisitEvent(req, pageSessionRole);
  serveStatic(req, res);
}).listen(port, '127.0.0.1', () => {
  try {
    ensureSqliteStore();
  } catch (error) {
    logStructured('error', 'startup_store_initialization_failed', { error: redactSecretText(error.message || String(error)) });
  }
  logStructured('info', 'server_started', { url: `http://127.0.0.1:${port}`, config: getAppConfigSnapshot() });
});

function shutdown(signal) {
  shuttingDown = true;
  logStructured('info', 'server_shutdown_started', { signal });
  if (dailyBriefTimer) clearTimeout(dailyBriefTimer);
  if (taskReminderTimer) clearInterval(taskReminderTimer);
  if (notificationQueueTimer) clearInterval(notificationQueueTimer);
  httpServer.close(() => {
    logStructured('info', 'server_shutdown_completed', { signal });
    process.exit(0);
  });
  setTimeout(() => {
    logStructured('error', 'server_shutdown_forced', { signal });
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
