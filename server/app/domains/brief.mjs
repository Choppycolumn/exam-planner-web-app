export function installBriefDomain(runtime, exposeRuntime) {
    function defaultDailyBriefSettings() {
        return {
            enabled: true,
            generateTime: '08:00',
            cityName: '北京',
            latitude: 39.9042,
            longitude: 116.4074,
            marketSymbolsText: '上证指数|000001.SS\n深证成指|399001.SZ\n创业板指|399006.SZ\n纳斯达克|^IXIC\n标普500|^GSPC\nBTC|BTC-USD',
            wechat: {
                enabled: true,
            },
            taskReminders: {
                enabled: true,
                count: 1,
                offsetsMinutes: [60],
            },
            customWeeklyPush: {
                enabled: true,
                days: {
                    monday: '',
                    tuesday: '',
                    wednesday: '',
                    thursday: '',
                    friday: '',
                    saturday: '',
                    sunday: '',
                },
            },
            englishWritingPlan: defaultEnglishWritingPlanSettings(),
            email: {
                enabled: false,
                host: '',
                port: 465,
                secureMode: 'ssl',
                username: '',
                password: '',
                from: '',
                to: '',
                subjectPrefix: 'Exam Planner 今日简报',
            },
        };
    }
    const weekdayLabels = {
        monday: '周一',
        tuesday: '周二',
        wednesday: '周三',
        thursday: '周四',
        friday: '周五',
        saturday: '周六',
        sunday: '周日',
    };
    const weekdayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    function defaultEnglishWritingPlanSettings() {
        return {
            enabled: true,
            showOnDashboard: true,
            includeInBrief: true,
            dailyMinutes: '20-25 分钟',
            currentStageId: 'foundation',
            stages: [
                { id: 'foundation', name: '基础修复期', weeks: '第 1-4 周', focus: '把中文想法变成正确英文；修拼写、语法、搭配' },
                { id: 'past-paper', name: '真题强化期', weeks: '第 5-10 周', focus: '开始稳定写真题小作文和大作文，形成解题流程' },
                { id: 'sprint', name: '高分冲刺期', weeks: '第 11-19 周', focus: '限时写作、整卷训练、减少低级错误' },
                { id: 'stabilize', name: '考前稳定期', weeks: '第 20-24 周', focus: '固化自己的表达库，减少分数波动' },
            ],
            weeklyTasks: {
                monday: '6 句应用文功能句：邀请、建议、感谢、投诉等',
                tuesday: '真题或模拟题小作文：只写开头 + 主体段',
                wednesday: '修改周二作文，整理错误表达',
                thursday: '大作文：英文提纲 + 图画描述段',
                friday: '大作文：写一个主体分析段',
                saturday: '完整小作文一篇，限时 15 分钟',
                sunday: '闭卷重写本周小作文 + 复盘错句',
            },
        };
    }
    function normalizeEnglishWritingPlanSettings(input = {}, previous = null) {
        const defaults = defaultEnglishWritingPlanSettings();
        const previousSettings = previous?.englishWritingPlan || {};
        const rawStages = Array.isArray(input.stages)
            ? input.stages
            : Array.isArray(previousSettings.stages)
                ? previousSettings.stages
                : defaults.stages;
        const stages = rawStages.slice(0, 8).map((stage, index) => {
            const fallback = defaults.stages[index] || defaults.stages[0];
            const id = String(stage?.id || fallback.id || `stage-${index + 1}`)
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '')
                .slice(0, 40) || `stage-${index + 1}`;
            return {
                id,
                name: String(stage?.name || fallback.name || `阶段 ${index + 1}`).trim().slice(0, 80),
                weeks: String(stage?.weeks || fallback.weeks || '').trim().slice(0, 80),
                focus: String(stage?.focus || fallback.focus || '').trim().slice(0, 240),
            };
        });
        const inputTasks = input.weeklyTasks || {};
        const previousTasks = previousSettings.weeklyTasks || {};
        const weeklyTasks = {};
        for (const key of Object.keys(weekdayLabels)) {
            weeklyTasks[key] = String(inputTasks[key] ?? previousTasks[key] ?? defaults.weeklyTasks[key] ?? '').slice(0, 600);
        }
        const requestedStageId = String(input.currentStageId ?? previousSettings.currentStageId ?? defaults.currentStageId);
        const currentStageId = stages.some((stage) => stage.id === requestedStageId) ? requestedStageId : stages[0]?.id || defaults.currentStageId;
        return {
            enabled: Boolean(input.enabled ?? previousSettings.enabled ?? defaults.enabled),
            showOnDashboard: Boolean(input.showOnDashboard ?? previousSettings.showOnDashboard ?? defaults.showOnDashboard),
            includeInBrief: Boolean(input.includeInBrief ?? previousSettings.includeInBrief ?? defaults.includeInBrief),
            dailyMinutes: String(input.dailyMinutes ?? previousSettings.dailyMinutes ?? defaults.dailyMinutes).trim().slice(0, 40) || defaults.dailyMinutes,
            currentStageId,
            stages,
            weeklyTasks,
        };
    }
    function englishWritingPlanForDate(date, settings = getDailyBriefSettings({ includeSecret: true })) {
        const dayIndex = new Date(`${String(date || runtime.todayISO()).slice(0, 10)}T12:00:00+08:00`).getDay();
        const weekday = weekdayKeys[dayIndex] || 'monday';
        const config = settings.englishWritingPlan || defaultEnglishWritingPlanSettings();
        const currentStage = (config.stages || []).find((stage) => stage.id === config.currentStageId) || (config.stages || [])[0] || null;
        const todayTask = String(config.weeklyTasks?.[weekday] || '').trim();
        return {
            enabled: Boolean(config.enabled),
            showOnDashboard: Boolean(config.showOnDashboard),
            includeInBrief: Boolean(config.includeInBrief),
            date: String(date || runtime.todayISO()).slice(0, 10),
            weekday,
            weekdayLabel: weekdayLabels[weekday] || weekday,
            dailyMinutes: config.dailyMinutes || '20-25 分钟',
            currentStage,
            stages: config.stages || [],
            weeklyTasks: config.weeklyTasks || {},
            todayTask: Boolean(config.enabled) ? todayTask : '',
            hasTodayTask: Boolean(config.enabled && todayTask),
        };
    }
    function normalizeCustomWeeklyPushSettings(input = {}, previous = null) {
        const defaults = defaultDailyBriefSettings().customWeeklyPush;
        const previousSettings = previous?.customWeeklyPush || {};
        const inputDays = input.days || {};
        const previousDays = previousSettings.days || {};
        const days = {};
        for (const key of Object.keys(weekdayLabels)) {
            days[key] = String(inputDays[key] ?? previousDays[key] ?? defaults.days[key] ?? '').slice(0, 1200);
        }
        return {
            enabled: Boolean(input.enabled ?? previousSettings.enabled ?? defaults.enabled),
            days,
        };
    }
    function customWeeklyPushForDate(date, settings = getDailyBriefSettings({ includeSecret: true })) {
        const dayIndex = new Date(`${String(date || runtime.todayISO()).slice(0, 10)}T12:00:00+08:00`).getDay();
        const weekday = weekdayKeys[dayIndex] || 'monday';
        const config = settings.customWeeklyPush || defaultDailyBriefSettings().customWeeklyPush;
        const content = String(config.days?.[weekday] || '').trim();
        return {
            enabled: Boolean(config.enabled),
            date: String(date || runtime.todayISO()).slice(0, 10),
            weekday,
            weekdayLabel: weekdayLabels[weekday] || weekday,
            content: Boolean(config.enabled) ? content : '',
            hasContent: Boolean(config.enabled && content),
        };
    }
    function normalizeTaskReminderSettings(input = {}, previous = null) {
        const defaults = defaultDailyBriefSettings().taskReminders;
        const previousSettings = previous?.taskReminders || {};
        const enabled = Boolean(input.enabled ?? previousSettings.enabled ?? defaults.enabled);
        const rawOffsets = Array.isArray(input.offsetsMinutes) ? input.offsetsMinutes : previousSettings.offsetsMinutes || defaults.offsetsMinutes;
        const offsets = Array.from(new Set(rawOffsets
            .map((item) => Math.round(Number(item)))
            .filter((item) => Number.isInteger(item) && item >= 0 && item <= 30 * 24 * 60)))
            .sort((a, b) => b - a)
            .slice(0, 5);
        const requestedCount = Math.round(Number(input.count ?? previousSettings.count ?? (offsets.length || defaults.count)));
        const nextOffsets = offsets.length ? offsets : defaults.offsetsMinutes;
        const count = Math.max(1, Math.min(5, nextOffsets.length, Number.isFinite(requestedCount) ? requestedCount : defaults.count));
        return {
            enabled,
            count,
            offsetsMinutes: nextOffsets.slice(0, count),
        };
    }
    function normalizeDailyBriefSettings(input = {}, previous = null) {
        const defaults = defaultDailyBriefSettings();
        const previousEmail = previous?.email || {};
        const emailInput = input.email || {};
        const previousWechat = previous?.wechat || {};
        const wechatInput = input.wechat || {};
        const requestedPassword = typeof emailInput.password === 'string' ? emailInput.password : '';
        const preservedPassword = requestedPassword.trim() ? requestedPassword : previousEmail.password || '';
        const secureMode = ['ssl', 'starttls', 'none'].includes(emailInput.secureMode) ? emailInput.secureMode : defaults.email.secureMode;
        return {
            enabled: input.enabled !== false,
            generateTime: /^\d{2}:\d{2}$/.test(input.generateTime || '') ? input.generateTime : defaults.generateTime,
            cityName: String(input.cityName || defaults.cityName).trim() || defaults.cityName,
            latitude: Number.isFinite(Number(input.latitude)) ? Number(input.latitude) : defaults.latitude,
            longitude: Number.isFinite(Number(input.longitude)) ? Number(input.longitude) : defaults.longitude,
            marketSymbolsText: String(input.marketSymbolsText ?? defaults.marketSymbolsText),
            wechat: {
                enabled: Boolean(wechatInput.enabled ?? previousWechat.enabled ?? defaults.wechat.enabled),
            },
            taskReminders: normalizeTaskReminderSettings(input.taskReminders || {}, previous),
            customWeeklyPush: normalizeCustomWeeklyPushSettings(input.customWeeklyPush || {}, previous),
            englishWritingPlan: normalizeEnglishWritingPlanSettings(input.englishWritingPlan || {}, previous),
            email: {
                enabled: Boolean(emailInput.enabled),
                host: String(emailInput.host || previousEmail.host || '').trim(),
                port: Math.max(1, Math.min(65535, Number(emailInput.port || previousEmail.port || defaults.email.port))),
                secureMode,
                username: String(emailInput.username || previousEmail.username || '').trim(),
                password: preservedPassword,
                from: String(emailInput.from || previousEmail.from || '').trim(),
                to: String(emailInput.to || previousEmail.to || '').trim(),
                subjectPrefix: String(emailInput.subjectPrefix || previousEmail.subjectPrefix || defaults.email.subjectPrefix).trim() || defaults.email.subjectPrefix,
            },
        };
    }
    function encryptSettingSecret(value = '') {
        return runtime.settingsCrypto.encrypt(value);
    }
    function decryptSettingSecret(value = '') {
        return runtime.settingsCrypto.decrypt(value).value;
    }
    function storedDailyBriefSettings(settings) {
        const publicEmail = { ...settings.email };
        delete publicEmail.password;
        return {
            ...settings,
            email: { ...publicEmail, passwordEncrypted: encryptSettingSecret(settings.email.password || '') },
        };
    }
    function publicDailyBriefSettings(settings) {
        return {
            ...settings,
            email: {
                ...settings.email,
                password: '',
                hasPassword: Boolean(settings.email.password),
            },
            nextDailyBriefAt: runtime.runtimeScheduleValue('worker_next_daily_brief_at', runtime.nextDailyBriefAt),
        };
    }
    function getDailyBriefSettings({ includeSecret = false } = {}) {
        let parsed = {};
        let encryptedSecret = null;
        try {
            const raw = runtime.sqliteScalar(`SELECT value FROM app_metadata WHERE key = ${runtime.sqlString(runtime.dailyBriefSettingsKey)} LIMIT 1;`);
            parsed = raw ? JSON.parse(raw) : {};
            if (parsed.email?.passwordEncrypted && !parsed.email.password) {
                encryptedSecret = runtime.settingsCrypto.decrypt(parsed.email.passwordEncrypted);
                parsed.email.password = encryptedSecret.value;
            }
        }
        catch {
            parsed = {};
        }
        const settings = normalizeDailyBriefSettings(parsed);
        if ((parsed.email?.password && !parsed.email.passwordEncrypted) || encryptedSecret?.needsMigration) {
            runtime.runSqlite(`UPDATE app_metadata SET value = ${runtime.sqlString(JSON.stringify(storedDailyBriefSettings(settings)))}, updated_at = datetime('now') WHERE key = ${runtime.sqlString(runtime.dailyBriefSettingsKey)};`);
        }
        return includeSecret ? settings : publicDailyBriefSettings(settings);
    }
    function saveDailyBriefSettings(input = {}) {
        const previous = getDailyBriefSettings({ includeSecret: true });
        const settings = normalizeDailyBriefSettings(input, previous);
        runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES (${runtime.sqlString(runtime.dailyBriefSettingsKey)}, ${runtime.sqlString(JSON.stringify(storedDailyBriefSettings(settings)))}, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        scheduleDailyBrief();
        return publicDailyBriefSettings(settings);
    }
    function splitLines(value) {
        return String(value || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
    }
    function parseMarketSymbols(value) {
        return splitLines(value).map((line) => {
            const [name, symbol] = line.includes('|') ? line.split('|').map((item) => item.trim()) : [line.trim(), line.trim()];
            return { name: name || symbol, symbol: symbol || name };
        }).filter((item) => item.symbol);
    }
    async function fetchJsonWithTimeout(url, timeoutMs = 9000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: { 'user-agent': 'exam-planner-brief/1.0' },
            });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            return await response.json();
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    async function fetchJsonWithCurl(url, timeoutSeconds = 9) {
        const result = await runtime.runProcess('curl', ['-4', '-fsSL', '-A', 'exam-planner-brief/1.0', '--retry', '2', '--retry-delay', '1', '--retry-all-errors', '--max-time', String(timeoutSeconds), url], {
            timeoutMs: (timeoutSeconds + 3) * 1000,
            maxBuffer: 1024 * 1024,
        });
        if (!result.ok)
            throw result.error || new Error(result.stderr || `curl exited ${result.code}`);
        return JSON.parse(result.stdout);
    }
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    async function fetchJsonWithFallback(url, timeoutMs = 9000) {
        const errors = [];
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                return await fetchJsonWithTimeout(url, timeoutMs);
            }
            catch (error) {
                errors.push(error instanceof Error ? error.message : String(error));
                if (attempt === 0)
                    await wait(600);
            }
        }
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                return await fetchJsonWithCurl(url, Math.max(5, Math.ceil(timeoutMs / 1000)));
            }
            catch (error) {
                errors.push(`curl fallback: ${error instanceof Error ? error.message : String(error)}`);
                if (attempt === 0)
                    await wait(600);
            }
        }
        throw new Error(errors.join('; '));
    }
    async function fetchTextWithTimeout(url, timeoutMs = 9000, headers = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: { 'user-agent': 'exam-planner-brief/1.0', ...headers },
            });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            return await response.text();
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    async function fetchTextWithCurl(url, timeoutSeconds = 9) {
        const result = await runtime.runProcess('curl', ['-4', '-fsSL', '-A', 'exam-planner-brief/1.0', '--retry', '1', '--retry-delay', '1', '--retry-all-errors', '--max-time', String(timeoutSeconds), url], {
            timeoutMs: (timeoutSeconds + 3) * 1000,
            maxBuffer: 2 * 1024 * 1024,
        });
        if (!result.ok)
            throw result.error || new Error(result.stderr || `curl exited ${result.code}`);
        return result.stdout;
    }
    async function fetchTextWithProxyCurl(url, timeoutSeconds = 45) {
        const result = await runtime.runProcess('curl', ['-4', '-fsSL', '--compressed', '--proxy', 'http://127.0.0.1:7890', '-A', 'exam-planner-brief/1.0', '--retry', '1', '--retry-delay', '1', '--retry-all-errors', '--max-time', String(timeoutSeconds), url], {
            timeoutMs: (timeoutSeconds + 3) * 1000,
            maxBuffer: 4 * 1024 * 1024,
        });
        if (!result.ok)
            throw result.error || new Error(result.stderr || `proxy curl exited ${result.code}`);
        return result.stdout;
    }
    async function fetchTextWithFallback(url, timeoutMs = 9000, headers = {}) {
        const errors = [];
        try {
            return await fetchTextWithTimeout(url, timeoutMs, headers);
        }
        catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
        try {
            return await fetchTextWithCurl(url, Math.max(5, Math.ceil(timeoutMs / 1000)));
        }
        catch (error) {
            errors.push(`curl fallback: ${error instanceof Error ? error.message : String(error)}`);
        }
        throw new Error(errors.join('; '));
    }
    function parsePublicFundF10(code, text) {
        const rowMatch = String(text).match(/<tbody><tr><td>(\d{4}-\d{2}-\d{2})<\/td><td class='tor bold'>([0-9.]+)<\/td><td class='tor bold'>([0-9.]*)<\/td>/);
        if (!rowMatch)
            throw new Error('EastMoney F10 returned no net-value row');
        const price = Number(rowMatch[2]);
        if (!Number.isFinite(price) || price <= 0)
            throw new Error('EastMoney F10 returned invalid price');
        return {
            code,
            price,
            priceDate: rowMatch[1],
            source: '东方财富 F10 历史净值',
            provider: 'eastmoney-fund',
            raw: { cumulativeNetValue: rowMatch[3] || '', sourceKind: 'eastmoney-f10' },
        };
    }
    function dateBefore(dateText, days) {
        const date = new Date(`${dateText}T00:00:00+08:00`);
        if (Number.isNaN(date.getTime()))
            return '';
        date.setDate(date.getDate() - days);
        return date.toISOString().slice(0, 10);
    }
    function parsePublicFundGz(code, text) {
        const match = String(text).match(/jsonpgz\((.*)\);?$/);
        if (!match || !match[1])
            throw new Error('fundgz returned invalid JSONP');
        const payload = JSON.parse(match[1]);
        const price = Number(payload.dwjz || payload.gsz || 0);
        if (!payload.fundcode || !Number.isFinite(price) || price <= 0)
            throw new Error('fundgz returned no net value');
        return {
            code,
            name: payload.name || '',
            price,
            priceDate: payload.jzrq || String(payload.gztime || '').slice(0, 10) || runtime.todayISO(),
            source: '天天基金公开净值',
            provider: 'eastmoney-fund',
            raw: { ...payload, sourceKind: 'fundgz' },
        };
    }
    function parsePublicFundSearchProfile(code, payload) {
        const rows = Array.isArray(payload?.Datas) ? payload.Datas : [];
        const row = rows.find((item) => String(item?.CODE || item?._id || item?.BACKCODE || '') === code) ?? rows[0];
        if (!row)
            throw new Error('fund search returned no match');
        const base = row.FundBaseInfo && typeof row.FundBaseInfo === 'object' ? row.FundBaseInfo : {};
        const price = Number(base.DWJZ || 0);
        const minSubscription = Number(base.MINSG);
        return {
            code,
            name: String(row.NAME || base.SHORTNAME || ''),
            fundCompany: String(base.JJGS || ''),
            fundType: String(base.FTYPE || ''),
            minSubscription: Number.isFinite(minSubscription) ? minSubscription : null,
            isBuy: base.ISBUY == null ? null : String(base.ISBUY),
            price: Number.isFinite(price) && price > 0 ? price : null,
            priceDate: String(base.FSRQ || ''),
            source: '东方财富基金搜索公开资料',
            provider: 'eastmoney-fund',
            raw: {
                sourceKind: 'eastmoney-fund-search',
                category: row.CATEGORYDESC || row.CATEGORY || '',
                fundBaseInfo: base,
            },
        };
    }
    async function getPublicFundProfile(code) {
        const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(code)}`;
        return parsePublicFundSearchProfile(code, await fetchJsonWithTimeout(url, 4500));
    }
    function mergePublicFundProfile(quote, profile) {
        if (!profile)
            return quote;
        return {
            ...quote,
            name: quote.name || profile.name || '',
            fundCompany: profile.fundCompany || quote.fundCompany || '',
            fundType: profile.fundType || quote.fundType || '',
            minSubscription: profile.minSubscription ?? quote.minSubscription ?? null,
            isBuy: profile.isBuy ?? quote.isBuy ?? null,
            raw: { ...(quote.raw || {}), profile: profile.raw || profile },
        };
    }
    function quoteFromPublicFundProfile(profile) {
        if (!profile?.price)
            throw new Error('fund search returned no usable net value');
        return {
            code: profile.code,
            name: profile.name || '',
            fundCompany: profile.fundCompany || '',
            fundType: profile.fundType || '',
            minSubscription: profile.minSubscription ?? null,
            isBuy: profile.isBuy ?? null,
            price: profile.price,
            priceDate: profile.priceDate || runtime.todayISO(),
            source: profile.source,
            provider: 'eastmoney-fund',
            raw: profile.raw,
        };
    }
    async function getPublicFundQuote(code, dateText = '', includeProfile = false) {
        const normalizedCode = String(code || '').trim();
        if (!/^\d{6}$/.test(normalizedCode)) {
            const error = new Error('Invalid fund code');
            error.statusCode = 400;
            throw error;
        }
        const normalizedDate = String(dateText || '').trim();
        if (normalizedDate && !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
            const error = new Error('Invalid fund quote date');
            error.statusCode = 400;
            throw error;
        }
        const errors = [];
        let profile = null;
        if (includeProfile) {
            try {
                profile = await getPublicFundProfile(normalizedCode);
            }
            catch (error) {
                errors.push(`profile: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        const sdate = normalizedDate ? dateBefore(normalizedDate, 20) : '';
        const edate = normalizedDate || '';
        const f10Url = `https://fundf10.eastmoney.com/F10DataApi.aspx?type=lsjz&code=${encodeURIComponent(normalizedCode)}&page=1&per=${normalizedDate ? 20 : 1}&sdate=${encodeURIComponent(sdate)}&edate=${encodeURIComponent(edate)}&rt=${Date.now()}`;
        try {
            const quote = parsePublicFundF10(normalizedCode, await fetchTextWithFallback(f10Url, 7000, { referer: 'https://fundf10.eastmoney.com/' }));
            try {
                const gzUrl = `https://fundgz.1234567.com.cn/js/${encodeURIComponent(normalizedCode)}.js?rt=${Date.now()}`;
                const gz = parsePublicFundGz(normalizedCode, await fetchTextWithFallback(gzUrl, 3500, { referer: 'https://fund.eastmoney.com/' }));
                return mergePublicFundProfile({ ...quote, name: gz.name || quote.name || '', raw: { ...quote.raw, latestPublicName: gz.name || '' } }, profile);
            }
            catch {
                return mergePublicFundProfile(quote, profile);
            }
        }
        catch (error) {
            errors.push(`F10: ${error instanceof Error ? error.message : String(error)}`);
        }
        const gzUrl = `https://fundgz.1234567.com.cn/js/${encodeURIComponent(normalizedCode)}.js?rt=${Date.now()}`;
        try {
            return mergePublicFundProfile(parsePublicFundGz(normalizedCode, await fetchTextWithFallback(gzUrl, 7000, { referer: 'https://fund.eastmoney.com/' })), profile);
        }
        catch (error) {
            errors.push(`fundgz: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!profile) {
            try {
                profile = await getPublicFundProfile(normalizedCode);
            }
            catch (error) {
                errors.push(`profile: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (profile?.price)
            return quoteFromPublicFundProfile(profile);
        const error = new Error(errors.join('; '));
        error.statusCode = 502;
        throw error;
    }
    async function getPublicUsdCnyQuote() {
        const data = await fetchJsonWithFallback('https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY', 7000);
        const rate = Number(data?.rates?.CNY || 0);
        if (!Number.isFinite(rate) || rate <= 0)
            throw new Error('USD/CNY rate is empty');
        return {
            rate,
            source: 'Frankfurter / ECB reference rates',
            provider: 'frankfurter-fx',
            asOfDate: data.date || runtime.todayISO(),
        };
    }
    async function getPublicStablecoinRates() {
        let source = 'CoinGecko Simple Price';
        let usdtCny = 0;
        let usdcCny = 0;
        try {
            const data = await fetchJsonWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=tether,usd-coin&vs_currencies=usd,cny', 3500);
            usdtCny = Number(data?.tether?.cny || 0);
            usdcCny = Number(data?.['usd-coin']?.cny || 0);
        }
        catch (error) {
            const usdCny = await getPublicUsdCnyQuote();
            usdtCny = usdCny.rate;
            usdcCny = usdCny.rate;
            source = `USD/CNY fallback for stablecoins (CoinGecko unavailable: ${error instanceof Error ? error.message : String(error)})`;
        }
        if (!Number.isFinite(usdtCny) || usdtCny <= 0 || !Number.isFinite(usdcCny) || usdcCny <= 0) {
            const usdCny = await getPublicUsdCnyQuote();
            usdtCny = usdCny.rate;
            usdcCny = usdCny.rate;
            source = 'USD/CNY fallback for stablecoins';
        }
        return {
            rates: {
                'USDT/CNY': usdtCny,
                'USDC/CNY': usdcCny,
            },
            source,
            provider: 'coingecko-stablecoin',
            asOfDate: runtime.todayISO(),
        };
    }
    function weatherCodeText(code) {
        const labels = {
            0: '晴',
            1: '基本晴朗',
            2: '局部多云',
            3: '多云',
            45: '雾',
            48: '雾凇',
            51: '小毛毛雨',
            53: '毛毛雨',
            55: '较强毛毛雨',
            61: '小雨',
            63: '中雨',
            65: '大雨',
            71: '小雪',
            73: '中雪',
            75: '大雪',
            80: '阵雨',
            81: '较强阵雨',
            82: '强阵雨',
            95: '雷暴',
        };
        return labels[Number(code)] || '天气数据已获取';
    }
    async function getBriefWeatherBackup(settings, fallbackReason) {
        const url = `https://wttr.in/~${encodeURIComponent(settings.latitude)},${encodeURIComponent(settings.longitude)}?format=j1`;
        const data = await fetchJsonWithFallback(url, 10000);
        const current = data.current_condition?.[0] || {};
        const todayForecast = data.weather?.[0] || {};
        const hourly = todayForecast.hourly?.[0] || {};
        return {
            ok: true,
            cityName: settings.cityName,
            temperature: Number(current.temp_C ?? 0),
            humidity: Number(current.humidity ?? 0),
            windSpeed: Number(current.windspeedKmph ?? 0),
            precipitation: Number(current.precipMM ?? 0),
            weatherCode: Number(current.weatherCode ?? 0),
            condition: current.weatherDesc?.[0]?.value?.trim() || '天气数据已获取',
            maxTemperature: Number(todayForecast.maxtempC ?? current.temp_C ?? 0),
            minTemperature: Number(todayForecast.mintempC ?? current.temp_C ?? 0),
            precipitationProbability: Number(hourly.chanceofrain ?? 0),
            source: 'wttr.in',
            fallbackReason,
        };
    }
    async function getBriefWeather(settings) {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(settings.latitude)}&longitude=${encodeURIComponent(settings.longitude)}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FShanghai&forecast_days=1`;
        try {
            const data = await fetchJsonWithFallback(url);
            const current = data.current || {};
            const daily = data.daily || {};
            return {
                ok: true,
                cityName: settings.cityName,
                temperature: Number(current.temperature_2m ?? 0),
                humidity: Number(current.relative_humidity_2m ?? 0),
                windSpeed: Number(current.wind_speed_10m ?? 0),
                precipitation: Number(current.precipitation ?? 0),
                weatherCode: Number(current.weather_code ?? 0),
                condition: weatherCodeText(current.weather_code),
                maxTemperature: Number(daily.temperature_2m_max?.[0] ?? current.temperature_2m ?? 0),
                minTemperature: Number(daily.temperature_2m_min?.[0] ?? current.temperature_2m ?? 0),
                precipitationProbability: Number(daily.precipitation_probability_max?.[0] ?? 0),
                source: 'open-meteo',
            };
        }
        catch (error) {
            const primaryMessage = error instanceof Error ? error.message : String(error);
            try {
                return await getBriefWeatherBackup(settings, primaryMessage);
            }
            catch (backupError) {
                const backupMessage = backupError instanceof Error ? backupError.message : String(backupError);
                return { ok: false, cityName: settings.cityName, error: `${primaryMessage}; wttr fallback: ${backupMessage}` };
            }
        }
    }
    async function getBriefMarket(symbolItem) {
        const fromCrypto = await getCryptoMarket(symbolItem);
        if (fromCrypto)
            return fromCrypto;
        const fromWscn = await getWscnMarket(symbolItem);
        if (fromWscn)
            return fromWscn;
        const fromEastMoney = await getEastMoneyMarket(symbolItem);
        if (fromEastMoney)
            return fromEastMoney;
        const fromTradingView = await getTradingViewMarket(symbolItem);
        if (fromTradingView)
            return fromTradingView;
        const fromSina = await getSinaMarket(symbolItem);
        if (fromSina)
            return fromSina;
        const fromStooq = await getStooqMarket(symbolItem);
        if (fromStooq)
            return fromStooq;
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbolItem.symbol)}?range=5d&interval=1d`;
        try {
            const data = await fetchJsonWithTimeout(url);
            const result = data.chart?.result?.[0];
            if (!result)
                throw new Error('empty market response');
            const meta = result.meta || {};
            const closes = (result.indicators?.quote?.[0]?.close || []).filter((value) => typeof value === 'number');
            const current = Number(meta.regularMarketPrice ?? closes.at(-1) ?? 0);
            const previous = Number(meta.chartPreviousClose ?? closes.at(-2) ?? current);
            const change = Number((current - previous).toFixed(2));
            const changePercent = previous ? Number(((change / previous) * 100).toFixed(2)) : 0;
            return {
                ok: true,
                name: symbolItem.name,
                symbol: symbolItem.symbol,
                price: current,
                change,
                changePercent,
                currency: meta.currency || '',
            };
        }
        catch (error) {
            return {
                ok: false,
                name: symbolItem.name,
                symbol: symbolItem.symbol,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    async function getIndexPurchaseAssessment({ name, symbol, slug }) {
        try {
            const url = `https://worldperatio.com/index/${slug}/`;
            let result;
            try {
                result = await runtime.externalApiClient.text(url, {
                    timeoutMs: 20000,
                    retries: 1,
                    freshMs: 60 * 60 * 1000,
                    staleMs: 24 * 60 * 60 * 1000,
                    cacheKey: `pe:${slug}`,
                });
            }
            catch {
                result = { value: await fetchTextWithProxyCurl(url, 45), cacheStatus: 'proxy', fetchedAt: runtime.nowISO() };
            }
            const metrics = runtime.parseWorldPeRatio(result.value);
            return {
                ok: true,
                name,
                symbol,
                asOf: metrics.asOf,
                source: 'World P/E Ratio',
                cacheStatus: result.cacheStatus,
                fetchedAt: result.fetchedAt,
                ...metrics,
                ...runtime.scoreIndexPurchaseAssessment(metrics),
            };
        }
        catch (error) {
            return { ok: false, name, symbol, error: error instanceof Error ? error.message : String(error) };
        }
    }
    async function getIndexPurchaseAssessments() {
        const items = await Promise.all([
            getIndexPurchaseAssessment({ name: '纳指 100', symbol: '^NDX', slug: 'nasdaq-100' }),
            getIndexPurchaseAssessment({ name: '标普 500', symbol: '^GSPC', slug: 'sp-500' }),
        ]);
        return {
            methodology: '基于当前 PE 的近 5 年与近 10 年历史百分位，以及价格相对 50/200 日均线的位置进行平滑评分。',
            disclaimer: '仅作为长期定投节奏参考，不构成投资建议；避免一次性重仓，并结合自身现金流与风险承受能力。',
            items,
        };
    }
    const cryptoIdMap = {
        BTC: 'bitcoin',
        BITCOIN: 'bitcoin',
        ETH: 'ethereum',
        ETHER: 'ethereum',
        BNB: 'binancecoin',
        SOL: 'solana',
        XRP: 'ripple',
        DOGE: 'dogecoin',
        ADA: 'cardano',
        AVAX: 'avalanche-2',
        TON: 'the-open-network',
        LINK: 'chainlink',
        DOT: 'polkadot',
        TRX: 'tron',
        LTC: 'litecoin',
        BCH: 'bitcoin-cash',
    };
    function cryptoSymbolKey(symbol) {
        const value = String(symbol || '').toUpperCase().trim();
        return value
            .replace(/[-_/]?(USD|USDT|USDC|CNY|CNH)$/i, '')
            .replace(/[^A-Z0-9]/g, '');
    }
    async function getCryptoMarket(symbolItem) {
        const key = cryptoSymbolKey(symbolItem.symbol);
        const id = cryptoIdMap[key];
        if (!id)
            return null;
        const fromCryptoCompare = await getCryptoCompareMarket(symbolItem, key);
        if (fromCryptoCompare)
            return fromCryptoCompare;
        try {
            const data = await fetchJsonWithTimeout(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true`, 9000);
            const quote = data[id] || {};
            const price = Number(quote.usd || 0);
            const changePercent = Number(quote.usd_24h_change || 0);
            if (!Number.isFinite(price) || !price)
                throw new Error('empty coingecko response');
            return {
                ok: true,
                name: symbolItem.name || key,
                symbol: symbolItem.symbol,
                price: Number(price.toFixed(price >= 100 ? 2 : 4)),
                change: null,
                changePercent: Number(changePercent.toFixed(2)),
                currency: 'USD',
            };
        }
        catch {
            return null;
        }
    }
    async function getCryptoCompareMarket(symbolItem, key) {
        try {
            const data = await fetchJsonWithTimeout(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${encodeURIComponent(key)}&tsyms=USD`, 9000);
            const quote = data.RAW?.[key]?.USD;
            if (!quote)
                throw new Error('empty cryptocompare response');
            const price = Number(quote.PRICE || 0);
            const changePercent = Number(quote.CHANGEPCT24HOUR ?? quote.CHANGEPCTDAY ?? 0);
            const change = Number(quote.CHANGE24HOUR ?? quote.CHANGEDAY ?? 0);
            if (!Number.isFinite(price) || !price)
                throw new Error('empty cryptocompare price');
            return {
                ok: true,
                name: symbolItem.name || key,
                symbol: symbolItem.symbol,
                price: Number(price.toFixed(price >= 100 ? 2 : 4)),
                change: Number(change.toFixed(price >= 100 ? 2 : 4)),
                changePercent: Number(changePercent.toFixed(2)),
                currency: 'USD',
            };
        }
        catch {
            try {
                const data = await fetchJsonWithCurl(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${encodeURIComponent(key)}&tsyms=USD`, 9);
                const quote = data.RAW?.[key]?.USD;
                const price = Number(quote?.PRICE || 0);
                if (!Number.isFinite(price) || !price)
                    return null;
                const changePercent = Number(quote.CHANGEPCT24HOUR ?? quote.CHANGEPCTDAY ?? 0);
                const change = Number(quote.CHANGE24HOUR ?? quote.CHANGEDAY ?? 0);
                return {
                    ok: true,
                    name: symbolItem.name || key,
                    symbol: symbolItem.symbol,
                    price: Number(price.toFixed(price >= 100 ? 2 : 4)),
                    change: Number(change.toFixed(price >= 100 ? 2 : 4)),
                    changePercent: Number(changePercent.toFixed(2)),
                    currency: 'USD',
                };
            }
            catch {
                return null;
            }
        }
    }
    async function getWscnMarket(symbolItem) {
        const value = String(symbolItem.symbol || '').toUpperCase();
        if (!/^\d{6}\.(SS|SH|SZ)$/.test(value))
            return null;
        try {
            const normalized = value.replace(/\.SH$/, '.SS');
            const url = `https://api-ddc-wscn.awtmt.com/market/real?fields=prod_name,last_px,px_change,px_change_rate&prod_code=${encodeURIComponent(normalized)}`;
            const data = await fetchJsonWithTimeout(url, 9000);
            const item = data.data?.snapshot?.[normalized];
            if (!Array.isArray(item))
                throw new Error('empty wscn market response');
            const current = Number(item[1] || 0);
            const change = Number(item[2] || 0);
            const changePercent = Number(item[3] || 0);
            if (!Number.isFinite(current) || !current)
                throw new Error('empty wscn market price');
            return {
                ok: true,
                name: symbolItem.name || item[0] || symbolItem.symbol,
                symbol: symbolItem.symbol,
                price: Number(current.toFixed(2)),
                change: Number(change.toFixed(2)),
                changePercent: Number(changePercent.toFixed(2)),
                currency: 'CNY',
            };
        }
        catch {
            return null;
        }
    }
    function tradingViewTicker(symbol) {
        const value = String(symbol || '').toUpperCase().trim();
        const map = {
            '^VN30': 'HOSE:VN30',
            VN30: 'HOSE:VN30',
            'VN30.VN': 'HOSE:VN30',
            '^VNI': 'HOSE:VNINDEX',
            VNINDEX: 'HOSE:VNINDEX',
        };
        if (map[value])
            return map[value];
        if (/^[A-Z]+:[A-Z0-9._-]+$/.test(value))
            return value;
        return '';
    }
    async function getTradingViewMarket(symbolItem) {
        const ticker = tradingViewTicker(symbolItem.symbol);
        if (!ticker)
            return null;
        try {
            const response = await fetch('https://scanner.tradingview.com/vietnam/scan', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'user-agent': 'exam-planner-brief/1.0',
                },
                body: JSON.stringify({
                    symbols: { tickers: [ticker], query: { types: [] } },
                    columns: ['name', 'close', 'change', 'change_abs'],
                }),
            });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const row = data.data?.[0]?.d;
            if (!Array.isArray(row))
                throw new Error('empty tradingview response');
            const price = Number(row[1] || 0);
            const changePercent = Number(row[2] || 0);
            const change = Number(row[3] || 0);
            if (!Number.isFinite(price) || !price)
                throw new Error('empty tradingview price');
            return {
                ok: true,
                name: symbolItem.name || row[0] || symbolItem.symbol,
                symbol: symbolItem.symbol,
                price: Number(price.toFixed(2)),
                change: Number(change.toFixed(2)),
                changePercent: Number(changePercent.toFixed(2)),
                currency: 'VND',
            };
        }
        catch {
            return null;
        }
    }
    function eastMoneySecId(symbol) {
        const value = String(symbol || '').toUpperCase();
        const globalMap = {
            '^IXIC': '100.NDX',
            '^NDX': '100.NDX',
            NDX: '100.NDX',
            '^GSPC': '100.SPX',
            '^SPX': '100.SPX',
            SPX: '100.SPX',
            '^N225': '100.N225',
            '^NIKKEI': '100.N225',
            NIKKEI: '100.N225',
            '^HSI': '100.HSI',
            HSI: '100.HSI',
            '^VN30': '100.VNINDEX',
            VN30: '100.VNINDEX',
            'VN30.VN': '100.VNINDEX',
            '^VNI': '100.VNINDEX',
            VNINDEX: '100.VNINDEX',
        };
        if (globalMap[value])
            return globalMap[value];
        if (/^\d{6}\.(SS|SH)$/.test(value))
            return `1.${value.slice(0, 6)}`;
        if (/^\d{6}\.SZ$/.test(value))
            return `0.${value.slice(0, 6)}`;
        return '';
    }
    async function getEastMoneyMarket(symbolItem) {
        const secId = eastMoneySecId(symbolItem.symbol);
        if (!secId)
            return null;
        try {
            const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(secId)}&fields=f43,f57,f58,f169,f170`;
            let data;
            try {
                data = await fetchJsonWithTimeout(url, 9000);
            }
            catch {
                data = await fetchJsonWithCurl(url, 9);
            }
            const quote = data.data || {};
            const current = Number(quote.f43 || 0) / 100;
            const change = Number(quote.f169 || 0) / 100;
            const changePercent = Number(quote.f170 || 0) / 100;
            if (!Number.isFinite(current) || !current)
                throw new Error('empty eastmoney market response');
            const isVietnamProxy = ['^VN30', 'VN30', 'VN30.VN'].includes(String(symbolItem.symbol || '').toUpperCase().trim());
            return {
                ok: true,
                name: isVietnamProxy
                    ? `${symbolItem.name || '越南VN30'} (VNINDEX proxy)`
                    : symbolItem.name || quote.f58 || symbolItem.symbol,
                symbol: symbolItem.symbol,
                price: Number(current.toFixed(2)),
                change: Number(change.toFixed(2)),
                changePercent: Number(changePercent.toFixed(2)),
                currency: /^\d{6}\.(SS|SH|SZ)$/i.test(String(symbolItem.symbol || '')) ? 'CNY' : '',
            };
        }
        catch {
            return null;
        }
    }
    function sinaMarketCode(symbol) {
        const value = String(symbol || '').toUpperCase();
        if (/^\d{6}\.SS$/.test(value))
            return `sh${value.slice(0, 6)}`;
        if (/^\d{6}\.SZ$/.test(value))
            return `sz${value.slice(0, 6)}`;
        return '';
    }
    async function getSinaMarket(symbolItem) {
        const code = sinaMarketCode(symbolItem.symbol);
        if (!code)
            return null;
        try {
            const text = await fetchTextWithTimeout(`https://hq.sinajs.cn/list=${code}`, 9000, { referer: 'https://finance.sina.com.cn' });
            const match = text.match(/="([^"]*)"/);
            const fields = match?.[1]?.split(',') || [];
            const previous = Number(fields[2] || 0);
            const current = Number(fields[3] || 0);
            if (!Number.isFinite(current) || !current)
                throw new Error('empty sina market response');
            const change = Number((current - previous).toFixed(2));
            const changePercent = previous ? Number(((change / previous) * 100).toFixed(2)) : 0;
            return {
                ok: true,
                name: ['^VN30', 'VN30', 'VN30.VN'].includes(String(symbolItem.symbol || '').toUpperCase().trim())
                    ? `${symbolItem.name} (VNM ETF proxy)`
                    : symbolItem.name,
                symbol: symbolItem.symbol,
                price: Number(current.toFixed(2)),
                change,
                changePercent,
                currency: 'CNY',
            };
        }
        catch {
            return null;
        }
    }
    function stooqMarketSymbol(symbol) {
        const map = {
            '^GSPC': '^spx',
            '^IXIC': '^ndq',
            '^DJI': '^dji',
            '^N225': '^nkx',
            '^NIKKEI': '^nkx',
            '^HSI': '^hsi',
            '^VN30': 'vnm.us',
            VN30: 'vnm.us',
            'VN30.VN': 'vnm.us',
            'BTC-USD': 'btcusd',
            BTC: 'btcusd',
            ETH: 'ethusd',
            'ETH-USD': 'ethusd',
        };
        const value = String(symbol || '').toUpperCase().trim();
        if (map[value])
            return map[value];
        if (/^[A-Z]{1,5}$/.test(value))
            return `${value.toLowerCase()}.us`;
        if (/^[A-Z]{1,5}\.US$/.test(value))
            return value.toLowerCase();
        if (/^\d{4,5}\.HK$/.test(value))
            return value.toLowerCase();
        return '';
    }
    async function getStooqMarket(symbolItem) {
        const symbol = stooqMarketSymbol(symbolItem.symbol);
        if (!symbol)
            return null;
        try {
            const text = await fetchTextWithTimeout(`https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`, 9000);
            const lines = text.trim().split(/\r?\n/);
            const fields = lines[1]?.split(',') || [];
            const open = Number(fields[3] || 0);
            const current = Number(fields[6] || 0);
            if (!Number.isFinite(current) || !current)
                throw new Error('empty stooq market response');
            const change = Number((current - open).toFixed(2));
            const changePercent = open ? Number(((change / open) * 100).toFixed(2)) : 0;
            return {
                ok: true,
                name: ['^VN30', 'VN30', 'VN30.VN'].includes(String(symbolItem.symbol || '').toUpperCase().trim())
                    ? `${symbolItem.name} (VNM ETF proxy)`
                    : symbolItem.name,
                symbol: symbolItem.symbol,
                price: Number(current.toFixed(2)),
                change,
                changePercent,
                currency: symbol === 'vnm.us' || symbolItem.symbol === 'BTC-USD' ? 'USD' : '',
            };
        }
        catch {
            return null;
        }
    }
    function getDailyBriefLearningSummary(date) {
        const yesterday = runtime.addDaysISO(date, -1);
        const activeGoal = runtime.sqliteJson(`SELECT name, deadline FROM goals WHERE user_id = 1 AND is_active = 1 ORDER BY id LIMIT 1;`)[0] || null;
        const yesterdayReview = runtime.sqliteJson(`SELECT date, summary, wins, problems, tomorrow_plan AS tomorrowPlan, score
    FROM daily_reviews WHERE user_id = 1 AND date = ${runtime.sqlString(yesterday)} LIMIT 1;`).map(runtime.normalizeReview)[0] || null;
        const todayTasks = runtime.sqliteJson(`SELECT id, title, due_date AS dueDate, due_time AS dueTime, urgency, is_completed AS isCompleted,
    reminder_enabled AS reminderEnabled, reminder_sent_offsets AS reminderSentOffsets, reminder_last_sent_at AS reminderLastSentAt
    FROM short_term_tasks
    WHERE user_id = 1 AND due_date <= ${runtime.sqlString(date)} AND is_completed = 0
    ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date, due_time, id
    LIMIT 8;`).map(runtime.normalizeTaskRow);
        const latestExam = runtime.sqliteJson(`SELECT date, subject_name_snapshot AS subjectName, score, full_score AS fullScore, paper_name AS paperName
    FROM mock_exam_records WHERE user_id = 1 ORDER BY date DESC, id DESC LIMIT 1;`)[0] || null;
        const yesterdayMinutes = Number(runtime.sqliteScalar(`SELECT COALESCE(total_minutes, 0) FROM study_daily_summaries WHERE date = ${runtime.sqlString(yesterday)};`) || 0);
        const last7Minutes = Number(runtime.sqliteScalar(`SELECT COALESCE(SUM(total_minutes), 0) FROM study_daily_summaries WHERE date BETWEEN ${runtime.sqlString(runtime.addDaysISO(date, -6))} AND ${runtime.sqlString(date)};`) || 0);
        return {
            activeGoal: activeGoal ? {
                name: activeGoal.name,
                deadline: activeGoal.deadline,
                daysLeft: Math.max(0, Math.ceil((runtime.parseDateString(activeGoal.deadline).getTime() - runtime.parseDateString(date).getTime()) / (24 * 60 * 60 * 1000))),
            } : null,
            yesterday,
            yesterdayMinutes,
            last7Minutes,
            yesterdayReview,
            todayTasks,
            latestExam,
            topErrorThemes: runtime.getErrorThemePeriodSummary(runtime.addDaysISO(date, -6), date, 5),
        };
    }
    function dailyBriefTitle(date) {
        return `${date} 晨间简报`;
    }
    function dailyBriefRowToObject(row) {
        if (!row)
            return null;
        let payload = {};
        try {
            payload = row.payloadJson ? JSON.parse(row.payloadJson) : {};
        }
        catch {
            payload = {};
        }
        return {
            id: Number(row.id),
            date: row.date,
            title: row.title,
            status: row.status,
            emailedAt: row.emailedAt || null,
            emailError: row.emailError || '',
            generatedAt: row.generatedAt,
            updatedAt: row.updatedAt,
            payload,
        };
    }
    function getDailyBriefByDate(date = runtime.todayISO()) {
        const row = runtime.sqliteJson(`SELECT id, date, title, payload_json AS payloadJson, status, emailed_at AS emailedAt,
    email_error AS emailError, generated_at AS generatedAt, updated_at AS updatedAt
    FROM daily_briefs WHERE date = ${runtime.sqlString(date)} LIMIT 1;`)[0];
        return dailyBriefRowToObject(row);
    }
    function getLatestDailyBriefSummary() {
        const row = runtime.sqliteJson(`SELECT id, date, title, payload_json AS payloadJson, status, emailed_at AS emailedAt,
    email_error AS emailError, generated_at AS generatedAt, updated_at AS updatedAt
    FROM daily_briefs ORDER BY date DESC, id DESC LIMIT 1;`)[0];
        return dailyBriefRowToObject(row);
    }
    function listDailyBriefs(limit = 30) {
        return runtime.sqliteJson(`SELECT id, date, title, payload_json AS payloadJson, status, emailed_at AS emailedAt,
    email_error AS emailError, generated_at AS generatedAt, updated_at AS updatedAt
    FROM daily_briefs ORDER BY date DESC, id DESC LIMIT ${Math.max(1, Math.min(100, Number(limit) || 30))};`).map(dailyBriefRowToObject);
    }
    async function generateDailyBrief({ date = runtime.todayISO(), trigger = 'manual', sendEmail = false, sendWechat = false } = {}) {
        const settings = getDailyBriefSettings({ includeSecret: true });
        const generatedAt = runtime.nowISO();
        const marketSymbols = parseMarketSymbols(settings.marketSymbolsText).slice(0, 12);
        const [weather, markets, indexPurchaseAssessment] = await Promise.all([
            getBriefWeather(settings),
            Promise.all(marketSymbols.map(getBriefMarket)),
            getIndexPurchaseAssessments(),
        ]);
        const payload = {
            date,
            title: dailyBriefTitle(date),
            generatedAt,
            trigger,
            customWeeklyPush: customWeeklyPushForDate(date, settings),
            englishWritingPlan: englishWritingPlanForDate(date, settings),
            weather,
            markets,
            indexPurchaseAssessment,
            learning: getDailyBriefLearningSummary(date),
        };
        let emailedAt = null;
        let emailError = '';
        if (sendEmail || (trigger === 'auto' && settings.email.enabled)) {
            if (!settings.email.enabled) {
                emailError = '邮件推送未启用';
            }
            else {
                try {
                    await sendDailyBriefEmail(payload, settings.email);
                    emailedAt = runtime.nowISO();
                }
                catch (error) {
                    emailError = error instanceof Error ? error.message : String(error);
                }
            }
        }
        let wechatDelivery = null;
        let wechatError = '';
        runtime.runSqlite(`INSERT INTO daily_briefs (date, title, payload_json, status, emailed_at, email_error, generated_at, updated_at)
    VALUES (${runtime.sqlString(date)}, ${runtime.sqlString(payload.title)}, ${runtime.sqlString(JSON.stringify(payload))}, 'completed', ${runtime.sqlValue(emailedAt)}, ${runtime.sqlString(emailError)}, ${runtime.sqlString(generatedAt)}, ${runtime.sqlString(runtime.nowISO())})
    ON CONFLICT(date) DO UPDATE SET
      title = excluded.title,
      payload_json = excluded.payload_json,
      status = excluded.status,
      emailed_at = COALESCE(excluded.emailed_at, daily_briefs.emailed_at),
      email_error = excluded.email_error,
      generated_at = excluded.generated_at,
      updated_at = excluded.updated_at;`);
        runtime.tableChanged();
        const brief = getDailyBriefByDate(date);
        if (sendWechat || (trigger === 'auto' && settings.wechat.enabled)) {
            const digest = runtime.buildClawbotDailyDigest(date);
            wechatDelivery = runtime.queueProactiveNotification({
                eventKey: `brief:${date}`,
                source: 'brief',
                title: payload.title,
                content: '每日简报已进入微信主动推送队列。',
                text: digest.text,
                payload: { date, trigger },
            });
            runtime.logStructured('info', 'daily_brief_wechat_queued', {
                date,
                trigger,
                deliveryId: wechatDelivery.deliveryId,
            });
        }
        const warningText = [emailError ? `邮件推送失败：${emailError}` : '', wechatError ? `微信推送失败：${wechatError}` : ''].filter(Boolean).join('；');
        runtime.notifyEvent({
            eventKey: `brief:${date}`,
            source: 'brief',
            severity: warningText ? 'warning' : 'info',
            title: payload.title,
            content: warningText ? `每日简报已生成，但${warningText}` : '每日简报已生成，可在通知中心查看。',
            payload: {
                date,
                trigger,
                emailedAt,
                emailError,
                wechatPushed: Boolean(wechatDelivery?.ok),
                wechatError,
                wechatDelivery: wechatDelivery ? {
                    method: wechatDelivery.method || '',
                    channel: wechatDelivery.channel || '',
                    messageId: wechatDelivery.messageId || null,
                    response: wechatDelivery.response || null,
                } : null,
            },
        });
        return brief;
    }
    function nextChinaWallClockDelay(timeText = '07:00') {
        const [hourRaw, minuteRaw] = String(timeText).split(':').map(Number);
        const hour = Math.max(0, Math.min(23, Number.isFinite(hourRaw) ? hourRaw : 7));
        const minute = Math.max(0, Math.min(59, Number.isFinite(minuteRaw) ? minuteRaw : 0));
        const now = new Date();
        const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        const targetChina = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate(), hour, minute, 0, 0));
        if (chinaNow >= targetChina)
            targetChina.setUTCDate(targetChina.getUTCDate() + 1);
        const targetUtcMs = targetChina.getTime() - 8 * 60 * 60 * 1000;
        runtime.nextDailyBriefAt = new Date(targetUtcMs).toISOString();
        runtime.setRuntimeMetadata('worker_next_daily_brief_at', runtime.nextDailyBriefAt);
        return Math.max(60 * 1000, targetUtcMs - now.getTime());
    }
    function scheduleDailyBrief() {
        const settings = getDailyBriefSettings({ includeSecret: true });
        const delay = nextChinaWallClockDelay(settings.generateTime);
        runtime.dailyBriefTimer = runtime.scheduler.scheduleOnce('daily-brief', delay, async () => {
            try {
                if (getDailyBriefSettings({ includeSecret: true }).enabled) {
                    await runtime.runExclusiveTask('daily-brief', 'auto', () => generateDailyBrief({ date: runtime.todayISO(), trigger: 'auto', sendEmail: true, sendWechat: true }), { timeoutMs: 4 * 60 * 1000 });
                }
            }
            catch (error) {
                runtime.logStructured('error', 'daily_brief_failed', { error: runtime.redactSecretText(error.message || String(error)) });
            }
            finally {
                scheduleDailyBrief();
            }
        });
    }
    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function encodeMailHeader(value) {
        return `=?UTF-8?B?${Buffer.from(String(value), 'utf8').toString('base64')}?=`;
    }
    function dailyBriefStudyPushHtml(learning = {}) {
        const tasks = Array.isArray(learning.todayTasks) ? learning.todayTasks : [];
        const themes = Array.isArray(learning.topErrorThemes) ? learning.topErrorThemes : [];
        const yesterdayMinutes = Number(learning.yesterdayMinutes || 0);
        const items = [];
        if (learning.activeGoal?.daysLeft != null) {
            items.push(`距离「${learning.activeGoal.name}」还有 ${learning.activeGoal.daysLeft} 天，今天至少完成一个能推进长期目标的硬任务。`);
        }
        if (learning.yesterdayReview?.tomorrowPlan) {
            items.push(`优先执行昨日写给今天的计划：${runtime.compactText(learning.yesterdayReview.tomorrowPlan, 90)}`);
        }
        if (tasks.length) {
            items.push(`今天有 ${tasks.length} 个待推进短期目标，先从最紧急的一项开始，不要等到晚上再补。`);
        }
        if (yesterdayMinutes < 180) {
            items.push('昨日学习时长偏少，今天先用一个 30 分钟启动块把状态拉起来。');
        }
        else {
            items.push(`昨日已学习 ${runtime.minutesText(yesterdayMinutes)}，今天的重点是延续节奏，而不是重新找感觉。`);
        }
        if (themes[0]) {
            items.push(`近期高频问题是「${themes[0].label}」，今天学习时专门留意这个坑，结束后在复盘里写清楚是否改善。`);
        }
        return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    }
    function dailyBriefHtml(payload) {
        const weather = payload.weather || {};
        const markets = payload.markets || [];
        const indexPurchaseAssessment = payload.indexPurchaseAssessment || {};
        const customWeeklyPush = payload.customWeeklyPush || {};
        const englishWritingPlan = payload.englishWritingPlan || {};
        const assessmentRows = (indexPurchaseAssessment.items || []).map((item) => item.ok
            ? `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.signal)}</td><td>${escapeHtml(item.pe)}（5 年 ${escapeHtml(item.pePercentile5)}% / 10 年 ${escapeHtml(item.pePercentile10)}%）</td><td>${escapeHtml(item.sma50Margin)}% / ${escapeHtml(item.sma200Margin)}%</td><td>${escapeHtml(item.intensity)}</td></tr>`
            : `<tr><td>${escapeHtml(item.name)}</td><td colspan="4">评估失败：${escapeHtml(item.error || '')}</td></tr>`).join('');
        const learning = payload.learning || {};
        const taskItems = (learning.todayTasks || []).map((task) => `<li>${escapeHtml(task.title)} <span style="color:#64748b">(${escapeHtml(task.urgency)} / ${escapeHtml(task.dueTime ? `${task.dueDate} ${task.dueTime}` : task.dueDate)})</span></li>`).join('');
        const marketRows = markets.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.symbol)}</td><td>${item.ok ? escapeHtml(item.price) : '失败'}</td><td style="color:${Number(item.changePercent || 0) >= 0 ? '#16a34a' : '#dc2626'}">${item.ok ? `${escapeHtml(item.changePercent)}%` : escapeHtml(item.error || '')}</td></tr>`).join('');
        const studyPush = dailyBriefStudyPushHtml(learning);
        return `<!doctype html>
    <html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;line-height:1.6">
      <h1>${escapeHtml(payload.title)}</h1>
      <p style="color:#64748b">生成时间：${escapeHtml(new Date(payload.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))}</p>
      <h2>天气</h2>
      <p>${escapeHtml(weather.cityName || '')}：${weather.ok ? `${escapeHtml(weather.condition)}，${escapeHtml(weather.temperature)}℃，${escapeHtml(weather.minTemperature)}-${escapeHtml(weather.maxTemperature)}℃，降水概率 ${escapeHtml(weather.precipitationProbability)}%` : `获取失败：${escapeHtml(weather.error || '')}`}</p>
      <h2>学习提醒</h2>
      <p>昨日学习：${Math.round(Number(learning.yesterdayMinutes || 0) / 60 * 10) / 10} 小时；近 7 天累计：${Math.round(Number(learning.last7Minutes || 0) / 60 * 10) / 10} 小时。</p>
      ${englishWritingPlan.enabled && englishWritingPlan.includeInBrief ? `<h2>英语写作计划</h2><p><strong>当前阶段：</strong>${escapeHtml(englishWritingPlan.currentStage?.name || '未设置')} ${englishWritingPlan.currentStage?.weeks ? `（${escapeHtml(englishWritingPlan.currentStage.weeks)}）` : ''}</p><p><strong>阶段重点：</strong>${escapeHtml(englishWritingPlan.currentStage?.focus || '')}</p><p><strong>${escapeHtml(englishWritingPlan.weekdayLabel || '今日')}任务：</strong>${escapeHtml(englishWritingPlan.todayTask || '今天未设置固定写作任务')}；建议用时 ${escapeHtml(englishWritingPlan.dailyMinutes || '20-25 分钟')}。</p>` : ''}
      ${customWeeklyPush.hasContent ? `<h2>${escapeHtml(customWeeklyPush.weekdayLabel || '今日')}自定义推送</h2><p style="white-space:pre-wrap">${escapeHtml(customWeeklyPush.content)}</p>` : ''}
      <h2>今日学习督促</h2>
      ${studyPush}
      ${learning.yesterdayReview ? `<p><strong>昨日问题：</strong>${escapeHtml(learning.yesterdayReview.problems || '未填写')}</p>` : '<p>昨日尚未填写复盘。</p>'}
      ${taskItems ? `<p><strong>今日待推进：</strong></p><ul>${taskItems}</ul>` : '<p>今日暂无到期短期目标。</p>'}
      <h2>指数与资产</h2>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;border-color:#e2e8f0"><thead><tr><th>名称</th><th>代码</th><th>最新</th><th>涨跌</th></tr></thead><tbody>${marketRows || '<tr><td colspan="4">暂无配置</td></tr>'}</tbody></table>
      <h2>纳指 100 / 标普 500 定投评估</h2>
      <p>${escapeHtml(indexPurchaseAssessment.methodology || '')}</p>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;border-color:#e2e8f0"><thead><tr><th>指数</th><th>结论</th><th>PE</th><th>距 50/200 日均线</th><th>定投强度参考</th></tr></thead><tbody>${assessmentRows || '<tr><td colspan="5">暂无评估数据</td></tr>'}</tbody></table>
      <p style="color:#64748b">${escapeHtml(indexPurchaseAssessment.disclaimer || '')}</p>
    </body></html>`;
    }
    function smtpReadResponse(socket, state) {
        return new Promise((resolve, reject) => {
            const onData = (chunk) => {
                state.buffer += chunk.toString('utf8');
                const lines = state.buffer.split(/\r?\n/);
                const lastComplete = state.buffer.endsWith('\n') ? lines : lines.slice(0, -1);
                const doneLine = lastComplete.find((line) => /^\d{3} /.test(line));
                if (!doneLine)
                    return;
                socket.off('data', onData);
                socket.off('error', onError);
                state.buffer = '';
                const code = Number(doneLine.slice(0, 3));
                if (code >= 400)
                    reject(new Error(`SMTP ${doneLine}`));
                else
                    resolve({ code, text: lastComplete.join('\n') });
            };
            const onError = (error) => {
                socket.off('data', onData);
                reject(error);
            };
            socket.on('data', onData);
            socket.once('error', onError);
        });
    }
    async function smtpSendLine(socket, state, line) {
        socket.write(`${line}\r\n`);
        return smtpReadResponse(socket, state);
    }
    async function sendDailyBriefEmail(payload, emailSettings) {
        const recipients = String(emailSettings.to || '').split(/[;,]/).map((item) => item.trim()).filter(Boolean);
        if (!emailSettings.host || !emailSettings.from || !recipients.length) {
            throw new Error('SMTP host/from/to 未完整配置');
        }
        let socket = await new Promise((resolve, reject) => {
            const connector = emailSettings.secureMode === 'ssl'
                ? runtime.tlsConnect({ host: emailSettings.host, port: emailSettings.port, servername: emailSettings.host }, () => resolve(connector))
                : runtime.netConnect({ host: emailSettings.host, port: emailSettings.port }, () => resolve(connector));
            connector.setTimeout(15000, () => reject(new Error('SMTP connection timeout')));
            connector.once('error', reject);
        });
        const state = { buffer: '' };
        try {
            await smtpReadResponse(socket, state);
            await smtpSendLine(socket, state, `EHLO ${emailSettings.host}`);
            if (emailSettings.secureMode === 'starttls') {
                await smtpSendLine(socket, state, 'STARTTLS');
                socket = runtime.tlsConnect({ socket, servername: emailSettings.host });
                await new Promise((resolve, reject) => {
                    socket.once('secureConnect', resolve);
                    socket.once('error', reject);
                });
                state.buffer = '';
                await smtpSendLine(socket, state, `EHLO ${emailSettings.host}`);
            }
            if (emailSettings.username) {
                await smtpSendLine(socket, state, 'AUTH LOGIN');
                await smtpSendLine(socket, state, Buffer.from(emailSettings.username, 'utf8').toString('base64'));
                await smtpSendLine(socket, state, Buffer.from(emailSettings.password || '', 'utf8').toString('base64'));
            }
            await smtpSendLine(socket, state, `MAIL FROM:<${emailSettings.from}>`);
            for (const recipient of recipients) {
                await smtpSendLine(socket, state, `RCPT TO:<${recipient}>`);
            }
            await smtpSendLine(socket, state, 'DATA');
            const subject = `${emailSettings.subjectPrefix || 'Exam Planner 今日简报'} - ${payload.date}`;
            const html = dailyBriefHtml(payload);
            const message = [
                `From: ${emailSettings.from}`,
                `To: ${recipients.join(', ')}`,
                `Subject: ${encodeMailHeader(subject)}`,
                'MIME-Version: 1.0',
                'Content-Type: text/html; charset=utf-8',
                'Content-Transfer-Encoding: 8bit',
                '',
                html,
            ].join('\r\n').replace(/\r\n\./g, '\r\n..');
            socket.write(`${message}\r\n.\r\n`);
            await smtpReadResponse(socket, state);
            await smtpSendLine(socket, state, 'QUIT').catch(() => undefined);
        }
        finally {
            socket.end();
        }
    }

    exposeRuntime({ "defaultDailyBriefSettings": () => defaultDailyBriefSettings, "weekdayLabels": () => weekdayLabels, "weekdayKeys": () => weekdayKeys, "defaultEnglishWritingPlanSettings": () => defaultEnglishWritingPlanSettings, "normalizeEnglishWritingPlanSettings": () => normalizeEnglishWritingPlanSettings, "englishWritingPlanForDate": () => englishWritingPlanForDate, "normalizeCustomWeeklyPushSettings": () => normalizeCustomWeeklyPushSettings, "customWeeklyPushForDate": () => customWeeklyPushForDate, "normalizeTaskReminderSettings": () => normalizeTaskReminderSettings, "normalizeDailyBriefSettings": () => normalizeDailyBriefSettings, "encryptSettingSecret": () => encryptSettingSecret, "decryptSettingSecret": () => decryptSettingSecret, "storedDailyBriefSettings": () => storedDailyBriefSettings, "publicDailyBriefSettings": () => publicDailyBriefSettings, "getDailyBriefSettings": () => getDailyBriefSettings, "saveDailyBriefSettings": () => saveDailyBriefSettings, "splitLines": () => splitLines, "parseMarketSymbols": () => parseMarketSymbols, "fetchJsonWithTimeout": () => fetchJsonWithTimeout, "fetchJsonWithCurl": () => fetchJsonWithCurl, "wait": () => wait, "fetchJsonWithFallback": () => fetchJsonWithFallback, "fetchTextWithTimeout": () => fetchTextWithTimeout, "fetchTextWithCurl": () => fetchTextWithCurl, "fetchTextWithProxyCurl": () => fetchTextWithProxyCurl, "fetchTextWithFallback": () => fetchTextWithFallback, "parsePublicFundF10": () => parsePublicFundF10, "dateBefore": () => dateBefore, "parsePublicFundGz": () => parsePublicFundGz, "parsePublicFundSearchProfile": () => parsePublicFundSearchProfile, "getPublicFundProfile": () => getPublicFundProfile, "mergePublicFundProfile": () => mergePublicFundProfile, "quoteFromPublicFundProfile": () => quoteFromPublicFundProfile, "getPublicFundQuote": () => getPublicFundQuote, "getPublicUsdCnyQuote": () => getPublicUsdCnyQuote, "getPublicStablecoinRates": () => getPublicStablecoinRates, "weatherCodeText": () => weatherCodeText, "getBriefWeatherBackup": () => getBriefWeatherBackup, "getBriefWeather": () => getBriefWeather, "getBriefMarket": () => getBriefMarket, "getIndexPurchaseAssessment": () => getIndexPurchaseAssessment, "getIndexPurchaseAssessments": () => getIndexPurchaseAssessments, "cryptoIdMap": () => cryptoIdMap, "cryptoSymbolKey": () => cryptoSymbolKey, "getCryptoMarket": () => getCryptoMarket, "getCryptoCompareMarket": () => getCryptoCompareMarket, "getWscnMarket": () => getWscnMarket, "tradingViewTicker": () => tradingViewTicker, "getTradingViewMarket": () => getTradingViewMarket, "eastMoneySecId": () => eastMoneySecId, "getEastMoneyMarket": () => getEastMoneyMarket, "sinaMarketCode": () => sinaMarketCode, "getSinaMarket": () => getSinaMarket, "stooqMarketSymbol": () => stooqMarketSymbol, "getStooqMarket": () => getStooqMarket, "getDailyBriefLearningSummary": () => getDailyBriefLearningSummary, "dailyBriefTitle": () => dailyBriefTitle, "dailyBriefRowToObject": () => dailyBriefRowToObject, "getDailyBriefByDate": () => getDailyBriefByDate, "getLatestDailyBriefSummary": () => getLatestDailyBriefSummary, "listDailyBriefs": () => listDailyBriefs, "generateDailyBrief": () => generateDailyBrief, "nextChinaWallClockDelay": () => nextChinaWallClockDelay, "scheduleDailyBrief": () => scheduleDailyBrief, "escapeHtml": () => escapeHtml, "encodeMailHeader": () => encodeMailHeader, "dailyBriefStudyPushHtml": () => dailyBriefStudyPushHtml, "dailyBriefHtml": () => dailyBriefHtml, "smtpReadResponse": () => smtpReadResponse, "smtpSendLine": () => smtpSendLine, "sendDailyBriefEmail": () => sendDailyBriefEmail }, {  });
}
