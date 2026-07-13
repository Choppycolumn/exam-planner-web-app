import { exposeRuntime, runtime } from '../runtime-context.mjs';

function readState() {
    runtime.ensureSqliteStore();
    return runtime.readStateFromTables();
}
function writeState(state) {
    runtime.ensureSqliteStore();
    runtime.writeStateToTables(state);
    tableChanged();
}
function countConfusingWordsGroups(groups = []) {
    const safeGroups = Array.isArray(groups) ? groups : [];
    return {
        groupCount: safeGroups.length,
        wordCount: safeGroups.reduce((sum, group) => sum + (Array.isArray(group?.words) ? group.words.length : 0), 0),
    };
}
function normalizeConfusingWordsPayload(input = {}, timestamp = runtime.nowISO()) {
    const groups = Array.isArray(input.groups) ? input.groups : [];
    return {
        schemaVersion: Number(input.schemaVersion || runtime.entitySchemaVersion),
        exportedAt: input.exportedAt || timestamp,
        backedUpAt: input.backedUpAt || timestamp,
        groups,
    };
}
function hashConfusingWordsPayload(payload) {
    return runtime.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
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
    const rows = runtime.sqliteJson('SELECT payload_json AS payloadJson FROM confusing_words_backup WHERE id = 1 LIMIT 1;');
    if (!rows[0]?.payloadJson)
        return null;
    try {
        return JSON.parse(rows[0].payloadJson);
    }
    catch {
        return null;
    }
}
function insertConfusingWordsBackupVersion(payload, source = 'sync') {
    if (!payload)
        return null;
    const timestamp = runtime.nowISO();
    const summary = summarizeConfusingWordsPayload(payload);
    const latestHash = runtime.sqliteScalar('SELECT payload_hash FROM confusing_words_backup_versions ORDER BY created_at DESC, id DESC LIMIT 1;');
    if (latestHash === summary.payloadHash)
        return { skipped: true, ...summary };
    runtime.runSqlite(`INSERT INTO confusing_words_backup_versions (
  schema_version, exported_at, backed_up_at, payload_json, source, group_count, word_count, payload_hash, created_at
) VALUES (
  ${runtime.sqlString(String(payload.schemaVersion || runtime.entitySchemaVersion))},
  ${runtime.sqlString(payload.exportedAt || timestamp)},
  ${runtime.sqlString(payload.backedUpAt || timestamp)},
  ${runtime.sqlString(JSON.stringify(payload))},
  ${runtime.sqlString(source)},
  ${summary.groupCount},
  ${summary.wordCount},
  ${runtime.sqlString(summary.payloadHash)},
  ${runtime.sqlString(timestamp)}
);`);
    runtime.runSqlite(`DELETE FROM confusing_words_backup_versions
WHERE id NOT IN (
  SELECT id FROM confusing_words_backup_versions ORDER BY created_at DESC, id DESC LIMIT 80
);`);
    return { skipped: false, ...summary };
}
function saveConfusingWordsBackupPayload(payload, source = 'sync') {
    runtime.ensureSqliteStore();
    const timestamp = runtime.nowISO();
    const normalized = normalizeConfusingWordsPayload(payload, timestamp);
    const summary = summarizeConfusingWordsPayload(normalized);
    const current = readConfusingWordsBackupPayload();
    if (current)
        insertConfusingWordsBackupVersion(current, 'before-' + source);
    insertConfusingWordsBackupVersion(normalized, source);
    runtime.runSqlite(`INSERT INTO confusing_words_backup (id, schema_version, exported_at, backed_up_at, payload_json)
VALUES (1, ${Number(normalized.schemaVersion || runtime.entitySchemaVersion)}, ${runtime.sqlString(normalized.exportedAt)}, ${runtime.sqlString(normalized.backedUpAt)}, ${runtime.sqlString(JSON.stringify(normalized))})
ON CONFLICT(id) DO UPDATE SET
  schema_version = excluded.schema_version,
  exported_at = excluded.exported_at,
  backed_up_at = excluded.backed_up_at,
  payload_json = excluded.payload_json;`);
    runtime.runSqlite(`INSERT INTO app_state (id, state_json, updated_at)
VALUES (1, ${runtime.sqlString(JSON.stringify(runtime.readStateFromTables()))}, datetime('now'))
ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at;`);
    tableChanged();
    return { payload: normalized, summary };
}
function listConfusingWordsBackupVersions(limit = 20) {
    runtime.ensureSqliteStore();
    const safeLimit = Math.max(1, Math.min(80, Number(limit) || 20));
    return runtime.sqliteJson(`SELECT id, schema_version AS schemaVersion, exported_at AS exportedAt,
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
    if (!current)
        return;
    const versionCount = Number(runtime.sqliteScalar('SELECT COUNT(*) FROM confusing_words_backup_versions;') || 0);
    if (versionCount > 0)
        return;
    insertConfusingWordsBackupVersion(current, 'current-seed');
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
    if (!key || !chineseDefinition)
        return null;
    return {
        word: key,
        phonetic: phonetic || '',
        englishDefinition: definition || '',
        chineseDefinition,
        partOfSpeech: partOfSpeech || '',
    };
}
function ensureDictionaryIndex() {
    if (runtime.dictionaryIndexChecked)
        return;
    runtime.dictionaryIndexChecked = true;
    if (!runtime.existsSync(runtime.dictionaryFile))
        return;
    const sourceStats = runtime.statSync(runtime.dictionaryFile);
    const signature = `${sourceStats.size}:${Math.round(sourceStats.mtimeMs)}`;
    const indexedSignature = runtime.sqliteScalar("SELECT value FROM app_metadata WHERE key = 'dictionary_source_signature' LIMIT 1;");
    const indexedCount = Number(runtime.sqliteScalar('SELECT COUNT(*) FROM dictionary_entries;') || 0);
    if (indexedSignature === signature && indexedCount > 0)
        return;
    runtime.dictionaryCache.clear();
    runtime.runSqliteFile(runtime.sqliteFile, `DROP TABLE IF EXISTS dictionary_import;
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
.import --skip 1 ${runtime.sqlitePath(runtime.dictionaryFile)} dictionary_import
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
VALUES ('dictionary_source_signature', ${runtime.sqlString(signature)}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
INSERT INTO app_metadata (key, value, updated_at)
VALUES ('dictionary_indexed_at', ${runtime.sqlString(runtime.nowISO())}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
COMMIT;`, { maxBuffer: 256 * 1024 * 1024 });
}
function findDictionaryEntry(targetWord) {
    runtime.ensureSqliteStore();
    const key = targetWord.trim().toLowerCase();
    if (runtime.dictionaryCache.has(key))
        return runtime.dictionaryCache.get(key);
    if (!key)
        return null;
    const rows = runtime.sqliteJson(`SELECT word, phonetic, english_definition, chinese_definition, part_of_speech
FROM dictionary_entries
WHERE word = ${runtime.sqlString(key)}
LIMIT 1;`);
    const row = rows[0];
    if (!row) {
        runtime.dictionaryCache.set(key, null);
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
    runtime.dictionaryCache.set(key, result);
    return result;
}
function nextTableId(table) {
    return Number(runtime.sqliteScalar(`SELECT COALESCE(MAX(id), 0) + 1 FROM ${table};`) || 1);
}
function tableChanged() {
    runtime.dataRevision += 1;
    runtime.dashboardPayloadCache = null;
    runtime.statisticsSummaryCache = null;
    runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('data_updated_at', ${runtime.sqlString(runtime.nowISO())}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
}
function sourceUpdatedAt() {
    return runtime.sqliteScalar("SELECT value FROM app_metadata WHERE key = 'data_updated_at' LIMIT 1;") || '';
}
function setPrecomputedCache(cacheKey, payload) {
    const timestamp = runtime.nowISO();
    runtime.runSqlite(`INSERT INTO precomputed_cache (cache_key, payload_json, source_updated_at, computed_at)
VALUES (${runtime.sqlString(cacheKey)}, ${runtime.sqlString(JSON.stringify(payload))}, ${runtime.sqlString(sourceUpdatedAt())}, ${runtime.sqlString(timestamp)})
ON CONFLICT(cache_key) DO UPDATE SET
  payload_json = excluded.payload_json,
  source_updated_at = excluded.source_updated_at,
  computed_at = excluded.computed_at;`);
    return { ...payload, precomputedAt: timestamp };
}
function getPrecomputedCache(cacheKey, maxAgeMs = 24 * 60 * 60 * 1000) {
    const row = runtime.sqliteJson(`SELECT payload_json AS payloadJson, source_updated_at AS sourceUpdatedAt, computed_at AS computedAt
FROM precomputed_cache
WHERE cache_key = ${runtime.sqlString(cacheKey)}
LIMIT 1;`)[0];
    if (!row?.payloadJson)
        return null;
    if (maxAgeMs && Date.now() - new Date(row.computedAt).getTime() > maxAgeMs)
        return null;
    const currentSource = sourceUpdatedAt();
    if (currentSource && row.sourceUpdatedAt && new Date(row.sourceUpdatedAt).getTime() < new Date(currentSource).getTime())
        return null;
    return { ...JSON.parse(row.payloadJson), precomputedAt: row.computedAt };
}
function studyUserIsolationReady() {
    return runtime.sqliteJson('PRAGMA table_info(study_time_records);').some((column) => column.name === 'user_id');
}
function rebuildStudySummaries() {
    const timestamp = runtime.nowISO();
    const userClause = studyUserIsolationReady() ? 'WHERE user_id = 1' : '';
    runtime.runSqlite(`BEGIN;
DELETE FROM study_daily_summaries;
DELETE FROM study_project_daily_summaries;
INSERT INTO study_daily_summaries (date, total_minutes, record_count, updated_at)
SELECT date, COALESCE(SUM(minutes), 0), COUNT(*), ${runtime.sqlString(timestamp)}
FROM study_time_records
${userClause}
GROUP BY date;
INSERT INTO study_project_daily_summaries (date, project_id, project_name_snapshot, minutes, record_count, updated_at)
SELECT date, project_id, project_name_snapshot, COALESCE(SUM(minutes), 0), COUNT(*), ${runtime.sqlString(timestamp)}
FROM study_time_records
${userClause}
GROUP BY date, project_id, project_name_snapshot;
INSERT INTO app_metadata (key, value, updated_at)
VALUES ('study_summaries_rebuilt_at', ${runtime.sqlString(timestamp)}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
COMMIT;`);
}
function refreshStudySummariesForDate(date) {
    const targetDate = date || runtime.todayISO();
    const timestamp = runtime.nowISO();
    const userClause = studyUserIsolationReady() ? ' AND user_id = 1' : '';
    runtime.runSqlite(`BEGIN;
DELETE FROM study_daily_summaries WHERE date = ${runtime.sqlString(targetDate)};
DELETE FROM study_project_daily_summaries WHERE date = ${runtime.sqlString(targetDate)};
INSERT INTO study_daily_summaries (date, total_minutes, record_count, updated_at)
SELECT date, COALESCE(SUM(minutes), 0), COUNT(*), ${runtime.sqlString(timestamp)}
FROM study_time_records
WHERE date = ${runtime.sqlString(targetDate)}${userClause}
GROUP BY date;
INSERT INTO study_project_daily_summaries (date, project_id, project_name_snapshot, minutes, record_count, updated_at)
SELECT date, project_id, project_name_snapshot, COALESCE(SUM(minutes), 0), COUNT(*), ${runtime.sqlString(timestamp)}
FROM study_time_records
WHERE date = ${runtime.sqlString(targetDate)}${userClause}
GROUP BY date, project_id, project_name_snapshot;
INSERT INTO app_metadata (key, value, updated_at)
VALUES ('study_summaries_rebuilt_at', ${runtime.sqlString(timestamp)}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
COMMIT;`);
}
function ensureStudySummariesReady() {
    const recordCount = Number(runtime.sqliteScalar('SELECT COUNT(*) FROM study_time_records;') || 0);
    const summaryCount = Number(runtime.sqliteScalar('SELECT COUNT(*) FROM study_daily_summaries;') || 0);
    const rebuiltAt = runtime.sqliteScalar("SELECT value FROM app_metadata WHERE key = 'study_summaries_rebuilt_at' LIMIT 1;");
    if (recordCount && (!summaryCount || !rebuiltAt))
        rebuildStudySummaries();
}
function saveGoalSql(payload) {
    const timestamp = runtime.nowISO();
    if (payload.isActive) {
        runtime.runSqlite(`UPDATE goals SET is_active = 0, updated_at = ${runtime.sqlString(timestamp)} WHERE id <> ${runtime.sqlValue(Number(payload.id || 0))};`);
    }
    if (payload.id && Number(runtime.sqliteScalar(`SELECT COUNT(*) FROM goals WHERE id = ${runtime.sqlValue(Number(payload.id))};`) || 0)) {
        runtime.runSqlite(`UPDATE goals SET
name = ${runtime.sqlValue(payload.name)},
description = ${runtime.sqlValue(payload.description || '')},
deadline = ${runtime.sqlValue(payload.deadline || runtime.todayISO())},
is_active = ${runtime.sqlValue(Boolean(payload.isActive))},
type = ${runtime.sqlValue(payload.type || '考研')},
notes = ${runtime.sqlValue(payload.notes || '')},
updated_at = ${runtime.sqlValue(timestamp)}
WHERE id = ${runtime.sqlValue(Number(payload.id))};`);
        tableChanged();
        return Number(payload.id);
    }
    const id = nextTableId('goals');
    runtime.runSqlite(`INSERT INTO goals (id, name, description, deadline, is_active, type, notes, schema_version, created_at, updated_at)
VALUES (${id}, ${runtime.sqlValue(payload.name || '')}, ${runtime.sqlValue(payload.description || '')}, ${runtime.sqlValue(payload.deadline || runtime.todayISO())}, ${runtime.sqlValue(payload.isActive !== false)}, ${runtime.sqlValue(payload.type || '考研')}, ${runtime.sqlValue(payload.notes || '')}, ${runtime.entitySchemaVersion}, ${runtime.sqlValue(timestamp)}, ${runtime.sqlValue(timestamp)});`);
    tableChanged();
    return id;
}
function saveProjectSql(payload, userId = 1) {
    const timestamp = runtime.nowISO();
    if (payload.id && Number(runtime.sqliteScalar(`SELECT COUNT(*) FROM study_projects WHERE id = ${runtime.sqlValue(Number(payload.id))} AND user_id = ${runtime.sqlValue(userId)};`) || 0)) {
        runtime.runSqlite(`UPDATE study_projects SET
name = ${runtime.sqlValue(payload.name || '')},
color = ${runtime.sqlValue(payload.color || '#2563eb')},
is_active = ${runtime.sqlValue(payload.isActive !== false)},
sort_order = ${runtime.sqlValue(Number(payload.sortOrder || 0))},
updated_at = ${runtime.sqlValue(timestamp)}
WHERE id = ${runtime.sqlValue(Number(payload.id))} AND user_id = ${runtime.sqlValue(userId)};`);
        tableChanged();
        return Number(payload.id);
    }
    if (payload.id) {
        const error = new Error('Project does not belong to this account');
        error.statusCode = 403;
        throw error;
    }
    const id = nextTableId('study_projects');
    const sortOrder = Number(payload.sortOrder || runtime.sqliteScalar(`SELECT COALESCE(MAX(sort_order), 0) + 1 FROM study_projects WHERE user_id = ${runtime.sqlValue(userId)};`) || id);
    runtime.runSqlite(`INSERT INTO study_projects (id, user_id, name, color, is_active, sort_order, schema_version, created_at, updated_at)
VALUES (${id}, ${runtime.sqlValue(userId)}, ${runtime.sqlValue(payload.name || '')}, ${runtime.sqlValue(payload.color || '#2563eb')}, 1, ${runtime.sqlValue(sortOrder)}, ${runtime.entitySchemaVersion}, ${runtime.sqlValue(timestamp)}, ${runtime.sqlValue(timestamp)});`);
    tableChanged();
    return id;
}
function saveSubjectSql(payload) {
    const timestamp = runtime.nowISO();
    if (payload.id && Number(runtime.sqliteScalar(`SELECT COUNT(*) FROM subjects WHERE id = ${runtime.sqlValue(Number(payload.id))};`) || 0)) {
        runtime.runSqlite(`UPDATE subjects SET
name = ${runtime.sqlValue(payload.name || '')},
color = ${runtime.sqlValue(payload.color || '#2563eb')},
is_active = ${runtime.sqlValue(payload.isActive !== false)},
sort_order = ${runtime.sqlValue(Number(payload.sortOrder || 0))},
updated_at = ${runtime.sqlValue(timestamp)}
WHERE id = ${runtime.sqlValue(Number(payload.id))};`);
        tableChanged();
        return Number(payload.id);
    }
    const id = nextTableId('subjects');
    const sortOrder = Number(payload.sortOrder || runtime.sqliteScalar('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM subjects;') || id);
    runtime.runSqlite(`INSERT INTO subjects (id, name, color, is_active, sort_order, schema_version, created_at, updated_at)
VALUES (${id}, ${runtime.sqlValue(payload.name || '')}, ${runtime.sqlValue(payload.color || '#2563eb')}, 1, ${runtime.sqlValue(sortOrder)}, ${runtime.entitySchemaVersion}, ${runtime.sqlValue(timestamp)}, ${runtime.sqlValue(timestamp)});`);
    tableChanged();
    return id;
}
function saveExamSql(payload) {
    const timestamp = runtime.nowISO();
    const id = payload.id && Number(runtime.sqliteScalar(`SELECT COUNT(*) FROM mock_exam_records WHERE id = ${runtime.sqlValue(Number(payload.id))};`) || 0)
        ? Number(payload.id)
        : nextTableId('mock_exam_records');
    const fields = {
        date: payload.date || runtime.todayISO(),
        subjectId: Number(payload.subjectId || 0),
        subjectNameSnapshot: payload.subjectNameSnapshot || '',
        score: Number(payload.score || 0),
        fullScore: Math.max(1, Number(payload.fullScore || 100)),
        paperName: payload.paperName || '',
        durationMinutes: Math.max(0, Number(payload.durationMinutes || 0)),
        wrongCount: Math.max(0, Number(payload.wrongCount || 0)),
        note: payload.note || '',
    };
    runtime.runSqlite(`INSERT INTO mock_exam_records (id, date, subject_id, subject_name_snapshot, score, full_score, paper_name, duration_minutes, wrong_count, note, schema_version, created_at, updated_at)
VALUES (${id}, ${runtime.sqlValue(fields.date)}, ${runtime.sqlValue(fields.subjectId)}, ${runtime.sqlValue(fields.subjectNameSnapshot)}, ${runtime.sqlValue(fields.score)}, ${runtime.sqlValue(fields.fullScore)}, ${runtime.sqlValue(fields.paperName)}, ${runtime.sqlValue(fields.durationMinutes)}, ${runtime.sqlValue(fields.wrongCount)}, ${runtime.sqlValue(fields.note)}, ${runtime.entitySchemaVersion}, ${runtime.sqlValue(timestamp)}, ${runtime.sqlValue(timestamp)})
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
    const timestamp = runtime.nowISO();
    const id = payload.id && Number(runtime.sqliteScalar(`SELECT COUNT(*) FROM short_term_tasks WHERE id = ${runtime.sqlValue(Number(payload.id))};`) || 0)
        ? Number(payload.id)
        : nextTableId('short_term_tasks');
    const existing = runtime.sqliteJson(`SELECT due_date AS dueDate, due_time AS dueTime, reminder_sent_offsets AS reminderSentOffsets
FROM short_term_tasks WHERE id = ${runtime.sqlValue(id)} LIMIT 1;`).map(runtime.normalizeTaskRow)[0] || null;
    const dueDate = payload.dueDate || runtime.todayISO();
    const dueTime = runtime.normalizeTaskDueTime(payload.dueTime);
    const timeChanged = existing && (existing.dueDate !== dueDate || existing.dueTime !== dueTime);
    const reminderEnabled = Boolean(payload.reminderEnabled ?? dueTime) && Boolean(dueTime);
    const sentOffsets = timeChanged ? [] : runtime.normalizeReminderSentOffsets(payload.reminderSentOffsets ?? existing?.reminderSentOffsets);
    const reminderLastSentAt = timeChanged ? null : payload.reminderLastSentAt || existing?.reminderLastSentAt || null;
    runtime.runSqlite(`INSERT INTO short_term_tasks (id, title, due_date, due_time, urgency, is_completed, completed_at, reminder_enabled, reminder_sent_offsets, reminder_last_sent_at, note, schema_version, created_at, updated_at)
VALUES (${id}, ${runtime.sqlValue(payload.title || '')}, ${runtime.sqlValue(dueDate)}, ${runtime.sqlValue(dueTime)}, ${runtime.sqlValue(payload.urgency || 'medium')}, ${runtime.sqlValue(Boolean(payload.isCompleted))}, ${runtime.sqlValue(payload.completedAt || null)}, ${runtime.sqlValue(reminderEnabled)}, ${runtime.sqlValue(JSON.stringify(sentOffsets))}, ${runtime.sqlValue(reminderLastSentAt)}, ${runtime.sqlValue(payload.note || '')}, ${runtime.entitySchemaVersion}, ${runtime.sqlValue(timestamp)}, ${runtime.sqlValue(timestamp)})
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
    const timestamp = runtime.nowISO();
    const review = normalizeReview(payload);
    const id = payload.id || Number(runtime.sqliteScalar(`SELECT id FROM daily_reviews WHERE date = ${runtime.sqlValue(payload.date || runtime.todayISO())} LIMIT 1;`) || 0) || nextTableId('daily_reviews');
    runtime.runSqlite(`INSERT INTO daily_reviews (id, date, summary, wins, problems, tomorrow_plan, score, schema_version, created_at, updated_at)
VALUES (${runtime.sqlValue(id)}, ${runtime.sqlValue(payload.date || runtime.todayISO())}, ${runtime.sqlValue(review.summary || '')}, ${runtime.sqlValue(review.wins || '')}, ${runtime.sqlValue(review.problems || '')}, ${runtime.sqlValue(review.tomorrowPlan || '')}, ${runtime.sqlValue(Math.max(1, Math.min(10, Number(review.score || 6))))}, ${runtime.entitySchemaVersion}, ${runtime.sqlValue(timestamp)}, ${runtime.sqlValue(timestamp)})
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
function saveDayRecordsSql(date, records = [], userId = 1) {
    const timestamp = runtime.nowISO();
    const statements = ['BEGIN;'];
    let nextRecordId = nextTableId('study_time_records');
    for (const record of records) {
        const projectId = Number(record.projectId || 0);
        const project = runtime.sqliteJson(`SELECT name FROM study_projects WHERE id = ${runtime.sqlValue(projectId)} AND user_id = ${runtime.sqlValue(userId)} AND is_active = 1 LIMIT 1;`)[0];
        if (!project) {
            const error = new Error('Project does not belong to this account');
            error.statusCode = 403;
            throw error;
        }
        const existingId = Number(runtime.sqliteScalar(`SELECT id FROM study_time_records WHERE date = ${runtime.sqlValue(date)} AND project_id = ${runtime.sqlValue(projectId)} AND user_id = ${runtime.sqlValue(userId)} LIMIT 1;`) || 0);
        const id = existingId || nextRecordId++;
        statements.push(`INSERT INTO study_time_records (id, user_id, date, project_id, project_name_snapshot, minutes, note, schema_version, created_at, updated_at)
VALUES (${id}, ${runtime.sqlValue(userId)}, ${runtime.sqlValue(date)}, ${runtime.sqlValue(projectId)}, ${runtime.sqlValue(project.name)}, ${runtime.sqlValue(Math.max(0, Number(record.minutes || 0)))}, ${runtime.sqlValue(record.note || '')}, ${runtime.entitySchemaVersion}, ${runtime.sqlValue(timestamp)}, ${runtime.sqlValue(timestamp)})
ON CONFLICT(date, project_id) DO UPDATE SET
project_name_snapshot = excluded.project_name_snapshot,
minutes = excluded.minutes,
note = excluded.note,
updated_at = excluded.updated_at;`);
    }
    statements.push('COMMIT;');
    runtime.runSqlite(statements.join('\n'));
    if (userId === 1)
        refreshStudySummariesForDate(date);
    tableChanged();
}
function saveWaterSql(payload) {
    const timestamp = runtime.nowISO();
    const date = payload.date || runtime.todayISO();
    const id = Number(runtime.sqliteScalar(`SELECT id FROM water_intake_records WHERE date = ${runtime.sqlValue(date)} LIMIT 1;`) || 0) || nextTableId('water_intake_records');
    runtime.runSqlite(`INSERT INTO water_intake_records (id, date, cups, cup_ml, target_cups, schema_version, created_at, updated_at)
VALUES (${id}, ${runtime.sqlValue(date)}, ${runtime.sqlValue(Math.max(0, Number(payload.cups || 0)))}, ${runtime.sqlValue(Math.max(1, Number(payload.cupMl || 500)))}, ${runtime.sqlValue(Math.max(1, Number(payload.targetCups || 6)))}, ${runtime.entitySchemaVersion}, ${runtime.sqlValue(timestamp)}, ${runtime.sqlValue(timestamp)})
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
    const statusClause = status === 'open' || status === 'resolved' ? `AND status = ${runtime.sqlString(status)}` : '';
    return runtime.sqliteJson(`SELECT id, date, text, status, source, created_at AS createdAt, updated_at AS updatedAt, resolved_at AS resolvedAt
FROM problem_inbox_items
WHERE date BETWEEN ${runtime.sqlString(from)} AND ${runtime.sqlString(to)}
${statusClause}
ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, date DESC, updated_at DESC, id DESC
LIMIT ${Math.max(1, Math.min(100, Number(limit) || 12))};`).map(problemInboxRowToObject);
}
function saveProblemInboxItem(payload) {
    const text = String(payload.text || '').trim();
    if (!text)
        throw new Error('Problem inbox text is required');
    const timestamp = runtime.nowISO();
    const id = payload.id && Number(runtime.sqliteScalar(`SELECT COUNT(*) FROM problem_inbox_items WHERE id = ${runtime.sqlValue(Number(payload.id))};`) || 0)
        ? Number(payload.id)
        : nextTableId('problem_inbox_items');
    runtime.runSqlite(`INSERT INTO problem_inbox_items (id, date, text, status, source, created_at, updated_at, resolved_at)
VALUES (${runtime.sqlValue(id)}, ${runtime.sqlValue(payload.date || runtime.todayISO())}, ${runtime.sqlValue(text)}, ${runtime.sqlValue(payload.status || 'open')}, ${runtime.sqlValue(payload.source || 'manual')}, ${runtime.sqlValue(timestamp)}, ${runtime.sqlValue(timestamp)}, ${runtime.sqlValue(payload.resolvedAt || null)})
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
    const timestamp = runtime.nowISO();
    runtime.runSqlite(`UPDATE problem_inbox_items
SET status = ${runtime.sqlString(nextStatus)}, updated_at = ${runtime.sqlString(timestamp)}, resolved_at = ${runtime.sqlValue(nextStatus === 'resolved' ? timestamp : null)}
WHERE id = ${runtime.sqlValue(Number(id))};`);
    tableChanged();
}
function deleteProblemInboxItem(id) {
    runtime.runSqlite(`DELETE FROM problem_inbox_items WHERE id = ${runtime.sqlValue(Number(id))};`);
    tableChanged();
}
function resolveProblemInboxForDate(date = runtime.todayISO()) {
    const timestamp = runtime.nowISO();
    runtime.runSqlite(`UPDATE problem_inbox_items
SET status = 'resolved', updated_at = ${runtime.sqlString(timestamp)}, resolved_at = ${runtime.sqlString(timestamp)}
WHERE date = ${runtime.sqlString(date)} AND status = 'open';`);
    tableChanged();
    return { ok: true, resolvedAt: timestamp };
}
function getStudyTargetMinutes(userId = 1) {
    const value = runtime.sqliteScalar(`SELECT target_minutes FROM user_study_settings WHERE user_id = ${runtime.sqlValue(userId)} LIMIT 1;`);
    if (value !== null && value !== undefined && value !== '')
        return Math.max(0, Number(value) || 0);
    return userId === 1
        ? Math.max(0, Number(runtime.sqliteScalar(`SELECT value FROM app_metadata WHERE key = ${runtime.sqlString(runtime.studyTargetMinutesKey)} LIMIT 1;`) || 0) || 0)
        : 0;
}
function saveStudyTargetMinutes(payload, userId = 1) {
    const hours = Number(payload.targetHours ?? 0);
    const explicitMinutes = Number(payload.targetMinutes ?? NaN);
    const minutes = Number.isFinite(explicitMinutes)
        ? Math.max(0, Math.round(explicitMinutes))
        : Math.max(0, Math.round(hours * 60));
    runtime.runSqlite(`INSERT INTO user_study_settings (user_id, target_minutes, updated_at)
VALUES (${runtime.sqlValue(userId)}, ${runtime.sqlValue(minutes)}, datetime('now'))
ON CONFLICT(user_id) DO UPDATE SET target_minutes = excluded.target_minutes, updated_at = excluded.updated_at;`);
    if (userId === 1) {
        runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES (${runtime.sqlString(runtime.studyTargetMinutesKey)}, ${runtime.sqlString(String(minutes))}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
    }
    tableChanged();
    return { targetMinutes: minutes, targetHours: Math.round((minutes / 60) * 10) / 10 };
}
function getLastNDaysTotals(days, endDate = runtime.todayISO(), userId = 1) {
    const startDate = runtime.addDaysISO(endDate, -(days - 1));
    const rows = runtime.sqliteJson(`SELECT date, COALESCE(SUM(minutes), 0) AS minutes
  FROM study_time_records
  WHERE user_id = ${runtime.sqlValue(userId)} AND date BETWEEN ${runtime.sqlString(startDate)} AND ${runtime.sqlString(endDate)}
  GROUP BY date
ORDER BY date;`);
    const map = new Map(rows.map((row) => [row.date, Number(row.minutes || 0)]));
    return runtime.dateRange(startDate, endDate).map((date) => ({ date, minutes: map.get(date) || 0 }));
}
function getProjectTotals(startDate, endDate, userId = 1) {
    return runtime.sqliteJson(`SELECT project_name_snapshot AS name, COALESCE(SUM(minutes), 0) AS minutes
FROM study_time_records
WHERE user_id = ${runtime.sqlValue(userId)} AND date BETWEEN ${runtime.sqlString(startDate)} AND ${runtime.sqlString(endDate)}
GROUP BY project_name_snapshot
HAVING minutes > 0
ORDER BY minutes DESC, name;`).map((row) => ({ name: row.name, minutes: Number(row.minutes || 0) }));
}
function getProjectDistributionForDate(date, userId = 1) {
    return runtime.sqliteJson(`SELECT project_name_snapshot AS name, COALESCE(SUM(minutes), 0) AS value
FROM study_time_records
WHERE user_id = ${runtime.sqlValue(userId)} AND date = ${runtime.sqlString(date)}
GROUP BY project_name_snapshot
HAVING value > 0
ORDER BY value DESC;`).map((row) => ({ name: row.name, value: Number(row.value || 0) }));
}
function getActivityCalendar(days = 84, endDate = runtime.todayISO()) {
    const startDate = runtime.addDaysISO(endDate, -(days - 1));
    const totals = runtime.sqliteJson(`SELECT date, total_minutes AS minutes
FROM study_daily_summaries
WHERE date BETWEEN ${runtime.sqlString(startDate)} AND ${runtime.sqlString(endDate)};`);
    const reviews = runtime.sqliteJson(`SELECT date, score FROM daily_reviews WHERE date BETWEEN ${runtime.sqlString(startDate)} AND ${runtime.sqlString(endDate)};`);
    const water = runtime.sqliteJson(`SELECT date, cups, target_cups AS targetCups FROM water_intake_records WHERE date BETWEEN ${runtime.sqlString(startDate)} AND ${runtime.sqlString(endDate)};`);
    const taskRows = runtime.sqliteJson(`SELECT due_date AS date, COUNT(*) AS total,
COALESCE(SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END), 0) AS completed
FROM short_term_tasks
WHERE due_date BETWEEN ${runtime.sqlString(startDate)} AND ${runtime.sqlString(endDate)}
GROUP BY due_date;`);
    const totalMap = new Map(totals.map((item) => [item.date, Number(item.minutes || 0)]));
    const reviewMap = new Map(reviews.map((item) => [item.date, Number(item.score || 0)]));
    const waterMap = new Map(water.map((item) => [item.date, { cups: Number(item.cups || 0), targetCups: Number(item.targetCups || 6) }]));
    const taskMap = new Map(taskRows.map((item) => [item.date, { total: Number(item.total || 0), completed: Number(item.completed || 0) }]));
    return runtime.dateRange(startDate, endDate).map((date) => {
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
function getReviewTrendPayload(days = 30, endDate = runtime.todayISO()) {
    const safeDays = Math.max(7, Math.min(120, Number(days) || 30));
    const startDate = runtime.addDaysISO(endDate, -(safeDays - 1));
    const rows = runtime.sqliteJson(`SELECT date, score
FROM daily_reviews
WHERE date BETWEEN ${runtime.sqlString(startDate)} AND ${runtime.sqlString(endDate)}
ORDER BY date;`).map((item) => ({ date: item.date, score: Number(item.score || 0) }));
    const scoreMap = new Map(rows.map((item) => [item.date, item.score]));
    return {
        periodStart: startDate,
        periodEnd: endDate,
        days: safeDays,
        trend: runtime.dateRange(startDate, endDate).map((date) => ({ date, score: scoreMap.get(date) || null })),
    };
}
function getCachedReviewTrend(days = 30, endDate = runtime.todayISO()) {
    const cacheKey = `review-trend:${days}:${endDate}`;
    const cached = getPrecomputedCache(cacheKey);
    if (cached)
        return cached;
    return setPrecomputedCache(cacheKey, getReviewTrendPayload(days, endDate));
}
function getErrorThemeWall(limit = 12, days = 90, endDate = runtime.todayISO()) {
    const startDate = runtime.addDaysISO(endDate, -(Math.max(7, Number(days) || 90) - 1));
    return runtime.sqliteJson(`SELECT t.id, t.normalized_label AS normalizedLabel, t.label,
COUNT(o.id) AS occurrenceCount,
COUNT(DISTINCT o.date) AS reviewDayCount,
MAX(o.date) AS lastSeenAt
FROM error_themes t
JOIN error_theme_occurrences o ON o.theme_id = t.id
WHERE o.date BETWEEN ${runtime.sqlString(startDate)} AND ${runtime.sqlString(endDate)}
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
function getReviewPrefill(date = runtime.todayISO(), sessionRole = 'write') {
    const totalMinutes = Number(runtime.sqliteScalar(`SELECT COALESCE(total_minutes, 0) FROM study_daily_summaries WHERE date = ${runtime.sqlString(date)};`) || 0);
    const topProject = runtime.sqliteJson(`SELECT project_name_snapshot AS name, minutes
FROM study_project_daily_summaries
WHERE date = ${runtime.sqlString(date)}
ORDER BY minutes DESC, project_name_snapshot
LIMIT 1;`).map((item) => ({ name: item.name, minutes: Number(item.minutes || 0) }))[0] || null;
    const unfinishedTasks = runtime.sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency,
reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt
FROM short_term_tasks
WHERE due_date <= ${runtime.sqlString(date)} AND is_completed = 0
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date, due_time, id
LIMIT 6;`).map(runtime.normalizeTaskRow);
    const water = runtime.sqliteJson(`SELECT cups, cup_ml AS cupMl, target_cups AS targetCups
FROM water_intake_records WHERE date = ${runtime.sqlString(date)} LIMIT 1;`)[0] || { cups: 0, cupMl: 500, targetCups: 6 };
    const inboxItems = listProblemInboxItems({ status: 'open', from: date, to: date, limit: 6 });
    const previousReview = runtime.sqliteJson(`SELECT tomorrow_plan AS tomorrowPlan
FROM daily_reviews WHERE date = ${runtime.sqlString(runtime.addDaysISO(date, -1))} LIMIT 1;`)[0] || null;
    const suggestedSummary = [
        totalMinutes ? `今日学习 ${runtime.minutesText(totalMinutes)}。` : '今日还没有记录学习时间。',
        topProject ? `投入最多的是「${topProject.name}」${runtime.minutesText(topProject.minutes)}。` : '',
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
function countdownStage(activeGoal, date = runtime.todayISO()) {
    if (!activeGoal?.deadline)
        return { label: '未设定阶段', tone: 'slate', hint: '设置长期目标后自动判断备考阶段。' };
    const daysLeft = Math.max(0, Math.ceil((runtime.parseDateString(activeGoal.deadline).getTime() - runtime.parseDateString(date).getTime()) / (24 * 60 * 60 * 1000)));
    if (daysLeft <= 30)
        return { label: '冲刺期', tone: 'rose', hint: '优先真题复盘、错题回炉和作息稳定。' };
    if (daysLeft <= 100)
        return { label: '真题期', tone: 'amber', hint: '保持真题节奏，按周复盘薄弱科目。' };
    if (daysLeft <= 220)
        return { label: '强化期', tone: 'blue', hint: '重点放在题型熟练度、错题闭环和专项突破。' };
    return { label: '基础期', tone: 'emerald', hint: '稳住基础概念、教材/课程推进和每日记录。' };
}
function stageChecklist(stageLabel) {
    if (stageLabel === '冲刺期')
        return ['先处理最近真题错因', '安排一轮限时训练', '睡前复盘明日科目顺序'];
    if (stageLabel === '真题期')
        return ['完成一段真题或套卷复盘', '把错因写进问题 Inbox', '留出薄弱科目固定时间'];
    if (stageLabel === '强化期')
        return ['推进一个专项题型', '复看昨日错题', '把任务拆到 45 分钟内'];
    if (stageLabel === '基础期')
        return ['先完成基础知识推进', '记录一个学习时间块', '晚上用 5 分钟复盘'];
    return ['确认长期目标日期', '添加今天最小任务', '完成一次短学习块'];
}
function getDashboardReminders({ today, todayTotal, visibleTasks, waterRecord, todayReview }) {
    const reminders = [];
    if (!todayReview)
        reminders.push({ id: 'review', tone: 'amber', title: '今天还没复盘', detail: '睡前留 5 分钟写下今天的问题和明日计划。' });
    const last7 = getLastNDaysTotals(7, today);
    const previousStudyDays = last7.slice(0, -1).filter((item) => item.minutes > 0);
    const average = previousStudyDays.length ? Math.round(previousStudyDays.reduce((sum, item) => sum + item.minutes, 0) / previousStudyDays.length) : 0;
    if (average && todayTotal < average * 0.6)
        reminders.push({ id: 'study-low', tone: 'rose', title: '今日学习时长偏低', detail: `低于近 7 天学习日均值 ${runtime.minutesText(average)}，先补一个短时段。` });
    const tomorrow = runtime.addDaysISO(today, 1);
    const dueTomorrow = visibleTasks.filter((task) => !task.isCompleted && task.dueDate <= tomorrow);
    if (dueTomorrow.length)
        reminders.push({ id: 'task-due', tone: 'blue', title: '近期目标快到期', detail: `${dueTomorrow.length} 个短期目标在明天前到期。` });
    const cups = Number(waterRecord?.cups || 0);
    const targetCups = Number(waterRecord?.targetCups || 6);
    if (cups < targetCups)
        reminders.push({ id: 'water', tone: cups ? 'amber' : 'rose', title: '喝水未达标', detail: `今日 ${cups}/${targetCups} 杯，离目标还差 ${Math.max(0, targetCups - cups)} 杯。` });
    return reminders.slice(0, 5);
}
function getDashboardPayload(sessionRole) {
    const cacheDate = runtime.todayISO();
    if (runtime.dashboardPayloadCache?.revision === runtime.dataRevision && runtime.dashboardPayloadCache.date === cacheDate) {
        return { ...runtime.dashboardPayloadCache.payload, readOnly: sessionRole === 'read' };
    }
    const today = cacheDate;
    const yesterday = runtime.addDaysISO(today, -1);
    const activeGoal = runtime.sqliteJson(`SELECT id, name, description, deadline, is_active AS isActive, type, notes,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM goals WHERE is_active = 1 ORDER BY id LIMIT 1;`).map((goal) => ({ ...goal, isActive: Boolean(goal.isActive) }))[0] || null;
    const todayTotal = Number(runtime.sqliteScalar(`SELECT COALESCE(total_minutes, 0) FROM study_daily_summaries WHERE date = ${runtime.sqlString(today)};`) || 0);
    const totalStudyMinutes = Number(runtime.sqliteScalar('SELECT COALESCE(SUM(total_minutes), 0) FROM study_daily_summaries;') || 0);
    const studyTargetMinutes = getStudyTargetMinutes();
    const latestExam = runtime.sqliteJson(`SELECT id, date, subject_id AS subjectId, subject_name_snapshot AS subjectNameSnapshot, score, full_score AS fullScore,
paper_name AS paperName, duration_minutes AS durationMinutes, wrong_count AS wrongCount, note,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM mock_exam_records ORDER BY date DESC, id DESC LIMIT 1;`)[0] || null;
    const reviews = runtime.sqliteJson(`SELECT id, date, summary, wins, problems, tomorrow_plan AS tomorrowPlan, score,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM daily_reviews WHERE date IN (${runtime.sqlString(today)}, ${runtime.sqlString(yesterday)});`).map(normalizeReview);
    const visibleTasks = runtime.sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency, is_completed AS isCompleted, completed_at AS completedAt,
reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt, note,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM short_term_tasks
WHERE is_completed = 0 OR date(completed_at) = date(${runtime.sqlString(today)})
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date, due_time, id;`).map(runtime.normalizeTaskRow);
    const waterRecord = runtime.sqliteJson(`SELECT id, date, cups, cup_ml AS cupMl, target_cups AS targetCups,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM water_intake_records WHERE date = ${runtime.sqlString(today)} LIMIT 1;`)[0] || null;
    const todayBrief = runtime.getDailyBriefByDate(today) || runtime.getLatestDailyBriefSummary();
    const englishWritingPlan = runtime.englishWritingPlanForDate(today, runtime.getDailyBriefSettings({ includeSecret: true }));
    const stage = countdownStage(activeGoal, today);
    const daysLeft = activeGoal ? Math.max(1, Math.ceil((runtime.parseDateString(activeGoal.deadline).getTime() - runtime.parseDateString(today).getTime()) / (24 * 60 * 60 * 1000))) : 0;
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
    const breakGuard = runtime.getBreakGuardSummary(today);
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
        englishWritingPlan,
        startupPlan,
        reminders,
        activityCalendar,
        errorThemeWall,
        breakGuard,
    };
    runtime.dashboardPayloadCache = { revision: runtime.dataRevision, date: today, payload };
    return { ...payload, readOnly: sessionRole === 'read' };
}
function getDashboardChartsPayload() {
    const today = runtime.todayISO();
    return {
        today,
        distribution: getProjectDistributionForDate(today),
        trend: getLastNDaysTotals(7, today),
    };
}
function getStatisticsSummary(userId = 1) {
    const cacheDate = runtime.todayISO();
    if (runtime.statisticsSummaryCache?.revision === runtime.dataRevision && runtime.statisticsSummaryCache.date === cacheDate && runtime.statisticsSummaryCache.userId === userId) {
        return runtime.statisticsSummaryCache.payload;
    }
    const today = cacheDate;
    const todayTotal = Number(runtime.sqliteScalar(`SELECT COALESCE(SUM(minutes), 0) FROM study_time_records WHERE user_id = ${runtime.sqlValue(userId)} AND date = ${runtime.sqlString(today)};`) || 0);
    const distribution = getProjectDistributionForDate(today, userId);
    const last7 = getLastNDaysTotals(7, today, userId);
    const last30 = getProjectTotals(runtime.addDaysISO(today, -29), today, userId);
    const payload = { today, todayTotal, distribution, last7, last30 };
    runtime.statisticsSummaryCache = { revision: runtime.dataRevision, date: today, userId, payload };
    return payload;
}
function getLearningProgressPayload(sessionRole = 'write', userId = 1, accountType = 'admin') {
    runtime.ensureSqliteStore();
    const today = runtime.todayISO();
    const start30 = runtime.addDaysISO(today, -29);
    const start7 = runtime.addDaysISO(today, -6);
    const previous7Start = runtime.addDaysISO(today, -13);
    const previous7End = runtime.addDaysISO(today, -7);
    const targetMinutes = getStudyTargetMinutes(userId);
    const dailyRows = runtime.sqliteJson(`SELECT date, COALESCE(SUM(minutes), 0) AS minutes
FROM study_time_records
WHERE user_id = ${runtime.sqlValue(userId)} AND date BETWEEN ${runtime.sqlString(start30)} AND ${runtime.sqlString(today)}
GROUP BY date
ORDER BY date ASC;`);
    const reviewByDate = accountType === 'learner'
        ? new Map()
        : new Map(runtime.sqliteJson(`SELECT date, score FROM daily_reviews WHERE date BETWEEN ${runtime.sqlString(start30)} AND ${runtime.sqlString(today)};`).map((row) => [row.date, Number(row.score)]));
    const dailyByDate = new Map(dailyRows.map((row) => [row.date, row]));
    const daily = runtime.dateRange(start30, today).map((date) => {
        const row = dailyByDate.get(date) || {};
        const minutes = Number(row.minutes || 0);
        const reviewScore = reviewByDate.get(date) ?? null;
        return { date, minutes, reviewScore, targetMinutes, hitTarget: targetMinutes > 0 && minutes >= targetMinutes };
    });
    const current7Minutes = daily.filter((day) => day.date >= start7).reduce((sum, day) => sum + day.minutes, 0);
    const previous7Minutes = Number(runtime.sqliteScalar(`SELECT COALESCE(SUM(minutes), 0) FROM study_time_records WHERE user_id = ${runtime.sqlValue(userId)} AND date BETWEEN ${runtime.sqlString(previous7Start)} AND ${runtime.sqlString(previous7End)};`) || 0);
    const reviewStats = accountType === 'learner' ? {} : runtime.sqliteJson(`SELECT COUNT(*) AS count, AVG(score) AS averageScore FROM daily_reviews WHERE date BETWEEN ${runtime.sqlString(start30)} AND ${runtime.sqlString(today)};`)[0] || {};
    const taskStats = accountType === 'learner' ? {} : runtime.sqliteJson(`SELECT COUNT(*) AS total, SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) AS completed
FROM short_term_tasks
WHERE due_date BETWEEN ${runtime.sqlString(start30)} AND ${runtime.sqlString(today)};`)[0] || {};
    const projectTotals = getProjectTotals(start30, today, userId);
    let studyStreakDays = 0;
    for (let offset = 0; offset < 365; offset += 1) {
        const date = runtime.addDaysISO(today, -offset);
        const minutes = Number(runtime.sqliteScalar(`SELECT COALESCE(SUM(minutes), 0) FROM study_time_records WHERE user_id = ${runtime.sqlValue(userId)} AND date = ${runtime.sqlString(date)};`) || 0);
        if (minutes <= 0)
            break;
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
        accountType,
        readOnly: sessionRole === 'read',
    };
}
function momentumLabel(current, previous) {
    if (current > previous * 1.08)
        return 'up';
    if (current < previous * 0.92)
        return 'down';
    return 'flat';
}
function getProjectProgressPayload(sessionRole = 'write') {
    runtime.ensureSqliteStore();
    const today = runtime.todayISO();
    const start30 = runtime.addDaysISO(today, -29);
    const start7 = runtime.addDaysISO(today, -6);
    const previous7Start = runtime.addDaysISO(today, -13);
    const previous7End = runtime.addDaysISO(today, -7);
    const projects = runtime.sqliteJson(`SELECT id, name, color, is_active AS isActive, sort_order AS sortOrder
FROM study_projects
ORDER BY is_active DESC, sort_order ASC, id ASC;`);
    const totals = runtime.sqliteJson(`SELECT project_id AS projectId,
SUM(minutes) AS totalMinutes,
SUM(CASE WHEN date BETWEEN ${runtime.sqlString(start30)} AND ${runtime.sqlString(today)} THEN minutes ELSE 0 END) AS last30Minutes,
SUM(CASE WHEN date BETWEEN ${runtime.sqlString(start7)} AND ${runtime.sqlString(today)} THEN minutes ELSE 0 END) AS last7Minutes,
SUM(CASE WHEN date BETWEEN ${runtime.sqlString(previous7Start)} AND ${runtime.sqlString(previous7End)} THEN minutes ELSE 0 END) AS previous7Minutes,
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
        generatedAt: runtime.nowISO(),
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
    if (req.method !== 'GET')
        return false;
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname === '/login' || pathname === '/health' || pathname.startsWith('/api/'))
        return false;
    if (['/manifest.webmanifest', '/service-worker.js', '/app-icon.svg', '/favicon.svg', '/icons.svg'].includes(pathname))
        return false;
    return !runtime.extname(pathname);
}
function recordVisitEvent(req, role = 'write') {
    if (!shouldRecordVisit(req))
        return;
    try {
        runtime.ensureSqliteStore();
        const requestUrl = new URL(req.url || '/', 'http://localhost');
        const userAgent = String(req.headers['user-agent'] || '').slice(0, 240);
        const clientHash = runtime.createHash('sha256').update(`${runtime.getClientIp(req)}|${userAgent}`).digest('hex').slice(0, 24);
        runtime.runSqlite(`INSERT INTO visit_events (path, method, role, client_hash, user_agent, created_at)
VALUES (${runtime.sqlString(requestUrl.pathname)}, ${runtime.sqlString(req.method || 'GET')}, ${runtime.sqlString(role)}, ${runtime.sqlString(clientHash)}, ${runtime.sqlString(userAgent)}, ${runtime.sqlString(runtime.nowISO())});`);
    }
    catch (error) {
        console.warn('visit event skipped:', error.message || error);
    }
}
function getVisitStatsPayload(sessionRole = 'write') {
    runtime.ensureSqliteStore();
    const today = runtime.todayISO();
    const start14 = runtime.addDaysISO(today, -13);
    const start7 = runtime.addDaysISO(today, -6);
    const dailyRows = runtime.sqliteJson(`SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS visits, COUNT(DISTINCT client_hash) AS uniqueVisitors
FROM visit_events
WHERE substr(created_at, 1, 10) BETWEEN ${runtime.sqlString(start14)} AND ${runtime.sqlString(today)}
GROUP BY substr(created_at, 1, 10)
ORDER BY date ASC;`);
    const byDate = new Map(dailyRows.map((row) => [row.date, row]));
    const daily = runtime.dateRange(start14, today).map((date) => ({
        date,
        visits: Number(byDate.get(date)?.visits || 0),
        uniqueVisitors: Number(byDate.get(date)?.uniqueVisitors || 0),
    }));
    const total = Number(runtime.sqliteScalar('SELECT COUNT(*) FROM visit_events;') || 0);
    const todayCount = Number(runtime.sqliteScalar(`SELECT COUNT(*) FROM visit_events WHERE substr(created_at, 1, 10) = ${runtime.sqlString(today)};`) || 0);
    const last7 = Number(runtime.sqliteScalar(`SELECT COUNT(*) FROM visit_events WHERE substr(created_at, 1, 10) BETWEEN ${runtime.sqlString(start7)} AND ${runtime.sqlString(today)};`) || 0);
    const uniqueVisitors7 = Number(runtime.sqliteScalar(`SELECT COUNT(DISTINCT client_hash) FROM visit_events WHERE substr(created_at, 1, 10) BETWEEN ${runtime.sqlString(start7)} AND ${runtime.sqlString(today)};`) || 0);
    const topPaths = runtime.sqliteJson(`SELECT path, COUNT(*) AS visits
FROM visit_events
WHERE substr(created_at, 1, 10) BETWEEN ${runtime.sqlString(start14)} AND ${runtime.sqlString(today)}
GROUP BY path
ORDER BY visits DESC, path ASC
LIMIT 8;`).map((row) => ({ path: row.path, visits: Number(row.visits || 0) }));
    const latest = runtime.sqliteJson(`SELECT path, role, user_agent AS userAgent, created_at AS createdAt
FROM visit_events
ORDER BY created_at DESC
LIMIT 12;`).map((row) => ({ path: row.path, role: row.role, userAgent: runtime.compactText(row.userAgent || '', 90), createdAt: row.createdAt }));
    return { generatedAt: runtime.nowISO(), total, today: todayCount, last7, uniqueVisitors7, daily, topPaths, latest, readOnly: sessionRole === 'read' };
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
    if (!runtime.existsSync(filePath))
        return { lines: [], error: 'file not found' };
    const text = runtime.readFileSync(filePath, 'utf8');
    return { lines: text.split(/\r?\n/).slice(-maxLines), error: '' };
}
async function getOpsLogSummaryPayload(sessionRole = 'write') {
    runtime.ensureSqliteStore();
    const sources = [];
    const journal = await runtime.runProcess('journalctl', ['-u', 'exam-planner', '-n', '120', '--no-pager'], { timeoutMs: 5000, maxBuffer: 512 * 1024 });
    if (!journal.ok) {
        sources.push(summarizeLogLines('systemd:exam-planner', [], journal.error?.message || journal.stderr || 'journalctl unavailable'));
    }
    else {
        sources.push(summarizeLogLines('systemd:exam-planner', journal.stdout.split(/\r?\n/)));
    }
    for (const [name, filePath] of [['nginx:access', '/var/log/nginx/access.log'], ['nginx:error', '/var/log/nginx/error.log']]) {
        try {
            const result = readTailFile(filePath);
            sources.push(summarizeLogLines(name, result.lines, result.error));
        }
        catch (error) {
            sources.push(summarizeLogLines(name, [], error.message || String(error)));
        }
    }
    const auditEvents = runtime.opsRepository.listAuditEvents(12);
    const slowApi = runtime.opsRepository.listSlowApi(12);
    const apiMetrics = runtime.opsRepository.getApiMetrics();
    const clientErrors = {
        metrics: runtime.opsRepository.getClientErrorMetrics(),
        latest: runtime.opsRepository.listClientErrors(12),
    };
    return { generatedAt: runtime.nowISO(), sources, auditEvents, slowApi, apiMetrics, clientErrors, readOnly: sessionRole === 'read' };
}
function getGoalsList(sessionRole) {
    const items = runtime.sqliteJson(`SELECT id, name, description, deadline, is_active AS isActive, type, notes,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM goals
ORDER BY created_at DESC, id DESC;`).map((goal) => ({ ...goal, isActive: Boolean(goal.isActive) }));
    return { items, readOnly: sessionRole === 'read' };
}
function getProjectsList(sessionRole, userId = 1) {
    const items = runtime.sqliteJson(`SELECT id, name, color, is_active AS isActive, sort_order AS sortOrder,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM study_projects
WHERE user_id = ${runtime.sqlValue(userId)}
ORDER BY sort_order, id;`).map((project) => ({ ...project, isActive: Boolean(project.isActive) }));
    return { items, readOnly: sessionRole === 'read' };
}
function getSubjectsList(sessionRole) {
    const items = runtime.sqliteJson(`SELECT id, name, color, is_active AS isActive, sort_order AS sortOrder,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM subjects
ORDER BY sort_order, id;`).map((subject) => ({ ...subject, isActive: Boolean(subject.isActive) }));
    return { items, readOnly: sessionRole === 'read' };
}
function selectExamRecord(whereClause, orderClause = 'ORDER BY date DESC, id DESC', suffix = '') {
    return runtime.sqliteJson(`SELECT id, date, subject_id AS subjectId, subject_name_snapshot AS subjectNameSnapshot, score, full_score AS fullScore,
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
    const whereClause = subjectId ? `WHERE subject_id = ${runtime.sqlValue(subjectId)}` : '';
    const limit = runtime.queryLimit(requestUrl.searchParams, 20, 100) ?? 20;
    const offset = runtime.queryOffset(requestUrl.searchParams);
    const total = Number(runtime.sqliteScalar(`SELECT COUNT(*) FROM mock_exam_records ${whereClause};`) || 0);
    const exams = selectExamRecord(whereClause, 'ORDER BY date DESC, id DESC', `LIMIT ${limit} OFFSET ${offset}`);
    const latest = selectExamRecord(whereClause, 'ORDER BY date DESC, id DESC', 'LIMIT 1')[0] || null;
    const statsRow = runtime.sqliteJson(`SELECT MAX(score) AS highest, ROUND(AVG(score), 1) AS average, MIN(score) AS lowest
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
    if (typeof review.score === 'number')
        return review;
    if (typeof review.statusScore === 'number' && typeof review.satisfactionScore === 'number') {
        return { ...review, score: Math.round(((review.statusScore + review.satisfactionScore) / 10) * 10) };
    }
    return { ...review, score: 6 };
}

exposeRuntime({ "readState": () => readState, "writeState": () => writeState, "countConfusingWordsGroups": () => countConfusingWordsGroups, "normalizeConfusingWordsPayload": () => normalizeConfusingWordsPayload, "hashConfusingWordsPayload": () => hashConfusingWordsPayload, "summarizeConfusingWordsPayload": () => summarizeConfusingWordsPayload, "readConfusingWordsBackupPayload": () => readConfusingWordsBackupPayload, "insertConfusingWordsBackupVersion": () => insertConfusingWordsBackupVersion, "saveConfusingWordsBackupPayload": () => saveConfusingWordsBackupPayload, "listConfusingWordsBackupVersions": () => listConfusingWordsBackupVersions, "seedCurrentConfusingWordsBackupVersionIfNeeded": () => seedCurrentConfusingWordsBackupVersionIfNeeded, "cleanChineseDefinition": () => cleanChineseDefinition, "buildDictionaryEntry": () => buildDictionaryEntry, "ensureDictionaryIndex": () => ensureDictionaryIndex, "findDictionaryEntry": () => findDictionaryEntry, "nextTableId": () => nextTableId, "tableChanged": () => tableChanged, "sourceUpdatedAt": () => sourceUpdatedAt, "setPrecomputedCache": () => setPrecomputedCache, "getPrecomputedCache": () => getPrecomputedCache, "rebuildStudySummaries": () => rebuildStudySummaries, "refreshStudySummariesForDate": () => refreshStudySummariesForDate, "ensureStudySummariesReady": () => ensureStudySummariesReady, "saveGoalSql": () => saveGoalSql, "saveProjectSql": () => saveProjectSql, "saveSubjectSql": () => saveSubjectSql, "saveExamSql": () => saveExamSql, "saveTaskSql": () => saveTaskSql, "upsertReviewSql": () => upsertReviewSql, "saveDayRecordsSql": () => saveDayRecordsSql, "saveWaterSql": () => saveWaterSql, "problemInboxRowToObject": () => problemInboxRowToObject, "listProblemInboxItems": () => listProblemInboxItems, "saveProblemInboxItem": () => saveProblemInboxItem, "setProblemInboxStatus": () => setProblemInboxStatus, "deleteProblemInboxItem": () => deleteProblemInboxItem, "resolveProblemInboxForDate": () => resolveProblemInboxForDate, "getStudyTargetMinutes": () => getStudyTargetMinutes, "saveStudyTargetMinutes": () => saveStudyTargetMinutes, "getLastNDaysTotals": () => getLastNDaysTotals, "getProjectTotals": () => getProjectTotals, "getProjectDistributionForDate": () => getProjectDistributionForDate, "getActivityCalendar": () => getActivityCalendar, "getReviewTrendPayload": () => getReviewTrendPayload, "getCachedReviewTrend": () => getCachedReviewTrend, "getErrorThemeWall": () => getErrorThemeWall, "getReviewPrefill": () => getReviewPrefill, "countdownStage": () => countdownStage, "stageChecklist": () => stageChecklist, "getDashboardReminders": () => getDashboardReminders, "getDashboardPayload": () => getDashboardPayload, "getDashboardChartsPayload": () => getDashboardChartsPayload, "getStatisticsSummary": () => getStatisticsSummary, "getLearningProgressPayload": () => getLearningProgressPayload, "momentumLabel": () => momentumLabel, "getProjectProgressPayload": () => getProjectProgressPayload, "shouldRecordVisit": () => shouldRecordVisit, "recordVisitEvent": () => recordVisitEvent, "getVisitStatsPayload": () => getVisitStatsPayload, "redactLogLine": () => redactLogLine, "summarizeLogLines": () => summarizeLogLines, "readTailFile": () => readTailFile, "getOpsLogSummaryPayload": () => getOpsLogSummaryPayload, "getGoalsList": () => getGoalsList, "getProjectsList": () => getProjectsList, "getSubjectsList": () => getSubjectsList, "selectExamRecord": () => selectExamRecord, "getMockExamList": () => getMockExamList, "normalizeReview": () => normalizeReview }, {  });
