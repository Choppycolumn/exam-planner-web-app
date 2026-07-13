import type { Goal, MockExamRecord, ShortTermTask, StudyProject, StudyTimeRecord, Subject, DailyReview, WaterIntakeRecord } from '../types/models';
import type { CommonProblemSummary } from '../types/reports';

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

export interface AccountSession {
  userId: number;
  displayName: string;
  accountType: 'admin' | 'learner' | 'visitor';
  role: 'write' | 'read';
  maxUsers: 2;
  userCount: number;
  canAddUser: boolean;
  capabilities: string[];
}

export interface StudyComparisonAccount {
  userId: number;
  displayName: string;
  accountType: 'admin' | 'learner';
  todayMinutes: number;
  weekMinutes: number;
  monthMinutes: number;
  totalMinutes: number;
  studyDays: number;
  streakDays: number;
}

export interface StudyComparisonResponse {
  generatedAt: string;
  today: string;
  periodStart: string;
  periodEnd: string;
  maxUsers: 2;
  accounts: StudyComparisonAccount[];
  daily: Array<{ date: string; users: Record<string, number> }>;
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
  englishWritingPlan?: EnglishWritingPlanForDate;
  startupPlan?: DashboardStartupPlan;
  reminders?: DashboardReminder[];
  activityCalendar?: DashboardActivityDay[];
  errorThemeWall?: DashboardErrorThemeWallItem[];
  breakGuard?: BreakGuardSummary;
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

export interface BreakGuardSummary {
  date: string;
  breakCount: number;
  completedBreakCount: number;
  timeoutWarningCount: number;
  unfocusedCount: number;
  completedLessonCount: number;
  scheduleLagCount: number;
  lunchCount: number;
  dinnerCount: number;
  latest: Array<{
    id: number;
    eventType: string;
    label: string;
    status: string;
    note: string;
    overdueSeconds: number;
    createdAt: string;
  }>;
}

export interface BreakGuardScheduleConfig {
  dailyLessons: number;
  lessonMinutes: number;
  breakMinutes: number;
  dayStart: string;
  lagGraceMinutes: number;
  lagRepeatMinutes: number;
  lessonProjects: number[];
}

export interface BreakGuardProject {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
}

export interface BreakGuardScheduleResponse {
  config: BreakGuardScheduleConfig;
  projects: BreakGuardProject[];
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
  unfinishedTasks: Array<{ id: number; title: string; dueDate: string; dueTime?: string; urgency: string }>;
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
  taskReminders: {
    enabled: boolean;
    count: number;
    offsetsMinutes: number[];
  };
  customWeeklyPush: {
    enabled: boolean;
    days: Record<'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday', string>;
  };
  englishWritingPlan: EnglishWritingPlanSettings;
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

export type WeekdayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface EnglishWritingPlanStage {
  id: string;
  name: string;
  weeks: string;
  focus: string;
}

export interface EnglishWritingPlanSettings {
  enabled: boolean;
  showOnDashboard: boolean;
  includeInBrief: boolean;
  dailyMinutes: string;
  currentStageId: string;
  stages: EnglishWritingPlanStage[];
  weeklyTasks: Record<WeekdayKey, string>;
}

export interface EnglishWritingPlanForDate extends EnglishWritingPlanSettings {
  date: string;
  weekday: WeekdayKey;
  weekdayLabel: string;
  currentStage: EnglishWritingPlanStage | null;
  todayTask: string;
  hasTodayTask: boolean;
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
    customWeeklyPush?: {
      enabled: boolean;
      date: string;
      weekday: string;
      weekdayLabel: string;
      content: string;
      hasContent: boolean;
    };
    englishWritingPlan?: EnglishWritingPlanForDate;
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
    indexPurchaseAssessment?: {
      methodology: string;
      disclaimer: string;
      items: Array<{
        ok: boolean;
        name: string;
        symbol: string;
        asOf?: string;
        source?: string;
        pe?: number;
        peRangeLow?: number;
        peRangeHigh?: number;
        pePercentile5?: number;
        pePercentile10?: number;
        valuation?: string;
        sma50Margin?: number;
        sma200Margin?: number;
        score?: number;
        signal?: string;
        intensity?: string;
        reasons?: string[];
        error?: string;
      }>;
    };
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
  latestVerification?: { ok: boolean | null; checkedAt: string; fileName: string; integrity: string };
  lastDailyBackupAt: string | null;
  lastWeeklyBackupAt: string | null;
  dictionaryCount: number;
  dictionaryIndexedAt: string | null;
}

export interface MihomoNode {
  name: string;
  type: string;
  udp: boolean;
  delay: number | null;
  alive: boolean | null;
}

export interface MihomoSettingsResponse {
  ok: boolean;
  installed: boolean;
  active: boolean;
  version: string;
  controllerOk: boolean;
  controllerUrl: string;
  localProxyUrl: string;
  subscriptionConfigured: boolean;
  subscriptionLabel: string;
  providerMode: '' | 'http' | 'file';
  current: string;
  nodes: MihomoNode[];
  error: string;
  restarted?: boolean;
  selected?: string;
  imported?: boolean;
  message?: string;
  updatedAt?: string;
}

export interface MihomoTestResponse {
  ok: boolean;
  testedAt: string;
  results: Array<{ id: string; label: string; ok: boolean; status: number; durationMs: number; sample?: string; error?: string }>;
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
  accountType?: 'admin' | 'learner' | 'visitor';
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
  errorCount: number;
  warningCount: number;
  action?: string;
}

export interface OpsLogSummaryResponse {
  generatedAt: string;
  sources: OpsLogSource[];
  auditEvents?: Array<{ action: string; actorRole: string; detail: Record<string, unknown>; createdAt: string }>;
  slowApi?: Array<{ method: string; path: string; statusCode: number; durationMs: number; error: string; createdAt: string }>;
  clientErrors?: {
    metrics: {
      total: number;
      last24h: number;
      last7d: number;
      latestAt: string | null;
      bySource: Array<{ source: string; count: number }>;
    };
    latest: Array<{ source: string; path: string; message: string; role: string; createdAt: string }>;
  };
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
  status: 'notified' | string;
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
  acceptedAt?: string | null;
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
  bark?: {
    enabled: boolean;
    configured: boolean;
    serverUrl: string;
    deviceKeyMasked: string;
  };
  telegram?: {
    configured: boolean;
    tokenConfigured: boolean;
    tokenLast4: string;
    chatIdConfigured: boolean;
    chatIdLast4: string;
    allowedUserIdConfigured: boolean;
    allowedUserIdLast4: string;
    webhookUrl: string;
    webhookConfigured: boolean;
  };
  events: NotificationEvent[];
  deliveries: NotificationDelivery[];
  metrics: { total: number; open: number; warnings: number; critical: number };
  notificationSemantics?: { reply: string; proactive: string };
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
  unifiedHealth?: {
    status: 'normal' | 'degraded' | 'failed';
    summary: string;
    actions: Array<{ id: string; level: 'degraded' | 'failed'; title: string; action: string }>;
  };
  externalApis?: {
    cacheEntries: number;
    openCircuits: Array<{ key: string; failures: number; openUntil: string }>;
  };
  backup: BackupStatus & { nextDailyBackupAt: string | null; nextWeeklyBackupAt: string | null };
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
    taskReminders?: DailyBriefSettings['taskReminders'];
    nextTaskReminderScanAt?: string | null;
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
