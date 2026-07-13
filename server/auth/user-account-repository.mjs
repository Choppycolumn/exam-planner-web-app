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

export function createUserAccountRepository(database, { maxUsers = 2 } = {}) {
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
    return learnerCount === 0 && countAccounts() < maxUsers;
  };

  const getAccount = (id) => publicAccount(database.json(`${accountSelect}
WHERE id = ? AND is_active = 1 LIMIT 1;`, [Number(id)])[0]);

  const authenticateLearner = (password) => {
    const row = database.json(`${accountSelect}
WHERE account_type = 'learner' AND is_active = 1 LIMIT 1;`)[0];
    return row && verifyPassword(password, row.passwordHash) ? publicAccount(row) : null;
  };

  const createLearner = (password) => {
    const db = database.open();
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const activeCount = Number(db.prepare('SELECT COUNT(*) AS count FROM user_accounts WHERE is_active = 1;').get()?.count || 0);
      const existing = db.prepare("SELECT id FROM user_accounts WHERE account_type = 'learner' AND is_active = 1 LIMIT 1;").get();
      if (existing || activeCount >= maxUsers) {
        const error = new Error('用户数量已达到上限');
        error.code = 'USER_LIMIT_REACHED';
        throw error;
      }

      db.prepare(`INSERT INTO user_accounts
(id, account_type, display_name, password_hash, is_active, created_at, updated_at)
VALUES (2, 'learner', '学习伙伴', ?, 1, ?, ?);`).run(hashPassword(password), now, now);

      const sourceProjects = db.prepare(`SELECT name, color, sort_order AS sortOrder
FROM study_projects WHERE user_id = 1 AND is_active = 1 ORDER BY sort_order, id;`).all();
      let nextProjectId = Number(db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM study_projects;').get()?.id || 0) + 1;
      const insertProject = db.prepare(`INSERT INTO study_projects
(id, name, color, is_active, sort_order, schema_version, created_at, updated_at, user_id)
VALUES (?, ?, ?, 1, ?, 1, ?, ?, 2);`);
      sourceProjects.forEach((project, index) => {
        insertProject.run(nextProjectId++, project.name, project.color, Number(project.sortOrder || index + 1), now, now);
      });
      db.prepare(`INSERT OR IGNORE INTO user_study_settings (user_id, target_minutes, updated_at)
VALUES (2, 0, ?);`).run(now);
      db.exec('COMMIT;');
      return getAccount(2);
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
