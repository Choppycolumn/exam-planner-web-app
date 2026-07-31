export async function handleOpsRoutes(req, res, {
  sessionRole,
  session,
  sendJson,
  readJsonBody,
  runExclusiveTask,
  createBackupFile,
  restoreBackupFile,
  writeAuditEvent,
  getBackupStatus,
  collectOperationalNotifications,
  getTaskCenterStatus,
  getLearningProgressPayload,
  getProjectProgressPayload,
  getVisitStatsPayload,
  getOpsLogSummaryPayload,
  runSqliteMaintenance,
  precomputeNightlyArtifacts,
}) {
  if (req.url === '/api/backups/status' && req.method === 'GET') {
    sendJson(res, getBackupStatus({ verifyLatest: true }));
    return true;
  }

  if (req.url === '/api/backups/run' && req.method === 'POST') {
    const task = await runExclusiveTask('manual-backup', 'manual', () => createBackupFile('manual', 'manual backup from settings page'), { timeoutMs: 10 * 60 * 1000 });
    writeAuditEvent({ action: 'backup_create', req, actorRole: sessionRole, detail: { filePath: task.result?.filePath, kind: task.result?.kind } });
    sendJson(res, { ok: true, backup: task.result, task: { id: task.taskId, durationMs: task.durationMs } });
    return true;
  }

  if (req.url === '/api/backups/restore' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = restoreBackupFile(body.fileName);
    writeAuditEvent({ action: 'backup_restore', req, actorRole: sessionRole, detail: { fileName: body.fileName, safetyBackup: result.safetyBackup?.filePath } });
    sendJson(res, { ok: true, ...result });
    return true;
  }

  if (req.url === '/api/tasks/status' && req.method === 'GET') {
    collectOperationalNotifications();
    sendJson(res, { ...getTaskCenterStatus(), readOnly: sessionRole === 'read' });
    return true;
  }

  if (req.url === '/api/learning-progress' && req.method === 'GET') {
    sendJson(res, getLearningProgressPayload(sessionRole, session.userId, session.accountType));
    return true;
  }

  if (req.url === '/api/project-progress' && req.method === 'GET') {
    sendJson(res, getProjectProgressPayload(sessionRole, session.userId));
    return true;
  }

  if (req.url === '/api/visits/summary' && req.method === 'GET') {
    sendJson(res, getVisitStatsPayload(sessionRole));
    return true;
  }

  if (req.url === '/api/ops/logs/summary' && req.method === 'GET') {
    collectOperationalNotifications();
    sendJson(res, await getOpsLogSummaryPayload(sessionRole));
    return true;
  }

  if (req.url === '/api/maintenance/sqlite' && req.method === 'POST') {
    const task = await runExclusiveTask('sqlite-maintenance', 'manual', () => runSqliteMaintenance('manual'), { timeoutMs: 10 * 60 * 1000 });
    sendJson(res, task.result);
    return true;
  }

  if (req.url === '/api/maintenance/precompute' && req.method === 'POST') {
    const task = await runExclusiveTask('precompute', 'manual', () => precomputeNightlyArtifacts('manual'), { timeoutMs: 30 * 60 * 1000 });
    sendJson(res, task.result);
    return true;
  }

  return false;
}
