import type {
  FocusTimerAction,
  FocusTimerDashboard,
  FocusTimerSegment,
  FocusTimerSession,
  FocusTimerState,
} from '../../api/contracts';

const keyPrefix = 'examPlanner.focusTimer.v1';

const queueKey = (userId: number) => `${keyPrefix}.outbox.user-${userId}`;
const cacheKey = (userId: number) => `${keyPrefix}.cache.user-${userId}`;

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function createFocusTimerId(prefix: 'operation' | 'session' | 'segment' = 'operation') {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? Math.random().toString(36).slice(2);
  return `${prefix}_${Date.now()}_${random}`.slice(0, 80);
}

export function loadFocusTimerQueue(userId: number) {
  if (typeof localStorage === 'undefined') return [] as FocusTimerAction[];
  return safeParse<FocusTimerAction[]>(localStorage.getItem(queueKey(userId)), []);
}

export function saveFocusTimerQueue(userId: number, queue: FocusTimerAction[]) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(queueKey(userId), JSON.stringify(queue));
}

export function enqueueFocusTimerAction(userId: number, action: FocusTimerAction) {
  const queue = loadFocusTimerQueue(userId);
  if (!queue.some((item) => item.operationId === action.operationId)) queue.push(action);
  saveFocusTimerQueue(userId, queue);
  return queue;
}

export function removeFocusTimerAction(userId: number, operationId: string) {
  const queue = loadFocusTimerQueue(userId).filter((item) => item.operationId !== operationId);
  saveFocusTimerQueue(userId, queue);
  return queue;
}

export function loadFocusTimerCache(userId: number) {
  if (typeof localStorage === 'undefined') return undefined;
  return safeParse<FocusTimerDashboard | undefined>(localStorage.getItem(cacheKey(userId)), undefined);
}

export function saveFocusTimerCache(userId: number, dashboard: FocusTimerDashboard) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(cacheKey(userId), JSON.stringify(dashboard));
}

function elapsedSeconds(startedAt: string | null, occurredAt: string) {
  if (!startedAt) return 0;
  return Math.max(1, Math.floor((Date.parse(occurredAt) - Date.parse(startedAt)) / 1000));
}

function snapshot(state: FocusTimerState, occurredAt: string): FocusTimerState {
  const elapsed = state.mode === 'idle' ? 0 : elapsedSeconds(state.startedAt, occurredAt);
  const remaining = state.targetSeconds > 0 ? Math.max(0, state.targetSeconds - elapsed) : 0;
  const overtime = state.targetSeconds > 0 ? Math.max(0, elapsed - state.targetSeconds) : 0;
  return {
    ...state,
    elapsedSeconds: elapsed,
    remainingSeconds: remaining,
    overtimeSeconds: overtime,
    expired: state.targetSeconds > 0 && elapsed >= state.targetSeconds,
  };
}

function idleState(state: FocusTimerState, occurredAt: string): FocusTimerState {
  return {
    ...state,
    mode: 'idle',
    sessionId: null,
    projectId: null,
    projectName: '',
    pauseLabel: '',
    startedAt: null,
    targetSeconds: 0,
    elapsedSeconds: 0,
    remainingSeconds: 0,
    overtimeSeconds: 0,
    expired: false,
    segments: [],
    revision: state.revision + 1,
    updatedAt: occurredAt,
  };
}

function finishActiveSegment(segments: FocusTimerSegment[], occurredAt: string) {
  return segments.map((segment) => segment.endedAt ? segment : {
    ...segment,
    endedAt: occurredAt,
    durationSeconds: elapsedSeconds(segment.startedAt, occurredAt),
  });
}

export function applyOptimisticFocusTimerAction(
  dashboard: FocusTimerDashboard,
  action: FocusTimerAction,
  projectName = '',
): FocusTimerDashboard {
  const next: FocusTimerDashboard = structuredClone(dashboard);
  const previous = snapshot(next.state, action.occurredAt);
  next.generatedAt = action.occurredAt;

  if (action.action === 'start_focus' && action.sessionId && action.projectId) {
    next.state = snapshot({
      ...previous,
      mode: 'focus',
      sessionId: action.sessionId,
      projectId: action.projectId,
      projectName,
      pauseLabel: '',
      startedAt: action.occurredAt,
      targetSeconds: next.settings.focusMinutes * 60,
      revision: previous.revision + 1,
      updatedAt: action.occurredAt,
      segments: [],
    }, action.occurredAt);
  }

  if (action.action === 'complete_focus' && previous.mode === 'focus' && previous.sessionId === action.sessionId) {
    const durationSeconds = elapsedSeconds(previous.startedAt, action.occurredAt);
    const session: FocusTimerSession = {
      sessionId: previous.sessionId,
      sessionDate: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(previous.startedAt!)),
      projectId: previous.projectId!,
      projectName: previous.projectName,
      startedAt: previous.startedAt!,
      endedAt: action.occurredAt,
      durationSeconds,
      note: action.note || '',
    };
    next.sessions = [session, ...next.sessions.filter((item) => item.sessionId !== session.sessionId)];
    next.summary.studySeconds += durationSeconds;
    next.summary.sessionCount += 1;
    const projectSummary = next.summary.byProject.find((item) => item.projectId === session.projectId);
    if (projectSummary) {
      projectSummary.studySeconds += durationSeconds;
      projectSummary.sessionCount += 1;
    } else {
      next.summary.byProject.push({
        projectId: session.projectId,
        projectName: session.projectName,
        studySeconds: durationSeconds,
        sessionCount: 1,
      });
    }
    next.state = snapshot({
      ...previous,
      mode: 'break',
      sessionId: `break_${previous.sessionId}`.slice(0, 80),
      pauseLabel: '课间休息',
      startedAt: action.occurredAt,
      targetSeconds: next.settings.breakMinutes * 60,
      segments: finishActiveSegment(previous.segments, action.occurredAt),
      revision: previous.revision + 1,
      updatedAt: action.occurredAt,
    }, action.occurredAt);
  }

  if (action.action === 'finish_break' || action.action === 'finish_meal') {
    next.state = idleState(previous, action.occurredAt);
  }

  if (action.action === 'start_meal') {
    next.state = snapshot({
      ...previous,
      mode: 'meal',
      sessionId: action.sessionId || action.operationId,
      projectId: null,
      projectName: '',
      pauseLabel: action.mealType === 'dinner' ? '晚饭' : '午饭',
      startedAt: action.occurredAt,
      targetSeconds: 0,
      revision: previous.revision + 1,
      updatedAt: action.occurredAt,
      segments: [],
    }, action.occurredAt);
  }

  if (action.action === 'start_segment' && action.segmentId && previous.mode === 'focus') {
    next.state = {
      ...previous,
      segments: [...previous.segments, {
        segmentId: action.segmentId,
        sequenceNumber: previous.segments.length + 1,
        startedAt: action.occurredAt,
        endedAt: null,
        durationSeconds: 0,
      }],
    };
  }

  if (action.action === 'finish_segment' && previous.mode === 'focus') {
    next.state = { ...previous, segments: finishActiveSegment(previous.segments, action.occurredAt) };
  }

  if (action.action === 'save_settings') {
    next.settings = {
      ...next.settings,
      focusMinutes: action.focusMinutes ?? next.settings.focusMinutes,
      breakMinutes: action.breakMinutes ?? next.settings.breakMinutes,
      updatedAt: action.occurredAt,
    };
  }

  if (action.action === 'end_day') {
    next.state = idleState(previous, action.occurredAt);
    next.summary.dayEnded = true;
  }

  if (action.action === 'reopen_day') next.summary.dayEnded = false;
  return next;
}
