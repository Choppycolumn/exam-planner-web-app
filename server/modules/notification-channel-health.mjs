export function createNotificationChannelHealth({
  repository,
  failureThreshold = 3,
  retryableCooldownMs = 15 * 60_000,
  permanentCooldownMs = 30 * 60_000,
  now = () => new Date(),
}) {
  function beforeSend(channelKey) {
    const health = repository.getChannelHealth(channelKey);
    const openUntilMs = health?.circuitOpenUntil ? Date.parse(health.circuitOpenUntil) : 0;
    return {
      allowed: !openUntilMs || openUntilMs <= now().getTime(),
      nextAttemptAt: openUntilMs > now().getTime() ? health.circuitOpenUntil : null,
      health,
    };
  }

  function recordSuccess(channelKey) {
    const timestamp = now().toISOString();
    const current = repository.getChannelHealth(channelKey);
    repository.saveChannelHealth({
      channelKey,
      status: 'normal',
      consecutiveFailures: 0,
      successCount: Number(current?.successCount || 0) + 1,
      failureCount: Number(current?.failureCount || 0),
      lastSuccessAt: timestamp,
      lastFailureAt: current?.lastFailureAt || null,
      circuitOpenUntil: null,
      lastError: '',
      action: '',
      updatedAt: timestamp,
    });
  }

  function recordFailure(channelKey, { retryable = true, status = 'degraded', action = '' } = {}, error = '') {
    const timestamp = now();
    const current = repository.getChannelHealth(channelKey);
    const consecutiveFailures = Number(current?.consecutiveFailures || 0) + 1;
    const shouldOpen = !retryable || consecutiveFailures >= failureThreshold;
    const cooldownMs = retryable ? retryableCooldownMs : permanentCooldownMs;
    const circuitOpenUntil = shouldOpen ? new Date(timestamp.getTime() + cooldownMs).toISOString() : null;
    repository.saveChannelHealth({
      channelKey,
      status,
      consecutiveFailures,
      successCount: Number(current?.successCount || 0),
      failureCount: Number(current?.failureCount || 0) + 1,
      lastSuccessAt: current?.lastSuccessAt || null,
      lastFailureAt: timestamp.toISOString(),
      circuitOpenUntil,
      lastError: String(error || '').slice(0, 500),
      action,
      updatedAt: timestamp.toISOString(),
    });
    return { consecutiveFailures, circuitOpenUntil };
  }

  function snapshot(channels = []) {
    const stored = new Map(repository.listChannelHealth().map((item) => [item.channelKey, item]));
    const metrics = new Map(repository.channelDeliveryMetrics().map((item) => [item.channelKey, item]));
    return channels.map((channel) => {
      const health = stored.get(channel.channelKey);
      const delivery = metrics.get(channel.channelKey) || { acceptedLast24h: 0, failedLast24h: 0 };
      const open = Boolean(health?.circuitOpenUntil && Date.parse(health.circuitOpenUntil) > now().getTime());
      return {
        channelKey: channel.channelKey,
        type: channel.type,
        name: channel.name,
        enabled: Boolean(channel.enabled),
        status: open ? 'degraded' : health?.status || 'normal',
        circuitOpen: open,
        circuitOpenUntil: open ? health.circuitOpenUntil : null,
        consecutiveFailures: Number(health?.consecutiveFailures || 0),
        lastSuccessAt: health?.lastSuccessAt || null,
        lastFailureAt: health?.lastFailureAt || null,
        lastError: health?.lastError || '',
        action: open || health?.status !== 'normal' ? health?.action || '检查该通知通道。' : '',
        ...delivery,
      };
    });
  }

  return { beforeSend, recordSuccess, recordFailure, snapshot };
}
