export function installBriefMarketsDomain(runtime, exposeRuntime) {
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
            const data = await runtime.fetchJsonWithTimeout(url);
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
                result = { value: await runtime.fetchTextWithProxyCurl(url, 45), cacheStatus: 'proxy', fetchedAt: runtime.nowISO() };
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
            const data = await runtime.fetchJsonWithTimeout(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true`, 9000);
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
            const data = await runtime.fetchJsonWithTimeout(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${encodeURIComponent(key)}&tsyms=USD`, 9000);
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
                const data = await runtime.fetchJsonWithCurl(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${encodeURIComponent(key)}&tsyms=USD`, 9);
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
            const data = await runtime.fetchJsonWithTimeout(url, 9000);
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
                data = await runtime.fetchJsonWithTimeout(url, 9000);
            }
            catch {
                data = await runtime.fetchJsonWithCurl(url, 9);
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
            const text = await runtime.fetchTextWithTimeout(`https://hq.sinajs.cn/list=${code}`, 9000, { referer: 'https://finance.sina.com.cn' });
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
            const text = await runtime.fetchTextWithTimeout(`https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`, 9000);
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
    exposeRuntime({
        cryptoIdMap: () => cryptoIdMap,
        getBriefMarket: () => getBriefMarket,
        getIndexPurchaseAssessment: () => getIndexPurchaseAssessment,
        getIndexPurchaseAssessments: () => getIndexPurchaseAssessments,
        cryptoSymbolKey: () => cryptoSymbolKey,
        getCryptoMarket: () => getCryptoMarket,
        getCryptoCompareMarket: () => getCryptoCompareMarket,
        getWscnMarket: () => getWscnMarket,
        tradingViewTicker: () => tradingViewTicker,
        getTradingViewMarket: () => getTradingViewMarket,
        eastMoneySecId: () => eastMoneySecId,
        getEastMoneyMarket: () => getEastMoneyMarket,
        sinaMarketCode: () => sinaMarketCode,
        getSinaMarket: () => getSinaMarket,
        stooqMarketSymbol: () => stooqMarketSymbol,
        getStooqMarket: () => getStooqMarket,
    });
}
