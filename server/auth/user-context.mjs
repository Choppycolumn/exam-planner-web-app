import { hasCapability } from './capabilities.mjs';

export function createUserContext(session) {
  if (!session) return null;
  const userId = Number(session.userId);
  if (!Number.isInteger(userId) || userId < 1) return null;
  return Object.freeze({
    userId,
    publicId: String(session.publicId || ''),
    displayName: String(session.displayName || ''),
    accountType: session.accountType,
    role: session.role,
    capabilities: Object.freeze([...(session.capabilities || [])]),
    can: (capability) => hasCapability(session, capability),
  });
}

export function requireUserContext(session) {
  const context = createUserContext(session);
  if (!context) {
    const error = new Error('Unauthorized');
    error.statusCode = 401;
    throw error;
  }
  return context;
}

export function requireCapability(context, capability) {
  if (!context?.can(capability)) {
    const error = new Error('该账户无权访问此功能');
    error.statusCode = 403;
    throw error;
  }
  return context;
}
