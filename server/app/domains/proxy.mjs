export function installProxyDomain(runtime, exposeRuntime) {
    const proxySettingsEnvKeys = [
        'MIHOMO_CONTROLLER_SECRET',
        'MIHOMO_SUBSCRIPTION_URL',
        'MIHOMO_SELECTED_PROXY',
        'MIHOMO_PROVIDER_MODE',
    ];
    function parseProxySettingsEnvText(text = '') {
        const values = {};
        text.split(/\r?\n/).forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#'))
                return;
            const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
            if (!match || !proxySettingsEnvKeys.includes(match[1]))
                return;
            let value = match[2] || '';
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            values[match[1]] = value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        });
        return values;
    }
    function readProxySettingsEnvValues() {
        try {
            if (!runtime.existsSync(runtime.proxySettingsEnvFile))
                return {};
            return parseProxySettingsEnvText(runtime.readFileSync(runtime.proxySettingsEnvFile, 'utf8'));
        }
        catch (error) {
            runtime.logStructured('warn', 'proxy_settings_env_read_failed', { error: runtime.redactSecretText(error.message || String(error)) });
            return {};
        }
    }
    function proxySettingsCurrentValues() {
        const fileValues = readProxySettingsEnvValues();
        return {
            MIHOMO_CONTROLLER_SECRET: String(process.env.MIHOMO_CONTROLLER_SECRET || fileValues.MIHOMO_CONTROLLER_SECRET || ''),
            MIHOMO_SUBSCRIPTION_URL: String(process.env.MIHOMO_SUBSCRIPTION_URL || fileValues.MIHOMO_SUBSCRIPTION_URL || ''),
            MIHOMO_SELECTED_PROXY: String(process.env.MIHOMO_SELECTED_PROXY || fileValues.MIHOMO_SELECTED_PROXY || ''),
            MIHOMO_PROVIDER_MODE: String(process.env.MIHOMO_PROVIDER_MODE || fileValues.MIHOMO_PROVIDER_MODE || ''),
        };
    }
    function escapeProxySettingsEnvValue(value = '') {
        const text = String(value || '');
        if (/^[A-Za-z0-9_./:=+\-@]*$/.test(text))
            return text;
        return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`;
    }
    function writeProxySettingsEnvValues(values) {
        runtime.mkdirSync(runtime.dirname(runtime.proxySettingsEnvFile), { recursive: true });
        const text = [
            '# Exam Planner Mihomo proxy settings.',
            `MIHOMO_CONTROLLER_SECRET=${escapeProxySettingsEnvValue(values.MIHOMO_CONTROLLER_SECRET)}`,
            `MIHOMO_SUBSCRIPTION_URL=${escapeProxySettingsEnvValue(values.MIHOMO_SUBSCRIPTION_URL)}`,
            `MIHOMO_SELECTED_PROXY=${escapeProxySettingsEnvValue(values.MIHOMO_SELECTED_PROXY)}`,
            `MIHOMO_PROVIDER_MODE=${escapeProxySettingsEnvValue(values.MIHOMO_PROVIDER_MODE)}`,
            '',
        ].join('\n');
        runtime.writeFileSync(runtime.proxySettingsEnvFile, text, { encoding: 'utf8', mode: 0o600 });
        try {
            runtime.chmodSync(runtime.proxySettingsEnvFile, 0o600);
        }
        catch {
            // Windows local development can ignore chmod.
        }
    }
    function applyProxySettingsProcessEnvValues(values) {
        proxySettingsEnvKeys.forEach((key) => {
            if (values[key])
                process.env[key] = values[key];
            else
                delete process.env[key];
        });
    }
    const mihomoBinary = process.platform === 'win32' ? '' : '/usr/local/bin/mihomo';
    const mihomoConfigDir = process.platform === 'win32' ? runtime.join(runtime.dataDir, 'mihomo') : '/etc/mihomo';
    const mihomoConfigFile = runtime.join(mihomoConfigDir, 'config.yaml');
    const mihomoProviderDir = process.platform === 'win32' ? runtime.join(runtime.dataDir, 'mihomo-providers') : '/etc/mihomo/proxy-providers';
    const mihomoProviderFile = runtime.join(mihomoProviderDir, 'subscription.yaml');
    const mihomoProxyUrl = 'http://127.0.0.1:7890';
    const mihomoControllerUrl = 'http://127.0.0.1:9097';
    function yamlDouble(value = '') {
        return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    function maskMihomoSubscriptionUrl(value = '') {
        const raw = String(value || '').trim();
        if (!raw)
            return { configured: false, label: '' };
        try {
            const url = new URL(raw);
            return { configured: true, label: `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}，尾号 ${raw.slice(-4)}` };
        }
        catch {
            return { configured: true, label: `已保存，尾号 ${raw.slice(-4)}` };
        }
    }
    function sanitizeMihomoSubscriptionUrl(value = '') {
        const text = String(value || '').trim();
        if (!text)
            return '';
        let url;
        try {
            url = new URL(text);
        }
        catch {
            const error = new Error('订阅链接格式不正确');
            error.statusCode = 400;
            throw error;
        }
        if (!['http:', 'https:'].includes(url.protocol)) {
            const error = new Error('订阅链接仅支持 http:// 或 https://');
            error.statusCode = 400;
            throw error;
        }
        return url.toString();
    }
    function ensureMihomoSecret(values) {
        if (values.MIHOMO_CONTROLLER_SECRET)
            return values.MIHOMO_CONTROLLER_SECRET;
        values.MIHOMO_CONTROLLER_SECRET = runtime.randomBytes(24).toString('hex');
        return values.MIHOMO_CONTROLLER_SECRET;
    }
    function buildMihomoConfig(values) {
        const subscriptionUrl = String(values.MIHOMO_SUBSCRIPTION_URL || '').trim();
        const secret = ensureMihomoSecret(values);
        const providerPath = mihomoProviderFile.replace(/\\/g, '/');
        const providerMode = String(values.MIHOMO_PROVIDER_MODE || '').trim() === 'file' ? 'file' : 'http';
        const useFileProvider = providerMode === 'file' && runtime.existsSync(mihomoProviderFile);
        const useHttpProvider = Boolean(subscriptionUrl) && !useFileProvider;
        const useProvider = useFileProvider || useHttpProvider;
        const providerBlock = useProvider ? [
            'proxy-providers:',
            '  subscription:',
            `    type: ${useFileProvider ? 'file' : 'http'}`,
            ...(useHttpProvider ? [
                `    url: ${yamlDouble(subscriptionUrl)}`,
                '    interval: 3600',
            ] : []),
            `    path: ${yamlDouble(providerPath)}`,
            '    health-check:',
            '      enable: true',
            '      interval: 600',
            '      url: https://www.gstatic.com/generate_204',
        ] : ['proxies: []'];
        const groupBlock = useProvider ? [
            'proxy-groups:',
            '  - name: SELECT',
            '    type: select',
            '    proxies:',
            '      - DIRECT',
            '    use:',
            '      - subscription',
        ] : [
            'proxy-groups:',
            '  - name: SELECT',
            '    type: select',
            '    proxies:',
            '      - DIRECT',
        ];
        return [
            'mixed-port: 7890',
            'allow-lan: false',
            'bind-address: 127.0.0.1',
            'mode: rule',
            'log-level: info',
            'profile:',
            '  store-selected: true',
            'external-controller: 127.0.0.1:9097',
            `secret: ${yamlDouble(secret)}`,
            ...providerBlock,
            ...groupBlock,
            'rules:',
            '  - DOMAIN-SUFFIX,worldperatio.com,SELECT',
            '  - DOMAIN-SUFFIX,api.telegram.org,SELECT',
            '  - DOMAIN-SUFFIX,gstatic.com,SELECT',
            '  - MATCH,DIRECT',
            '',
        ].join('\n');
    }
    function writeMihomoConfig(values) {
        ensureMihomoSecret(values);
        runtime.mkdirSync(mihomoConfigDir, { recursive: true });
        runtime.mkdirSync(mihomoProviderDir, { recursive: true });
        runtime.writeFileSync(mihomoConfigFile, buildMihomoConfig(values), { encoding: 'utf8', mode: 0o600 });
        try {
            runtime.chmodSync(mihomoConfigFile, 0o600);
        }
        catch {
            // Windows local development can ignore chmod.
        }
    }
    function normalizeMihomoProviderContent(value = '') {
        const text = String(value || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
        if (!text) {
            const error = new Error('订阅内容为空');
            error.statusCode = 400;
            throw error;
        }
        if (Buffer.byteLength(text, 'utf8') > 8 * 1024 * 1024) {
            const error = new Error('订阅内容过大，请使用较小的 Clash/Mihomo 配置');
            error.statusCode = 413;
            throw error;
        }
        if (!/^proxies\s*:/m.test(text)) {
            const error = new Error('订阅内容不是 Clash/Mihomo YAML（未找到 proxies 字段），请使用 Clash/Mihomo 配置订阅或转换后的内容');
            error.statusCode = 400;
            throw error;
        }
        return `${text}\n`;
    }
    function writeMihomoProviderContent(value = '') {
        runtime.mkdirSync(mihomoProviderDir, { recursive: true });
        runtime.writeFileSync(mihomoProviderFile, normalizeMihomoProviderContent(value), { encoding: 'utf8', mode: 0o600 });
        try {
            runtime.chmodSync(mihomoProviderFile, 0o600);
        }
        catch {
            // Windows local development can ignore chmod.
        }
    }
    function removeMihomoProviderContent() {
        try {
            if (runtime.existsSync(mihomoProviderFile))
                runtime.unlinkSync(mihomoProviderFile);
        }
        catch (error) {
            runtime.logStructured('warn', 'mihomo_provider_remove_failed', { error: runtime.redactSecretText(error.message || String(error)) });
        }
    }
    async function runCommand(command, args = [], timeout = 15000) {
        const result = await runtime.runProcess(command, args, { timeoutMs: timeout });
        return {
            ok: result.ok,
            code: result.code,
            stdout: String(result.stdout || '').trim(),
            stderr: runtime.redactSecretText(String(result.stderr || '').trim()),
        };
    }
    async function restartMihomoService() {
        if (process.platform === 'win32')
            return { ok: false, message: '本地 Windows 环境未安装 mihomo systemd 服务' };
        const result = await runCommand('systemctl', ['restart', 'mihomo.service'], 30000);
        if (!result.ok)
            return { ok: false, message: result.stderr || result.stdout || 'mihomo 重启失败' };
        const active = await runCommand('systemctl', ['is-active', 'mihomo.service'], 10000);
        return { ok: active.ok, message: active.stdout || active.stderr || 'mihomo 状态未知' };
    }
    async function mihomoControllerRequest(pathname, options = {}) {
        const values = proxySettingsCurrentValues();
        const secret = values.MIHOMO_CONTROLLER_SECRET;
        if (!secret)
            throw new Error('mihomo 控制密钥未配置');
        const response = await fetch(`${mihomoControllerUrl}${pathname}`, {
            method: options.method || 'GET',
            headers: {
                Authorization: `Bearer ${secret}`,
                ...(options.body ? { 'content-type': 'application/json' } : {}),
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal: AbortSignal.timeout(options.timeoutMs || 8000),
        });
        const text = await response.text();
        if (!response.ok)
            throw new Error(`mihomo controller HTTP ${response.status}: ${text.slice(0, 200)}`);
        if (!text)
            return {};
        try {
            return JSON.parse(text);
        }
        catch {
            return { raw: text };
        }
    }
    async function mihomoServiceStatus() {
        const installed = Boolean(mihomoBinary && runtime.existsSync(mihomoBinary));
        const activeResult = process.platform === 'win32' ? { ok: false, stdout: '' } : await runCommand('systemctl', ['is-active', 'mihomo.service'], 10000);
        const versionResult = installed ? await runCommand(mihomoBinary, ['-v'], 10000) : { ok: false, stdout: '' };
        return {
            installed,
            active: activeResult.stdout === 'active',
            version: versionResult.stdout.split(/\r?\n/)[0] || '',
        };
    }
    async function getMihomoSettings() {
        const values = proxySettingsCurrentValues();
        const subscription = maskMihomoSubscriptionUrl(values.MIHOMO_SUBSCRIPTION_URL);
        const service = await mihomoServiceStatus();
        let controllerOk = false;
        let current = '';
        let nodes = [];
        let error = '';
        try {
            const payload = await mihomoControllerRequest('/proxies');
            const proxies = payload.proxies && typeof payload.proxies === 'object' ? payload.proxies : {};
            const group = proxies.SELECT || proxies.GLOBAL || {};
            const all = Array.isArray(group.all) ? group.all : [];
            current = String(group.now || values.MIHOMO_SELECTED_PROXY || '');
            nodes = all.map((name) => {
                const proxy = proxies[name] || {};
                const history = Array.isArray(proxy.history) ? proxy.history : [];
                const latest = history.at(-1) || {};
                return {
                    name,
                    type: String(proxy.type || ''),
                    udp: Boolean(proxy.udp),
                    delay: typeof latest.delay === 'number' ? latest.delay : null,
                    alive: latest.meanDelay !== undefined || latest.delay !== undefined ? latest.delay !== 0 : null,
                };
            });
            controllerOk = true;
        }
        catch (controllerError) {
            error = runtime.redactSecretText(controllerError instanceof Error ? controllerError.message : String(controllerError));
        }
        return {
            ok: true,
            ...service,
            controllerOk,
            controllerUrl: mihomoControllerUrl,
            localProxyUrl: mihomoProxyUrl,
            subscriptionConfigured: subscription.configured,
            subscriptionLabel: subscription.label,
            providerMode: values.MIHOMO_PROVIDER_MODE === 'file' ? 'file' : subscription.configured ? 'http' : '',
            current,
            nodes,
            error,
        };
    }
    async function saveMihomoSubscriptionSettings(input = {}) {
        const values = proxySettingsCurrentValues();
        ensureMihomoSecret(values);
        if (input.clearSubscription) {
            values.MIHOMO_SUBSCRIPTION_URL = '';
            values.MIHOMO_SELECTED_PROXY = '';
            values.MIHOMO_PROVIDER_MODE = '';
            removeMihomoProviderContent();
        }
        if (typeof input.subscriptionUrl === 'string' && input.subscriptionUrl.trim()) {
            values.MIHOMO_SUBSCRIPTION_URL = sanitizeMihomoSubscriptionUrl(input.subscriptionUrl);
            values.MIHOMO_PROVIDER_MODE = 'http';
            removeMihomoProviderContent();
        }
        writeMihomoConfig(values);
        writeProxySettingsEnvValues(values);
        applyProxySettingsProcessEnvValues(values);
        const restart = await restartMihomoService();
        await runtime.wait(800);
        const status = await getMihomoSettings();
        return { ...status, restarted: restart.ok, message: restart.message, updatedAt: runtime.nowISO() };
    }
    async function importMihomoProviderSettings(input = {}) {
        const content = typeof input.subscriptionContent === 'string' ? input.subscriptionContent : input.content;
        writeMihomoProviderContent(content);
        const values = proxySettingsCurrentValues();
        ensureMihomoSecret(values);
        values.MIHOMO_PROVIDER_MODE = 'file';
        writeMihomoConfig(values);
        writeProxySettingsEnvValues(values);
        applyProxySettingsProcessEnvValues(values);
        const restart = await restartMihomoService();
        await runtime.wait(800);
        const status = await getMihomoSettings();
        return { ...status, restarted: restart.ok, message: restart.message, imported: true, updatedAt: runtime.nowISO() };
    }
    async function selectMihomoProxy(input = {}) {
        const name = String(input.name || '').trim();
        if (!name) {
            const error = new Error('请选择一个节点');
            error.statusCode = 400;
            throw error;
        }
        await mihomoControllerRequest('/proxies/SELECT', { method: 'PUT', body: { name }, timeoutMs: 10000 });
        const values = proxySettingsCurrentValues();
        values.MIHOMO_SELECTED_PROXY = name;
        writeProxySettingsEnvValues(values);
        applyProxySettingsProcessEnvValues(values);
        const status = await getMihomoSettings();
        return { ...status, selected: name, updatedAt: runtime.nowISO() };
    }
    async function testMihomoProxy() {
        const targets = [
            { id: 'brief-pe', label: '简报 PE 数据源', url: 'https://www.worldperatio.com/' },
            { id: 'telegram', label: 'Telegram API', url: 'https://api.telegram.org/' },
        ];
        const results = [];
        for (const target of targets) {
            const startedAt = Date.now();
            try {
                const processResult = await runtime.runProcess('curl', ['-4', '-fsSL', '--proxy', mihomoProxyUrl, '-A', 'exam-planner-mihomo-test/1.0', '--max-time', '15', '-o', process.platform === 'win32' ? 'NUL' : '/dev/null', '-w', '%{http_code}', target.url], { timeoutMs: 18000, maxBuffer: 64 * 1024 });
                const status = Number(processResult.stdout.trim() || 0);
                results.push({
                    id: target.id,
                    label: target.label,
                    ok: processResult.ok && status >= 200 && status < 500,
                    status,
                    durationMs: Date.now() - startedAt,
                });
            }
            catch (error) {
                results.push({
                    id: target.id,
                    label: target.label,
                    ok: false,
                    status: 0,
                    durationMs: Date.now() - startedAt,
                    error: runtime.redactSecretText(error instanceof Error ? error.message : String(error)),
                });
            }
        }
        return { ok: results.every((result) => result.ok), testedAt: runtime.nowISO(), results };
    }

    exposeRuntime({ "proxySettingsEnvKeys": () => proxySettingsEnvKeys, "parseProxySettingsEnvText": () => parseProxySettingsEnvText, "readProxySettingsEnvValues": () => readProxySettingsEnvValues, "proxySettingsCurrentValues": () => proxySettingsCurrentValues, "escapeProxySettingsEnvValue": () => escapeProxySettingsEnvValue, "writeProxySettingsEnvValues": () => writeProxySettingsEnvValues, "applyProxySettingsProcessEnvValues": () => applyProxySettingsProcessEnvValues, "mihomoBinary": () => mihomoBinary, "mihomoConfigDir": () => mihomoConfigDir, "mihomoConfigFile": () => mihomoConfigFile, "mihomoProviderDir": () => mihomoProviderDir, "mihomoProviderFile": () => mihomoProviderFile, "mihomoProxyUrl": () => mihomoProxyUrl, "mihomoControllerUrl": () => mihomoControllerUrl, "yamlDouble": () => yamlDouble, "maskMihomoSubscriptionUrl": () => maskMihomoSubscriptionUrl, "sanitizeMihomoSubscriptionUrl": () => sanitizeMihomoSubscriptionUrl, "ensureMihomoSecret": () => ensureMihomoSecret, "buildMihomoConfig": () => buildMihomoConfig, "writeMihomoConfig": () => writeMihomoConfig, "normalizeMihomoProviderContent": () => normalizeMihomoProviderContent, "writeMihomoProviderContent": () => writeMihomoProviderContent, "removeMihomoProviderContent": () => removeMihomoProviderContent, "runCommand": () => runCommand, "restartMihomoService": () => restartMihomoService, "mihomoControllerRequest": () => mihomoControllerRequest, "mihomoServiceStatus": () => mihomoServiceStatus, "getMihomoSettings": () => getMihomoSettings, "saveMihomoSubscriptionSettings": () => saveMihomoSubscriptionSettings, "importMihomoProviderSettings": () => importMihomoProviderSettings, "selectMihomoProxy": () => selectMihomoProxy, "testMihomoProxy": () => testMihomoProxy }, {  });
}
