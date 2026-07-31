export function installLearningReportsDomain(runtime, exposeRuntime) {
    const ownerUserId = () => runtime.userAccountRepository.getOwnerUserId();
    const isOwnerUser = (userId) => Number(userId) === ownerUserId();
    function buildLearningReport(kind, periodStart, periodEnd, trigger = 'auto', userId = ownerUserId()) {
        const source = runtime.reportRepository.learningReportSource(userId, periodStart, periodEnd);
        const dailyRows = source.dailyRows;
        const dailyMap = new Map(dailyRows.map((item) => [item.date, Number(item.minutes || 0)]));
        const dailyTotals = runtime.dateRange(periodStart, periodEnd).map((date) => ({ date, minutes: dailyMap.get(date) || 0 }));
        const projectTotals = source.projectTotals;
        const reviews = source.reviews;
        const exams = source.exams;
        const taskStats = source.taskStats;
        const waterStats = source.waterStats;
        const totalMinutes = dailyTotals.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
        const studyDays = dailyTotals.filter((item) => Number(item.minutes || 0) > 0).length;
        const averageDailyMinutes = dailyTotals.length ? Math.round(totalMinutes / dailyTotals.length) : 0;
        const averageStudyDayMinutes = studyDays ? Math.round(totalMinutes / studyDays) : 0;
        const averageReviewScore = reviews.length
            ? Math.round((reviews.reduce((sum, item) => sum + Number(item.score || 0), 0) / reviews.length) * 10) / 10
            : null;
        const completedTasks = Number(taskStats.completed || 0);
        const totalTasks = Number(taskStats.total || 0);
        const taskCompletionRate = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : null;
        const topProject = projectTotals[0] || null;
        const bestReview = reviews.length ? reviews.reduce((best, item) => Number(item.score || 0) > Number(best.score || 0) ? item : best, reviews[0]) : null;
        const lowestReview = reviews.length ? reviews.reduce((low, item) => Number(item.score || 0) < Number(low.score || 0) ? item : low, reviews[0]) : null;
        const highlights = [
            totalMinutes > 0 ? `累计学习 ${runtime.minutesText(totalMinutes)}，覆盖 ${studyDays} 天。` : '本周期还没有学习时间记录。',
            topProject ? `投入最多的是「${topProject.name}」，共 ${runtime.minutesText(topProject.minutes)}。` : '',
            averageReviewScore ? `完成 ${reviews.length} 篇复盘，平均评分 ${averageReviewScore}/10。` : '本周期没有复盘记录。',
            totalTasks ? `短期目标完成 ${completedTasks}/${totalTasks}，完成率 ${taskCompletionRate}%。` : '',
            exams.length ? `记录 ${exams.length} 次模考，最近一次是 ${exams[0].subjectName} ${exams[0].score}/${exams[0].fullScore}。` : '',
        ].filter(Boolean);
        const suggestions = [];
        if (totalMinutes === 0)
            suggestions.push('先恢复最小学习闭环：每天至少记录一个项目的学习时间。');
        if (reviews.length < Math.min(3, dailyTotals.length))
            suggestions.push('复盘密度偏低，可以把每日复盘压缩到 5 分钟，先保持连续。');
        if (taskCompletionRate !== null && taskCompletionRate < 60)
            suggestions.push('短期目标完成率偏低，下一周期建议减少同时推进的目标数量。');
        if (topProject && totalMinutes > 0 && Number(topProject.minutes) / totalMinutes > 0.7)
            suggestions.push('学习投入集中度较高，注意给薄弱科目保留固定时间块。');
        if (!suggestions.length)
            suggestions.push('节奏比较稳，下一周期继续保持记录、复盘和任务闭环。');
        const themeLibraryProblems = isOwnerUser(userId) ? runtime.getErrorThemePeriodSummary(periodStart, periodEnd) : [];
        const commonProblems = themeLibraryProblems.length ? themeLibraryProblems : runtime.buildReviewProblemSummary(reviews);
        return {
            kind,
            title: runtime.buildReportTitle(kind, periodStart, periodEnd),
            periodStart,
            periodEnd,
            generatedAt: runtime.nowISO(),
            trigger,
            summary: {
                totalMinutes,
                studyDays,
                averageDailyMinutes,
                averageStudyDayMinutes,
                reviewCount: reviews.length,
                averageReviewScore,
                completedTasks,
                totalTasks,
                taskCompletionRate,
                waterCups: Number(waterStats.cups || 0),
                waterMl: Number(waterStats.ml || 0),
                examsCount: exams.length,
                topProject: topProject ? { name: topProject.name, minutes: Number(topProject.minutes || 0) } : null,
                bestReview: bestReview ? { date: bestReview.date, score: bestReview.score, summary: runtime.compactText(bestReview.summary) } : null,
                lowestReview: lowestReview ? { date: lowestReview.date, score: lowestReview.score, problems: runtime.compactText(lowestReview.problems) } : null,
            },
            highlights,
            suggestions,
            commonProblems,
            dailyTotals,
            projectTotals: projectTotals.map((item) => ({ name: item.name, minutes: Number(item.minutes || 0) })),
            reviews: reviews.map((item) => ({
                date: item.date,
                score: item.score,
                summary: item.summary || '',
                wins: item.wins || '',
                problems: item.problems || '',
                tomorrowPlan: item.tomorrowPlan || '',
            })),
            exams,
        };
    }
    function saveLearningReport(report, userId = ownerUserId()) {
        runtime.reportRepository.saveLearningReport(userId, report, runtime.nowISO());
        if (isOwnerUser(userId)) runtime.notifyEvent({
            eventKey: `report:${report.kind}:${report.periodStart}:${report.periodEnd}`,
            source: 'report',
            severity: 'info',
            title: report.title,
            content: `${report.periodStart} 至 ${report.periodEnd} 的${report.kind === 'monthly' ? '月报' : '周报'}已生成。`,
            payload: { kind: report.kind, periodStart: report.periodStart, periodEnd: report.periodEnd, trigger: report.trigger },
        });
        return report;
    }
    function generateLearningReport(kind, periodStart, periodEnd, trigger = 'manual', userId = ownerUserId()) {
        if (!['weekly', 'monthly'].includes(kind))
            throw new Error('Invalid report kind');
        return saveLearningReport(buildLearningReport(kind, periodStart, periodEnd, trigger, userId), userId);
    }
    function reportExists(kind, periodStart, periodEnd, userId = ownerUserId()) {
        return runtime.reportRepository.learningReportExists(userId, kind, periodStart, periodEnd);
    }
    function ensureAutomaticReports({ includeCurrent = true } = {}) {
        const today = runtime.todayISO();
        for (const kind of ['weekly', 'monthly']) {
            const periods = [runtime.previousPeriod(kind, today)];
            if (includeCurrent)
                periods.push(runtime.currentPeriod(kind, today));
            for (const { periodStart, periodEnd } of periods) {
                if (includeCurrent || !reportExists(kind, periodStart, periodEnd)) {
                    generateLearningReport(kind, periodStart, periodEnd, 'auto');
                }
            }
        }
        runtime.appMetadataRepository.set('last_report_check_at', runtime.nowISO());
    }
    async function precomputeNightlyArtifacts(trigger = 'nightly') {
        const today = runtime.todayISO();
        const timestamp = runtime.nowISO();
        try {
            await runtime.runErrorThemeBatch('1900-01-01', today, { mode: 'rules', modelProfile: 'rules' });
            ensureAutomaticReports({ includeCurrent: true });
            for (const days of [7, 30, 90]) {
                const from = days === 90 ? '1900-01-01' : runtime.addDaysISO(today, -(days - 1));
                runtime.setPrecomputedCache(`error-themes:${from}:${today}`, runtime.getErrorThemeAnalysis(from, today));
            }
            const ownerId = ownerUserId();
            runtime.setPrecomputedCache(`review-trend:${ownerId}:30:${today}`, runtime.getReviewTrendPayload(30, today, ownerId));
            runtime.setPrecomputedCache(`review-trend:${ownerId}:90:${today}`, runtime.getReviewTrendPayload(90, today, ownerId));
            runtime.setPrecomputedCache(`dashboard-error-wall:${today}`, { items: runtime.getErrorThemeWall(12, 90, today) });
            runtime.appMetadataRepository.setMany({
                last_precompute_at: timestamp,
                last_precompute_trigger: trigger,
                last_precompute_error: '',
            });
            return { ok: true, ranAt: timestamp };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            runtime.appMetadataRepository.set('last_precompute_error', message);
            return { ok: false, ranAt: timestamp, error: message };
        }
    }
    function listLearningReports(userId = ownerUserId()) {
        return runtime.reportRepository.listLearningReports(userId).map((row) => {
            let payload = {};
            try {
                payload = JSON.parse(row.payloadJson || '{}');
            }
            catch {
                payload = {};
            }
            return { id: row.id, ...payload, generatedAt: row.generatedAt, updatedAt: row.updatedAt };
        });
    }

    exposeRuntime({
        buildLearningReport: () => buildLearningReport,
        saveLearningReport: () => saveLearningReport,
        generateLearningReport: () => generateLearningReport,
        reportExists: () => reportExists,
        ensureAutomaticReports: () => ensureAutomaticReports,
        precomputeNightlyArtifacts: () => precomputeNightlyArtifacts,
        listLearningReports: () => listLearningReports,
    });
}
