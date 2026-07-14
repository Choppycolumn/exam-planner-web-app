import { exposeRuntime, runtime } from '../runtime-context.mjs';

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
        runtime.runSqlite(`INSERT INTO audit_events (action, actor_role, client_hash, detail_json, created_at)
VALUES (${runtime.sqlString(action)}, ${runtime.sqlString(actorRole || (req ? runtime.getSessionRole(req.headers.cookie) || '' : 'system'))}, ${runtime.sqlString(req ? runtime.clientHashForRequest(req) : 'system')}, ${runtime.sqlString(JSON.stringify(detail || {}))}, ${runtime.sqlString(runtime.nowISO())});`);
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
        runtime.runSqlite(`INSERT INTO api_request_log (method, path, status_code, duration_ms, role, error, created_at)
VALUES (${runtime.sqlString(req.method || 'GET')}, ${runtime.sqlString(pathname)}, ${runtime.sqlValue(statusCode)}, ${runtime.sqlValue(Math.round(durationMs))}, ${runtime.sqlString(role || '')}, ${runtime.sqlString(runtime.redactSecretText(error))}, ${runtime.sqlString(runtime.nowISO())});`);
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
        const id = Number(runtime.sqliteScalar(`INSERT INTO client_error_log (source, path, message, stack, component_stack, role, client_hash, user_agent, created_at)
VALUES (${runtime.sqlString(payload.source)}, ${runtime.sqlString(payload.path)}, ${runtime.sqlString(payload.message)}, ${runtime.sqlString(payload.stack)}, ${runtime.sqlString(payload.componentStack)}, ${runtime.sqlString(role || '')}, ${runtime.sqlString(runtime.clientHashForRequest(req))}, ${runtime.sqlString(payload.userAgent)}, ${runtime.sqlString(payload.createdAt)})
RETURNING id;`) || 0);
        return { id, ...payload };
    }
    catch (error) {
        logStructured('warn', 'client_error_log_failed', { error: runtime.redactSecretText(error.message || String(error)) });
        return null;
    }
}
const activeTaskLocks = new Set();
function lastTaskRuns(limit = 12) {
    try {
        return runtime.taskRunsRepository.listLatest(limit);
    }
    catch {
        return [];
    }
}
async function runExclusiveTask(taskName, trigger, taskFn, { timeoutMs = 15 * 60 * 1000, metadata = {} } = {}) {
    runtime.ensureSqliteStore();
    if (activeTaskLocks.has(taskName)) {
        return { ok: false, skipped: true, reason: 'already running', taskName };
    }
    activeTaskLocks.add(taskName);
    const startedAt = runtime.nowISO();
    const startedMs = Date.now();
    const taskId = Number(runtime.sqliteScalar(`INSERT INTO task_runs (task_name, trigger, status, started_at, metadata_json)
VALUES (${runtime.sqlString(taskName)}, ${runtime.sqlString(trigger)}, 'running', ${runtime.sqlString(startedAt)}, ${runtime.sqlString(JSON.stringify(metadata || {}))})
RETURNING id;`) || 0);
    let timeoutId;
    try {
        const timeout = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(`${taskName} timed out after ${timeoutMs}ms`)), timeoutMs);
            timeoutId.unref?.();
        });
        const result = await Promise.race([Promise.resolve().then(taskFn), timeout]);
        const durationMs = Date.now() - startedMs;
        runtime.runSqlite(`UPDATE task_runs SET status = 'completed', finished_at = ${runtime.sqlString(runtime.nowISO())}, duration_ms = ${runtime.sqlValue(durationMs)}, metadata_json = ${runtime.sqlString(JSON.stringify({ ...(metadata || {}), result: result ?? null }))}
WHERE id = ${runtime.sqlValue(taskId)};`);
        return { ok: true, taskName, taskId, durationMs, result };
    }
    catch (error) {
        const durationMs = Date.now() - startedMs;
        const message = runtime.redactSecretText(error.message || String(error));
        runtime.runSqlite(`UPDATE task_runs SET status = 'failed', finished_at = ${runtime.sqlString(runtime.nowISO())}, duration_ms = ${runtime.sqlValue(durationMs)}, error = ${runtime.sqlString(message)}
WHERE id = ${runtime.sqlValue(taskId)};`);
        throw error;
    }
    finally {
        if (timeoutId)
            clearTimeout(timeoutId);
        activeTaskLocks.delete(taskName);
    }
}
function clawbotRequestSecret(req, requestUrl, body = {}) {
    const auth = runtime.headerString(req, 'authorization');
    const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    return String(runtime.headerString(req, 'x-clawbot-secret') ||
        bearer ||
        requestUrl.searchParams.get('secret') ||
        (runtime.isObjectPayload(body) ? body.secret || body.token : '') ||
        '').trim();
}
function validateClawbotAccess(req, requestUrl, body = {}) {
    if (!runtime.clawbotSecret) {
        return { ok: false, status: 503, error: 'ClawBot adapter is disabled. Set CLAWBOT_SECRET first.' };
    }
    if (!runtime.safeSecretEqual(clawbotRequestSecret(req, requestUrl, body), runtime.clawbotSecret)) {
        return { ok: false, status: 401, error: 'Unauthorized' };
    }
    return { ok: true };
}
function extractClawbotMessage(body, requestUrl) {
    const queryMessage = requestUrl.searchParams.get('text') || requestUrl.searchParams.get('message') || '';
    if (queryMessage)
        return queryMessage;
    if (typeof body === 'string')
        return body;
    if (!runtime.isObjectPayload(body))
        return '';
    for (const key of ['text', 'content', 'message', 'msg', 'rawMessage']) {
        if (typeof body[key] === 'string' && body[key].trim())
            return body[key];
    }
    for (const key of ['data', 'event', 'payload']) {
        const nested = body[key];
        if (!runtime.isObjectPayload(nested))
            continue;
        for (const nestedKey of ['text', 'content', 'message', 'msg', 'rawMessage']) {
            if (typeof nested[nestedKey] === 'string' && nested[nestedKey].trim())
                return nested[nestedKey];
        }
    }
    return '';
}
function normalizeClawbotDate(value) {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : runtime.todayISO();
}
function clawbotMinutesText(minutes) {
    const value = Math.max(0, Number(minutes || 0));
    const hours = Math.floor(value / 60);
    const rest = value % 60;
    if (hours && rest)
        return `${hours} 小时 ${rest} 分钟`;
    if (hours)
        return `${hours} 小时`;
    return `${rest} 分钟`;
}
function normalizeClawbotTask(row) {
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
function clawbotUrgencyLabel(urgency) {
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
function formatClawbotTask(task, index = 0) {
    const prefix = index >= 0 ? `${taskLetterLabel(index)}. ` : '';
    const status = task.isCompleted ? '已完成' : task.dueDate < runtime.todayISO() ? '逾期' : '未完成';
    const due = task.dueTime ? `${task.dueDate} ${task.dueTime}` : task.dueDate;
    return `${prefix}${task.title}｜${due}｜${clawbotUrgencyLabel(task.urgency)}｜${status}`;
}
function taskSearchPattern(keyword) {
    const cleaned = String(keyword || '').replace(/[%_]/g, '').trim().slice(0, 80);
    return cleaned ? `%${cleaned}%` : '';
}
function listClawbotTasks({ range = 'today', date = runtime.todayISO(), limit = 30 } = {}) {
    runtime.ensureSqliteStore();
    const endDate = range === 'week' ? runtime.endOfWeekISO(date) : date;
    return runtime.sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency, is_completed AS isCompleted,
completed_at AS completedAt, reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt, note
FROM short_term_tasks
WHERE user_id = 1 AND is_completed = 0 AND due_date <= ${runtime.sqlString(endDate)}
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date, due_time, id
LIMIT ${Math.max(1, Math.min(50, Number(limit) || 30))};`).map(normalizeClawbotTask);
}
function listClawbotLabelTasks({ limit = 26 } = {}) {
    runtime.ensureSqliteStore();
    return runtime.sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency, is_completed AS isCompleted,
completed_at AS completedAt, reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt, note
FROM short_term_tasks
WHERE user_id = 1 AND is_completed = 0
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date, due_time, id
LIMIT ${Math.max(1, Math.min(26, Number(limit) || 26))};`).map(normalizeClawbotTask);
}
function findClawbotTasks(keyword, { includeCompleted = false, limit = 6 } = {}) {
    runtime.ensureSqliteStore();
    const text = String(keyword || '').trim();
    if (!text)
        return [];
    const statusClause = includeCompleted ? '' : 'AND is_completed = 0';
    const labelIndex = taskLabelIndex(text);
    if (labelIndex !== null) {
        const labeled = listClawbotLabelTasks({ limit: 26 })[labelIndex];
        return labeled ? [labeled] : [];
    }
    const id = text.match(/^#?(\d+)$/)?.[1];
    if (id) {
        return runtime.sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency, is_completed AS isCompleted,
completed_at AS completedAt, reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt, note
FROM short_term_tasks
WHERE user_id = 1 AND id = ${runtime.sqlValue(Number(id))} ${statusClause}
LIMIT 1;`).map(normalizeClawbotTask);
    }
    const pattern = taskSearchPattern(text);
    if (!pattern)
        return [];
    return runtime.sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency, is_completed AS isCompleted,
completed_at AS completedAt, reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt, note
FROM short_term_tasks
WHERE user_id = 1 AND title LIKE ${runtime.sqlString(pattern)} ${statusClause}
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date, due_time, id
LIMIT ${Math.max(1, Math.min(20, Number(limit) || 6))};`).map(normalizeClawbotTask);
}
function buildClawbotTaskListReply(range, tasks) {
    const title = range === 'week' ? '本周未完成待办' : '今日未完成待办';
    if (!tasks.length)
        return `${title}：暂无。`;
    return `${title}：\n${tasks.map((task, index) => formatClawbotTask(task, index)).join('\n')}`;
}
function clawbotSection(title, lines = []) {
    const items = lines.filter(Boolean);
    return items.length ? [`【${title}】`, ...items] : [];
}
function buildClawbotBriefReply(brief, notificationMetrics = { open: 0, warnings: 0, critical: 0 }) {
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
        `昨日学习：${clawbotMinutesText(learning.yesterdayMinutes || 0)}`,
        `近 7 天累计：${clawbotMinutesText(learning.last7Minutes || 0)}`,
        learning.activeGoal ? `目标：${learning.activeGoal.name}，剩余 ${learning.activeGoal.daysLeft} 天` : '目标：暂无启用中的长期目标',
        learning.yesterdayReview?.problems ? `昨日问题：${runtime.compactText(learning.yesterdayReview.problems, 120)}` : '',
    ];
    const taskLines = tasks.length
        ? tasks.map((task, index) => `${taskLetterLabel(index)}. ${task.title}｜${task.dueTime ? `${task.dueDate} ${task.dueTime}` : task.dueDate}｜${clawbotUrgencyLabel(task.urgency)}`)
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
        ...clawbotSection('天气', [weatherLine]),
        '',
        ...clawbotSection('学习', learningLines),
        '',
        ...clawbotSection('英语写作计划', englishPlanLines),
        englishPlanLines.length ? '' : '',
        ...clawbotSection(customWeeklyPush.weekdayLabel ? `${customWeeklyPush.weekdayLabel}自定义推送` : '自定义推送', customWeeklyPush.hasContent ? String(customWeeklyPush.content || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : []),
        customWeeklyPush.hasContent ? '' : '',
        ...clawbotSection('今日待办', taskLines),
        '',
        ...clawbotSection('指数', marketLines),
        '',
        ...clawbotSection('美股指数定投评估', [
            ...assessmentLines,
            indexPurchaseAssessment.disclaimer || '',
        ]),
        '',
        ...clawbotSection('通知', notificationLines),
        '',
        '可回复：待办 明天 高 背单词 / 完成 背单词 / 今日待办 / 帮助',
    ];
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function buildClawbotDailyDigest(date = runtime.todayISO()) {
    runtime.ensureSqliteStore();
    const taskList = listClawbotTasks({ range: 'today', date, limit: 8 });
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
    const text = brief ? buildClawbotBriefReply(brief, notificationMetrics) : '简报：暂未生成。';
    return { date, text, tasks: taskList, notificationMetrics, brief };
}
function ambiguousClawbotReply(action, matches) {
    return `找到多个可${action}的待办，请说得更具体，或使用 #ID：\n${matches.map((task, index) => `#${task.id} ${formatClawbotTask(task, index)}`).join('\n')}`;
}
async function executeClawbotCommand(command, req) {
    if (command.type === 'help')
        return { ok: true, reply: runtime.clawbotHelpText, command };
    if (command.type === 'unknown')
        return { ok: false, reply: `${command.help}\n\n未识别原因：${command.reason}`, command };
    if (command.type === 'daily_digest') {
        const digest = buildClawbotDailyDigest(runtime.todayISO());
        return { ok: true, reply: digest.text, digest, command };
    }
    if (command.type === 'list_tasks') {
        const tasks = listClawbotTasks({ range: command.range, date: runtime.todayISO() });
        return { ok: true, reply: buildClawbotTaskListReply(command.range, tasks), tasks, command };
    }
    if (command.type === 'create_task') {
        const id = runtime.saveTaskSql({
            title: command.title,
            dueDate: command.dueDate,
            urgency: command.urgency,
            note: 'Created by ClawBot rule command',
            isCompleted: false,
            dueTime: command.dueTime,
            reminderEnabled: Boolean(command.dueTime),
        });
        writeAuditEvent({ action: 'clawbot_task_create', req, actorRole: 'clawbot', detail: { id, dueDate: command.dueDate, dueTime: command.dueTime, urgency: command.urgency } });
        const due = command.dueTime ? `${command.dueDate} ${command.dueTime}` : command.dueDate;
        return {
            ok: true,
            reply: `已添加待办：#${id} ${command.title}｜${due}｜${clawbotUrgencyLabel(command.urgency)}`,
            task: { id, title: command.title, dueDate: command.dueDate, dueTime: command.dueTime, urgency: command.urgency },
            command,
        };
    }
    if (command.type === 'complete_task') {
        const matches = findClawbotTasks(command.keyword);
        if (!matches.length)
            return { ok: false, reply: `没有找到未完成待办：${command.keyword}`, command };
        if (matches.length > 1)
            return { ok: false, reply: ambiguousClawbotReply('完成', matches), matches, command };
        const task = matches[0];
        const timestamp = runtime.nowISO();
        runtime.runSqlite(`UPDATE short_term_tasks
SET is_completed = 1, completed_at = ${runtime.sqlString(timestamp)}, updated_at = ${runtime.sqlString(timestamp)}
WHERE id = ${runtime.sqlValue(task.id)} AND user_id = 1;`);
        runtime.tableChanged();
        writeAuditEvent({ action: 'clawbot_task_complete', req, actorRole: 'clawbot', detail: { id: task.id } });
        return { ok: true, reply: `已完成待办：#${task.id} ${task.title}`, task: { ...task, isCompleted: true, completedAt: timestamp }, command };
    }
    if (command.type === 'delete_task') {
        const matches = findClawbotTasks(command.keyword, { includeCompleted: true });
        if (!matches.length)
            return { ok: false, reply: `没有找到待办：${command.keyword}`, command };
        if (matches.length > 1)
            return { ok: false, reply: ambiguousClawbotReply('删除', matches), matches, command };
        const task = matches[0];
        runtime.runSqlite(`DELETE FROM short_term_tasks WHERE id = ${runtime.sqlValue(task.id)} AND user_id = 1;`);
        runtime.tableChanged();
        writeAuditEvent({ action: 'clawbot_task_delete', req, actorRole: 'clawbot', detail: { id: task.id } });
        return { ok: true, reply: `已删除待办：#${task.id} ${task.title}`, task, command };
    }
    return { ok: false, reply: runtime.clawbotHelpText, command };
}
function readJsonFileSafe(filePath, fallback = null) {
    try {
        if (!filePath || !runtime.existsSync(filePath))
            return fallback;
        return JSON.parse(runtime.readFileSync(filePath, 'utf8'));
    }
    catch {
        return fallback;
    }
}
function findNestedStringByKey(value, preferredKeys) {
    if (!value || typeof value !== 'object')
        return '';
    const normalizedKeys = new Set(preferredKeys.map((key) => key.toLowerCase()));
    for (const [key, nested] of Object.entries(value)) {
        if (normalizedKeys.has(key.toLowerCase()) && typeof nested === 'string' && nested.trim()) {
            return nested.trim();
        }
    }
    for (const nested of Object.values(value)) {
        if (nested && typeof nested === 'object') {
            const result = findNestedStringByKey(nested, preferredKeys);
            if (result)
                return result;
        }
    }
    return '';
}
function detectOpenClawAccountId() {
    if (runtime.openClawAccountId)
        return runtime.openClawAccountId;
    try {
        if (!runtime.existsSync(runtime.openClawAccountDir))
            return '';
        const files = runtime.readdirSync(runtime.openClawAccountDir)
            .filter((file) => file.endsWith('.json') && !file.includes('context-token'))
            .sort((left, right) => Number(right.includes('-im-bot')) - Number(left.includes('-im-bot')) || left.localeCompare(right));
        return files[0]?.replace(/\.json$/i, '') || '';
    }
    catch {
        return '';
    }
}
function resolveOpenClawWechatConfig({ includeSecret = false } = {}) {
    if (runtime.privilegedClient && runtime.existsSync(runtime.privilegedHelperSocket)) {
        return {
            enabled: Boolean(runtime.getDailyBriefSettings({ includeSecret: true }).wechat.enabled),
            configured: true,
            channel: runtime.openClawChannel,
            accountId: 'managed-by-helper',
            accountDirExists: true,
            accountFileExists: true,
            targetConfigured: true,
            hasContextToken: true,
            cli: 'privileged-helper',
            nextPushAt: runtime.nextDailyBriefAt,
            scheduleTime: runtime.getDailyBriefSettings({ includeSecret: true }).generateTime,
            ...(includeSecret ? { target: '', contextToken: '', accountToken: '', baseUrl: '' } : {}),
        };
    }
    const accountId = detectOpenClawAccountId();
    const accountPath = accountId ? runtime.join(runtime.openClawAccountDir, `${accountId}.json`) : '';
    const contextPath = accountId ? runtime.join(runtime.openClawAccountDir, `${accountId}.context-tokens.json`) : '';
    const account = readJsonFileSafe(accountPath, {});
    const contextTokens = readJsonFileSafe(contextPath, {});
    const contextKeys = contextTokens && typeof contextTokens === 'object' && !Array.isArray(contextTokens) ? Object.keys(contextTokens) : [];
    const target = runtime.openClawTarget || contextKeys.find((key) => key && !key.startsWith('_'))
        || findNestedStringByKey(account, ['userId', 'wxid', 'openId', 'openid', 'target', 'fromUserName', 'userName', 'username']) || '';
    const contextEntry = target && runtime.isObjectPayload(contextTokens) ? contextTokens[target] : null;
    const contextToken = (typeof contextEntry === 'string' ? contextEntry : '')
        || findNestedStringByKey(contextEntry, ['contextToken', 'token'])
        || findNestedStringByKey(contextTokens, ['contextToken']);
    const status = {
        enabled: Boolean(runtime.getDailyBriefSettings({ includeSecret: true }).wechat.enabled),
        configured: Boolean(accountId && target && contextToken),
        channel: runtime.openClawChannel,
        accountId,
        accountDirExists: runtime.existsSync(runtime.openClawAccountDir),
        accountFileExists: Boolean(accountPath && runtime.existsSync(accountPath)),
        targetConfigured: Boolean(target),
        hasContextToken: Boolean(contextToken),
        cli: runtime.openClawCli,
        nextPushAt: runtime.nextDailyBriefAt,
        scheduleTime: runtime.getDailyBriefSettings({ includeSecret: true }).generateTime,
    };
    return includeSecret ? {
        ...status,
        target,
        contextToken,
        accountToken: account.token || '',
        baseUrl: account.baseUrl || 'https://ilinkai.weixin.qq.com',
    } : status;
}
let openClawWeixinSendModulePath = '';
function detectOpenClawWeixinSendModulePath() {
    if (openClawWeixinSendModulePath && runtime.existsSync(openClawWeixinSendModulePath))
        return openClawWeixinSendModulePath;
    if (!runtime.existsSync(runtime.openClawNpmProjectsDir))
        return '';
    for (const project of runtime.readdirSync(runtime.openClawNpmProjectsDir)) {
        const candidate = runtime.join(runtime.openClawNpmProjectsDir, project, 'node_modules', '@tencent-weixin', 'openclaw-weixin', 'dist', 'src', 'messaging', 'send.js');
        if (runtime.existsSync(candidate)) {
            openClawWeixinSendModulePath = candidate;
            return candidate;
        }
    }
    return '';
}
async function sendOpenClawWechatDirect(config, text) {
    const modulePath = detectOpenClawWeixinSendModulePath();
    if (!modulePath || !config.accountToken)
        throw new Error('OpenClaw Weixin direct sender is unavailable');
    return new Promise((resolveSend, rejectSend) => {
        const child = runtime.spawn('/opt/node22/bin/node', [runtime.openClawWeixinSenderFile], {
            detached: process.platform !== 'win32',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (error, result = null) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (error)
                rejectSend(error);
            else
                resolveSend(result);
        };
        const timer = setTimeout(() => {
            try {
                if (process.platform !== 'win32' && child.pid)
                    process.kill(-child.pid, 'SIGKILL');
                else
                    child.kill('SIGKILL');
            }
            catch {
                child.kill('SIGKILL');
            }
            finish(new Error('OpenClaw Weixin direct sender timed out'));
        }, 25000);
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
            if (stdout.length > 64 * 1024)
                stdout = stdout.slice(-64 * 1024);
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
            if (stderr.length > 64 * 1024)
                stderr = stderr.slice(-64 * 1024);
        });
        child.on('error', (error) => finish(error));
        child.on('close', (code) => {
            if (code !== 0) {
                finish(new Error(runtime.redactSecretText(stderr || stdout || `direct sender exited with code ${code}`)));
                return;
            }
            try {
                finish(null, JSON.parse(stdout || '{}'));
            }
            catch {
                finish(new Error('OpenClaw Weixin direct sender returned invalid JSON'));
            }
        });
        child.stdin.end(JSON.stringify({
            modulePath,
            to: config.target,
            text: String(text || '').slice(0, 3500),
            baseUrl: config.baseUrl,
            token: config.accountToken,
            contextToken: config.contextToken,
        }));
    });
}
function runOpenClawCli(args, { timeoutMs = 15000 } = {}) {
    return new Promise((resolveCli) => {
        const child = runtime.spawn(runtime.openClawCli, args, {
            env: {
                ...process.env,
                PATH: `/opt/node22/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
            },
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolveCli({
                ...result,
                stdout: runtime.redactSecretText(stdout).slice(0, 2000),
                stderr: runtime.redactSecretText(stderr).slice(0, 2000),
            });
        };
        const timer = setTimeout(() => {
            try {
                if (process.platform !== 'win32' && child.pid)
                    process.kill(-child.pid, 'SIGKILL');
                else
                    child.kill('SIGKILL');
            }
            catch {
                child.kill('SIGKILL');
            }
            finish({ ok: false, code: -1, error: 'openclaw message send timed out' });
        }, timeoutMs);
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
            if (stdout.length > 1024 * 1024)
                stdout = stdout.slice(-1024 * 1024);
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
            if (stderr.length > 1024 * 1024)
                stderr = stderr.slice(-1024 * 1024);
        });
        child.on('error', (error) => finish({ ok: false, code: -1, error: runtime.redactSecretText(error.message || String(error)) }));
        child.on('close', (code) => finish({ ok: code === 0, code, error: code === 0 ? '' : runtime.redactSecretText(stderr || stdout || `openclaw exited with code ${code}`) }));
    });
}
async function sendOpenClawWechatMessage(text) {
    if (runtime.privilegedClient && runtime.existsSync(runtime.privilegedHelperSocket)) {
        try {
            return await runtime.privilegedClient.wechatSend(text);
        }
        catch (error) {
            return { ok: false, method: 'openclaw-weixin-privileged', error: runtime.redactSecretText(error.message || String(error)) };
        }
    }
    const config = resolveOpenClawWechatConfig({ includeSecret: true });
    if (!config.configured) {
        return {
            ok: false,
            method: 'openclaw-weixin',
            error: 'OpenClaw Weixin account, target or context token is not available',
            status: {
                accountId: config.accountId,
                accountDirExists: config.accountDirExists,
                accountFileExists: config.accountFileExists,
                targetConfigured: config.targetConfigured,
                hasContextToken: config.hasContextToken,
            },
        };
    }
    try {
        const result = await sendOpenClawWechatDirect(config, text);
        return {
            ok: true,
            method: 'openclaw-weixin-direct',
            channel: config.channel,
            accountId: config.accountId,
            messageId: result?.messageId || null,
            response: {
                action: 'send',
                channel: config.channel,
                dryRun: false,
                handledBy: 'openclaw-weixin-plugin',
                messageId: result?.messageId || null,
            },
            error: '',
        };
    }
    catch (error) {
        return {
            ok: false,
            method: 'openclaw-weixin-direct',
            channel: config.channel,
            accountId: config.accountId,
            messageId: null,
            response: null,
            error: runtime.redactSecretText(error.message || String(error)),
        };
    }
}
async function sendProactiveClawbotText(text) {
    const openClawStatus = resolveOpenClawWechatConfig({ includeSecret: true });
    if (openClawStatus.configured)
        return sendOpenClawWechatMessage(text);
    if (runtime.clawbotWebhookUrl)
        return postClawbotWebhook(text);
    return { ok: false, method: 'none', error: 'No ClawBot push channel is configured', status: resolveOpenClawWechatConfig() };
}
function resolveBarkConfig({ includeSecret = false } = {}) {
    const rawServerUrl = String(process.env.BARK_SERVER_URL || 'https://api.day.app').trim().replace(/\/+$/, '');
    const serverUrl = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(rawServerUrl) ? rawServerUrl : 'https://api.day.app';
    const deviceKey = String(process.env.BARK_DEVICE_KEY || '').trim();
    return {
        enabled: Boolean(deviceKey),
        configured: Boolean(deviceKey),
        serverUrl,
        deviceKeyMasked: deviceKey ? `${deviceKey.slice(0, 4)}...${deviceKey.slice(-4)}` : '',
        ...(includeSecret ? { deviceKey } : {}),
    };
}
function barkLevel({ source = '', severity = 'info' } = {}) {
    if (severity === 'critical')
        return 'critical';
    if (source === 'task' || source === 'ops' || severity === 'warning')
        return 'timeSensitive';
    if (source === 'brief' || source === 'report')
        return 'passive';
    return 'active';
}
async function sendBarkNotification(text, delivery) {
    const config = resolveBarkConfig({ includeSecret: true });
    if (!config.configured)
        return { ok: false, method: 'bark', error: 'Bark is not configured' };
    const payload = delivery?.payload || {};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch(`${config.serverUrl}/push`, {
            method: 'POST',
            headers: { 'content-type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
                device_key: config.deviceKey,
                title: String(payload.title || 'Exam Planner').slice(0, 120),
                body: String(text || payload.content || '').slice(0, 4000),
                group: `exam-planner-${String(payload.source || 'system').slice(0, 40)}`,
                level: barkLevel(payload),
                isArchive: '1',
            }),
            signal: controller.signal,
        });
        const responseText = await response.text();
        let responseJson = {};
        try {
            responseJson = responseText ? JSON.parse(responseText) : {};
        }
        catch {
            responseJson = {};
        }
        if (!response.ok || (responseJson.code && Number(responseJson.code) !== 200)) {
            throw new Error(`Bark HTTP ${response.status}: ${String(responseJson.message || responseText).slice(0, 200)}`);
        }
        return { ok: true, method: 'bark', channel: 'bark_default', response: { code: responseJson.code || response.status } };
    }
    catch (error) {
        return { ok: false, method: 'bark', channel: 'bark_default', error: runtime.redactSecretText(error.message || String(error)) };
    }
    finally {
        clearTimeout(timer);
    }
}
function applyTelegramProcessEnv(config) {
    Object.entries(config).forEach(([key, value]) => {
        if (value)
            process.env[key] = value;
        else
            delete process.env[key];
    });
}
async function telegramApi(method, body = {}, { config = runtime.readTelegramConfig(runtime.telegramEnvFile), timeoutMs = 15000 } = {}) {
    if (!config.TELEGRAM_BOT_TOKEN)
        throw new Error('Telegram Bot Token is not configured');
    const { ProxyAgent } = runtime.require('undici');
    const dispatcher = new ProxyAgent(runtime.mihomoProxyUrl);
    const response = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: 'POST',
        dispatcher,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false)
        throw new Error(`Telegram ${method} failed: ${payload.description || response.status}`);
    return payload.result;
}
async function sendTelegramMessage(text, { chatId, replyMarkup, disableNotification = false } = {}) {
    const config = runtime.readTelegramConfig(runtime.telegramEnvFile);
    const targetChatId = String(chatId || config.TELEGRAM_CHAT_ID || '');
    if (!targetChatId)
        throw new Error('Telegram Chat ID is not configured');
    return telegramApi('sendMessage', {
        chat_id: targetChatId,
        text: String(text || '').slice(0, 4096),
        disable_notification: disableNotification,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }, { config });
}
async function sendTelegramNotification(text, delivery) {
    try {
        await sendTelegramMessage(text, { disableNotification: delivery?.payload?.severity === 'info' });
        return { ok: true, method: 'telegram', channel: 'telegram_default' };
    }
    catch (error) {
        return { ok: false, method: 'telegram', channel: 'telegram_default', error: runtime.redactSecretText(error.message || String(error)) };
    }
}
async function sendProactiveNotification(text, delivery) {
    const plan = runtime.resolveProactiveDispatch(delivery, runtime.notificationRepository.listChannels(), process.env);
    if (plan.kind === 'bark')
        return sendBarkNotification(text, delivery);
    if (plan.kind === 'telegram')
        return sendTelegramNotification(text, delivery);
    if (plan.kind === 'clawbot_weixin') {
        if (runtime.isWechatQuietHours()) {
            return { ok: false, deferred: true, nextAttemptAt: runtime.nextWechatActiveAt(), method: 'clawbot-weixin', channel: plan.channelKey, error: 'wechat quiet hours' };
        }
        return sendProactiveClawbotText(text);
    }
    return { ok: false, method: plan.kind, channel: plan.channelKey, error: `Unsupported notification channel: ${plan.type || plan.channelKey}` };
}
function queueProactiveNotification({ eventKey, source, severity = 'info', title, content, text, payload = {}, channelKeys = null }) {
    const telegramReady = runtime.telegramConfigStatus(runtime.readTelegramConfig(runtime.telegramEnvFile)).configured;
    const wechatAvailableNow = !runtime.isWechatQuietHours();
    const channels = channelKeys || [
        ...(wechatAvailableNow ? ['clawbot_weixin'] : []),
        ...(resolveBarkConfig().configured ? ['bark_default'] : []),
        ...(telegramReady ? ['telegram_default'] : []),
    ];
    if (!channels.length) {
        runtime.notifyEvent({
            eventKey,
            source,
            severity,
            title,
            content,
            payload: { ...payload, notificationMode: 'in_app_fallback', reason: 'wechat_quiet_hours' },
        });
        return { ok: true, queued: false, mode: 'in_app', deliveryId: null, deliveries: [], status: 'suppressed' };
    }
    const deliveries = channels.map((channelKey) => runtime.notificationQueue.enqueueProactive({
        eventKey,
        source,
        severity,
        title,
        content,
        text,
        payload,
        channelKey,
    }));
    setImmediate(() => runtime.notificationQueue.processDue().catch((error) => {
        logStructured('warn', 'notification_queue_kick_failed', { error: runtime.redactSecretText(error.message || String(error)) });
    }));
    return {
        ok: true,
        queued: true,
        mode: 'proactive',
        deliveryId: deliveries[0]?.id || null,
        deliveries: deliveries.map((delivery) => ({ id: delivery.id, channelKey: delivery.channelKey, status: delivery.status })),
        status: deliveries[0]?.status || 'queued',
    };
}
function scheduleNotificationQueue() {
    const scan = () => runtime.notificationQueue.processDue().catch((error) => {
        logStructured('warn', 'notification_queue_scan_failed', { error: runtime.redactSecretText(error.message || String(error)) });
    });
    runtime.notificationQueueTimer = runtime.scheduler.scheduleInterval(
        'notification-queue',
        30 * 1000,
        scan,
        { initialDelayMs: 0 },
    );
}
async function postClawbotWebhook(text) {
    if (!runtime.clawbotWebhookUrl) {
        return { ok: false, error: 'CLAWBOT_WEBHOOK_URL is not configured' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(runtime.clawbotWebhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                source: 'exam-planner-clawbot',
                text,
                content: text,
                message: text,
            }),
            signal: controller.signal,
        });
        const responseText = await response.text();
        if (!response.ok)
            throw new Error(`Webhook returned ${response.status}: ${responseText.slice(0, 300)}`);
        return { ok: true, status: response.status, response: responseText.slice(0, 500) };
    }
    catch (error) {
        return { ok: false, error: runtime.redactSecretText(error.message || String(error)) };
    }
    finally {
        clearTimeout(timer);
    }
}
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
    const tasks = listClawbotLabelTasks({ limit: 26 });
    const index = tasks.findIndex((task) => Number(task.id) === Number(taskId));
    if (index >= 0)
        return { label: taskLetterLabel(index), command: `完成${taskLetterLabel(index)}` };
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
        `优先级：${clawbotUrgencyLabel(task.urgency)}`,
        `提醒：提前 ${formatReminderLead(offsetMinutes)}，距离开始约 ${formatReminderLead(remaining)}`,
        '',
        `可回复：${hint.command} / 今日待办`,
    ].join('\n');
}
function listTimedReminderTasks(scanDate) {
    const maxForwardDays = 35;
    return runtime.sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency, is_completed AS isCompleted,
completed_at AS completedAt, reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt, note
FROM short_term_tasks
WHERE user_id = 1 AND is_completed = 0
  AND reminder_enabled = 1
  AND due_time <> ''
  AND due_date >= ${runtime.sqlString(scanDate)}
  AND due_date <= ${runtime.sqlString(runtime.addDaysISO(scanDate, maxForwardDays))}
ORDER BY due_date, due_time, id;`).map(normalizeClawbotTask);
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
        const delivery = queueProactiveNotification({
            eventKey: `task-reminder:${task.id}:${offset}:${task.dueDate}`,
            source: 'task',
            title: `待办提醒：${task.title}`,
            content: `待办提醒已进入微信主动推送队列，提前 ${offset} 分钟提醒。`,
            text: buildTaskReminderText(task, offset, dueAtMs),
            payload: { taskId: task.id, offset, dueDate: task.dueDate, dueTime: task.dueTime },
        });
        const timestamp = runtime.nowISO();
        const nextOffsets = runtime.normalizeReminderSentOffsets([...sentOffsets, offset]);
        runtime.runSqlite(`UPDATE short_term_tasks
SET reminder_sent_offsets = ${runtime.sqlString(JSON.stringify(nextOffsets))},
    reminder_last_sent_at = ${runtime.sqlString(timestamp)},
    updated_at = ${runtime.sqlString(timestamp)}
WHERE id = ${runtime.sqlValue(task.id)} AND user_id = 1;`);
        runtime.tableChanged();
        sent += 1;
        logStructured('info', 'task_reminder_queued', { taskId: task.id, offset, deliveryId: delivery.deliveryId });
    }
    return { ok: true, sent };
}
function scheduleTaskReminderScan() {
    const scan = async () => {
        runtime.nextTaskReminderScanAt = new Date(Date.now() + 60 * 1000).toISOString();
        runtime.setRuntimeMetadata('worker_next_task_reminder_at', runtime.nextTaskReminderScanAt);
        try {
            await processTaskReminders();
        }
        catch (error) {
            logStructured('error', 'task_reminder_scan_failed', { error: runtime.redactSecretText(error.message || String(error)) });
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
async function handleClawbotApi(req, res) {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const body = req.method === 'GET' ? {} : await runtime.readJsonBody(req);
    const access = validateClawbotAccess(req, requestUrl, body);
    if (!access.ok) {
        runtime.sendJson(res, { ok: false, error: access.error }, access.status);
        return;
    }
    if (requestUrl.pathname === '/api/clawbot/status' && req.method === 'GET') {
        const openClawStatus = resolveOpenClawWechatConfig();
        runtime.sendJson(res, {
            ok: true,
            enabled: true,
            webhookConfigured: Boolean(runtime.clawbotWebhookUrl),
            openClawConfigured: openClawStatus.configured,
            pushConfigured: Boolean(runtime.clawbotWebhookUrl || openClawStatus.configured),
            openClaw: openClawStatus,
            commands: ['待办', '完成', '删除待办', '今日待办', '本周待办', '每日简报', '帮助'],
        });
        return;
    }
    if (requestUrl.pathname === '/api/clawbot/help' && ['GET', 'POST'].includes(req.method || 'GET')) {
        runtime.sendJson(res, { ok: true, reply: runtime.clawbotHelpText });
        return;
    }
    if (requestUrl.pathname === '/api/clawbot/daily-digest' && ['GET', 'POST'].includes(req.method || 'GET')) {
        const date = normalizeClawbotDate(requestUrl.searchParams.get('date') || (runtime.isObjectPayload(body) ? body.date : ''));
        const digest = buildClawbotDailyDigest(date);
        runtime.sendJson(res, { ok: true, reply: digest.text, digest });
        return;
    }
    if (requestUrl.pathname === '/api/clawbot/push-daily' && req.method === 'POST') {
        const date = normalizeClawbotDate(runtime.isObjectPayload(body) ? body.date : '');
        const digest = buildClawbotDailyDigest(date);
        const delivery = queueProactiveNotification({
            eventKey: `brief-manual-push:${date}:${Date.now()}`,
            source: 'brief',
            title: `${date} 每日简报主动推送`,
            content: '每日简报已进入微信主动推送队列。',
            text: digest.text,
            payload: { date, trigger: 'clawbot_api' },
        });
        writeAuditEvent({ action: 'clawbot_daily_push', req, actorRole: 'clawbot', detail: { date, ok: delivery.ok } });
        runtime.sendJson(res, { ok: delivery.ok, reply: digest.text, digest, delivery }, delivery.ok ? 200 : 502);
        return;
    }
    if (requestUrl.pathname === '/api/clawbot/message' && req.method === 'POST') {
        const message = extractClawbotMessage(body, requestUrl);
        const command = runtime.parseClawbotCommand(message, { today: runtime.todayISO() });
        const result = await executeClawbotCommand(command, req);
        runtime.sendJson(res, result, result.ok ? 200 : 400);
        return;
    }
    runtime.sendJson(res, { ok: false, error: 'Not found' }, 404);
}
function telegramHelpText() {
    return [
        'Telegram 助手命令：',
        '/today - 今日待办',
        '/week - 本周待办',
        '/todo 明天 15:30 高 背单词 - 创建待办',
        '/brief - 最新简报',
        '/health - 系统健康结论',
        '/backup - 创建备份（二次确认）',
        '/maintenance - SQLite 维护（二次确认）',
        '/resendbrief - 重发最新简报（二次确认）',
    ].join('\n');
}
function telegramCommandText(text = '') {
    const value = String(text).trim();
    if (/^\/(?:start|help)(?:@\w+)?$/i.test(value))
        return '帮助';
    if (/^\/today(?:@\w+)?$/i.test(value))
        return '今日待办';
    if (/^\/week(?:@\w+)?$/i.test(value))
        return '本周待办';
    if (/^\/brief(?:@\w+)?$/i.test(value))
        return '每日简报';
    const todo = value.match(/^\/todo(?:@\w+)?\s+(.+)$/is);
    return todo ? `待办 ${todo[1]}` : value;
}
function telegramHealthText() {
    const health = runtime.getHealthPayload();
    const status = health.unified.status === 'normal' ? '正常' : health.unified.status === 'degraded' ? '降级' : '故障';
    const actions = health.unified.actions.length ? health.unified.actions.map((item) => `- ${item.action}`).join('\n') : '无需处理';
    return `系统健康：${status}\n${health.unified.summary}\n\n处理建议：\n${actions}`;
}
async function executeTelegramOps(action, req) {
    if (action === 'backup') {
        const backup = runtime.createBackupFile('telegram-manual', 'manual backup from Telegram');
        writeAuditEvent({ action: 'telegram_backup', req, actorRole: 'telegram', detail: { createdAt: backup.createdAt } });
        return `备份完成：${backup.createdAt}`;
    }
    if (action === 'maintenance') {
        const result = await runtime.runSqliteMaintenance('telegram');
        writeAuditEvent({ action: 'telegram_sqlite_maintenance', req, actorRole: 'telegram', detail: { ok: result.ok } });
        return result.ok ? `SQLite 维护完成：${result.ranAt}` : `SQLite 维护失败：${result.error || '未知错误'}`;
    }
    if (action === 'resendbrief') {
        const digest = buildClawbotDailyDigest(runtime.todayISO());
        await sendTelegramMessage(digest.text);
        writeAuditEvent({ action: 'telegram_brief_resend', req, actorRole: 'telegram', detail: { date: digest.date } });
        return '最新简报已重发。';
    }
    return '未知运维操作。';
}
async function handleTelegramUpdate(update, req) {
    const config = runtime.readTelegramConfig(runtime.telegramEnvFile);
    const context = runtime.telegramUpdateContext(update);
    if (!runtime.isTelegramAuthorized(context, config)) {
        logStructured('warn', 'telegram_unauthorized_update', { userId: context.userId, chatId: context.chatId });
        return;
    }
    if (context.callbackId) {
        await telegramApi('answerCallbackQuery', { callback_query_id: context.callbackId }).catch(() => { });
        const complete = context.callbackData.match(/^task:complete:(\d+)$/);
        const delay = context.callbackData.match(/^task:delay:(\d+)$/);
        const confirm = context.callbackData.match(/^ops:confirm:(backup|maintenance|resendbrief):([A-Za-z0-9_-]+)$/);
        if (complete) {
            const command = runtime.parseClawbotCommand(`完成 #${complete[1]}`, { today: runtime.todayISO() });
            const result = await executeClawbotCommand(command, req);
            await sendTelegramMessage(result.reply, { chatId: context.chatId });
            return;
        }
        if (delay) {
            const task = findClawbotTasks(`#${delay[1]}`)[0];
            if (!task)
                return sendTelegramMessage('待办不存在或已完成。', { chatId: context.chatId });
            const nextDate = runtime.addDaysISO(task.dueDate, 1);
            runtime.runSqlite(`UPDATE short_term_tasks SET due_date = ${runtime.sqlString(nextDate)}, updated_at = ${runtime.sqlString(runtime.nowISO())} WHERE id = ${runtime.sqlValue(task.id)} AND user_id = 1;`);
            runtime.tableChanged();
            writeAuditEvent({ action: 'telegram_task_delay', req, actorRole: 'telegram', detail: { id: task.id, dueDate: nextDate } });
            await sendTelegramMessage(`已延期一天：#${task.id} ${task.title}｜${nextDate}`, { chatId: context.chatId });
            return;
        }
        if (confirm) {
            const pending = runtime.telegramOpsConfirmations.get(confirm[2]);
            runtime.telegramOpsConfirmations.delete(confirm[2]);
            if (!pending || pending.action !== confirm[1] || pending.userId !== context.userId || pending.expiresAt < Date.now()) {
                await sendTelegramMessage('确认已失效，请重新发送运维命令。', { chatId: context.chatId });
                return;
            }
            await sendTelegramMessage(await executeTelegramOps(confirm[1], req), { chatId: context.chatId });
            return;
        }
        if (context.callbackData === 'ops:cancel')
            await sendTelegramMessage('已取消。', { chatId: context.chatId });
        return;
    }
    const raw = String(context.text || '').trim();
    if (!raw)
        return;
    if (/^\/health(?:@\w+)?$/i.test(raw))
        return sendTelegramMessage(telegramHealthText(), { chatId: context.chatId });
    const ops = raw.match(/^\/(backup|maintenance|resendbrief)(?:@\w+)?$/i);
    if (ops) {
        const action = ops[1].toLowerCase();
        const token = runtime.randomBytes(9).toString('base64url');
        runtime.telegramOpsConfirmations.set(token, { action, userId: context.userId, expiresAt: Date.now() + 5 * 60000 });
        return sendTelegramMessage(`即将执行：${action}。确认按钮 5 分钟内有效且只能使用一次。`, { chatId: context.chatId, replyMarkup: runtime.telegramConfirmKeyboard(action, token) });
    }
    if (/^\/(?:start|help)(?:@\w+)?$/i.test(raw))
        return sendTelegramMessage(telegramHelpText(), { chatId: context.chatId });
    const command = runtime.parseClawbotCommand(telegramCommandText(raw), { today: runtime.todayISO() });
    const result = await executeClawbotCommand(command, req);
    const tasks = result.tasks || (result.task && !result.task.isCompleted ? [result.task] : []);
    await sendTelegramMessage(result.reply, { chatId: context.chatId, replyMarkup: tasks.length ? runtime.telegramTaskKeyboard(tasks) : undefined });
}
async function handleTelegramWebhook(req, res) {
    const config = runtime.readTelegramConfig(runtime.telegramEnvFile);
    if (!config.TELEGRAM_WEBHOOK_SECRET || req.headers['x-telegram-bot-api-secret-token'] !== config.TELEGRAM_WEBHOOK_SECRET) {
        runtime.sendJson(res, { ok: false }, 403);
        return;
    }
    const update = await runtime.readJsonBody(req);
    await handleTelegramUpdate(update, req);
    runtime.sendJson(res, { ok: true });
}
function saveTelegramSettings(input = {}) {
    const current = runtime.readTelegramConfig(runtime.telegramEnvFile);
    const webhookUrl = String(input.webhookUrl || '').trim();
    if (webhookUrl && !/^https:\/\//i.test(webhookUrl)) {
        const error = new Error('Telegram Webhook 必须使用 HTTPS');
        error.statusCode = 400;
        throw error;
    }
    const config = runtime.saveTelegramConfig(runtime.telegramEnvFile, current, input);
    applyTelegramProcessEnv(config);
    return runtime.telegramConfigStatus(config);
}
async function registerTelegramWebhook() {
    const config = runtime.readTelegramConfig(runtime.telegramEnvFile);
    const status = runtime.telegramConfigStatus(config);
    if (!status.configured || !config.TELEGRAM_WEBHOOK_URL || !config.TELEGRAM_WEBHOOK_SECRET)
        throw new Error('请先配置 Token、Chat ID、授权用户和 Webhook URL');
    const url = `${config.TELEGRAM_WEBHOOK_URL.replace(/\/+$/, '')}/api/telegram/webhook`;
    await telegramApi('setWebhook', {
        url,
        secret_token: config.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: false,
    }, { config });
    await telegramApi('setMyCommands', { commands: [
            { command: 'today', description: '查看今日待办' },
            { command: 'week', description: '查看本周待办' },
            { command: 'brief', description: '查看最新简报' },
            { command: 'health', description: '查看系统健康' },
            { command: 'backup', description: '创建服务器备份' },
            { command: 'maintenance', description: '执行 SQLite 维护' },
        ] }, { config });
    return { ...status, registered: true, bot: await telegramApi('getMe', {}, { config }) };
}

exposeRuntime({ "logStructured": () => logStructured, "writeAuditEvent": () => writeAuditEvent, "writeApiRequestLog": () => writeApiRequestLog, "writeClientErrorLog": () => writeClientErrorLog, "activeTaskLocks": () => activeTaskLocks, "lastTaskRuns": () => lastTaskRuns, "runExclusiveTask": () => runExclusiveTask, "clawbotRequestSecret": () => clawbotRequestSecret, "validateClawbotAccess": () => validateClawbotAccess, "extractClawbotMessage": () => extractClawbotMessage, "normalizeClawbotDate": () => normalizeClawbotDate, "clawbotMinutesText": () => clawbotMinutesText, "normalizeClawbotTask": () => normalizeClawbotTask, "clawbotUrgencyLabel": () => clawbotUrgencyLabel, "taskLetterLabel": () => taskLetterLabel, "taskLabelIndex": () => taskLabelIndex, "formatClawbotTask": () => formatClawbotTask, "taskSearchPattern": () => taskSearchPattern, "listClawbotTasks": () => listClawbotTasks, "listClawbotLabelTasks": () => listClawbotLabelTasks, "findClawbotTasks": () => findClawbotTasks, "buildClawbotTaskListReply": () => buildClawbotTaskListReply, "clawbotSection": () => clawbotSection, "buildClawbotBriefReply": () => buildClawbotBriefReply, "buildClawbotDailyDigest": () => buildClawbotDailyDigest, "ambiguousClawbotReply": () => ambiguousClawbotReply, "executeClawbotCommand": () => executeClawbotCommand, "readJsonFileSafe": () => readJsonFileSafe, "findNestedStringByKey": () => findNestedStringByKey, "detectOpenClawAccountId": () => detectOpenClawAccountId, "resolveOpenClawWechatConfig": () => resolveOpenClawWechatConfig, "openClawWeixinSendModulePath": () => openClawWeixinSendModulePath, "detectOpenClawWeixinSendModulePath": () => detectOpenClawWeixinSendModulePath, "sendOpenClawWechatDirect": () => sendOpenClawWechatDirect, "runOpenClawCli": () => runOpenClawCli, "sendOpenClawWechatMessage": () => sendOpenClawWechatMessage, "sendProactiveClawbotText": () => sendProactiveClawbotText, "resolveBarkConfig": () => resolveBarkConfig, "barkLevel": () => barkLevel, "sendBarkNotification": () => sendBarkNotification, "applyTelegramProcessEnv": () => applyTelegramProcessEnv, "telegramApi": () => telegramApi, "sendTelegramMessage": () => sendTelegramMessage, "sendTelegramNotification": () => sendTelegramNotification, "sendProactiveNotification": () => sendProactiveNotification, "queueProactiveNotification": () => queueProactiveNotification, "scheduleNotificationQueue": () => scheduleNotificationQueue, "postClawbotWebhook": () => postClawbotWebhook, "chinaDateISO": () => chinaDateISO, "chinaWallClockUtcMs": () => chinaWallClockUtcMs, "formatReminderLead": () => formatReminderLead, "taskCompletionHint": () => taskCompletionHint, "buildTaskReminderText": () => buildTaskReminderText, "listTimedReminderTasks": () => listTimedReminderTasks, "processTaskReminders": () => processTaskReminders, "scheduleTaskReminderScan": () => scheduleTaskReminderScan, "handleClawbotApi": () => handleClawbotApi, "telegramHelpText": () => telegramHelpText, "telegramCommandText": () => telegramCommandText, "telegramHealthText": () => telegramHealthText, "executeTelegramOps": () => executeTelegramOps, "handleTelegramUpdate": () => handleTelegramUpdate, "handleTelegramWebhook": () => handleTelegramWebhook, "saveTelegramSettings": () => saveTelegramSettings, "registerTelegramWebhook": () => registerTelegramWebhook }, { "openClawWeixinSendModulePath": (value) => { openClawWeixinSendModulePath = value; } });
