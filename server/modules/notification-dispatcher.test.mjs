import { describe, expect, it } from 'vitest';
import { resolveProactiveDispatch } from './notification-dispatcher.mjs';

describe('notification dispatcher', () => {
  it('routes proactive delivery by channel key through one resolver', () => {
    expect(resolveProactiveDispatch({ channelKey: 'clawbot_weixin' }).kind).toBe('clawbot_weixin');
    expect(resolveProactiveDispatch({ channelKey: 'bark_default' }).kind).toBe('bark');
    expect(resolveProactiveDispatch({ channelKey: 'telegram_default' }).kind).toBe('telegram');
  });
});
