const EVENT_LABELS = {
  break_started: '开始休息',
  break_completed: '休息结束',
  break_timeout_warning: '休息超时提醒',
  unfocused: '不专注记录',
  lunch: '中午吃饭',
  dinner: '晚上吃饭',
  meal: '吃饭',
};

export function createBreakGuardService({
  token,
  safeSecretEqual,
  nowISO,
  todayISO,
  repository,
  tableChanged,
  queueProactiveNotification,
}) {
  function requireToken(req, body = {}) {
    if (!token) return { ok: false, status: 503, error: 'Break guard token is not configured' };
    const provided = String(req.headers['x-break-guard-token'] || body.token || '');
    return safeSecretEqual(provided, token)
      ? { ok: true }
      : { ok: false, status: 401, error: 'Unauthorized' };
  }

  function normalizeEvent(body = {}) {
    const eventType = String(body.eventType || body.type || '').trim();
    if (!EVENT_LABELS[eventType]) {
      const error = new Error('Invalid break guard event type');
      error.statusCode = 400;
      throw error;
    }
    const eventId = String(body.eventId || '').trim().slice(0, 80);
    if (eventId && !/^[a-zA-Z0-9_-]{8,80}$/.test(eventId)) {
      const error = new Error('Invalid break guard event id');
      error.statusCode = 400;
      throw error;
    }
    return {
      eventId: eventId || null,
      eventType,
      status: String(body.status || '').trim().slice(0, 40),
      source: String(body.source || 'desktop').trim().slice(0, 40) || 'desktop',
      note: String(body.note || '').trim().slice(0, 500),
      startedAt: body.startedAt ? String(body.startedAt).slice(0, 40) : null,
      endedAt: body.endedAt ? String(body.endedAt).slice(0, 40) : null,
      overdueSeconds: Math.max(0, Math.min(24 * 60 * 60, Math.round(Number(body.overdueSeconds || 0)))),
      payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
    };
  }

  function recordEvent(body = {}) {
    const event = normalizeEvent(body);
    if (event.eventId) {
      const existing = repository.findEvent(event.eventId);
      if (existing) return { ...existing, overdueSeconds: Number(existing.overdueSeconds || 0), label: EVENT_LABELS[existing.eventType] || existing.eventType, duplicate: true };
    }
    const createdAt = nowISO();
    repository.insertEvent(event, createdAt);
    tableChanged();
    return { ...event, label: EVENT_LABELS[event.eventType], createdAt, duplicate: false };
  }

  function getSummary(date = todayISO()) {
    const rows = repository.summaryByType(date);
    const byType = Object.fromEntries(rows.map((row) => [row.eventType, { count: Number(row.count || 0), latestAt: row.latestAt || null }]));
    const latest = repository.latestEvents(5).map((row) => ({
      id: Number(row.id), eventType: row.eventType, label: EVENT_LABELS[row.eventType] || row.eventType,
      status: row.status || '', note: row.note || '', overdueSeconds: Number(row.overdueSeconds || 0), createdAt: row.createdAt,
    }));
    return {
      date,
      breakCount: Number(byType.break_started?.count || 0),
      completedBreakCount: Number(byType.break_completed?.count || 0),
      timeoutWarningCount: Number(byType.break_timeout_warning?.count || 0),
      unfocusedCount: Number(byType.unfocused?.count || 0),
      lunchCount: Number(byType.lunch?.count || 0),
      dinnerCount: Number(byType.dinner?.count || 0),
      latest,
    };
  }

  function queueNotification(event) {
    const title = event.eventType === 'unfocused' ? '休息超时未归记录' : '休息结束提醒';
    const text = event.eventType === 'unfocused'
      ? `休息结束后已超过 ${Math.max(5, Math.round(event.overdueSeconds / 60))} 分钟仍未取消，已记录一次不专注。`
      : '10 分钟休息已经结束，请回到学习。如果已经回来了，请在桌面悬浮窗点“我回来了”。';
    return queueProactiveNotification({
      eventKey: `break-guard:${event.eventType}:${event.eventId || event.createdAt}`,
      source: 'break_guard', severity: event.eventType === 'unfocused' ? 'warning' : 'info', title, content: text,
      text: `【${title}】\n${text}`,
      payload: { eventId: event.eventId, eventType: event.eventType, overdueSeconds: event.overdueSeconds, createdAt: event.createdAt },
    });
  }

  return { requireToken, normalizeEvent, recordEvent, getSummary, queueNotification };
}
