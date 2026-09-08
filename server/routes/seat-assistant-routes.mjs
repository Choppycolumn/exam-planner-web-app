import { SEAT_ASSISTANT_PAIRING_MAX_BODY_BYTES } from '../modules/seat-assistant-session-store.mjs';

const pairingRateState = new Map();

function pairingClientKey(req) {
  return String(req?.socket?.remoteAddress || 'unknown').trim().slice(0, 120);
}

function normalizedExtensionOrigin(value) {
  const origin = String(value || '').trim();
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ? origin : '';
}

function pairingRateAllowed(req, now = Date.now()) {
  const key = pairingClientKey(req);
  const current = pairingRateState.get(key) || { windowStartedAt: now, count: 0 };
  if (now - current.windowStartedAt >= 60_000) {
    current.windowStartedAt = now;
    current.count = 0;
  }
  current.count += 1;
  pairingRateState.set(key, current);
  if (pairingRateState.size > 2048) {
    for (const [entryKey, entry] of pairingRateState) {
      if (now - entry.windowStartedAt >= 60_000) pairingRateState.delete(entryKey);
    }
  }
  return current.count <= 12;
}

function isOwnerAdminWrite(session) {
  return Boolean(
    session?.role === 'write'
    && session?.accountType === 'admin'
    && session?.userRole === 'owner'
    && session?.capabilities?.includes('seat_assistant.manage'),
  );
}

export async function handleSeatAssistantPairingCompletion(req, res, {
  sendJson,
  readJsonBody,
  sessionStore,
  allowedExtensionOrigin = '',
  onPaired = () => {},
} = {}) {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  if (requestUrl.pathname !== '/api/seat-assistant/pair/complete') return false;
  const requestOrigin = String(req.headers?.origin || '').trim();
  const expectedExtensionOrigin = normalizedExtensionOrigin(allowedExtensionOrigin);
  const responseOptions = requestOrigin === expectedExtensionOrigin && expectedExtensionOrigin
    ? { allowOrigin: expectedExtensionOrigin }
    : {};
  if (!expectedExtensionOrigin || requestOrigin !== expectedExtensionOrigin) {
    sendJson(res, { error: 'Pairing failed' }, 400);
    return true;
  }
  if (req.method === 'OPTIONS') {
    sendJson(res, { ok: true }, 200, responseOptions);
    return true;
  }
  if (req.method !== 'POST') {
    sendJson(res, { error: 'Method not allowed' }, 405, responseOptions);
    return true;
  }
  if (!pairingRateAllowed(req)) {
    sendJson(res, { error: 'Pairing temporarily unavailable' }, 429, responseOptions);
    return true;
  }
  try {
    const body = await readJsonBody(req, SEAT_ASSISTANT_PAIRING_MAX_BODY_BYTES);
    const result = sessionStore.completePairing({
      pairingId: body?.pairingId,
      code: body?.code,
      origin: body?.origin || body?.examPlannerOrigin,
      cookies: body?.cookies,
    });
    onPaired(result);
    sendJson(res, {
      ok: true,
      sessionId: result.sessionId,
      origin: result.origin,
      cookieDomain: result.cookieDomain,
      cookieCount: result.cookieCount,
      expiresAt: result.expiresAt,
    }, 201, responseOptions);
  } catch (error) {
    const statusCode = Number(error?.statusCode) === 413 ? 413 : Number(error?.statusCode) === 429 ? 429 : 400;
    sendJson(res, {
      error: statusCode === 413 ? 'Pairing request is too large'
        : statusCode === 429 ? 'Pairing temporarily unavailable'
          : error?.code === 'invalid_pairing_payload' ? 'Invalid pairing payload' : 'Pairing failed',
    }, statusCode, responseOptions);
  }
  return true;
}

export async function handleSeatAssistantRoutes(req, res, {
  session,
  sendJson,
  readJsonBody,
  service,
  sessionStore,
  onSessionRevoked = () => {},
  onProfileSaved = () => {},
  writeAuditEvent = () => {},
} = {}) {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  if (!requestUrl.pathname.startsWith('/api/seat-assistant')) return false;
  if (!isOwnerAdminWrite(session)) {
    sendJson(res, { error: 'Seat assistant is restricted to owner/admin write sessions' }, session ? 403 : 401);
    return true;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/seat-assistant/status') {
    sendJson(res, service.getStatus());
    return true;
  }
  if (req.method === 'GET' && requestUrl.pathname === '/api/seat-assistant/profile') {
    sendJson(res, { profile: service.getProfile(), provider: service.providerStatus() });
    return true;
  }
  if (req.method === 'GET' && requestUrl.pathname === '/api/seat-assistant/session') {
    sendJson(res, sessionStore?.status?.() || { connected: false });
    return true;
  }
  if (req.method === 'GET' && requestUrl.pathname === '/api/seat-assistant/observations') {
    sendJson(res, { items: service.listObservations(requestUrl.searchParams.get('limit')) });
    return true;
  }
  if (req.method === 'GET' && requestUrl.pathname === '/api/seat-assistant/history') {
    sendJson(res, service.listHistory(Number(requestUrl.searchParams.get('limit') || 50)));
    return true;
  }
  if (req.method === 'POST' && requestUrl.pathname === '/api/seat-assistant/profile') {
    const body = await readJsonBody(req);
    const result = service.saveProfile(body, 'owner');
    onProfileSaved(result.profile);
    sendJson(res, result);
    return true;
  }
  if (req.method === 'POST' && requestUrl.pathname === '/api/seat-assistant/refresh') {
    const result = await service.refreshNow({ trigger: 'manual' });
    const statusCode = result.status === 'busy' ? 409 : result.status === 'rate_limited_local' ? 429 : 200;
    sendJson(res, result, statusCode);
    return true;
  }
  if (req.method === 'POST' && requestUrl.pathname === '/api/seat-assistant/pair') {
    const result = service.createPairing();
    writeAuditEvent({ action: 'seat_assistant_pairing_created', req, actorRole: 'owner', detail: { pairingId: result.pairingId, expiresAt: result.expiresAt } });
    sendJson(res, result, 201);
    return true;
  }
  if (req.method === 'DELETE' && requestUrl.pathname === '/api/seat-assistant/session') {
    const result = sessionStore?.revokeActiveSession?.() || false;
    onSessionRevoked();
    sendJson(res, { ok: true, disconnected: Boolean(result) });
    return true;
  }
  if (req.method === 'DELETE' && requestUrl.pathname === '/api/seat-assistant/history') {
    const result = service.deleteHistory();
    writeAuditEvent({ action: 'seat_assistant_history_deleted', req, actorRole: 'owner', detail: {} });
    sendJson(res, result);
    return true;
  }

  sendJson(res, { error: 'Not found' }, 404);
  return true;
}
