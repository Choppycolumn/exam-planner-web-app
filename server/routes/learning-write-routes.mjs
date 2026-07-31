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
    learningRepository,
    nowISO,
    todayISO,
    tableChanged,
  } = dependencies;
  const userId = Number(session.userId);
  const scopedLearning = learningRepository.forUser(session?.userContext || session);

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
    '/api/goals/save': () => scopedLearning.saveGoal(body),
    '/api/projects/save': () => scopedLearning.saveProject(body),
    '/api/subjects/save': () => scopedLearning.saveSubject(body),
    '/api/exams/save': () => scopedLearning.saveExam(body),
    '/api/tasks/save': () => scopedLearning.saveTask(body),
  };

  if (directRoutes[req.url]) {
    sendJson(res, directRoutes[req.url]());
    return true;
  }

  if (req.url === '/api/goals/activate') {
    scopedLearning.activateGoal(Number(body.id), timestamp);
    tableChanged();
    sendJson(res, { ok: true });
    return true;
  }

  if (req.url === '/api/water/save') {
    scopedLearning.saveWater(body);
    sendJson(res, { ok: true });
    return true;
  }

  if (req.url === '/api/settings/study-target') {
    sendJson(res, scopedLearning.saveStudyTarget(body));
    return true;
  }

  if (req.url === '/api/problem-inbox/save') {
    const id = scopedLearning.saveProblem(body);
    const item = scopedLearning.listProblemInbox({
      status: 'all',
      limit: 1,
      from: body.date || '1900-01-01',
      to: body.date || '2999-12-31',
    }).find((candidate) => candidate.id === id) || null;
    sendJson(res, { ok: true, id, item });
    return true;
  }

  if (req.url === '/api/problem-inbox/status') {
    scopedLearning.setProblemStatus(body.id, body.status);
    sendJson(res, { ok: true });
    return true;
  }

  if (req.url === '/api/problem-inbox/remove') {
    scopedLearning.deleteProblem(body.id);
    sendJson(res, { ok: true });
    return true;
  }

  if (req.url === '/api/problem-inbox/resolve-date') {
    sendJson(res, scopedLearning.resolveProblemsForDate(body.date || todayISO()));
    return true;
  }

  if (req.url === '/api/reviews/upsert') {
    sendJson(res, scopedLearning.upsertReview(body));
    return true;
  }

  if (req.url === '/api/study-records/save-day') {
    scopedLearning.saveDayRecords(body.date || todayISO(), body.records || []);
    sendJson(res, { ok: true });
    return true;
  }

  const mutations = {
    '/api/goals/remove': () => scopedLearning.removeGoal(Number(body.id)),
    '/api/projects/remove': () => scopedLearning.removeProject(Number(body.id), timestamp),
    '/api/subjects/remove': () => scopedLearning.removeSubject(Number(body.id), timestamp),
    '/api/exams/remove': () => scopedLearning.removeExam(Number(body.id)),
    '/api/tasks/remove': () => scopedLearning.removeTask(Number(body.id)),
    '/api/tasks/toggle': () => scopedLearning.toggleTask(Number(body.id), Boolean(body.completed), timestamp),
  };

  if (mutations[req.url]) {
    mutations[req.url]();
    tableChanged();
    sendJson(res, { ok: true });
    return true;
  }

  return false;
}
