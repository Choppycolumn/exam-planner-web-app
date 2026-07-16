export function installOperationsDomain(runtime, exposeRuntime) {
    function chinaWallClockDelay(timeText = '03:20') {
        const [hourText, minuteText] = String(timeText || '03:20').split(':');
        const hour = Math.max(0, Math.min(23, Number(hourText) || 3));
        const minute = Math.max(0, Math.min(59, Number(minuteText) || 20));
        const now = new Date();
        const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        const targetChina = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate(), hour, minute, 0, 0));
        if (chinaNow >= targetChina)
            targetChina.setUTCDate(targetChina.getUTCDate() + 1);
        const targetUtcMs = targetChina.getTime() - 8 * 60 * 60 * 1000;
        return { delay: Math.max(60 * 1000, targetUtcMs - now.getTime()), nextAt: new Date(targetUtcMs).toISOString() };
    }
    function runSqliteMaintenance(kind = 'manual') {
        ensureSqliteStore();
        const ranAt = runtime.nowISO();
        try {
            runtime.runSqlite(`DELETE FROM visit_events WHERE substr(created_at, 1, 10) < ${runtime.sqlString(runtime.addDaysISO(runtime.todayISO(), -180))};`);
            runtime.runSqlite(`DELETE FROM api_request_log WHERE substr(created_at, 1, 10) < ${runtime.sqlString(runtime.addDaysISO(runtime.todayISO(), -90))};`);
            runtime.runSqlite(`DELETE FROM client_error_log WHERE substr(created_at, 1, 10) < ${runtime.sqlString(runtime.addDaysISO(runtime.todayISO(), -120))};`);
            runtime.runSqlite(`DELETE FROM task_runs WHERE substr(started_at, 1, 10) < ${runtime.sqlString(runtime.addDaysISO(runtime.todayISO(), -180))};`);
            runtime.runSqlite('PRAGMA optimize;\nANALYZE;');
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('last_sqlite_maintenance_at', ${runtime.sqlString(ranAt)}, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
    INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('last_sqlite_maintenance_kind', ${runtime.sqlString(kind)}, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
    INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('last_sqlite_maintenance_error', '', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
            return { ok: true, ranAt, kind };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('last_sqlite_maintenance_error', ${runtime.sqlString(message)}, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
            return { ok: false, ranAt, kind, error: message };
        }
    }
    function scheduleDailyMaintenance() {
        const { delay, nextAt } = chinaWallClockDelay('03:20');
        runtime.nextMaintenanceAt = nextAt;
        runtime.setRuntimeMetadata('worker_next_maintenance_at', runtime.nextMaintenanceAt);
        runtime.maintenanceTimer = runtime.scheduler.scheduleOnce('daily-maintenance', delay, async () => {
            try {
                await runtime.runExclusiveTask('nightly-maintenance', 'nightly', async () => {
                    runtime.ensureDailyBackup();
                    runtime.ensureWeeklyBackup();
                    await runtime.precomputeNightlyArtifacts('nightly');
                    runSqliteMaintenance('nightly');
                    runtime.getDashboardPayload('write');
                    runtime.getStatisticsSummary();
                    return { ok: true };
                }, { timeoutMs: 30 * 60 * 1000 });
            }
            catch (error) {
                runtime.logStructured('error', 'nightly_maintenance_failed', { error: runtime.redactSecretText(error.message || String(error)) });
            }
            finally {
                scheduleDailyMaintenance();
            }
        });
    }
    function getDiskStatus() {
        try {
            const stats = runtime.statfsSync(runtime.dataDir);
            const blockSize = Number(stats.bsize || 0);
            const totalBytes = Number(stats.blocks || 0) * blockSize;
            const availableBytes = Number(stats.bavail || 0) * blockSize;
            const freeBytes = Number(stats.bfree || 0) * blockSize;
            const usedBytes = Math.max(0, totalBytes - freeBytes);
            return {
                totalBytes,
                usedBytes,
                availableBytes,
                usedPercent: totalBytes ? `${Math.round((usedBytes / totalBytes) * 100)}%` : '',
                mount: runtime.dataDir,
            };
        }
        catch {
            return null;
        }
    }
    function getRuntimeStatus() {
        const memory = process.memoryUsage();
        return {
            uptimeSeconds: Math.round(runtime.uptime()),
            processUptimeSeconds: Math.round(process.uptime()),
            cpuCount: runtime.cpus().length,
            loadAverage: runtime.loadavg(),
            memory: {
                totalBytes: runtime.totalmem(),
                freeBytes: runtime.freemem(),
                processRssBytes: memory.rss,
                heapUsedBytes: memory.heapUsed,
                heapTotalBytes: memory.heapTotal,
            },
            disk: getDiskStatus(),
            database: runtime.sqliteRepository.metrics(),
            scheduler: runtime.scheduler.snapshot(),
            nodeVersion: process.version,
        };
    }
    function getHealthPayload() {
        const checks = [];
        let ok = true;
        const addCheck = (name, status, detail = {}) => {
            if (status !== 'ok')
                ok = false;
            checks.push({ name, status, ...detail });
        };
        try {
            ensureSqliteStore();
            const probe = runtime.sqliteScalar('SELECT 1;');
            addCheck('sqlite', Number(probe) === 1 ? 'ok' : 'error', { probe: Number(probe) });
        }
        catch (error) {
            addCheck('sqlite', 'error', { error: runtime.redactSecretText(error.message || String(error)) });
        }
        try {
            const disk = getDiskStatus();
            addCheck('disk', !disk || disk.availableBytes >= runtime.minFreeDiskBytes ? 'ok' : 'warn', { disk });
        }
        catch (error) {
            addCheck('disk', 'error', { error: runtime.redactSecretText(error.message || String(error)) });
        }
        try {
            const backup = runtime.getBackupStatus();
            const backupStatus = !backup.lastBackup || backup.latestVerification?.ok !== true ? 'warn' : 'ok';
            addCheck('backup', backupStatus, {
                backupCount: backup.backupCount,
                lastBackupAt: backup.lastBackup?.createdAt ?? null,
                latestVerification: backup.latestVerification,
            });
        }
        catch (error) {
            addCheck('backup', 'error', { error: runtime.redactSecretText(error.message || String(error)) });
        }
        addCheck('tasks', runtime.activeTaskLocks.size ? 'warn' : 'ok', { active: Array.from(runtime.activeTaskLocks) });
        const worker = runtime.workerHeartbeatStatus();
        addCheck('background-worker', worker.healthy ? 'ok' : 'warn', { worker });
        const externalApis = runtime.externalApiClient.status();
        addCheck('external-api', externalApis.openCircuits.length ? 'warn' : 'ok', {
            openCircuitCount: externalApis.openCircuits.length,
        });
        const unified = runtime.summarizeHealth(checks.map((check) => ({
            id: check.name,
            title: check.name,
            status: check.status === 'error' ? 'failed' : check.status === 'warn' ? 'degraded' : 'normal',
            action: check.status === 'ok' ? '' : `检查 ${check.name} 状态并处理异常。`,
        })));
        return {
            ok,
            status: ok ? 'ok' : 'degraded',
            unified,
            generatedAt: runtime.nowISO(),
            version: process.env.npm_package_version || '0.0.0',
            runtime: getRuntimeStatus(),
            externalApis,
            checks,
        };
    }
    function getReadinessPayload() {
        const checks = [];
        const add = (name, ok, detail = {}) => checks.push({ name, ok: Boolean(ok), ...detail });
        add('startup', runtime.startupReady && !runtime.startupError, runtime.startupError ? { error: runtime.startupError } : {});
        try {
            const indexFile = runtime.join(runtime.root, 'index.html');
            const indexOk = runtime.existsSync(indexFile) && runtime.statSync(indexFile).size > 128;
            add('static-index', indexOk, { path: 'index.html' });
            if (indexOk) {
                const html = runtime.readFileSync(indexFile, 'utf8');
                const assetPaths = Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g), (match) => match[1]);
                const missingAssets = assetPaths.filter((assetPath) => !runtime.existsSync(runtime.join(runtime.root, assetPath)));
                add('static-assets', assetPaths.length > 0 && missingAssets.length === 0, {
                    referencedAssets: assetPaths.length,
                    missingAssets: missingAssets.map((assetPath) => assetPath.split('/').pop()),
                });
            }
        }
        catch (error) {
            add('static-index', false, { error: runtime.redactSecretText(error.message || String(error)) });
        }
        try {
            const probe = runtime.sqliteReady ? Number(runtime.sqliteScalar(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('goals','short_term_tasks','daily_reviews');`)) : 0;
            add('sqlite', probe === 3, { requiredTables: 3, availableTables: probe });
        }
        catch (error) {
            add('sqlite', false, { error: runtime.redactSecretText(error.message || String(error)) });
        }
        const ok = checks.every((check) => check.ok);
        return { ok, status: ok ? 'ready' : 'not_ready', serviceRole: runtime.serviceRole, generatedAt: runtime.nowISO(), checks };
    }
    function getTaskCenterStatus() {
        ensureSqliteStore();
        const reports = runtime.listLearningReports();
        const latestWeeklyReport = reports.find((report) => report.kind === 'weekly') || null;
        const latestMonthlyReport = reports.find((report) => report.kind === 'monthly') || null;
        const latestBatch = runtime.sqliteJson(`SELECT id, source, model_name AS modelName, period_start AS periodStart, period_end AS periodEnd,
    review_count AS reviewCount, occurrence_count AS occurrenceCount, theme_count AS themeCount, status, created_at AS createdAt, completed_at AS completedAt, note
    FROM error_theme_batches
    ORDER BY created_at DESC, id DESC
    LIMIT 1;`)[0] || null;
        const corrections = runtime.sqliteJson(`SELECT COUNT(*) AS count, MAX(updated_at) AS lastUpdatedAt FROM error_theme_corrections;`)[0] || { count: 0, lastUpdatedAt: null };
        const embeddingRows = Number(runtime.sqliteScalar('SELECT COUNT(*) FROM review_sentence_embeddings;') || 0);
        const reviewRows = Number(runtime.sqliteScalar('SELECT COUNT(*) FROM daily_reviews;') || 0);
        const studyRows = Number(runtime.sqliteScalar('SELECT COUNT(*) FROM study_time_records;') || 0);
        const lastMaintenanceAt = runtime.sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_sqlite_maintenance_at' LIMIT 1;") || null;
        const lastMaintenanceKind = runtime.sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_sqlite_maintenance_kind' LIMIT 1;") || null;
        const lastMaintenanceError = runtime.sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_sqlite_maintenance_error' LIMIT 1;") || '';
        const lastPrecomputeAt = runtime.sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_precompute_at' LIMIT 1;") || null;
        const lastPrecomputeTrigger = runtime.sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_precompute_trigger' LIMIT 1;") || null;
        const lastPrecomputeError = runtime.sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_precompute_error' LIMIT 1;") || '';
        const taskMetrics = (() => {
            try {
                return runtime.taskRunsRepository.getMetrics();
            }
            catch {
                return { total: 0, running: 0, completed: 0, failed: 0, last24h: 0, averageDurationMs: null, maxDurationMs: null, byName: [] };
            }
        })();
        return {
            generatedAt: runtime.nowISO(),
            backup: {
                ...runtime.getBackupStatus(),
                nextDailyBackupAt: runtime.nextDailyBackupAt(),
                nextWeeklyBackupAt: runtime.nextWeeklyBackupAt(),
            },
            reports: {
                count: reports.length,
                latestWeeklyReport,
                latestMonthlyReport,
                lastReportCheckAt: runtime.sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_report_check_at' LIMIT 1;") || null,
            },
            dailyBrief: {
                latest: runtime.getLatestDailyBriefSummary(),
                nextDailyBriefAt: runtime.runtimeScheduleValue('worker_next_daily_brief_at', runtime.nextDailyBriefAt),
                emailEnabled: Boolean(runtime.getDailyBriefSettings({ includeSecret: true }).email.enabled),
                taskReminders: runtime.getDailyBriefSettings({ includeSecret: true }).taskReminders,
                nextTaskReminderScanAt: runtime.runtimeScheduleValue('worker_next_task_reminder_at', runtime.nextTaskReminderScanAt),
            },
            errorThemes: {
                job: runtime.currentErrorThemeJobSnapshot(),
                latestBatch,
                nextNightlyBatchAt: runtime.runtimeScheduleValue('worker_next_error_theme_at', runtime.nextNightlyErrorThemeAt),
                correctionCount: Number(corrections.count || 0),
                lastCorrectionAt: corrections.lastUpdatedAt || null,
            },
            embedding: { ...runtime.getEmbeddingStatus(), embeddingRows },
            maintenance: {
                lastAt: lastMaintenanceAt,
                lastKind: lastMaintenanceKind,
                lastError: lastMaintenanceError,
                nextMaintenanceAt: runtime.runtimeScheduleValue('worker_next_maintenance_at', runtime.nextMaintenanceAt),
                lastPrecomputeAt,
                lastPrecomputeTrigger,
                lastPrecomputeError,
            },
            data: {
                reviews: reviewRows,
                studyTimeRecords: studyRows,
                revision: runtime.dataRevision,
            },
            tasks: {
                active: Array.from(runtime.activeTaskLocks),
                latestRuns: runtime.lastTaskRuns(12),
                metrics: taskMetrics,
            },
            runtime: getRuntimeStatus(),
            worker: runtime.workerHeartbeatStatus(),
            unifiedHealth: getHealthPayload().unified,
            externalApis: runtime.externalApiClient.status(),
        };
    }
    function runStructuredMigrations() {
        const currentVersion = Number(runtime.sqliteScalar("SELECT value FROM app_metadata WHERE key = 'structured_schema_version' LIMIT 1;") || 0);
        const applied = runtime.runSqlMigrations({
            sqlite: runtime.sqliteRepository,
            migrationsDir: runtime.migrationsDir,
            currentVersion,
            shouldApply: (_fileName, version) => ![19, 20].includes(version),
            setVersion: (version) => runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('structured_schema_version', ${runtime.sqlString(String(version))}, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`),
        });
        if (applied.length) {
            runtime.logStructured('info', 'sqlite_migrations_applied', { applied });
        }
    }
    function ensureTaskReminderColumns() {
        const existing = new Set(runtime.sqliteJson('PRAGMA table_info(short_term_tasks);').map((column) => column.name));
        const columns = [
            ['due_time', "TEXT NOT NULL DEFAULT ''"],
            ['reminder_enabled', 'INTEGER NOT NULL DEFAULT 0'],
            ['reminder_sent_offsets', "TEXT NOT NULL DEFAULT '[]'"],
            ['reminder_last_sent_at', 'TEXT'],
        ];
        for (const [name, definition] of columns) {
            if (!existing.has(name))
                runtime.runSqlite(`ALTER TABLE short_term_tasks ADD COLUMN ${name} ${definition};`);
        }
        runtime.runSqlite('CREATE INDEX IF NOT EXISTS idx_short_term_tasks_due_time ON short_term_tasks(is_completed, due_date, due_time);');
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
    function getCalendarPayload(sessionRole, { from, to } = {}, userId = 1, accountType = 'admin') {
        ensureSqliteStore();
        return {
            generatedAt: runtime.nowISO(),
            from,
            to,
            events: runtime.calendarRepository.getEvents({ from, to, userId, includeNotifications: accountType === 'admin' }),
            readOnly: sessionRole === 'read',
        };
    }
    function collectOperationalNotifications() {
        try {
            const status = getHealthPayload();
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
        runtime.runSqlite(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS backup_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_backup_log_created_at ON backup_log(created_at);`);
        runtime.createStructuredTables();
        runtime.seedCurrentConfusingWordsBackupVersionIfNeeded();
        const stateCount = Number(runtime.sqliteScalar('SELECT COUNT(*) FROM app_state WHERE id = 1;') || 0);
        if (!stateCount && runtime.existsSync(runtime.legacyDataFile)) {
            const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
            const legacyBackupDir = runtime.join(runtime.backupsDir, `auto-pre-sqlite-${timestamp}`);
            runtime.mkdirSync(legacyBackupDir, { recursive: true });
            runtime.writeFileSync(runtime.join(legacyBackupDir, 'db.json'), runtime.readFileSync(runtime.legacyDataFile));
            runtime.writeStateToSqlite(JSON.parse(runtime.readFileSync(runtime.legacyDataFile, 'utf8')));
        }
        else if (!stateCount) {
            runtime.writeStateToSqlite(runtime.baseState());
        }
        const structuredVersion = Number(runtime.sqliteScalar("SELECT value FROM app_metadata WHERE key = 'structured_schema_version' LIMIT 1;") || 0);
        if (structuredVersion < 1) {
            runtime.createBackupFile('pre-tables', 'automatic backup before structured table migration');
            runtime.writeStateToTables(runtime.readLegacyStateForMigration());
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('structured_schema_version', '1', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        }
        if (structuredVersion < 2) {
            runtime.createBackupFile('pre-reports', 'automatic backup before learning reports migration');
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('structured_schema_version', '2', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        }
        if (structuredVersion < 3) {
            runtime.createBackupFile('pre-error-themes', 'automatic backup before error theme library migration');
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('structured_schema_version', '3', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        }
        if (structuredVersion < 4) {
            runtime.createBackupFile('pre-embeddings', 'automatic backup before local embedding tables migration');
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('structured_schema_version', '4', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        }
        if (structuredVersion < 5) {
            runtime.createBackupFile('pre-error-corrections', 'automatic backup before error correction samples migration');
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('structured_schema_version', '5', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        }
        if (structuredVersion < 6) {
            runtime.createBackupFile('pre-study-summaries', 'automatic backup before materialized study summary migration');
            runtime.rebuildStudySummaries();
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('structured_schema_version', '6', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        }
        if (structuredVersion < 7) {
            runtime.createBackupFile('pre-daily-briefs', 'automatic backup before daily brief migration');
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('structured_schema_version', '7', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        }
        if (structuredVersion < 8) {
            runtime.createBackupFile('pre-problem-inbox', 'automatic backup before problem inbox migration');
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('structured_schema_version', '8', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        }
        if (structuredVersion < 9) {
            runtime.createBackupFile('pre-precomputed-cache', 'automatic backup before precomputed cache migration');
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('structured_schema_version', '9', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        }
        if (structuredVersion < 10) {
            runtime.createBackupFile('pre-library', 'automatic backup before library migration');
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('structured_schema_version', '10', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        }
        if (structuredVersion < 11) {
            runtime.createBackupFile('pre-library-bookmarks', 'automatic backup before library bookmarks migration');
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('structured_schema_version', '11', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        }
        if (structuredVersion < 12) {
            runtime.createBackupFile('pre-visit-events', 'automatic backup before visit statistics migration');
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('structured_schema_version', '12', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        }
        if (structuredVersion < 13) {
            runtime.createBackupFile('pre-observability', 'automatic backup before task, audit and request log migration');
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('structured_schema_version', '13', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        }
        runStructuredMigrations();
        ensureTaskReminderColumns();
        runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('storage_backend', 'sqlite-tables', datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        runtime.sqliteReady = true;
        if (!runtime.backgroundJobsEnabled)
            return;
        runtime.startWorkerHeartbeat();
        runtime.ensureDailyBackup();
        runtime.ensureWeeklyBackup();
        runtime.getBackupStatus({ verifyLatest: true });
        runtime.ensureDictionaryIndex();
        runtime.ensureStudySummariesReady();
        if (!Number(runtime.sqliteScalar('SELECT COUNT(*) FROM learning_reports WHERE user_id = 1;') || 0))
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
            scheduleDailyMaintenance();
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

    exposeRuntime({ "chinaWallClockDelay": () => chinaWallClockDelay, "runSqliteMaintenance": () => runSqliteMaintenance, "scheduleDailyMaintenance": () => scheduleDailyMaintenance, "getDiskStatus": () => getDiskStatus, "getRuntimeStatus": () => getRuntimeStatus, "getHealthPayload": () => getHealthPayload, "getReadinessPayload": () => getReadinessPayload, "getTaskCenterStatus": () => getTaskCenterStatus, "runStructuredMigrations": () => runStructuredMigrations, "ensureTaskReminderColumns": () => ensureTaskReminderColumns, "notifyEvent": () => notifyEvent, "getNotificationCenterPayload": () => getNotificationCenterPayload, "getCalendarPayload": () => getCalendarPayload, "collectOperationalNotifications": () => collectOperationalNotifications, "scheduleBackupChecks": () => scheduleBackupChecks, "ensureSqliteStore": () => ensureSqliteStore }, {  });
}
