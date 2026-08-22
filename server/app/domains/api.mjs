import { canAccessApi } from '../../auth/capabilities.mjs';
import { createUserContext } from '../../auth/user-context.mjs';
import { handleFocusTimerRoutes } from '../../routes/focus-timer-routes.mjs';
import { handleAccountRoutes } from '../../routes/account-routes.mjs';
import { validateContractRequest } from '../../http/api-contract-validation.mjs';

export function installApiDomain(runtime, exposeRuntime) {
    async function handleApi(req, res) {
        if (req.method === 'OPTIONS') {
            runtime.sendJson(res, { ok: true });
            return;
        }
        if (await runtime.handlePublicApiRoutes(req, res, {
            dataImportToken: runtime.dataImportToken,
            backupSyncToken: runtime.backupSyncToken,
            safeSecretEqual: runtime.safeSecretEqual,
            sendJson: runtime.sendJson,
            readJsonBody: runtime.readJsonBody,
            getSession: runtime.getSession,
            ownerUserId: () => runtime.userAccountRepository.getOwnerUserId(),
            baseState: runtime.baseState,
            normalizeReview: runtime.normalizeReview,
            writeState: runtime.writeState,
            writeAuditEvent: runtime.writeAuditEvent,
            requireBreakGuardToken: runtime.requireBreakGuardToken,
            recordBreakGuardEvent: runtime.recordBreakGuardEvent,
            queueBreakGuardNotification: runtime.queueBreakGuardNotification,
            getBreakGuardSummary: runtime.getBreakGuardSummary,
            getBreakGuardScheduleConfig: runtime.getBreakGuardScheduleConfig,
            saveBreakGuardScheduleConfig: runtime.saveBreakGuardScheduleConfig,
            todayISO: runtime.todayISO,
            findDictionaryEntry: runtime.findDictionaryEntry,
            confusingWordsRepository: runtime.confusingWordsRepository,
            listConfusingWordsBackupVersions: runtime.listConfusingWordsBackupVersions,
            normalizeConfusingWordsPayload: runtime.normalizeConfusingWordsPayload,
            nowISO: runtime.nowISO,
            saveConfusingWordsBackupPayload: runtime.saveConfusingWordsBackupPayload,
            readConfusingWordsBackupPayload: runtime.readConfusingWordsBackupPayload,
            summarizeConfusingWordsPayload: runtime.summarizeConfusingWordsPayload,
            handleTelegramWebhook: runtime.handleTelegramWebhook,
        }))
            return;
        const session = runtime.getSession(req.headers.cookie);
        const sessionRole = session?.role;
        if (!session) {
            runtime.sendJson(res, { error: 'Unauthorized' }, 401);
            return;
        }
        const apiPathname = new URL(req.url || '/', 'http://localhost').pathname;
        const userContext = createUserContext(session);
        if (apiPathname === '/api/session' && req.method === 'GET') {
            runtime.sendJson(res, {
                userId: session.userId,
                displayName: session.displayName,
                accountType: session.accountType,
                userRole: session.userRole,
                role: session.role,
                maxUsers: runtime.userAccountRepository.maxUsers,
                userCount: runtime.userAccountRepository.countAccounts(),
                canAddUser: runtime.userAccountRepository.canCreateLearner(),
                capabilities: session.capabilities || [],
            });
            return;
        }
        if (req.url === '/api/client-errors' && req.method === 'POST') {
            const body = await runtime.readJsonBody(req);
            const record = runtime.writeClientErrorLog({ req, role: sessionRole, body });
            runtime.sendJson(res, { ok: true, id: record?.id || 0 });
            return;
        }
        if (!canAccessApi(session, req.method || 'GET', apiPathname)) {
            runtime.sendJson(res, { error: '该账户无权访问此功能' }, 403);
            return;
        }
        const contractBody = req.method === 'POST' ? await runtime.readJsonBody(req) : undefined;
        validateContractRequest(req.method || 'GET', apiPathname, contractBody);
        if (req.method !== 'GET' && sessionRole === 'read') {
            runtime.sendJson(res, { error: 'Read only mode' }, 403);
            return;
        }
        if (await handleAccountRoutes(req, res, {
            session: { ...session, userContext },
            sendJson: runtime.sendJson,
            readJsonBody: runtime.readJsonBody,
            userAccountRepository: runtime.userAccountRepository,
            writeAuditEvent: runtime.writeAuditEvent,
        }))
            return;
        if (await handleFocusTimerRoutes(req, res, {
            session,
            sendJson: runtime.sendJson,
            readJsonBody: runtime.readJsonBody,
            focusTimerService: runtime.focusTimerService,
        }))
            return;
        if (await runtime.handleProxySettingsRoutes(req, res, {
            sessionRole,
            sendJson: runtime.sendJson,
            readJsonBody: runtime.readJsonBody,
            writeAuditEvent: runtime.writeAuditEvent,
            getMihomoSettings: runtime.privilegedClient ? () => runtime.privilegedClient.proxyStatus() : runtime.getMihomoSettings,
            saveMihomoSubscriptionSettings: runtime.privilegedClient ? (body) => runtime.privilegedClient.proxySave(body) : runtime.saveMihomoSubscriptionSettings,
            importMihomoProviderSettings: runtime.privilegedClient ? (body) => runtime.privilegedClient.proxyImport(body) : runtime.importMihomoProviderSettings,
            selectMihomoProxy: runtime.privilegedClient ? (body) => runtime.privilegedClient.proxySelect(body) : runtime.selectMihomoProxy,
            testMihomoProxy: runtime.privilegedClient ? () => runtime.privilegedClient.proxyTest() : runtime.testMihomoProxy,
        }))
            return;
        if (await runtime.handleOpsRoutes(req, res, {
            sessionRole,
            session,
            sendJson: runtime.sendJson,
            readJsonBody: runtime.readJsonBody,
            runExclusiveTask: runtime.runExclusiveTask,
            createBackupFile: runtime.createBackupFile,
            restoreBackupFile: runtime.restoreBackupFile,
            writeAuditEvent: runtime.writeAuditEvent,
            getBackupStatus: runtime.getBackupStatus,
            collectOperationalNotifications: runtime.collectOperationalNotifications,
            getTaskCenterStatus: runtime.getTaskCenterStatus,
            getLearningProgressPayload: runtime.getLearningProgressPayload,
            getProjectProgressPayload: runtime.getProjectProgressPayload,
            getVisitStatsPayload: runtime.getVisitStatsPayload,
            getOpsLogSummaryPayload: runtime.getOpsLogSummaryPayload,
            runSqliteMaintenance: runtime.runSqliteMaintenance,
            precomputeNightlyArtifacts: runtime.precomputeNightlyArtifacts,
        }))
            return;
        if (apiPathname === '/api/study-comparison' && req.method === 'GET') {
            const requestUrl = new URL(req.url, 'http://localhost');
            runtime.sendJson(res, runtime.studyComparisonService.getComparison({
                days: requestUrl.searchParams.get('days') || 30,
            }));
            return;
        }
        if (await runtime.handleNotificationRoutes(req, res, {
            sessionRole,
            sendJson: runtime.sendJson,
            readJsonBody: runtime.readJsonBody,
            collectOperationalNotifications: runtime.collectOperationalNotifications,
            getNotificationCenterPayload: runtime.getNotificationCenterPayload,
            notificationRepository: runtime.notificationRepository,
            notificationQueue: runtime.notificationQueue,
            logStructured: runtime.logStructured,
            redactSecretText: runtime.redactSecretText,
            writeAuditEvent: runtime.writeAuditEvent,
            queueProactiveNotification: runtime.queueProactiveNotification,
            resolveBarkConfig: runtime.resolveBarkConfig,
            saveTelegramSettings: runtime.saveTelegramSettings,
            registerTelegramWebhook: runtime.registerTelegramWebhook,
            sendTelegramNotification: runtime.sendTelegramNotification,
        }))
            return;
        if (req.url?.startsWith('/api/calendar') && req.method === 'GET') {
            const requestUrl = new URL(req.url, 'http://localhost');
            runtime.sendJson(res, runtime.getCalendarPayload(sessionRole, {
                from: requestUrl.searchParams.get('from') || undefined,
                to: requestUrl.searchParams.get('to') || undefined,
            }, session.userId, session.capabilities?.includes('notifications.manage')));
            return;
        }
        if (await runtime.handleBriefRoutes(req, res, {
            sessionRole,
            sendJson: runtime.sendJson,
            readJsonBody: runtime.readJsonBody,
            ensureSqliteStore: runtime.ensureSqliteStore,
            queryLimit: runtime.queryLimit,
            todayISO: runtime.todayISO,
            nowISO: runtime.nowISO,
            dailyBriefRepository: runtime.dailyBriefRepository,
            tableChanged: runtime.tableChanged,
            runExclusiveTask: runtime.runExclusiveTask,
            getDailyBriefSettings: runtime.getDailyBriefSettings,
            saveDailyBriefSettings: runtime.saveDailyBriefSettings,
            getDailyBriefByDate: runtime.getDailyBriefByDate,
            getLatestDailyBriefSummary: runtime.getLatestDailyBriefSummary,
            listDailyBriefs: runtime.listDailyBriefs,
            generateDailyBrief: runtime.generateDailyBrief,
            sendDailyBriefEmail: runtime.sendDailyBriefEmail,
        }))
            return;
        if (await runtime.handleLearningReadRoutes(req, res, {
            sessionRole,
            session: { ...session, userContext },
            sendJson: runtime.sendJson,
            ensureSqliteStore: runtime.ensureSqliteStore,
            getGoalsList: runtime.getGoalsList,
            getProjectsList: runtime.getProjectsList,
            getSubjectsList: runtime.getSubjectsList,
            getDashboardChartsPayload: runtime.getDashboardChartsPayload,
            getDashboardPayload: runtime.getDashboardPayload,
            queryLimit: runtime.queryLimit,
            queryOffset: runtime.queryOffset,
            todayISO: runtime.todayISO,
            getReviewPrefill: runtime.getReviewPrefill,
            getCachedReviewTrend: runtime.getCachedReviewTrend,
            learningRepository: runtime.learningRepository,
            normalizeReview: runtime.normalizeReview,
            getMockExamList: runtime.getMockExamList,
            getStatisticsSummary: runtime.getStatisticsSummary,
            getEmbeddingStatus: runtime.getEmbeddingStatus,
            getErrorThemeOptions: runtime.getErrorThemeOptions,
            getCachedErrorThemeAnalysis: runtime.getCachedErrorThemeAnalysis,
            getErrorThemeDetail: runtime.getErrorThemeDetail,
            currentErrorThemeJobSnapshot: runtime.currentErrorThemeJobSnapshot,
            listLearningReports: runtime.listLearningReports,
        }))
            return;
        if (apiPathname.startsWith('/api/library')) {
            runtime.sendJson(res, { error: 'This module has been retired' }, 410);
            return;
        }
        if (apiPathname.startsWith('/api/market-copilot')) {
            runtime.sendJson(res, { error: 'This module has been retired' }, 410);
            return;
        }
        if (await runtime.handleLearningWriteRoutes(req, res, {
            sessionRole,
            session: { ...session, userContext },
            sendJson: runtime.sendJson,
            readJsonBody: runtime.readJsonBody,
            ensureSqliteStore: runtime.ensureSqliteStore,
            currentPeriod: runtime.currentPeriod,
            previousPeriod: runtime.previousPeriod,
            runExclusiveTask: runtime.runExclusiveTask,
            generateLearningReport: runtime.generateLearningReport,
            writeState: runtime.writeState,
            baseState: runtime.baseState,
            writeAuditEvent: runtime.writeAuditEvent,
            learningRepository: runtime.learningRepository,
            nowISO: runtime.nowISO,
            todayISO: runtime.todayISO,
            tableChanged: runtime.tableChanged,
        }))
            return;
        runtime.sendJson(res, { error: 'Not found' }, 404);
    }

    exposeRuntime({ "handleApi": () => handleApi }, {  });
}
