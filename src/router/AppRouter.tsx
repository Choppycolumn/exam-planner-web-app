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

function RouteFallback() {
  return (
    <div className="card p-5 text-sm text-slate-500">
      页面加载中...
    </div>
  );
}

function lazyElement(element: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

function SessionIndex() {
  const { data, isLoading } = useAccountSession();
  if (isLoading) return <RouteFallback />;
  return data?.accountType === 'learner' ? <Navigate to="/study-time" replace /> : <DashboardPage />;
}

function AdminOnlyRoute({ children }: { children: ReactNode }) {
  const { data, isLoading } = useAccountSession();
  if (isLoading) return <RouteFallback />;
  return data?.accountType === 'learner' ? <Navigate to="/study-time" replace /> : children;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <SessionIndex /> },
      { path: 'goals', element: <AdminOnlyRoute>{lazyElement(<GoalsPage />)}</AdminOnlyRoute> },
      { path: 'study-time', element: lazyElement(<StudyTimePage />) },
      { path: 'reviews', element: <AdminOnlyRoute>{lazyElement(<ReviewsPage />)}</AdminOnlyRoute> },
      { path: 'review-insights', element: <AdminOnlyRoute>{lazyElement(<ReviewInsightsPage />)}</AdminOnlyRoute> },
      { path: 'progress', element: lazyElement(<LearningProgressPage />) },
      { path: 'study-comparison', element: lazyElement(<StudyComparisonPage />) },
      { path: 'project-progress', element: <Navigate to="/" replace /> },
      { path: 'goal-review', element: <AdminOnlyRoute>{lazyElement(<GoalReviewPage />)}</AdminOnlyRoute> },
      { path: 'calendar', element: <AdminOnlyRoute>{lazyElement(<CalendarPage />)}</AdminOnlyRoute> },
      { path: 'notifications', element: <Navigate to="/" replace /> },
      { path: 'market-copilot', element: <Navigate to="/" replace /> },
      { path: 'task-center', element: <Navigate to="/operations" replace /> },
      { path: 'operations', element: <AdminOnlyRoute>{lazyElement(<OperationsPage />)}</AdminOnlyRoute> },
      { path: 'mock-exams', element: <AdminOnlyRoute>{lazyElement(<MockExamsPage />)}</AdminOnlyRoute> },
      { path: 'confusing-words', element: <AdminOnlyRoute>{lazyElement(<ConfusingWordsPage />)}</AdminOnlyRoute> },
      { path: 'library', element: <Navigate to="/" replace /> },
      { path: 'library/:id/read', element: <Navigate to="/" replace /> },
      { path: 'settings', element: <AdminOnlyRoute>{lazyElement(<SettingsPage />)}</AdminOnlyRoute> },
      { path: 'migrate-local-data', element: <AdminOnlyRoute>{lazyElement(<MigrateLocalDataPage />)}</AdminOnlyRoute> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
