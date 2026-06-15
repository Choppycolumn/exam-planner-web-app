import { describe, expect, it } from 'vitest';
import { isTelegramAuthorized, telegramConfirmKeyboard, telegramTaskKeyboard, telegramUpdateContext } from './telegram-bot.mjs';

describe('telegram bot safety helpers', () => {
  it('authorizes only the configured user and chat', () => {
    const config = { TELEGRAM_ALLOWED_USER_ID: '7', TELEGRAM_CHAT_ID: '9' };
    expect(isTelegramAuthorized({ userId: '7', chatId: '9' }, config)).toBe(true);
    expect(isTelegramAuthorized({ userId: '8', chatId: '9' }, config)).toBe(false);
  });

  it('parses callback updates and builds constrained buttons', () => {
    const context = telegramUpdateContext({ callback_query: { id: 'c', data: 'task:complete:12', from: { id: 7 }, message: { message_id: 3, chat: { id: 9 } } } });
    expect(context.callbackData).toBe('task:complete:12');
    expect(telegramTaskKeyboard([{ id: 12, title: 'Test' }]).inline_keyboard[0][0].callback_data).toBe('task:complete:12');
    expect(telegramConfirmKeyboard('backup', 'once').inline_keyboard[0][0].callback_data).toBe('ops:confirm:backup:once');
  });
});
