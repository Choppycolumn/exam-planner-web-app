export async function handleLearningWriteRoutes(req, res, dependencies) {
  if (req.method !== 'POST') return false;

  const {
    session,
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
    learningRepository,
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
  const userId = Number(session?.userId || 1);

  const body = await readJsonBody(req);
  const timestamp = nowISO();

  if (req.url === '/api/reports/generate') {
    ensureSqliteStore();
    const kind = body.kind === 'monthly' ? 'monthly' : 'weekly';
    const period = body.period === 'previous' ? previousPeriod(kind) : currentPeriod(kind);
    const periodStart = body.periodStart || period.periodStart;
    const periodEnd = body.periodEnd || period.periodEnd;
    const task = await runExclusiveTask(
      `report-${userId}-${kind}-${periodStart}-${periodEnd}`,
      'manual',
      () => generateLearningReport(kind, periodStart, periodEnd, 'manual', userId),
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
    '/api/goals/save': () => saveGoalSql(body, userId),
    '/api/projects/save': () => saveProjectSql(body, userId),
    '/api/subjects/save': () => saveSubjectSql(body, userId),
    '/api/exams/save': () => saveExamSql(body, userId),
    '/api/tasks/save': () => saveTaskSql(body, userId),
  };

  if (directRoutes[req.url]) {
    sendJson(res, directRoutes[req.url]());
    return true;
  }

  if (req.url === '/api/goals/activate') {
    learningRepository.activateGoal(Number(body.id), timestamp, userId);
    tableChanged();
    sendJson(res, { ok: true });
    return true;
  }

  if (req.url === '/api/water/save') {
    saveWaterSql(body, userId);
    sendJson(res, { ok: true });
    return true;
  }

  if (req.url === '/api/settings/study-target') {
    sendJson(res, saveStudyTargetMinutes(body, userId));
    return true;
  }

  if (req.url === '/api/problem-inbox/save') {
    const id = saveProblemInboxItem(body, userId);
    const item = listProblemInboxItems({
      status: 'all',
      limit: 1,
      from: body.date || '1900-01-01',
      to: body.date || '2999-12-31',
    }, userId).find((candidate) => candidate.id === id) || null;
    sendJson(res, { ok: true, id, item });
    return true;
  }

  if (req.url === '/api/problem-inbox/status') {
    setProblemInboxStatus(body.id, body.status, userId);
    sendJson(res, { ok: true });
    return true;
  }

  if (req.url === '/api/problem-inbox/remove') {
    deleteProblemInboxItem(body.id, userId);
    sendJson(res, { ok: true });
    return true;
  }

  if (req.url === '/api/problem-inbox/resolve-date') {
    sendJson(res, resolveProblemInboxForDate(body.date || todayISO(), userId));
    return true;
  }

  if (req.url === '/api/reviews/upsert') {
    sendJson(res, upsertReviewSql(body, userId));
    return true;
  }

  if (req.url === '/api/study-records/save-day') {
    saveDayRecordsSql(body.date || todayISO(), body.records || [], userId);
    sendJson(res, { ok: true });
    return true;
  }

  const mutations = {
    '/api/goals/remove': () => learningRepository.removeGoal(Number(body.id), userId),
    '/api/projects/remove': () => learningRepository.removeProject(Number(body.id), timestamp, userId),
    '/api/subjects/remove': () => learningRepository.removeSubject(Number(body.id), timestamp, userId),
    '/api/exams/remove': () => learningRepository.removeExam(Number(body.id), userId),
    '/api/tasks/remove': () => learningRepository.removeTask(Number(body.id), userId),
    '/api/tasks/toggle': () => learningRepository.toggleTask(Number(body.id), Boolean(body.completed), timestamp, userId),
  };

  if (mutations[req.url]) {
    mutations[req.url]();
    tableChanged();
    sendJson(res, { ok: true });
    return true;
  }

  return false;
}
