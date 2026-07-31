import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('legacy investment orphan cleanup migration', () => {
  it('archives unusable child rows before restoring foreign-key integrity', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys=OFF;');
    database.exec(`
      CREATE TABLE investment_transactions(id INTEGER PRIMARY KEY);
      CREATE TABLE investment_accounts(id INTEGER PRIMARY KEY);
      CREATE TABLE investment_transaction_legs(
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
        FOREIGN KEY(transaction_id) REFERENCES investment_transactions(id) ON DELETE CASCADE,
        FOREIGN KEY(account_id) REFERENCES investment_accounts(id)
      );
      INSERT INTO investment_transactions(id) VALUES(1);
      INSERT INTO investment_transaction_legs(id,transaction_id,instrument_symbol,quantity)
      VALUES(1,1,'rQQQ',1),(2,99,'rSPY',2);
    `);
    database.exec('PRAGMA foreign_keys=ON;');

    expect(database.prepare('PRAGMA foreign_key_check').all()).toHaveLength(1);
    database.exec(readFileSync(new URL('./029_archive_orphaned_investment_legs.sql', import.meta.url), 'utf8'));

    expect(database.prepare('SELECT id,transaction_id FROM investment_transaction_legs ORDER BY id').all())
      .toEqual([{ id: 1, transaction_id: 1 }]);
    expect(database.prepare(`SELECT id,transaction_id,instrument_symbol,archive_reason
      FROM legacy_investment_orphan_legs_archive_029`).all()).toEqual([{
      id: 2,
      transaction_id: 99,
      instrument_symbol: 'rSPY',
      archive_reason: 'missing investment_transactions parent',
    }]);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    database.close();
  });
});
