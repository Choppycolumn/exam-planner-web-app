function userId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('valid userId is required');
  return parsed;
}

function limit(value, fallback = 12, maximum = 100) {
  return Math.max(1, Math.min(maximum, Number(value) || fallback));
}

export function createReportRepository(database) {
  function periodThemes(periodStart, periodEnd, maxItems = 6) {
    return database.json(`SELECT t.id,t.normalized_label AS normalizedLabel,t.label,
COUNT(o.id) AS count,COUNT(DISTINCT o.date) AS days
FROM error_themes t JOIN error_theme_occurrences o ON o.theme_id=t.id
WHERE o.date BETWEEN ? AND ?
GROUP BY t.id
ORDER BY days DESC,count DESC,MAX(o.date) DESC,t.label
LIMIT ?;`, [periodStart, periodEnd, limit(maxItems, 6, 30)]);
  }

  function themeDates(themeId, periodStart, periodEnd) {
    return database.json(`SELECT DISTINCT date FROM error_theme_occurrences
WHERE theme_id=? AND date BETWEEN ? AND ? ORDER BY date;`, [
      Number(themeId), periodStart, periodEnd,
    ]).map((row) => row.date);
  }

  function themeExamples(themeId, periodStart, periodEnd, maxItems = 3) {
    return database.json(`SELECT date,field,evidence AS text FROM error_theme_occurrences
WHERE theme_id=? AND date BETWEEN ? AND ?
ORDER BY date DESC,confidence DESC,id DESC LIMIT ?;`, [
      Number(themeId), periodStart, periodEnd, limit(maxItems, 3, 20),
    ]);
  }

  function latestBatch() {
    return database.json(`SELECT id,source,model_name AS modelName,period_start AS periodStart,
period_end AS periodEnd,review_count AS reviewCount,occurrence_count AS occurrenceCount,
theme_count AS themeCount,status,created_at AS createdAt,completed_at AS completedAt,note
FROM error_theme_batches ORDER BY created_at DESC,id DESC LIMIT 1;`)[0] || null;
  }

  function analysisThemes(periodStart, periodEnd, maxItems = 12) {
    return database.json(`SELECT t.id,t.normalized_label AS normalizedLabel,t.label,
COUNT(o.id) AS occurrenceCount,COUNT(DISTINCT o.date) AS reviewDayCount,
ROUND(AVG(o.confidence),2) AS averageConfidence,MIN(o.date) AS firstSeenAt,
MAX(o.date) AS lastSeenAt
FROM error_themes t JOIN error_theme_occurrences o ON o.theme_id=t.id
WHERE o.date BETWEEN ? AND ?
GROUP BY t.id
ORDER BY reviewDayCount DESC,occurrenceCount DESC,lastSeenAt DESC,t.label
LIMIT ?;`, [periodStart, periodEnd, limit(maxItems, 12, 50)]);
  }

  function occurrenceExamples(themeId, periodStart, periodEnd, maxItems = 3) {
    return database.json(`SELECT id AS occurrenceId,date,field,evidence,confidence,source
FROM error_theme_occurrences WHERE theme_id=? AND date BETWEEN ? AND ?
ORDER BY date DESC,confidence DESC,id DESC LIMIT ?;`, [
      Number(themeId), periodStart, periodEnd, limit(maxItems, 3, 20),
    ]);
  }

  function timeline(periodStart, periodEnd, themeId = null) {
    const byTheme = Number(themeId) > 0;
    return database.json(`SELECT date,COUNT(*) AS count FROM error_theme_occurrences
WHERE ${byTheme ? 'theme_id=? AND ' : ''}date BETWEEN ? AND ?
GROUP BY date ORDER BY date;`, byTheme
      ? [Number(themeId), periodStart, periodEnd]
      : [periodStart, periodEnd]);
  }

  function analysisTotals(periodStart, periodEnd) {
    return database.json(`SELECT COUNT(*) AS occurrenceCount,
COUNT(DISTINCT theme_id) AS themeCount,COUNT(DISTINCT date) AS reviewDayCount
FROM error_theme_occurrences WHERE date BETWEEN ? AND ?;`, [periodStart, periodEnd])[0] || {};
  }

  function getTheme(themeId) {
    return database.json(`SELECT id,normalized_label AS normalizedLabel,label,
occurrence_count AS occurrenceCount,review_day_count AS reviewDayCount,
first_seen_at AS firstSeenAt,last_seen_at AS lastSeenAt
FROM error_themes WHERE id=? LIMIT 1;`, [Number(themeId)])[0] || null;
  }

  function detailOccurrences(themeId, periodStart, periodEnd) {
    return database.json(`SELECT o.id AS occurrenceId,o.date,o.field,o.evidence,o.confidence,
o.source,o.review_id AS reviewId,r.summary,r.wins,r.problems,
r.tomorrow_plan AS tomorrowPlan,r.score
FROM error_theme_occurrences o LEFT JOIN daily_reviews r ON r.id=o.review_id
WHERE o.theme_id=? AND o.date BETWEEN ? AND ?
ORDER BY o.date DESC,o.confidence DESC,o.id DESC;`, [Number(themeId), periodStart, periodEnd]);
  }

  function detailByField(themeId, periodStart, periodEnd) {
    return database.json(`SELECT field,COUNT(*) AS count FROM error_theme_occurrences
WHERE theme_id=? AND date BETWEEN ? AND ?
GROUP BY field ORDER BY count DESC,field;`, [Number(themeId), periodStart, periodEnd]);
  }

  function repeatedWeeks(themeId, periodStart, periodEnd) {
    return database.json(`SELECT strftime('%Y-W%W',date) AS week,COUNT(*) AS count,
MIN(date) AS startDate,MAX(date) AS endDate
FROM error_theme_occurrences WHERE theme_id=? AND date BETWEEN ? AND ?
GROUP BY week HAVING count>=3 ORDER BY week DESC;`, [Number(themeId), periodStart, periodEnd]);
  }

  function clearGeneratedOccurrences(periodStart, periodEnd) {
    database.execute(`DELETE FROM error_theme_occurrences
WHERE date BETWEEN ? AND ?
AND source IN ('local-embedding-batch','local-rule-batch','local-model-batch','local-correction-sample');`, [
      periodStart, periodEnd,
    ]);
  }

  function upsertTheme(themeKey, label, timestamp) {
    database.execute(`INSERT INTO error_themes(normalized_label,label,created_at,updated_at)
VALUES(?,?,?,?)
ON CONFLICT(normalized_label) DO UPDATE SET label=excluded.label,updated_at=excluded.updated_at;`, [
      themeKey, label, timestamp, timestamp,
    ]);
    return Number(database.scalar('SELECT id FROM error_themes WHERE normalized_label=? LIMIT 1;', [themeKey]) || 0);
  }

  function refreshThemeStats(timestamp) {
    database.execute(`UPDATE error_themes SET
occurrence_count=(SELECT COUNT(*) FROM error_theme_occurrences WHERE theme_id=error_themes.id),
review_day_count=(SELECT COUNT(DISTINCT date) FROM error_theme_occurrences WHERE theme_id=error_themes.id),
first_seen_at=(SELECT MIN(date) FROM error_theme_occurrences WHERE theme_id=error_themes.id),
last_seen_at=(SELECT MAX(date) FROM error_theme_occurrences WHERE theme_id=error_themes.id),
updated_at=?;`, [timestamp]);
  }

  function getOccurrence(occurrenceId) {
    return database.json(`SELECT o.id,o.review_id AS reviewId,o.date,o.field,o.evidence,
o.theme_id AS themeId,t.normalized_label AS sourceThemeKey,t.label AS sourceLabel
FROM error_theme_occurrences o JOIN error_themes t ON t.id=o.theme_id
WHERE o.id=? LIMIT 1;`, [Number(occurrenceId)])[0] || null;
  }

  function upsertCorrection(correction) {
    database.execute(`INSERT INTO error_theme_corrections(
sentence_hash,sentence,action,target_theme_key,target_label,source_theme_key,source_label,
review_id,date,field,created_at,updated_at)
VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(sentence_hash,action,target_theme_key) DO UPDATE SET
sentence=excluded.sentence,source_theme_key=excluded.source_theme_key,
source_label=excluded.source_label,review_id=excluded.review_id,date=excluded.date,
field=excluded.field,updated_at=excluded.updated_at;`, [
      correction.sentenceHash,
      correction.sentence,
      correction.action,
      correction.targetThemeKey,
      correction.targetLabel,
      correction.sourceThemeKey,
      correction.sourceLabel,
      correction.reviewId,
      correction.date,
      correction.field,
      correction.createdAt,
      correction.updatedAt,
    ]);
  }

  function deleteOccurrence(occurrenceId) {
    database.execute('DELETE FROM error_theme_occurrences WHERE id=?;', [Number(occurrenceId)]);
  }

  function relabelOccurrence(occurrenceId, targetThemeId, timestamp) {
    database.execute(`UPDATE error_theme_occurrences
SET theme_id=?,confidence=0.99,source='local-correction-sample',created_at=?
WHERE id=?;`, [Number(targetThemeId), timestamp, Number(occurrenceId)]);
  }

  function insertBatch(batch) {
    const result = database.execute(`INSERT INTO error_theme_batches(
source,model_name,period_start,period_end,review_count,occurrence_count,theme_count,
status,created_at,completed_at,note)
VALUES(?,?,?,?,?,?,?,?,?,?,?);`, [
      batch.source,
      batch.modelName,
      batch.periodStart,
      batch.periodEnd,
      Number(batch.reviewCount || 0),
      Number(batch.occurrenceCount || 0),
      Number(batch.themeCount || 0),
      batch.status || 'completed',
      batch.timestamp,
      batch.completedAt,
      batch.note || '',
    ]);
    return Number(result.lastInsertRowid || 0);
  }

  function countReviews(accountId, periodStart, periodEnd) {
    return Number(database.scalar(`SELECT COUNT(*) FROM daily_reviews
WHERE user_id=? AND date BETWEEN ? AND ?;`, [userId(accountId), periodStart, periodEnd]) || 0);
  }

  function reviewSources(accountId, periodStart, periodEnd) {
    const id = userId(accountId);
    return {
      reviews: database.json(`SELECT id,date,summary,wins,problems,tomorrow_plan AS tomorrowPlan
FROM daily_reviews WHERE user_id=? AND date BETWEEN ? AND ? ORDER BY date;`, [id, periodStart, periodEnd]),
      inboxItems: database.json(`SELECT id,date,text FROM problem_inbox_items
WHERE user_id=? AND status='open' AND date BETWEEN ? AND ? ORDER BY date,id;`, [
        id, periodStart, periodEnd,
      ]),
    };
  }

  function insertOccurrence(occurrence) {
    database.execute(`INSERT OR IGNORE INTO error_theme_occurrences(
theme_id,batch_id,review_id,date,field,evidence,confidence,source,created_at)
VALUES(?,?,?,?,?,?,?,?,?);`, [
      occurrence.themeId,
      occurrence.batchId,
      occurrence.reviewId,
      occurrence.date,
      occurrence.field,
      occurrence.evidence,
      occurrence.confidence,
      occurrence.source,
      occurrence.createdAt,
    ]);
  }

  function storeSentenceEmbeddings(segments, vectors, backend, modelName, dimensions, timestamp) {
    database.transaction((connection) => {
      const statement = connection.prepare(`INSERT OR IGNORE INTO review_sentence_embeddings(
review_id,date,field,sentence,sentence_hash,model_name,backend,vector_json,dimensions,created_at)
VALUES(?,?,?,?,?,?,?,?,?,?);`);
      segments.forEach((segment, index) => {
        const vector = vectors[index];
        if (!vector) return;
        statement.run(
          segment.reviewId,
          segment.date,
          segment.field,
          segment.sentence,
          segment.sentenceHash,
          modelName,
          backend,
          JSON.stringify(vector),
          dimensions,
          timestamp,
        );
      });
    });
  }

  function listCorrections() {
    return database.json(`SELECT id,sentence_hash AS sentenceHash,sentence,action,
target_theme_key AS targetThemeKey,target_label AS targetLabel,
source_theme_key AS sourceThemeKey,source_label AS sourceLabel,
review_id AS reviewId,date,field
FROM error_theme_corrections ORDER BY updated_at DESC,created_at DESC,id DESC;`);
  }

  function learningReportSource(accountId, periodStart, periodEnd) {
    const id = userId(accountId);
    return {
      dailyRows: database.json(`SELECT date,COALESCE(SUM(minutes),0) AS minutes
FROM study_time_records WHERE user_id=? AND date BETWEEN ? AND ?
GROUP BY date ORDER BY date;`, [id, periodStart, periodEnd]),
      projectTotals: database.json(`SELECT project_name_snapshot AS name,
COALESCE(SUM(minutes),0) AS minutes
FROM study_time_records WHERE user_id=? AND date BETWEEN ? AND ?
GROUP BY project_name_snapshot HAVING minutes>0
ORDER BY minutes DESC,name LIMIT 12;`, [id, periodStart, periodEnd]),
      reviews: database.json(`SELECT date,score,summary,wins,problems,
tomorrow_plan AS tomorrowPlan FROM daily_reviews
WHERE user_id=? AND date BETWEEN ? AND ? ORDER BY date;`, [id, periodStart, periodEnd]),
      exams: database.json(`SELECT date,subject_name_snapshot AS subjectName,score,
full_score AS fullScore,paper_name AS paperName FROM mock_exam_records
WHERE user_id=? AND date BETWEEN ? AND ? ORDER BY date DESC,id DESC;`, [id, periodStart, periodEnd]),
      taskStats: database.json(`SELECT COUNT(*) AS total,
COALESCE(SUM(CASE WHEN is_completed=1 THEN 1 ELSE 0 END),0) AS completed
FROM short_term_tasks WHERE user_id=? AND due_date BETWEEN ? AND ?;`, [id, periodStart, periodEnd])[0] || {},
      waterStats: database.json(`SELECT COALESCE(SUM(cups),0) AS cups,
COALESCE(SUM(cups*cup_ml),0) AS ml FROM water_intake_records
WHERE user_id=? AND date BETWEEN ? AND ?;`, [id, periodStart, periodEnd])[0] || {},
    };
  }

  function saveLearningReport(accountId, report, updatedAt) {
    database.execute(`INSERT INTO learning_reports(
user_id,kind,period_start,period_end,title,payload_json,generated_at,updated_at)
VALUES(?,?,?,?,?,?,?,?)
ON CONFLICT(user_id,kind,period_start,period_end) DO UPDATE SET
title=excluded.title,payload_json=excluded.payload_json,
generated_at=excluded.generated_at,updated_at=excluded.updated_at;`, [
      userId(accountId),
      report.kind,
      report.periodStart,
      report.periodEnd,
      report.title,
      JSON.stringify(report),
      report.generatedAt,
      updatedAt,
    ]);
  }

  function learningReportExists(accountId, kind, periodStart, periodEnd) {
    return Number(database.scalar(`SELECT COUNT(*) FROM learning_reports
WHERE user_id=? AND kind=? AND period_start=? AND period_end=?;`, [
      userId(accountId), kind, periodStart, periodEnd,
    ]) || 0) > 0;
  }

  function listLearningReports(accountId, maxItems = 24) {
    return database.json(`SELECT id,kind,period_start AS periodStart,period_end AS periodEnd,
title,payload_json AS payloadJson,generated_at AS generatedAt,updated_at AS updatedAt
FROM learning_reports WHERE user_id=?
ORDER BY period_end DESC,kind DESC LIMIT ?;`, [userId(accountId), limit(maxItems, 24, 100)]);
  }

  function operationalSnapshot() {
    const corrections = database.json(`SELECT COUNT(*) AS count,
MAX(updated_at) AS lastUpdatedAt FROM error_theme_corrections;`)[0] || {};
    return {
      latestBatch: latestBatch(),
      corrections,
      embeddingRows: Number(database.scalar('SELECT COUNT(*) FROM review_sentence_embeddings;') || 0),
      reviewRows: Number(database.scalar('SELECT COUNT(*) FROM daily_reviews;') || 0),
      studyRows: Number(database.scalar('SELECT COUNT(*) FROM study_time_records;') || 0),
    };
  }

  return {
    periodThemes,
    themeDates,
    themeExamples,
    latestBatch,
    analysisThemes,
    occurrenceExamples,
    timeline,
    analysisTotals,
    getTheme,
    detailOccurrences,
    detailByField,
    repeatedWeeks,
    clearGeneratedOccurrences,
    upsertTheme,
    refreshThemeStats,
    getOccurrence,
    upsertCorrection,
    deleteOccurrence,
    relabelOccurrence,
    insertBatch,
    countReviews,
    reviewSources,
    insertOccurrence,
    storeSentenceEmbeddings,
    listCorrections,
    learningReportSource,
    saveLearningReport,
    learningReportExists,
    listLearningReports,
    operationalSnapshot,
  };
}
