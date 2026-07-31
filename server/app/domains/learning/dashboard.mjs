export function installLearningDashboardDomain(runtime, exposeRuntime) {
    const ownerUserId = () => runtime.userAccountRepository.getOwnerUserId();
    function countdownStage(activeGoal, date = runtime.todayISO()) {
        if (!activeGoal?.deadline)
            return { label: '未设定阶段', tone: 'slate', hint: '设置长期目标后自动判断备考阶段。' };
        const daysLeft = Math.max(0, Math.ceil((runtime.parseDateString(activeGoal.deadline).getTime() - runtime.parseDateString(date).getTime()) / (24 * 60 * 60 * 1000)));
        if (daysLeft <= 30)
            return { label: '冲刺期', tone: 'rose', hint: '优先真题复盘、错题回炉和作息稳定。' };
        if (daysLeft <= 100)
            return { label: '真题期', tone: 'amber', hint: '保持真题节奏，按周复盘薄弱科目。' };
        if (daysLeft <= 220)
            return { label: '强化期', tone: 'blue', hint: '重点放在题型熟练度、错题闭环和专项突破。' };
        return { label: '基础期', tone: 'emerald', hint: '稳住基础概念、教材/课程推进和每日记录。' };
    }
    function stageChecklist(stageLabel) {
        if (stageLabel === '冲刺期')
            return ['先处理最近真题错因', '安排一轮限时训练', '睡前复盘明日科目顺序'];
        if (stageLabel === '真题期')
            return ['完成一段真题或套卷复盘', '把错因写进问题 Inbox', '留出薄弱科目固定时间'];
        if (stageLabel === '强化期')
            return ['推进一个专项题型', '复看昨日错题', '把任务拆到 45 分钟内'];
        if (stageLabel === '基础期')
            return ['先完成基础知识推进', '记录一个学习时间块', '晚上用 5 分钟复盘'];
        return ['确认长期目标日期', '添加今天最小任务', '完成一次短学习块'];
    }
    function getStudyTargetMinutes(userId = ownerUserId()) {
        return runtime.learningRepository.getStudyTarget(userId);
    }
    function getDashboardReminders({ today, todayTotal, visibleTasks, waterRecord, todayReview, userId = ownerUserId() }) {
        const reminders = [];
        if (!todayReview)
            reminders.push({ id: 'review', tone: 'amber', title: '今天还没复盘', detail: '睡前留 5 分钟写下今天的问题和明日计划。' });
        const last7 = runtime.getLastNDaysTotals(7, today, userId);
        const previousStudyDays = last7.slice(0, -1).filter((item) => item.minutes > 0);
        const average = previousStudyDays.length ? Math.round(previousStudyDays.reduce((sum, item) => sum + item.minutes, 0) / previousStudyDays.length) : 0;
        if (average && todayTotal < average * 0.6)
            reminders.push({ id: 'study-low', tone: 'rose', title: '今日学习时长偏低', detail: `低于近 7 天学习日均值 ${runtime.minutesText(average)}，先补一个短时段。` });
        const tomorrow = runtime.addDaysISO(today, 1);
        const dueTomorrow = visibleTasks.filter((task) => !task.isCompleted && task.dueDate <= tomorrow);
        if (dueTomorrow.length)
            reminders.push({ id: 'task-due', tone: 'blue', title: '近期目标快到期', detail: `${dueTomorrow.length} 个短期目标在明天前到期。` });
        const cups = Number(waterRecord?.cups || 0);
        const targetCups = Number(waterRecord?.targetCups || 6);
        if (cups < targetCups)
            reminders.push({ id: 'water', tone: cups ? 'amber' : 'rose', title: '喝水未达标', detail: `今日 ${cups}/${targetCups} 杯，离目标还差 ${Math.max(0, targetCups - cups)} 杯。` });
        return reminders.slice(0, 5);
    }
    function getDashboardPayload(sessionRole, userId = ownerUserId(), _accountType, capabilities = []) {
        const cacheDate = runtime.todayISO();
        const accessScope = `${sessionRole}:${[...capabilities].sort().join(',')}`;
        if (runtime.dashboardPayloadCache?.revision === runtime.dataRevision
            && runtime.dashboardPayloadCache.date === cacheDate
            && runtime.dashboardPayloadCache.userId === userId
            && runtime.dashboardPayloadCache.accessScope === accessScope) {
            return { ...runtime.dashboardPayloadCache.payload, readOnly: sessionRole === 'read' };
        }
        const today = cacheDate;
        const yesterday = runtime.addDaysISO(today, -1);
        const source = runtime.learningQueryRepository.dashboardSource(userId, today, yesterday);
        const activeGoal = source.activeGoal ? { ...source.activeGoal, isActive: Boolean(source.activeGoal.isActive) } : null;
        const todayTotal = Number(source.todayTotal || 0);
        const totalStudyMinutes = Number(source.totalStudyMinutes || 0);
        const studyTargetMinutes = getStudyTargetMinutes(userId);
        const latestExam = source.latestExam;
        const reviews = source.reviews.map(runtime.normalizeReview);
        const visibleTasks = source.visibleTasks.map(runtime.normalizeTaskRow);
        const waterRecord = source.waterRecord;
        const canManageBrief = capabilities.includes('brief.manage');
        const canManageOperations = capabilities.includes('operations.manage');
        const canSyncBreakGuard = capabilities.includes('break_guard.sync');
        const todayBrief = canManageBrief ? runtime.getDailyBriefByDate(today) || runtime.getLatestDailyBriefSummary() : null;
        const englishWritingPlan = canManageBrief ? runtime.englishWritingPlanForDate(today, runtime.getDailyBriefSettings({ includeSecret: true })) : undefined;
        const stage = countdownStage(activeGoal, today);
        const daysLeft = activeGoal ? Math.max(1, Math.ceil((runtime.parseDateString(activeGoal.deadline).getTime() - runtime.parseDateString(today).getTime()) / (24 * 60 * 60 * 1000))) : 0;
        const remainingStudyMinutes = Math.max(0, studyTargetMinutes - totalStudyMinutes);
        const dailyTargetMinutes = daysLeft ? Math.ceil(remainingStudyMinutes / daysLeft) : 0;
        const primaryTask = visibleTasks.find((task) => !task.isCompleted) || null;
        const startupPlan = {
            stage,
            primaryTask,
            dailyTargetMinutes,
            checklist: stageChecklist(stage.label),
            firstSession: primaryTask
                ? `先推进「${primaryTask.title}」25-45 分钟`
                : todayTotal
                    ? '今天已经启动，继续保持一个完整学习块'
                    : '先开始一个 25 分钟低阻力学习块',
        };
        const reminders = getDashboardReminders({ today, todayTotal, visibleTasks, waterRecord, todayReview: reviews.find((review) => review.date === today) || null, userId });
        const activityCalendar = runtime.getActivityCalendar(84, today, userId);
        const errorThemeWall = canManageOperations ? (runtime.getPrecomputedCache(`dashboard-error-wall:${today}`)?.items || runtime.getErrorThemeWall(10, 90, today)).slice(0, 10) : [];
        const breakGuard = canSyncBreakGuard ? runtime.getBreakGuardSummary(today) : undefined;
        const payload = {
            activeGoal,
            today,
            todayTotal,
            totalStudyMinutes,
            studyTargetMinutes,
            latestExam,
            todayReview: reviews.find((review) => review.date === today) || null,
            yesterdayReview: reviews.find((review) => review.date === yesterday) || null,
            visibleTasks,
            todayWaterRecord: waterRecord,
            todayBrief,
            englishWritingPlan,
            startupPlan,
            reminders,
            activityCalendar,
            errorThemeWall,
            breakGuard,
        };
        runtime.dashboardPayloadCache = { revision: runtime.dataRevision, date: today, userId, accessScope, payload };
        return { ...payload, readOnly: sessionRole === 'read' };
    }
    function getDashboardChartsPayload(userId = ownerUserId()) {
        const today = runtime.todayISO();
        return {
            today,
            distribution: runtime.getProjectDistributionForDate(today, userId),
            trend: runtime.getLastNDaysTotals(7, today, userId),
        };
    }
    function getStatisticsSummary(userId = ownerUserId()) {
        const cacheDate = runtime.todayISO();
        if (runtime.statisticsSummaryCache?.revision === runtime.dataRevision && runtime.statisticsSummaryCache.date === cacheDate && runtime.statisticsSummaryCache.userId === userId) {
            return runtime.statisticsSummaryCache.payload;
        }
        const today = cacheDate;
        const todayTotal = runtime.learningQueryRepository.totalStudyMinutes(userId, today, today);
        const distribution = runtime.getProjectDistributionForDate(today, userId);
        const last7 = runtime.getLastNDaysTotals(7, today, userId);
        const last30 = runtime.getProjectTotals(runtime.addDaysISO(today, -29), today, userId);
        const payload = { today, todayTotal, distribution, last7, last30 };
        runtime.statisticsSummaryCache = { revision: runtime.dataRevision, date: today, userId, payload };
        return payload;
    }
    function getLearningProgressPayload(sessionRole = 'write', userId = ownerUserId(), accountType) {
        runtime.ensureSqliteStore();
        const today = runtime.todayISO();
        const start30 = runtime.addDaysISO(today, -29);
        const start7 = runtime.addDaysISO(today, -6);
        const previous7Start = runtime.addDaysISO(today, -13);
        const previous7End = runtime.addDaysISO(today, -7);
        const targetMinutes = getStudyTargetMinutes(userId);
        const progressSource = runtime.learningQueryRepository.progressSource(
            userId,
            start30,
            today,
            previous7Start,
            previous7End,
        );
        const dailyRows = progressSource.dailyRows;
        const reviewByDate = new Map(progressSource.reviewRows.map((row) => [row.date, Number(row.score)]));
        const dailyByDate = new Map(dailyRows.map((row) => [row.date, row]));
        const daily = runtime.dateRange(start30, today).map((date) => {
            const row = dailyByDate.get(date) || {};
            const minutes = Number(row.minutes || 0);
            const reviewScore = reviewByDate.get(date) ?? null;
            return { date, minutes, reviewScore, targetMinutes, hitTarget: targetMinutes > 0 && minutes >= targetMinutes };
        });
        const current7Minutes = daily.filter((day) => day.date >= start7).reduce((sum, day) => sum + day.minutes, 0);
        const previous7Minutes = Number(progressSource.previous7Minutes || 0);
        const reviewStats = progressSource.reviewStats;
        const taskStats = progressSource.taskStats;
        const projectTotals = runtime.getProjectTotals(start30, today, userId);
        const streakDays = runtime.getLastNDaysTotals(365, today, userId);
        let studyStreakDays = 0;
        for (let index = streakDays.length - 1; index >= 0; index -= 1) {
            if (Number(streakDays[index]?.minutes || 0) <= 0)
                break;
            studyStreakDays += 1;
        }
        const completedTasks = Number(taskStats.completed || 0);
        const totalTasks = Number(taskStats.total || 0);
        return {
            summary: {
                today,
                current7Minutes,
                previous7Minutes,
                current30Minutes: daily.reduce((sum, day) => sum + day.minutes, 0),
                studyStreakDays,
                targetHitDays: daily.filter((day) => day.hitTarget).length,
                targetDays: daily.length,
                averageReviewScore: reviewStats.averageScore === null || reviewStats.averageScore === undefined ? null : Math.round(Number(reviewStats.averageScore) * 10) / 10,
                reviewCount: Number(reviewStats.count || 0),
                completedTasks,
                totalTasks,
                taskCompletionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : null,
                topProject: projectTotals[0] || null,
            },
            daily,
            projectTotals,
            reviewTrend: daily.map((day) => ({ date: day.date, score: day.reviewScore })),
            accountType: accountType || runtime.userAccountRepository.getAccount(userId)?.accountType || 'learner',
            readOnly: sessionRole === 'read',
        };
    }
    function momentumLabel(current, previous) {
        if (current > previous * 1.08)
            return 'up';
        if (current < previous * 0.92)
            return 'down';
        return 'flat';
    }
    function getProjectProgressPayload(sessionRole = 'write', userId = ownerUserId()) {
        runtime.ensureSqliteStore();
        const today = runtime.todayISO();
        const start30 = runtime.addDaysISO(today, -29);
        const start7 = runtime.addDaysISO(today, -6);
        const previous7Start = runtime.addDaysISO(today, -13);
        const previous7End = runtime.addDaysISO(today, -7);
        const { projects, totals } = runtime.learningQueryRepository.projectProgressSource(
            userId,
            start30,
            today,
            start7,
            previous7Start,
            previous7End,
        );
        const totalByProject = new Map(totals.map((row) => [Number(row.projectId), row]));
        const last30Total = totals.reduce((sum, row) => sum + Number(row.last30Minutes || 0), 0);
        const items = projects.map((project) => {
            const row = totalByProject.get(Number(project.id)) || {};
            const last30Minutes = Number(row.last30Minutes || 0);
            return {
                id: Number(project.id),
                name: project.name,
                color: project.color,
                isActive: Boolean(project.isActive),
                totalMinutes: Number(row.totalMinutes || 0),
                last30Minutes,
                last7Minutes: Number(row.last7Minutes || 0),
                lastStudiedAt: row.lastStudiedAt || null,
                recordCount: Number(row.recordCount || 0),
                sharePercent: last30Total ? Math.round((last30Minutes / last30Total) * 100) : 0,
                momentum: momentumLabel(Number(row.last7Minutes || 0), Number(row.previous7Minutes || 0)),
            };
        });
        const daily = runtime.getLastNDaysTotals(30, today, userId);
        const totalMinutes = items.reduce((sum, item) => sum + item.totalMinutes, 0);
        const topProject = items.length
            ? items.map((item) => ({ name: item.name, minutes: item.last30Minutes })).sort((a, b) => b.minutes - a.minutes)[0]
            : null;
        return {
            generatedAt: runtime.nowISO(),
            items,
            totals: {
                totalMinutes,
                activeProjects: items.filter((item) => item.isActive).length,
                inactiveProjects: items.filter((item) => !item.isActive).length,
                topProject: topProject && topProject.minutes > 0 ? topProject : null,
            },
            daily,
            readOnly: sessionRole === 'read',
        };
    }
    exposeRuntime({
        countdownStage: () => countdownStage,
        stageChecklist: () => stageChecklist,
        getStudyTargetMinutes: () => getStudyTargetMinutes,
        getDashboardReminders: () => getDashboardReminders,
        getDashboardPayload: () => getDashboardPayload,
        getDashboardChartsPayload: () => getDashboardChartsPayload,
        getStatisticsSummary: () => getStatisticsSummary,
        getLearningProgressPayload: () => getLearningProgressPayload,
        momentumLabel: () => momentumLabel,
        getProjectProgressPayload: () => getProjectProgressPayload,
    });
}
