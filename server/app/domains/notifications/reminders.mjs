export function installNotificationReminderDomain(runtime, exposeRuntime) {
    function chinaDateISO(date = new Date()) {
        return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }
    function chinaWallClockUtcMs(dateValue, timeValue) {
        const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || '')) ? String(dateValue) : '';
        const dueTime = runtime.normalizeTaskDueTime(timeValue);
        if (!dueDate || !dueTime)
            return null;
        const [year, month, day] = dueDate.split('-').map(Number);
        const [hour, minute] = dueTime.split(':').map(Number);
        return Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0);
    }
    function formatReminderLead(minutes) {
        const value = Math.max(0, Math.round(Number(minutes) || 0));
        if (value >= 60) {
            const hours = Math.floor(value / 60);
            const rest = value % 60;
            return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
        }
        return `${value} 分钟`;
    }
    function taskCompletionHint(taskId) {
        const tasks = runtime.listNotificationLabelTasks({ limit: 26 });
        const index = tasks.findIndex((task) => Number(task.id) === Number(taskId));
        if (index >= 0)
            return { label: runtime.taskLetterLabel(index), command: `完成${runtime.taskLetterLabel(index)}` };
        return { label: `#${taskId}`, command: `完成#${taskId}` };
    }
    function buildTaskReminderText(task, offsetMinutes, dueAtMs) {
        const hint = taskCompletionHint(task.id);
        const due = `${task.dueDate} ${task.dueTime}`;
        const remaining = Math.max(0, Math.round((dueAtMs - Date.now()) / 60000));
        return [
            '【待办提醒】',
            `${hint.label}. ${task.title}`,
            `时间：${due}`,
            `优先级：${runtime.notificationUrgencyLabel(task.urgency)}`,
            `提醒：提前 ${formatReminderLead(offsetMinutes)}，距离开始约 ${formatReminderLead(remaining)}`,
            '',
            `可在 Telegram 回复：${hint.command} / 今日待办`,
        ].join('\n');
    }
    function listTimedReminderTasks(scanDate) {
        const maxForwardDays = 35;
        return runtime.taskRepository.listOwnerTimedReminders(
            scanDate,
            runtime.addDaysISO(scanDate, maxForwardDays),
        ).map(runtime.normalizeNotificationTask);
    }
    async function processTaskReminders() {
        runtime.ensureSqliteStore();
        const settings = runtime.getDailyBriefSettings({ includeSecret: true }).taskReminders;
        if (!settings?.enabled)
            return { ok: true, sent: 0, skipped: 'disabled' };
        const offsets = runtime.normalizeTaskReminderSettings(settings).offsetsMinutes;
        if (!offsets.length)
            return { ok: true, sent: 0, skipped: 'no_offsets' };
        const nowMs = Date.now();
        const scanDate = chinaDateISO(new Date(nowMs - Math.max(...offsets) * 60 * 1000));
        const tasks = listTimedReminderTasks(scanDate);
        let sent = 0;
        for (const task of tasks) {
            const dueAtMs = chinaWallClockUtcMs(task.dueDate, task.dueTime);
            if (!dueAtMs || nowMs >= dueAtMs)
                continue;
            const sentOffsets = runtime.normalizeReminderSentOffsets(task.reminderSentOffsets);
            const dueOffsets = offsets
                .filter((offset) => !sentOffsets.includes(offset))
                .filter((offset) => nowMs >= dueAtMs - offset * 60 * 1000)
                .sort((a, b) => a - b);
            const offset = dueOffsets[0];
            if (typeof offset !== 'number')
                continue;
            const delivery = runtime.queueProactiveNotification({
                eventKey: `task-reminder:${task.id}:${offset}:${task.dueDate}`,
                source: 'task',
                title: `待办提醒：${task.title}`,
                content: `待办提醒已进入 Bark、Telegram 主动推送队列，提前 ${offset} 分钟提醒。`,
                text: buildTaskReminderText(task, offset, dueAtMs),
                payload: { taskId: task.id, offset, dueDate: task.dueDate, dueTime: task.dueTime },
            });
            const timestamp = runtime.nowISO();
            const nextOffsets = runtime.normalizeReminderSentOffsets([...sentOffsets, offset]);
            runtime.taskRepository.markReminderSent(task.id, nextOffsets, timestamp);
            runtime.tableChanged();
            sent += 1;
            runtime.logStructured('info', 'task_reminder_queued', { taskId: task.id, offset, deliveryId: delivery.deliveryId });
        }
        return { ok: true, sent };
    }
    function scheduleTaskReminderScan() {
        const scan = async () => {
            runtime.nextTaskReminderScanAt = new Date(Date.now() + 60 * 1000).toISOString();
            runtime.setRuntimeMetadata('worker_next_task_reminder_at', runtime.nextTaskReminderScanAt);
            try {
                const result = await processTaskReminders();
                const recoveredFrom = runtime.appMetadataRepository.get('worker_task_reminder_last_error', '');
                runtime.appMetadataRepository.setMany({
                    worker_task_reminder_last_success_at: runtime.nowISO(),
                    worker_task_reminder_last_error: '',
                    worker_task_reminder_last_result: JSON.stringify(result || {}),
                });
                if (recoveredFrom) {
                    runtime.logStructured('info', 'task_reminder_scan_recovered');
                }
            }
            catch (error) {
                const message = runtime.redactSecretText(error.message || String(error));
                const previous = runtime.appMetadataRepository.get('worker_task_reminder_last_error', '');
                const previousAt = runtime.appMetadataRepository.get('worker_task_reminder_last_error_at', '');
                const previousMs = Date.parse(previousAt);
                runtime.appMetadataRepository.setMany({
                    worker_task_reminder_last_error: message,
                    worker_task_reminder_last_error_at: runtime.nowISO(),
                });
                if (message !== previous || !Number.isFinite(previousMs) || Date.now() - previousMs >= 30 * 60 * 1000) {
                    runtime.logStructured('error', 'task_reminder_scan_failed', { error: message });
                }
            }
        };
        runtime.nextTaskReminderScanAt = new Date(Date.now() + 60 * 1000).toISOString();
        runtime.setRuntimeMetadata('worker_next_task_reminder_at', runtime.nextTaskReminderScanAt);
        runtime.taskReminderTimer = runtime.scheduler.scheduleInterval(
            'task-reminders',
            60 * 1000,
            scan,
            { initialDelayMs: 5000 },
        );
        runtime.taskReminderInitialTimer = runtime.taskReminderTimer;
    }
    exposeRuntime({
        chinaDateISO: () => chinaDateISO,
        chinaWallClockUtcMs: () => chinaWallClockUtcMs,
        formatReminderLead: () => formatReminderLead,
        taskCompletionHint: () => taskCompletionHint,
        buildTaskReminderText: () => buildTaskReminderText,
        listTimedReminderTasks: () => listTimedReminderTasks,
        processTaskReminders: () => processTaskReminders,
        scheduleTaskReminderScan: () => scheduleTaskReminderScan,
    });
}
