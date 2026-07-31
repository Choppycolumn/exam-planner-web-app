const ENTITY_TABLES = Object.freeze([
  'goals',
  'daily_reviews',
  'study_projects',
  'study_time_records',
  'subjects',
  'mock_exam_records',
  'short_term_tasks',
  'water_intake_records',
  'problem_inbox_items',
]);

function tableExists(connection, name) {
  return Boolean(connection.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1;",
  ).get(name));
}

function tableColumns(connection, name) {
  if (!tableExists(connection, name)) return new Set();
  return new Set(connection.prepare(`PRAGMA table_info(${name});`).all().map((column) => column.name));
}

function nextId(connection, table) {
  return Number(connection.prepare(`SELECT COALESCE(MAX(id),0)+1 AS id FROM ${table};`).get()?.id || 1);
}

function insertRecord(connection, table, record, availableColumns) {
  const columns = Object.keys(record).filter((column) => availableColumns.has(column));
  if (!columns.length) return;
  const placeholders = columns.map(() => '?').join(',');
  connection.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${placeholders});`)
    .run(...columns.map((column) => record[column]));
}

function ownerFilter(columns, ownerUserId) {
  return columns.has('user_id') ? { clause: ' WHERE user_id=?', parameters: [ownerUserId] } : { clause: '', parameters: [] };
}

function parseJson(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function createStateRepository(database) {
  function saveAppState(state, timestamp) {
    database.execute(`INSERT INTO app_state(id,state_json,updated_at)
VALUES(1,?,?)
ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at;`, [
      JSON.stringify(state, null, 2),
      timestamp,
    ]);
  }

  function loadAppState() {
    const raw = database.scalar('SELECT state_json FROM app_state WHERE id=1 LIMIT 1;');
    return parseJson(raw, {});
  }

  function appStateExists() {
    return Number(database.scalar('SELECT COUNT(*) FROM app_state WHERE id=1;') || 0) > 0;
  }

  function replaceOwnerState(state, {
    ownerUserId = null,
    now,
    today,
    schemaVersion = 1,
    projectColors = [],
    subjectColors = [],
    normalizeDueTime = (value) => String(value || ''),
    normalizeOffsets = () => [],
  }) {
    database.transaction((connection) => {
      const columnsByTable = Object.fromEntries(
        ENTITY_TABLES.map((table) => [table, tableColumns(connection, table)]),
      );
      const accountsReady = tableExists(connection, 'user_accounts');
      const ownerId = accountsReady ? Number(ownerUserId) : null;
      if (accountsReady && (!Number.isInteger(ownerId) || ownerId < 1)) {
        throw new Error('owner userId is required for state replacement');
      }

      for (const table of [
        'study_time_records',
        'mock_exam_records',
        'problem_inbox_items',
        'daily_reviews',
        'short_term_tasks',
        'water_intake_records',
        'goals',
        'study_projects',
        'subjects',
      ]) {
        const columns = columnsByTable[table];
        if (!columns?.size) continue;
        const filter = ownerFilter(columns, ownerId);
        connection.prepare(`DELETE FROM ${table}${filter.clause};`).run(...filter.parameters);
      }
      for (const table of ['study_daily_summaries', 'study_project_daily_summaries']) {
        if (tableExists(connection, table)) connection.exec(`DELETE FROM ${table};`);
      }

      const ownerField = (columns) => columns.has('user_id') ? { user_id: ownerId } : {};
      const projectIdMap = new Map();
      const projectColumns = columnsByTable.study_projects;
      let projectId = nextId(connection, 'study_projects');
      (state.studyProjects || []).forEach((item, index) => {
        const assignedId = projectId++;
        projectIdMap.set(Number(item.id || index + 1), assignedId);
        insertRecord(connection, 'study_projects', {
          id: assignedId,
          ...ownerField(projectColumns),
          name: String(item.name || ''),
          color: String(item.color || projectColors[index % Math.max(1, projectColors.length)] || '#2563eb'),
          is_active: item.isActive === false ? 0 : 1,
          sort_order: Number(item.sortOrder || index + 1),
          schema_version: Number(item.schemaVersion || schemaVersion),
          created_at: item.createdAt || now,
          updated_at: item.updatedAt || now,
        }, projectColumns);
      });

      const subjectIdMap = new Map();
      const subjectColumns = columnsByTable.subjects;
      let subjectId = nextId(connection, 'subjects');
      (state.subjects || []).forEach((item, index) => {
        const assignedId = subjectId++;
        subjectIdMap.set(Number(item.id || index + 1), assignedId);
        insertRecord(connection, 'subjects', {
          id: assignedId,
          ...ownerField(subjectColumns),
          name: String(item.name || ''),
          color: String(item.color || subjectColors[index % Math.max(1, subjectColors.length)] || '#2563eb'),
          is_active: item.isActive === false ? 0 : 1,
          sort_order: Number(item.sortOrder || index + 1),
          schema_version: Number(item.schemaVersion || schemaVersion),
          created_at: item.createdAt || now,
          updated_at: item.updatedAt || now,
        }, subjectColumns);
      });

      const insertCollection = (table, items, mapper) => {
        const columns = columnsByTable[table];
        if (!columns?.size) return;
        let id = nextId(connection, table);
        items.forEach((item, index) => insertRecord(connection, table, {
          id: id++,
          ...ownerField(columns),
          ...mapper(item, index),
        }, columns));
      };

      insertCollection('goals', state.goals || [], (item) => ({
        name: String(item.name || ''),
        description: String(item.description || ''),
        deadline: item.deadline || today,
        is_active: item.isActive ? 1 : 0,
        type: item.type || '考研',
        notes: String(item.notes || ''),
        schema_version: Number(item.schemaVersion || schemaVersion),
        created_at: item.createdAt || now,
        updated_at: item.updatedAt || now,
      }));
      insertCollection('daily_reviews', state.dailyReviews || [], (item) => ({
        date: item.date || today,
        summary: String(item.summary || ''),
        wins: String(item.wins || ''),
        problems: String(item.problems || ''),
        tomorrow_plan: String(item.tomorrowPlan || ''),
        score: Math.max(1, Math.min(10, Number(item.score || 6))),
        schema_version: Number(item.schemaVersion || schemaVersion),
        created_at: item.createdAt || now,
        updated_at: item.updatedAt || now,
      }));
      insertCollection('study_time_records', state.studyTimeRecords || [], (item) => ({
        date: item.date || today,
        project_id: projectIdMap.get(Number(item.projectId)) || 0,
        project_name_snapshot: String(item.projectNameSnapshot || ''),
        minutes: Math.max(0, Number(item.minutes || 0)),
        note: String(item.note || ''),
        schema_version: Number(item.schemaVersion || schemaVersion),
        created_at: item.createdAt || now,
        updated_at: item.updatedAt || now,
      }));
      insertCollection('mock_exam_records', state.mockExamRecords || [], (item) => ({
        date: item.date || today,
        subject_id: subjectIdMap.get(Number(item.subjectId)) || 0,
        subject_name_snapshot: String(item.subjectNameSnapshot || ''),
        score: Number(item.score || 0),
        full_score: Math.max(1, Number(item.fullScore || 100)),
        paper_name: String(item.paperName || ''),
        duration_minutes: Math.max(0, Number(item.durationMinutes || 0)),
        wrong_count: Math.max(0, Number(item.wrongCount || 0)),
        note: String(item.note || ''),
        schema_version: Number(item.schemaVersion || schemaVersion),
        created_at: item.createdAt || now,
        updated_at: item.updatedAt || now,
      }));
      insertCollection('short_term_tasks', state.shortTermTasks || [], (item) => {
        const dueTime = normalizeDueTime(item.dueTime);
        return {
          title: String(item.title || ''),
          due_date: item.dueDate || today,
          due_time: dueTime,
          urgency: item.urgency || 'medium',
          is_completed: item.isCompleted ? 1 : 0,
          completed_at: item.completedAt || null,
          reminder_enabled: (item.reminderEnabled ?? Boolean(dueTime)) ? 1 : 0,
          reminder_sent_offsets: JSON.stringify(normalizeOffsets(item.reminderSentOffsets)),
          reminder_last_sent_at: item.reminderLastSentAt || null,
          note: String(item.note || ''),
          schema_version: Number(item.schemaVersion || schemaVersion),
          created_at: item.createdAt || now,
          updated_at: item.updatedAt || now,
        };
      });
      insertCollection('water_intake_records', state.waterIntakeRecords || [], (item) => ({
        date: item.date || today,
        cups: Math.max(0, Number(item.cups || 0)),
        cup_ml: Math.max(1, Number(item.cupMl || 500)),
        target_cups: Math.max(1, Number(item.targetCups || 6)),
        schema_version: Number(item.schemaVersion || schemaVersion),
        created_at: item.createdAt || now,
        updated_at: item.updatedAt || now,
      }));

      if (state.confusingWordsBackup) {
        const payload = {
          ...state.confusingWordsBackup,
          groups: Array.isArray(state.confusingWordsBackup.groups) ? state.confusingWordsBackup.groups : [],
        };
        if (tableExists(connection, 'user_confusing_words_backup') && ownerId) {
          connection.prepare(`INSERT INTO user_confusing_words_backup(
user_id,schema_version,exported_at,backed_up_at,payload_json)
VALUES(?,?,?,?,?)
ON CONFLICT(user_id) DO UPDATE SET
schema_version=excluded.schema_version,exported_at=excluded.exported_at,
backed_up_at=excluded.backed_up_at,payload_json=excluded.payload_json;`).run(
            ownerId,
            Number(payload.schemaVersion || schemaVersion),
            payload.exportedAt || now,
            payload.backedUpAt || now,
            JSON.stringify(payload),
          );
        } else if (tableExists(connection, 'confusing_words_backup')) {
          connection.exec('DELETE FROM confusing_words_backup;');
          connection.prepare(`INSERT INTO confusing_words_backup(
id,schema_version,exported_at,backed_up_at,payload_json) VALUES(1,?,?,?,?);`).run(
            Number(payload.schemaVersion || schemaVersion),
            payload.exportedAt || now,
            payload.backedUpAt || now,
            JSON.stringify(payload),
          );
        }
      }

      connection.prepare(`INSERT INTO app_state(id,state_json,updated_at)
VALUES(1,?,?)
ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at;`)
        .run(JSON.stringify(state), now);
    });
  }

  function readOwnerState(ownerUserId) {
    const connection = database.open();
    const accountsReady = tableExists(connection, 'user_accounts');
    const ownerId = accountsReady ? Number(ownerUserId) : null;
    const readRows = (table, select, order = '') => {
      const columns = tableColumns(connection, table);
      if (!columns.size) return [];
      const filter = ownerFilter(columns, ownerId);
      return connection.prepare(`${select} FROM ${table}${filter.clause}${order};`).all(...filter.parameters);
    };
    const goals = readRows('goals', `SELECT id,name,description,deadline,is_active AS isActive,
type,notes,schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt`, ' ORDER BY id');
    const dailyReviews = readRows('daily_reviews', `SELECT id,date,summary,wins,problems,
tomorrow_plan AS tomorrowPlan,score,schema_version AS schemaVersion,
created_at AS createdAt,updated_at AS updatedAt`, ' ORDER BY date DESC');
    const studyProjects = readRows('study_projects', `SELECT id,name,color,is_active AS isActive,
sort_order AS sortOrder,schema_version AS schemaVersion,created_at AS createdAt,
updated_at AS updatedAt`, ' ORDER BY sort_order,id');
    const studyTimeRecords = readRows('study_time_records', `SELECT id,date,project_id AS projectId,
project_name_snapshot AS projectNameSnapshot,minutes,note,schema_version AS schemaVersion,
created_at AS createdAt,updated_at AS updatedAt`, ' ORDER BY date DESC,project_id');
    const subjects = readRows('subjects', `SELECT id,name,color,is_active AS isActive,
sort_order AS sortOrder,schema_version AS schemaVersion,created_at AS createdAt,
updated_at AS updatedAt`, ' ORDER BY sort_order,id');
    const mockExamRecords = readRows('mock_exam_records', `SELECT id,date,subject_id AS subjectId,
subject_name_snapshot AS subjectNameSnapshot,score,full_score AS fullScore,
paper_name AS paperName,duration_minutes AS durationMinutes,wrong_count AS wrongCount,note,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt`, ' ORDER BY date DESC,id DESC');
    const shortTermTasks = readRows('short_term_tasks', `SELECT id,title,due_date AS dueDate,
due_time AS dueTime,urgency,is_completed AS isCompleted,completed_at AS completedAt,
reminder_enabled AS reminderEnabled,reminder_sent_offsets AS reminderSentOffsets,
reminder_last_sent_at AS reminderLastSentAt,note,schema_version AS schemaVersion,
created_at AS createdAt,updated_at AS updatedAt`, ' ORDER BY due_date,due_time,id');
    const waterIntakeRecords = readRows('water_intake_records', `SELECT id,date,cups,
cup_ml AS cupMl,target_cups AS targetCups,schema_version AS schemaVersion,
created_at AS createdAt,updated_at AS updatedAt`, ' ORDER BY date DESC');

    let confusingWordsBackup = null;
    if (accountsReady && tableExists(connection, 'user_confusing_words_backup')) {
      const row = connection.prepare(
        'SELECT payload_json AS payloadJson FROM user_confusing_words_backup WHERE user_id=? LIMIT 1;',
      ).get(ownerId);
      confusingWordsBackup = parseJson(row?.payloadJson, null);
    } else if (tableExists(connection, 'confusing_words_backup')) {
      const row = connection.prepare(
        'SELECT payload_json AS payloadJson FROM confusing_words_backup WHERE id=1 LIMIT 1;',
      ).get();
      confusingWordsBackup = parseJson(row?.payloadJson, null);
    }
    return {
      goals,
      dailyReviews,
      studyProjects,
      studyTimeRecords,
      subjects,
      mockExamRecords,
      shortTermTasks,
      waterIntakeRecords,
      confusingWordsBackup,
    };
  }

  return {
    saveAppState,
    loadAppState,
    appStateExists,
    replaceOwnerState,
    readOwnerState,
  };
}
