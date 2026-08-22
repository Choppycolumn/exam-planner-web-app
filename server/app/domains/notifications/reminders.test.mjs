import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNotificationReminderDomain } from './reminders.mjs';

function install(runtime) {
  const api = {};
  installNotificationReminderDomain(runtime, (readers) => {
    for (const [name, read] of Object.entries(readers)) {
      Object.defineProperty(api, name, { configurable: true, enumerable: true, get: read });
    }
  });
  return api;
}

function fixtureRuntime() {
  const task = {
    id: 7,
    title: '核对提醒链路',
    dueDate: '2026-08-11',
    dueTime: '12:00',
    urgency: 'high',
    reminderSentOffsets: [],
  };
  const metadata = new Map();
  return {
    task,
    runtime: {
      redactSecretText: (value) => String(value),
      normalizeTaskDueTime: (value) => String(value || ''),
      listNotificationLabelTasks: () => [task],
      taskLetterLabel: () => 'A',
      notificationUrgencyLabel: () => '高',
      taskRepository: {
        listOwnerTimedReminders: () => [task],
        markReminderSent: vi.fn(),
      },
      addDaysISO: () => '2026-09-15',
      normalizeNotificationTask: (value) => value,
      ensureSqliteStore: vi.fn(),
      getDailyBriefSettings: () => ({ taskReminders: { enabled: true, offsetsMinutes: [30] } }),
      normalizeTaskReminderSettings: () => ({ offsetsMinutes: [30] }),
      normalizeReminderSentOffsets: (value) => Array.isArray(value) ? value : [],
      queueProactiveNotification: vi.fn(() => ({ deliveryId: 11 })),
      tableChanged: vi.fn(),
      logStructured: vi.fn(),
      nowISO: () => new Date().toISOString(),
      setRuntimeMetadata: (key, value) => metadata.set(key, value),
      appMetadataRepository: {
        get: (key, fallback = '') => metadata.has(key) ? metadata.get(key) : fallback,
        setMany: (values) => Object.entries(values).forEach(([key, value]) => metadata.set(key, value)),
      },
      scheduler: {
        scheduleInterval: vi.fn((_name, _interval, callback) => ({ callback })),
      },
      nextTaskReminderScanAt: null,
      taskReminderTimer: null,
      taskReminderInitialTimer: null,
    },
    metadata,
  };
}

describe('notification reminder domain', () => {
  afterEach(() => vi.useRealTimers());

  it('runs the complete reminder scan with explicitly scoped helpers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T03:45:00.000Z'));
    const { runtime, metadata } = fixtureRuntime();
    const api = install(runtime);

    api.scheduleTaskReminderScan();
    await runtime.taskReminderTimer.callback();

    expect(runtime.queueProactiveNotification).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: 'task-reminder:7:30:2026-08-11',
      title: '待办提醒：核对提醒链路',
    }));
    expect(runtime.taskRepository.markReminderSent).toHaveBeenCalledWith(7, [30], expect.any(String));
    expect(metadata.get('worker_task_reminder_last_success_at')).toBe('2026-08-11T03:45:00.000Z');
    expect(metadata.get('worker_task_reminder_last_error')).toBe('');
  });

  it('deduplicates repeated scan errors while preserving health metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T03:45:00.000Z'));
    const { runtime, metadata } = fixtureRuntime();
    runtime.normalizeNotificationTask = () => { throw new Error('fixture failure'); };
    const api = install(runtime);
    api.scheduleTaskReminderScan();

    await runtime.taskReminderTimer.callback();
    await runtime.taskReminderTimer.callback();

    expect(metadata.get('worker_task_reminder_last_error')).toBe('fixture failure');
    expect(runtime.logStructured).toHaveBeenCalledTimes(1);
  });
});
