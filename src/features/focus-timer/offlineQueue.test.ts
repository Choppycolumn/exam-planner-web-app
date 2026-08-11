import { afterEach, describe, expect, it } from 'vitest';
import type { FocusTimerAction, FocusTimerDashboard } from '../../api/contracts';
import {
  applyOptimisticFocusTimerAction,
  addFocusTimerConflict,
  loadFocusTimerConflicts,
  enqueueFocusTimerAction,
  loadFocusTimerQueue,
  removeFocusTimerAction,
  retryFocusTimerConflicts,
} from './offlineQueue';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage;
}

function dashboard(): FocusTimerDashboard {
  return {
    generatedAt: '2026-07-24T02:00:00.000Z',
    settings: { userId: 2, focusMinutes: 50, breakMinutes: 10, updatedAt: null },
    state: {
      userId: 2,
      mode: 'idle',
      sessionId: null,
      projectId: null,
      projectName: '',
      pauseLabel: '',
      startedAt: null,
      targetSeconds: 0,
      revision: 0,
      updatedAt: null,
      elapsedSeconds: 0,
      remainingSeconds: 0,
      overtimeSeconds: 0,
      expired: false,
      segments: [],
    },
    summary: { date: '2026-07-24', studySeconds: 0, sessionCount: 0, byProject: [], dayEnded: false },
    sessions: [],
  };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('focus timer offline queue', () => {
  it('stores pending actions under separate user keys', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() });
    const user2: FocusTimerAction = {
      action: 'start_meal',
      operationId: 'operation_user2_001',
      sessionId: 'session_user2_0001',
      occurredAt: '2026-07-24T04:00:00.000Z',
      mealType: 'lunch',
    };
    const user3 = { ...user2, operationId: 'operation_user3_001', sessionId: 'session_user3_0001' };
    enqueueFocusTimerAction(2, user2);
    enqueueFocusTimerAction(3, user3);
    enqueueFocusTimerAction(2, { ...user2, operationId: 'operation_user2_002' });
    removeFocusTimerAction(2, 'operation_user2_001');

    expect(loadFocusTimerQueue(2).map((item) => item.operationId)).toEqual(['operation_user2_002']);
    expect(loadFocusTimerQueue(3).map((item) => item.operationId)).toEqual(['operation_user3_001']);
  });

  it('keeps optimistic focus and completion usable while offline', () => {
    const started = applyOptimisticFocusTimerAction(dashboard(), {
      action: 'start_focus',
      operationId: 'operation_start_001',
      sessionId: 'session_focus_0001',
      projectId: 202,
      occurredAt: '2026-07-24T02:00:00.000Z',
    }, '英一');
    const completed = applyOptimisticFocusTimerAction(started, {
      action: 'complete_focus',
      operationId: 'operation_finish_01',
      sessionId: 'session_focus_0001',
      occurredAt: '2026-07-24T02:40:00.000Z',
    });

    expect(started.state.mode).toBe('focus');
    expect(started.state.projectName).toBe('英一');
    expect(completed.state.mode).toBe('break');
    expect(completed.summary.studySeconds).toBe(2400);
    expect(completed.sessions[0]).toMatchObject({ projectId: 202, durationSeconds: 2400 });
  });

  it('keeps rejected offline actions in a visible conflict inbox', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() });
    const action: FocusTimerAction = {
      action: 'finish_break',
      operationId: 'operation_conflict_001',
      occurredAt: '2026-07-24T03:00:00.000Z',
    };
    addFocusTimerConflict(2, action, Object.assign(new Error('状态版本冲突'), { status: 409 }));

    expect(loadFocusTimerConflicts(2)).toMatchObject([{
      action: { operationId: 'operation_conflict_001' },
      message: '状态版本冲突',
      status: 409,
    }]);
    expect(retryFocusTimerConflicts(2)).toBe(1);
    expect(loadFocusTimerConflicts(2)).toEqual([]);
    expect(loadFocusTimerQueue(2)[0].operationId).toBe('operation_conflict_001');
  });
});
