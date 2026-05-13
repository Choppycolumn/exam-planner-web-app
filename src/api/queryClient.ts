import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const queryKeys = {
  all: ['server'] as const,
  state: ['server', 'state'] as const,
  dashboard: ['server', 'dashboard'] as const,
  goals: ['server', 'goals'] as const,
  projects: ['server', 'projects'] as const,
  subjects: ['server', 'subjects'] as const,
  studyTarget: ['server', 'settings', 'study-target'] as const,
  statistics: ['server', 'statistics'] as const,
  reports: ['server', 'reports'] as const,
  errorThemes: (from?: string, to?: string) => ['server', 'error-themes', from ?? '', to ?? ''] as const,
  reviews: (from?: string, to?: string, limit?: number, offset?: number) => ['server', 'reviews', from ?? '', to ?? '', limit ?? 0, offset ?? 0] as const,
  studyRecords: (date: string) => ['server', 'study-records', date] as const,
  mockExams: (subjectId: number | 'all', limit: number, offset: number) => ['server', 'mock-exams', subjectId, limit, offset] as const,
};

export function invalidateServerQueries() {
  void queryClient.invalidateQueries({ queryKey: queryKeys.all });
}
