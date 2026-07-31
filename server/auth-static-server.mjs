import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statfsSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os';
import { setDefaultResultOrder } from 'node:dns';
import { createSqliteRepository } from './modules/sqlite-repository.mjs';
import { createTaskRunsRepository } from './modules/task-runs-repository.mjs';
import { createOpsRepository } from './modules/ops-repository.mjs';
import { createExternalApiClient } from './modules/external-api-client.mjs';
import { parseWorldPeRatio, scoreIndexPurchaseAssessment } from './modules/index-assessment.mjs';
import { summarizeHealth } from './modules/health-status.mjs';
import { resolveBackupPath } from './modules/backup-validation.mjs';
import { queryLimit, queryOffset } from './modules/api-helpers.mjs';
import { isTelegramAuthorized, readTelegramConfig, saveTelegramConfig, telegramConfigStatus, telegramConfirmKeyboard, telegramTaskKeyboard, telegramUpdateContext } from './modules/telegram-bot.mjs';
import { createNotificationRepository } from './modules/notification-repository.mjs';
import { createNotificationQueue } from './modules/notification-queue.mjs';
import { createNotificationChannelHealth } from './modules/notification-channel-health.mjs';
import { createCalendarRepository } from './modules/calendar-repository.mjs';
import { notificationChannelReadiness, resolveProactiveDispatch } from './modules/notification-dispatcher.mjs';
import { isWechatQuietHours, nextWechatActiveAt } from './modules/notification-policy.mjs';
import { migrationStatus, runSqlMigrations } from './modules/migration-runner.mjs';
import { clawbotHelpText, parseClawbotCommand } from './modules/clawbot-command-parser.mjs';
import { sanitizeClientErrorPayload } from './modules/client-error-sanitizer.mjs';
import { handlePublicApiRoutes } from './routes/public-api-routes.mjs';
import { handleNotificationRoutes } from './routes/notification-routes.mjs';
import { handleProxySettingsRoutes } from './routes/proxy-settings-routes.mjs';
import { handleOpsRoutes } from './routes/ops-routes.mjs';
import { handleBriefRoutes } from './routes/brief-routes.mjs';
import { handleLearningReadRoutes } from './routes/learning-read-routes.mjs';
import { handleLearningWriteRoutes } from './routes/learning-write-routes.mjs';
import { createBackupService } from './services/backup-service.mjs';
import { createBreakGuardService } from './domains/break-guard/service.mjs';
import { createFocusTimerService } from './domains/focus-timer/service.mjs';
import { createLearningRepository } from './repositories/learning-repository.mjs';
import { createLearningQueryRepository } from './repositories/learning-query-repository.mjs';
import { createAppMetadataRepository } from './repositories/app-metadata-repository.mjs';
import { createReportRepository } from './repositories/report-repository.mjs';
import { createSchemaBootstrapRepository } from './repositories/schema-bootstrap-repository.mjs';
import { createStudyComparisonRepository } from './repositories/study-comparison-repository.mjs';
import { createStateRepository } from './repositories/state-repository.mjs';
import { createDailyBriefRepository } from './repositories/daily-brief-repository.mjs';
import { createConfusingWordsRepository } from './repositories/confusing-words-repository.mjs';
import { createBreakGuardRepository } from './repositories/break-guard-repository.mjs';
import { createFocusTimerRepository } from './repositories/focus-timer-repository.mjs';
import { createTaskRepository } from './repositories/task-repository.mjs';
import { createBackupRepository } from './repositories/backup-repository.mjs';
import { createDictionaryRepository } from './repositories/dictionary-repository.mjs';
import { createDictionaryService } from './services/dictionary-service.mjs';
import { createUserAccountRepository } from './auth/user-account-repository.mjs';
import { createSessionRepository } from './auth/session-repository.mjs';
import { defaultCapabilitiesForRole } from './auth/capabilities.mjs';
import { createStudyComparisonService } from './domains/study-comparison/service.mjs';
import { createSchedulerRegistry } from './infrastructure/scheduler-registry.mjs';
import { createResourceBudget } from './infrastructure/resource-budget.mjs';
import { createLinuxResourceHealth } from './infrastructure/linux-resource-health.mjs';
import { createSettingsCrypto } from './core/settings-crypto.mjs';
import { readSystemResources } from './core/system-resources.mjs';
import { addDaysISO, addYearISO, currentPeriod, endOfMonthISO, endOfWeekISO, formatDateString, localDateISO, nowISO, parseDateString, previousMonthPeriod, previousPeriod, previousWeekPeriod, startOfMonthISO, startOfWeekISO, todayISO, } from './core/date-time.mjs';
import { createSqliteCli, runSqliteFile, sqliteIntegrityCheck, sqlitePath, sqlString, sqlValue } from './core/sqlite-cli.mjs';
import { createHttpUtils, headerString, isObjectPayload } from './http/http-utils.mjs';
import { createStaticAssetServer, defaultMimeTypes } from './http/static-assets.mjs';
import { runProcess } from './core/process-runner.mjs';
import { createPrivilegedClient } from './privileged/client.mjs';
import { clientHashForRequest, createSessionAuth, getClientIp, lockMessage, safeSecretEqual, sleep, } from './auth/session-auth.mjs';
import { createRequire } from 'node:module';
import { createApplicationContext } from './app/application-context.mjs';
import {
    installPersistenceStateDomain,
    installPersistenceSchemaDomain,
    installPersistenceTransferDomain,
} from './app/domains/persistence.mjs';
import {
    installReportRulesDomain,
    installReportEmbeddingDomain,
    installReportBatchDomain,
    installReportAnalysisDomain,
    installLearningReportsDomain,
} from './app/domains/reports.mjs';
import {
    installBriefSettingsDomain,
    installBriefTransportDomain,
    installBriefWeatherDomain,
    installBriefMarketsDomain,
    installBriefCompositionDomain,
    installBriefEmailDomain,
} from './app/domains/brief.mjs';
import { installProxyDomain } from './app/domains/proxy.mjs';
import {
    installOperationsHealthDomain,
    installOperationsLifecycleDomain,
} from './app/domains/operations.mjs';
import {
    installLearningDictionaryDomain,
    installLearningAnalyticsDomain,
    installLearningDashboardDomain,
    installLearningObservabilityDomain,
} from './app/domains/learning.mjs';
import {
    installNotificationTelemetryDomain,
    installNotificationWechatDomain,
    installNotificationChannelsDomain,
    installNotificationReminderDomain,
    installNotificationBotsDomain,
} from './app/domains/notifications.mjs';
import { installApiDomain } from './app/domains/api.mjs';
import { installBootstrapDomain } from './app/domains/bootstrap.mjs';

const require = createRequire(import.meta.url);
const { runtime, exposeRuntime, installDomain } = createApplicationContext();
const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = resolve(process.env.STATIC_ROOT || join(appRoot, 'dist'));
const dataDir = resolve(process.env.DATA_DIR || join(appRoot, 'data'));
const legacyDataFile = join(dataDir, 'db.json');
const sqliteFile = join(dataDir, 'exam-planner.sqlite');
const backupsDir = join(dataDir, 'backups');
const libraryDir = join(dataDir, 'library');
const libraryFilesDir = join(libraryDir, 'files');
const migrationsDir = resolve(fileURLToPath(new URL('./migrations', import.meta.url)));
const dictionaryFile = join(dataDir, 'ecdict.csv');
const dictionarySqliteFile = join(dataDir, 'dictionary.sqlite');
const loginAttemptsFile = join(dataDir, 'login-attempts.json');
const proxySettingsEnvFile = process.env.PROXY_SETTINGS_ENV_FILE || (process.platform === 'win32' ? join(dataDir, 'proxy.env') : '/etc/exam-planner/proxy.env');
const telegramEnvFile = process.env.TELEGRAM_ENV_FILE || (process.platform === 'win32' ? join(dataDir, 'telegram.env') : '/etc/exam-planner/telegram.env');
const embeddingWorkerFile = join(resolve(fileURLToPath(new URL('.', import.meta.url))), 'embedding_worker.py');
const openClawWeixinSenderFile = join(resolve(fileURLToPath(new URL('.', import.meta.url))), 'openclaw-weixin-send.mjs');
const embeddingCacheDir = process.env.EMBEDDING_CACHE_DIR || join(dataDir, 'embedding-models');
const smallEmbeddingModelName = process.env.EMBEDDING_MODEL_NAME || 'BAAI/bge-small-zh-v1.5';
const largeEmbeddingModelName = process.env.LARGE_EMBEDDING_MODEL_NAME || 'intfloat/multilingual-e5-large';
const port = Number(process.env.PORT || 8080);
const serviceRole = ['web', 'worker', 'all'].includes(process.env.SERVICE_ROLE) ? process.env.SERVICE_ROLE : 'all';
const backgroundJobsEnabled = serviceRole !== 'web';
const httpEnabled = serviceRole !== 'worker';
const appPassword = process.env.APP_PASSWORD;
const readOnlyPassword = process.env.READONLY_PASSWORD || '';
const cookieSecret = process.env.COOKIE_SECRET || randomBytes(32).toString('hex');
const settingsEncryptionSecret = process.env.SETTINGS_ENCRYPTION_KEY || (process.env.NODE_ENV === 'production' ? '' : cookieSecret);
const cookieName = 'exam_planner_session';
const corsOrigin = process.env.CORS_ORIGIN || '';
const secureCookie = process.env.COOKIE_SECURE === '1';
const clawbotSecret = process.env.CLAWBOT_SECRET || '';
const breakGuardToken = process.env.BREAK_GUARD_TOKEN || '';
const dataImportToken = process.env.DATA_IMPORT_TOKEN || '';
const backupSyncToken = process.env.BACKUP_SYNC_TOKEN || '';
const clawbotWebhookUrl = process.env.CLAWBOT_WEBHOOK_URL || '';
const openClawChannel = process.env.OPENCLAW_CLAWBOT_CHANNEL || 'openclaw-weixin';
const openClawAccountDir = process.env.OPENCLAW_ACCOUNT_DIR || '/root/.openclaw/openclaw-weixin/accounts';
const openClawNpmProjectsDir = process.env.OPENCLAW_NPM_PROJECTS_DIR || '/root/.openclaw/npm/projects';
const openClawAccountId = process.env.OPENCLAW_CLAWBOT_ACCOUNT || process.env.OPENCLAW_WEIXIN_ACCOUNT_ID || '';
const openClawTarget = process.env.OPENCLAW_CLAWBOT_TARGET || '';
const openClawCli = process.env.OPENCLAW_CLI || (existsSync('/opt/node22/bin/openclaw') ? '/opt/node22/bin/openclaw' : 'openclaw');
const requestLogSlowMs = Number(process.env.REQUEST_LOG_SLOW_MS || 1500);
const jsonBodyMaxBytes = Number(process.env.JSON_BODY_MAX_BYTES || 10 * 1024 * 1024);
const minFreeDiskBytes = Number(process.env.MIN_FREE_DISK_BYTES || 512 * 1024 * 1024);
const privilegedHelperSocket = process.env.PRIVILEGED_HELPER_SOCKET || (process.platform === 'win32' ? '' : '/run/exam-planner/privileged.sock');
const privilegedClient = privilegedHelperSocket ? createPrivilegedClient({ socketPath: privilegedHelperSocket }) : null;
const entitySchemaVersion = 1;
const studyTargetMinutesKey = 'study_target_minutes';
const dailyBriefSettingsKey = 'daily_brief_settings_json';
const settingsCrypto = createSettingsCrypto({
    primarySecret: settingsEncryptionSecret,
    legacySecrets: [cookieSecret],
    onDecryptFailure: ({ fingerprint }) => console.warn(JSON.stringify({
        level: 'warn',
        event: 'settings_secret_decrypt_failed',
        fingerprint,
        action: 're-enter the affected secret once',
    })),
});
const loginFailureLimit = 3;
const loginLockMs = 30 * 60 * 1000;
const loginFailureDelayMinMs = 1000;
const loginFailureDelaySpreadMs = 1000;
const sqliteRepository = createSqliteRepository({ sqliteFile, dataDir });
const learningRepository = createLearningRepository(sqliteRepository, {
    nowISO,
    todayISO,
    entitySchemaVersion,
    onChange: () => runtime.tableChanged?.(),
    onOwnerStudyChanged: (date) => runtime.refreshStudySummariesForDate?.(date),
    ownerUserId: () => userAccountRepository.getOwnerUserId(),
});
const learningQueryRepository = createLearningQueryRepository(sqliteRepository);
const appMetadataRepository = createAppMetadataRepository(sqliteRepository);
const reportRepository = createReportRepository(sqliteRepository);
const schemaBootstrapRepository = createSchemaBootstrapRepository(sqliteRepository);
const studyComparisonRepository = createStudyComparisonRepository(sqliteRepository);
const stateRepository = createStateRepository(sqliteRepository);
const dailyBriefRepository = createDailyBriefRepository(sqliteRepository);
const confusingWordsRepository = createConfusingWordsRepository(sqliteRepository);
const breakGuardRepository = createBreakGuardRepository(sqliteRepository, {
    ownerUserId: () => userAccountRepository.getOwnerUserId(),
});
const focusTimerRepository = createFocusTimerRepository(sqliteRepository);
const backupRepository = createBackupRepository(sqliteRepository);
const dictionaryDatabase = createSqliteRepository({ sqliteFile: dictionarySqliteFile, dataDir });
const dictionaryRepository = createDictionaryRepository(dictionaryDatabase);
const maxUsers = Math.max(1, Math.min(100, Number(process.env.MAX_USERS || 10)));
const userAccountRepository = createUserAccountRepository(sqliteRepository, { maxUsers });
const sessionRepository = createSessionRepository(sqliteRepository);
const taskRepository = createTaskRepository(sqliteRepository, {
    ownerUserId: () => userAccountRepository.getOwnerUserId(),
});
const scheduler = createSchedulerRegistry({
    onError: (name, error) => console.error(JSON.stringify({
        level: 'error', event: 'scheduled_job_failed', name, error: String(error?.message || error),
    })),
});
const resourceBudget = createResourceBudget({
    maxConcurrent: Math.max(1, Number(process.env.BACKGROUND_TASK_CONCURRENCY || 1)),
    minAvailableMemoryBytes: Math.max(32 * 1024 * 1024, Number(process.env.BACKGROUND_MIN_AVAILABLE_MEMORY_BYTES || 96 * 1024 * 1024)),
    maxLoadPerCpu: Math.max(0.5, Number(process.env.BACKGROUND_MAX_LOAD_PER_CPU || 1.5)),
    readResources: readSystemResources,
});
const linuxResourceHealth = createLinuxResourceHealth();
const taskRunsRepository = createTaskRunsRepository(sqliteRepository);
const opsRepository = createOpsRepository(sqliteRepository);
const externalApiClient = createExternalApiClient();
const notificationRepository = createNotificationRepository(sqliteRepository);
const notificationChannelHealth = createNotificationChannelHealth({
    repository: notificationRepository,
});
const notificationQueue = createNotificationQueue({
    repository: notificationRepository,
    sendProactive: (text, delivery) => runtime.sendProactiveNotification(text, delivery),
    notifyEvent: (payload) => runtime.notifyEvent(payload),
    channelHealth: notificationChannelHealth,
    log: (level, event, detail) => runtime.logStructured(level, event, detail),
});
const telegramOpsConfirmations = new Map();
const calendarRepository = createCalendarRepository(sqliteRepository);
const { runSqlite, sqliteExecute, sqliteScalar, sqliteJson, runSqliteTransaction, closeSqlite } = createSqliteCli({ repository: sqliteRepository });
const { sendJson, sendHtml, readBody, readJsonBody } = createHttpUtils({ corsOrigin, jsonBodyMaxBytes });
const serveStatic = createStaticAssetServer({ root, mimeTypes: defaultMimeTypes });
const sessionAuth = createSessionAuth({
    appPassword,
    readOnlyPassword,
    cookieSecret,
    cookieName,
    sessionRepository,
    loginAttemptsFile,
    loginFailureLimit,
    loginLockMs,
    loginFailureDelayMinMs,
    loginFailureDelaySpreadMs,
    ownerUserId: () => userAccountRepository.getOwnerUserId(),
});
const { createSessionValue, getSession, getSessionRole, isValidSession, revokeSession, getLoginLock, recordLoginSuccess, recordLoginFailure, loginFailureDelay, loginPage, } = sessionAuth;
if (!appPassword) {
    throw new Error('APP_PASSWORD is required');
}
try {
    setDefaultResultOrder('ipv4first');
}
catch {
    // Older Node runtimes can ignore this; curl fallback below also forces IPv4.
}
const projectColors = ['#2563eb', '#16a34a', '#f97316', '#9333ea', '#dc2626', '#0f766e', '#ca8a04', '#64748b'];
const subjectColors = ['#2563eb', '#16a34a', '#9333ea', '#dc2626'];
let sqliteReady = false;
let reportTimerStarted = false;
let reportTimer = null;
let nightlyErrorThemeTimerStarted = false;
let nightlyErrorThemeTimer = null;
let dailyBriefTimerStarted = false;
let maintenanceTimerStarted = false;
let maintenanceTimer = null;
let dailyBriefTimer = null;
let taskReminderTimerStarted = false;
let taskReminderTimer = null;
let taskReminderInitialTimer = null;
let notificationQueueTimerStarted = false;
let notificationQueueTimer = null;
let startupReady = false;
let startupError = '';
let workerKeepAliveTimer = null;
let workerHeartbeatTimer = null;
let errorThemeBatchJob = null;
let shuttingDown = false;
let nextNightlyErrorThemeAt = null;
let nextDailyBriefAt = null;
let nextMaintenanceAt = null;
let nextTaskReminderScanAt = null;
let dataRevision = 0;
let dashboardPayloadCache = null;
let statisticsSummaryCache = null;
function validateStartupConfig() {
    const problems = [];
    const fatalProblems = [];
    if (process.env.NODE_ENV === 'production' && !appPassword)
        fatalProblems.push('APP_PASSWORD is required in production');
    if (process.env.NODE_ENV === 'production' && !process.env.COOKIE_SECRET)
        fatalProblems.push('COOKIE_SECRET is required in production');
    if (process.env.NODE_ENV === 'production' && !process.env.SETTINGS_ENCRYPTION_KEY)
        fatalProblems.push('SETTINGS_ENCRYPTION_KEY is required in production');
    if (!cookieSecret || cookieSecret.length < 32)
        problems.push('COOKIE_SECRET should be at least 32 characters');
    if (!settingsEncryptionSecret || settingsEncryptionSecret.length < 32)
        problems.push('SETTINGS_ENCRYPTION_KEY should be at least 32 characters');
    if (!Number.isFinite(port) || port <= 0 || port > 65535)
        problems.push('PORT must be a valid TCP port');
    if (!Number.isFinite(jsonBodyMaxBytes) || jsonBodyMaxBytes < 1024)
        problems.push('JSON_BODY_MAX_BYTES is too small');
    if (!Number.isFinite(minFreeDiskBytes) || minFreeDiskBytes < 0)
        problems.push('MIN_FREE_DISK_BYTES must be non-negative');
    if (corsOrigin === '*')
        problems.push('CORS_ORIGIN should not be wildcard in production');
    if (serviceRole === 'web' && !secureCookie && process.platform !== 'win32')
        problems.push('COOKIE_SECURE should be enabled for the HTTPS web service');
    if (problems.length) {
        console.warn(JSON.stringify({ level: 'warn', event: 'startup_config_warnings', problems }));
    }
    if (fatalProblems.length) {
        throw new Error(`Invalid production configuration: ${fatalProblems.join('; ')}`);
    }
    return { problems, fatalProblems };
}

exposeRuntime({ "createHash": () => createHash, "randomBytes": () => randomBytes, "chmodSync": () => chmodSync, "copyFileSync": () => copyFileSync, "existsSync": () => existsSync, "mkdirSync": () => mkdirSync, "readFileSync": () => readFileSync, "readdirSync": () => readdirSync, "rmSync": () => rmSync, "statfsSync": () => statfsSync, "statSync": () => statSync, "unlinkSync": () => unlinkSync, "writeFileSync": () => writeFileSync, "dirname": () => dirname, "extname": () => extname, "join": () => join, "resolve": () => resolve, "createServer": () => createServer, "netConnect": () => netConnect, "tlsConnect": () => tlsConnect, "fileURLToPath": () => fileURLToPath, "spawn": () => spawn, "spawnSync": () => spawnSync, "cpus": () => cpus, "freemem": () => freemem, "loadavg": () => loadavg, "totalmem": () => totalmem, "uptime": () => uptime, "setDefaultResultOrder": () => setDefaultResultOrder, "createSqliteRepository": () => createSqliteRepository, "createTaskRunsRepository": () => createTaskRunsRepository, "createOpsRepository": () => createOpsRepository, "createExternalApiClient": () => createExternalApiClient, "parseWorldPeRatio": () => parseWorldPeRatio, "scoreIndexPurchaseAssessment": () => scoreIndexPurchaseAssessment, "summarizeHealth": () => summarizeHealth, "resolveBackupPath": () => resolveBackupPath, "queryLimit": () => queryLimit, "queryOffset": () => queryOffset, "isTelegramAuthorized": () => isTelegramAuthorized, "readTelegramConfig": () => readTelegramConfig, "saveTelegramConfig": () => saveTelegramConfig, "telegramConfigStatus": () => telegramConfigStatus, "telegramConfirmKeyboard": () => telegramConfirmKeyboard, "telegramTaskKeyboard": () => telegramTaskKeyboard, "telegramUpdateContext": () => telegramUpdateContext, "createNotificationRepository": () => createNotificationRepository, "createNotificationQueue": () => createNotificationQueue, "createCalendarRepository": () => createCalendarRepository, "notificationChannelReadiness": () => notificationChannelReadiness, "resolveProactiveDispatch": () => resolveProactiveDispatch, "isWechatQuietHours": () => isWechatQuietHours, "nextWechatActiveAt": () => nextWechatActiveAt, "runSqlMigrations": () => runSqlMigrations, "clawbotHelpText": () => clawbotHelpText, "parseClawbotCommand": () => parseClawbotCommand, "sanitizeClientErrorPayload": () => sanitizeClientErrorPayload, "handlePublicApiRoutes": () => handlePublicApiRoutes, "handleNotificationRoutes": () => handleNotificationRoutes, "handleProxySettingsRoutes": () => handleProxySettingsRoutes, "handleOpsRoutes": () => handleOpsRoutes, "handleBriefRoutes": () => handleBriefRoutes, "handleLearningReadRoutes": () => handleLearningReadRoutes, "handleLearningWriteRoutes": () => handleLearningWriteRoutes, "createBackupService": () => createBackupService, "createBreakGuardService": () => createBreakGuardService, "addDaysISO": () => addDaysISO, "addYearISO": () => addYearISO, "currentPeriod": () => currentPeriod, "endOfMonthISO": () => endOfMonthISO, "endOfWeekISO": () => endOfWeekISO, "formatDateString": () => formatDateString, "localDateISO": () => localDateISO, "nowISO": () => nowISO, "parseDateString": () => parseDateString, "previousMonthPeriod": () => previousMonthPeriod, "previousPeriod": () => previousPeriod, "previousWeekPeriod": () => previousWeekPeriod, "startOfMonthISO": () => startOfMonthISO, "startOfWeekISO": () => startOfWeekISO, "todayISO": () => todayISO, "createSqliteCli": () => createSqliteCli, "runSqliteFile": () => runSqliteFile, "sqliteIntegrityCheck": () => sqliteIntegrityCheck, "sqlitePath": () => sqlitePath, "sqlString": () => sqlString, "sqlValue": () => sqlValue, "createHttpUtils": () => createHttpUtils, "headerString": () => headerString, "isObjectPayload": () => isObjectPayload, "createStaticAssetServer": () => createStaticAssetServer, "defaultMimeTypes": () => defaultMimeTypes, "runProcess": () => runProcess, "createPrivilegedClient": () => createPrivilegedClient, "clientHashForRequest": () => clientHashForRequest, "createSessionAuth": () => createSessionAuth, "getClientIp": () => getClientIp, "lockMessage": () => lockMessage, "safeSecretEqual": () => safeSecretEqual, "sleep": () => sleep, "createRequire": () => createRequire, "require": () => require, "appRoot": () => appRoot, "root": () => root, "dataDir": () => dataDir, "legacyDataFile": () => legacyDataFile, "sqliteFile": () => sqliteFile, "backupsDir": () => backupsDir, "libraryDir": () => libraryDir, "libraryFilesDir": () => libraryFilesDir, "migrationsDir": () => migrationsDir, "dictionaryFile": () => dictionaryFile, "loginAttemptsFile": () => loginAttemptsFile, "proxySettingsEnvFile": () => proxySettingsEnvFile, "telegramEnvFile": () => telegramEnvFile, "embeddingWorkerFile": () => embeddingWorkerFile, "openClawWeixinSenderFile": () => openClawWeixinSenderFile, "embeddingCacheDir": () => embeddingCacheDir, "smallEmbeddingModelName": () => smallEmbeddingModelName, "largeEmbeddingModelName": () => largeEmbeddingModelName, "port": () => port, "serviceRole": () => serviceRole, "backgroundJobsEnabled": () => backgroundJobsEnabled, "httpEnabled": () => httpEnabled, "appPassword": () => appPassword, "readOnlyPassword": () => readOnlyPassword, "cookieSecret": () => cookieSecret, "cookieName": () => cookieName, "corsOrigin": () => corsOrigin, "secureCookie": () => secureCookie, "clawbotSecret": () => clawbotSecret, "breakGuardToken": () => breakGuardToken, "dataImportToken": () => dataImportToken, "backupSyncToken": () => backupSyncToken, "clawbotWebhookUrl": () => clawbotWebhookUrl, "openClawChannel": () => openClawChannel, "openClawAccountDir": () => openClawAccountDir, "openClawNpmProjectsDir": () => openClawNpmProjectsDir, "openClawAccountId": () => openClawAccountId, "openClawTarget": () => openClawTarget, "openClawCli": () => openClawCli, "requestLogSlowMs": () => requestLogSlowMs, "jsonBodyMaxBytes": () => jsonBodyMaxBytes, "minFreeDiskBytes": () => minFreeDiskBytes, "privilegedHelperSocket": () => privilegedHelperSocket, "privilegedClient": () => privilegedClient, "entitySchemaVersion": () => entitySchemaVersion, "studyTargetMinutesKey": () => studyTargetMinutesKey, "dailyBriefSettingsKey": () => dailyBriefSettingsKey, "settingsCrypto": () => settingsCrypto, "loginFailureLimit": () => loginFailureLimit, "loginLockMs": () => loginLockMs, "loginFailureDelayMinMs": () => loginFailureDelayMinMs, "loginFailureDelaySpreadMs": () => loginFailureDelaySpreadMs, "sqliteRepository": () => sqliteRepository, "taskRunsRepository": () => taskRunsRepository, "opsRepository": () => opsRepository, "externalApiClient": () => externalApiClient, "notificationRepository": () => notificationRepository, "notificationQueue": () => notificationQueue, "telegramOpsConfirmations": () => telegramOpsConfirmations, "calendarRepository": () => calendarRepository, "runSqlite": () => runSqlite, "sqliteExecute": () => sqliteExecute, "sqliteScalar": () => sqliteScalar, "sqliteJson": () => sqliteJson, "runSqliteTransaction": () => runSqliteTransaction, "closeSqlite": () => closeSqlite, "sendJson": () => sendJson, "sendHtml": () => sendHtml, "readBody": () => readBody, "readJsonBody": () => readJsonBody, "serveStatic": () => serveStatic, "sessionAuth": () => sessionAuth, "createSessionValue": () => createSessionValue, "getSessionRole": () => getSessionRole, "isValidSession": () => isValidSession, "getLoginLock": () => getLoginLock, "recordLoginSuccess": () => recordLoginSuccess, "recordLoginFailure": () => recordLoginFailure, "loginFailureDelay": () => loginFailureDelay, "loginPage": () => loginPage, "projectColors": () => projectColors, "subjectColors": () => subjectColors, "sqliteReady": () => sqliteReady, "reportTimerStarted": () => reportTimerStarted, "reportTimer": () => reportTimer, "nightlyErrorThemeTimerStarted": () => nightlyErrorThemeTimerStarted, "nightlyErrorThemeTimer": () => nightlyErrorThemeTimer, "dailyBriefTimerStarted": () => dailyBriefTimerStarted, "maintenanceTimerStarted": () => maintenanceTimerStarted, "maintenanceTimer": () => maintenanceTimer, "dailyBriefTimer": () => dailyBriefTimer, "taskReminderTimerStarted": () => taskReminderTimerStarted, "taskReminderTimer": () => taskReminderTimer, "taskReminderInitialTimer": () => taskReminderInitialTimer, "notificationQueueTimerStarted": () => notificationQueueTimerStarted, "notificationQueueTimer": () => notificationQueueTimer, "startupReady": () => startupReady, "startupError": () => startupError, "workerKeepAliveTimer": () => workerKeepAliveTimer, "workerHeartbeatTimer": () => workerHeartbeatTimer, "errorThemeBatchJob": () => errorThemeBatchJob, "shuttingDown": () => shuttingDown, "nextNightlyErrorThemeAt": () => nextNightlyErrorThemeAt, "nextDailyBriefAt": () => nextDailyBriefAt, "nextMaintenanceAt": () => nextMaintenanceAt, "nextTaskReminderScanAt": () => nextTaskReminderScanAt, "dataRevision": () => dataRevision, "dashboardPayloadCache": () => dashboardPayloadCache, "statisticsSummaryCache": () => statisticsSummaryCache, "validateStartupConfig": () => validateStartupConfig }, { "sqliteReady": (value) => { sqliteReady = value; }, "reportTimerStarted": (value) => { reportTimerStarted = value; }, "reportTimer": (value) => { reportTimer = value; }, "nightlyErrorThemeTimerStarted": (value) => { nightlyErrorThemeTimerStarted = value; }, "nightlyErrorThemeTimer": (value) => { nightlyErrorThemeTimer = value; }, "dailyBriefTimerStarted": (value) => { dailyBriefTimerStarted = value; }, "maintenanceTimerStarted": (value) => { maintenanceTimerStarted = value; }, "maintenanceTimer": (value) => { maintenanceTimer = value; }, "dailyBriefTimer": (value) => { dailyBriefTimer = value; }, "taskReminderTimerStarted": (value) => { taskReminderTimerStarted = value; }, "taskReminderTimer": (value) => { taskReminderTimer = value; }, "taskReminderInitialTimer": (value) => { taskReminderInitialTimer = value; }, "notificationQueueTimerStarted": (value) => { notificationQueueTimerStarted = value; }, "notificationQueueTimer": (value) => { notificationQueueTimer = value; }, "startupReady": (value) => { startupReady = value; }, "startupError": (value) => { startupError = value; }, "workerKeepAliveTimer": (value) => { workerKeepAliveTimer = value; }, "workerHeartbeatTimer": (value) => { workerHeartbeatTimer = value; }, "errorThemeBatchJob": (value) => { errorThemeBatchJob = value; }, "shuttingDown": (value) => { shuttingDown = value; }, "nextNightlyErrorThemeAt": (value) => { nextNightlyErrorThemeAt = value; }, "nextDailyBriefAt": (value) => { nextDailyBriefAt = value; }, "nextMaintenanceAt": (value) => { nextMaintenanceAt = value; }, "nextTaskReminderScanAt": (value) => { nextTaskReminderScanAt = value; }, "dataRevision": (value) => { dataRevision = value; }, "dashboardPayloadCache": (value) => { dashboardPayloadCache = value; }, "statisticsSummaryCache": (value) => { statisticsSummaryCache = value; } });

exposeRuntime({
    learningRepository: () => learningRepository,
    learningQueryRepository: () => learningQueryRepository,
    appMetadataRepository: () => appMetadataRepository,
    reportRepository: () => reportRepository,
    schemaBootstrapRepository: () => schemaBootstrapRepository,
    studyComparisonRepository: () => studyComparisonRepository,
    stateRepository: () => stateRepository,
    dailyBriefRepository: () => dailyBriefRepository,
    confusingWordsRepository: () => confusingWordsRepository,
    breakGuardRepository: () => breakGuardRepository,
    backupRepository: () => backupRepository,
    dictionaryRepository: () => dictionaryRepository,
    userAccountRepository: () => userAccountRepository,
    sessionRepository: () => sessionRepository,
    taskRepository: () => taskRepository,
    defaultCapabilitiesForRole: () => defaultCapabilitiesForRole,
    getSession: () => getSession,
    revokeSession: () => revokeSession,
    scheduler: () => scheduler,
    resourceBudget: () => resourceBudget,
    linuxResourceHealth: () => linuxResourceHealth,
    notificationChannelHealth: () => notificationChannelHealth,
    migrationStatus: () => migrationStatus,
});

let backupService = null;
const dictionaryService = createDictionaryService({
    repository: dictionaryRepository,
    primaryDatabase: sqliteRepository,
    dictionarySqliteFile,
    sourceCsv: dictionaryFile,
    runSqliteFile,
    sqlitePath,
    sqliteIntegrityCheck,
    nowISO,
    createSafetyBackup: (kind, note) => backupService?.createBackupFile(kind, note),
    log: (level, event, detail) => runtime.logStructured?.(level, event, detail),
});
exposeRuntime({ dictionaryService: () => dictionaryService });

installDomain('persistence.state', installPersistenceStateDomain);
installDomain('persistence.schema', installPersistenceSchemaDomain);
installDomain('persistence.transfer', installPersistenceTransferDomain);
installDomain('reports.rules', installReportRulesDomain);
installDomain('reports.embeddings', installReportEmbeddingDomain);
installDomain('reports.batches', installReportBatchDomain);
installDomain('reports.analysis', installReportAnalysisDomain);
installDomain('reports.learning', installLearningReportsDomain);
installDomain('brief.settings', installBriefSettingsDomain);
installDomain('brief.transport', installBriefTransportDomain);
installDomain('brief.weather', installBriefWeatherDomain);
installDomain('brief.markets', installBriefMarketsDomain);
installDomain('brief.composition', installBriefCompositionDomain);
installDomain('brief.email', installBriefEmailDomain);
installDomain('proxy', installProxyDomain);
installDomain('operations.health', installOperationsHealthDomain);
installDomain('operations.lifecycle', installOperationsLifecycleDomain);
installDomain('learning.dictionary', installLearningDictionaryDomain);
installDomain('learning.analytics', installLearningAnalyticsDomain);
installDomain('learning.dashboard', installLearningDashboardDomain);
installDomain('learning.observability', installLearningObservabilityDomain);
installDomain('notifications.telemetry', installNotificationTelemetryDomain);
installDomain('notifications.wechat', installNotificationWechatDomain);
installDomain('notifications.channels', installNotificationChannelsDomain);
installDomain('notifications.reminders', installNotificationReminderDomain);
installDomain('notifications.bots', installNotificationBotsDomain);
const focusTimerService = createFocusTimerService({
    repository: focusTimerRepository,
    now: () => Date.now(),
    todayISO,
    tableChanged: runtime.tableChanged,
    refreshStudySummariesForDate: runtime.refreshStudySummariesForDate,
    shouldRefreshStudySummaries: (userId) => Number(userId) === userAccountRepository.getOwnerUserId(),
});
exposeRuntime({ focusTimerService: () => focusTimerService });
const studyComparisonService = createStudyComparisonService({
    repository: studyComparisonRepository,
    todayISO,
    addDaysISO,
    nowISO,
    maxUsers: userAccountRepository.maxUsers,
});
exposeRuntime({ studyComparisonService: () => studyComparisonService });
installDomain('api', installApiDomain);

backupService = createBackupService({
    backupsDir,
    sqliteFile,
    libraryDir,
    libraryFilesDir,
    assertDiskSpace: runtime.assertDiskSpace,
    repository: backupRepository,
    sqliteIntegrityCheck,
    nowISO,
    resolveBackupPath,
    redactSecretText: runtime.redactSecretText,
    ensureSqliteStore: () => runtime.ensureSqliteStore(),
    resetSqliteRuntime: () => {
        closeSqlite();
        sqliteReady = false;
        dictionaryService.reset();
    },
    retention: {
        daily: Number(process.env.BACKUP_KEEP_DAILY || 7),
        weekly: Number(process.env.BACKUP_KEEP_WEEKLY || 4),
        deploy: Number(process.env.BACKUP_KEEP_DEPLOY || 5),
        manual: Number(process.env.BACKUP_KEEP_MANUAL || 5),
        migration: Number(process.env.BACKUP_KEEP_MIGRATION || 5),
        other: Number(process.env.BACKUP_KEEP_OTHER || 3),
    },
    dictionaryStatus: () => dictionaryService.status(),
});
const { createBackupFile, restoreBackupFile, ensureDailyBackup, ensureWeeklyBackup, getBackupStatus, nextWeeklyBackupAt, nextDailyBackupAt, } = backupService;
const breakGuardService = createBreakGuardService({
    token: breakGuardToken,
    safeSecretEqual,
    nowISO,
    todayISO,
    repository: breakGuardRepository,
    tableChanged: runtime.tableChanged,
    refreshStudySummariesForDate: runtime.refreshStudySummariesForDate,
    queueProactiveNotification: runtime.queueProactiveNotification,
    cancelScheduleLagNotifications: () => runtime.notificationRepository.cancelPendingDeliveriesByEventPrefix(
        'break-guard:schedule_lag:',
        'suppressed by meal pause',
    ),
});
const { requireToken: requireBreakGuardToken, recordEvent: recordBreakGuardEvent, getSummary: getBreakGuardSummary, queueNotification: queueBreakGuardNotification, getScheduleConfig: getBreakGuardScheduleConfig, saveScheduleConfig: saveBreakGuardScheduleConfig, } = breakGuardService;

exposeRuntime({ "backupService": () => backupService, "createBackupFile": () => createBackupFile, "restoreBackupFile": () => restoreBackupFile, "ensureDailyBackup": () => ensureDailyBackup, "ensureWeeklyBackup": () => ensureWeeklyBackup, "getBackupStatus": () => getBackupStatus, "nextWeeklyBackupAt": () => nextWeeklyBackupAt, "nextDailyBackupAt": () => nextDailyBackupAt, "breakGuardService": () => breakGuardService, "requireBreakGuardToken": () => requireBreakGuardToken, "recordBreakGuardEvent": () => recordBreakGuardEvent, "getBreakGuardSummary": () => getBreakGuardSummary, "queueBreakGuardNotification": () => queueBreakGuardNotification, "getBreakGuardScheduleConfig": () => getBreakGuardScheduleConfig, "saveBreakGuardScheduleConfig": () => saveBreakGuardScheduleConfig }, {  });

installDomain('bootstrap', installBootstrapDomain);
