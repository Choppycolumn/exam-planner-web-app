export async function handleLearningWriteRoutes(req, res, dependencies) {
  if (req.method !== 'POST') return false;

  const {
    sessionRole,
    sendJson,
    readJsonBody,
    ensureSqliteStore,
    currentPeriod,
    previousPeriod,
    runExclusiveTask,
    generateLearningReport,
    writeState,
    baseState,
    writeAuditEvent,
    saveGoalSql,
    saveProjectSql,
    saveSubjectSql,
    saveExamSql,
    saveTaskSql,
    runSqlite,
    sqlValue,
    nowISO,
    saveWaterSql,
    saveStudyTargetMinutes,
    saveProblemInboxItem,
    listProblemInboxItems,
    setProblemInboxStatus,
    deleteProblemInboxItem,
    resolveProblemInboxForDate,
    todayISO,
    upsertReviewSql,
    saveDayRecordsSql,
    tableChanged,
  } = dependencies;

  const body = await readJsonBody(req);
  const timestamp = nowISO();

  if (req.url === '/api/reports/generate') {
    ensureSqliteStore();
    const kind = body.kind === 'monthly' ? 'monthly' : 'weekly';
    const period = body.period === 'previous' ? previousPeriod(kind) : currentPeriod(kind);
    const periodStart = body.periodStart || period.periodStart;
    const periodEnd = body.periodEnd || period.periodEnd;
    const task = await runExclusiveTask(
      `report-${kind}-${periodStart}-${periodEnd}`,
      'manual',
      () => generateLearningReport(kind, periodStart, periodEnd, 'manual'),
      { timeoutMs: 3 * 60 * 1000 },
    );
    sendJson(res, { ok: true, report: task.result, task: { id: task.taskId, durationMs: task.durationMs } });
    return true;
  }

  if (req.url === '/api/reset') {
    writeState(baseState());
    writeAuditEvent({ action: 'state_reset', req, actorRole: sessionRole });
    sendJson(res, { ok: true });
    return true;
  }

  const directRoutes = {
    '/api/goals/save': () => saveGoalSql(body),
    '/api/projects/save': () => saveProjectSql(body),
    '/api/subjects/save': () => saveSubjectSql(body),
    '/api/exams/save': () => saveExamSql(body),
    '/api/tasks/save': () => saveTaskSql(body),
  };

  if (directRoutes[req.url]) {
    sendJson(res, directRoutes[req.url]());
    return true;
  }

  if (req.url === '/api/goals/activate') {
    runSqlite(`UPDATE goals SET is_active = CASE WHEN id = ${sqlValue(Number(body.id))} THEN 1 ELSE 0 END, updated_at = ${sqlValue(timestamp)};`);
    tableChanged();
    sendJson(res, { ok: true });
    return true;
  }

  if (req.url === '/api/water/save') {
    saveWaterSql(body);
    sendJson(res, { ok: true });
    return true;
  }

  if (req.url === '/api/settings/study-target') {
    sendJson(res, saveStudyTargetMinutes(body));
    return true;
  }

  if (req.url === '/api/problem-inbox/save') {
    const id = saveProblemInboxItem(body);
    const item = listProblemInboxItems({
      status: 'all',
      limit: 1,
      from: body.date || '1900-01-01',
      to: body.date || '2999-12-31',
    }).find((candidate) => candidate.id === id) || null;
    sendJson(res, { ok: true, id, item });
    return true;
  }

  if (req.url === '/api/problem-inbox/status') {
    setProblemInboxStatus(body.id, body.status);
    sendJson(res, { ok: true });
    return true;
  }

  if (req.url === '/api/problem-inbox/remove') {
    deleteProblemInboxItem(body.id);
    sendJson(res, { ok: true });
    return true;
  }

  if (req.url === '/api/problem-inbox/resolve-date') {
    sendJson(res, resolveProblemInboxForDate(body.date || todayISO()));
    return true;
  }

  if (req.url === '/api/reviews/upsert') {
    sendJson(res, upsertReviewSql(body));
    return true;
  }

  if (req.url === '/api/study-records/save-day') {
    saveDayRecordsSql(body.date || todayISO(), body.records || []);
    sendJson(res, { ok: true });
    return true;
  }

  const statementBuilders = {
    '/api/goals/remove': () => `DELETE FROM goals WHERE id = ${sqlValue(Number(body.id))};`,
    '/api/projects/remove': () => `UPDATE study_projects SET is_active = 0, updated_at = ${sqlValue(timestamp)} WHERE id = ${sqlValue(Number(body.id))};`,
    '/api/subjects/remove': () => `UPDATE subjects SET is_active = 0, updated_at = ${sqlValue(timestamp)} WHERE id = ${sqlValue(Number(body.id))};`,
    '/api/exams/remove': () => `DELETE FROM mock_exam_records WHERE id = ${sqlValue(Number(body.id))};`,
    '/api/tasks/remove': () => `DELETE FROM short_term_tasks WHERE id = ${sqlValue(Number(body.id))};`,
    '/api/tasks/toggle': () => `UPDATE short_term_tasks SET is_completed = ${sqlValue(Boolean(body.completed))}, completed_at = ${sqlValue(body.completed ? timestamp : null)}, updated_at = ${sqlValue(timestamp)} WHERE id = ${sqlValue(Number(body.id))};`,
  };

  if (statementBuilders[req.url]) {
    runSqlite(statementBuilders[req.url]());
    tableChanged();
    sendJson(res, { ok: true });
    return true;
  }

  return false;
}
