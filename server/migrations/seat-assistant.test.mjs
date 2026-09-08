import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('seat assistant migration', () => {
  it('seeds the audited preference range and owner-only capability', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE user_accounts(id INTEGER PRIMARY KEY, role TEXT NOT NULL);
      CREATE TABLE user_capabilities(user_id INTEGER, capability TEXT, enabled INTEGER, updated_at TEXT, PRIMARY KEY(user_id, capability));
      INSERT INTO user_accounts VALUES (1, 'owner'), (2, 'member');
    `);
    database.exec(readFileSync(new URL('./031_seat_assistant.sql', import.meta.url), 'utf8'));
    expect(JSON.parse(database.prepare('SELECT seat_preference_json FROM seat_assistant_profiles WHERE id=1').get().seat_preference_json)).toEqual(['17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28']);
    expect(database.prepare("SELECT enabled FROM user_capabilities WHERE user_id=1 AND capability='seat_assistant.manage'").get()).toEqual({ enabled: 1 });
    expect(database.prepare("SELECT enabled FROM user_capabilities WHERE user_id=2 AND capability='seat_assistant.manage'").get()).toEqual({ enabled: 0 });
    expect(database.prepare("SELECT name FROM pragma_table_info('seat_assistant_profiles') WHERE name='fallback_rule'").all()).toEqual([]);
    database.close();
  });
});
