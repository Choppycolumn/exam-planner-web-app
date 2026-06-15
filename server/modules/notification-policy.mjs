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
