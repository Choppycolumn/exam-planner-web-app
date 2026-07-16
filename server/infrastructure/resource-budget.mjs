const delay = (milliseconds) => new Promise((resolve) => {
  const timer = setTimeout(resolve, milliseconds);
  timer.unref?.();
});

export class ResourceBudgetUnavailableError extends Error {
  constructor(message, snapshot) {
    super(message);
    this.name = 'ResourceBudgetUnavailableError';
    this.code = 'RESOURCE_BUDGET_UNAVAILABLE';
    this.snapshot = snapshot;
  }
}

export function createResourceBudget({
  maxConcurrent = 1,
  minAvailableMemoryBytes = 96 * 1024 * 1024,
  maxLoadPerCpu = 1.5,
  pollIntervalMs = 5_000,
  maxWaitMs = 10 * 60_000,
  readResources,
  now = () => Date.now(),
} = {}) {
  const active = new Set();
  const waiting = new Set();
  let lastDecision = null;

  function snapshot() {
    const resources = readResources();
    const cpuCount = Math.max(1, Number(resources.cpuCount || 1));
    const loadPerCpu = Number(resources.loadAverage?.[0] || 0) / cpuCount;
    const memoryOk = Number(resources.availableMemoryBytes || 0) >= minAvailableMemoryBytes;
    const loadOk = loadPerCpu <= maxLoadPerCpu;
    return {
      maxConcurrent,
      active: [...active],
      waiting: [...waiting],
      availableMemoryBytes: Number(resources.availableMemoryBytes || 0),
      minAvailableMemoryBytes,
      loadAverage: resources.loadAverage || [],
      loadPerCpu,
      maxLoadPerCpu,
      memoryOk,
      loadOk,
      healthy: memoryOk && loadOk,
      lastDecision,
    };
  }

  async function acquire(name, { waitMs = maxWaitMs } = {}) {
    const deadline = now() + Math.max(0, Number(waitMs) || 0);
    waiting.add(name);
    while (true) {
      const state = snapshot();
      if (active.size < maxConcurrent && state.healthy) {
        waiting.delete(name);
        active.add(name);
        lastDecision = { name, decision: 'started', at: new Date(now()).toISOString() };
        return;
      }
      if (now() >= deadline) {
        waiting.delete(name);
        lastDecision = { name, decision: 'deferred', at: new Date(now()).toISOString() };
        throw new ResourceBudgetUnavailableError(`Resource budget unavailable for ${name}`, state);
      }
      await delay(pollIntervalMs);
    }
  }

  async function run(name, task, options) {
    await acquire(name, options);
    try {
      return await task();
    } finally {
      active.delete(name);
    }
  }

  return { run, snapshot };
}
