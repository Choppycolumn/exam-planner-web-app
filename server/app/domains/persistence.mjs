import { exposeRuntime, runtime } from '../runtime-context.mjs';

function normalizeTaskDueTime(value) {
    const text = String(value || '').trim();
    const match = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (!match)
        return '';
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59)
        return '';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
function normalizeReminderSentOffsets(value) {
    let items = value;
    if (typeof value === 'string') {
        try {
            items = JSON.parse(value || '[]');
        }
        catch {
            items = [];
        }
    }
    if (!Array.isArray(items))
        return [];
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
function baseState() {
    const timestamp = runtime.nowISO();
    return {
        goals: [{
                id: 1,
                name: '我的考研目标',
                description: '坚持长期复习，稳定提高分数',
                deadline: runtime.addYearISO(),
                isActive: true,
                type: '考研',
                notes: '',
                schemaVersion: runtime.entitySchemaVersion,
                createdAt: timestamp,
                updatedAt: timestamp,
            }],
        dailyReviews: [],
        studyProjects: ['高等数学', '线性代数', '概率论', '英语单词', '英语阅读', '专业课', '政治', '复盘总结'].map((name, index) => ({
            id: index + 1,
            name,
            color: runtime.projectColors[index % runtime.projectColors.length],
            isActive: true,
            sortOrder: index + 1,
            schemaVersion: runtime.entitySchemaVersion,
            createdAt: timestamp,
            updatedAt: timestamp,
        })),
        studyTimeRecords: [],
        subjects: ['数学', '英语', '政治', '专业课'].map((name, index) => ({
            id: index + 1,
            name,
            color: runtime.subjectColors[index % runtime.subjectColors.length],
            isActive: true,
            sortOrder: index + 1,
            schemaVersion: runtime.entitySchemaVersion,
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
        dailyReviews: Array.isArray(state.dailyReviews) ? state.dailyReviews.map(runtime.normalizeReview) : [],
        studyProjects: Array.isArray(state.studyProjects) ? state.studyProjects : [],
        studyTimeRecords: Array.isArray(state.studyTimeRecords) ? state.studyTimeRecords : [],
        subjects: Array.isArray(state.subjects) ? state.subjects : [],
        mockExamRecords: Array.isArray(state.mockExamRecords) ? state.mockExamRecords : [],
        shortTermTasks: Array.isArray(state.shortTermTasks) ? state.shortTermTasks : [],
        waterIntakeRecords: Array.isArray(state.waterIntakeRecords) ? state.waterIntakeRecords : [],
        confusingWordsBackup: state.confusingWordsBackup || null,
    };
}
function getAppConfigSnapshot() {
    return {
        port: runtime.port,
        dataDir: runtime.dataDir,
        sqliteFile: runtime.sqliteFile,
        backupsDir: runtime.backupsDir,
        libraryDir: runtime.libraryDir,
        requestLogSlowMs: runtime.requestLogSlowMs,
        jsonBodyMaxBytes: runtime.jsonBodyMaxBytes,
        minFreeDiskBytes: runtime.minFreeDiskBytes,
        corsOrigin: runtime.corsOrigin,
        secureCookie: runtime.secureCookie,
        serviceRole: runtime.serviceRole,
        backgroundJobsEnabled: runtime.backgroundJobsEnabled,
        embeddingCacheDir: runtime.embeddingCacheDir,
        smallEmbeddingModelName: runtime.smallEmbeddingModelName,
        largeEmbeddingModelName: runtime.largeEmbeddingModelName,
    };
}
function setRuntimeMetadata(key, value) {
    runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES (${runtime.sqlString(key)}, ${runtime.sqlString(String(value ?? ''))}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
}
function runtimeScheduleValue(key, fallback = null) {
    if (fallback)
        return fallback;
    try {
        return runtime.sqliteScalar(`SELECT value FROM app_metadata WHERE key = ${runtime.sqlString(key)} LIMIT 1;`) || null;
    }
    catch {
        return null;
    }
}
function workerHeartbeatStatus() {
    const heartbeatAt = runtimeScheduleValue('worker_heartbeat_at');
    const heartbeatMs = heartbeatAt ? Date.parse(heartbeatAt) : NaN;
    const ageSeconds = Number.isFinite(heartbeatMs) ? Math.max(0, Math.round((Date.now() - heartbeatMs) / 1000)) : null;
    return {
        heartbeatAt,
        ageSeconds,
        pid: Number(runtimeScheduleValue('worker_pid') || 0) || null,
        healthy: ageSeconds !== null && ageSeconds <= 120,
    };
}
function startWorkerHeartbeat() {
    if (!runtime.backgroundJobsEnabled || runtime.workerHeartbeatTimer)
        return;
    const writeHeartbeat = () => {
        try {
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at) VALUES
('worker_heartbeat_at', ${runtime.sqlString(runtime.nowISO())}, datetime('now')),
('worker_pid', ${runtime.sqlString(String(process.pid))}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        }
        catch (error) {
            runtime.logStructured('warn', 'worker_heartbeat_failed', { error: redactSecretText(error.message || String(error)) });
        }
    };
    writeHeartbeat();
    runtime.workerHeartbeatTimer = runtime.scheduler.scheduleInterval(
        'worker-heartbeat',
        30 * 1000,
        writeHeartbeat,
    );
}
function assertDiskSpace(minBytes = runtime.minFreeDiskBytes) {
    const disk = runtime.getDiskStatus();
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
    runtime.sqliteExecute(`INSERT INTO app_state (id, state_json, updated_at)
VALUES (1, ?, datetime('now'))
ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at;`, [
        JSON.stringify(normalizeState(state), null, 2),
    ]);
}
function readStateFromSqlite() {
    const rows = runtime.sqliteJson('SELECT state_json FROM app_state WHERE id = 1 LIMIT 1;');
    return normalizeState(rows[0]?.state_json ? JSON.parse(rows[0].state_json) : {});
}
function createStructuredTables() {
    runtime.runSqlite(`CREATE TABLE IF NOT EXISTS goals (
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
CREATE TABLE IF NOT EXISTS break_guard_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'desktop',
  note TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  ended_at TEXT,
  overdue_seconds INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
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
CREATE TABLE IF NOT EXISTS client_error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'client',
  path TEXT NOT NULL DEFAULT '/',
  message TEXT NOT NULL DEFAULT '',
  stack TEXT NOT NULL DEFAULT '',
  component_stack TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  client_hash TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
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
CREATE INDEX IF NOT EXISTS idx_break_guard_events_created ON break_guard_events(created_at);
CREATE INDEX IF NOT EXISTS idx_break_guard_events_type_created ON break_guard_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_problem_inbox_date_status ON problem_inbox_items(date, status);
CREATE INDEX IF NOT EXISTS idx_problem_inbox_status_updated ON problem_inbox_items(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_visit_events_created_at ON visit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_visit_events_path_created_at ON visit_events(path, created_at);
CREATE INDEX IF NOT EXISTS idx_task_runs_name_started ON task_runs(task_name, started_at);
CREATE INDEX IF NOT EXISTS idx_task_runs_status_started ON task_runs(status, started_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_action_created ON audit_events(action, created_at);
CREATE INDEX IF NOT EXISTS idx_api_request_log_path_created ON api_request_log(path, created_at);
CREATE INDEX IF NOT EXISTS idx_client_error_log_created ON client_error_log(created_at);
CREATE INDEX IF NOT EXISTS idx_client_error_log_path_created ON client_error_log(path, created_at);
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
    if (!rows.length)
        return '';
    const values = rows
        .map((row) => `(${columns.map((column) => runtime.sqlValue(row[column])).join(', ')})`)
        .join(',\n');
    return `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values};`;
}
function writeStateToTables(state) {
    const normalized = normalizeState(state);
    const timestamp = runtime.nowISO();
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
        deadline: item.deadline || runtime.todayISO(),
        is_active: Boolean(item.isActive),
        type: item.type || '考研',
        notes: item.notes || '',
        schema_version: Number(item.schemaVersion || runtime.entitySchemaVersion),
        created_at: item.createdAt || timestamp,
        updated_at: item.updatedAt || timestamp,
    }))));
    scripts.push(insertRowsSql('daily_reviews', ['id', 'date', 'summary', 'wins', 'problems', 'tomorrow_plan', 'score', 'schema_version', 'created_at', 'updated_at'], normalized.dailyReviews.map((item, index) => ({
        id: Number(item.id || index + 1),
        date: item.date || runtime.todayISO(),
        summary: item.summary || '',
        wins: item.wins || '',
        problems: item.problems || '',
        tomorrow_plan: item.tomorrowPlan || '',
        score: Math.max(1, Math.min(10, Number(item.score || 6))),
        schema_version: Number(item.schemaVersion || runtime.entitySchemaVersion),
        created_at: item.createdAt || timestamp,
        updated_at: item.updatedAt || timestamp,
    }))));
    scripts.push(insertRowsSql('study_projects', ['id', 'name', 'color', 'is_active', 'sort_order', 'schema_version', 'created_at', 'updated_at'], normalized.studyProjects.map((item, index) => ({
        id: Number(item.id || index + 1),
        name: item.name || '',
        color: item.color || runtime.projectColors[index % runtime.projectColors.length],
        is_active: item.isActive !== false,
        sort_order: Number(item.sortOrder || index + 1),
        schema_version: Number(item.schemaVersion || runtime.entitySchemaVersion),
        created_at: item.createdAt || timestamp,
        updated_at: item.updatedAt || timestamp,
    }))));
    scripts.push(insertRowsSql('study_time_records', ['id', 'date', 'project_id', 'project_name_snapshot', 'minutes', 'note', 'schema_version', 'created_at', 'updated_at'], normalized.studyTimeRecords.map((item, index) => ({
        id: Number(item.id || index + 1),
        date: item.date || runtime.todayISO(),
        project_id: Number(item.projectId || 0),
        project_name_snapshot: item.projectNameSnapshot || '',
        minutes: Math.max(0, Number(item.minutes || 0)),
        note: item.note || '',
        schema_version: Number(item.schemaVersion || runtime.entitySchemaVersion),
        created_at: item.createdAt || timestamp,
        updated_at: item.updatedAt || timestamp,
    }))));
    scripts.push(insertRowsSql('subjects', ['id', 'name', 'color', 'is_active', 'sort_order', 'schema_version', 'created_at', 'updated_at'], normalized.subjects.map((item, index) => ({
        id: Number(item.id || index + 1),
        name: item.name || '',
        color: item.color || runtime.subjectColors[index % runtime.subjectColors.length],
        is_active: item.isActive !== false,
        sort_order: Number(item.sortOrder || index + 1),
        schema_version: Number(item.schemaVersion || runtime.entitySchemaVersion),
        created_at: item.createdAt || timestamp,
        updated_at: item.updatedAt || timestamp,
    }))));
    scripts.push(insertRowsSql('mock_exam_records', ['id', 'date', 'subject_id', 'subject_name_snapshot', 'score', 'full_score', 'paper_name', 'duration_minutes', 'wrong_count', 'note', 'schema_version', 'created_at', 'updated_at'], normalized.mockExamRecords.map((item, index) => ({
        id: Number(item.id || index + 1),
        date: item.date || runtime.todayISO(),
        subject_id: Number(item.subjectId || 0),
        subject_name_snapshot: item.subjectNameSnapshot || '',
        score: Number(item.score || 0),
        full_score: Math.max(1, Number(item.fullScore || 100)),
        paper_name: item.paperName || '',
        duration_minutes: Math.max(0, Number(item.durationMinutes || 0)),
        wrong_count: Math.max(0, Number(item.wrongCount || 0)),
        note: item.note || '',
        schema_version: Number(item.schemaVersion || runtime.entitySchemaVersion),
        created_at: item.createdAt || timestamp,
        updated_at: item.updatedAt || timestamp,
    }))));
    scripts.push(insertRowsSql('short_term_tasks', ['id', 'title', 'due_date', 'due_time', 'urgency', 'is_completed', 'completed_at', 'reminder_enabled', 'reminder_sent_offsets', 'reminder_last_sent_at', 'note', 'schema_version', 'created_at', 'updated_at'], normalized.shortTermTasks.map((item, index) => ({
        id: Number(item.id || index + 1),
        title: item.title || '',
        due_date: item.dueDate || runtime.todayISO(),
        due_time: normalizeTaskDueTime(item.dueTime),
        urgency: item.urgency || 'medium',
        is_completed: Boolean(item.isCompleted),
        completed_at: item.completedAt || null,
        reminder_enabled: item.reminderEnabled ?? Boolean(normalizeTaskDueTime(item.dueTime)),
        reminder_sent_offsets: JSON.stringify(normalizeReminderSentOffsets(item.reminderSentOffsets)),
        reminder_last_sent_at: item.reminderLastSentAt || null,
        note: item.note || '',
        schema_version: Number(item.schemaVersion || runtime.entitySchemaVersion),
        created_at: item.createdAt || timestamp,
        updated_at: item.updatedAt || timestamp,
    }))));
    scripts.push(insertRowsSql('water_intake_records', ['id', 'date', 'cups', 'cup_ml', 'target_cups', 'schema_version', 'created_at', 'updated_at'], normalized.waterIntakeRecords.map((item, index) => ({
        id: Number(item.id || index + 1),
        date: item.date || runtime.todayISO(),
        cups: Math.max(0, Number(item.cups || 0)),
        cup_ml: Math.max(1, Number(item.cupMl || 500)),
        target_cups: Math.max(1, Number(item.targetCups || 6)),
        schema_version: Number(item.schemaVersion || runtime.entitySchemaVersion),
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
                schema_version: Number(payload.schemaVersion || runtime.entitySchemaVersion),
                exported_at: payload.exportedAt || timestamp,
                backed_up_at: payload.backedUpAt || timestamp,
                payload_json: JSON.stringify(payload),
            }]));
    }
    scripts.push(`INSERT INTO app_state (id, state_json, updated_at)
VALUES (1, ${runtime.sqlString(JSON.stringify(normalized))}, datetime('now'))
ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at;`);
    scripts.push('COMMIT;');
    runtime.runSqlite(scripts.filter(Boolean).join('\n'), { maxBuffer: 128 * 1024 * 1024 });
    runtime.rebuildStudySummaries();
}
function readStateFromTables() {
    const goals = runtime.sqliteJson(`SELECT id, name, description, deadline, is_active AS isActive, type, notes,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM goals ORDER BY id;`).map((item) => ({ ...item, isActive: Boolean(item.isActive) }));
    const dailyReviews = runtime.sqliteJson(`SELECT id, date, summary, wins, problems, tomorrow_plan AS tomorrowPlan, score,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM daily_reviews ORDER BY date DESC;`).map(runtime.normalizeReview);
    const studyProjects = runtime.sqliteJson(`SELECT id, name, color, is_active AS isActive, sort_order AS sortOrder,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM study_projects ORDER BY sort_order, id;`).map((item) => ({ ...item, isActive: Boolean(item.isActive) }));
    const studyTimeRecords = runtime.sqliteJson(`SELECT id, date, project_id AS projectId, project_name_snapshot AS projectNameSnapshot, minutes, note,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM study_time_records ORDER BY date DESC, project_id;`);
    const subjects = runtime.sqliteJson(`SELECT id, name, color, is_active AS isActive, sort_order AS sortOrder,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM subjects ORDER BY sort_order, id;`).map((item) => ({ ...item, isActive: Boolean(item.isActive) }));
    const mockExamRecords = runtime.sqliteJson(`SELECT id, date, subject_id AS subjectId, subject_name_snapshot AS subjectNameSnapshot, score, full_score AS fullScore,
paper_name AS paperName, duration_minutes AS durationMinutes, wrong_count AS wrongCount, note,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM mock_exam_records ORDER BY date DESC, id DESC;`);
    const shortTermTasks = runtime.sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency, is_completed AS isCompleted, completed_at AS completedAt,
reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt, note,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM short_term_tasks ORDER BY due_date, due_time, id;`).map(normalizeTaskRow);
    const waterIntakeRecords = runtime.sqliteJson(`SELECT id, date, cups, cup_ml AS cupMl, target_cups AS targetCups,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM water_intake_records ORDER BY date DESC;`);
    const confusingRows = runtime.sqliteJson('SELECT payload_json AS payloadJson FROM confusing_words_backup WHERE id = 1 LIMIT 1;');
    const confusingWordsBackup = confusingRows[0]?.payloadJson ? JSON.parse(confusingRows[0].payloadJson) : null;
    return normalizeState({ goals, dailyReviews, studyProjects, studyTimeRecords, subjects, mockExamRecords, shortTermTasks, waterIntakeRecords, confusingWordsBackup });
}
function readLegacyStateForMigration() {
    const stateCount = Number(runtime.sqliteScalar('SELECT COUNT(*) FROM app_state WHERE id = 1;') || 0);
    if (stateCount)
        return readStateFromSqlite();
    if (runtime.existsSync(runtime.legacyDataFile))
        return normalizeState(JSON.parse(runtime.readFileSync(runtime.legacyDataFile, 'utf8')));
    return baseState();
}

exposeRuntime({ "normalizeTaskDueTime": () => normalizeTaskDueTime, "normalizeReminderSentOffsets": () => normalizeReminderSentOffsets, "normalizeTaskRow": () => normalizeTaskRow, "baseState": () => baseState, "normalizeState": () => normalizeState, "getAppConfigSnapshot": () => getAppConfigSnapshot, "setRuntimeMetadata": () => setRuntimeMetadata, "runtimeScheduleValue": () => runtimeScheduleValue, "workerHeartbeatStatus": () => workerHeartbeatStatus, "startWorkerHeartbeat": () => startWorkerHeartbeat, "assertDiskSpace": () => assertDiskSpace, "redactSecretText": () => redactSecretText, "writeStateToSqlite": () => writeStateToSqlite, "readStateFromSqlite": () => readStateFromSqlite, "createStructuredTables": () => createStructuredTables, "insertRowsSql": () => insertRowsSql, "writeStateToTables": () => writeStateToTables, "readStateFromTables": () => readStateFromTables, "readLegacyStateForMigration": () => readLegacyStateForMigration }, {  });
