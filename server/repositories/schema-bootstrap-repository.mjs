const TASK_REMINDER_COLUMNS = Object.freeze([
  ['due_time', "TEXT NOT NULL DEFAULT ''"],
  ['reminder_enabled', 'INTEGER NOT NULL DEFAULT 0'],
  ['reminder_sent_offsets', "TEXT NOT NULL DEFAULT '[]'"],
  ['reminder_last_sent_at', 'TEXT'],
]);

export function createSchemaBootstrapRepository(database) {
  function tableExists(name) {
    return Number(database.scalar(
      "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?;",
      [String(name || '')],
    ) || 0) > 0;
  }

  function initializeCoreTables() {
    database.run(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS app_metadata(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_state(
  id INTEGER PRIMARY KEY CHECK(id=1),
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS backup_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_backup_log_created_at ON backup_log(created_at);`);
  }

  function stateExists() {
    return Number(database.scalar('SELECT COUNT(*) FROM app_state WHERE id=1;') || 0) > 0;
  }

  function ensureTaskReminderColumns() {
    const existing = new Set(database.json('PRAGMA table_info(short_term_tasks);').map((column) => column.name));
    for (const [name, definition] of TASK_REMINDER_COLUMNS) {
      if (!existing.has(name)) database.run(`ALTER TABLE short_term_tasks ADD COLUMN ${name} ${definition};`);
    }
    database.run('CREATE INDEX IF NOT EXISTS idx_short_term_tasks_due_time ON short_term_tasks(is_completed,due_date,due_time);');
  }

  function learningReportCount(userId) {
    return Number(database.scalar('SELECT COUNT(*) FROM learning_reports WHERE user_id=?;', [Number(userId)]) || 0);
  }

  return {
    tableExists,
    initializeCoreTables,
    stateExists,
    ensureTaskReminderColumns,
    learningReportCount,
  };
}
