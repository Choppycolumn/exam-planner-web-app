const STUDY = 'study.use';
const FOCUS = 'focus_timer.use';
const COMPARISON = 'comparison.view';
const SETTINGS = 'settings.manage';
const OPERATIONS = 'operations.manage';
const NOTIFICATIONS = 'notifications.manage';
const BRIEF = 'brief.manage';
const BREAK_GUARD = 'break_guard.sync';
const USERS = 'users.manage';
const DATA_IMPORT = 'data.import';

function get(path, capability = STUDY) {
  return Object.freeze({ method: 'GET', path, capability });
}

function post(path, capability = STUDY, body) {
  return Object.freeze({ method: 'POST', path, capability, ...(body ? { body } : {}) });
}

export const API_CONTRACTS = Object.freeze({
  session: get('/api/session', null),
  state: get('/api/state'),
  dashboard: get('/api/dashboard'),
  dashboardCharts: get('/api/dashboard/charts'),
  goals: get('/api/goals'),
  projects: get('/api/projects'),
  subjects: get('/api/subjects'),
  reviews: get('/api/reviews'),
  reviewPrefill: get('/api/reviews/prefill'),
  reviewTrend: get('/api/reviews/trend'),
  problemInbox: get('/api/problem-inbox'),
  studyRecords: get('/api/study-records'),
  statisticsSummary: get('/api/statistics/summary'),
  mockExams: get('/api/mock-exams'),
  reports: get('/api/reports'),
  calendar: get('/api/calendar'),
  learningProgress: get('/api/learning-progress'),
  projectProgress: get('/api/project-progress'),
  studyTargetRead: get('/api/settings/study-target'),
  studyTargetWrite: post('/api/settings/study-target', STUDY, {
    targetHours: 'number?',
    targetMinutes: 'number?',
  }),
  focusTimerRead: get('/api/focus-timer', FOCUS),
  focusTimerAction: post('/api/focus-timer/action', FOCUS, {
    action: 'string',
    operationId: 'string',
    occurredAt: 'string',
  }),
  studyComparison: get('/api/study-comparison', COMPARISON),

  goalSave: post('/api/goals/save'),
  goalActivate: post('/api/goals/activate', STUDY, { id: 'number' }),
  goalRemove: post('/api/goals/remove', STUDY, { id: 'number' }),
  reviewUpsert: post('/api/reviews/upsert'),
  projectSave: post('/api/projects/save'),
  projectRemove: post('/api/projects/remove', STUDY, { id: 'number' }),
  studyRecordsSaveDay: post('/api/study-records/save-day', STUDY, {
    date: 'string',
    records: 'array',
  }),
  subjectSave: post('/api/subjects/save'),
  subjectRemove: post('/api/subjects/remove', STUDY, { id: 'number' }),
  examSave: post('/api/exams/save'),
  examRemove: post('/api/exams/remove', STUDY, { id: 'number' }),
  taskSave: post('/api/tasks/save'),
  taskToggle: post('/api/tasks/toggle', STUDY, { id: 'number', completed: 'boolean' }),
  taskRemove: post('/api/tasks/remove', STUDY, { id: 'number' }),
  waterSave: post('/api/water/save'),
  problemInboxSave: post('/api/problem-inbox/save', STUDY, { text: 'string', date: 'string?' }),
  problemInboxStatus: post('/api/problem-inbox/status', STUDY, { id: 'number', status: 'string' }),
  problemInboxRemove: post('/api/problem-inbox/remove', STUDY, { id: 'number' }),
  problemInboxResolveDate: post('/api/problem-inbox/resolve-date', STUDY, { date: 'string' }),
  reportGenerate: post('/api/reports/generate', STUDY, { kind: 'string', period: 'string?' }),

  briefSettingsRead: get('/api/briefs/settings', BRIEF),
  briefSettingsWrite: post('/api/briefs/settings', BRIEF),
  briefs: get('/api/briefs', BRIEF),
  briefToday: get('/api/briefs/today', BRIEF),
  briefGenerate: post('/api/briefs/generate', BRIEF, {
    sendEmail: 'boolean?',
    sendWechat: 'boolean?',
  }),
  briefSendLatest: post('/api/briefs/send-latest', BRIEF),

  backupStatus: get('/api/backups/status', OPERATIONS),
  backupRun: post('/api/backups/run', OPERATIONS),
  backupRestore: post('/api/backups/restore', OPERATIONS, { fileName: 'string' }),
  taskCenterStatus: get('/api/tasks/status', OPERATIONS),
  visitStats: get('/api/visits/summary', OPERATIONS),
  opsLogsSummary: get('/api/ops/logs/summary', OPERATIONS),
  sqliteMaintenance: post('/api/maintenance/sqlite', OPERATIONS),
  precomputeMaintenance: post('/api/maintenance/precompute', OPERATIONS),

  breakGuardConfigRead: get('/api/break-guard/config', BREAK_GUARD),
  breakGuardConfigWrite: post('/api/break-guard/config', BREAK_GUARD, { config: 'object' }),

  mihomoSettings: get('/api/settings/mihomo', SETTINGS),
  mihomoSubscription: post('/api/settings/mihomo/subscription', SETTINGS, {
    subscriptionUrl: 'string',
    clearSubscription: 'boolean?',
  }),
  mihomoImport: post('/api/settings/mihomo/import', SETTINGS, { subscriptionContent: 'string' }),
  mihomoSelect: post('/api/settings/mihomo/select', SETTINGS, { name: 'string' }),
  mihomoTest: post('/api/settings/mihomo/test', SETTINGS),

  notificationCenter: get('/api/notifications/center', NOTIFICATIONS),
  notificationAck: post('/api/notifications/ack', NOTIFICATIONS, { id: 'number' }),
  notificationRetry: post('/api/notifications/retry-delivery', NOTIFICATIONS, { id: 'number' }),
  notificationWechatTest: post('/api/notifications/wechat/test', NOTIFICATIONS),
  notificationBarkTest: post('/api/notifications/bark/test', NOTIFICATIONS),
  notificationTelegramSettings: post('/api/notifications/telegram/settings', NOTIFICATIONS),
  notificationTelegramRegister: post('/api/notifications/telegram/register', NOTIFICATIONS),
  notificationTelegramTest: post('/api/notifications/telegram/test', NOTIFICATIONS),
  notificationWechatSettings: post('/api/notifications/wechat/settings', NOTIFICATIONS, {
    enabled: 'boolean',
    generateTime: 'string?',
  }),

  embeddingStatus: get('/api/error-themes/embedding/status'),
  errorThemeAnalysis: get('/api/error-themes/analysis'),
  errorThemeDetail: get('/api/error-themes/detail'),
  errorThemeOptions: get('/api/error-themes/options'),
  errorThemeBatchStatus: get('/api/error-themes/batch/status'),
  errorThemeBatchRun: post('/api/error-themes/batch/run'),
  errorThemeCorrectionSave: post('/api/error-themes/corrections/save'),

  users: get('/api/users', USERS),
  userInviteCreate: post('/api/users/invites', USERS, {
    displayName: 'string?',
    expiresInHours: 'number?',
  }),
  userInviteRevoke: post('/api/users/invites/revoke', USERS, { inviteId: 'number' }),
  userUpdate: post('/api/users/update', USERS, {
    userId: 'number',
    displayName: 'string?',
    status: 'string?',
  }),
  userResetPassword: post('/api/users/reset-password', USERS, {
    userId: 'number',
    password: 'string',
  }),
  userRevokeSessions: post('/api/users/revoke-sessions', USERS, { userId: 'number' }),
  dataReset: post('/api/reset', DATA_IMPORT),
});

export function apiContract(name) {
  const contract = API_CONTRACTS[name];
  if (!contract) throw new Error(`Unknown API contract: ${name}`);
  return contract;
}

export function findApiContract(method, pathname) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  return Object.entries(API_CONTRACTS).find(([, contract]) => (
    contract.method === normalizedMethod && contract.path === pathname
  )) || null;
}
