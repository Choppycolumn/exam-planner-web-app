export async function handleFocusTimerRoutes(req, res, {
  session,
  sendJson,
  readJsonBody,
  focusTimerService,
}) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (!pathname.startsWith('/api/focus-timer')) return false;
  const userId = Number(session?.userId || 0);
  if (!userId) {
    sendJson(res, { error: 'Unauthorized' }, 401);
    return true;
  }

  if (pathname === '/api/focus-timer' && req.method === 'GET') {
    sendJson(res, focusTimerService.getDashboard(userId));
    return true;
  }

  if (pathname === '/api/focus-timer/action' && req.method === 'POST') {
    const body = await readJsonBody(req);
    try {
      sendJson(res, focusTimerService.execute(userId, body));
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, Number(error?.statusCode || 400));
    }
    return true;
  }

  sendJson(res, { error: 'Not found' }, 404);
  return true;
}
