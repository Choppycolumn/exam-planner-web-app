import { describe, expect, it } from 'vitest';
import { validateApiContractResponse } from './responseValidation';

describe('API response validation', () => {
  it('accepts a complete focus timer response', () => {
    expect(() => validateApiContractResponse('focusTimerRead', {
      state: {}, settings: {}, summary: {}, sessions: [],
    })).not.toThrow();
  });

  it('rejects a malformed session before it reaches the UI', () => {
    expect(() => validateApiContractResponse('session', { userId: 2 }))
      .toThrow(/登录会话数据不完整/);
  });

  it('rejects an incomplete state payload', () => {
    expect(() => validateApiContractResponse('state', { goals: [] }))
      .toThrow(/学习数据缺少/);
  });
});
