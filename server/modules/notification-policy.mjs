export function classifyNotificationFailure(error = '') {
  const message = String(error);
  if (/ret=-2|proactive send blocked/i.test(message)) {
    return { retryable: false, status: 'degraded', action: '给微信机器人发送任意消息以刷新会话；主动通知由 Bark 兜底。' };
  }
  if (/timeout|fetch failed|ECONN|HTTP 5\d\d/i.test(message)) {
    return { retryable: true, status: 'degraded', action: '等待自动重试；若持续失败，检查网络和上游服务。' };
  }
  return { retryable: true, status: 'failed', action: '检查通知通道配置与服务日志。' };
}

export function isWechatQuietHours(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    hour12: false,
  }).format(date));
  return hour >= 3 && hour < 7;
}

export function nextWechatActiveAt(date = new Date()) {
  const china = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const targetUtcMs = Date.UTC(
    china.getUTCFullYear(),
    china.getUTCMonth(),
    china.getUTCDate(),
    7 - 8,
    0,
    0,
    0,
  );
  return new Date(targetUtcMs <= date.getTime() ? targetUtcMs + 24 * 60 * 60 * 1000 : targetUtcMs).toISOString();
}
