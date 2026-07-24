const ACTIONS = new Set([
  'start_focus',
  'complete_focus',
  'finish_break',
  'start_meal',
  'finish_meal',
  'start_segment',
  'finish_segment',
  'end_day',
  'reopen_day',
  'save_settings',
]);

const idPattern = /^[a-zA-Z0-9_-]{8,80}$/;

function timerError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function boundedInteger(value, minimum, maximum, fallback) {
  const numeric = Math.round(Number(value));
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
}

function parseOccurredAt(value, nowMs) {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return new Date(nowMs).toISOString();
  const minimum = nowMs - 30 * 24 * 60 * 60 * 1000;
  const maximum = nowMs + 5 * 60 * 1000;
  return new Date(Math.max(minimum, Math.min(maximum, parsed))).toISOString();
}

function shanghaiDateFromISO(value) {
  const date = new Date(String(value || ''));
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function createFocusTimerService({
  repository,
  now = () => Date.now(),
  todayISO,
  tableChanged = () => {},
  refreshStudySummariesForDate = () => {},
}) {
  function summary(userId, date) {
    const sessions = repository.listSessions(userId, date);
    const studySeconds = sessions.reduce((sum, session) => sum + Number(session.durationSeconds || 0), 0);
    const byProject = new Map();
    for (const session of sessions) {
      const current = byProject.get(session.projectId) || {
        projectId: session.projectId,
        projectName: session.projectName,
        studySeconds: 0,
        sessionCount: 0,
      };
      current.studySeconds += session.durationSeconds;
      current.sessionCount += 1;
      byProject.set(session.projectId, current);
    }
    return {
      date,
      studySeconds,
      sessionCount: sessions.length,
      byProject: [...byProject.values()].sort((left, right) => right.studySeconds - left.studySeconds),
      dayEnded: Boolean(repository.getDayClosure(userId, date)),
    };
  }

  function stateSnapshot(userId, atMs = now()) {
    const state = repository.getState(userId);
    const startedMs = state.startedAt ? Date.parse(state.startedAt) : atMs;
    const elapsedSeconds = state.mode === 'idle' ? 0 : Math.max(0, Math.floor((atMs - startedMs) / 1000));
    const remainingSeconds = state.targetSeconds > 0 ? Math.max(0, state.targetSeconds - elapsedSeconds) : 0;
    const overtimeSeconds = state.targetSeconds > 0 ? Math.max(0, elapsedSeconds - state.targetSeconds) : 0;
    return {
      ...state,
      elapsedSeconds,
      remainingSeconds,
      overtimeSeconds,
      expired: state.targetSeconds > 0 && elapsedSeconds >= state.targetSeconds,
      segments: state.sessionId ? repository.listSegments(userId, state.sessionId) : [],
    };
  }

  function completeFocus(userId, state, endedAt, note = '') {
    const endedMs = Math.max(Date.parse(state.startedAt), Date.parse(endedAt));
    const durationSeconds = Math.max(1, Math.min(24 * 60 * 60, Math.floor((endedMs - Date.parse(state.startedAt)) / 1000)));
    const normalizedEndedAt = new Date(Date.parse(state.startedAt) + durationSeconds * 1000).toISOString();
    const activeSegment = repository.getActiveSegment(userId, state.sessionId);
    if (activeSegment) {
      const segmentDuration = Math.max(0, Math.floor((Date.parse(normalizedEndedAt) - Date.parse(activeSegment.startedAt)) / 1000));
      repository.finishSegment(userId, state.sessionId, normalizedEndedAt, segmentDuration);
    }
    const session = {
      sessionId: state.sessionId,
      sessionDate: shanghaiDateFromISO(state.startedAt),
      projectId: state.projectId,
      projectName: state.projectName,
      startedAt: state.startedAt,
      endedAt: normalizedEndedAt,
      durationSeconds,
      note: String(note || '').trim().slice(0, 300),
    };
    const inserted = repository.insertSession(userId, session, normalizedEndedAt);
    const minutesAdded = inserted ? repository.addStudyTime(userId, session, normalizedEndedAt) : 0;
    const settings = repository.getSettings(userId);
    const breakState = repository.saveState(userId, {
      mode: 'break',
      sessionId: `break_${state.sessionId}`.slice(0, 80),
      projectId: state.projectId,
      projectName: state.projectName,
      pauseLabel: '课间休息',
      startedAt: normalizedEndedAt,
      targetSeconds: settings.breakMinutes * 60,
    }, normalizedEndedAt);
    tableChanged();
    return { session, inserted, minutesAdded, state: breakState };
  }

  function reconcile(userId) {
    const state = repository.getState(userId);
    if (state.mode !== 'focus' || !state.startedAt || state.targetSeconds <= 0) return state;
    const deadlineMs = Date.parse(state.startedAt) + state.targetSeconds * 1000;
    if (now() < deadlineMs) return state;
    const completion = repository.transaction(() => {
      const current = repository.getState(userId);
      if (current.mode !== 'focus' || current.sessionId !== state.sessionId) {
        return { state: current, inserted: false, session: null };
      }
      return completeFocus(userId, current, new Date(deadlineMs).toISOString(), '达到设定专注时长后自动结束');
    });
    if (completion.inserted && userId === 1 && completion.session) {
      refreshStudySummariesForDate(completion.session.sessionDate);
    }
    return completion.state;
  }

  function getDashboard(userId) {
    reconcile(userId);
    const date = todayISO();
    return {
      generatedAt: new Date(now()).toISOString(),
      settings: repository.getSettings(userId),
      state: stateSnapshot(userId),
      summary: summary(userId, date),
      sessions: repository.listSessions(userId, date),
    };
  }

  function execute(userId, input = {}) {
    const action = String(input.action || '');
    const operationId = String(input.operationId || '');
    if (!ACTIONS.has(action)) throw timerError('无效的专注计时操作');
    if (!idPattern.test(operationId)) throw timerError('无效的操作 ID');
    const duplicate = repository.findOperation(userId, operationId);
    if (duplicate) return { ...duplicate, duplicate: true };

    const occurredAt = parseOccurredAt(input.occurredAt, now());
    let completedStudyDate = null;
    const result = repository.transaction(() => {
      const repeated = repository.findOperation(userId, operationId);
      if (repeated) return { ...repeated, duplicate: true };
      let state = repository.getState(userId);
      const settings = repository.getSettings(userId);

      if (action === 'start_focus') {
        if (state.mode !== 'idle') throw timerError('请先结束当前计时或休息', 409);
        const sessionId = String(input.sessionId || '');
        if (!idPattern.test(sessionId)) throw timerError('无效的专注会话 ID');
        const project = repository.getProject(userId, Number(input.projectId));
        if (!project) throw timerError('该课程不存在或不属于当前用户', 404);
        repository.reopenDay(userId, shanghaiDateFromISO(occurredAt));
        state = repository.saveState(userId, {
          mode: 'focus',
          sessionId,
          projectId: project.id,
          projectName: project.name,
          pauseLabel: '',
          startedAt: occurredAt,
          targetSeconds: settings.focusMinutes * 60,
        }, occurredAt);
      }

      if (action === 'complete_focus') {
        const sessionId = String(input.sessionId || '');
        const existing = idPattern.test(sessionId) ? repository.findSession(userId, sessionId) : null;
        if (existing) {
          state = repository.getState(userId);
        } else {
          if (state.mode !== 'focus' || state.sessionId !== sessionId) throw timerError('当前专注会话已经变化，请刷新后重试', 409);
          const completion = completeFocus(userId, state, occurredAt, input.note);
          state = completion.state;
          if (completion.inserted) completedStudyDate = completion.session.sessionDate;
        }
      }

      if (action === 'finish_break') {
        if (state.mode !== 'break') throw timerError('当前不在休息状态', 409);
        state = repository.saveState(userId, { mode: 'idle' }, occurredAt);
      }

      if (action === 'start_meal') {
        if (state.mode === 'focus') throw timerError('请先结束当前专注', 409);
        const label = input.mealType === 'dinner' ? '晚饭' : '午饭';
        state = repository.saveState(userId, {
          mode: 'meal',
          sessionId: String(input.sessionId || operationId).slice(0, 80),
          pauseLabel: label,
          startedAt: occurredAt,
          targetSeconds: 0,
        }, occurredAt);
      }

      if (action === 'finish_meal') {
        if (state.mode !== 'meal') throw timerError('当前不在用餐暂停状态', 409);
        state = repository.saveState(userId, { mode: 'idle' }, occurredAt);
      }

      if (action === 'start_segment') {
        if (state.mode !== 'focus') throw timerError('请先开始专注', 409);
        if (repository.getActiveSegment(userId, state.sessionId)) throw timerError('已有分段正在计时', 409);
        const segmentId = String(input.segmentId || '');
        if (!idPattern.test(segmentId)) throw timerError('无效的分段 ID');
        repository.startSegment(userId, state.sessionId, segmentId, occurredAt, occurredAt);
      }

      if (action === 'finish_segment') {
        if (state.mode !== 'focus') throw timerError('当前没有进行中的专注', 409);
        const active = repository.getActiveSegment(userId, state.sessionId);
        if (!active) throw timerError('当前没有进行中的分段', 409);
        const duration = Math.max(0, Math.floor((Date.parse(occurredAt) - Date.parse(active.startedAt)) / 1000));
        repository.finishSegment(userId, state.sessionId, occurredAt, duration);
      }

      if (action === 'end_day') {
        if (state.mode === 'focus') throw timerError('请先结束当前专注再结束一天', 409);
        repository.saveState(userId, { mode: 'idle' }, occurredAt);
        repository.closeDay(userId, shanghaiDateFromISO(occurredAt), occurredAt);
        state = repository.getState(userId);
      }

      if (action === 'reopen_day') {
        repository.reopenDay(userId, shanghaiDateFromISO(occurredAt));
      }

      if (action === 'save_settings') {
        repository.saveSettings(userId, {
          focusMinutes: boundedInteger(input.focusMinutes, 5, 180, settings.focusMinutes),
          breakMinutes: boundedInteger(input.breakMinutes, 1, 60, settings.breakMinutes),
        }, occurredAt);
      }

      const response = {
        ok: true,
        action,
        operationId,
        dashboard: {
          generatedAt: new Date(now()).toISOString(),
          settings: repository.getSettings(userId),
          state: stateSnapshot(userId),
          summary: summary(userId, todayISO()),
          sessions: repository.listSessions(userId, todayISO()),
        },
      };
      repository.saveOperation(userId, operationId, action, response, occurredAt);
      tableChanged();
      return response;
    });
    if (completedStudyDate && userId === 1) refreshStudySummariesForDate(completedStudyDate);
    return result;
  }

  return { getDashboard, execute, reconcile };
}
