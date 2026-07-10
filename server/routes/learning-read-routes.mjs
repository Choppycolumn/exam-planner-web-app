export async function handleLearningReadRoutes(req, res, dependencies) {
  if (req.method !== 'GET') return false;

  const {
    sessionRole,
    sendJson,
    ensureSqliteStore,
    getGoalsList,
    getProjectsList,
    getSubjectsList,
    getStudyTargetMinutes,
    getDashboardChartsPayload,
    getDashboardPayload,
    queryLimit,
    queryOffset,
    listProblemInboxItems,
    todayISO,
    getReviewPrefill,
    getCachedReviewTrend,
    sqliteScalar,
    sqliteJson,
    sqlString,
    normalizeReview,
    getMockExamList,
    getStatisticsSummary,
    getEmbeddingStatus,
    getErrorThemeOptions,
    getCachedErrorThemeAnalysis,
    getErrorThemeDetail,
    currentErrorThemeJobSnapshot,
    listLearningReports,
    readState,
  } = dependencies;

  if (req.url === '/api/goals') {
    ensureSqliteStore();
    sendJson(res, getGoalsList(sessionRole));
    return true;
  }

  if (req.url === '/api/projects') {
    ensureSqliteStore();
    sendJson(res, getProjectsList(sessionRole));
    return true;
  }

  if (req.url === '/api/subjects') {
    ensureSqliteStore();
    sendJson(res, getSubjectsList(sessionRole));
    return true;
  }

  if (req.url === '/api/settings/study-target') {
    ensureSqliteStore();
    const targetMinutes = getStudyTargetMinutes();
    sendJson(res, { targetMinutes, targetHours: Math.round((targetMinutes / 60) * 10) / 10, readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url === '/api/dashboard/charts') {
    ensureSqliteStore();
    sendJson(res, getDashboardChartsPayload());
    return true;
  }

  if (req.url === '/api/dashboard') {
    ensureSqliteStore();
    sendJson(res, getDashboardPayload(sessionRole));
    return true;
  }

  if (req.url?.startsWith('/api/problem-inbox')) {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const status = requestUrl.searchParams.get('status') || 'open';
    const from = requestUrl.searchParams.get('from') || '1900-01-01';
    const to = requestUrl.searchParams.get('to') || '2999-12-31';
    const limit = queryLimit(requestUrl.searchParams, 12, 100) ?? 12;
    sendJson(res, { items: listProblemInboxItems({ limit, status, from, to }), readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url?.startsWith('/api/reviews/prefill')) {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    sendJson(res, getReviewPrefill(requestUrl.searchParams.get('date') || todayISO(), sessionRole));
    return true;
  }

  if (req.url?.startsWith('/api/reviews/trend')) {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const days = Math.max(7, Math.min(120, Number(requestUrl.searchParams.get('days') || 30)));
    sendJson(res, { ...getCachedReviewTrend(days, todayISO()), readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url?.startsWith('/api/reviews')) {
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
    return true;
  }

  if (req.url?.startsWith('/api/study-records')) {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const date = requestUrl.searchParams.get('date') || todayISO();
    const records = sqliteJson(`SELECT id, date, project_id AS projectId, project_name_snapshot AS projectNameSnapshot, minutes, note,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM study_time_records
WHERE date = ${sqlString(date)}
ORDER BY project_id;`);
    sendJson(res, { records, readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url?.startsWith('/api/mock-exams')) {
    ensureSqliteStore();
    sendJson(res, getMockExamList(new URL(req.url, 'http://localhost'), sessionRole));
    return true;
  }

  if (req.url === '/api/statistics/summary') {
    ensureSqliteStore();
    sendJson(res, getStatisticsSummary());
    return true;
  }

  if (req.url === '/api/error-themes/embedding/status') {
    ensureSqliteStore();
    const embeddingRows = Number(sqliteScalar('SELECT COUNT(*) FROM review_sentence_embeddings;') || 0);
    sendJson(res, { ...getEmbeddingStatus(), embeddingRows, readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url === '/api/error-themes/options') {
    ensureSqliteStore();
    sendJson(res, { themes: getErrorThemeOptions(), readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url?.startsWith('/api/error-themes/analysis')) {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const from = requestUrl.searchParams.get('from') || '1900-01-01';
    const to = requestUrl.searchParams.get('to') || todayISO();
    sendJson(res, { ...getCachedErrorThemeAnalysis(from, to), readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url?.startsWith('/api/error-themes/detail')) {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const detail = getErrorThemeDetail(
      requestUrl.searchParams.get('themeId'),
      requestUrl.searchParams.get('from') || '1900-01-01',
      requestUrl.searchParams.get('to') || todayISO(),
    );
    if (!detail) sendJson(res, { error: 'Not found' }, 404);
    else sendJson(res, { ...detail, readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url === '/api/error-themes/batch/status') {
    ensureSqliteStore();
    sendJson(res, { job: currentErrorThemeJobSnapshot(), readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url?.startsWith('/api/reports')) {
    ensureSqliteStore();
    sendJson(res, { reports: listLearningReports() });
    return true;
  }

  if (req.url === '/api/state') {
    const state = readState();
    sendJson(res, {
      ...state,
      dailyReviews: state.dailyReviews.map(normalizeReview),
      waterIntakeRecords: Array.isArray(state.waterIntakeRecords) ? state.waterIntakeRecords : [],
      readOnly: sessionRole === 'read',
    });
    return true;
  }

  return false;
}
