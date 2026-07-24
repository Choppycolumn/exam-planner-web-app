const LEARNER_GET_PATHS = new Set([
  '/api/session',
  '/api/dashboard',
  '/api/dashboard/charts',
  '/api/goals',
  '/api/projects',
  '/api/subjects',
  '/api/settings/study-target',
  '/api/statistics/summary',
  '/api/learning-progress',
  '/api/project-progress',
  '/api/study-comparison',
  '/api/focus-timer',
  '/api/error-themes/embedding/status',
  '/api/error-themes/options',
  '/api/error-themes/batch/status',
  '/api/reports',
]);

const LEARNER_POST_PATHS = new Set([
  '/api/client-errors',
  '/api/goals/save',
  '/api/goals/activate',
  '/api/goals/remove',
  '/api/projects/save',
  '/api/projects/remove',
  '/api/subjects/save',
  '/api/subjects/remove',
  '/api/exams/save',
  '/api/exams/remove',
  '/api/tasks/save',
  '/api/tasks/remove',
  '/api/tasks/toggle',
  '/api/water/save',
  '/api/problem-inbox/save',
  '/api/problem-inbox/status',
  '/api/problem-inbox/remove',
  '/api/problem-inbox/resolve-date',
  '/api/reviews/upsert',
  '/api/settings/study-target',
  '/api/study-records/save-day',
  '/api/reports/generate',
  '/api/focus-timer/action',
]);

export function learnerCanAccess(method, pathname) {
  if (method === 'GET' && pathname.startsWith('/api/study-records')) return true;
  if (method === 'GET' && pathname.startsWith('/api/reviews')) return true;
  if (method === 'GET' && pathname.startsWith('/api/problem-inbox')) return true;
  if (method === 'GET' && pathname.startsWith('/api/mock-exams')) return true;
  if (method === 'GET' && pathname.startsWith('/api/error-themes/analysis')) return true;
  if (method === 'GET' && pathname.startsWith('/api/error-themes/detail')) return true;
  if (method === 'GET' && pathname.startsWith('/api/calendar')) return true;
  if (method === 'GET') return LEARNER_GET_PATHS.has(pathname);
  if (method === 'POST') return LEARNER_POST_PATHS.has(pathname);
  return false;
}
