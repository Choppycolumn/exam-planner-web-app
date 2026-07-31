export function installPersistenceSchemaDomain(runtime, exposeRuntime) {
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
    exposeRuntime({
        createStructuredTables: () => createStructuredTables,
    });
}
