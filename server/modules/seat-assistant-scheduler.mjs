export function createSeatAssistantScheduler({ service, featureEnabled = false, providerEnabled = false, now = () => new Date(), setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, random = Math.random, logger = () => {} } = {}) {
  let timer = null;
  let started = false;

  function stop() {
    if (timer) clearTimeoutFn(timer);
    timer = null;
    started = false;
  }

  function schedule(delayMs = 0) {
    if (!started) return;
    if (timer) clearTimeoutFn(timer);
    timer = setTimeoutFn(async () => {
      timer = null;
      try {
        const result = await service.refreshNow({ trigger: 'scheduled' });
        const nextAt = result?.session?.nextCheckAt || result?.nextCheckAt;
        if (nextAt) {
          schedule(Math.max(60_000, new Date(nextAt).getTime() - now().getTime()));
          return;
        }
      } catch (error) {
        logger('warn', 'seat_assistant_schedule_failed', { error: String(error?.message || error).slice(0, 240) });
      } finally {
        if (started && !timer) schedule(60_000 + Math.floor(random() * 30_000));
      }
    }, Math.max(0, delayMs));
    timer.unref?.();
  }

  function start() {
    const providerIsEnabled = typeof providerEnabled === 'function' ? Boolean(providerEnabled()) : Boolean(providerEnabled);
    const providerIsDynamic = typeof providerEnabled === 'function';
    if (!featureEnabled || started || (!providerIsEnabled && !providerIsDynamic)) return false;
    started = true;
    schedule(providerIsEnabled ? 0 : 60_000);
    return true;
  }

  return { start, stop, isRunning: () => started, schedule };
}
