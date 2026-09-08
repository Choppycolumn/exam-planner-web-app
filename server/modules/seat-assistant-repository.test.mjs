import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createSqliteRepository } from './sqlite-repository.mjs';
import { createSeatAssistantRepository } from './seat-assistant-repository.mjs';
import { createSeatAssistantService } from './seat-assistant-service.mjs';

function openFixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'seat-assistant-sqlite-'));
  const sqliteFile = join(dataDir, 'state.sqlite');
  const sqlite = createSqliteRepository({ sqliteFile, dataDir });
  sqlite.run(`
    CREATE TABLE user_accounts(id INTEGER PRIMARY KEY, role TEXT NOT NULL);
    CREATE TABLE user_capabilities(user_id INTEGER, capability TEXT, enabled INTEGER, updated_at TEXT, PRIMARY KEY(user_id, capability));
    INSERT INTO user_accounts VALUES (1, 'owner');
  `);
  sqlite.run(readFileSync(new URL('../migrations/031_seat_assistant.sql', import.meta.url), 'utf8'));
  return { dataDir, sqliteFile, sqlite };
}

function closeFixture(fixture) {
  fixture.sqlite.close();
  rmSync(fixture.dataDir, { recursive: true, force: true });
}

describe('seat assistant SQLite persistence', () => {
  it('atomically claims the persisted low-frequency slot across two repository instances', () => {
    const fixture = openFixture();
    try {
      const first = createSeatAssistantRepository(fixture.sqlite);
      const secondSqlite = createSqliteRepository({ sqliteFile: fixture.sqliteFile, dataDir: fixture.dataDir });
      const second = createSeatAssistantRepository(secondSqlite);
      expect(first.claimQuerySlot('2026-08-22T10:00:00.000Z', '2026-08-22T09:59:00.000Z')).toBe(true);
      expect(second.claimQuerySlot('2026-08-22T10:00:01.000Z', '2026-08-22T09:59:01.000Z')).toBe(false);
      expect(second.getSessionStatus().lastAttemptAt).toBe('2026-08-22T10:00:00.000Z');
      expect(second.claimQuerySlot('2026-08-22T10:01:01.000Z', '2026-08-22T10:00:01.000Z')).toBe(true);
      first.saveSessionStatus({ ...first.getSessionStatus(), lastAttemptAt: null, lastCheckedAt: '2026-08-22T10:01:01.000Z' });
      expect(second.claimQuerySlot('2026-08-22T10:01:02.000Z', '2026-08-22T10:00:02.000Z')).toBe(false);
      secondSqlite.close();
    } finally {
      closeFixture(fixture);
    }
  });

  it('restores notification episode/count after a database restart and avoids a duplicate first alert', async () => {
    const fixture = openFixture();
    let reopened = null;
    try {
      const repository = createSeatAssistantRepository(fixture.sqlite);
      repository.saveProfile({ ...repository.getProfile(), enabled: true, jitterSeconds: 0 });
      const firstNotifications = [];
      const provider = {
        name: 'hust_yitlink_readonly',
        enabled: true,
        canExecute: false,
        query: async () => ({ status: 'ok', totalSeats: 1, freeSeats: 1, availableSeats: ['017'] }),
      };
      const firstService = createSeatAssistantService({
        repository,
        provider,
        featureEnabled: true,
        minimumRequestIntervalSeconds: 60,
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        random: () => 0,
        queueProactiveNotification: (event) => firstNotifications.push(event),
      });
      await firstService.refreshNow();
      expect(firstNotifications).toHaveLength(1);
      expect(firstNotifications[0].eventKey).toMatch(/:1$/);

      fixture.sqlite.close();
      reopened = createSqliteRepository({ sqliteFile: fixture.sqliteFile, dataDir: fixture.dataDir });
      const restoredRepository = createSeatAssistantRepository(reopened);
      expect(restoredRepository.getNotificationState()).toMatchObject({ notifyCount: 1, stateKey: 'one:17' });
      const secondNotifications = [];
      const secondService = createSeatAssistantService({
        repository: restoredRepository,
        provider,
        featureEnabled: true,
        minimumRequestIntervalSeconds: 60,
        now: () => new Date('2026-08-22T10:01:00.000Z'),
        random: () => 0,
        queueProactiveNotification: (event) => secondNotifications.push(event),
      });
      await secondService.refreshNow();
      expect(secondNotifications).toHaveLength(1);
      expect(secondNotifications[0].eventKey).toMatch(/:2$/);
      expect(secondNotifications[0].eventKey).not.toBe(firstNotifications[0].eventKey);
    } finally {
      reopened?.close();
      fixture.sqlite.close();
      rmSync(fixture.dataDir, { recursive: true, force: true });
    }
  });
});
