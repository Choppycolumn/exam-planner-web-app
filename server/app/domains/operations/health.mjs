export function installOperationsHealthDomain(runtime, exposeRuntime) {
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
        runtime.ensureSqliteStore();
        const ranAt = runtime.nowISO();
        try {
            runtime.opsRepository.pruneOperationalData({
                visitBefore: runtime.addDaysISO(runtime.todayISO(), -180),
                apiBefore: runtime.addDaysISO(runtime.todayISO(), -90),
                clientErrorBefore: runtime.addDaysISO(runtime.todayISO(), -120),
                taskRunBefore: runtime.addDaysISO(runtime.todayISO(), -180),
            });
            runtime.sqliteRepository.optimize();
            runtime.appMetadataRepository.setMany({
                last_sqlite_maintenance_at: ranAt,
                last_sqlite_maintenance_kind: kind,
                last_sqlite_maintenance_error: '',
            });
            return { ok: true, ranAt, kind };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            runtime.appMetadataRepository.set('last_sqlite_maintenance_error', message);
            return { ok: false, ranAt, kind, error: message };
        }
    }
    function scheduleDailyMaintenance() {
        const { delay, nextAt } = chinaWallClockDelay(process.env.MAINTENANCE_TIME || '05:20');
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
        const resourceBudget = runtime.resourceBudget.snapshot();
        const io = runtime.linuxResourceHealth.snapshot();
        return {
            uptimeSeconds: Math.round(runtime.uptime()),
            processUptimeSeconds: Math.round(process.uptime()),
            cpuCount: runtime.cpus().length,
            loadAverage: runtime.loadavg(),
            memory: {
                totalBytes: runtime.totalmem(),
                freeBytes: runtime.freemem(),
                availableBytes: resourceBudget.availableMemoryBytes,
                processRssBytes: memory.rss,
                heapUsedBytes: memory.heapUsed,
                heapTotalBytes: memory.heapTotal,
            },
            disk: getDiskStatus(),
            database: runtime.sqliteRepository.metrics(),
            scheduler: runtime.scheduler.snapshot(),
            resourceBudget,
            io,
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
            runtime.ensureSqliteStore();
            const probe = runtime.opsRepository.sqliteProbe();
            addCheck('sqlite', probe ? 'ok' : 'error', { probe: probe ? 1 : 0 });
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
        const io = runtime.linuxResourceHealth.snapshot();
        addCheck('disk-io', io.status === 'failed' ? 'error' : io.status === 'degraded' ? 'warn' : 'ok', {
            iowaitPercent: io.iowaitPercent,
            ioPressure: io.ioPressure,
            blockedProcessCount: io.blockedProcessCount,
            action: io.action,
        });
        const channelHealth = runtime.notificationChannelHealth.snapshot(runtime.notificationRepository.listChannels())
            .filter((channel) => channel.enabled);
        const degradedChannels = channelHealth.filter((channel) => channel.status !== 'normal' || channel.circuitOpen);
        addCheck('notification-channels', degradedChannels.length ? 'warn' : 'ok', {
            enabledCount: channelHealth.length,
            degradedCount: degradedChannels.length,
            channels: degradedChannels.map((channel) => ({
                channelKey: channel.channelKey,
                status: channel.status,
                circuitOpenUntil: channel.circuitOpenUntil,
                action: channel.action,
            })),
        });
        const unified = runtime.summarizeHealth(checks.map((check) => ({
            id: check.name,
            title: check.name,
            status: check.status === 'error' ? 'failed' : check.status === 'warn' ? 'degraded' : 'normal',
            action: check.status === 'ok' ? '' : check.action || `检查 ${check.name} 状态并处理异常。`,
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
            const probe = runtime.sqliteReady ? runtime.opsRepository.requiredTableCount() : 0;
            add('sqlite', probe === 3, { requiredTables: 3, availableTables: probe });
        }
        catch (error) {
            add('sqlite', false, { error: runtime.redactSecretText(error.message || String(error)) });
        }
        try {
            const migrations = runtime.migrationStatus({ sqlite: runtime.sqliteRepository, migrationsDir: runtime.migrationsDir });
            add('migrations', migrations.pending.length === 0 && migrations.mismatched.length === 0, {
                applied: migrations.applied,
                pending: migrations.pending.length,
                mismatched: migrations.mismatched.length,
            });
        }
        catch (error) {
            add('migrations', false, { error: runtime.redactSecretText(error.message || String(error)) });
        }
        const ok = checks.every((check) => check.ok);
        return { ok, status: ok ? 'ready' : 'not_ready', serviceRole: runtime.serviceRole, generatedAt: runtime.nowISO(), checks };
    }
    function getTaskCenterStatus() {
        runtime.ensureSqliteStore();
        const reports = runtime.listLearningReports();
        const latestWeeklyReport = reports.find((report) => report.kind === 'weekly') || null;
        const latestMonthlyReport = reports.find((report) => report.kind === 'monthly') || null;
        const reportStatus = runtime.reportRepository.operationalSnapshot();
        const latestBatch = reportStatus.latestBatch;
        const corrections = reportStatus.corrections;
        const embeddingRows = reportStatus.embeddingRows;
        const reviewRows = reportStatus.reviewRows;
        const studyRows = reportStatus.studyRows;
        const lastMaintenanceAt = runtime.appMetadataRepository.get('last_sqlite_maintenance_at');
        const lastMaintenanceKind = runtime.appMetadataRepository.get('last_sqlite_maintenance_kind');
        const lastMaintenanceError = runtime.appMetadataRepository.get('last_sqlite_maintenance_error', '');
        const lastPrecomputeAt = runtime.appMetadataRepository.get('last_precompute_at');
        const lastPrecomputeTrigger = runtime.appMetadataRepository.get('last_precompute_trigger');
        const lastPrecomputeError = runtime.appMetadataRepository.get('last_precompute_error', '');
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
                lastReportCheckAt: runtime.appMetadataRepository.get('last_report_check_at'),
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
            migrations: runtime.migrationStatus({ sqlite: runtime.sqliteRepository, migrationsDir: runtime.migrationsDir }),
            worker: runtime.workerHeartbeatStatus(),
            unifiedHealth: getHealthPayload().unified,
            externalApis: runtime.externalApiClient.status(),
        };
    }
    exposeRuntime({
        chinaWallClockDelay: () => chinaWallClockDelay,
        runSqliteMaintenance: () => runSqliteMaintenance,
        scheduleDailyMaintenance: () => scheduleDailyMaintenance,
        getDiskStatus: () => getDiskStatus,
        getRuntimeStatus: () => getRuntimeStatus,
        getHealthPayload: () => getHealthPayload,
        getReadinessPayload: () => getReadinessPayload,
        getTaskCenterStatus: () => getTaskCenterStatus,
    });
}
