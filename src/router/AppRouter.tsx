/* eslint-disable react-refresh/only-export-components -- Router config intentionally defines lazy route elements beside the exported router. */
import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { Layout } from '../app/Layout';
import { DashboardPage } from '../pages/DashboardPage';
import { routeLoaders } from './preload';

const GoalsPage = lazy(() => routeLoaders.goals().then((module) => ({ default: module.GoalsPage })));
const StudyTimePage = lazy(() => routeLoaders.studyTime().then((module) => ({ default: module.StudyTimePage })));
const ReviewsPage = lazy(() => routeLoaders.reviews().then((module) => ({ default: module.ReviewsPage })));
const ReviewInsightsPage = lazy(() => routeLoaders.reviewInsights().then((module) => ({ default: module.ReviewInsightsPage })));
const StatisticsPage = lazy(() => routeLoaders.statistics().then((module) => ({ default: module.StatisticsPage })));
const ReportsPage = lazy(() => routeLoaders.reports().then((module) => ({ default: module.ReportsPage })));
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

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'goals', element: lazyElement(<GoalsPage />) },
      { path: 'study-time', element: lazyElement(<StudyTimePage />) },
      { path: 'reviews', element: lazyElement(<ReviewsPage />) },
      { path: 'review-insights', element: lazyElement(<ReviewInsightsPage />) },
      { path: 'statistics', element: lazyElement(<StatisticsPage />) },
      { path: 'reports', element: lazyElement(<ReportsPage />) },
      { path: 'mock-exams', element: lazyElement(<MockExamsPage />) },
      { path: 'confusing-words', element: lazyElement(<ConfusingWordsPage />) },
      { path: 'settings', element: lazyElement(<SettingsPage />) },
      { path: 'migrate-local-data', element: lazyElement(<MigrateLocalDataPage />) },
    ],
  },
]);
