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
  startupPlan?: DashboardStartupPlan;
  reminders?: DashboardReminder[];
  activityCalendar?: DashboardActivityDay[];
  errorThemeWall?: DashboardErrorThemeWallItem[];
  readOnly?: boolean;
}

export interface DashboardStartupPlan {
  stage: { label: string; tone: 'slate' | 'emerald' | 'blue' | 'amber' | 'rose'; hint: string };
  primaryTask: ShortTermTask | null;
  dailyTargetMinutes: number;
  checklist?: string[];
  firstSession: string;
}

export interface DashboardReminder {
  id: string;
  tone: 'slate' | 'emerald' | 'blue' | 'amber' | 'rose';
  title: string;
  detail: string;
}

export interface DashboardActivityDay {
  date: string;
  minutes: number;
  reviewScore: number | null;
  hasReview: boolean;
  waterCups: number;
  waterTargetCups: number;
  taskTotal: number;
  taskCompleted: number;
}

export interface DashboardErrorThemeWallItem {
  id: number;
  normalizedLabel: string;
  label: string;
  occurrenceCount: number;
  reviewDayCount: number;
  lastSeenAt: string;
}

export interface ReviewTrendResponse {
  periodStart: string;
  periodEnd: string;
  days: number;
  trend: Array<{ date: string; score: number | null }>;
  precomputedAt?: string;
  readOnly?: boolean;
}

export interface ProblemInboxItem {
  id: number;
  date: string;
  text: string;
  status: 'open' | 'resolved';
  source: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface ReviewPrefill {
  date: string;
  totalMinutes: number;
  topProject: { name: string; minutes: number } | null;
  unfinishedTasks: Array<{ id: number; title: string; dueDate: string; urgency: string }>;
  water: { cups: number; cupMl: number; targetCups: number };
  problemInboxItems: ProblemInboxItem[];
  previousTomorrowPlan: string;
  suggestedSummary: string;
  suggestedProblems: string;
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
  marketSymbolsText: string;
  nextDailyBriefAt?: string | null;
  wechat: {
    enabled: boolean;
  };
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

export interface LearningProgressSummary {
  today: string;
  current7Minutes: number;
  previous7Minutes: number;
  current30Minutes: number;
  studyStreakDays: number;
  targetHitDays: number;
  targetDays: number;
  averageReviewScore: number | null;
  reviewCount: number;
  completedTasks: number;
  totalTasks: number;
  taskCompletionRate: number | null;
  topProject: { name: string; minutes: number } | null;
}

export interface LearningProgressResponse {
  summary: LearningProgressSummary;
  daily: Array<{ date: string; minutes: number; reviewScore: number | null; targetMinutes: number; hitTarget: boolean }>;
  projectTotals: Array<{ name: string; minutes: number }>;
  reviewTrend: Array<{ date: string; score: number | null }>;
  readOnly?: boolean;
}

export interface ProjectProgressResponse {
  generatedAt: string;
  items: Array<{
    id: number;
    name: string;
    color: string;
    isActive: boolean;
    totalMinutes: number;
    last30Minutes: number;
    last7Minutes: number;
    lastStudiedAt: string | null;
    recordCount: number;
    sharePercent: number;
    momentum: 'up' | 'flat' | 'down';
  }>;
  totals: {
    totalMinutes: number;
    activeProjects: number;
    inactiveProjects: number;
    topProject: { name: string; minutes: number } | null;
  };
  daily: Array<{ date: string; minutes: number }>;
  readOnly?: boolean;
}

export interface VisitStatsResponse {
  generatedAt: string;
  total: number;
  today: number;
  last7: number;
  uniqueVisitors7: number;
  daily: Array<{ date: string; visits: number; uniqueVisitors: number }>;
  topPaths: Array<{ path: string; visits: number }>;
  latest: Array<{ path: string; role: string; userAgent: string; createdAt: string }>;
  readOnly?: boolean;
}

export interface OpsLogSource {
  name: string;
  available: boolean;
  error?: string;
  lines: string[];
  errorCount: number;
  warningCount: number;
}

export interface OpsLogSummaryResponse {
  generatedAt: string;
  sources: OpsLogSource[];
  auditEvents?: Array<{ action: string; actorRole: string; detail: Record<string, unknown>; createdAt: string }>;
  slowApi?: Array<{ method: string; path: string; statusCode: number; durationMs: number; error: string; createdAt: string }>;
  apiMetrics?: {
    logged: number;
    serverErrors: number;
    clientErrors: number;
    averageDurationMs: number | null;
    maxDurationMs: number | null;
    slowest: Array<{ method: string; path: string; statusCode: number; durationMs: number; createdAt: string }>;
  };
  readOnly?: boolean;
}

export interface NotificationChannel {
  id: number;
  channelKey: string;
  type: 'in_app' | 'email' | 'telegram' | 'wecom_webhook' | 'webhook' | string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationEvent {
  id: number;
  eventKey: string;
  source: string;
  severity: 'info' | 'warning' | 'critical' | string;
  title: string;
  content: string;
  status: 'open' | 'acknowledged' | string;
  scheduledAt: string | null;
  acknowledgedAt: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDelivery {
  id: number;
  eventId: number;
  channelKey: string;
  channelType: string;
  status: string;
  attemptedAt: string | null;
  deliveredAt: string | null;
  error: string;
  createdAt: string;
  updatedAt: string;
  response?: Record<string, unknown>;
}

export interface NotificationCenterResponse {
  generatedAt: string;
  channels: NotificationChannel[];
  channelReadiness?: Array<{ channelKey: string; type: string; ready: boolean; requiredEnv: string[] }>;
  wechatClawbot?: {
    enabled: boolean;
    configured: boolean;
    channel: string;
    accountId: string;
    accountDirExists: boolean;
    accountFileExists: boolean;
    targetConfigured: boolean;
    hasContextToken: boolean;
    cli: string;
    nextPushAt: string | null;
    scheduleTime: string;
  };
  events: NotificationEvent[];
  deliveries: NotificationDelivery[];
  metrics: { total: number; open: number; warnings: number; critical: number };
  channelPlan: Record<string, { enabled: boolean; requiredEnv: string[]; method: string }>;
  readOnly?: boolean;
}

export interface CalendarEventItem {
  id: string;
  date: string;
  type: 'study' | 'review' | 'task' | 'report' | 'notification' | string;
  title: string;
  detail: string;
  tone: 'slate' | 'emerald' | 'blue' | 'amber' | 'rose' | string;
  value: number | string | null;
}

export interface CalendarResponse {
  generatedAt: string;
  from?: string;
  to?: string;
  events: CalendarEventItem[];
  readOnly?: boolean;
}

export interface TaskRunSummary {
  id: number;
  taskName: string;
  trigger: string;
  status: 'running' | 'completed' | 'failed' | string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string;
  metadata?: Record<string, unknown>;
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
  maintenance: {
    lastAt: string | null;
    lastKind: string | null;
    lastError: string;
    nextMaintenanceAt: string | null;
    lastPrecomputeAt?: string | null;
    lastPrecomputeTrigger?: string | null;
    lastPrecomputeError?: string;
  };
  data: {
    reviews: number;
    studyTimeRecords: number;
    revision: number;
  };
  tasks?: {
    active: string[];
    latestRuns: TaskRunSummary[];
    metrics?: {
      total: number;
      running: number;
      completed: number;
      failed: number;
      last24h: number;
      averageDurationMs: number | null;
      maxDurationMs: number | null;
      byName: Array<{ taskName: string; total: number; failed: number; lastStartedAt: string | null; averageDurationMs: number | null }>;
    };
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
  precomputedAt?: string;
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

export interface LibraryBook {
  id: number;
  title: string;
  author: string;
  category: string;
  tags: string[];
  originalFileName: string;
  fileType: 'pdf' | 'epub' | 'txt' | 'md' | string;
  mimeType: string;
  fileSize: number;
  textStatus: 'pending' | 'processing' | 'ready' | 'empty' | 'failed' | string;
  textError: string;
  pageCount: number | null;
  chapterCount: number | null;
  progressPercent: number;
  lastLocator: string;
  lastOpenedAt: string | null;
  isFavorite: boolean;
  isArchived: boolean;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryNote {
  id: number;
  bookId: number;
  locator: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryBookmark {
  id: number;
  bookId: number;
  pageNumber: number;
  title: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryTextChunk {
  id: number;
  bookId: number;
  chunkIndex: number;
  locator: string;
  title: string;
  text: string;
  createdAt: string;
}

export interface LibraryBookDetail {
  book: LibraryBook;
  notes: LibraryNote[];
  bookmarks: LibraryBookmark[];
  chunkCount: number;
  readOnly?: boolean;
}

export interface LibraryBooksResponse {
  items: LibraryBook[];
  categories: Array<{ category: string; count: number }>;
  readOnly?: boolean;
}

export interface LibraryTextResponse {
  chunks: LibraryTextChunk[];
  total: number;
  limit: number;
  offset: number;
}

export interface LibrarySearchResponse {
  results: Array<{ book: LibraryBook; matchType: 'metadata' | 'text' | 'note' | string; snippet: string; locator: string }>;
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
const shortApiCache = new Map<string, { expiresAt: number; value: unknown }>();

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: options.body ? { accept: 'application/json', 'content-type': 'application/json' } : { accept: 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text || `Request failed with ${response.status}`;
    try {
      const payload = JSON.parse(text) as { error?: string; message?: string };
      message = payload.error || payload.message || message;
    } catch {
      // Non-JSON server errors still surface as plain text for debugging.
    }
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return response.json() as Promise<T>;
}

export const notifyDataChanged = () => {
  stateCache = null;
  statePromise = null;
  dashboardCache = null;
  dashboardPromise = null;
  shortApiCache.clear();
  invalidateServerQueries();
  window.dispatchEvent(new Event('server-data-changed'));
};

function cachedApiRequest<T>(path: string, ttlMs = 60_000): Promise<T> {
  const key = `GET:${path}`;
  const cached = shortApiCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value as T);
  return apiRequest<T>(path).then((value) => {
    shortApiCache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  });
}

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

function uploadLibraryBook(formData: FormData, onProgress?: (percent: number) => void) {
  return new Promise<{ ok: true; detail: LibraryBookDetail }>((resolveUpload, rejectUpload) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/library/upload');
    request.withCredentials = true;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        try {
          resolveUpload(JSON.parse(request.responseText) as { ok: true; detail: LibraryBookDetail });
        } catch (error) {
          rejectUpload(error);
        }
        return;
      }
      rejectUpload(new Error(request.responseText || `Upload failed: ${request.status}`));
    };
    request.onerror = () => rejectUpload(new Error('Upload failed'));
    request.send(formData);
  });
}

export const serverApi = {
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
  runServerBackup: () => apiRequest<{ ok: true; backup: { kind: string; filePath: string; createdAt: string } }>('/backups/run', { method: 'POST' }),
  restoreServerBackup: (fileName: string) => apiRequest<{ ok: true; restoredFrom: string }>('/backups/restore', { method: 'POST', body: { fileName } }),
  getTaskCenterStatus: () => cachedApiRequest<TaskCenterStatus>('/tasks/status', 20_000),
  getLearningProgress: () => cachedApiRequest<LearningProgressResponse>('/learning-progress', 60_000),
  getProjectProgress: () => cachedApiRequest<ProjectProgressResponse>('/project-progress', 60_000),
  getVisitStats: () => cachedApiRequest<VisitStatsResponse>('/visits/summary', 30_000),
  getOpsLogsSummary: () => apiRequest<OpsLogSummaryResponse>('/ops/logs/summary'),
  getNotificationCenter: (status: 'all' | 'open' | 'acknowledged' = 'all') =>
    cachedApiRequest<NotificationCenterResponse>(`/notifications/center?status=${encodeURIComponent(status)}`, 20_000),
  acknowledgeNotification: (id: number) => apiRequest<{ ok: true; center: NotificationCenterResponse }>('/notifications/ack', { method: 'POST', body: { id } }),
  testWechatNotification: () => apiRequest<{ ok: boolean; digest: { text: string }; delivery: Record<string, unknown>; center: NotificationCenterResponse }>('/notifications/wechat/test', { method: 'POST', body: {} }),
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
  getLibraryBooks: (params?: { search?: string; category?: string; sort?: string; archived?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.category) query.set('category', params.category);
    if (params?.sort) query.set('sort', params.sort);
    if (params?.archived) query.set('archived', '1');
    const suffix = query.toString();
    return cachedApiRequest<LibraryBooksResponse>(`/library/books${suffix ? `?${suffix}` : ''}`, 45_000);
  },
  getLibraryBook: (id: number) => apiRequest<LibraryBookDetail>(`/library/books/${id}`),
  getLibraryText: (id: number, offset = 0, limit = 120) =>
    cachedApiRequest<LibraryTextResponse>(`/library/books/${id}/text?offset=${offset}&limit=${limit}`, 90_000),
  searchLibrary: (query: string) => cachedApiRequest<LibrarySearchResponse>(`/library/search?q=${encodeURIComponent(query)}`, 45_000),
  uploadLibraryBook,
  saveLibraryBook: (book: Partial<LibraryBook> & { id: number }) =>
    apiRequest<{ ok: true; book: LibraryBook }>('/library/books/save', { method: 'POST', body: book }),
  removeLibraryBook: (id: number) => apiRequest<{ ok: true }>('/library/books/remove', { method: 'POST', body: { id } }),
  saveLibraryProgress: (payload: { bookId: number; locator?: string; progressPercent?: number }) =>
    apiRequest<{ ok: true; updatedAt: string }>('/library/progress', { method: 'POST', body: payload }),
  saveLibraryNote: (payload: { id?: number; bookId: number; locator?: string; title?: string; content: string }) =>
    apiRequest<{ ok: true; id: number }>('/library/notes/save', { method: 'POST', body: payload }),
  saveLibraryBookmark: (payload: { id?: number; bookId: number; pageNumber: number; title?: string; note?: string }) =>
    apiRequest<{ ok: true; id: number }>('/library/bookmarks/save', { method: 'POST', body: payload }),
  removeLibraryBookmark: (id: number) => apiRequest<{ ok: true }>('/library/bookmarks/remove', { method: 'POST', body: { id } }),
  libraryFileUrl: (id: number) => `/api/library/books/${id}/file`,
  reset: () => apiRequest<void>('/reset', { method: 'POST' }),
};
