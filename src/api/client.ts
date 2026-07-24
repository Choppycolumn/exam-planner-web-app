import type { Goal, MockExamRecord, ShortTermTask, StudyProject, StudyTimeRecord, Subject, DailyReview, WaterIntakeRecord } from '../types/models';
import type { ServerState, DashboardData, ReviewTrendResponse, ProblemInboxItem, ReviewPrefill, DashboardChartsData, DailyBriefSettings, DailyBrief, StatisticsSummary, ReferenceList, ReviewsResponse, MockExamListResponse, StudyTargetSetting, BackupStatus, MihomoSettingsResponse, MihomoTestResponse, LearningProgressResponse, ProjectProgressResponse, VisitStatsResponse, OpsLogSummaryResponse, NotificationCenterResponse, CalendarResponse, TaskCenterStatus, LearningReport, EmbeddingModelProfile, ErrorThemeBatchJob, ErrorThemeOption, EmbeddingStatus, ErrorThemeAnalysis, ErrorThemeDetail, BreakGuardScheduleConfig, BreakGuardScheduleResponse, AccountSession, StudyComparisonResponse, FocusTimerDashboard, FocusTimerAction, FocusTimerActionResponse } from './contracts';
import { invalidateServerQueries } from './queryClient';
import { apiRequest } from './transport';
export * from './contracts';
export { apiRequest } from './transport';

export const notifyDataChanged = () => {
  invalidateServerQueries();
  window.dispatchEvent(new Event('server-data-changed'));
};

function cachedApiRequest<T>(path: string, ttlMs = 60_000): Promise<T> {
  void ttlMs;
  return apiRequest<T>(path);
}

function cachedState() {
  return apiRequest<ServerState>('/state');
}

function cachedDashboard() {
  return apiRequest<DashboardData>('/dashboard');
}

export const serverApi = {
  getSession: () => apiRequest<AccountSession>('/session'),
  getState: () => cachedState(),
  getDashboard: () => cachedDashboard(),
  getDashboardCharts: () => cachedApiRequest<DashboardChartsData>('/dashboard/charts', 90_000),
  getGoals: () => cachedApiRequest<ReferenceList<Goal>>('/goals', 120_000),
  getProjects: () => cachedApiRequest<ReferenceList<StudyProject>>('/projects', 120_000),
  getSubjects: () => cachedApiRequest<ReferenceList<Subject>>('/subjects', 120_000),
  getStudyTarget: () => cachedApiRequest<StudyTargetSetting>('/settings/study-target', 120_000),
  saveStudyTarget: (targetHours: number) => apiRequest<StudyTargetSetting>('/settings/study-target', { method: 'POST', body: { targetHours } }),
  getBriefSettings: () => apiRequest<{ settings: DailyBriefSettings; readOnly?: boolean }>('/briefs/settings'),
  saveBriefSettings: (settings: DailyBriefSettings) => apiRequest<{ settings: DailyBriefSettings; readOnly?: boolean }>('/briefs/settings', { method: 'POST', body: settings }),
  getBriefs: (limit = 30) => cachedApiRequest<{ briefs: DailyBrief[]; readOnly?: boolean }>(`/briefs?limit=${limit}`, 60_000),
  getTodayBrief: () => cachedApiRequest<{ brief: DailyBrief | null; latest: DailyBrief | null; readOnly?: boolean }>('/briefs/today', 60_000),
  generateBrief: (sendEmail = false, sendWechat = false) => apiRequest<{ ok: true; brief: DailyBrief }>('/briefs/generate', { method: 'POST', body: { sendEmail, sendWechat } }),
  sendLatestBrief: () => apiRequest<{ ok: true; brief: DailyBrief }>('/briefs/send-latest', { method: 'POST' }),
  getReviews: (from?: string, to?: string, limit?: number, offset?: number) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    const query = params.toString();
    return cachedApiRequest<ReviewsResponse>(`/reviews${query ? `?${query}` : ''}`, 45_000);
  },
  getReviewPrefill: (date: string) => cachedApiRequest<ReviewPrefill>(`/reviews/prefill?date=${encodeURIComponent(date)}`, 30_000),
  getReviewTrend: (days = 30) => cachedApiRequest<ReviewTrendResponse>(`/reviews/trend?days=${days}`, 120_000),
  getProblemInbox: (status: 'open' | 'resolved' | 'all' = 'open', limit = 12) =>
    cachedApiRequest<{ items: ProblemInboxItem[]; readOnly?: boolean }>(`/problem-inbox?status=${encodeURIComponent(status)}&limit=${limit}`, 30_000),
  saveProblemInbox: (text: string, date?: string) =>
    apiRequest<{ ok: true; id: number; item: ProblemInboxItem | null }>('/problem-inbox/save', { method: 'POST', body: { text, date } }),
  setProblemInboxStatus: (id: number, status: 'open' | 'resolved') =>
    apiRequest<{ ok: true }>('/problem-inbox/status', { method: 'POST', body: { id, status } }),
  removeProblemInbox: (id: number) => apiRequest<{ ok: true }>('/problem-inbox/remove', { method: 'POST', body: { id } }),
  resolveProblemInboxByDate: (date: string) => apiRequest<{ ok: true; resolvedAt: string }>('/problem-inbox/resolve-date', { method: 'POST', body: { date } }),
  getStudyRecordsByDate: (date: string) => cachedApiRequest<{ records: StudyTimeRecord[]; readOnly?: boolean }>(`/study-records?date=${encodeURIComponent(date)}`, 30_000),
  getFocusTimer: () => apiRequest<FocusTimerDashboard>('/focus-timer'),
  focusTimerAction: (action: FocusTimerAction) =>
    apiRequest<FocusTimerActionResponse>('/focus-timer/action', { method: 'POST', body: action }),
  getStatisticsSummary: () => cachedApiRequest<StatisticsSummary>('/statistics/summary', 90_000),
  getMockExams: (subjectId: number | 'all' = 'all', limit = 20, offset = 0) =>
    apiRequest<MockExamListResponse>(`/mock-exams?subjectId=${encodeURIComponent(String(subjectId))}&limit=${limit}&offset=${offset}`),
  saveGoal: (goal: Partial<Goal>) => apiRequest<number>('/goals/save', { method: 'POST', body: goal }).then((result) => Number(result)),
  activateGoal: (id: number) => apiRequest<void>('/goals/activate', { method: 'POST', body: { id } }),
  removeGoal: (id: number) => apiRequest<void>('/goals/remove', { method: 'POST', body: { id } }),
  upsertReview: (review: Partial<DailyReview> & { date: string }) => apiRequest<number>('/reviews/upsert', { method: 'POST', body: review }).then((result) => Number(result)),
  saveProject: (project: Partial<StudyProject>) => apiRequest<number>('/projects/save', { method: 'POST', body: project }).then((result) => Number(result)),
  removeProject: (id: number) => apiRequest<void>('/projects/remove', { method: 'POST', body: { id } }),
  saveDayRecords: (date: string, records: Array<Partial<StudyTimeRecord> & { projectId: number; projectNameSnapshot: string }>) =>
    apiRequest<void>('/study-records/save-day', { method: 'POST', body: { date, records } }),
  saveSubject: (subject: Partial<Subject>) => apiRequest<number>('/subjects/save', { method: 'POST', body: subject }).then((result) => Number(result)),
  removeSubject: (id: number) => apiRequest<void>('/subjects/remove', { method: 'POST', body: { id } }),
  saveExam: (record: Partial<MockExamRecord> & { subjectId: number; subjectNameSnapshot: string }) =>
    apiRequest<number>('/exams/save', { method: 'POST', body: record }).then((result) => Number(result)),
  removeExam: (id: number) => apiRequest<void>('/exams/remove', { method: 'POST', body: { id } }),
  saveTask: (task: Partial<ShortTermTask>) => apiRequest<number>('/tasks/save', { method: 'POST', body: task }).then((result) => Number(result)),
  toggleTask: (task: ShortTermTask, completed: boolean) => apiRequest<void>('/tasks/toggle', { method: 'POST', body: { id: task.id, completed } }),
  removeTask: (id: number) => apiRequest<void>('/tasks/remove', { method: 'POST', body: { id } }),
  saveWaterIntake: (record: Pick<WaterIntakeRecord, 'date' | 'cups' | 'cupMl' | 'targetCups'>) =>
    apiRequest<void>('/water/save', { method: 'POST', body: record }),
  getBackupStatus: () => apiRequest<BackupStatus>('/backups/status'),
  getBreakGuardSchedule: () => apiRequest<BreakGuardScheduleResponse>('/break-guard/config'),
  saveBreakGuardSchedule: (config: BreakGuardScheduleConfig) => apiRequest<{ ok: true } & BreakGuardScheduleResponse>('/break-guard/config', { method: 'POST', body: { config } }),
  runServerBackup: () => apiRequest<{ ok: true; backup: { kind: string; filePath: string; createdAt: string } }>('/backups/run', { method: 'POST' }),
  restoreServerBackup: (fileName: string) => apiRequest<{ ok: true; restoredFrom: string }>('/backups/restore', { method: 'POST', body: { fileName } }),
  getMihomoSettings: () => apiRequest<MihomoSettingsResponse>('/settings/mihomo'),
  saveMihomoSubscription: (subscriptionUrl: string, clearSubscription = false) =>
    apiRequest<MihomoSettingsResponse>('/settings/mihomo/subscription', { method: 'POST', body: { subscriptionUrl, clearSubscription } }),
  importMihomoProvider: (subscriptionContent: string) =>
    apiRequest<MihomoSettingsResponse>('/settings/mihomo/import', { method: 'POST', body: { subscriptionContent } }),
  selectMihomoProxy: (name: string) =>
    apiRequest<MihomoSettingsResponse>('/settings/mihomo/select', { method: 'POST', body: { name } }),
  testMihomoProxy: () => apiRequest<MihomoTestResponse>('/settings/mihomo/test', { method: 'POST' }),
  getTaskCenterStatus: () => cachedApiRequest<TaskCenterStatus>('/tasks/status', 20_000),
  getLearningProgress: () => cachedApiRequest<LearningProgressResponse>('/learning-progress', 60_000),
  getStudyComparison: (days = 30) => cachedApiRequest<StudyComparisonResponse>(`/study-comparison?days=${days}`, 60_000),
  getProjectProgress: () => cachedApiRequest<ProjectProgressResponse>('/project-progress', 60_000),
  getVisitStats: () => cachedApiRequest<VisitStatsResponse>('/visits/summary', 30_000),
  getOpsLogsSummary: () => apiRequest<OpsLogSummaryResponse>('/ops/logs/summary'),
  getNotificationCenter: (status: 'all' | 'warning' | 'critical' | 'notified' = 'all') =>
    cachedApiRequest<NotificationCenterResponse>(`/notifications/center?status=${encodeURIComponent(status)}`, 20_000),
  acknowledgeNotification: (id: number) =>
    apiRequest<{ ok: true; center: NotificationCenterResponse }>('/notifications/ack', { method: 'POST', body: { id } }),
  retryNotificationDelivery: (id: number) =>
    apiRequest<{ ok: true; center: NotificationCenterResponse }>('/notifications/retry-delivery', { method: 'POST', body: { id } }),
  testWechatNotification: () => apiRequest<{ ok: boolean; digest: { text: string }; delivery: Record<string, unknown>; center: NotificationCenterResponse }>('/notifications/wechat/test', { method: 'POST', body: {} }),
  testBarkNotification: () => apiRequest<{ ok: boolean; delivery: Record<string, unknown>; center: NotificationCenterResponse }>('/notifications/bark/test', { method: 'POST', body: {} }),
  saveTelegramSettings: (settings: { botToken?: string; chatId?: string; allowedUserId?: string; webhookUrl?: string }) =>
    apiRequest<{ ok: true; telegram: NotificationCenterResponse['telegram']; center: NotificationCenterResponse }>('/notifications/telegram/settings', { method: 'POST', body: settings }),
  registerTelegramWebhook: () =>
    apiRequest<{ ok: true; telegram: NotificationCenterResponse['telegram']; center: NotificationCenterResponse }>('/notifications/telegram/register', { method: 'POST', body: {} }),
  testTelegramNotification: () =>
    apiRequest<{ ok: boolean; center: NotificationCenterResponse }>('/notifications/telegram/test', { method: 'POST', body: {} }),
  saveWechatNotificationSettings: (enabled: boolean, generateTime = '08:00') =>
    apiRequest<{ ok: true; settings: DailyBriefSettings; center: NotificationCenterResponse }>('/notifications/wechat/settings', { method: 'POST', body: { enabled, generateTime } }),
  getCalendarEvents: (from: string, to: string) =>
    cachedApiRequest<CalendarResponse>(`/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, 30_000),
  runSqliteMaintenance: () => apiRequest<{ ok: boolean; ranAt: string; kind: string; error?: string }>('/maintenance/sqlite', { method: 'POST' }),
  runPrecompute: () => apiRequest<{ ok: boolean; ranAt: string; error?: string }>('/maintenance/precompute', { method: 'POST' }),
  getReports: () => cachedApiRequest<{ reports: LearningReport[] }>('/reports', 120_000),
  generateReport: (kind: 'weekly' | 'monthly', period: 'current' | 'previous' = 'current') =>
    apiRequest<{ ok: true; report: LearningReport }>('/reports/generate', { method: 'POST', body: { kind, period } }),
  getErrorThemeAnalysis: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString();
    return cachedApiRequest<ErrorThemeAnalysis>(`/error-themes/analysis${query ? `?${query}` : ''}`, 120_000);
  },
  getEmbeddingStatus: () => cachedApiRequest<EmbeddingStatus>('/error-themes/embedding/status', 120_000),
  getErrorThemeDetail: (themeId: number, from?: string, to?: string) => {
    const params = new URLSearchParams({ themeId: String(themeId) });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return apiRequest<ErrorThemeDetail>(`/error-themes/detail?${params.toString()}`);
  },
  getErrorThemeOptions: () => apiRequest<{ themes: ErrorThemeOption[]; readOnly?: boolean }>('/error-themes/options'),
  getErrorThemeBatchStatus: () => apiRequest<{ job: ErrorThemeBatchJob | null; readOnly?: boolean }>('/error-themes/batch/status'),
  runErrorThemeBatch: (from?: string, to?: string, mode: 'embedding' | 'rules' = 'rules', modelProfile: EmbeddingModelProfile = 'rules') =>
    apiRequest<{ ok: true; started: boolean; job: ErrorThemeBatchJob | null }>('/error-themes/batch/run', { method: 'POST', body: { from, to, mode, modelProfile } }),
  saveErrorThemeCorrection: (body: {
    occurrenceId: number;
    sentence: string;
    action: 'relabel' | 'ignore';
    targetThemeKey?: string;
    sourceThemeKey?: string;
    sourceLabel?: string;
    from?: string;
    to?: string;
  }) => apiRequest<{ ok: true; analysis: ErrorThemeAnalysis }>('/error-themes/corrections/save', { method: 'POST', body }),
  reset: () => apiRequest<void>('/reset', { method: 'POST' }),
};
