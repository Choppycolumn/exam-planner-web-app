const DEFAULT_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];

export function createNotificationQueue({
  repository,
  sendProactive,
  notifyEvent,
  log = () => {},
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  now = () => new Date(),
}) {
  let processing = false;

  const enqueueProactive = ({ eventKey, source, severity = 'info', title, content, text, payload = {}, channelKey = 'clawbot_weixin' }) => {
    const event = repository.upsertEvent({
      eventKey,
      source,
      severity,
      title,
      content,
      payload: { ...payload, notificationMode: 'proactive' },
    });
    const delivery = repository.enqueueDelivery({
      eventId: event.id,
      channelKey,
      channelType: channelKey === 'clawbot_weixin' ? 'clawbot_weixin' : channelKey,
      mode: 'proactive',
      payload: { text, title, content, source, severity, ...payload },
      maxAttempts: retryDelaysMs.length + 1,
      nextAttemptAt: now().toISOString(),
    });
    log('info', 'proactive_notification_queued', { eventKey, deliveryId: delivery.id, channelKey });
    return delivery;
  };

  const processDue = async () => {
    if (processing) return { processed: 0, skipped: 'already_running' };
    processing = true;
    let processed = 0;
    try {
      const scanTime = now();
      for (const delivery of repository.claimDueDeliveries({
        now: scanTime.toISOString(),
        staleBefore: new Date(scanTime.getTime() - 5 * 60_000).toISOString(),
        limit: 10,
      })) {
        processed += 1;
        repository.markDeliverySending(delivery.id, now().toISOString());
        let result;
        try {
          result = await sendProactive(String(delivery.payload?.text || ''), delivery);
        } catch (error) {
          result = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        if (result?.ok) {
          repository.markDeliveryAccepted(delivery.id, {
            attemptedAt: now().toISOString(),
            response: { request: delivery.payload, result },
          });
          log('info', 'proactive_notification_accepted', { deliveryId: delivery.id, eventId: delivery.eventId, method: result.method || '' });
          continue;
        }

        const attemptCount = delivery.attemptCount + 1;
        const canRetry = attemptCount < delivery.maxAttempts;
        const retryDelay = retryDelaysMs[Math.max(0, attemptCount - 1)] ?? retryDelaysMs.at(-1) ?? 60_000;
        const nextAttemptAt = canRetry ? new Date(now().getTime() + retryDelay).toISOString() : null;
        const error = String(result?.error || '主动推送失败');
        repository.markDeliveryFailed(delivery.id, {
          attemptedAt: now().toISOString(),
          nextAttemptAt,
          error,
          response: { request: delivery.payload, result: result || {} },
          retrying: canRetry,
        });
        log('warn', canRetry ? 'proactive_notification_retry_scheduled' : 'proactive_notification_failed', {
          deliveryId: delivery.id,
          eventId: delivery.eventId,
          attemptCount,
          nextAttemptAt,
          error,
        });
        if (!canRetry) {
          notifyEvent({
            eventKey: `delivery-failed:${delivery.id}`,
            source: 'notification',
            severity: 'warning',
            title: '主动通知发送失败',
            content: `通知已重试 ${attemptCount} 次仍未送达，请在站内通知中心检查。`,
            payload: { deliveryId: delivery.id, originalEventId: delivery.eventId, notificationMode: 'in_app_fallback' },
          });
        }
      }
      return { processed };
    } finally {
      processing = false;
    }
  };

  return { enqueueProactive, processDue };
}
