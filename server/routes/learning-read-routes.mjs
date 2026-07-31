export async function handleLearningReadRoutes(req, res, dependencies) {
  if (req.method !== 'GET') return false;

  const {
    session,
    sessionRole,
    sendJson,
    ensureSqliteStore,
    getGoalsList,
    getProjectsList,
    getSubjectsList,
    getDashboardChartsPayload,
    getDashboardPayload,
    queryLimit,
    queryOffset,
    todayISO,
    getReviewPrefill,
    getCachedReviewTrend,
    learningRepository,
    normalizeReview,
    getMockExamList,
    getStatisticsSummary,
    getEmbeddingStatus,
    getErrorThemeOptions,
    getCachedErrorThemeAnalysis,
    getErrorThemeDetail,
    currentErrorThemeJobSnapshot,
    listLearningReports,
  } = dependencies;
  const userId = Number(session.userId);
  const scopedLearning = learningRepository.forUser(session?.userContext || session);

  if (req.url === '/api/goals') {
    ensureSqliteStore();
    sendJson(res, getGoalsList(sessionRole, userId));
    return true;
  }

  if (req.url === '/api/projects') {
    ensureSqliteStore();
    sendJson(res, getProjectsList(sessionRole, userId));
    return true;
  }

  if (req.url === '/api/subjects') {
    ensureSqliteStore();
    sendJson(res, getSubjectsList(sessionRole, userId));
    return true;
  }

  if (req.url === '/api/settings/study-target') {
    ensureSqliteStore();
    const targetMinutes = scopedLearning.getStudyTarget();
    sendJson(res, { targetMinutes, targetHours: Math.round((targetMinutes / 60) * 10) / 10, readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url === '/api/dashboard/charts') {
    ensureSqliteStore();
    sendJson(res, getDashboardChartsPayload(userId));
    return true;
  }

  if (req.url === '/api/dashboard') {
    ensureSqliteStore();
    sendJson(res, getDashboardPayload(sessionRole, userId, session.accountType, session.capabilities || []));
    return true;
  }

  if (req.url?.startsWith('/api/problem-inbox')) {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const status = requestUrl.searchParams.get('status') || 'open';
    const from = requestUrl.searchParams.get('from') || '1900-01-01';
    const to = requestUrl.searchParams.get('to') || '2999-12-31';
    const limit = queryLimit(requestUrl.searchParams, 12, 100) ?? 12;
    sendJson(res, { items: scopedLearning.listProblemInbox({ limit, status, from, to }), readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url?.startsWith('/api/reviews/prefill')) {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    sendJson(res, getReviewPrefill(requestUrl.searchParams.get('date') || todayISO(), sessionRole, userId));
    return true;
  }

  if (req.url?.startsWith('/api/reviews/trend')) {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const days = Math.max(7, Math.min(120, Number(requestUrl.searchParams.get('days') || 30)));
    sendJson(res, { ...getCachedReviewTrend(days, todayISO(), userId), readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url?.startsWith('/api/reviews')) {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const from = requestUrl.searchParams.get('from') || '1900-01-01';
    const to = requestUrl.searchParams.get('to') || '2999-12-31';
    const limit = queryLimit(requestUrl.searchParams, 20, 100);
    const offset = queryOffset(requestUrl.searchParams);
    const result = scopedLearning.listReviews({ from, to, limit, offset });
    const reviews = result.reviews.map(normalizeReview);
    const total = result.total;
    sendJson(res, { reviews, total, limit, offset, readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url?.startsWith('/api/study-records')) {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const date = requestUrl.searchParams.get('date') || todayISO();
    const records = scopedLearning.listStudyRecords(date);
    sendJson(res, { records, readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url?.startsWith('/api/mock-exams')) {
    ensureSqliteStore();
    sendJson(res, getMockExamList(new URL(req.url, 'http://localhost'), sessionRole, userId));
    return true;
  }

  if (req.url === '/api/statistics/summary') {
    ensureSqliteStore();
    sendJson(res, getStatisticsSummary(userId));
    return true;
  }

  if (req.url === '/api/error-themes/embedding/status') {
    ensureSqliteStore();
    const embeddingRows = session?.accountType === 'learner' ? 0 : learningRepository.embeddingCount();
    sendJson(res, session?.accountType === 'learner'
      ? { ...getEmbeddingStatus(), available: false, embeddingRows: 0, readOnly: true, reason: '学习账号仅分析自己的复盘趋势' }
      : { ...getEmbeddingStatus(), embeddingRows, readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url === '/api/error-themes/options') {
    ensureSqliteStore();
    sendJson(res, { themes: getErrorThemeOptions(), readOnly: sessionRole === 'read' || session?.accountType === 'learner' });
    return true;
  }

  if (req.url?.startsWith('/api/error-themes/analysis')) {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const from = requestUrl.searchParams.get('from') || '1900-01-01';
    const to = requestUrl.searchParams.get('to') || todayISO();
    sendJson(res, session?.accountType === 'learner'
      ? {
          periodStart: from,
          periodEnd: to,
          latestBatch: null,
          summary: { occurrenceCount: 0, themeCount: 0, reviewDayCount: 0, topTheme: null },
          themes: [],
          timeline: [],
          readOnly: true,
          degradedReason: '学习账号的错因聚类尚未启用；复盘趋势仍可正常使用。',
        }
      : { ...getCachedErrorThemeAnalysis(from, to), readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url?.startsWith('/api/error-themes/detail')) {
    ensureSqliteStore();
    const requestUrl = new URL(req.url, 'http://localhost');
    const detail = session?.accountType === 'learner' ? null : getErrorThemeDetail(
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
    sendJson(res, { job: session?.accountType === 'learner' ? null : currentErrorThemeJobSnapshot(), readOnly: sessionRole === 'read' || session?.accountType === 'learner' });
    return true;
  }

  if (req.url?.startsWith('/api/reports')) {
    ensureSqliteStore();
    sendJson(res, { reports: listLearningReports(userId) });
    return true;
  }

  if (req.url === '/api/state') {
    const state = scopedLearning.getStateSnapshot();
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
