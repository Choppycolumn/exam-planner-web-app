CREATE TABLE IF NOT EXISTS investment_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT '',
  base_currency TEXT NOT NULL DEFAULT 'USDT',
  account_type TEXT NOT NULL DEFAULT 'available',
  is_locked_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS investment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_group_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  transaction_type TEXT NOT NULL DEFAULT 'other',
  source TEXT NOT NULL DEFAULT 'manual',
  account_id INTEGER,
  external_reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  order_type TEXT NOT NULL DEFAULT 'other',
  version INTEGER NOT NULL DEFAULT 1,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  is_voided INTEGER NOT NULL DEFAULT 0,
  void_reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'system',
  updated_by TEXT NOT NULL DEFAULT 'system',
  migration_state TEXT NOT NULL DEFAULT 'active',
  legacy_transaction_id INTEGER,
  FOREIGN KEY (account_id) REFERENCES investment_accounts(id)
);

CREATE TABLE IF NOT EXISTS investment_transaction_legs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL,
  leg_index INTEGER NOT NULL DEFAULT 1,
  instrument_symbol TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  quote_currency TEXT NOT NULL DEFAULT 'USDT',
  unit_price REAL NOT NULL DEFAULT 0,
  nominal_amount REAL NOT NULL DEFAULT 0,
  fee_amount REAL NOT NULL DEFAULT 0,
  fee_currency TEXT NOT NULL DEFAULT '',
  account_id INTEGER,
  lock_state TEXT NOT NULL DEFAULT 'available',
  cost_assignment TEXT NOT NULL DEFAULT 'auto',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transaction_id) REFERENCES investment_transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES investment_accounts(id)
);

CREATE TABLE IF NOT EXISTS investment_transaction_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER,
  action TEXT NOT NULL,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS investment_reconciliation_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  reconciled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unchecked',
  actual_json TEXT NOT NULL DEFAULT '{}',
  computed_json TEXT NOT NULL DEFAULT '{}',
  diff_json TEXT NOT NULL DEFAULT '{}',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS investment_day_order_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_date TEXT NOT NULL,
  instrument_symbol TEXT NOT NULL DEFAULT 'rQQQ',
  direction TEXT NOT NULL DEFAULT 'buy',
  account_id INTEGER,
  available_ammo_snapshot REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  estimated_fee_rate REAL NOT NULL DEFAULT 0,
  valid_until TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS investment_day_order_plan_legs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  level_index INTEGER NOT NULL,
  limit_price REAL NOT NULL DEFAULT 0,
  amount_usdt REAL NOT NULL DEFAULT 0,
  expected_quantity REAL NOT NULL DEFAULT 0,
  expected_fee REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES investment_day_order_plans(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS investment_prompt_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_key TEXT NOT NULL UNIQUE,
  report_type TEXT NOT NULL DEFAULT 'research_prompt',
  generated_at TEXT NOT NULL,
  markdown TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS investment_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT NOT NULL DEFAULT 'csv',
  status TEXT NOT NULL DEFAULT 'dry_run',
  dry_run_json TEXT NOT NULL DEFAULT '{}',
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS investment_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_investment_transactions_time ON investment_transactions(occurred_at, id);
CREATE INDEX IF NOT EXISTS idx_investment_transactions_group ON investment_transactions(transaction_group_id);
CREATE INDEX IF NOT EXISTS idx_investment_transactions_active ON investment_transactions(is_deleted, is_voided, status, migration_state);
CREATE INDEX IF NOT EXISTS idx_investment_legs_tx ON investment_transaction_legs(transaction_id, leg_index);
CREATE INDEX IF NOT EXISTS idx_investment_legs_symbol ON investment_transaction_legs(instrument_symbol);
CREATE INDEX IF NOT EXISTS idx_investment_day_orders_date ON investment_day_order_plans(plan_date, status);
CREATE INDEX IF NOT EXISTS idx_investment_prompt_reports_generated ON investment_prompt_reports(generated_at);

INSERT OR IGNORE INTO investment_accounts (id, name, platform, base_currency, account_type, is_locked_default, note)
VALUES
  (1, 'Bitget 可用', 'Bitget', 'USDT', 'available', 0, '手动维护的可用资产账户'),
  (2, 'PoolX 锁定', 'Bitget', 'USDT', 'locked', 1, 'PoolX、锁仓、高风险资产账户，不计入 QQQ/rQQQ 弹药'),
  (3, '手动账本', 'Manual', 'USDT', 'manual', 0, '无法确认平台时使用的默认账户');

INSERT INTO investment_transactions (
  transaction_group_id, occurred_at, status, transaction_type, source, account_id,
  external_reference, note, tags, order_type, created_by, updated_by, migration_state, legacy_transaction_id
)
SELECT
  'legacy-tx-' || id,
  traded_at,
  CASE WHEN confirmed = 1 THEN 'confirmed' ELSE 'pending' END,
  CASE action
    WHEN '买入' THEN 'buy'
    WHEN '卖出' THEN 'sell'
    WHEN '转入' THEN 'deposit'
    WHEN '转出' THEN 'withdrawal'
    WHEN '换汇' THEN 'exchange'
    WHEN '锁定' THEN 'lock'
    WHEN '解锁' THEN 'unlock'
    ELSE CASE action
      WHEN '涔板叆' THEN 'buy'
      WHEN '鍗栧嚭' THEN 'sell'
      WHEN '杞叆' THEN 'deposit'
      WHEN '杞嚭' THEN 'withdrawal'
      WHEN '鎹㈡眹' THEN 'exchange'
      WHEN '閿佸畾' THEN 'lock'
      WHEN '瑙ｉ攣' THEN 'unlock'
      ELSE 'other'
    END
  END,
  'legacy_market_copilot',
  COALESCE(account_id, 3),
  '',
  note,
  '["legacy"]',
  COALESCE(order_type, 'other'),
  'migration',
  'migration',
  CASE
    WHEN note LIKE '%示例%' OR note LIKE '%寰呯敤鎴锋牳瀵圭殑鍒濆绀轰緥鏁版嵁%' THEN 'example_pending'
    ELSE 'active_imported'
  END,
  id
FROM transactions
WHERE NOT EXISTS (
  SELECT 1 FROM investment_transactions it WHERE it.legacy_transaction_id = transactions.id
);

INSERT INTO investment_transaction_legs (
  transaction_id, leg_index, instrument_symbol, quantity, quote_currency, unit_price,
  nominal_amount, fee_amount, fee_currency, account_id, lock_state, cost_assignment, note
)
SELECT
  it.id,
  1,
  t.instrument_symbol,
  CASE
    WHEN it.transaction_type IN ('sell', 'withdrawal') THEN -ABS(t.quantity)
    ELSE ABS(t.quantity)
  END,
  COALESCE(i.quote_currency, t.fee_currency, 'USDT'),
  COALESCE(t.price, 0),
  COALESCE(t.gross_amount, COALESCE(t.price, 0) * COALESCE(t.quantity, 0)),
  COALESCE(t.fee_amount, 0),
  COALESCE(NULLIF(t.fee_currency, ''), COALESCE(i.quote_currency, 'USDT')),
  COALESCE(t.account_id, 3),
  CASE WHEN it.transaction_type IN ('lock') THEN 'locked' ELSE 'available' END,
  'legacy_auto',
  t.note
FROM transactions t
JOIN investment_transactions it ON it.legacy_transaction_id = t.id
LEFT JOIN instruments i ON i.symbol = t.instrument_symbol
WHERE NOT EXISTS (
  SELECT 1 FROM investment_transaction_legs l WHERE l.transaction_id = it.id
);

INSERT INTO investment_transactions (
  transaction_group_id, occurred_at, status, transaction_type, source, account_id,
  note, tags, order_type, created_by, updated_by, migration_state, legacy_transaction_id
)
SELECT
  'legacy-lock-' || id,
  updated_at,
  'confirmed',
  'lock',
  'legacy_locked_positions',
  COALESCE(account_id, 2),
  note,
  '["legacy","locked"]',
  'other',
  'migration',
  'migration',
  CASE
    WHEN note LIKE '%示例%' OR note LIKE '%寰呯敤鎴锋牳瀵圭殑鍒濆绀轰緥鏁版嵁%' THEN 'example_pending'
    ELSE 'active_imported'
  END,
  -id
FROM locked_positions
WHERE NOT EXISTS (
  SELECT 1 FROM investment_transactions it WHERE it.legacy_transaction_id = -locked_positions.id
);

INSERT INTO investment_transaction_legs (
  transaction_id, leg_index, instrument_symbol, quantity, quote_currency, unit_price,
  nominal_amount, fee_amount, fee_currency, account_id, lock_state, cost_assignment, note
)
SELECT
  it.id,
  1,
  lp.instrument_symbol,
  ABS(lp.quantity),
  'USDT',
  COALESCE(lp.reference_price, 0),
  ABS(lp.quantity) * COALESCE(lp.reference_price, 0),
  0,
  'USDT',
  2,
  'locked',
  'legacy_locked',
  lp.note
FROM locked_positions lp
JOIN investment_transactions it ON it.legacy_transaction_id = -lp.id
WHERE NOT EXISTS (
  SELECT 1 FROM investment_transaction_legs l WHERE l.transaction_id = it.id
);
