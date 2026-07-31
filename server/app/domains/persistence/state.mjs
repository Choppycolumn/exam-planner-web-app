export function installPersistenceStateDomain(runtime, exposeRuntime) {
    function normalizeTaskDueTime(value) {
        const text = String(value || '').trim();
        const match = /^(\d{1,2}):(\d{2})$/.exec(text);
        if (!match)
            return '';
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59)
            return '';
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
    function normalizeReminderSentOffsets(value) {
        let items = value;
        if (typeof value === 'string') {
            try {
                items = JSON.parse(value || '[]');
            }
            catch {
                items = [];
            }
        }
        if (!Array.isArray(items))
            return [];
        return Array.from(new Set(items.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item <= 30 * 24 * 60))).sort((a, b) => a - b);
    }
    function normalizeTaskRow(item = {}) {
        const dueTime = normalizeTaskDueTime(item.dueTime);
        return {
            ...item,
            dueTime,
            isCompleted: Boolean(item.isCompleted),
            completedAt: item.completedAt || undefined,
            reminderEnabled: Boolean(item.reminderEnabled) && Boolean(dueTime),
            reminderSentOffsets: normalizeReminderSentOffsets(item.reminderSentOffsets),
            reminderLastSentAt: item.reminderLastSentAt || undefined,
        };
    }
    function baseState() {
        const timestamp = runtime.nowISO();
        return {
            goals: [{
                    id: 1,
                    name: '我的考研目标',
                    description: '坚持长期复习，稳定提高分数',
                    deadline: runtime.addYearISO(),
                    isActive: true,
                    type: '考研',
                    notes: '',
                    schemaVersion: runtime.entitySchemaVersion,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                }],
            dailyReviews: [],
            studyProjects: ['高等数学', '线性代数', '概率论', '英一', '信号与系统', '政治'].map((name, index) => ({
                id: index + 1,
                name,
                color: runtime.projectColors[index % runtime.projectColors.length],
                isActive: true,
                sortOrder: index + 1,
                schemaVersion: runtime.entitySchemaVersion,
                createdAt: timestamp,
                updatedAt: timestamp,
            })),
            studyTimeRecords: [],
            subjects: ['数学', '英语', '政治', '专业课'].map((name, index) => ({
                id: index + 1,
                name,
                color: runtime.subjectColors[index % runtime.subjectColors.length],
                isActive: true,
                sortOrder: index + 1,
                schemaVersion: runtime.entitySchemaVersion,
                createdAt: timestamp,
                updatedAt: timestamp,
            })),
            mockExamRecords: [],
            shortTermTasks: [],
            waterIntakeRecords: [],
            confusingWordsBackup: null,
        };
    }
    function normalizeState(state = {}) {
        return {
            ...baseState(),
            ...state,
            goals: Array.isArray(state.goals) ? state.goals : [],
            dailyReviews: Array.isArray(state.dailyReviews) ? state.dailyReviews.map(runtime.normalizeReview) : [],
            studyProjects: Array.isArray(state.studyProjects) ? state.studyProjects : [],
            studyTimeRecords: Array.isArray(state.studyTimeRecords) ? state.studyTimeRecords : [],
            subjects: Array.isArray(state.subjects) ? state.subjects : [],
            mockExamRecords: Array.isArray(state.mockExamRecords) ? state.mockExamRecords : [],
            shortTermTasks: Array.isArray(state.shortTermTasks) ? state.shortTermTasks : [],
            waterIntakeRecords: Array.isArray(state.waterIntakeRecords) ? state.waterIntakeRecords : [],
            confusingWordsBackup: state.confusingWordsBackup || null,
        };
    }
    function getAppConfigSnapshot() {
        return {
            port: runtime.port,
            dataDir: runtime.dataDir,
            sqliteFile: runtime.sqliteFile,
            backupsDir: runtime.backupsDir,
            libraryDir: runtime.libraryDir,
            requestLogSlowMs: runtime.requestLogSlowMs,
            jsonBodyMaxBytes: runtime.jsonBodyMaxBytes,
            minFreeDiskBytes: runtime.minFreeDiskBytes,
            corsOrigin: runtime.corsOrigin,
            secureCookie: runtime.secureCookie,
            serviceRole: runtime.serviceRole,
            backgroundJobsEnabled: runtime.backgroundJobsEnabled,
            embeddingCacheDir: runtime.embeddingCacheDir,
            smallEmbeddingModelName: runtime.smallEmbeddingModelName,
            largeEmbeddingModelName: runtime.largeEmbeddingModelName,
        };
    }
    function setRuntimeMetadata(key, value) {
        runtime.appMetadataRepository.set(key, value);
    }
    function runtimeScheduleValue(key, fallback = null) {
        if (fallback)
            return fallback;
        try {
            return runtime.appMetadataRepository.get(key, null);
        }
        catch {
            return null;
        }
    }
    function workerHeartbeatStatus() {
        const heartbeatAt = runtimeScheduleValue('worker_heartbeat_at');
        const heartbeatMs = heartbeatAt ? Date.parse(heartbeatAt) : NaN;
        const ageSeconds = Number.isFinite(heartbeatMs) ? Math.max(0, Math.round((Date.now() - heartbeatMs) / 1000)) : null;
        return {
            heartbeatAt,
            ageSeconds,
            pid: Number(runtimeScheduleValue('worker_pid') || 0) || null,
            healthy: ageSeconds !== null && ageSeconds <= 120,
        };
    }
    function startWorkerHeartbeat() {
        if (!runtime.backgroundJobsEnabled || runtime.workerHeartbeatTimer)
            return;
        const writeHeartbeat = () => {
            try {
                runtime.appMetadataRepository.setMany({
                    worker_heartbeat_at: runtime.nowISO(),
                    worker_pid: String(process.pid),
                });
            }
            catch (error) {
                runtime.logStructured('warn', 'worker_heartbeat_failed', {
                    error: runtime.redactSecretText(error.message || String(error)),
                });
            }
        };
        writeHeartbeat();
        runtime.workerHeartbeatTimer = runtime.scheduler.scheduleInterval(
            'worker-heartbeat',
            30 * 1000,
            writeHeartbeat,
        );
    }
    function assertDiskSpace(minBytes = runtime.minFreeDiskBytes) {
        const disk = runtime.getDiskStatus();
        if (disk && disk.availableBytes < minBytes) {
            const error = new Error(`Insufficient disk space: ${disk.availableBytes} bytes available`);
            error.statusCode = 507;
            throw error;
        }
        return disk;
    }
    function redactSecretText(value = '') {
        const text = String(value);
        const barkKey = String(process.env.BARK_DEVICE_KEY || '').trim();
        return (barkKey ? text.replaceAll(barkKey, '[redacted-bark-device-key]') : text)
            .replace(/(password|passwd|token|secret|cookie|authorization)(=|:)\s*[^,\s;]+/gi, '$1$2 [redacted]')
            .replace(/exam_planner_session=[^;\s]+/gi, 'exam_planner_session=[redacted]')
            .replace(/APP_PASSWORD=[^,\s;]+/gi, 'APP_PASSWORD=[redacted]')
            .slice(0, 1000);
    }
    function writeStateToSqlite(state) {
        runtime.stateRepository.saveAppState(normalizeState(state), runtime.nowISO());
    }
    function readStateFromSqlite() {
        return normalizeState(runtime.stateRepository.loadAppState());
    }
    exposeRuntime({
        normalizeTaskDueTime: () => normalizeTaskDueTime,
        normalizeReminderSentOffsets: () => normalizeReminderSentOffsets,
        normalizeTaskRow: () => normalizeTaskRow,
        baseState: () => baseState,
        normalizeState: () => normalizeState,
        getAppConfigSnapshot: () => getAppConfigSnapshot,
        setRuntimeMetadata: () => setRuntimeMetadata,
        runtimeScheduleValue: () => runtimeScheduleValue,
        workerHeartbeatStatus: () => workerHeartbeatStatus,
        startWorkerHeartbeat: () => startWorkerHeartbeat,
        assertDiskSpace: () => assertDiskSpace,
        redactSecretText: () => redactSecretText,
        writeStateToSqlite: () => writeStateToSqlite,
        readStateFromSqlite: () => readStateFromSqlite,
    });
}
