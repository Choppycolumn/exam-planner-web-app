export const routeLoaders = {
  goals: () => import('../pages/GoalsPage'),
  studyTime: () => import('../pages/StudyTimePage'),
  focusTimer: () => import('../pages/FocusTimerPage'),
  reviews: () => import('../pages/ReviewsPage'),
  reviewInsights: () => import('../pages/ReviewInsightsPage'),
  progress: () => import('../pages/LearningProgressPage'),
  studyComparison: () => import('../pages/StudyComparisonPage'),
  goalReview: () => import('../pages/GoalReviewPage'),
  calendar: () => import('../pages/CalendarPage'),
  operations: () => import('../pages/OperationsPage'),
  mockExams: () => import('../pages/MockExamsPage'),
  confusingWords: () => import('../pages/ConfusingWordsPage'),
  settings: () => import('../pages/SettingsPage'),
  migrateLocalData: () => import('../pages/MigrateLocalDataPage'),
  dashboardCharts: () => import('../components/DashboardCharts'),
};

const pathLoaders: Record<string, () => Promise<unknown>> = {
  '/goals': routeLoaders.goals,
  '/study-time': routeLoaders.studyTime,
  '/focus-timer': routeLoaders.focusTimer,
  '/reviews': routeLoaders.reviews,
  '/review-insights': routeLoaders.reviewInsights,
  '/progress': routeLoaders.progress,
  '/study-comparison': routeLoaders.studyComparison,
  '/goal-review': routeLoaders.goalReview,
  '/calendar': routeLoaders.calendar,
  '/operations': routeLoaders.operations,
  '/mock-exams': routeLoaders.mockExams,
  '/confusing-words': routeLoaders.confusingWords,
  '/settings': routeLoaders.settings,
  '/migrate-local-data': routeLoaders.migrateLocalData,
};

export function preloadRoute(path: string) {
  void pathLoaders[path]?.().catch(() => undefined);
}
