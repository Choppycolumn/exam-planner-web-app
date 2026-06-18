export const routeLoaders = {
  goals: () => import('../pages/GoalsPage'),
  studyTime: () => import('../pages/StudyTimePage'),
  reviews: () => import('../pages/ReviewsPage'),
  reviewInsights: () => import('../pages/ReviewInsightsPage'),
  progress: () => import('../pages/LearningProgressPage'),
  studyPetStats: () => import('../pages/StudyPetStatsPage'),
  projectProgress: () => import('../pages/ProjectProgressPage'),
  goalReview: () => import('../pages/GoalReviewPage'),
  notifications: () => import('../pages/NotificationsPage'),
  operations: () => import('../pages/OperationsPage'),
  mockExams: () => import('../pages/MockExamsPage'),
  confusingWords: () => import('../pages/ConfusingWordsPage'),
  library: () => import('../pages/LibraryPage'),
  libraryReader: () => import('../pages/LibraryReaderPage'),
  settings: () => import('../pages/SettingsPage'),
  migrateLocalData: () => import('../pages/MigrateLocalDataPage'),
  dashboardCharts: () => import('../components/DashboardCharts'),
};

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

export function preloadSecondaryRoutes() {
  const win = window as IdleWindow;
  const loaders = [
    routeLoaders.dashboardCharts,
    routeLoaders.studyTime,
    routeLoaders.reviews,
    routeLoaders.progress,
    routeLoaders.studyPetStats,
    routeLoaders.projectProgress,
    routeLoaders.goalReview,
    routeLoaders.notifications,
    routeLoaders.mockExams,
    routeLoaders.confusingWords,
    routeLoaders.library,
    routeLoaders.reviewInsights,
    routeLoaders.settings,
    routeLoaders.goals,
    routeLoaders.operations,
    routeLoaders.migrateLocalData,
  ];

  const run = () => {
    loaders.forEach((loader, index) => {
      window.setTimeout(() => {
        void loader().catch(() => undefined);
      }, index * 220);
    });
  };

  if (win.requestIdleCallback) {
    const idleId = win.requestIdleCallback(run, { timeout: 1800 });
    return () => win.cancelIdleCallback?.(idleId);
  }

  const timeoutId = window.setTimeout(run, 800);
  return () => window.clearTimeout(timeoutId);
}
