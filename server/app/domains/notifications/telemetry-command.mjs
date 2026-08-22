import { createTaskRunner } from '../../../domains/tasks/task-runner.mjs';

export function installNotificationTelemetryDomain(runtime, exposeRuntime) {
    function logStructured(level, event, fields = {}) {
        const payload = { level, event, at: runtime.nowISO(), ...fields };
        const line = JSON.stringify(payload);
        if (level === 'error')
            console.error(line);
        else if (level === 'warn')
            console.warn(line);
        else
            console.log(line);
    }
    function writeAuditEvent({ action, req = null, actorRole = '', detail = {} }) {
        try {
            runtime.ensureSqliteStore();
            runtime.opsRepository.writeAuditEvent({
                action,
                actorRole: actorRole || (req ? runtime.getSessionRole(req.headers.cookie) || '' : 'system'),
                clientHash: req ? runtime.clientHashForRequest(req) : 'system',
                detail,
                createdAt: runtime.nowISO(),
            });
        }
        catch (error) {
            logStructured('warn', 'audit_write_failed', { action, error: runtime.redactSecretText(error.message || String(error)) });
        }
    }
    function writeApiRequestLog({ req, statusCode, durationMs, role = '', error = '' }) {
        if (durationMs < runtime.requestLogSlowMs && statusCode < 500 && !error)
            return;
        try {
            runtime.ensureSqliteStore();
            const pathname = new URL(req.url || '/', 'http://localhost').pathname;
            runtime.opsRepository.writeApiRequest({
                method: req.method || 'GET',
                path: pathname,
                statusCode,
                durationMs: Math.round(durationMs),
                role,
                error: runtime.redactSecretText(error),
                createdAt: runtime.nowISO(),
            });
        }
        catch (logError) {
            logStructured('warn', 'api_request_log_failed', { error: runtime.redactSecretText(logError.message || String(logError)) });
        }
    }
    function writeClientErrorLog({ req, role = '', body = {} }) {
        try {
            runtime.ensureSqliteStore();
            const payload = runtime.sanitizeClientErrorPayload(body, {
                userAgent: req.headers['user-agent'] || '',
                createdAt: runtime.nowISO(),
            });
            const id = runtime.opsRepository.writeClientError({
                ...payload,
                role,
                clientHash: runtime.clientHashForRequest(req),
            });
            return { id, ...payload };
        }
        catch (error) {
            logStructured('warn', 'client_error_log_failed', { error: runtime.redactSecretText(error.message || String(error)) });
            return null;
        }
    }
    const taskRunner = createTaskRunner({
        ensureStore: () => runtime.ensureSqliteStore(),
        repository: runtime.taskRunsRepository,
        resourceBudget: runtime.resourceBudget,
        nowISO: runtime.nowISO,
        redact: runtime.redactSecretText,
    });
    const { activeTaskLocks, lastTaskRuns, runExclusiveTask } = taskRunner;
    function normalizeCommandDate(value) {
        const text = String(value || '').trim();
        return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : runtime.todayISO();
    }
    function notificationMinutesText(minutes) {
        const value = Math.max(0, Number(minutes || 0));
        const hours = Math.floor(value / 60);
        const rest = value % 60;
        if (hours && rest)
            return `${hours} 小时 ${rest} 分钟`;
        if (hours)
            return `${hours} 小时`;
        return `${rest} 分钟`;
    }
    function normalizeNotificationTask(row) {
        const task = runtime.normalizeTaskRow(row);
        return {
            id: Number(row.id),
            title: task.title,
            dueDate: task.dueDate,
            dueTime: task.dueTime,
            urgency: task.urgency || 'medium',
            isCompleted: task.isCompleted,
            completedAt: task.completedAt || null,
            reminderEnabled: task.reminderEnabled,
            reminderSentOffsets: task.reminderSentOffsets,
            reminderLastSentAt: task.reminderLastSentAt || null,
            note: task.note || '',
        };
    }
    function notificationUrgencyLabel(urgency) {
        if (urgency === 'high')
            return '高';
        if (urgency === 'low')
            return '低';
        return '中';
    }
    function taskLetterLabel(index) {
        const value = Math.max(0, Number(index) || 0);
        return String.fromCharCode(65 + (value % 26));
    }
    function taskLabelIndex(value) {
        const text = String(value || '').trim();
        if (!/^[A-Z]$/i.test(text))
            return null;
        return text.toUpperCase().charCodeAt(0) - 65;
    }
    function formatNotificationTask(task, index = 0) {
        const prefix = index >= 0 ? `${taskLetterLabel(index)}. ` : '';
        const status = task.isCompleted ? '已完成' : task.dueDate < runtime.todayISO() ? '逾期' : '未完成';
        const due = task.dueTime ? `${task.dueDate} ${task.dueTime}` : task.dueDate;
        return `${prefix}${task.title}｜${due}｜${notificationUrgencyLabel(task.urgency)}｜${status}`;
    }
    function taskSearchPattern(keyword) {
        const cleaned = String(keyword || '').replace(/[%_]/g, '').trim().slice(0, 80);
        return cleaned ? `%${cleaned}%` : '';
    }
    function listNotificationTasks({ range = 'today', date = runtime.todayISO(), limit = 30 } = {}) {
        runtime.ensureSqliteStore();
        const endDate = range === 'week' ? runtime.endOfWeekISO(date) : date;
        return runtime.taskRepository.listOwnerDueThrough(endDate, limit).map(normalizeNotificationTask);
    }
    function listNotificationLabelTasks({ limit = 26 } = {}) {
        runtime.ensureSqliteStore();
        return runtime.taskRepository.listOwnerOpen(limit).map(normalizeNotificationTask);
    }
    function findNotificationTasks(keyword, { includeCompleted = false, limit = 6 } = {}) {
        runtime.ensureSqliteStore();
        const text = String(keyword || '').trim();
        if (!text)
            return [];
        const labelIndex = taskLabelIndex(text);
        if (labelIndex !== null) {
            const labeled = listNotificationLabelTasks({ limit: 26 })[labelIndex];
            return labeled ? [labeled] : [];
        }
        const id = text.match(/^#?(\d+)$/)?.[1];
        if (id) {
            const task = runtime.taskRepository.findOwnerById(Number(id), { includeCompleted });
            return task ? [normalizeNotificationTask(task)] : [];
        }
        const pattern = taskSearchPattern(text);
        if (!pattern)
            return [];
        return runtime.taskRepository.findOwnerByTitle(pattern, { includeCompleted, limit }).map(normalizeNotificationTask);
    }
    function buildNotificationTaskListReply(range, tasks) {
        const title = range === 'week' ? '本周未完成待办' : '今日未完成待办';
        if (!tasks.length)
            return `${title}：暂无。`;
        return `${title}：\n${tasks.map((task, index) => formatNotificationTask(task, index)).join('\n')}`;
    }
    function notificationSection(title, lines = []) {
        const items = lines.filter(Boolean);
        return items.length ? [`【${title}】`, ...items] : [];
    }
    function buildNotificationBriefReply(brief, notificationMetrics = { open: 0, warnings: 0, critical: 0 }) {
        if (!brief?.payload)
            return '简报：暂未生成。';
        const payload = brief.payload;
        const weather = payload.weather || {};
        const learning = payload.learning || {};
        const markets = Array.isArray(payload.markets) ? payload.markets : [];
        const indexPurchaseAssessment = payload.indexPurchaseAssessment || {};
        const customWeeklyPush = payload.customWeeklyPush || {};
        const englishWritingPlan = payload.englishWritingPlan || {};
        const tasks = Array.isArray(learning.todayTasks) ? learning.todayTasks : [];
        const weatherLine = weather.ok
            ? `${weather.cityName || ''}：${weather.condition || ''}，${weather.temperature ?? '--'}℃，${weather.minTemperature ?? '--'}-${weather.maxTemperature ?? '--'}℃，降水概率 ${weather.precipitationProbability ?? 0}%`
            : `天气获取失败：${weather.error || '未知错误'}`;
        const learningLines = [
            `昨日学习：${notificationMinutesText(learning.yesterdayMinutes || 0)}`,
            `近 7 天累计：${notificationMinutesText(learning.last7Minutes || 0)}`,
            learning.activeGoal ? `目标：${learning.activeGoal.name}，剩余 ${learning.activeGoal.daysLeft} 天` : '目标：暂无启用中的长期目标',
            learning.yesterdayReview?.problems ? `昨日问题：${runtime.compactText(learning.yesterdayReview.problems, 120)}` : '',
        ];
        const taskLines = tasks.length
            ? tasks.map((task, index) => `${taskLetterLabel(index)}. ${task.title}｜${task.dueTime ? `${task.dueDate} ${task.dueTime}` : task.dueDate}｜${notificationUrgencyLabel(task.urgency)}`)
            : ['今天没有到期待办。'];
        const marketLines = markets.length
            ? markets.map((item) => item.ok
                ? `- ${item.name}：${item.price}（${item.changePercent ?? 0}%）`
                : `- ${item.name}：更新失败 ${item.error || ''}`)
            : ['暂无指数配置。'];
        const assessmentLines = Array.isArray(indexPurchaseAssessment.items) && indexPurchaseAssessment.items.length
            ? indexPurchaseAssessment.items.map((item) => item.ok
                ? `- ${item.name}：${item.signal}｜PE ${item.pe}（5 年百分位 ${item.pePercentile5}% / 10 年 ${item.pePercentile10}%）｜距 50/200 日均线 ${item.sma50Margin}%/${item.sma200Margin}%｜${item.intensity}`
                : `- ${item.name}：评估失败 ${item.error || ''}`)
            : ['暂无定投评估数据。'];
        const notificationLines = notificationMetrics.open
            ? [`待处理 ${notificationMetrics.open} 条，其中 warning ${notificationMetrics.warnings}，critical ${notificationMetrics.critical}`]
            : ['暂无待处理通知。'];
        const englishPlanLines = englishWritingPlan.enabled && englishWritingPlan.includeInBrief
            ? [
                englishWritingPlan.currentStage ? `阶段：${englishWritingPlan.currentStage.name}${englishWritingPlan.currentStage.weeks ? `（${englishWritingPlan.currentStage.weeks}）` : ''}` : '',
                englishWritingPlan.currentStage?.focus ? `重点：${runtime.compactText(englishWritingPlan.currentStage.focus, 120)}` : '',
                `${englishWritingPlan.weekdayLabel || '今日'}任务：${englishWritingPlan.todayTask || '未设置固定写作任务'}`,
                `建议用时：${englishWritingPlan.dailyMinutes || '20-25 分钟'}`,
            ]
            : [];
        const lines = [
            `${payload.title}`,
            `生成时间：${new Date(payload.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
            '',
            ...notificationSection('天气', [weatherLine]),
            '',
            ...notificationSection('学习', learningLines),
            '',
            ...notificationSection('英语写作计划', englishPlanLines),
            englishPlanLines.length ? '' : '',
            ...notificationSection(customWeeklyPush.weekdayLabel ? `${customWeeklyPush.weekdayLabel}自定义推送` : '自定义推送', customWeeklyPush.hasContent ? String(customWeeklyPush.content || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : []),
            customWeeklyPush.hasContent ? '' : '',
            ...notificationSection('今日待办', taskLines),
            '',
            ...notificationSection('指数', marketLines),
            '',
            ...notificationSection('美股指数定投评估', [
                ...assessmentLines,
                indexPurchaseAssessment.disclaimer || '',
            ]),
            '',
            ...notificationSection('通知', notificationLines),
            '',
            '可回复：待办 明天 高 背单词 / 完成 背单词 / 今日待办 / 帮助',
        ];
        return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    function buildDailyNotificationDigest(date = runtime.todayISO()) {
        runtime.ensureSqliteStore();
        const taskList = listNotificationTasks({ range: 'today', date, limit: 8 });
        const latestBrief = runtime.getDailyBriefByDate(date) || runtime.getLatestDailyBriefSummary();
        const notificationMetrics = runtime.notificationRepository.metrics();
        let brief = latestBrief;
        if (brief?.payload && date === runtime.todayISO()) {
            brief = {
                ...brief,
                payload: {
                    ...brief.payload,
                    learning: {
                        ...(brief.payload.learning || {}),
                        todayTasks: taskList.map((task) => ({
                            id: task.id,
                            title: task.title,
                            dueDate: task.dueDate,
                            dueTime: task.dueTime,
                            urgency: task.urgency,
                            isCompleted: Boolean(task.isCompleted),
                        })),
                    },
                },
            };
        }
        const text = brief ? buildNotificationBriefReply(brief, notificationMetrics) : '简报：暂未生成。';
        return { date, text, tasks: taskList, notificationMetrics, brief };
    }
    function ambiguousNotificationReply(action, matches) {
        return `找到多个可${action}的待办，请说得更具体，或使用 #ID：\n${matches.map((task, index) => `#${task.id} ${formatNotificationTask(task, index)}`).join('\n')}`;
    }
    async function executeNotificationCommand(command, req) {
        if (command.type === 'help')
            return { ok: true, reply: runtime.notificationCommandHelpText, command };
        if (command.type === 'unknown')
            return { ok: false, reply: `${command.help}\n\n未识别原因：${command.reason}`, command };
        if (command.type === 'daily_digest') {
            const digest = buildDailyNotificationDigest(runtime.todayISO());
            return { ok: true, reply: digest.text, digest, command };
        }
        if (command.type === 'list_tasks') {
            const tasks = listNotificationTasks({ range: command.range, date: runtime.todayISO() });
            return { ok: true, reply: buildNotificationTaskListReply(command.range, tasks), tasks, command };
        }
        if (command.type === 'create_task') {
            const owner = runtime.userAccountRepository.getOwnerAccount();
            const id = runtime.learningRepository.forUser({
                userId: owner.userId,
                capabilities: owner.capabilities,
            }).saveTask({
                title: command.title,
                dueDate: command.dueDate,
                urgency: command.urgency,
                note: 'Created by Telegram command',
                isCompleted: false,
                dueTime: command.dueTime,
                reminderEnabled: Boolean(command.dueTime),
            });
            writeAuditEvent({ action: 'telegram_task_create', req, actorRole: 'telegram', detail: { id, dueDate: command.dueDate, dueTime: command.dueTime, urgency: command.urgency } });
            const due = command.dueTime ? `${command.dueDate} ${command.dueTime}` : command.dueDate;
            return {
                ok: true,
                reply: `已添加待办：#${id} ${command.title}｜${due}｜${notificationUrgencyLabel(command.urgency)}`,
                task: { id, title: command.title, dueDate: command.dueDate, dueTime: command.dueTime, urgency: command.urgency },
                command,
            };
        }
        if (command.type === 'complete_task') {
            const matches = findNotificationTasks(command.keyword);
            if (!matches.length)
                return { ok: false, reply: `没有找到未完成待办：${command.keyword}`, command };
            if (matches.length > 1)
                return { ok: false, reply: ambiguousNotificationReply('完成', matches), matches, command };
            const task = matches[0];
            const timestamp = runtime.nowISO();
            runtime.taskRepository.completeOwnerTask(task.id, timestamp);
            runtime.tableChanged();
            writeAuditEvent({ action: 'telegram_task_complete', req, actorRole: 'telegram', detail: { id: task.id } });
            return { ok: true, reply: `已完成待办：#${task.id} ${task.title}`, task: { ...task, isCompleted: true, completedAt: timestamp }, command };
        }
        if (command.type === 'delete_task') {
            const matches = findNotificationTasks(command.keyword, { includeCompleted: true });
            if (!matches.length)
                return { ok: false, reply: `没有找到待办：${command.keyword}`, command };
            if (matches.length > 1)
                return { ok: false, reply: ambiguousNotificationReply('删除', matches), matches, command };
            const task = matches[0];
            runtime.taskRepository.deleteOwnerTask(task.id);
            runtime.tableChanged();
            writeAuditEvent({ action: 'telegram_task_delete', req, actorRole: 'telegram', detail: { id: task.id } });
            return { ok: true, reply: `已删除待办：#${task.id} ${task.title}`, task, command };
        }
        return { ok: false, reply: runtime.notificationCommandHelpText, command };
    }
    exposeRuntime({
        activeTaskLocks: () => activeTaskLocks,
        lastTaskRuns: () => lastTaskRuns,
        runExclusiveTask: () => runExclusiveTask,
        logStructured: () => logStructured,
        writeAuditEvent: () => writeAuditEvent,
        writeApiRequestLog: () => writeApiRequestLog,
        writeClientErrorLog: () => writeClientErrorLog,
        normalizeCommandDate: () => normalizeCommandDate,
        notificationMinutesText: () => notificationMinutesText,
        normalizeNotificationTask: () => normalizeNotificationTask,
        notificationUrgencyLabel: () => notificationUrgencyLabel,
        taskLetterLabel: () => taskLetterLabel,
        taskLabelIndex: () => taskLabelIndex,
        formatNotificationTask: () => formatNotificationTask,
        taskSearchPattern: () => taskSearchPattern,
        listNotificationTasks: () => listNotificationTasks,
        listNotificationLabelTasks: () => listNotificationLabelTasks,
        findNotificationTasks: () => findNotificationTasks,
        buildNotificationTaskListReply: () => buildNotificationTaskListReply,
        notificationSection: () => notificationSection,
        buildNotificationBriefReply: () => buildNotificationBriefReply,
        buildDailyNotificationDigest: () => buildDailyNotificationDigest,
        ambiguousNotificationReply: () => ambiguousNotificationReply,
        executeNotificationCommand: () => executeNotificationCommand,
    });
}
