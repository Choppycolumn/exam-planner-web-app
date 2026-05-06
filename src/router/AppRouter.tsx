import { createBrowserRouter } from 'react-router-dom';
import { Layout } from '../app/Layout';
import { DashboardPage } from '../pages/DashboardPage';
import { GoalsPage } from '../pages/GoalsPage';
import { StudyTimePage } from '../pages/StudyTimePage';
import { ReviewsPage } from '../pages/ReviewsPage';
import { ReviewInsightsPage } from '../pages/ReviewInsightsPage';
import { StatisticsPage } from '../pages/StatisticsPage';
import { MockExamsPage } from '../pages/MockExamsPage';
import { SettingsPage } from '../pages/SettingsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'goals', element: <GoalsPage /> },
      { path: 'study-time', element: <StudyTimePage /> },
      { path: 'reviews', element: <ReviewsPage /> },
      { path: 'review-insights', element: <ReviewInsightsPage /> },
      { path: 'statistics', element: <StatisticsPage /> },
      { path: 'mock-exams', element: <MockExamsPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);
