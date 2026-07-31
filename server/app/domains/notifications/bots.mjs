export function installNotificationBotsDomain(runtime, exposeRuntime) {
    async function handleClawbotApi(req, res) {
        const requestUrl = new URL(req.url || '/', 'http://localhost');
        const body = req.method === 'GET' ? {} : await runtime.readJsonBody(req);
        const access = runtime.validateClawbotAccess(req, requestUrl, body);
        if (!access.ok) {
            runtime.sendJson(res, { ok: false, error: access.error }, access.status);
            return;
        }
        if (requestUrl.pathname === '/api/clawbot/status' && req.method === 'GET') {
            const openClawStatus = runtime.resolveOpenClawWechatConfig();
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
            const date = runtime.normalizeClawbotDate(requestUrl.searchParams.get('date') || (runtime.isObjectPayload(body) ? body.date : ''));
            const digest = runtime.buildClawbotDailyDigest(date);
            runtime.sendJson(res, { ok: true, reply: digest.text, digest });
            return;
        }
        if (requestUrl.pathname === '/api/clawbot/push-daily' && req.method === 'POST') {
            const date = runtime.normalizeClawbotDate(runtime.isObjectPayload(body) ? body.date : '');
            const digest = runtime.buildClawbotDailyDigest(date);
            const delivery = runtime.queueProactiveNotification({
                eventKey: `brief-manual-push:${date}:${Date.now()}`,
                source: 'brief',
                title: `${date} 每日简报主动推送`,
                content: '每日简报已进入微信主动推送队列。',
                text: digest.text,
                payload: { date, trigger: 'clawbot_api' },
            });
            runtime.writeAuditEvent({ action: 'clawbot_daily_push', req, actorRole: 'clawbot', detail: { date, ok: delivery.ok } });
            runtime.sendJson(res, { ok: delivery.ok, reply: digest.text, digest, delivery }, delivery.ok ? 200 : 502);
            return;
        }
        if (requestUrl.pathname === '/api/clawbot/message' && req.method === 'POST') {
            const message = runtime.extractClawbotMessage(body, requestUrl);
            const command = runtime.parseClawbotCommand(message, { today: runtime.todayISO() });
            const result = await runtime.executeClawbotCommand(command, req);
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
            runtime.writeAuditEvent({ action: 'telegram_backup', req, actorRole: 'telegram', detail: { createdAt: backup.createdAt } });
            return `备份完成：${backup.createdAt}`;
        }
        if (action === 'maintenance') {
            const result = await runtime.runSqliteMaintenance('telegram');
            runtime.writeAuditEvent({ action: 'telegram_sqlite_maintenance', req, actorRole: 'telegram', detail: { ok: result.ok } });
            return result.ok ? `SQLite 维护完成：${result.ranAt}` : `SQLite 维护失败：${result.error || '未知错误'}`;
        }
        if (action === 'resendbrief') {
            const digest = runtime.buildClawbotDailyDigest(runtime.todayISO());
            await runtime.sendTelegramMessage(digest.text);
            runtime.writeAuditEvent({ action: 'telegram_brief_resend', req, actorRole: 'telegram', detail: { date: digest.date } });
            return '最新简报已重发。';
        }
        return '未知运维操作。';
    }
    async function handleTelegramUpdate(update, req) {
        const config = runtime.readTelegramConfig(runtime.telegramEnvFile);
        const context = runtime.telegramUpdateContext(update);
        if (!runtime.isTelegramAuthorized(context, config)) {
            runtime.logStructured('warn', 'telegram_unauthorized_update', { userId: context.userId, chatId: context.chatId });
            return;
        }
        if (context.callbackId) {
            await runtime.telegramApi('answerCallbackQuery', { callback_query_id: context.callbackId }).catch(() => { });
            const complete = context.callbackData.match(/^task:complete:(\d+)$/);
            const delay = context.callbackData.match(/^task:delay:(\d+)$/);
            const confirm = context.callbackData.match(/^ops:confirm:(backup|maintenance|resendbrief):([A-Za-z0-9_-]+)$/);
            if (complete) {
                const command = runtime.parseClawbotCommand(`完成 #${complete[1]}`, { today: runtime.todayISO() });
                const result = await runtime.executeClawbotCommand(command, req);
                await runtime.sendTelegramMessage(result.reply, { chatId: context.chatId });
                return;
            }
            if (delay) {
                const task = runtime.findClawbotTasks(`#${delay[1]}`)[0];
                if (!task)
                    return runtime.sendTelegramMessage('待办不存在或已完成。', { chatId: context.chatId });
                const nextDate = runtime.addDaysISO(task.dueDate, 1);
                runtime.taskRepository.delayOwnerTask(task.id, nextDate, runtime.nowISO());
                runtime.tableChanged();
                runtime.writeAuditEvent({ action: 'telegram_task_delay', req, actorRole: 'telegram', detail: { id: task.id, dueDate: nextDate } });
                await runtime.sendTelegramMessage(`已延期一天：#${task.id} ${task.title}｜${nextDate}`, { chatId: context.chatId });
                return;
            }
            if (confirm) {
                const pending = runtime.telegramOpsConfirmations.get(confirm[2]);
                runtime.telegramOpsConfirmations.delete(confirm[2]);
                if (!pending || pending.action !== confirm[1] || pending.userId !== context.userId || pending.expiresAt < Date.now()) {
                    await runtime.sendTelegramMessage('确认已失效，请重新发送运维命令。', { chatId: context.chatId });
                    return;
                }
                await runtime.sendTelegramMessage(await executeTelegramOps(confirm[1], req), { chatId: context.chatId });
                return;
            }
            if (context.callbackData === 'ops:cancel')
                await runtime.sendTelegramMessage('已取消。', { chatId: context.chatId });
            return;
        }
        const raw = String(context.text || '').trim();
        if (!raw)
            return;
        if (/^\/health(?:@\w+)?$/i.test(raw))
            return runtime.sendTelegramMessage(telegramHealthText(), { chatId: context.chatId });
        const ops = raw.match(/^\/(backup|maintenance|resendbrief)(?:@\w+)?$/i);
        if (ops) {
            const action = ops[1].toLowerCase();
            const token = runtime.randomBytes(9).toString('base64url');
            runtime.telegramOpsConfirmations.set(token, { action, userId: context.userId, expiresAt: Date.now() + 5 * 60000 });
            return runtime.sendTelegramMessage(`即将执行：${action}。确认按钮 5 分钟内有效且只能使用一次。`, { chatId: context.chatId, replyMarkup: runtime.telegramConfirmKeyboard(action, token) });
        }
        if (/^\/(?:start|help)(?:@\w+)?$/i.test(raw))
            return runtime.sendTelegramMessage(telegramHelpText(), { chatId: context.chatId });
        const command = runtime.parseClawbotCommand(telegramCommandText(raw), { today: runtime.todayISO() });
        const result = await runtime.executeClawbotCommand(command, req);
        const tasks = result.tasks || (result.task && !result.task.isCompleted ? [result.task] : []);
        await runtime.sendTelegramMessage(result.reply, { chatId: context.chatId, replyMarkup: tasks.length ? runtime.telegramTaskKeyboard(tasks) : undefined });
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
        runtime.applyTelegramProcessEnv(config);
        return runtime.telegramConfigStatus(config);
    }
    async function registerTelegramWebhook() {
        const config = runtime.readTelegramConfig(runtime.telegramEnvFile);
        const status = runtime.telegramConfigStatus(config);
        if (!status.configured || !config.TELEGRAM_WEBHOOK_URL || !config.TELEGRAM_WEBHOOK_SECRET)
            throw new Error('请先配置 Token、Chat ID、授权用户和 Webhook URL');
        const url = `${config.TELEGRAM_WEBHOOK_URL.replace(/\/+$/, '')}/api/telegram/webhook`;
        await runtime.telegramApi('setWebhook', {
            url,
            secret_token: config.TELEGRAM_WEBHOOK_SECRET,
            allowed_updates: ['message', 'callback_query'],
            drop_pending_updates: false,
        }, { config });
        await runtime.telegramApi('setMyCommands', { commands: [
                { command: 'today', description: '查看今日待办' },
                { command: 'week', description: '查看本周待办' },
                { command: 'brief', description: '查看最新简报' },
                { command: 'health', description: '查看系统健康' },
                { command: 'backup', description: '创建服务器备份' },
                { command: 'maintenance', description: '执行 SQLite 维护' },
            ] }, { config });
        return { ...status, registered: true, bot: await runtime.telegramApi('getMe', {}, { config }) };
    }

    exposeRuntime({
        handleClawbotApi: () => handleClawbotApi,
        telegramHelpText: () => telegramHelpText,
        telegramCommandText: () => telegramCommandText,
        telegramHealthText: () => telegramHealthText,
        executeTelegramOps: () => executeTelegramOps,
        handleTelegramUpdate: () => handleTelegramUpdate,
        handleTelegramWebhook: () => handleTelegramWebhook,
        saveTelegramSettings: () => saveTelegramSettings,
        registerTelegramWebhook: () => registerTelegramWebhook,
    });
}
