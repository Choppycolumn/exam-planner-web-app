export async function handleBriefRoutes(req, res, {
  sessionRole,
  sendJson,
  readJsonBody,
  ensureSqliteStore,
  queryLimit,
  todayISO,
  nowISO,
  dailyBriefRepository,
  tableChanged,
  runExclusiveTask,
  getDailyBriefSettings,
  saveDailyBriefSettings,
  getDailyBriefByDate,
  getLatestDailyBriefSummary,
  listDailyBriefs,
  generateDailyBrief,
  sendDailyBriefEmail,
}) {
  if (!req.url?.startsWith('/api/briefs')) return false;
  ensureSqliteStore();
  const requestUrl = new URL(req.url, 'http://localhost');

  if (req.method === 'GET') {
    if (requestUrl.pathname === '/api/briefs/settings') {
      sendJson(res, { settings: getDailyBriefSettings(), readOnly: sessionRole === 'read' });
      return true;
    }
    if (requestUrl.pathname === '/api/briefs/today') {
      sendJson(res, { brief: getDailyBriefByDate(todayISO()), latest: getLatestDailyBriefSummary(), readOnly: sessionRole === 'read' });
      return true;
    }
    if (requestUrl.pathname === '/api/briefs') {
      sendJson(res, { briefs: listDailyBriefs(queryLimit(requestUrl.searchParams, 30, 100) ?? 30), readOnly: sessionRole === 'read' });
      return true;
    }
  }

  if (req.url === '/api/briefs/settings' && req.method === 'POST') {
    const body = await readJsonBody(req);
    sendJson(res, { settings: saveDailyBriefSettings(body), readOnly: false });
    return true;
  }

  if (req.url === '/api/briefs/generate' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const task = await runExclusiveTask('daily-brief', 'manual', () => generateDailyBrief({
      date: body.date || todayISO(),
      trigger: 'manual',
      sendEmail: Boolean(body.sendEmail),
      sendWechat: Boolean(body.sendWechat),
    }), { timeoutMs: 4 * 60 * 1000 });
    sendJson(res, { ok: true, brief: task.result, task: { id: task.taskId, durationMs: task.durationMs } });
    return true;
  }

  if (req.url === '/api/briefs/send-latest' && req.method === 'POST') {
    const settings = getDailyBriefSettings({ includeSecret: true });
    const latest = getLatestDailyBriefSummary();
    if (!latest) {
      sendJson(res, { error: 'No daily brief to send' }, 404);
      return true;
    }
    await sendDailyBriefEmail(latest.payload, settings.email);
    const timestamp = nowISO();
    dailyBriefRepository.markEmailed(latest.id, timestamp);
    tableChanged();
    sendJson(res, { ok: true, brief: getDailyBriefByDate(latest.date) });
    return true;
  }

  return false;
}
