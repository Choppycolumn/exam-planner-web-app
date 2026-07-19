import { hashPassword, verifyPassword } from './password-hash.mjs';

function publicAccount(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: Number(row.id),
    accountType: row.accountType,
    displayName: row.displayName,
    role: row.accountType === 'admin' ? 'write' : 'write',
    isActive: Boolean(row.isActive),
    createdAt: row.createdAt,
  };
}

export function createUserAccountRepository(database, { maxUsers = 3 } = {}) {
  const accountSelect = `SELECT id, account_type AS accountType, display_name AS displayName,
password_hash AS passwordHash, is_active AS isActive, created_at AS createdAt
FROM user_accounts`;

  const listAccounts = () => database.json(`${accountSelect}
WHERE is_active = 1 ORDER BY id;`).map(publicAccount);

  const countAccounts = () => Number(database.scalar(
    'SELECT COUNT(*) FROM user_accounts WHERE is_active = 1;',
  ) || 0);

  const canCreateLearner = () => {
    const learnerCount = Number(database.scalar(
      "SELECT COUNT(*) FROM user_accounts WHERE account_type = 'learner' AND is_active = 1;",
    ) || 0);
    return learnerCount < Math.max(0, maxUsers - 1) && countAccounts() < maxUsers;
  };

  const getAccount = (id) => publicAccount(database.json(`${accountSelect}
WHERE id = ? AND is_active = 1 LIMIT 1;`, [Number(id)])[0]);

  const authenticateLearner = (password) => {
    const rows = database.json(`${accountSelect}
WHERE account_type = 'learner' AND is_active = 1 ORDER BY id;`);
    const row = rows.find((candidate) => verifyPassword(password, candidate.passwordHash));
    return row ? publicAccount(row) : null;
  };

  const createLearner = (password) => {
    const db = database.open();
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const activeCount = Number(db.prepare('SELECT COUNT(*) AS count FROM user_accounts WHERE is_active = 1;').get()?.count || 0);
      const activeLearners = db.prepare("SELECT id, password_hash AS passwordHash FROM user_accounts WHERE account_type = 'learner' AND is_active = 1 ORDER BY id;").all();
      if (activeLearners.length >= Math.max(0, maxUsers - 1) || activeCount >= maxUsers) {
        const error = new Error('用户数量已达到上限');
        error.code = 'USER_LIMIT_REACHED';
        throw error;
      }
      if (activeLearners.some((learner) => verifyPassword(password, learner.passwordHash))) {
        const error = new Error('该密码已被其他学习用户使用');
        error.code = 'PASSWORD_IN_USE';
        throw error;
      }

      const userId = Number(db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM user_accounts;').get()?.id || 2);
      const learnerNumber = activeLearners.length + 1;
      const displayName = learnerNumber === 1 ? '学习伙伴' : `学习伙伴 ${learnerNumber}`;

      db.prepare(`INSERT INTO user_accounts
(id, account_type, display_name, password_hash, is_active, created_at, updated_at)
VALUES (?, 'learner', ?, ?, 1, ?, ?);`).run(userId, displayName, hashPassword(password), now, now);

      const sourceProjects = db.prepare(`SELECT name, color, sort_order AS sortOrder
FROM study_projects WHERE user_id = 1 AND is_active = 1 ORDER BY sort_order, id;`).all();
      let nextProjectId = Number(db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM study_projects;').get()?.id || 0) + 1;
      const insertProject = db.prepare(`INSERT INTO study_projects
(id, name, color, is_active, sort_order, schema_version, created_at, updated_at, user_id)
VALUES (?, ?, ?, 1, ?, 1, ?, ?, ?);`);
      sourceProjects.forEach((project, index) => {
        insertProject.run(nextProjectId++, project.name, project.color, Number(project.sortOrder || index + 1), now, now, userId);
      });
      db.prepare(`INSERT OR IGNORE INTO user_study_settings (user_id, target_minutes, updated_at)
VALUES (?, 0, ?);`).run(userId, now);
      db.exec('COMMIT;');
      return getAccount(userId);
    } catch (error) {
      try { db.exec('ROLLBACK;'); } catch { /* preserve the original error */ }
      throw error;
    }
  };

  return {
    maxUsers,
    listAccounts,
    countAccounts,
    canCreateLearner,
    getAccount,
    authenticateLearner,
    createLearner,
  };
}
