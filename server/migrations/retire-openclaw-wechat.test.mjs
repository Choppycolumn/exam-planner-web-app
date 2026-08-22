import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('retired notification channel migration', () => {
  it('removes active WeChat channels while preserving Bark and Telegram', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE notification_channels(channel_key TEXT PRIMARY KEY,type TEXT,name TEXT,enabled INTEGER,config_json TEXT,created_at TEXT,updated_at TEXT);
      CREATE TABLE notification_deliveries(id INTEGER PRIMARY KEY,event_id INTEGER,channel_key TEXT,channel_type TEXT,status TEXT,next_attempt_at TEXT,error TEXT,updated_at TEXT);
      CREATE TABLE notification_channel_health(channel_key TEXT PRIMARY KEY,status TEXT);
      CREATE TABLE app_metadata(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
      INSERT INTO notification_channels VALUES
        ('clawbot_weixin','clawbot_weixin','legacy',1,'{}','now','now'),
        ('wecom_default','wecom_webhook','legacy',1,'{}','now','now'),
        ('bark_default','bark','Bark',1,'{}','now','now'),
        ('telegram_default','telegram','Telegram',1,'{}','now','now');
      INSERT INTO notification_deliveries VALUES(1,1,'clawbot_weixin','clawbot_weixin','retrying','later','old error','now');
      INSERT INTO notification_channel_health VALUES('clawbot_weixin','failed');
      INSERT INTO app_metadata VALUES('daily_brief_settings_json','{"wechat":{"enabled":true},"generateTime":"08:00"}','now');
    `);

    database.exec(readFileSync(new URL('./030_retire_openclaw_wechat.sql', import.meta.url), 'utf8'));

    expect(database.prepare('SELECT channel_key AS channelKey FROM notification_channels ORDER BY channel_key').all()).toEqual([
      { channelKey: 'bark_default' },
      { channelKey: 'telegram_default' },
    ]);
    expect(database.prepare('SELECT status,next_attempt_at AS nextAttemptAt FROM notification_deliveries WHERE id=1').get()).toEqual({ status: 'cancelled', nextAttemptAt: null });
    expect(database.prepare('SELECT COUNT(*) AS count FROM notification_channel_health').get().count).toBe(0);
    const settings = JSON.parse(database.prepare("SELECT value FROM app_metadata WHERE key='daily_brief_settings_json'").get().value);
    expect(settings).toEqual({ generateTime: '08:00', notifications: { enabled: 1 } });
    database.close();
  });
});
