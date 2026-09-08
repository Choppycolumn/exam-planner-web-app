/* eslint-disable react-refresh/only-export-components -- Router config intentionally defines lazy route elements beside the exported router. */
import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { Navigate, createBrowserRouter } from 'react-router-dom';
import { Layout } from '../app/Layout';
import { DashboardPage } from '../pages/DashboardPage';
import { routeLoaders } from './preload';
import { useAccountSession } from '../hooks/useAccountSession';

const GoalsPage = lazy(() => routeLoaders.goals().then((module) => ({ default: module.GoalsPage })));
const StudyTimePage = lazy(() => routeLoaders.studyTime().then((module) => ({ default: module.StudyTimePage })));
const FocusTimerPage = lazy(() => routeLoaders.focusTimer().then((module) => ({ default: module.FocusTimerPage })));
const ReviewsPage = lazy(() => routeLoaders.reviews().then((module) => ({ default: module.ReviewsPage })));
const ReviewInsightsPage = lazy(() => routeLoaders.reviewInsights().then((module) => ({ default: module.ReviewInsightsPage })));
const LearningProgressPage = lazy(() => routeLoaders.progress().then((module) => ({ default: module.LearningProgressPage })));
const StudyComparisonPage = lazy(() => routeLoaders.studyComparison().then((module) => ({ default: module.StudyComparisonPage })));
const GoalReviewPage = lazy(() => routeLoaders.goalReview().then((module) => ({ default: module.GoalReviewPage })));
const CalendarPage = lazy(() => routeLoaders.calendar().then((module) => ({ default: module.CalendarPage })));
const OperationsPage = lazy(() => routeLoaders.operations().then((module) => ({ default: module.OperationsPage })));
const MockExamsPage = lazy(() => routeLoaders.mockExams().then((module) => ({ default: module.MockExamsPage })));
const ConfusingWordsPage = lazy(() => routeLoaders.confusingWords().then((module) => ({ default: module.ConfusingWordsPage })));
const SettingsPage = lazy(() => routeLoaders.settings().then((module) => ({ default: module.SettingsPage })));
const MigrateLocalDataPage = lazy(() => routeLoaders.migrateLocalData().then((module) => ({ default: module.MigrateLocalDataPage })));
const SeatAssistantPage = lazy(() => routeLoaders.seatAssistant().then((module) => ({ default: module.SeatAssistantPage })));

function RouteFallback() {
  return (
    <div className="card p-5 text-sm text-secondary">
      页面加载中...
    </div>
  );
}

function lazyElement(element: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

function SessionIndex() {
  const { isLoading } = useAccountSession();
  if (isLoading) return <RouteFallback />;
  return <DashboardPage />;
}

function CapabilityRoute({ capability, children }: { capability: string; children: ReactNode }) {
  const { data, isLoading } = useAccountSession();
  if (isLoading) return <RouteFallback />;
  return data?.capabilities?.includes(capability) ? children : <Navigate to="/study-time" replace />;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <SessionIndex /> },
      { path: 'goals', element: lazyElement(<GoalsPage />) },
      { path: 'study-time', element: lazyElement(<StudyTimePage />) },
      { path: 'focus-timer', element: <CapabilityRoute capability="focus_timer.use">{lazyElement(<FocusTimerPage />)}</CapabilityRoute> },
      { path: 'reviews', element: lazyElement(<ReviewsPage />) },
      { path: 'review-insights', element: lazyElement(<ReviewInsightsPage />) },
      { path: 'progress', element: lazyElement(<LearningProgressPage />) },
      { path: 'study-comparison', element: lazyElement(<StudyComparisonPage />) },
      { path: 'project-progress', element: <Navigate to="/" replace /> },
      { path: 'goal-review', element: lazyElement(<GoalReviewPage />) },
      { path: 'calendar', element: lazyElement(<CalendarPage />) },
      { path: 'notifications', element: <Navigate to="/" replace /> },
      { path: 'market-copilot', element: <Navigate to="/" replace /> },
      { path: 'task-center', element: <Navigate to="/operations" replace /> },
      { path: 'operations', element: <CapabilityRoute capability="operations.manage">{lazyElement(<OperationsPage />)}</CapabilityRoute> },
      { path: 'mock-exams', element: lazyElement(<MockExamsPage />) },
      { path: 'confusing-words', element: lazyElement(<ConfusingWordsPage />) },
      { path: 'library', element: <Navigate to="/" replace /> },
      { path: 'library/:id/read', element: <Navigate to="/" replace /> },
      { path: 'settings', element: <CapabilityRoute capability="settings.manage">{lazyElement(<SettingsPage />)}</CapabilityRoute> },
      { path: 'migrate-local-data', element: <CapabilityRoute capability="data.import">{lazyElement(<MigrateLocalDataPage />)}</CapabilityRoute> },
      { path: 'seat-assistant', element: <CapabilityRoute capability="seat_assistant.manage">{lazyElement(<SeatAssistantPage />)}</CapabilityRoute> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
