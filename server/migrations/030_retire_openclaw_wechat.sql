UPDATE notification_deliveries
SET status = 'cancelled',
    next_attempt_at = NULL,
    error = 'retired notification channel',
    updated_at = datetime('now')
WHERE channel_key IN ('clawbot_weixin', 'wecom_default')
  AND status IN ('queued', 'retrying', 'sending');

DELETE FROM notification_channel_health
WHERE channel_key IN ('clawbot_weixin', 'wecom_default');

DELETE FROM notification_channels
WHERE channel_key IN ('clawbot_weixin', 'wecom_default')
   OR type IN ('clawbot_weixin', 'wecom_webhook');

UPDATE app_metadata
SET value = json_remove(
      json_set(
        value,
        '$.notifications.enabled',
        COALESCE(
          json_extract(value, '$.notifications.enabled'),
          json_extract(value, '$.wechat.enabled'),
          1
        )
      ),
      '$.wechat'
    ),
    updated_at = datetime('now')
WHERE key = 'daily_brief_settings_json'
  AND json_valid(value);
