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

  it('accepts the current dashboard contract without chart fields', () => {
    expect(() => validateApiContractResponse('dashboard', {
      today: '2026-08-11',
      todayTotal: 104,
      totalStudyMinutes: 16_677,
      studyTargetMinutes: 20_000,
      visibleTasks: [],
    })).not.toThrow();
  });

  it('validates dashboard charts through their separate contract', () => {
    expect(() => validateApiContractResponse('dashboardCharts', {
      today: '2026-08-11',
      distribution: [],
      trend: [],
    })).not.toThrow();
    expect(() => validateApiContractResponse('dashboardCharts', {
      today: '2026-08-11',
      distribution: [],
    })).toThrow(/首页图表数据结构不完整/);
  });
});
