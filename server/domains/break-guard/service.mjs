const EVENT_LABELS = {
  break_started: '开始休息',
  break_completed: '休息结束',
  break_timeout_warning: '休息超时提醒',
  unfocused: '不专注记录',
  class_started: '开始上课',
  class_completed: '完成课程',
  schedule_lag: '学习进度落后',
  schedule_config_updated: '学习设置更新',
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
  refreshStudySummariesForDate,
  queueProactiveNotification,
  cancelScheduleLagNotifications = () => {},
}) {
  function normalizeScheduleConfig(input = {}) {
    const projects = repository.listActiveProjects();
    const legacyDailyLessons = Math.max(1, Math.min(12, Math.round(Number(input.dailyLessons || 8))));
    const lessonMinutes = Math.max(10, Math.min(180, Math.round(Number(input.lessonMinutes || 50))));
    const lessonProjects = projects.slice(0, 12).map((project) => project.id);
    const dailyLessons = Math.max(1, lessonProjects.length || legacyDailyLessons);
    return {
      dailyLessons,
      lessonMinutes,
      dailyTargetMinutes: Math.max(30, Math.min(960, Math.round(Number(input.dailyTargetMinutes || legacyDailyLessons * lessonMinutes)))),
      breakMinutes: Math.max(1, Math.min(60, Math.round(Number(input.breakMinutes || 10)))),
      dayStart: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.dayStart || '')) ? String(input.dayStart) : '08:00',
      lagGraceMinutes: Math.max(0, Math.min(180, Math.round(Number(input.lagGraceMinutes ?? 20)))),
      lagRepeatMinutes: Math.max(5, Math.min(180, Math.round(Number(input.lagRepeatMinutes || 30)))),
      lessonProjects,
    };
  }

  function getScheduleConfig() {
    const projects = repository.listActiveProjects();
    return { config: normalizeScheduleConfig(repository.getScheduleConfig() || {}), projects };
  }

  function saveScheduleConfig(input = {}) {
    const config = normalizeScheduleConfig(input);
    repository.saveScheduleConfig(config);
    return { config, projects: repository.listActiveProjects() };
  }

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
    let schedule = null;
    let studyRecord = null;
    if (event.eventType === 'schedule_config_updated') schedule = saveScheduleConfig(event.payload);
    if (event.eventType === 'class_completed') {
      studyRecord = repository.appendStudyTime({
        lessonDate: event.payload?.lessonDate,
        projectId: Number(event.payload?.projectId || 0),
        durationSeconds: Number(event.payload?.durationSeconds || 0),
        lessonNumber: Number(event.payload?.lessonNumber || 0),
      });
      if (studyRecord) refreshStudySummariesForDate?.(studyRecord.lessonDate);
    }
    if (['lunch', 'dinner', 'meal'].includes(event.eventType)) {
      cancelScheduleLagNotifications();
    }
    tableChanged();
    return { ...event, label: EVENT_LABELS[event.eventType], createdAt, duplicate: false, studyRecord, schedule };
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
      completedLessonCount: Number(byType.class_completed?.count || 0),
      scheduleLagCount: Number(byType.schedule_lag?.count || 0),
      lunchCount: Number(byType.lunch?.count || 0),
      dinnerCount: Number(byType.dinner?.count || 0),
      latest,
    };
  }

  function queueNotification(event) {
    const isUnfocused = event.eventType === 'unfocused';
    const isScheduleLag = event.eventType === 'schedule_lag';
    if (isScheduleLag) {
      const latest = repository.latestEvents(20);
      const mealIndex = latest.findIndex((item) => ['lunch', 'dinner', 'meal'].includes(item.eventType));
      const resumedIndex = latest.findIndex((item) => item.eventType === 'class_started');
      if (mealIndex >= 0 && (resumedIndex < 0 || mealIndex < resumedIndex)) {
        return { ok: true, queued: false, status: 'suppressed', reason: 'meal_pause' };
      }
    }
    const title = isUnfocused ? '休息超时未归记录' : isScheduleLag ? '今日学习进度落后' : '休息结束提醒';
    const text = isUnfocused
      ? `休息结束后已超过 ${Math.max(5, Math.round(event.overdueSeconds / 60))} 分钟仍未取消，已记录一次不专注。`
      : isScheduleLag
        ? Number(event.payload?.targetMinutes || 0) > 0
          ? `今日已学 ${Number(event.payload?.studyMinutes || 0)} / ${Number(event.payload?.targetMinutes || 0)} 分钟，当前学习时长尚未达标。请回到 Break Guard 调整今天的学习节奏。`
          : `当前完成 ${Number(event.payload?.completedLessons || 0)} / ${Number(event.payload?.dailyLessons || 0)} 节。请回到 Break Guard 调整今天的学习节奏。`
        : '课间休息已经结束，请回到学习并在桌面悬浮窗结束休息。';
    return queueProactiveNotification({
      eventKey: `break-guard:${event.eventType}:${event.eventId || event.createdAt}`,
      source: 'break_guard', severity: isUnfocused || isScheduleLag ? 'warning' : 'info', title, content: text,
      text: `【${title}】\n${text}`,
      payload: { eventId: event.eventId, eventType: event.eventType, overdueSeconds: event.overdueSeconds, createdAt: event.createdAt },
    });
  }

  return { requireToken, normalizeEvent, recordEvent, getSummary, queueNotification, getScheduleConfig, saveScheduleConfig };
}
