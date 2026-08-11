import type { ApiContractName } from '../../shared/api-contracts.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(name: ApiContractName, value: unknown) {
  if (!isRecord(value)) throw new Error(`接口 ${name} 返回了无效的数据格式`);
  return value;
}

export function validateApiContractResponse(name: ApiContractName, value: unknown): void {
  if (name === 'session') {
    const payload = requireRecord(name, value);
    if (!Array.isArray(payload.capabilities) || typeof payload.userId !== 'number') {
      throw new Error('登录会话数据不完整，请刷新后重新登录');
    }
    return;
  }
  if (name === 'state') {
    const payload = requireRecord(name, value);
    for (const key of ['goals', 'dailyReviews', 'studyProjects', 'studyTimeRecords', 'subjects', 'mockExamRecords', 'shortTermTasks']) {
      if (!Array.isArray(payload[key])) throw new Error(`学习数据缺少 ${key} 列表`);
    }
    return;
  }
  if (name === 'dashboard') {
    const payload = requireRecord(name, value);
    if (
      typeof payload.today !== 'string'
      || !Number.isFinite(payload.todayTotal)
      || !Number.isFinite(payload.totalStudyMinutes)
      || !Number.isFinite(payload.studyTargetMinutes)
      || !Array.isArray(payload.visibleTasks)
    ) {
      throw new Error('首页数据结构不完整，请稍后重试');
    }
    return;
  }
  if (name === 'dashboardCharts') {
    const payload = requireRecord(name, value);
    if (typeof payload.today !== 'string' || !Array.isArray(payload.distribution) || !Array.isArray(payload.trend)) {
      throw new Error('首页图表数据结构不完整，请稍后重试');
    }
    return;
  }
  if (name === 'focusTimerRead' || name === 'focusTimerAction') {
    const envelope = requireRecord(name, value);
    const dashboard = name === 'focusTimerAction' ? envelope.dashboard : envelope;
    const payload = requireRecord(name, dashboard);
    if (!isRecord(payload.state) || !isRecord(payload.settings) || !isRecord(payload.summary) || !Array.isArray(payload.sessions)) {
      throw new Error('专注计时数据结构不完整，未应用本次响应');
    }
  }
}
