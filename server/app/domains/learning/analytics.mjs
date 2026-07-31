export function installLearningAnalyticsDomain(runtime, exposeRuntime) {
    const ownerUserId = () => runtime.userAccountRepository.getOwnerUserId();
    function tableChanged() {
        runtime.dataRevision += 1;
        runtime.dashboardPayloadCache = null;
        runtime.statisticsSummaryCache = null;
        runtime.appMetadataRepository.markDataUpdated(runtime.nowISO());
    }
    function sourceUpdatedAt() {
        return runtime.appMetadataRepository.sourceUpdatedAt();
    }
    function setPrecomputedCache(cacheKey, payload) {
        const timestamp = runtime.nowISO();
        runtime.appMetadataRepository.setPrecomputed(cacheKey, payload, timestamp, sourceUpdatedAt());
        return { ...payload, precomputedAt: timestamp };
    }
    function getPrecomputedCache(cacheKey, maxAgeMs = 24 * 60 * 60 * 1000) {
        const row = runtime.appMetadataRepository.getPrecomputed(cacheKey);
        if (!row?.payloadJson)
            return null;
        if (maxAgeMs && Date.now() - new Date(row.computedAt).getTime() > maxAgeMs)
            return null;
        const currentSource = sourceUpdatedAt();
        if (currentSource && row.sourceUpdatedAt && new Date(row.sourceUpdatedAt).getTime() < new Date(currentSource).getTime())
            return null;
        return { ...JSON.parse(row.payloadJson), precomputedAt: row.computedAt };
    }
    function studyUserIsolationReady() {
        return runtime.learningQueryRepository.studyUserIsolationReady();
    }
    function rebuildStudySummaries() {
        const timestamp = runtime.nowISO();
        runtime.learningQueryRepository.rebuildOwnerStudySummaries(
            runtime.userAccountRepository.findOwnerUserId(),
            timestamp,
        );
    }
    function refreshStudySummariesForDate(date) {
        const targetDate = date || runtime.todayISO();
        const timestamp = runtime.nowISO();
        runtime.learningQueryRepository.refreshOwnerStudySummariesForDate(
            runtime.userAccountRepository.findOwnerUserId(),
            targetDate,
            timestamp,
        );
    }
    function ensureStudySummariesReady() {
        const { recordCount, summaryCount, rebuiltAt } = runtime.learningQueryRepository.studySummaryStatus();
        if (recordCount && (!summaryCount || !rebuiltAt))
            rebuildStudySummaries();
    }
    function getLastNDaysTotals(days, endDate = runtime.todayISO(), userId = ownerUserId()) {
        const startDate = runtime.addDaysISO(endDate, -(days - 1));
        const rows = runtime.learningQueryRepository.dailyStudyTotals(userId, startDate, endDate);
        const map = new Map(rows.map((row) => [row.date, Number(row.minutes || 0)]));
        return runtime.dateRange(startDate, endDate).map((date) => ({ date, minutes: map.get(date) || 0 }));
    }
    function getProjectTotals(startDate, endDate, userId = ownerUserId()) {
        return runtime.learningQueryRepository.projectTotals(userId, startDate, endDate)
            .map((row) => ({ name: row.name, minutes: Number(row.minutes || 0) }));
    }
    function getProjectDistributionForDate(date, userId = ownerUserId()) {
        return runtime.learningQueryRepository.projectDistribution(userId, date)
            .map((row) => ({ name: row.name, value: Number(row.value || 0) }));
    }
    function getActivityCalendar(days = 84, endDate = runtime.todayISO(), userId = ownerUserId()) {
        const startDate = runtime.addDaysISO(endDate, -(days - 1));
        const { totals, reviews, water, tasks: taskRows } = runtime.learningQueryRepository
            .activityCalendarRows(userId, startDate, endDate);
        const totalMap = new Map(totals.map((item) => [item.date, Number(item.minutes || 0)]));
        const reviewMap = new Map(reviews.map((item) => [item.date, Number(item.score || 0)]));
        const waterMap = new Map(water.map((item) => [item.date, { cups: Number(item.cups || 0), targetCups: Number(item.targetCups || 6) }]));
        const taskMap = new Map(taskRows.map((item) => [item.date, { total: Number(item.total || 0), completed: Number(item.completed || 0) }]));
        return runtime.dateRange(startDate, endDate).map((date) => {
            const waterItem = waterMap.get(date) || { cups: 0, targetCups: 6 };
            const taskItem = taskMap.get(date) || { total: 0, completed: 0 };
            return {
                date,
                minutes: totalMap.get(date) || 0,
                reviewScore: reviewMap.get(date) || null,
                hasReview: reviewMap.has(date),
                waterCups: waterItem.cups,
                waterTargetCups: waterItem.targetCups,
                taskTotal: taskItem.total,
                taskCompleted: taskItem.completed,
            };
        });
    }
    function getReviewTrendPayload(days = 30, endDate = runtime.todayISO(), userId = ownerUserId()) {
        const safeDays = Math.max(7, Math.min(120, Number(days) || 30));
        const startDate = runtime.addDaysISO(endDate, -(safeDays - 1));
        const rows = runtime.learningQueryRepository.reviewScores(userId, startDate, endDate)
            .map((item) => ({ date: item.date, score: Number(item.score || 0) }));
        const scoreMap = new Map(rows.map((item) => [item.date, item.score]));
        return {
            periodStart: startDate,
            periodEnd: endDate,
            days: safeDays,
            trend: runtime.dateRange(startDate, endDate).map((date) => ({ date, score: scoreMap.get(date) || null })),
        };
    }
    function getCachedReviewTrend(days = 30, endDate = runtime.todayISO(), userId = ownerUserId()) {
        const cacheKey = `review-trend:${userId}:${days}:${endDate}`;
        const cached = getPrecomputedCache(cacheKey);
        if (cached)
            return cached;
        return setPrecomputedCache(cacheKey, getReviewTrendPayload(days, endDate, userId));
    }
    function getErrorThemeWall(limit = 12, days = 90, endDate = runtime.todayISO()) {
        const startDate = runtime.addDaysISO(endDate, -(Math.max(7, Number(days) || 90) - 1));
        return runtime.learningQueryRepository.errorThemeWall(startDate, endDate, limit).map((item) => ({
            id: Number(item.id),
            normalizedLabel: item.normalizedLabel,
            label: item.label,
            occurrenceCount: Number(item.occurrenceCount || 0),
            reviewDayCount: Number(item.reviewDayCount || 0),
            lastSeenAt: item.lastSeenAt || '',
        }));
    }
    function getReviewPrefill(date = runtime.todayISO(), sessionRole = 'write', userId = ownerUserId()) {
        const source = runtime.learningQueryRepository.reviewPrefillSource(
            userId,
            date,
            runtime.addDaysISO(date, -1),
        );
        const totalMinutes = Number(source.totalMinutes || 0);
        const topProject = source.topProject
            ? { name: source.topProject.name, minutes: Number(source.topProject.minutes || 0) }
            : null;
        const unfinishedTasks = source.unfinishedTasks.map(runtime.normalizeTaskRow);
        const water = source.water || { cups: 0, cupMl: 500, targetCups: 6 };
        const inboxItems = runtime.learningRepository.listProblemInbox({ status: 'open', from: date, to: date, limit: 6 }, userId);
        const previousReview = source.previousReview;
        const suggestedSummary = [
            totalMinutes ? `今日学习 ${runtime.minutesText(totalMinutes)}。` : '今日还没有记录学习时间。',
            topProject ? `投入最多的是「${topProject.name}」${runtime.minutesText(topProject.minutes)}。` : '',
            unfinishedTasks.length ? `仍有 ${unfinishedTasks.length} 个短期目标未完成。` : '短期目标没有明显积压。',
            `喝水 ${Number(water.cups || 0)}/${Number(water.targetCups || 6)} 杯。`,
        ].filter(Boolean).join('\n');
        const suggestedProblems = [
            ...inboxItems.map((item) => `- ${item.text}`),
            unfinishedTasks.length ? `- 未完成任务：${unfinishedTasks.map((item) => item.title).join('；')}` : '',
        ].filter(Boolean).join('\n');
        return {
            date,
            totalMinutes,
            topProject,
            unfinishedTasks,
            water: { cups: Number(water.cups || 0), cupMl: Number(water.cupMl || 500), targetCups: Number(water.targetCups || 6) },
            problemInboxItems: inboxItems,
            previousTomorrowPlan: previousReview?.tomorrowPlan || '',
            suggestedSummary,
            suggestedProblems,
            readOnly: sessionRole === 'read',
        };
    }
    exposeRuntime({
        tableChanged: () => tableChanged,
        sourceUpdatedAt: () => sourceUpdatedAt,
        setPrecomputedCache: () => setPrecomputedCache,
        getPrecomputedCache: () => getPrecomputedCache,
        studyUserIsolationReady: () => studyUserIsolationReady,
        rebuildStudySummaries: () => rebuildStudySummaries,
        refreshStudySummariesForDate: () => refreshStudySummariesForDate,
        ensureStudySummariesReady: () => ensureStudySummariesReady,
        getLastNDaysTotals: () => getLastNDaysTotals,
        getProjectTotals: () => getProjectTotals,
        getProjectDistributionForDate: () => getProjectDistributionForDate,
        getActivityCalendar: () => getActivityCalendar,
        getReviewTrendPayload: () => getReviewTrendPayload,
        getCachedReviewTrend: () => getCachedReviewTrend,
        getErrorThemeWall: () => getErrorThemeWall,
        getReviewPrefill: () => getReviewPrefill,
    });
}
