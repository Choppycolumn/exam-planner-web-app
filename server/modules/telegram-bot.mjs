import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const keys = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_ALLOWED_USER_ID', 'TELEGRAM_WEBHOOK_URL', 'TELEGRAM_WEBHOOK_SECRET'];

function escapeEnv(value = '') {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+\-@]*$/.test(text)) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function parseTelegramEnv(text = '') {
  const result = {};
  String(text).split(/\r?\n/).forEach((line) => {
    const match = line.trim().match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match || !keys.includes(match[1])) return;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    result[match[1]] = value;
  });
  return result;
}

export function readTelegramConfig(filePath, env = process.env) {
  const file = existsSync(filePath) ? parseTelegramEnv(readFileSync(filePath, 'utf8')) : {};
  return Object.fromEntries(keys.map((key) => [key, String(env[key] || file[key] || '')]));
}

export function saveTelegramConfig(filePath, current, input = {}) {
  const next = { ...current };
  const fields = {
    botToken: 'TELEGRAM_BOT_TOKEN',
    chatId: 'TELEGRAM_CHAT_ID',
    allowedUserId: 'TELEGRAM_ALLOWED_USER_ID',
    webhookUrl: 'TELEGRAM_WEBHOOK_URL',
  };
  Object.entries(fields).forEach(([field, key]) => {
    if (typeof input[field] === 'string' && input[field].trim()) next[key] = input[field].trim();
  });
  if (input.clearToken) next.TELEGRAM_BOT_TOKEN = '';
  if (input.clearChatId) next.TELEGRAM_CHAT_ID = '';
  if (input.clearAllowedUserId) next.TELEGRAM_ALLOWED_USER_ID = '';
  if (input.clearWebhookUrl) next.TELEGRAM_WEBHOOK_URL = '';
  if (!next.TELEGRAM_WEBHOOK_SECRET) next.TELEGRAM_WEBHOOK_SECRET = randomBytes(24).toString('base64url');
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${keys.map((key) => `${key}=${escapeEnv(next[key] || '')}`).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(filePath, 0o600); } catch { /* Windows development */ }
  return next;
}

export function telegramConfigStatus(config) {
  const token = String(config.TELEGRAM_BOT_TOKEN || '');
  const chatId = String(config.TELEGRAM_CHAT_ID || '');
  const allowedUserId = String(config.TELEGRAM_ALLOWED_USER_ID || '');
  const webhookUrl = String(config.TELEGRAM_WEBHOOK_URL || '');
  return {
    configured: Boolean(token && chatId && allowedUserId),
    tokenConfigured: Boolean(token),
    tokenLast4: token ? token.slice(-4) : '',
    chatIdConfigured: Boolean(chatId),
    chatIdLast4: chatId ? chatId.slice(-4) : '',
    allowedUserIdConfigured: Boolean(allowedUserId),
    allowedUserIdLast4: allowedUserId ? allowedUserId.slice(-4) : '',
    webhookUrl,
    webhookConfigured: Boolean(webhookUrl && config.TELEGRAM_WEBHOOK_SECRET),
  };
}

export function telegramUpdateContext(update = {}) {
  const callback = update.callback_query;
  const message = callback?.message || update.message || update.edited_message;
  return {
    updateId: update.update_id,
    callbackId: callback?.id || '',
    callbackData: callback?.data || '',
    text: message?.text || '',
    chatId: String(message?.chat?.id || ''),
    userId: String(callback?.from?.id || message?.from?.id || ''),
    messageId: message?.message_id || null,
  };
}

export function isTelegramAuthorized(context, config) {
  return Boolean(
    config.TELEGRAM_ALLOWED_USER_ID
    && context.userId === String(config.TELEGRAM_ALLOWED_USER_ID)
    && (!config.TELEGRAM_CHAT_ID || context.chatId === String(config.TELEGRAM_CHAT_ID)),
  );
}

export function telegramTaskKeyboard(tasks = []) {
  return {
    inline_keyboard: tasks.slice(0, 8).map((task) => ([
      { text: `完成：${String(task.title || '').slice(0, 20)}`, callback_data: `task:complete:${task.id}` },
      { text: '延期一天', callback_data: `task:delay:${task.id}` },
    ])),
  };
}

export function telegramConfirmKeyboard(action, token) {
  return {
    inline_keyboard: [[
      { text: '确认执行', callback_data: `ops:confirm:${action}:${token}` },
      { text: '取消', callback_data: 'ops:cancel' },
    ]],
  };
}
