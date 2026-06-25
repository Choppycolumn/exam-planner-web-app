CREATE TABLE IF NOT EXISTS instruments (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  asset_class TEXT NOT NULL DEFAULT 'asset',
  currency TEXT NOT NULL DEFAULT '',
  quote_currency TEXT NOT NULL DEFAULT 'USDT',
  is_active INTEGER NOT NULL DEFAULT 1,
  is_locked_default INTEGER NOT NULL DEFAULT 0,
  is_high_risk_default INTEGER NOT NULL DEFAULT 0,
  manual_price REAL,
  manual_price_time TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT '',
  base_currency TEXT NOT NULL DEFAULT 'USDT',
  is_active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  traded_at TEXT NOT NULL,
  instrument_symbol TEXT NOT NULL,
  account_id INTEGER,
  account_name_snapshot TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  gross_amount REAL NOT NULL DEFAULT 0,
  fee_amount REAL NOT NULL DEFAULT 0,
  fee_currency TEXT NOT NULL DEFAULT '',
  order_type TEXT NOT NULL DEFAULT '其他',
  note TEXT NOT NULL DEFAULT '',
  confirmed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (instrument_symbol) REFERENCES instruments(symbol),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS cash_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  currency TEXT NOT NULL,
  account_id INTEGER,
  amount REAL NOT NULL DEFAULT 0,
  locked_amount REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(currency, account_id),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS locked_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_symbol TEXT NOT NULL,
  account_id INTEGER,
  quantity REAL NOT NULL DEFAULT 0,
  reference_price REAL NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT '锁定仓',
  risk_level TEXT NOT NULL DEFAULT 'high',
  include_in_ammo INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (instrument_symbol) REFERENCES instruments(symbol),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS daily_order_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_date TEXT NOT NULL,
  instrument_symbol TEXT NOT NULL,
  account_id INTEGER,
  available_usdt REAL NOT NULL DEFAULT 0,
  estimated_fee_rate REAL NOT NULL DEFAULT 0,
  valid_until TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (instrument_symbol) REFERENCES instruments(symbol),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS daily_order_plan_legs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  level_index INTEGER NOT NULL,
  limit_price REAL NOT NULL DEFAULT 0,
  amount_usdt REAL NOT NULL DEFAULT 0,
  expected_quantity REAL NOT NULL DEFAULT 0,
  expected_fee REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES daily_order_plans(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  value REAL,
  change_amount REAL,
  change_percent REAL,
  observed_at TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  delay_status TEXT NOT NULL DEFAULT 'unknown',
  verification_status TEXT NOT NULL DEFAULT 'single_source',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS news_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  credibility TEXT NOT NULL DEFAULT 'supplemental',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS macro_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  event_time TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  importance TEXT NOT NULL DEFAULT 'medium',
  source_url TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS intelligence_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_key TEXT NOT NULL UNIQUE,
  report_type TEXT NOT NULL,
  market_status TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  markdown TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS data_source_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL UNIQUE,
  source_name TEXT NOT NULL,
  status TEXT NOT NULL,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  event_key TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transactions_symbol_time ON transactions(instrument_symbol, traded_at, id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id, traded_at);
CREATE INDEX IF NOT EXISTS idx_locked_positions_symbol ON locked_positions(instrument_symbol);
CREATE INDEX IF NOT EXISTS idx_daily_order_plans_date ON daily_order_plans(plan_date, status);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_symbol_created ON market_snapshots(symbol, created_at);
CREATE INDEX IF NOT EXISTS idx_news_items_published ON news_items(published_at);
CREATE INDEX IF NOT EXISTS idx_macro_events_time ON macro_events(event_time);
CREATE INDEX IF NOT EXISTS idx_intelligence_reports_generated ON intelligence_reports(generated_at);
