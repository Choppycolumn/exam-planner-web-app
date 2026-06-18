import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 90_000,
      gcTime: 15 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const queryKeys = {
  all: ['server'] as const,
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
  studyPetToday: (date?: string) => ['server', 'study-pet', 'today', date ?? ''] as const,
  studyPetStats: (startDate?: string, endDate?: string) => ['server', 'study-pet', 'stats', startDate ?? '', endDate ?? ''] as const,
  taskCenter: ['server', 'task-center'] as const,
  learningProgress: ['server', 'learning-progress'] as const,
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
  libraryBooks: (search = '', category = '', sort = 'recent') => ['server', 'library', 'books', search, category, sort] as const,
  libraryBook: (id: number) => ['server', 'library', 'book', id] as const,
  libraryText: (id: number, offset = 0, limit = 120) => ['server', 'library', 'text', id, offset, limit] as const,
  librarySearch: (query: string) => ['server', 'library', 'search', query] as const,
  reviews: (from?: string, to?: string, limit?: number, offset?: number) => ['server', 'reviews', from ?? '', to ?? '', limit ?? 0, offset ?? 0] as const,
  studyRecords: (date: string) => ['server', 'study-records', date] as const,
  mockExams: (subjectId: number | 'all', limit: number, offset: number) => ['server', 'mock-exams', subjectId, limit, offset] as const,
};

export function invalidateServerQueries() {
  void queryClient.invalidateQueries({ queryKey: queryKeys.all });
}
