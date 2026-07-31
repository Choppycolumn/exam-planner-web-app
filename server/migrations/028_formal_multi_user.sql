ALTER TABLE user_accounts ADD COLUMN public_id TEXT NOT NULL DEFAULT '';
ALTER TABLE user_accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE user_accounts ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE user_accounts ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_accounts ADD COLUMN last_login_at TEXT;

UPDATE user_accounts
SET public_id = CASE
  WHEN public_id <> '' THEN public_id
  ELSE lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
       substr(lower(hex(randomblob(2))), 2) || '-' ||
       substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
       lower(hex(randomblob(6)))
END,
role = CASE WHEN account_type = 'admin' THEN 'owner' ELSE 'member' END,
status = CASE WHEN is_active = 1 THEN 'active' ELSE 'disabled' END;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_accounts_public_id
ON user_accounts(public_id);

CREATE INDEX IF NOT EXISTS idx_user_accounts_status_role
ON user_accounts(status, role, id);

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id INTEGER PRIMARY KEY,
  password_hash TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'scrypt',
  password_changed_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO user_credentials(user_id,password_hash,algorithm,password_changed_at)
SELECT id,password_hash,'scrypt',COALESCE(updated_at,created_at,datetime('now'))
FROM user_accounts
WHERE password_hash <> '';

CREATE TABLE IF NOT EXISTS user_capabilities (
  user_id INTEGER NOT NULL,
  capability TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,capability),
  FOREIGN KEY(user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO user_capabilities(user_id,capability,enabled,updated_at)
SELECT id,'study.use',1,datetime('now') FROM user_accounts;
INSERT OR IGNORE INTO user_capabilities(user_id,capability,enabled,updated_at)
SELECT id,'comparison.view',1,datetime('now') FROM user_accounts;
INSERT OR IGNORE INTO user_capabilities(user_id,capability,enabled,updated_at)
SELECT id,'focus_timer.use',1,datetime('now') FROM user_accounts;
INSERT OR IGNORE INTO user_capabilities(user_id,capability,enabled,updated_at)
SELECT id,'settings.manage',CASE WHEN role='owner' THEN 1 ELSE 0 END,datetime('now') FROM user_accounts;
INSERT OR IGNORE INTO user_capabilities(user_id,capability,enabled,updated_at)
SELECT id,'operations.manage',CASE WHEN role='owner' THEN 1 ELSE 0 END,datetime('now') FROM user_accounts;
INSERT OR IGNORE INTO user_capabilities(user_id,capability,enabled,updated_at)
SELECT id,'notifications.manage',CASE WHEN role='owner' THEN 1 ELSE 0 END,datetime('now') FROM user_accounts;
INSERT OR IGNORE INTO user_capabilities(user_id,capability,enabled,updated_at)
SELECT id,'brief.manage',CASE WHEN role='owner' THEN 1 ELSE 0 END,datetime('now') FROM user_accounts;
INSERT OR IGNORE INTO user_capabilities(user_id,capability,enabled,updated_at)
SELECT id,'break_guard.sync',CASE WHEN role='owner' THEN 1 ELSE 0 END,datetime('now') FROM user_accounts;
INSERT OR IGNORE INTO user_capabilities(user_id,capability,enabled,updated_at)
SELECT id,'users.manage',CASE WHEN role='owner' THEN 1 ELSE 0 END,datetime('now') FROM user_accounts;
INSERT OR IGNORE INTO user_capabilities(user_id,capability,enabled,updated_at)
SELECT id,'data.import',CASE WHEN role='owner' THEN 1 ELSE 0 END,datetime('now') FROM user_accounts;

CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  account_type TEXT NOT NULL,
  display_name_snapshot TEXT NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  client_hash TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
ON user_sessions(user_id,expires_at,revoked_at);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry
ON user_sessions(expires_at,revoked_at);

CREATE TABLE IF NOT EXISTS user_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id INTEGER NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by_user_id INTEGER,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(created_by_user_id) REFERENCES user_accounts(id),
  FOREIGN KEY(used_by_user_id) REFERENCES user_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_user_invites_active
ON user_invites(expires_at,used_at,revoked_at);

INSERT OR REPLACE INTO user_confusing_words_backup
(user_id,schema_version,exported_at,backed_up_at,payload_json)
SELECT owner.id,legacy.schema_version,legacy.exported_at,legacy.backed_up_at,legacy.payload_json
FROM confusing_words_backup legacy
CROSS JOIN (SELECT id FROM user_accounts WHERE role='owner' ORDER BY id LIMIT 1) owner
WHERE legacy.id = 1;

INSERT INTO user_confusing_words_backup_versions
(user_id,schema_version,exported_at,backed_up_at,payload_json,source,group_count,word_count,payload_hash,created_at)
SELECT owner.id,legacy.schema_version,legacy.exported_at,legacy.backed_up_at,legacy.payload_json,
legacy.source,legacy.group_count,legacy.word_count,legacy.payload_hash,legacy.created_at
FROM confusing_words_backup_versions legacy
CROSS JOIN (SELECT id FROM user_accounts WHERE role='owner' ORDER BY id LIMIT 1) owner
WHERE NOT EXISTS (
  SELECT 1 FROM user_confusing_words_backup_versions current
  WHERE current.user_id = owner.id AND current.payload_hash = legacy.payload_hash
);
