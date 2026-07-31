export function installBriefTransportDomain(runtime, exposeRuntime) {
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
    exposeRuntime({
        wait: () => wait,
        splitLines: () => splitLines,
        parseMarketSymbols: () => parseMarketSymbols,
        fetchJsonWithTimeout: () => fetchJsonWithTimeout,
        fetchJsonWithCurl: () => fetchJsonWithCurl,
        fetchJsonWithFallback: () => fetchJsonWithFallback,
        fetchTextWithTimeout: () => fetchTextWithTimeout,
        fetchTextWithCurl: () => fetchTextWithCurl,
        fetchTextWithProxyCurl: () => fetchTextWithProxyCurl,
        fetchTextWithFallback: () => fetchTextWithFallback,
        parsePublicFundF10: () => parsePublicFundF10,
        dateBefore: () => dateBefore,
        parsePublicFundGz: () => parsePublicFundGz,
        parsePublicFundSearchProfile: () => parsePublicFundSearchProfile,
        getPublicFundProfile: () => getPublicFundProfile,
        mergePublicFundProfile: () => mergePublicFundProfile,
        quoteFromPublicFundProfile: () => quoteFromPublicFundProfile,
        getPublicFundQuote: () => getPublicFundQuote,
        getPublicUsdCnyQuote: () => getPublicUsdCnyQuote,
        getPublicStablecoinRates: () => getPublicStablecoinRates,
    });
}
