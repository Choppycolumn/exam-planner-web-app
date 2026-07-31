export function installNotificationWechatDomain(runtime, exposeRuntime) {
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
            return runtime.postClawbotWebhook(text);
        return { ok: false, method: 'none', error: 'No ClawBot push channel is configured', status: resolveOpenClawWechatConfig() };
    }
    exposeRuntime({
        openClawWeixinSendModulePath: () => openClawWeixinSendModulePath,
        readJsonFileSafe: () => readJsonFileSafe,
        findNestedStringByKey: () => findNestedStringByKey,
        detectOpenClawAccountId: () => detectOpenClawAccountId,
        resolveOpenClawWechatConfig: () => resolveOpenClawWechatConfig,
        detectOpenClawWeixinSendModulePath: () => detectOpenClawWeixinSendModulePath,
        sendOpenClawWechatDirect: () => sendOpenClawWechatDirect,
        runOpenClawCli: () => runOpenClawCli,
        sendOpenClawWechatMessage: () => sendOpenClawWechatMessage,
        sendProactiveClawbotText: () => sendProactiveClawbotText,
    }, { openClawWeixinSendModulePath: (value) => { openClawWeixinSendModulePath = value; } });
}
