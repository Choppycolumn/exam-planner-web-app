import { CAPABILITIES, hasCapability } from '../auth/capabilities.mjs';

export async function handlePublicApiRoutes(req, res, {
  dataImportToken,
  backupSyncToken,
  safeSecretEqual,
  sendJson,
  readJsonBody,
    getSession,
    ownerUserId,
  baseState,
  normalizeReview,
  writeState,
  writeAuditEvent,
  requireBreakGuardToken,
  recordBreakGuardEvent,
  queueBreakGuardNotification,
  getBreakGuardSummary,
  getBreakGuardScheduleConfig,
  saveBreakGuardScheduleConfig,
  todayISO,
  findDictionaryEntry,
  confusingWordsRepository,
  listConfusingWordsBackupVersions,
  normalizeConfusingWordsPayload,
  nowISO,
  saveConfusingWordsBackupPayload,
  readConfusingWordsBackupPayload,
  summarizeConfusingWordsPayload,
  handleClawbotApi,
  handleTelegramWebhook,
}) {
  if (req.url === '/api/import' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const session = getSession(req.headers.cookie);
    const sessionRole = session?.role;
    const tokenAuthorized = Boolean(dataImportToken) && safeSecretEqual(body.importToken, dataImportToken);
    if ((!session || sessionRole !== 'write' || !hasCapability(session, CAPABILITIES.DATA_IMPORT)) && !tokenAuthorized) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const imported = body.state || {};
    const next = {
      ...baseState(),
      goals: Array.isArray(imported.goals) ? imported.goals : [],
      dailyReviews: Array.isArray(imported.dailyReviews) ? imported.dailyReviews.map(normalizeReview) : [],
      studyProjects: Array.isArray(imported.studyProjects) ? imported.studyProjects : [],
      studyTimeRecords: Array.isArray(imported.studyTimeRecords) ? imported.studyTimeRecords : [],
      subjects: Array.isArray(imported.subjects) ? imported.subjects : [],
      mockExamRecords: Array.isArray(imported.mockExamRecords) ? imported.mockExamRecords : [],
      shortTermTasks: Array.isArray(imported.shortTermTasks) ? imported.shortTermTasks : [],
      waterIntakeRecords: Array.isArray(imported.waterIntakeRecords) ? imported.waterIntakeRecords : [],
      confusingWordsBackup: imported.confusingWordsBackup || null,
    };
    writeState(next);
    writeAuditEvent({ action: 'state_import', req, actorRole: sessionRole === 'write' ? 'write' : 'import-token', detail: { goals: next.goals.length, reviews: next.dailyReviews.length } });
    sendJson(res, { ok: true });
    return true;
  }

  if (req.url === '/api/break-guard/events' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const access = requireBreakGuardToken(req, body);
    if (!access.ok) {
      sendJson(res, { ok: false, error: access.error }, access.status);
      return true;
    }
    const event = recordBreakGuardEvent(body);
    let delivery = null;
    if (!event.duplicate && ['break_timeout_warning', 'unfocused', 'schedule_lag'].includes(event.eventType)) {
      delivery = queueBreakGuardNotification(event);
    }
    sendJson(res, { ok: true, event, summary: getBreakGuardSummary(todayISO()), delivery });
    return true;
  }

  if (req.url === '/api/break-guard/config' && ['GET', 'POST'].includes(req.method)) {
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    const session = getSession(req.headers.cookie);
    const sessionRole = session?.role;
    const tokenAccess = requireBreakGuardToken(req, body);
    if (session && !hasCapability(session, CAPABILITIES.BREAK_GUARD)) {
      sendJson(res, { error: '该账户不使用 Break Guard' }, 403);
      return true;
    }
    if (!sessionRole && !tokenAccess.ok) {
      sendJson(res, { error: tokenAccess.error }, tokenAccess.status);
      return true;
    }
    if (req.method === 'GET') {
      sendJson(res, getBreakGuardScheduleConfig());
      return true;
    }
    if (session && (sessionRole === 'read' || !hasCapability(session, CAPABILITIES.BREAK_GUARD))) {
      sendJson(res, { error: 'Read only mode' }, 403);
      return true;
    }
    sendJson(res, { ok: true, ...saveBreakGuardScheduleConfig(body.config || body) });
    return true;
  }

  if (req.url?.startsWith('/api/dictionary/lookup') && req.method === 'GET') {
    const requestUrl = new URL(req.url, 'http://localhost');
    const word = requestUrl.searchParams.get('word')?.trim().toLowerCase() || '';
    if (!word) {
      sendJson(res, { error: 'Missing word' }, 400);
      return true;
    }
    const entry = findDictionaryEntry(word);
    if (!entry) {
      sendJson(res, { error: 'Not found' }, 404);
      return true;
    }
    sendJson(res, entry);
    return true;
  }

  if (req.url?.startsWith('/api/confusing-words/backup/versions')) {
    const requestUrl = new URL(req.url, 'http://localhost');
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    const session = getSession(req.headers.cookie);
    const sessionRole = session?.role;
    const userId = Number(session?.userId || ownerUserId());
    const providedToken = body.syncToken || req.headers['x-backup-token'] || '';
    const hasBackupAccess = sessionRole || (Boolean(backupSyncToken) && safeSecretEqual(providedToken, backupSyncToken));
    if (!hasBackupAccess) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const parts = requestUrl.pathname.split('/').filter(Boolean);
    const versionId = Number(parts[4] || 0);
    if (req.method === 'GET' && versionId) {
      const payloadJson = confusingWordsRepository.findVersionPayload(versionId, userId);
      if (!payloadJson) {
        sendJson(res, { error: 'Version not found' }, 404);
        return true;
      }
      sendJson(res, JSON.parse(payloadJson));
      return true;
    }
    if (req.method === 'GET') {
      sendJson(res, { items: listConfusingWordsBackupVersions(Number(requestUrl.searchParams.get('limit') || 24), userId) });
      return true;
    }
    sendJson(res, { error: 'Not found' }, 404);
    return true;
  }

  if (req.url === '/api/confusing-words/backup/restore' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const session = getSession(req.headers.cookie);
    const sessionRole = session?.role;
    const userId = Number(session?.userId || ownerUserId());
    const providedToken = body.syncToken || req.headers['x-backup-token'] || '';
    const hasBackupAccess = sessionRole || (Boolean(backupSyncToken) && safeSecretEqual(providedToken, backupSyncToken));
    if (!hasBackupAccess) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read only mode' }, 403);
      return true;
    }
    const versionId = Number(body.versionId || 0);
    const payloadJson = confusingWordsRepository.findVersionPayload(versionId, userId);
    if (!payloadJson) {
      sendJson(res, { error: 'Version not found' }, 404);
      return true;
    }
    const restored = normalizeConfusingWordsPayload(JSON.parse(payloadJson), nowISO());
    const result = saveConfusingWordsBackupPayload({ ...restored, backedUpAt: nowISO() }, 'restore', userId);
    sendJson(res, { ok: true, backedUpAt: result.payload.backedUpAt, ...result.summary });
    return true;
  }

  if (req.url === '/api/confusing-words/backup') {
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    const session = getSession(req.headers.cookie);
    const sessionRole = session?.role;
    const userId = Number(session?.userId || ownerUserId());
    const providedToken = body.syncToken || req.headers['x-backup-token'] || '';
    const hasBackupAccess = sessionRole || (Boolean(backupSyncToken) && safeSecretEqual(providedToken, backupSyncToken));
    if (!hasBackupAccess) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const currentBackup = readConfusingWordsBackupPayload(userId);
    if (req.method === 'GET') {
      sendJson(res, currentBackup || null);
      return true;
    }
    if (sessionRole === 'read') {
      sendJson(res, { error: 'Read only mode' }, 403);
      return true;
    }
    if (req.method === 'POST') {
      const timestamp = nowISO();
      const currentSummary = summarizeConfusingWordsPayload(currentBackup || {});
      const nextPayload = normalizeConfusingWordsPayload({ ...body, backedUpAt: timestamp }, timestamp);
      const nextSummary = summarizeConfusingWordsPayload(nextPayload);
      if (!body.force && currentSummary.wordCount > nextSummary.wordCount && currentSummary.wordCount - nextSummary.wordCount >= 3) {
        sendJson(res, {
          error: 'Refusing to overwrite larger server backup without force',
          conflict: true,
          server: currentSummary,
          incoming: nextSummary,
        }, 409);
        return true;
      }
      const result = saveConfusingWordsBackupPayload(nextPayload, body.source || 'sync', userId);
      sendJson(res, { ok: true, backedUpAt: result.payload.backedUpAt, ...result.summary });
      return true;
    }
    sendJson(res, { error: 'Not found' }, 404);
    return true;
  }

  if (req.url?.startsWith('/api/clawbot/')) {
    await handleClawbotApi(req, res);
    return true;
  }

  if (req.url === '/api/telegram/webhook' && req.method === 'POST') {
    await handleTelegramWebhook(req, res);
    return true;
  }

  return false;
}
