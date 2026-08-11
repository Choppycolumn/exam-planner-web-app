export function createGracefulShutdown({
  server = null,
  stopBackgroundWork = () => {},
  closeResources = () => {},
  onStart = () => {},
  log = () => {},
  exit = (code) => process.exit(code),
  forceAfterMs = 8_000,
  scheduleTimeout = (callback, delay) => setTimeout(callback, delay),
} = {}) {
  let shuttingDown = false;
  let finished = false;

  const finish = (signal) => {
    if (finished) return;
    finished = true;
    closeResources();
    log('info', 'server_shutdown_completed', { signal });
    exit(0);
  };

  const shutdown = (signal = 'SIGTERM') => {
    if (shuttingDown) return;
    shuttingDown = true;
    onStart();
    log('info', 'server_shutdown_started', { signal });
    stopBackgroundWork();
    if (!server) {
      finish(signal);
      return;
    }
    server.close(() => finish(signal));
    server.closeIdleConnections?.();
    const timer = scheduleTimeout(() => {
      if (finished) return;
      log('warn', 'server_shutdown_connections_closed', { signal });
      server.closeAllConnections?.();
      finish(signal);
    }, forceAfterMs);
    timer?.unref?.();
  };

  return {
    shutdown,
    state: () => ({ shuttingDown, finished }),
  };
}
