import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { defaultCapabilitiesForRole } from './capabilities.mjs';
import { hashPassword, verifyPassword } from './password-hash.mjs';

function normalizeDisplayName(value, fallback = '学习伙伴') {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  return normalized || fallback;
}

function hashOpaqueToken(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function tableExists(connection, table) {
  return Boolean(connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1;").get(table));
}

function publicAccount(row, capabilities = []) {
  if (!row) return null;
  const role = row.role || 'member';
  const active = (row.status || (row.isActive ? 'active' : 'disabled')) === 'active';
  return {
    id: Number(row.id),
    userId: Number(row.id),
    publicId: row.publicId || '',
    accountType: row.accountType,
    displayName: row.displayName,
    role: row.accountType === 'visitor' ? 'read' : 'write',
    userRole: role,
    status: active ? 'active' : 'disabled',
    isActive: active,
    sessionVersion: Number(row.sessionVersion || 1),
    capabilities: [...capabilities],
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt || null,
  };
}

export function createUserAccountRepository(database, { maxUsers = 10 } = {}) {
  const safeMaxUsers = Math.max(1, Math.min(100, Number(maxUsers) || 10));
  const accountSelect = `SELECT id,public_id AS publicId,account_type AS accountType,
display_name AS displayName,role,status,is_active AS isActive,
session_version AS sessionVersion,created_at AS createdAt,last_login_at AS lastLoginAt
FROM user_accounts`;

  function getCapabilities(userId, role = 'member') {
    const rows = database.json(`SELECT capability,enabled FROM user_capabilities
WHERE user_id=? ORDER BY capability;`, [Number(userId)]);
    if (!rows.length) return defaultCapabilitiesForRole(role);
    return rows.filter((row) => Boolean(row.enabled)).map((row) => row.capability);
  }

  function hydrate(row) {
    if (!row) return null;
    return publicAccount(row, getCapabilities(row.id, row.role));
  }

  const listAccounts = ({ includeDisabled = false } = {}) => database.json(`${accountSelect}
${includeDisabled ? '' : "WHERE status='active' AND is_active=1"}
ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END,id;`).map(hydrate);

  const countAccounts = () => Number(database.scalar('SELECT COUNT(*) FROM user_accounts;') || 0);

  const canCreateMember = () => countAccounts() < safeMaxUsers;
  const canCreateLearner = canCreateMember;

  function getAccount(id, { includeDisabled = false } = {}) {
    const row = database.json(`${accountSelect}
WHERE id=? ${includeDisabled ? '' : "AND status='active' AND is_active=1"} LIMIT 1;`, [Number(id)])[0];
    return hydrate(row);
  }

  function getOwnerAccount() {
    if (!tableExists(database.open(), 'user_accounts')) return null;
    const row = database.json(`${accountSelect} WHERE role='owner' ORDER BY id LIMIT 1;`)[0];
    return hydrate(row);
  }

  function findOwnerUserId() {
    const userId = Number(getOwnerAccount()?.userId);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
  }

  function getOwnerUserId() {
    const userId = findOwnerUserId();
    if (!userId) throw new Error('owner account is missing');
    return userId;
  }

  function ensureAdminCredential(appPassword) {
    const password = String(appPassword || '');
    if (!password) return false;
    const owner = database.json(`${accountSelect} WHERE role='owner' ORDER BY id LIMIT 1;`)[0];
    if (!owner) throw new Error('owner account is missing');
    const exists = Number(database.scalar('SELECT COUNT(*) FROM user_credentials WHERE user_id=?;', [owner.id]) || 0);
    if (exists) return false;
    const passwordHash = hashPassword(password);
    database.execute(`INSERT INTO user_credentials(user_id,password_hash,algorithm,password_changed_at)
VALUES(?,?,?,datetime('now'));`, [owner.id, passwordHash, 'scrypt']);
    database.execute('UPDATE user_accounts SET password_hash=?,updated_at=datetime(\'now\') WHERE id=?;', [passwordHash, owner.id]);
    return true;
  }

  function authenticateAccount(accountId, password) {
    const identifier = String(accountId || '').trim();
    if (!identifier || !password) return null;
    const numericId = /^\d+$/.test(identifier) ? Number(identifier) : 0;
    const row = database.json(`SELECT a.id,a.public_id AS publicId,a.account_type AS accountType,
a.display_name AS displayName,a.role,a.status,a.is_active AS isActive,
a.session_version AS sessionVersion,a.created_at AS createdAt,a.last_login_at AS lastLoginAt,
c.password_hash AS passwordHash
FROM user_accounts a
JOIN user_credentials c ON c.user_id=a.id
WHERE (a.id=? OR a.public_id=?) AND a.status='active' AND a.is_active=1
LIMIT 1;`, [numericId, identifier])[0];
    if (!row || !verifyPassword(password, row.passwordHash)) return null;
    database.execute('UPDATE user_accounts SET last_login_at=datetime(\'now\'),updated_at=datetime(\'now\') WHERE id=?;', [row.id]);
    return hydrate(row);
  }

  function authenticateLearner(password) {
    const rows = database.json(`SELECT a.id,a.public_id AS publicId,a.account_type AS accountType,
a.display_name AS displayName,a.role,a.status,a.is_active AS isActive,
a.session_version AS sessionVersion,a.created_at AS createdAt,a.last_login_at AS lastLoginAt,
c.password_hash AS passwordHash
FROM user_accounts a JOIN user_credentials c ON c.user_id=a.id
WHERE a.role='member' AND a.status='active' AND a.is_active=1 ORDER BY a.id;`);
    const row = rows.find((candidate) => verifyPassword(password, candidate.passwordHash));
    return row ? hydrate(row) : null;
  }

  function passwordInUse(connection, password) {
    return connection.prepare('SELECT password_hash AS passwordHash FROM user_credentials;').all()
      .some((row) => verifyPassword(password, row.passwordHash));
  }

  function seedMemberData(connection, userId, now) {
    const sourceProjects = connection.prepare(`SELECT name,color,sort_order AS sortOrder
FROM study_projects WHERE user_id=(SELECT id FROM user_accounts WHERE role='owner' ORDER BY id LIMIT 1)
AND is_active=1 ORDER BY sort_order,id;`).all();
    let nextProjectId = Number(connection.prepare('SELECT COALESCE(MAX(id),0)+1 AS id FROM study_projects;').get()?.id || 1);
    const insertProject = connection.prepare(`INSERT INTO study_projects
(id,name,color,is_active,sort_order,schema_version,created_at,updated_at,user_id)
VALUES(?,?,?,1,?,1,?,?,?);`);
    sourceProjects.forEach((project, index) => {
      insertProject.run(nextProjectId++, project.name, project.color, Number(project.sortOrder || index + 1), now, now, userId);
    });
    connection.prepare(`INSERT OR IGNORE INTO user_study_settings(user_id,target_minutes,updated_at)
VALUES(?,0,?);`).run(userId, now);
    if (tableExists(connection, 'focus_timer_settings')) {
      connection.prepare(`INSERT OR IGNORE INTO focus_timer_settings(user_id,focus_minutes,break_minutes,updated_at)
VALUES(?,50,10,?);`).run(userId, now);
    }
  }

  function insertMember(connection, { password, displayName, createdByUserId }) {
    const accountCount = Number(connection.prepare('SELECT COUNT(*) AS count FROM user_accounts;').get()?.count || 0);
    if (accountCount >= safeMaxUsers) {
      const error = new Error('用户数量已达到上限');
      error.code = 'USER_LIMIT_REACHED';
      error.statusCode = 409;
      throw error;
    }
    if (passwordInUse(connection, password)) {
      const error = new Error('该密码已被其他账户使用');
      error.code = 'PASSWORD_IN_USE';
      error.statusCode = 409;
      throw error;
    }
    const now = new Date().toISOString();
    const userId = Number(connection.prepare('SELECT COALESCE(MAX(id),0)+1 AS id FROM user_accounts;').get()?.id || 2);
    const memberNumber = Number(connection.prepare("SELECT COUNT(*) AS count FROM user_accounts WHERE role='member';").get()?.count || 0) + 1;
    const name = normalizeDisplayName(displayName, memberNumber === 1 ? '学习伙伴' : `学习伙伴 ${memberNumber}`);
    const passwordHash = hashPassword(password);
    connection.prepare(`INSERT INTO user_accounts
(id,account_type,display_name,password_hash,is_active,created_at,updated_at,public_id,role,status,session_version,last_login_at)
VALUES(?,'learner',?,?,1,?,?,?,'member','active',1,NULL);`).run(
      userId, name, passwordHash, now, now, randomUUID(),
    );
    connection.prepare(`INSERT INTO user_credentials(user_id,password_hash,algorithm,password_changed_at)
VALUES(?,?,?,?);`).run(userId, passwordHash, 'scrypt', now);
    for (const capability of defaultCapabilitiesForRole('member')) {
      connection.prepare(`INSERT INTO user_capabilities(user_id,capability,enabled,updated_at)
VALUES(?,?,1,?);`).run(userId, capability, now);
    }
    for (const capability of ['settings.manage', 'operations.manage', 'notifications.manage', 'brief.manage', 'break_guard.sync', 'users.manage', 'data.import']) {
      connection.prepare(`INSERT INTO user_capabilities(user_id,capability,enabled,updated_at)
VALUES(?,?,0,?);`).run(userId, capability, now);
    }
    seedMemberData(connection, userId, now);
    return { userId, createdByUserId };
  }

  function createMember({ password, displayName, createdByUserId = getOwnerUserId() }) {
    const db = database.open();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const { userId } = insertMember(db, { password, displayName, createdByUserId });
      db.exec('COMMIT;');
      return getAccount(userId);
    } catch (error) {
      try { db.exec('ROLLBACK;'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  function createLearner(password, displayName = '') {
    return createMember({ password, displayName, createdByUserId: getOwnerUserId() });
  }

  function createInvite({ createdByUserId, displayName = '', expiresInHours = 24 }) {
    if (!canCreateMember()) {
      const error = new Error('用户数量已达到上限');
      error.code = 'USER_LIMIT_REACHED';
      throw error;
    }
    const token = randomBytes(24).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + Math.max(1, Math.min(168, Number(expiresInHours) || 24)) * 60 * 60 * 1000).toISOString();
    database.execute(`INSERT INTO user_invites(
token_hash,created_by_user_id,display_name,role,expires_at,created_at
) VALUES(?,?,?,'member',?,?);`, [
      hashOpaqueToken(token), Number(createdByUserId), normalizeDisplayName(displayName, ''), expiresAt, now.toISOString(),
    ]);
    return { token, expiresAt, displayName: normalizeDisplayName(displayName, '') };
  }

  function listInvites() {
    return database.json(`SELECT id,display_name AS displayName,role,expires_at AS expiresAt,
used_at AS usedAt,revoked_at AS revokedAt,created_at AS createdAt
FROM user_invites ORDER BY id DESC LIMIT 30;`).map((row) => ({ ...row, id: Number(row.id) }));
  }

  function consumeInvite({ token, password, displayName = '' }) {
    const db = database.open();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const invite = db.prepare(`SELECT id,created_by_user_id AS createdByUserId,display_name AS displayName
FROM user_invites
WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>datetime('now')
LIMIT 1;`).get(hashOpaqueToken(token));
      if (!invite) {
        const error = new Error('邀请码无效或已过期');
        error.code = 'INVALID_INVITE';
        error.statusCode = 400;
        throw error;
      }
      const { userId } = insertMember(db, {
        password,
        displayName: displayName || invite.displayName,
        createdByUserId: invite.createdByUserId,
      });
      db.prepare(`UPDATE user_invites SET used_at=datetime('now'),used_by_user_id=? WHERE id=?;`).run(userId, invite.id);
      db.exec('COMMIT;');
      return getAccount(userId);
    } catch (error) {
      try { db.exec('ROLLBACK;'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  function revokeInvite(inviteId) {
    return Number(database.execute(`UPDATE user_invites SET revoked_at=datetime('now')
WHERE id=? AND used_at IS NULL AND revoked_at IS NULL;`, [Number(inviteId)]).changes || 0) > 0;
  }

  function updateAccount(userId, { displayName, status }) {
    const current = getAccount(userId, { includeDisabled: true });
    if (!current) {
      const error = new Error('用户不存在');
      error.statusCode = 404;
      throw error;
    }
    if (current.userRole === 'owner' && status === 'disabled') {
      const error = new Error('不能停用主管理员账户');
      error.code = 'OWNER_REQUIRED';
      error.statusCode = 409;
      throw error;
    }
    const nextName = normalizeDisplayName(displayName, current.displayName);
    const nextStatus = status === 'disabled' ? 'disabled' : 'active';
    database.execute(`UPDATE user_accounts
SET display_name=?,status=?,is_active=?,updated_at=datetime('now'),
session_version=CASE WHEN status<>? THEN session_version+1 ELSE session_version END
WHERE id=?;`, [nextName, nextStatus, nextStatus === 'active' ? 1 : 0, nextStatus, Number(userId)]);
    if (nextStatus === 'disabled') {
      database.execute("UPDATE user_sessions SET revoked_at=datetime('now') WHERE user_id=? AND revoked_at IS NULL;", [Number(userId)]);
    }
    return getAccount(userId, { includeDisabled: true });
  }

  function resetPassword(userId, password) {
    const account = getAccount(userId, { includeDisabled: true });
    if (!account) {
      const error = new Error('用户不存在');
      error.statusCode = 404;
      throw error;
    }
    const connection = database.open();
    if (passwordInUse(connection, password)) {
      const error = new Error('该密码已被其他账户使用');
      error.code = 'PASSWORD_IN_USE';
      error.statusCode = 409;
      throw error;
    }
    const passwordHash = hashPassword(password);
    database.execute(`INSERT INTO user_credentials(user_id,password_hash,algorithm,password_changed_at)
VALUES(?,?,?,datetime('now'))
ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash,
algorithm=excluded.algorithm,password_changed_at=excluded.password_changed_at;`, [Number(userId), passwordHash, 'scrypt']);
    database.execute(`UPDATE user_accounts SET password_hash=?,session_version=session_version+1,
updated_at=datetime('now') WHERE id=?;`, [passwordHash, Number(userId)]);
    database.execute("UPDATE user_sessions SET revoked_at=datetime('now') WHERE user_id=? AND revoked_at IS NULL;", [Number(userId)]);
    return true;
  }

  function revokeSessions(userId) {
    database.execute("UPDATE user_sessions SET revoked_at=datetime('now') WHERE user_id=? AND revoked_at IS NULL;", [Number(userId)]);
    database.execute("UPDATE user_accounts SET session_version=session_version+1,updated_at=datetime('now') WHERE id=?;", [Number(userId)]);
  }

  return {
    maxUsers: safeMaxUsers,
    listAccounts,
    countAccounts,
    canCreateMember,
    canCreateLearner,
    getAccount,
    getOwnerAccount,
    findOwnerUserId,
    getOwnerUserId,
    getCapabilities,
    ensureAdminCredential,
    authenticateAccount,
    authenticateLearner,
    createMember,
    createLearner,
    createInvite,
    listInvites,
    consumeInvite,
    revokeInvite,
    updateAccount,
    resetPassword,
    revokeSessions,
  };
}
