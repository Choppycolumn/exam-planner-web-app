export function installBriefCompositionDomain(runtime, exposeRuntime) {
    const ownerUserId = () => runtime.userAccountRepository.getOwnerUserId();
    function getDailyBriefLearningSummary(date) {
        const yesterday = runtime.addDaysISO(date, -1);
        const snapshot = runtime.learningQueryRepository.briefLearningSnapshot(
            ownerUserId(),
            yesterday,
            date,
            runtime.addDaysISO(date, -6),
        );
        const activeGoal = snapshot.activeGoal;
        const yesterdayReview = snapshot.yesterdayReview ? runtime.normalizeReview(snapshot.yesterdayReview) : null;
        const todayTasks = snapshot.todayTasks.map(runtime.normalizeTaskRow);
        const latestExam = snapshot.latestExam;
        const yesterdayMinutes = Number(snapshot.yesterdayMinutes || 0);
        const last7Minutes = Number(snapshot.last7Minutes || 0);
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
        return runtime.dailyBriefRepository.getByDate(date);
    }
    function getLatestDailyBriefSummary() {
        return runtime.dailyBriefRepository.getLatest();
    }
    function listDailyBriefs(limit = 30) {
        return runtime.dailyBriefRepository.list(limit);
    }
    async function generateDailyBrief({ date = runtime.todayISO(), trigger = 'manual', sendEmail = false, sendWechat = false } = {}) {
        const settings = runtime.getDailyBriefSettings({ includeSecret: true });
        const generatedAt = runtime.nowISO();
        const marketSymbols = runtime.parseMarketSymbols(settings.marketSymbolsText).slice(0, 12);
        const [weather, markets, indexPurchaseAssessment] = await Promise.all([
            runtime.getBriefWeather(settings),
            Promise.all(marketSymbols.map(runtime.getBriefMarket)),
            runtime.getIndexPurchaseAssessments(),
        ]);
        const payload = {
            date,
            title: dailyBriefTitle(date),
            generatedAt,
            trigger,
            customWeeklyPush: runtime.customWeeklyPushForDate(date, settings),
            englishWritingPlan: runtime.englishWritingPlanForDate(date, settings),
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
                    await runtime.sendDailyBriefEmail(payload, settings.email);
                    emailedAt = runtime.nowISO();
                }
                catch (error) {
                    emailError = error instanceof Error ? error.message : String(error);
                }
            }
        }
        let wechatDelivery = null;
        let wechatError = '';
        runtime.dailyBriefRepository.upsert({
            date,
            title: payload.title,
            payload,
            status: 'completed',
            emailedAt,
            emailError,
            generatedAt,
            updatedAt: runtime.nowISO(),
        });
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
        const settings = runtime.getDailyBriefSettings({ includeSecret: true });
        const delay = nextChinaWallClockDelay(settings.generateTime);
        runtime.dailyBriefTimer = runtime.scheduler.scheduleOnce('daily-brief', delay, async () => {
            try {
                if (runtime.getDailyBriefSettings({ includeSecret: true }).enabled) {
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
    exposeRuntime({
        getDailyBriefLearningSummary: () => getDailyBriefLearningSummary,
        dailyBriefTitle: () => dailyBriefTitle,
        dailyBriefRowToObject: () => dailyBriefRowToObject,
        getDailyBriefByDate: () => getDailyBriefByDate,
        getLatestDailyBriefSummary: () => getLatestDailyBriefSummary,
        listDailyBriefs: () => listDailyBriefs,
        generateDailyBrief: () => generateDailyBrief,
        nextChinaWallClockDelay: () => nextChinaWallClockDelay,
        scheduleDailyBrief: () => scheduleDailyBrief,
    });
}
