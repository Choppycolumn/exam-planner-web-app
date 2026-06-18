const rank = { normal: 0, degraded: 1, failed: 2 };

export function summarizeHealth(checks = []) {
  const status = checks.reduce((current, check) => rank[check.status] > rank[current] ? check.status : current, 'normal');
  return {
    status,
    summary: status === 'normal' ? '所有关键服务正常' : status === 'degraded' ? '核心服务可用，但存在需要处理的降级项' : '存在影响核心功能的故障',
    actions: checks.filter((check) => check.status !== 'normal' && check.action).map((check) => ({ id: check.id, level: check.status, title: check.title, action: check.action })),
  };
}
