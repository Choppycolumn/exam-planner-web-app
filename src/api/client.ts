import type { Goal, MockExamRecord, ShortTermTask, StudyProject, StudyTimeRecord, Subject, DailyReview, WaterIntakeRecord } from '../types/models';
import type { CommonProblemSummary } from '../types/reports';
import { invalidateServerQueries } from './queryClient';

export interface ServerState {
  goals: Goal[];
  dailyReviews: DailyReview[];
  studyProjects: StudyProject[];
  studyTimeRecords: StudyTimeRecord[];
  subjects: Subject[];
  mockExamRecords: MockExamRecord[];
  shortTermTasks: ShortTermTask[];
  waterIntakeRecords: WaterIntakeRecord[];
  readOnly?: boolean;
}

export interface DashboardData {
  activeGoal: Goal | null;
  today: string;
  todayTotal: number;
  totalStudyMinutes: number;
  studyTargetMinutes: number;
  distribution?: Array<{ name: string; value: number }>;
  trend?: Array<{ date: string; minutes: number }>;
  latestExam: MockExamRecord | null;
  todayReview: DailyReview | null;
  yesterdayReview: DailyReview | null;
  visibleTasks: ShortTermTask[];
  todayWaterRecord: WaterIntakeRecord | null;
  todayBrief: DailyBrief | null;
  readOnly?: boolean;
}

export interface DashboardChartsData {
  today: string;
  distribution: Array<{ name: string; value: number }>;
  trend: Array<{ date: string; minutes: number }>;
}

export interface DailyBriefSettings {
  enabled: boolean;
  generateTime: string;
  cityName: string;
  latitude: number;
  longitude: number;
  newsTopicsText: string;
  marketSymbolsText: string;
  nextDailyBriefAt?: string | null;
  email: {
    enabled: boolean;
    host: string;
    port: number;
    secureMode: 'ssl' | 'starttls' | 'none';
    username: string;
    password: string;
    from: string;
    to: string;
    subjectPrefix: string;
    hasPassword?: boolean;
  };
}

export interface DailyBrief {
  id: number;
  date: string;
  title: string;
  status: string;
  emailedAt: string | null;
  emailError: string;
  generatedAt: string;
  updatedAt: string;
  payload: {
    date: string;
    title: string;
    generatedAt: string;
    trigger: string;
    weather?: {
      ok: boolean;
      cityName?: string;
      condition?: string;
      temperature?: number;
      minTemperature?: number;
      maxTemperature?: number;
      precipitationProbability?: number;
      error?: string;
    };
    markets?: Array<{ ok: boolean; name: string; symbol: string; price?: number; change?: number | null; changePercent?: number; currency?: string; error?: string }>;
    news?: Array<{ topic: string; ok: boolean; articles: Array<{ title: string; url: string; source?: string; seenAt?: string }>; error?: string }>;
    learning?: {
      activeGoal: { name: string; deadline: string; daysLeft: number } | null;
      yesterday: string;
      yesterdayMinutes: number;
      last7Minutes: number;
      yesterdayReview: DailyReview | null;
      todayTasks: ShortTermTask[];
      latestExam: { date: string; subjectName: string; score: number; fullScore: number; paperName: string } | null;
      topErrorThemes: Array<{ id: string; label: string; count: number; dates: string[]; examples: Array<{ date: string; field: string; text: string }> }>;
    };
  };
}

export interface StatisticsSummary {
  today: string;
  todayTotal: number;
  distribution: Array<{ name: string; value: number }>;
  last7: Array<{ date: string; minutes: number }>;
  last30: Array<{ name: string; minutes: number }>;
}

export interface ReferenceList<T> {
  items: T[];
  readOnly?: boolean;
}

export interface ReviewsResponse {
  reviews: DailyReview[];
  total: number;
  limit: number | null;
  offset: number;
  readOnly?: boolean;
}

export interface MockExamListResponse {
  exams: MockExamRecord[];
  total: number;
  limit: number;
  offset: number;
  stats: {
    latest: MockExamRecord | null;
    highest: number | null;
    average: number | null;
    lowest: number | null;
  };
  trend: Array<{ date: string; score: number }>;
  readOnly?: boolean;
}

export interface StudyTargetSetting {
  targetMinutes: number;
  targetHours: number;
  readOnly?: boolean;
}

export interface BackupStatus {
  storage: 'sqlite' | 'sqlite-tables';
  sqliteFile: string;
  sqliteSizeBytes: number;
  backupCount: number;
  backups: Array<{ fileName: string; kind: string; createdAt: string; sizeBytes: number }>;
  lastBackup: { kind: string; filePath: string; createdAt: string; note?: string } | null;
  lastWeeklyBackupAt: string | null;
  dictionaryCount: number;
  dictionaryIndexedAt: string | null;
}

export interface RuntimeStatus {
  uptimeSeconds: number;
  processUptimeSeconds: number;
  cpuCount: number;
  loadAverage: number[];
  memory: {
    totalBytes: number;
    freeBytes: number;
    processRssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
  };
  disk: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usedPercent: string;
    mount: string;
  } | null;
  nodeVersion: string;
}

export interface TaskCenterStatus {
  generatedAt: string;
  backup: BackupStatus & { nextWeeklyBackupAt: string | null };
  reports: {
    count: number;
    latestWeeklyReport: LearningReport | null;
    latestMonthlyReport: LearningReport | null;
    lastReportCheckAt: string | null;
  };
  dailyBrief: {
    latest: DailyBrief | null;
    nextDailyBriefAt: string | null;
    emailEnabled: boolean;
  };
  errorThemes: {
    job: ErrorThemeBatchJob | null;
    latestBatch: ErrorThemeAnalysis['latestBatch'];
    nextNightlyBatchAt: string | null;
    correctionCount: number;
    lastCorrectionAt: string | null;
  };
  embedding: EmbeddingStatus;
  data: {
    reviews: number;
    studyTimeRecords: number;
    revision: number;
  };
  runtime: RuntimeStatus;
  readOnly?: boolean;
}

export interface LearningReport {
  id?: number;
  kind: 'weekly' | 'monthly';
  title: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  updatedAt?: string;
  trigger?: 'auto' | 'manual';
  summary: {
    totalMinutes: number;
    studyDays: number;
    averageDailyMinutes: number;
    averageStudyDayMinutes: number;
    reviewCount: number;
    averageReviewScore: number | null;
    completedTasks: number;
    totalTasks: number;
    taskCompletionRate: number | null;
    waterCups: number;
    waterMl: number;
    examsCount: number;
    topProject: { name: string; minutes: number } | null;
    bestReview: { date: string; score: number; summary?: string } | null;
    lowestReview: { date: string; score: number; problems?: string } | null;
  };
  highlights: string[];
  suggestions: string[];
  commonProblems?: CommonProblemSummary[];
  dailyTotals: Array<{ date: string; minutes: number }>;
  projectTotals: Array<{ name: string; minutes: number }>;
  reviews: Array<{ date: string; score: number; summary: string; wins: string; problems: string; tomorrowPlan: string }>;
  exams: Array<{ date: string; subjectName: string; score: number; fullScore: number; paperName: string }>;
}

export interface ErrorThemeBatchResult {
  batchId: number;
  periodStart: string;
  periodEnd: string;
  reviewCount: number;
  occurrenceCount: number;
  rawCandidateCount: number;
  deduplicatedCount: number;
  themeCount: number;
  modelName: string;
  modelProfile?: EmbeddingModelProfile;
  source: string;
  backend: string;
  dimensions: number;
  embeddedSentenceCount: number;
  fallbackReason: string;
  completedAt: string;
}

export type EmbeddingModelProfile = 'small' | 'large' | 'rules';

export interface ErrorThemeBatchJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  periodStart: string;
  periodEnd: string;
  mode: string;
  trigger: string;
  modelProfile?: EmbeddingModelProfile;
  modelName?: string;
  startedAt: string;
  completedAt: string | null;
  result: ErrorThemeBatchResult | null;
  error: string;
}

export interface ErrorThemeOption {
  id: string;
  label: string;
}

export interface EmbeddingStatus {
  available: boolean;
  backend: string;
  modelName: string;
  modelProfile?: EmbeddingModelProfile;
  smallModelName?: string;
  largeModelName?: string;
  nightlyModelProfile?: EmbeddingModelProfile;
  manualModelProfile?: EmbeddingModelProfile;
  cacheDir: string;
  workerFile: string;
  python: string | null;
  error: string;
  embeddingRows: number;
  readOnly?: boolean;
}

export interface ErrorThemeAnalysis {
  periodStart: string;
  periodEnd: string;
  latestBatch: {
    id: number;
    source: string;
    modelName: string;
    periodStart: string;
    periodEnd: string;
    reviewCount: number;
    occurrenceCount: number;
    themeCount: number;
    status: string;
    createdAt: string;
    completedAt: string | null;
    note: string;
  } | null;
  summary: {
    occurrenceCount: number;
    themeCount: number;
    reviewDayCount: number;
    topTheme: ErrorThemeAnalysisTheme | null;
  };
  themes: ErrorThemeAnalysisTheme[];
  timeline: Array<{ date: string; count: number }>;
  readOnly?: boolean;
}

export interface ErrorThemeAnalysisTheme {
  id: number;
  normalizedLabel: string;
  label: string;
  occurrenceCount: number;
  reviewDayCount: number;
  averageConfidence: number;
  firstSeenAt: string;
  lastSeenAt: string;
  examples: Array<{ occurrenceId: number; date: string; field: string; evidence: string; confidence: number; source: string }>;
}

export interface ErrorThemeDetail {
  theme: {
    id: number;
    normalizedLabel: string;
    label: string;
    occurrenceCount: number;
    reviewDayCount: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  };
  periodStart: string;
  periodEnd: string;
  occurrences: Array<{
    occurrenceId: number;
    date: string;
    field: string;
    evidence: string;
    confidence: number;
    source: string;
    reviewId: number | null;
    summary: string;
    wins: string;
    problems: string;
    tomorrowPlan: string;
    score: number | null;
  }>;
  timeline: Array<{ date: string; count: number }>;
  byField: Array<{ field: string; count: number }>;
  repeatedWeeks: Array<{ week: string; count: number; startDate: string; endDate: string }>;
  readOnly?: boolean;
}

type ApiOptions = {
  method?: string;
  body?: unknown;
};

let stateCache: ServerState | null = null;
let statePromise: Promise<ServerState> | null = null;
let dashboardCache: DashboardData | null = null;
let dashboardPromise: Promise<DashboardData> | null = null;

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

export const notifyDataChanged = () => {
  stateCache = null;
  statePromise = null;
  dashboardCache = null;
  dashboardPromise = null;
  invalidateServerQueries();
  window.dispatchEvent(new Event('server-data-changed'));
};

function cachedState() {
  if (stateCache) return Promise.resolve(stateCache);
  statePromise ??= apiRequest<ServerState>('/state').then((state) => {
    stateCache = state;
    statePromise = null;
    return state;
  });
  return statePromise;
}

function cachedDashboard() {
  if (dashboardCache) return Promise.resolve(dashboardCache);
  dashboardPromise ??= apiRequest<DashboardData>('/dashboard').then((data) => {
    dashboardCache = data;
    dashboardPromise = null;
    return data;
  });
  return dashboardPromise;
}

export const serverApi = {
  getState: () => cachedState(),
  getDashboard: () => cachedDashboard(),
  getDashboardCharts: () => apiRequest<DashboardChartsData>('/dashboard/charts'),
  getGoals: () => apiRequest<ReferenceList<Goal>>('/goals'),
  getProjects: () => apiRequest<ReferenceList<StudyProject>>('/projects'),
  getSubjects: () => apiRequest<ReferenceList<Subject>>('/subjects'),
  getStudyTarget: () => apiRequest<StudyTargetSetting>('/settings/study-target'),
  saveStudyTarget: (targetHours: number) => apiRequest<StudyTargetSetting>('/settings/study-target', { method: 'POST', body: { targetHours } }),
  getBriefSettings: () => apiRequest<{ settings: DailyBriefSettings; readOnly?: boolean }>('/briefs/settings'),
  saveBriefSettings: (settings: DailyBriefSettings) => apiRequest<{ settings: DailyBriefSettings; readOnly?: boolean }>('/briefs/settings', { method: 'POST', body: settings }),
  getBriefs: (limit = 30) => apiRequest<{ briefs: DailyBrief[]; readOnly?: boolean }>(`/briefs?limit=${limit}`),
  getTodayBrief: () => apiRequest<{ brief: DailyBrief | null; latest: DailyBrief | null; readOnly?: boolean }>('/briefs/today'),
  generateBrief: (sendEmail = false) => apiRequest<{ ok: true; brief: DailyBrief }>('/briefs/generate', { method: 'POST', body: { sendEmail } }),
  sendLatestBrief: () => apiRequest<{ ok: true; brief: DailyBrief }>('/briefs/send-latest', { method: 'POST' }),
  getReviews: (from?: string, to?: string, limit?: number, offset?: number) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    const query = params.toString();
    return apiRequest<ReviewsResponse>(`/reviews${query ? `?${query}` : ''}`);
  },
  getStudyRecordsByDate: (date: string) => apiRequest<{ records: StudyTimeRecord[]; readOnly?: boolean }>(`/study-records?date=${encodeURIComponent(date)}`),
  getStatisticsSummary: () => apiRequest<StatisticsSummary>('/statistics/summary'),
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
  runServerBackup: () => apiRequest<{ ok: true; backup: { kind: string; filePath: string; createdAt: string } }>('/backups/run', { method: 'POST' }),
  restoreServerBackup: (fileName: string) => apiRequest<{ ok: true; restoredFrom: string }>('/backups/restore', { method: 'POST', body: { fileName } }),
  getTaskCenterStatus: () => apiRequest<TaskCenterStatus>('/tasks/status'),
  getReports: () => apiRequest<{ reports: LearningReport[] }>('/reports'),
  generateReport: (kind: 'weekly' | 'monthly', period: 'current' | 'previous' = 'current') =>
    apiRequest<{ ok: true; report: LearningReport }>('/reports/generate', { method: 'POST', body: { kind, period } }),
  getErrorThemeAnalysis: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString();
    return apiRequest<ErrorThemeAnalysis>(`/error-themes/analysis${query ? `?${query}` : ''}`);
  },
  getEmbeddingStatus: () => apiRequest<EmbeddingStatus>('/error-themes/embedding/status'),
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
