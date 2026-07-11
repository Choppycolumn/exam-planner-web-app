export function createSchedulerRegistry({ now = () => Date.now(), onError = () => {} } = {}) {
  const jobs = new Map();

  function cancel(name) {
    const job = jobs.get(name);
    if (!job) return false;
    clearTimeout(job.timer);
    jobs.delete(name);
    return true;
  }

  function arm(job, delayMs) {
    const safeDelay = Math.max(0, Number(delayMs) || 0);
    job.nextRunAt = new Date(now() + safeDelay).toISOString();
    job.timer = setTimeout(async () => {
      if (jobs.get(job.name) !== job) return;
      job.running = true;
      job.lastStartedAt = new Date(now()).toISOString();
      job.nextRunAt = null;
      try {
        await job.task();
        job.lastSucceededAt = new Date(now()).toISOString();
        job.lastError = '';
      } catch (error) {
        job.lastError = error instanceof Error ? error.message : String(error);
        onError(job.name, error);
      } finally {
        job.running = false;
        if (jobs.get(job.name) !== job) return;
        if (job.intervalMs) arm(job, job.intervalMs);
        else jobs.delete(job.name);
      }
    }, safeDelay);
    if (!job.keepAlive) job.timer.unref?.();
    return job.timer;
  }

  function scheduleOnce(name, delayMs, task, { keepAlive = false } = {}) {
    cancel(name);
    const job = { name, kind: 'once', task, keepAlive, intervalMs: 0, running: false, lastError: '' };
    jobs.set(name, job);
    return arm(job, delayMs);
  }

  function scheduleInterval(name, intervalMs, task, { initialDelayMs = intervalMs, keepAlive = false } = {}) {
    cancel(name);
    const interval = Math.max(1, Number(intervalMs) || 1);
    const job = { name, kind: 'interval', task, keepAlive, intervalMs: interval, running: false, lastError: '' };
    jobs.set(name, job);
    return arm(job, initialDelayMs);
  }

  function stopAll() {
    for (const name of [...jobs.keys()]) cancel(name);
  }

  function snapshot() {
    return [...jobs.values()].map((job) => ({
      name: job.name,
      kind: job.kind,
      running: job.running,
      intervalMs: job.intervalMs || null,
      nextRunAt: job.nextRunAt,
      lastStartedAt: job.lastStartedAt || null,
      lastSucceededAt: job.lastSucceededAt || null,
      lastError: job.lastError || '',
    })).sort((left, right) => left.name.localeCompare(right.name));
  }

  return { scheduleOnce, scheduleInterval, cancel, stopAll, snapshot };
}
