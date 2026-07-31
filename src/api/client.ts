import type { Goal, MockExamRecord, ShortTermTask, StudyProject, StudyTimeRecord, Subject, DailyReview, WaterIntakeRecord } from '../types/models';
import type { ServerState, DashboardData, ReviewTrendResponse, ProblemInboxItem, ReviewPrefill, DashboardChartsData, DailyBriefSettings, DailyBrief, StatisticsSummary, ReferenceList, ReviewsResponse, MockExamListResponse, StudyTargetSetting, BackupStatus, MihomoSettingsResponse, MihomoTestResponse, LearningProgressResponse, ProjectProgressResponse, VisitStatsResponse, OpsLogSummaryResponse, NotificationCenterResponse, CalendarResponse, TaskCenterStatus, LearningReport, EmbeddingModelProfile, ErrorThemeBatchJob, ErrorThemeOption, EmbeddingStatus, ErrorThemeAnalysis, ErrorThemeDetail, BreakGuardScheduleConfig, BreakGuardScheduleResponse, AccountSession, StudyComparisonResponse, FocusTimerDashboard, FocusTimerAction, FocusTimerActionResponse, UserManagementResponse, ManagedUserAccount } from './contracts';
import { invalidateServerQueries } from './queryClient';
import { apiContractRequest } from './transport';
import type { ApiContractName } from '../../shared/api-contracts.js';
export * from './contracts';
export { apiRequest } from './transport';

export const notifyDataChanged = () => {
  invalidateServerQueries();
  window.dispatchEvent(new Event('server-data-changed'));
};

function cachedContractRequest<T>(
  name: ApiContractName,
  query?: Record<string, string | number | undefined>,
  ttlMs = 60_000,
): Promise<T> {
  void ttlMs;
  return apiContractRequest<T>(name, { query });
}

function cachedState() {
  return apiContractRequest<ServerState>('state');
}

function cachedDashboard() {
  return apiContractRequest<DashboardData>('dashboard');
}

export const serverApi = {
  getSession: () => apiContractRequest<AccountSession>('session'),
  getUsers: () => apiContractRequest<UserManagementResponse>('users'),
  createUserInvite: (displayName: string, expiresInHours = 24) =>
    apiContractRequest<{ ok: true; invite: { token: string; displayName: string; expiresAt: string } }>('userInviteCreate', { body: { displayName, expiresInHours } }),
  revokeUserInvite: (inviteId: number) => apiContractRequest<{ ok: true; revoked: boolean }>('userInviteRevoke', { body: { inviteId } }),
  updateUser: (userId: number, input: { displayName: string; status: 'active' | 'disabled' }) =>
    apiContractRequest<{ ok: true; account: ManagedUserAccount }>('userUpdate', { body: { userId, ...input } }),
  resetUserPassword: (userId: number, password: string) => apiContractRequest<{ ok: true }>('userResetPassword', { body: { userId, password } }),
  revokeUserSessions: (userId: number) => apiContractRequest<{ ok: true }>('userRevokeSessions', { body: { userId } }),
  getState: () => cachedState(),
  getDashboard: () => cachedDashboard(),
  getDashboardCharts: () => apiContractRequest<DashboardChartsData>('dashboardCharts'),
  getGoals: () => apiContractRequest<ReferenceList<Goal>>('goals'),
  getProjects: () => apiContractRequest<ReferenceList<StudyProject>>('projects'),
  getSubjects: () => apiContractRequest<ReferenceList<Subject>>('subjects'),
  getStudyTarget: () => apiContractRequest<StudyTargetSetting>('studyTargetRead'),
  saveStudyTarget: (targetHours: number) => apiContractRequest<StudyTargetSetting>('studyTargetWrite', { body: { targetHours } }),
  getBriefSettings: () => apiContractRequest<{ settings: DailyBriefSettings; readOnly?: boolean }>('briefSettingsRead'),
  saveBriefSettings: (settings: DailyBriefSettings) => apiContractRequest<{ settings: DailyBriefSettings; readOnly?: boolean }>('briefSettingsWrite', { body: settings }),
  getBriefs: (limit = 30) => cachedContractRequest<{ briefs: DailyBrief[]; readOnly?: boolean }>('briefs', { limit }, 60_000),
  getTodayBrief: () => cachedContractRequest<{ brief: DailyBrief | null; latest: DailyBrief | null; readOnly?: boolean }>('briefToday', undefined, 60_000),
  generateBrief: (sendEmail = false, sendWechat = false) => apiContractRequest<{ ok: true; brief: DailyBrief }>('briefGenerate', { body: { sendEmail, sendWechat } }),
  sendLatestBrief: () => apiContractRequest<{ ok: true; brief: DailyBrief }>('briefSendLatest'),
  getReviews: (from?: string, to?: string, limit?: number, offset?: number) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    return apiContractRequest<ReviewsResponse>('reviews', { query: params });
  },
  getReviewPrefill: (date: string) => cachedContractRequest<ReviewPrefill>('reviewPrefill', { date }, 30_000),
  getReviewTrend: (days = 30) => cachedContractRequest<ReviewTrendResponse>('reviewTrend', { days }, 120_000),
  getProblemInbox: (status: 'open' | 'resolved' | 'all' = 'open', limit = 12) =>
    cachedContractRequest<{ items: ProblemInboxItem[]; readOnly?: boolean }>('problemInbox', { status, limit }, 30_000),
  saveProblemInbox: (text: string, date?: string) =>
    apiContractRequest<{ ok: true; id: number; item: ProblemInboxItem | null }>('problemInboxSave', { body: { text, date } }),
  setProblemInboxStatus: (id: number, status: 'open' | 'resolved') =>
    apiContractRequest<{ ok: true }>('problemInboxStatus', { body: { id, status } }),
  removeProblemInbox: (id: number) => apiContractRequest<{ ok: true }>('problemInboxRemove', { body: { id } }),
  resolveProblemInboxByDate: (date: string) => apiContractRequest<{ ok: true; resolvedAt: string }>('problemInboxResolveDate', { body: { date } }),
  getStudyRecordsByDate: (date: string) => cachedContractRequest<{ records: StudyTimeRecord[]; readOnly?: boolean }>('studyRecords', { date }, 30_000),
  getFocusTimer: () => apiContractRequest<FocusTimerDashboard>('focusTimerRead'),
  focusTimerAction: (action: FocusTimerAction) =>
    apiContractRequest<FocusTimerActionResponse>('focusTimerAction', { body: action }),
  getStatisticsSummary: () => cachedContractRequest<StatisticsSummary>('statisticsSummary', undefined, 90_000),
  getMockExams: (subjectId: number | 'all' = 'all', limit = 20, offset = 0) =>
    apiContractRequest<MockExamListResponse>('mockExams', { query: { subjectId, limit, offset } }),
  saveGoal: (goal: Partial<Goal>) => apiContractRequest<number>('goalSave', { body: goal }).then((result) => Number(result)),
  activateGoal: (id: number) => apiContractRequest<void>('goalActivate', { body: { id } }),
  removeGoal: (id: number) => apiContractRequest<void>('goalRemove', { body: { id } }),
  upsertReview: (review: Partial<DailyReview> & { date: string }) => apiContractRequest<number>('reviewUpsert', { body: review }).then((result) => Number(result)),
  saveProject: (project: Partial<StudyProject>) => apiContractRequest<number>('projectSave', { body: project }).then((result) => Number(result)),
  removeProject: (id: number) => apiContractRequest<void>('projectRemove', { body: { id } }),
  saveDayRecords: (date: string, records: Array<Partial<StudyTimeRecord> & { projectId: number; projectNameSnapshot: string }>) =>
    apiContractRequest<void>('studyRecordsSaveDay', { body: { date, records } }),
  saveSubject: (subject: Partial<Subject>) => apiContractRequest<number>('subjectSave', { body: subject }).then((result) => Number(result)),
  removeSubject: (id: number) => apiContractRequest<void>('subjectRemove', { body: { id } }),
  saveExam: (record: Partial<MockExamRecord> & { subjectId: number; subjectNameSnapshot: string }) =>
    apiContractRequest<number>('examSave', { body: record }).then((result) => Number(result)),
  removeExam: (id: number) => apiContractRequest<void>('examRemove', { body: { id } }),
  saveTask: (task: Partial<ShortTermTask>) => apiContractRequest<number>('taskSave', { body: task }).then((result) => Number(result)),
  toggleTask: (task: ShortTermTask, completed: boolean) => apiContractRequest<void>('taskToggle', { body: { id: task.id, completed } }),
  removeTask: (id: number) => apiContractRequest<void>('taskRemove', { body: { id } }),
  saveWaterIntake: (record: Pick<WaterIntakeRecord, 'date' | 'cups' | 'cupMl' | 'targetCups'>) =>
    apiContractRequest<void>('waterSave', { body: record }),
  getBackupStatus: () => apiContractRequest<BackupStatus>('backupStatus'),
  getBreakGuardSchedule: () => apiContractRequest<BreakGuardScheduleResponse>('breakGuardConfigRead'),
  saveBreakGuardSchedule: (config: BreakGuardScheduleConfig) => apiContractRequest<{ ok: true } & BreakGuardScheduleResponse>('breakGuardConfigWrite', { body: { config } }),
  runServerBackup: () => apiContractRequest<{ ok: true; backup: { kind: string; filePath: string; createdAt: string } }>('backupRun'),
  restoreServerBackup: (fileName: string) => apiContractRequest<{ ok: true; restoredFrom: string }>('backupRestore', { body: { fileName } }),
  getMihomoSettings: () => apiContractRequest<MihomoSettingsResponse>('mihomoSettings'),
  saveMihomoSubscription: (subscriptionUrl: string, clearSubscription = false) =>
    apiContractRequest<MihomoSettingsResponse>('mihomoSubscription', { body: { subscriptionUrl, clearSubscription } }),
  importMihomoProvider: (subscriptionContent: string) =>
    apiContractRequest<MihomoSettingsResponse>('mihomoImport', { body: { subscriptionContent } }),
  selectMihomoProxy: (name: string) =>
    apiContractRequest<MihomoSettingsResponse>('mihomoSelect', { body: { name } }),
  testMihomoProxy: () => apiContractRequest<MihomoTestResponse>('mihomoTest'),
  getTaskCenterStatus: () => cachedContractRequest<TaskCenterStatus>('taskCenterStatus', undefined, 20_000),
  getLearningProgress: () => cachedContractRequest<LearningProgressResponse>('learningProgress', undefined, 60_000),
  getStudyComparison: (days = 30) => apiContractRequest<StudyComparisonResponse>('studyComparison', { query: { days } }),
  getProjectProgress: () => cachedContractRequest<ProjectProgressResponse>('projectProgress', undefined, 60_000),
  getVisitStats: () => cachedContractRequest<VisitStatsResponse>('visitStats', undefined, 30_000),
  getOpsLogsSummary: () => apiContractRequest<OpsLogSummaryResponse>('opsLogsSummary'),
  getNotificationCenter: (status: 'all' | 'warning' | 'critical' | 'notified' = 'all') =>
    cachedContractRequest<NotificationCenterResponse>('notificationCenter', { status }, 20_000),
  acknowledgeNotification: (id: number) =>
    apiContractRequest<{ ok: true; center: NotificationCenterResponse }>('notificationAck', { body: { id } }),
  retryNotificationDelivery: (id: number) =>
    apiContractRequest<{ ok: true; center: NotificationCenterResponse }>('notificationRetry', { body: { id } }),
  testWechatNotification: () => apiContractRequest<{ ok: boolean; digest: { text: string }; delivery: Record<string, unknown>; center: NotificationCenterResponse }>('notificationWechatTest', { body: {} }),
  testBarkNotification: () => apiContractRequest<{ ok: boolean; delivery: Record<string, unknown>; center: NotificationCenterResponse }>('notificationBarkTest', { body: {} }),
  saveTelegramSettings: (settings: { botToken?: string; chatId?: string; allowedUserId?: string; webhookUrl?: string }) =>
    apiContractRequest<{ ok: true; telegram: NotificationCenterResponse['telegram']; center: NotificationCenterResponse }>('notificationTelegramSettings', { body: settings }),
  registerTelegramWebhook: () =>
    apiContractRequest<{ ok: true; telegram: NotificationCenterResponse['telegram']; center: NotificationCenterResponse }>('notificationTelegramRegister', { body: {} }),
  testTelegramNotification: () =>
    apiContractRequest<{ ok: boolean; center: NotificationCenterResponse }>('notificationTelegramTest', { body: {} }),
  saveWechatNotificationSettings: (enabled: boolean, generateTime = '08:00') =>
    apiContractRequest<{ ok: true; settings: DailyBriefSettings; center: NotificationCenterResponse }>('notificationWechatSettings', { body: { enabled, generateTime } }),
  getCalendarEvents: (from: string, to: string) =>
    cachedContractRequest<CalendarResponse>('calendar', { from, to }, 30_000),
  runSqliteMaintenance: () => apiContractRequest<{ ok: boolean; ranAt: string; kind: string; error?: string }>('sqliteMaintenance'),
  runPrecompute: () => apiContractRequest<{ ok: boolean; ranAt: string; error?: string }>('precomputeMaintenance'),
  getReports: () => cachedContractRequest<{ reports: LearningReport[] }>('reports', undefined, 120_000),
  generateReport: (kind: 'weekly' | 'monthly', period: 'current' | 'previous' = 'current') =>
    apiContractRequest<{ ok: true; report: LearningReport }>('reportGenerate', { body: { kind, period } }),
  getErrorThemeAnalysis: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return apiContractRequest<ErrorThemeAnalysis>('errorThemeAnalysis', { query: params });
  },
  getEmbeddingStatus: () => cachedContractRequest<EmbeddingStatus>('embeddingStatus', undefined, 120_000),
  getErrorThemeDetail: (themeId: number, from?: string, to?: string) => {
    const params = new URLSearchParams({ themeId: String(themeId) });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return apiContractRequest<ErrorThemeDetail>('errorThemeDetail', { query: params });
  },
  getErrorThemeOptions: () => apiContractRequest<{ themes: ErrorThemeOption[]; readOnly?: boolean }>('errorThemeOptions'),
  getErrorThemeBatchStatus: () => apiContractRequest<{ job: ErrorThemeBatchJob | null; readOnly?: boolean }>('errorThemeBatchStatus'),
  runErrorThemeBatch: (from?: string, to?: string, mode: 'embedding' | 'rules' = 'rules', modelProfile: EmbeddingModelProfile = 'rules') =>
    apiContractRequest<{ ok: true; started: boolean; job: ErrorThemeBatchJob | null }>('errorThemeBatchRun', { body: { from, to, mode, modelProfile } }),
  saveErrorThemeCorrection: (body: {
    occurrenceId: number;
    sentence: string;
    action: 'relabel' | 'ignore';
    targetThemeKey?: string;
    sourceThemeKey?: string;
    sourceLabel?: string;
    from?: string;
    to?: string;
  }) => apiContractRequest<{ ok: true; analysis: ErrorThemeAnalysis }>('errorThemeCorrectionSave', { body }),
  reset: () => apiContractRequest<void>('dataReset'),
};
