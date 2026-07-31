export function installOperationsLifecycleDomain(runtime, exposeRuntime) {
    function runStructuredMigrations() {
        const currentVersion = Number(runtime.appMetadataRepository.get('structured_schema_version', 0) || 0);
        const applied = runtime.runSqlMigrations({
            sqlite: runtime.sqliteRepository,
            migrationsDir: runtime.migrationsDir,
            currentVersion,
            shouldApply: (fileName) => ![
                '019_market_copilot_v1.sql',
                '020_market_copilot_ledger_refactor.sql',
            ].includes(fileName),
            setVersion: (version) => runtime.appMetadataRepository.set('structured_schema_version', version),
        });
        if (applied.length) {
            runtime.logStructured('info', 'sqlite_migrations_applied', { applied });
        }
        const status = runtime.migrationStatus({ sqlite: runtime.sqliteRepository, migrationsDir: runtime.migrationsDir });
        if (status.pending.length || status.mismatched.length) {
            throw new Error(`Database migration state is incomplete: pending=${status.pending.length}, mismatched=${status.mismatched.length}`);
        }
        return status;
    }
    function ensureTaskReminderColumns() {
        runtime.schemaBootstrapRepository.ensureTaskReminderColumns();
    }
    function notifyEvent(payload) {
        try {
            runtime.notificationRepository.upsertEvent(payload);
        }
        catch (error) {
            runtime.logStructured('warn', 'notification_event_failed', { error: runtime.redactSecretText(error.message || String(error)), eventKey: payload?.eventKey });
        }
    }
    function getNotificationCenterPayload(sessionRole, { status = 'all' } = {}) {
        ensureSqliteStore();
        const wechatClawbot = runtime.resolveOpenClawWechatConfig();
        const storedChannels = runtime.notificationRepository.listChannels();
        const channels = storedChannels.some((channel) => channel.channelKey === 'clawbot_weixin') ? storedChannels : [
            ...storedChannels,
            {
                id: 0,
                channelKey: 'clawbot_weixin',
                type: 'clawbot_weixin',
                name: '微信 ClawBot',
                enabled: wechatClawbot.enabled && wechatClawbot.configured,
                config: { scheduleTime: wechatClawbot.scheduleTime },
                createdAt: runtime.nowISO(),
                updatedAt: runtime.nowISO(),
            },
        ];
        const channelHealth = runtime.notificationChannelHealth.snapshot(channels);
        return {
            generatedAt: runtime.nowISO(),
            channels,
            channelReadiness: channels.map((channel) => ({
                channelKey: channel.channelKey,
                type: channel.type,
                ...runtime.notificationChannelReadiness(channel),
            })),
            events: runtime.notificationRepository.listEvents({ status, limit: 80 }),
            deliveries: runtime.notificationRepository.listDeliveries(80),
            metrics: runtime.notificationRepository.metrics(),
            channelHealth,
            wechatClawbot,
            bark: runtime.resolveBarkConfig(),
            telegram: runtime.telegramConfigStatus(runtime.readTelegramConfig(runtime.telegramEnvFile)),
            notificationSemantics: {
                reply: '收到微信指令后在同一会话中即时回复，不进入主动通知队列。',
                proactive: '日报、待办提醒和测试消息先进入持久化队列，失败后自动重试并站内兜底。',
            },
            readOnly: sessionRole === 'read',
            channelPlan: {
                clawbotWeixin: {
                    enabled: wechatClawbot.enabled && wechatClawbot.configured,
                    requiredEnv: ['OPENCLAW_CLAWBOT_CHANNEL', 'OPENCLAW_CLAWBOT_ACCOUNT', 'OPENCLAW_CLAWBOT_TARGET'],
                    method: 'openclaw message send via local OpenClaw gateway',
                },
                bark: {
                    enabled: Boolean(process.env.BARK_DEVICE_KEY),
                    requiredEnv: ['BARK_DEVICE_KEY'],
                    method: 'POST Bark API V2 /push',
                },
                telegram: {
                    enabled: runtime.telegramConfigStatus(runtime.readTelegramConfig(runtime.telegramEnvFile)).configured,
                    requiredEnv: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_ALLOWED_USER_ID'],
                    method: 'POST https://api.telegram.org/bot<token>/sendMessage',
                },
                wecomWebhook: {
                    enabled: Boolean(process.env.WECOM_WEBHOOK_URL),
                    requiredEnv: ['WECOM_WEBHOOK_URL'],
                    method: 'POST webhook URL with msgtype text/markdown',
                },
                genericWebhook: {
                    enabled: Boolean(process.env.NOTIFICATION_WEBHOOK_URL),
                    requiredEnv: ['NOTIFICATION_WEBHOOK_URL'],
                    method: 'POST JSON payload for claw or other relay services',
                },
            },
        };
    }
    function getCalendarPayload(sessionRole, { from, to } = {}, userId, includeNotifications = false) {
        ensureSqliteStore();
        return {
            generatedAt: runtime.nowISO(),
            from,
            to,
            events: runtime.calendarRepository.getEvents({ from, to, userId, includeNotifications }),
            readOnly: sessionRole === 'read',
        };
    }
    function collectOperationalNotifications() {
        try {
            const status = runtime.getHealthPayload();
            const disk = status.checks?.find?.((check) => check.name === 'disk')?.detail?.disk;
            if (disk && disk.availableBytes < runtime.minFreeDiskBytes) {
                notifyEvent({
                    eventKey: `ops:disk:${runtime.todayISO()}`,
                    source: 'ops',
                    severity: 'warning',
                    title: '服务器磁盘空间预警',
                    content: `可用空间低于阈值，当前剩余 ${Math.round(disk.availableBytes / 1024 / 1024)} MB。`,
                    payload: { disk },
                });
            }
            const taskMetrics = runtime.taskRunsRepository.getMetrics();
            if (taskMetrics.failedLast24h > 0) {
                notifyEvent({
                    eventKey: `ops:task-failed:${runtime.todayISO()}`,
                    source: 'ops',
                    severity: 'warning',
                    title: '后台任务存在失败记录',
                    content: `过去 24 小时后台任务失败 ${taskMetrics.failedLast24h} 次，建议查看后台任务控制台。`,
                    payload: { metrics: taskMetrics },
                });
            }
            const apiMetrics = runtime.opsRepository.getApiMetrics?.();
            if (apiMetrics?.serverErrorsLast24h > 0) {
                notifyEvent({
                    eventKey: `ops:api-error:${runtime.todayISO()}`,
                    source: 'ops',
                    severity: 'warning',
                    title: '接口错误需要关注',
                    content: `过去 24 小时请求日志中存在 ${apiMetrics.serverErrorsLast24h} 个服务端错误。`,
                    payload: { apiMetrics },
                });
            }
            const clientErrorMetrics = runtime.opsRepository.getClientErrorMetrics?.();
            if (clientErrorMetrics?.last24h > 0) {
                notifyEvent({
                    eventKey: `ops:client-error:${runtime.todayISO()}`,
                    source: 'ops',
                    severity: 'warning',
                    title: '前端页面错误需要关注',
                    content: `过去 24 小时记录到 ${clientErrorMetrics.last24h} 个页面错误，请在运维中心查看摘要。`,
                    payload: { metrics: clientErrorMetrics },
                });
            }
        }
        catch (error) {
            runtime.logStructured('warn', 'collect_operational_notifications_failed', { error: runtime.redactSecretText(error.message || String(error)) });
        }
    }
    function scheduleBackupChecks() {
        if (!runtime.backgroundJobsEnabled)
            return;
        const candidates = [runtime.nextDailyBackupAt(), runtime.nextWeeklyBackupAt()]
            .map((value) => Date.parse(value))
            .filter(Number.isFinite);
        const nextAt = candidates.length ? Math.min(...candidates) : Date.now() + 60 * 60 * 1000;
        const delay = Math.max(60 * 1000, nextAt - Date.now());
        runtime.reportTimer = runtime.scheduler.scheduleOnce('backup-check', delay, () => {
            try {
                runtime.ensureDailyBackup();
                runtime.ensureWeeklyBackup();
            }
            catch (error) {
                runtime.logStructured('error', 'scheduled_backup_failed', { error: runtime.redactSecretText(error.message || String(error)) });
            }
            finally {
                scheduleBackupChecks();
            }
        });
        runtime.reportTimerStarted = true;
    }
    function ensureSqliteStore() {
        if (runtime.sqliteReady)
            return;
        runtime.mkdirSync(runtime.dataDir, { recursive: true });
        runtime.mkdirSync(runtime.backupsDir, { recursive: true });
        runtime.schemaBootstrapRepository.initializeCoreTables();
        runtime.createStructuredTables();
        const stateExists = runtime.schemaBootstrapRepository.stateExists();
        if (!stateExists && runtime.existsSync(runtime.legacyDataFile)) {
            const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
            const legacyBackupDir = runtime.join(runtime.backupsDir, `auto-pre-sqlite-${timestamp}`);
            runtime.mkdirSync(legacyBackupDir, { recursive: true });
            runtime.writeFileSync(runtime.join(legacyBackupDir, 'db.json'), runtime.readFileSync(runtime.legacyDataFile));
            runtime.writeStateToSqlite(JSON.parse(runtime.readFileSync(runtime.legacyDataFile, 'utf8')));
        }
        else if (!stateExists) {
            runtime.writeStateToSqlite(runtime.baseState());
        }
        const structuredVersion = Number(runtime.appMetadataRepository.get('structured_schema_version', 0) || 0);
        if (structuredVersion < 1) {
            runtime.createBackupFile('pre-tables', 'automatic backup before structured table migration');
            runtime.writeStateToTables(runtime.readLegacyStateForMigration());
            runtime.appMetadataRepository.set('structured_schema_version', 1);
        }
        if (structuredVersion < 2) {
            runtime.createBackupFile('pre-reports', 'automatic backup before learning reports migration');
            runtime.appMetadataRepository.set('structured_schema_version', 2);
        }
        if (structuredVersion < 3) {
            runtime.createBackupFile('pre-error-themes', 'automatic backup before error theme library migration');
            runtime.appMetadataRepository.set('structured_schema_version', 3);
        }
        if (structuredVersion < 4) {
            runtime.createBackupFile('pre-embeddings', 'automatic backup before local embedding tables migration');
            runtime.appMetadataRepository.set('structured_schema_version', 4);
        }
        if (structuredVersion < 5) {
            runtime.createBackupFile('pre-error-corrections', 'automatic backup before error correction samples migration');
            runtime.appMetadataRepository.set('structured_schema_version', 5);
        }
        if (structuredVersion < 6) {
            runtime.createBackupFile('pre-study-summaries', 'automatic backup before materialized study summary migration');
            runtime.rebuildStudySummaries();
            runtime.appMetadataRepository.set('structured_schema_version', 6);
        }
        if (structuredVersion < 7) {
            runtime.createBackupFile('pre-daily-briefs', 'automatic backup before daily brief migration');
            runtime.appMetadataRepository.set('structured_schema_version', 7);
        }
        if (structuredVersion < 8) {
            runtime.createBackupFile('pre-problem-inbox', 'automatic backup before problem inbox migration');
            runtime.appMetadataRepository.set('structured_schema_version', 8);
        }
        if (structuredVersion < 9) {
            runtime.createBackupFile('pre-precomputed-cache', 'automatic backup before precomputed cache migration');
            runtime.appMetadataRepository.set('structured_schema_version', 9);
        }
        if (structuredVersion < 10) {
            runtime.createBackupFile('pre-library', 'automatic backup before library migration');
            runtime.appMetadataRepository.set('structured_schema_version', 10);
        }
        if (structuredVersion < 11) {
            runtime.createBackupFile('pre-library-bookmarks', 'automatic backup before library bookmarks migration');
            runtime.appMetadataRepository.set('structured_schema_version', 11);
        }
        if (structuredVersion < 12) {
            runtime.createBackupFile('pre-visit-events', 'automatic backup before visit statistics migration');
            runtime.appMetadataRepository.set('structured_schema_version', 12);
        }
        if (structuredVersion < 13) {
            runtime.createBackupFile('pre-observability', 'automatic backup before task, audit and request log migration');
            runtime.appMetadataRepository.set('structured_schema_version', 13);
        }
        runStructuredMigrations();
        runtime.userAccountRepository.ensureAdminCredential(runtime.appPassword);
        runtime.seedCurrentConfusingWordsBackupVersionIfNeeded();
        runtime.sessionRepository.cleanup();
        ensureTaskReminderColumns();
        runtime.appMetadataRepository.set('storage_backend', 'sqlite-tables');
        runtime.sqliteReady = true;
        if (!runtime.backgroundJobsEnabled)
            return;
        runtime.startWorkerHeartbeat();
        runtime.ensureDailyBackup();
        runtime.ensureWeeklyBackup();
        runtime.getBackupStatus({ verifyLatest: true });
        runtime.ensureDictionaryIndex();
        runtime.ensureStudySummariesReady();
        const ownerUserId = runtime.userAccountRepository.getOwnerUserId();
        if (!runtime.schemaBootstrapRepository.learningReportCount(ownerUserId))
            runtime.ensureAutomaticReports();
        if (!runtime.reportTimerStarted)
            scheduleBackupChecks();
        if (!runtime.nightlyErrorThemeTimerStarted) {
            runtime.scheduleNightlyErrorThemeBatch();
            runtime.nightlyErrorThemeTimerStarted = true;
        }
        if (!runtime.dailyBriefTimerStarted) {
            runtime.scheduleDailyBrief();
            runtime.dailyBriefTimerStarted = true;
        }
        if (!runtime.maintenanceTimerStarted) {
            runtime.scheduleDailyMaintenance();
            runtime.maintenanceTimerStarted = true;
        }
        if (!runtime.taskReminderTimerStarted) {
            runtime.scheduleTaskReminderScan();
            runtime.taskReminderTimerStarted = true;
        }
        if (!runtime.notificationQueueTimerStarted) {
            runtime.scheduleNotificationQueue();
            runtime.notificationQueueTimerStarted = true;
        }
    }

    exposeRuntime({
        runStructuredMigrations: () => runStructuredMigrations,
        ensureTaskReminderColumns: () => ensureTaskReminderColumns,
        notifyEvent: () => notifyEvent,
        getNotificationCenterPayload: () => getNotificationCenterPayload,
        getCalendarPayload: () => getCalendarPayload,
        collectOperationalNotifications: () => collectOperationalNotifications,
        scheduleBackupChecks: () => scheduleBackupChecks,
        ensureSqliteStore: () => ensureSqliteStore,
    });
}
