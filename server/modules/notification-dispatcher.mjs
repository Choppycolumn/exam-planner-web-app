function eventText(event) {
  const title = String(event?.title || 'Notification');
  const content = String(event?.content || '');
  const source = String(event?.source || 'system');
  const severity = String(event?.severity || 'info');
  return `[${severity}] ${title}\n\n${content}\n\nsource: ${source}`;
}

function telegramRequest(channel, event, env) {
  const tokenEnv = channel.config?.botTokenEnv || 'TELEGRAM_BOT_TOKEN';
  const chatIdEnv = channel.config?.chatIdEnv || 'TELEGRAM_CHAT_ID';
  const token = env[tokenEnv];
  const chatId = env[chatIdEnv];
  if (!token || !chatId) return null;
  return {
    channelKey: channel.channelKey,
    type: 'telegram',
    url: `https://api.telegram.org/bot${token}/sendMessage`,
    body: {
      chat_id: chatId,
      text: eventText(event).slice(0, 4096),
      disable_notification: event.severity === 'info',
    },
  };
}

function wecomWebhookRequest(channel, event, env) {
  const webhookEnv = channel.config?.webhookUrlEnv || 'WECOM_WEBHOOK_URL';
  const webhookUrl = env[webhookEnv];
  if (!webhookUrl) return null;
  return {
    channelKey: channel.channelKey,
    type: 'wecom_webhook',
    url: webhookUrl,
    body: {
      msgtype: 'markdown',
      markdown: { content: eventText(event).slice(0, 4096) },
    },
  };
}

function genericWebhookRequest(channel, event, env) {
  const webhookEnv = channel.config?.webhookUrlEnv || 'NOTIFICATION_WEBHOOK_URL';
  const webhookUrl = channel.config?.webhookUrl || env[webhookEnv];
  if (!webhookUrl) return null;
  return {
    channelKey: channel.channelKey,
    type: 'webhook',
    url: webhookUrl,
    body: {
      eventKey: event.eventKey,
      source: event.source,
      severity: event.severity,
      title: event.title,
      content: event.content,
      payload: event.payload || {},
      createdAt: event.createdAt,
    },
  };
}

export function buildNotificationDeliveryRequest(channel, event, env = process.env) {
  if (!channel?.enabled) return null;
  if (channel.type === 'telegram') return telegramRequest(channel, event, env);
  if (channel.type === 'wecom_webhook') return wecomWebhookRequest(channel, event, env);
  if (channel.type === 'webhook') return genericWebhookRequest(channel, event, env);
  return null;
}

export function notificationChannelReadiness(channel, env = process.env) {
  if (channel.type === 'telegram') {
    const tokenEnv = channel.config?.botTokenEnv || 'TELEGRAM_BOT_TOKEN';
    const chatIdEnv = channel.config?.chatIdEnv || 'TELEGRAM_CHAT_ID';
    return { ready: Boolean(env[tokenEnv] && env[chatIdEnv]), requiredEnv: [tokenEnv, chatIdEnv] };
  }
  if (channel.type === 'wecom_webhook') {
    const webhookEnv = channel.config?.webhookUrlEnv || 'WECOM_WEBHOOK_URL';
    return { ready: Boolean(env[webhookEnv]), requiredEnv: [webhookEnv] };
  }
  if (channel.type === 'webhook') {
    const webhookEnv = channel.config?.webhookUrlEnv || 'NOTIFICATION_WEBHOOK_URL';
    return { ready: Boolean(channel.config?.webhookUrl || env[webhookEnv]), requiredEnv: [webhookEnv] };
  }
  if (channel.type === 'clawbot_weixin') {
    return {
      ready: Boolean(channel.enabled),
      requiredEnv: [],
    };
  }
  if (channel.type === 'bark') {
    return {
      ready: Boolean(env.BARK_DEVICE_KEY),
      requiredEnv: ['BARK_DEVICE_KEY'],
    };
  }
  return { ready: channel.type === 'in_app', requiredEnv: [] };
}
