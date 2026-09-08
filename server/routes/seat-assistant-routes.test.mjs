import { describe, expect, it, vi } from 'vitest';
import { handleSeatAssistantPairingCompletion, handleSeatAssistantRoutes } from './seat-assistant-routes.mjs';

const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;
const owner = { role: 'write', accountType: 'admin', userRole: 'owner', capabilities: ['seat_assistant.manage'] };
const learner = { role: 'write', accountType: 'learner', userRole: 'member', capabilities: ['seat_assistant.manage'] };

function request(path, method = 'GET', headers = {}) {
  return { url: path, method, headers, socket: { remoteAddress: '127.0.0.1' } };
}

function dependencies(overrides = {}) {
  const service = {
    getStatus: vi.fn(() => ({ featureEnabled: false })),
    getProfile: vi.fn(() => ({})),
    providerStatus: vi.fn(() => ({ canExecute: false })),
    listObservations: vi.fn(() => []),
    listHistory: vi.fn(() => ({ observations: [], audit: [], pairings: [] })),
    saveProfile: vi.fn(() => ({ profile: {}, provider: { canExecute: false } })),
    refreshNow: vi.fn(async () => ({ ok: false, status: 'disabled' })),
    createPairing: vi.fn(() => ({ pairingId: 1, code: 'a'.repeat(24), expiresAt: '2026-08-22T10:00:00.000Z' })),
    deleteHistory: vi.fn(() => ({ ok: true })),
  };
  return {
    service,
    sessionStore: { status: vi.fn(() => ({ connected: false })), revokeActiveSession: vi.fn(() => true), completePairing: vi.fn() },
    sendJson: vi.fn(),
    readJsonBody: vi.fn(async () => ({})),
    ...overrides,
  };
}

describe('seat assistant route boundary', () => {
  it('denies learners and visitors even if a capability is accidentally present', async () => {
    const deps = dependencies();
    await handleSeatAssistantRoutes(request('/api/seat-assistant/status'), {}, { ...deps, session: learner });
    expect(deps.sendJson).toHaveBeenCalledWith({}, expect.objectContaining({ error: expect.stringContaining('owner/admin') }), 403);
  });

  it('allows only the owner/admin write session and has no confirm route', async () => {
    const deps = dependencies();
    await handleSeatAssistantRoutes(request('/api/seat-assistant/status'), {}, { ...deps, session: owner });
    expect(deps.service.getStatus).toHaveBeenCalled();
    await handleSeatAssistantRoutes(request('/api/seat-assistant/confirm', 'POST'), {}, { ...deps, session: owner });
    expect(deps.sendJson).toHaveBeenLastCalledWith({}, { error: 'Not found' }, 404);
  });

  it('accepts completion only from the exact configured extension origin and returns metadata', async () => {
    const deps = dependencies({
      sessionStore: { completePairing: vi.fn(() => ({ sessionId: 9, origin: 'https://8.130.68.9', cookieDomain: 'libresource.hust.edu.cn', cookieCount: 2, expiresAt: '2026-08-22T10:00:00.000Z' })) },
      readJsonBody: vi.fn(async () => ({ pairingId: 1, code: 'a'.repeat(24), origin: 'https://8.130.68.9', cookies: [] })),
    });
    const onPaired = vi.fn();
    await handleSeatAssistantPairingCompletion(request('/api/seat-assistant/pair/complete', 'POST', { origin: extensionOrigin }), {}, { ...deps, allowedExtensionOrigin: extensionOrigin, onPaired });
    expect(onPaired).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith({}, expect.objectContaining({ ok: true, cookieCount: 2 }), 201, { allowOrigin: extensionOrigin });
    expect(JSON.stringify(deps.sendJson.mock.calls.at(-1))).not.toContain('cookieValue');
  });

  it('handles CORS preflight only for the exact extension origin', async () => {
    const deps = dependencies();
    await handleSeatAssistantPairingCompletion(request('/api/seat-assistant/pair/complete', 'OPTIONS', { origin: extensionOrigin }), {}, { ...deps, allowedExtensionOrigin: extensionOrigin });
    expect(deps.sendJson).toHaveBeenCalledWith({}, { ok: true }, 200, { allowOrigin: extensionOrigin });

    const wrongOrigin = `chrome-extension://${'b'.repeat(32)}`;
    await handleSeatAssistantPairingCompletion(request('/api/seat-assistant/pair/complete', 'OPTIONS', { origin: wrongOrigin }), {}, { ...deps, allowedExtensionOrigin: extensionOrigin });
    expect(deps.sendJson).toHaveBeenLastCalledWith({}, { error: 'Pairing failed' }, 400);
  });

  it('returns 413 for an oversized pairing body before consuming it', async () => {
    const deps = dependencies({ readJsonBody: vi.fn(async () => { const error = new Error('too large'); error.statusCode = 413; throw error; }) });
    await handleSeatAssistantPairingCompletion(request('/api/seat-assistant/pair/complete', 'POST', { origin: extensionOrigin }), {}, { ...deps, allowedExtensionOrigin: extensionOrigin });
    expect(deps.sendJson).toHaveBeenCalledWith({}, { error: 'Pairing request is too large' }, 413, { allowOrigin: extensionOrigin });
    expect(deps.sessionStore.completePairing).not.toHaveBeenCalled();
  });

  it('invokes the profile callback so a worker-owned scheduler can observe the saved config', async () => {
    const onProfileSaved = vi.fn();
    const deps = dependencies({ readJsonBody: vi.fn(async () => ({ enabled: true })) });
    await handleSeatAssistantRoutes(request('/api/seat-assistant/profile', 'POST'), {}, { ...deps, session: owner, onProfileSaved });
    expect(onProfileSaved).toHaveBeenCalledWith({});
  });
});
