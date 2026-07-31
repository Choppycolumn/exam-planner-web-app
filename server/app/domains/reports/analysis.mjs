export function installReportAnalysisDomain(runtime, exposeRuntime) {
    function getErrorThemePeriodSummary(periodStart, periodEnd, limit = 6) {
        const themes = runtime.reportRepository.periodThemes(periodStart, periodEnd, limit);
        return themes.map((theme) => {
            const dates = runtime.reportRepository.themeDates(theme.id, periodStart, periodEnd);
            const examples = runtime.reportRepository.themeExamples(theme.id, periodStart, periodEnd);
            return {
                id: theme.normalizedLabel,
                label: theme.label,
                count: Number(theme.days || 0),
                dates,
                keywords: runtime.reviewProblemThemes.find((item) => item.id === theme.normalizedLabel)?.keywords || [],
                examples,
            };
        });
    }
    function getErrorThemeAnalysis(periodStart = '1900-01-01', periodEnd = runtime.todayISO()) {
        runtime.ensureSqliteStore();
        const from = periodStart || '1900-01-01';
        const to = periodEnd || runtime.todayISO();
        const latestBatch = runtime.reportRepository.latestBatch();
        const themes = runtime.reportRepository.analysisThemes(from, to);
        const enrichedThemes = themes.map((theme) => ({
            id: Number(theme.id),
            normalizedLabel: theme.normalizedLabel,
            label: theme.label,
            occurrenceCount: Number(theme.occurrenceCount || 0),
            reviewDayCount: Number(theme.reviewDayCount || 0),
            averageConfidence: Number(theme.averageConfidence || 0),
            firstSeenAt: theme.firstSeenAt,
            lastSeenAt: theme.lastSeenAt,
            examples: runtime.reportRepository.occurrenceExamples(theme.id, from, to),
        }));
        const timeline = runtime.reportRepository.timeline(from, to)
            .map((item) => ({ date: item.date, count: Number(item.count || 0) }));
        const totals = runtime.reportRepository.analysisTotals(from, to);
        return {
            periodStart: from,
            periodEnd: to,
            latestBatch,
            summary: {
                occurrenceCount: Number(totals.occurrenceCount || 0),
                themeCount: Number(totals.themeCount || 0),
                reviewDayCount: Number(totals.reviewDayCount || 0),
                topTheme: enrichedThemes[0] || null,
            },
            themes: enrichedThemes,
            timeline,
        };
    }
    function getCachedErrorThemeAnalysis(periodStart = '1900-01-01', periodEnd = runtime.todayISO()) {
        const from = periodStart || '1900-01-01';
        const to = periodEnd || runtime.todayISO();
        const cacheKey = `error-themes:${from}:${to}`;
        const cached = runtime.getPrecomputedCache(cacheKey);
        if (cached)
            return cached;
        return runtime.setPrecomputedCache(cacheKey, getErrorThemeAnalysis(from, to));
    }
    function getErrorThemeDetail(themeId, periodStart = '1900-01-01', periodEnd = runtime.todayISO()) {
        runtime.ensureSqliteStore();
        const id = Number(themeId || 0);
        const from = periodStart || '1900-01-01';
        const to = periodEnd || runtime.todayISO();
        const theme = runtime.reportRepository.getTheme(id);
        if (!theme)
            return null;
        const occurrences = runtime.reportRepository.detailOccurrences(id, from, to);
        const timeline = runtime.reportRepository.timeline(from, to, id)
            .map((item) => ({ date: item.date, count: Number(item.count || 0) }));
        const byField = runtime.reportRepository.detailByField(id, from, to)
            .map((item) => ({ field: item.field, count: Number(item.count || 0) }));
        const repeatedWeeks = runtime.reportRepository.repeatedWeeks(id, from, to)
            .map((item) => ({ ...item, count: Number(item.count || 0) }));
        return {
            theme,
            periodStart: from,
            periodEnd: to,
            occurrences,
            timeline,
            byField,
            repeatedWeeks,
        };
    }
    function buildReportTitle(kind, periodStart, periodEnd) {
        const label = kind === 'monthly' ? '月报' : '周报';
        return `${periodStart} 至 ${periodEnd} 学习${label}`;
    }
    exposeRuntime({
        getErrorThemePeriodSummary: () => getErrorThemePeriodSummary,
        getErrorThemeAnalysis: () => getErrorThemeAnalysis,
        getCachedErrorThemeAnalysis: () => getCachedErrorThemeAnalysis,
        getErrorThemeDetail: () => getErrorThemeDetail,
        buildReportTitle: () => buildReportTitle,
    });
}
