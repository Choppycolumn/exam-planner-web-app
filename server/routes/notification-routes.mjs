export async function handleNotificationRoutes(req, res, {
  sessionRole,
  sendJson,
  readJsonBody,
  collectOperationalNotifications,
  getNotificationCenterPayload,
  notificationRepository,
  notificationQueue,
  logStructured,
  redactSecretText,
  writeAuditEvent,
  queueProactiveNotification,
  resolveBarkConfig,
  saveTelegramSettings,
  registerTelegramWebhook,
  sendTelegramNotification,
}) {
  if (req.url?.startsWith('/api/notifications') && req.method === 'GET') {
    const requestUrl = new URL(req.url, 'http://localhost');
    if (requestUrl.pathname === '/api/notifications/center') {
      sendJson(res, getNotificationCenterPayload(sessionRole, { status: requestUrl.searchParams.get('status') || 'all' }));
      return true;
    }
  }

  if (req.url === '/api/notifications/ack' && req.method === 'POST') {
    const body = await readJsonBody(req);
    notificationRepository.acknowledge(body.id);
    sendJson(res, { ok: true, center: getNotificationCenterPayload(sessionRole) });
    return true;
  }

  if (req.url === '/api/notifications/retry-delivery' && req.method === 'POST') {
    const body = await readJsonBody(req);
    notificationRepository.requeueDelivery(body.id);
    setImmediate(() => notificationQueue.processDue().catch((error) => {
      logStructured('warn', 'notification_retry_kick_failed', { error: redactSecretText(error.message || String(error)) });
    }));
    writeAuditEvent({ action: 'notification_delivery_retry', req, actorRole: sessionRole, detail: { id: Number(body.id || 0) } });
    sendJson(res, { ok: true, center: getNotificationCenterPayload(sessionRole) });
    return true;
  }

  if (req.url === '/api/notifications/bark/test' && req.method === 'POST') {
    if (!resolveBarkConfig().configured) {
      sendJson(res, { error: 'Bark is not configured' }, 409);
      return true;
    }
    const body = await readJsonBody(req);
    const message = String(body.message || 'Bark 通知通道已接入 Exam Planner。');
    const delivery = queueProactiveNotification({
      eventKey: `bark:test:${Date.now()}`,
      source: 'test',
      title: 'Exam Planner Bark 测试',
      content: 'Bark 测试消息已进入主动推送队列。',
      text: message,
      payload: { requestedBy: sessionRole },
      channelKeys: ['bark_default'],
    });
    writeAuditEvent({ action: 'notifications_bark_test', req, actorRole: sessionRole, detail: { queued: true, deliveryId: delivery.deliveryId } });
    sendJson(res, { ok: true, delivery, center: getNotificationCenterPayload(sessionRole) }, 202);
    return true;
  }

  if (req.url === '/api/notifications/telegram/settings' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const telegram = saveTelegramSettings(body);
    writeAuditEvent({ action: 'notifications_telegram_settings', req, actorRole: sessionRole, detail: { configured: telegram.configured, webhookConfigured: telegram.webhookConfigured } });
    sendJson(res, { ok: true, telegram, center: getNotificationCenterPayload(sessionRole) });
    return true;
  }

  if (req.url === '/api/notifications/telegram/register' && req.method === 'POST') {
    const telegram = await registerTelegramWebhook();
    writeAuditEvent({ action: 'notifications_telegram_register', req, actorRole: sessionRole, detail: { registered: true } });
    sendJson(res, { ok: true, telegram, center: getNotificationCenterPayload(sessionRole) });
    return true;
  }

  if (req.url === '/api/notifications/telegram/test' && req.method === 'POST') {
    const result = await sendTelegramNotification('Telegram 通知通道已接入 Exam Planner。', { payload: { severity: 'info' } });
    writeAuditEvent({ action: 'notifications_telegram_test', req, actorRole: sessionRole, detail: { ok: result.ok } });
    sendJson(res, { ok: result.ok, result, center: getNotificationCenterPayload(sessionRole) }, result.ok ? 200 : 502);
    return true;
  }

  if (req.url?.startsWith('/api/notifications')) {
    collectOperationalNotifications();
  }
  return false;
}
