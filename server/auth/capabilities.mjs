import { findApiContract } from '../../shared/api-contracts.js';

export const CAPABILITIES = Object.freeze({
  STUDY: 'study.use',
  COMPARISON: 'comparison.view',
  FOCUS_TIMER: 'focus_timer.use',
  SETTINGS: 'settings.manage',
  OPERATIONS: 'operations.manage',
  NOTIFICATIONS: 'notifications.manage',
  BRIEF: 'brief.manage',
  BREAK_GUARD: 'break_guard.sync',
  USERS: 'users.manage',
  DATA_IMPORT: 'data.import',
});

export const MEMBER_CAPABILITIES = Object.freeze([
  CAPABILITIES.STUDY,
  CAPABILITIES.COMPARISON,
  CAPABILITIES.FOCUS_TIMER,
]);

export const OWNER_CAPABILITIES = Object.freeze(Object.values(CAPABILITIES));
export const VISITOR_CAPABILITIES = Object.freeze([
  CAPABILITIES.STUDY,
  CAPABILITIES.COMPARISON,
]);

export function defaultCapabilitiesForRole(role) {
  if (role === 'owner') return [...OWNER_CAPABILITIES];
  if (role === 'visitor') return [...VISITOR_CAPABILITIES];
  return [...MEMBER_CAPABILITIES];
}

export function hasCapability(session, capability) {
  return Boolean(session?.capabilities?.includes(capability));
}

const PREFIX_POLICIES = [
  ['/api/settings/', CAPABILITIES.SETTINGS],
  ['/api/backups/', CAPABILITIES.OPERATIONS],
  ['/api/maintenance/', CAPABILITIES.OPERATIONS],
  ['/api/operations', CAPABILITIES.OPERATIONS],
  ['/api/ops/', CAPABILITIES.OPERATIONS],
  ['/api/visits/', CAPABILITIES.OPERATIONS],
  ['/api/tasks/status', CAPABILITIES.OPERATIONS],
  ['/api/notifications/', CAPABILITIES.NOTIFICATIONS],
  ['/api/briefs', CAPABILITIES.BRIEF],
  ['/api/break-guard/', CAPABILITIES.BREAK_GUARD],
  ['/api/users', CAPABILITIES.USERS],
  ['/api/focus-timer', CAPABILITIES.FOCUS_TIMER],
  ['/api/study-comparison', CAPABILITIES.COMPARISON],
];

export function requiredCapability(method, pathname) {
  const matchedContract = findApiContract(method, pathname);
  if (matchedContract) return matchedContract[1].capability;
  if (pathname === '/api/session' || pathname === '/api/client-errors') return null;
  if (pathname === '/api/import' || pathname === '/api/reset') return CAPABILITIES.DATA_IMPORT;
  if (pathname === '/api/settings/study-target') return CAPABILITIES.STUDY;
  if (pathname === '/api/settings/brief') return CAPABILITIES.BRIEF;
  const match = PREFIX_POLICIES.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix));
  if (match) return match[1];
  if (pathname.startsWith('/api/')) return CAPABILITIES.STUDY;
  return null;
}

export function canAccessApi(session, method, pathname) {
  if (!session) return false;
  const capability = requiredCapability(method, pathname);
  if (!capability) return true;
  if (!hasCapability(session, capability)) return false;
  if (session.role === 'read' && method !== 'GET') return false;
  return true;
}
