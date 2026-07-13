const LEARNER_GET_PATHS = new Set([
  '/api/session',
  '/api/projects',
  '/api/settings/study-target',
  '/api/statistics/summary',
  '/api/learning-progress',
  '/api/study-comparison',
]);

const LEARNER_POST_PATHS = new Set([
  '/api/client-errors',
  '/api/projects/save',
  '/api/projects/remove',
  '/api/settings/study-target',
  '/api/study-records/save-day',
]);

export function learnerCanAccess(method, pathname) {
  if (method === 'GET' && pathname.startsWith('/api/study-records')) return true;
  if (method === 'GET') return LEARNER_GET_PATHS.has(pathname);
  if (method === 'POST') return LEARNER_POST_PATHS.has(pathname);
  return false;
}
