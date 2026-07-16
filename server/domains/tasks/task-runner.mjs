export function createTaskRunner({
  ensureStore,
  repository,
  resourceBudget,
  nowISO,
  redact,
}) {
  const activeTaskLocks = new Set();

  function lastTaskRuns(limit = 12) {
    try {
      return repository.listLatest(limit);
    } catch {
      return [];
    }
  }

  async function runExclusiveTask(taskName, trigger, taskFn, {
    timeoutMs = 15 * 60 * 1000,
    metadata = {},
    resourceWaitMs = 10 * 60 * 1000,
  } = {}) {
    ensureStore();
    if (activeTaskLocks.has(taskName)) {
      return { ok: false, skipped: true, reason: 'already running', taskName };
    }
    activeTaskLocks.add(taskName);
    const startedAt = nowISO();
    const startedMs = Date.now();
    const taskId = repository.start({ taskName, trigger, startedAt, metadata });
    let timeoutId;
    try {
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${taskName} timed out after ${timeoutMs}ms`)), timeoutMs);
        timeoutId.unref?.();
      });
      const execute = () => Promise.resolve().then(taskFn);
      const guarded = resourceBudget
        ? resourceBudget.run(taskName, execute, { waitMs: resourceWaitMs })
        : execute();
      const result = await Promise.race([guarded, timeout]);
      const durationMs = Date.now() - startedMs;
      repository.complete(taskId, {
        finishedAt: nowISO(),
        durationMs,
        metadata: { ...(metadata || {}), result: result ?? null },
      });
      return { ok: true, taskName, taskId, durationMs, result };
    } catch (error) {
      const durationMs = Date.now() - startedMs;
      repository.fail(taskId, {
        finishedAt: nowISO(),
        durationMs,
        error: redact(error.message || String(error)),
      });
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      activeTaskLocks.delete(taskName);
    }
  }

  return { activeTaskLocks, lastTaskRuns, runExclusiveTask };
}
