export function installNotificationChannelsDomain(runtime, exposeRuntime) {
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
        return { ok: false, method: plan.kind, channel: plan.channelKey, error: `Unsupported notification channel: ${plan.type || plan.channelKey}` };
    }
    function queueProactiveNotification({ eventKey, source, severity = 'info', title, content, text, payload = {}, channelKeys = null }) {
        const telegramReady = runtime.telegramConfigStatus(runtime.readTelegramConfig(runtime.telegramEnvFile)).configured;
        const channels = channelKeys || [
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
                payload: { ...payload, notificationMode: 'in_app_fallback', reason: 'no_enabled_external_channels' },
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
            runtime.logStructured('warn', 'notification_queue_kick_failed', { error: runtime.redactSecretText(error.message || String(error)) });
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
            runtime.logStructured('warn', 'notification_queue_scan_failed', { error: runtime.redactSecretText(error.message || String(error)) });
        });
        runtime.notificationQueueTimer = runtime.scheduler.scheduleInterval(
            'notification-queue',
            30 * 1000,
            scan,
            { initialDelayMs: 0 },
        );
    }
    exposeRuntime({
        resolveBarkConfig: () => resolveBarkConfig,
        barkLevel: () => barkLevel,
        sendBarkNotification: () => sendBarkNotification,
        applyTelegramProcessEnv: () => applyTelegramProcessEnv,
        telegramApi: () => telegramApi,
        sendTelegramMessage: () => sendTelegramMessage,
        sendTelegramNotification: () => sendTelegramNotification,
        sendProactiveNotification: () => sendProactiveNotification,
        queueProactiveNotification: () => queueProactiveNotification,
        scheduleNotificationQueue: () => scheduleNotificationQueue,
    });
}
