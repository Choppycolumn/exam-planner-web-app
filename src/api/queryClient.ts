import { QueryClient } from '@tanstack/react-query';

function shouldRetryQuery(failureCount: number, error: unknown) {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: number }).status) : 0;
  if ([401, 403, 404].includes(status)) return false;
  return failureCount < 1;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 90_000,
      gcTime: 15 * 60_000,
      retry: shouldRetryQuery,
      refetchOnWindowFocus: false,
    },
  },
});

export const queryKeys = {
  all: ['server'] as const,
  session: ['server', 'session'] as const,
  state: ['server', 'state'] as const,
  dashboard: ['server', 'dashboard'] as const,
  dashboardCharts: ['server', 'dashboard', 'charts'] as const,
  goals: ['server', 'goals'] as const,
  projects: ['server', 'projects'] as const,
  subjects: ['server', 'subjects'] as const,
  studyTarget: ['server', 'settings', 'study-target'] as const,
  briefSettings: ['server', 'briefs', 'settings'] as const,
  briefs: ['server', 'briefs'] as const,
  todayBrief: ['server', 'briefs', 'today'] as const,
  statistics: ['server', 'statistics'] as const,
  taskCenter: ['server', 'task-center'] as const,
  learningProgress: ['server', 'learning-progress'] as const,
  studyComparison: (days: number = 30) => ['server', 'study-comparison', days] as const,
  focusTimer: (userId: number) => ['server', 'focus-timer', userId] as const,
  projectProgress: ['server', 'project-progress'] as const,
  visitStats: ['server', 'visit-stats'] as const,
  opsLogs: ['server', 'ops-logs'] as const,
  notifications: (status = 'all') => ['server', 'notifications', status] as const,
  calendar: (from: string, to: string) => ['server', 'calendar', from, to] as const,
  problemInbox: (status: string = 'open') => ['server', 'problem-inbox', status] as const,
  reviewPrefill: (date: string) => ['server', 'reviews', 'prefill', date] as const,
  reviewTrend: (days: number = 30) => ['server', 'reviews', 'trend', days] as const,
  reports: ['server', 'reports'] as const,
  errorThemes: (from?: string, to?: string) => ['server', 'error-themes', from ?? '', to ?? ''] as const,
  errorThemeDetail: (themeId: number, from?: string, to?: string) => ['server', 'error-themes', 'detail', themeId, from ?? '', to ?? ''] as const,
  embeddingStatus: ['server', 'error-themes', 'embedding-status'] as const,
  errorThemeOptions: ['server', 'error-themes', 'options'] as const,
  errorThemeBatchStatus: ['server', 'error-themes', 'batch-status'] as const,
  reviews: (from?: string, to?: string, limit?: number, offset?: number) => ['server', 'reviews', from ?? '', to ?? '', limit ?? 0, offset ?? 0] as const,
  studyRecords: (date: string) => ['server', 'study-records', date] as const,
  mockExams: (subjectId: number | 'all', limit: number, offset: number) => ['server', 'mock-exams', subjectId, limit, offset] as const,
  seatAssistantStatus: ['server', 'seat-assistant', 'status'] as const,
  seatAssistantProfile: ['server', 'seat-assistant', 'profile'] as const,
  seatAssistantSession: ['server', 'seat-assistant', 'session'] as const,
  seatAssistantObservations: (limit = 20) => ['server', 'seat-assistant', 'observations', limit] as const,
  seatAssistantHistory: (limit = 50) => ['server', 'seat-assistant', 'history', limit] as const,
};

export function invalidateServerQueries(keys: readonly (readonly unknown[])[] = [queryKeys.state, queryKeys.dashboard]) {
  for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
}
