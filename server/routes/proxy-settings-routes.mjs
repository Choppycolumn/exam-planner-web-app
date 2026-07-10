function requireWriteSession(sessionRole, sendJson, res) {
  if (sessionRole === 'write') return true;
  sendJson(res, { error: 'Mihomo settings require write session' }, 403);
  return false;
}

export async function handleProxySettingsRoutes(req, res, {
  sessionRole,
  sendJson,
  readJsonBody,
  writeAuditEvent,
  getMihomoSettings,
  saveMihomoSubscriptionSettings,
  importMihomoProviderSettings,
  selectMihomoProxy,
  testMihomoProxy,
}) {
  if (!req.url?.startsWith('/api/settings/mihomo')) return false;
  if (!requireWriteSession(sessionRole, sendJson, res)) return true;

  if (req.url === '/api/settings/mihomo' && req.method === 'GET') {
    sendJson(res, await getMihomoSettings());
    return true;
  }

  if (req.url === '/api/settings/mihomo/subscription' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = await saveMihomoSubscriptionSettings(body);
    writeAuditEvent({
      action: 'mihomo_subscription_save',
      req,
      actorRole: sessionRole,
      detail: { subscriptionConfigured: result.subscriptionConfigured, nodeCount: result.nodes.length, restarted: result.restarted },
    });
    sendJson(res, result);
    return true;
  }

  if (req.url === '/api/settings/mihomo/import' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = await importMihomoProviderSettings(body);
    writeAuditEvent({
      action: 'mihomo_provider_import',
      req,
      actorRole: sessionRole,
      detail: { nodeCount: result.nodes.length, restarted: result.restarted },
    });
    sendJson(res, result);
    return true;
  }

  if (req.url === '/api/settings/mihomo/select' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = await selectMihomoProxy(body);
    writeAuditEvent({ action: 'mihomo_proxy_select', req, actorRole: sessionRole, detail: { selected: result.selected } });
    sendJson(res, result);
    return true;
  }

  if (req.url === '/api/settings/mihomo/test' && req.method === 'POST') {
    const result = await testMihomoProxy();
    writeAuditEvent({ action: 'mihomo_proxy_test', req, actorRole: sessionRole, detail: { ok: result.ok } });
    sendJson(res, result);
    return true;
  }

  return false;
}
