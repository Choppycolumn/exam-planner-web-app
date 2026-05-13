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
  distribution: Array<{ name: string; value: number }>;
  trend: Array<{ date: string; minutes: number }>;
  latestExam: MockExamRecord | null;
  todayReview: DailyReview | null;
  yesterdayReview: DailyReview | null;
  visibleTasks: ShortTermTask[];
  todayWaterRecord: WaterIntakeRecord | null;
  readOnly?: boolean;
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
  themeCount: number;
  modelName: string;
  source: string;
  backend: string;
  dimensions: number;
  embeddedSentenceCount: number;
  fallbackReason: string;
  completedAt: string;
}

export interface EmbeddingStatus {
  available: boolean;
  backend: string;
  modelName: string;
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
  examples: Array<{ date: string; field: string; evidence: string; confidence: number }>;
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
  getGoals: () => apiRequest<ReferenceList<Goal>>('/goals'),
  getProjects: () => apiRequest<ReferenceList<StudyProject>>('/projects'),
  getSubjects: () => apiRequest<ReferenceList<Subject>>('/subjects'),
  getStudyTarget: () => apiRequest<StudyTargetSetting>('/settings/study-target'),
  saveStudyTarget: (targetHours: number) => apiRequest<StudyTargetSetting>('/settings/study-target', { method: 'POST', body: { targetHours } }),
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
  runErrorThemeBatch: (from?: string, to?: string, mode: 'embedding' | 'rules' = 'embedding') =>
    apiRequest<{ ok: true; result: ErrorThemeBatchResult; analysis: ErrorThemeAnalysis }>('/error-themes/batch/run', { method: 'POST', body: { from, to, mode } }),
  reset: () => apiRequest<void>('/reset', { method: 'POST' }),
};
