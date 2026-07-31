import { createHash, randomBytes } from 'node:crypto';
import { defaultCapabilitiesForRole } from './capabilities.mjs';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

function requireUserId(value) {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId < 1) throw new Error('valid session userId is required');
  return userId;
}

function mapSession(row, capabilities) {
  if (!row) return null;
  return {
    sessionId: Number(row.sessionId),
    userId: Number(row.userId),
    publicId: row.publicId || '',
    displayName: row.displayName,
    accountType: row.accountType,
    userRole: row.userRole,
    role: row.role,
    sessionVersion: Number(row.sessionVersion || 1),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    capabilities,
  };
}

export function createSessionRepository(database, { ttlMs = SESSION_TTL_MS } = {}) {
  const touchCache = new Map();

  function create(session, { clientHash = '' } = {}) {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    database.execute(`INSERT INTO user_sessions(
token_hash,user_id,role,account_type,display_name_snapshot,session_version,
created_at,last_seen_at,expires_at,client_hash
) VALUES(?,?,?,?,?,?,?,?,?,?);`, [
      tokenHash,
      requireUserId(session.userId),
      session.role === 'read' ? 'read' : 'write',
      session.accountType || 'member',
      String(session.displayName || ''),
      Number(session.sessionVersion || 1),
      createdAt,
      createdAt,
      expiresAt,
      String(clientHash || ''),
    ]);
    return token;
  }

  function find(token) {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = database.json(`SELECT s.id AS sessionId,s.user_id AS userId,
COALESCE(a.public_id,'') AS publicId,
COALESCE(a.display_name,s.display_name_snapshot) AS displayName,
s.account_type AS accountType,s.role,s.session_version AS sessionVersion,
s.created_at AS createdAt,s.expires_at AS expiresAt,
COALESCE(a.role,CASE WHEN s.account_type='visitor' THEN 'visitor' ELSE 'member' END) AS userRole,
a.session_version AS currentSessionVersion,a.status AS accountStatus
FROM user_sessions s
LEFT JOIN user_accounts a ON a.id=s.user_id
WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>datetime('now')
LIMIT 1;`, [tokenHash])[0];
    if (!row) return null;
    if (row.accountStatus && row.accountStatus !== 'active') return null;
    if (row.currentSessionVersion && Number(row.currentSessionVersion) !== Number(row.sessionVersion)) return null;
    const lastTouchedAt = touchCache.get(tokenHash) || 0;
    if (Date.now() - lastTouchedAt > 5 * 60 * 1000) {
      database.execute('UPDATE user_sessions SET last_seen_at=datetime(\'now\') WHERE id=?;', [row.sessionId]);
      touchCache.set(tokenHash, Date.now());
    }
    const capabilityRole = row.userRole || 'member';
    const capabilityRows = row.accountType === 'visitor' ? [] : database.json(
      'SELECT capability,enabled FROM user_capabilities WHERE user_id=? ORDER BY capability;',
      [Number(row.userId)],
    );
    const capabilities = capabilityRows.length
      ? capabilityRows.filter((item) => Boolean(item.enabled)).map((item) => item.capability)
      : defaultCapabilitiesForRole(capabilityRole);
    return mapSession(row, capabilities);
  }

  function revoke(token) {
    if (!token) return false;
    const result = database.execute(`UPDATE user_sessions SET revoked_at=datetime('now')
WHERE token_hash=? AND revoked_at IS NULL;`, [hashToken(token)]);
    return Number(result.changes || 0) > 0;
  }

  function revokeUser(userId) {
    database.execute(`UPDATE user_sessions SET revoked_at=datetime('now')
WHERE user_id=? AND revoked_at IS NULL;`, [Number(userId)]);
    database.execute('UPDATE user_accounts SET session_version=session_version+1,updated_at=datetime(\'now\') WHERE id=?;', [Number(userId)]);
  }

  function cleanup() {
    database.execute(`DELETE FROM user_sessions
WHERE expires_at<datetime('now','-7 days') OR revoked_at<datetime('now','-7 days');`);
  }

  return { create, find, revoke, revokeUser, cleanup, hashToken };
}
